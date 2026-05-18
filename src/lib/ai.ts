import { promises as fs } from "fs";
import path from "path";
import { fetch as undiciFetch, ProxyAgent, type RequestInit as UndiciRequestInit, type Response as UndiciResponse } from "undici";
import {
  AccountDraftInput,
  Draft,
  Platform,
  ProjectDraftInput,
  ProjectSummary,
  WriteResult,
  platforms
} from "./types";
import { clampText, makeTitleFromPrompt } from "./utils";
import {
  getTopTranscriptSamples,
  getProjectSummary,
  resolveCopySource,
  libraryRoot,
  resolveAccount,
  resolveProject,
  saveDraft,
  saveProjectStyle,
  saveStyle,
  upsertProject
} from "./storage";
import { normalizeRewritePrompt } from "./source-extraction";
import { resolveRewriteSourceMaterial } from "./source-transcription";

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ChatWireApi = "responses" | "chat_completions" | "auto";
export type ChatReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh";
type ChatTool = {
  type: "web_search";
};
type ChatRequestOptions = {
  signal?: AbortSignal;
};
export type ChatCompletionResult = {
  text: string;
  model: string;
  fallback: boolean;
  fallbackReason?: string;
};

export type WriteCopyInput = {
  platform?: Platform;
  accountId?: string;
  targetType?: "account" | "project";
  projectId?: string;
  mode: Draft["mode"];
  prompt: string;
  sourceText?: string;
  save?: boolean;
  useWebResearch?: boolean;
};

export type PreparedWriteContext = {
  messages: ChatMessage[];
  fallbackName: string;
  fallbackStyle: string;
  fallbackInput: { mode: Draft["mode"]; prompt: string; sourceText?: string };
  research?: string;
  draftBase?: Omit<AccountDraftInput, "content"> | Omit<ProjectDraftInput, "content">;
};

export type SaveAndGenerateProjectStyleInput = {
  projectId?: string;
  name: string;
  description?: string;
  sourceAccountIds: string[];
  sourceMaterialIds?: string[];
};

export type ProjectStyleGenerationResult = {
  project: ProjectSummary;
  style: string;
  fallback: boolean;
  usedModel: string;
  fallbackReason?: string;
};

export type PreparedAccountStyleContext = {
  platform: Platform;
  accountId: string;
  accountName: string;
  messages: ChatMessage[];
  fallback: string;
};

type FetchInitWithDispatcher = UndiciRequestInit & {
  dispatcher?: ProxyAgent;
};

const STYLE_MAX_OUTPUT_TOKENS = 3200;
const WEB_RESEARCH_MAX_OUTPUT_TOKENS = 1800;
const WEB_RESEARCH_TIMEOUT_MS = 180_000;

class StreamResponseTextError extends Error {
  partialText: string;
  originalError: unknown;

  constructor(error: unknown, partialText: string) {
    super(error instanceof Error ? error.message : "模型流式输出中断");
    this.name = "StreamResponseTextError";
    this.partialText = partialText;
    this.originalError = error;
  }
}

class ModelHttpError extends Error {
  status: number;
  body: string;
  contentType?: string | null;

  constructor(status: number, body: string, contentType?: string | null) {
    super(describeChatHttpFailure(status, body, contentType));
    this.name = "ModelHttpError";
    this.status = status;
    this.body = body;
    this.contentType = contentType;
  }
}

function chatConfig() {
  const chatReasoningEffort = process.env.CHAT_REASONING_EFFORT;
  return {
    apiKey: process.env.CHAT_API_KEY || process.env.OPENAI_API_KEY || "",
    baseUrl: (process.env.CHAT_BASE_URL || process.env.OPENAI_BASE_URL || "https://www.fhl.mom").replace(/\/$/, ""),
    responsesUrl: process.env.CHAT_RESPONSES_URL || "",
    chatCompletionsUrl: process.env.CHAT_COMPLETIONS_URL || "",
    model: process.env.CHAT_MODEL || process.env.OPENAI_MODEL || "gpt-5.5",
    wireApi: normalizeWireApi(process.env.CHAT_WIRE_API),
    reasoningEffort: normalizeReasoningEffort(chatReasoningEffort),
    chatCompletionReasoningEffort: chatReasoningEffort ? normalizeReasoningEffort(chatReasoningEffort) : "none",
    proxyUrl: process.env.CHAT_PROXY_URL || ""
  };
}

export function getChatRuntimeConfig() {
  const config = chatConfig();
  return {
    baseUrl: config.baseUrl,
    model: config.model,
    wireApi: config.wireApi,
    reasoningEffort: config.reasoningEffort,
    responsesUrlConfigured: Boolean(config.responsesUrl),
    chatCompletionsUrlConfigured: Boolean(config.chatCompletionsUrl),
    proxyConfigured: Boolean(config.proxyUrl),
    configured: Boolean(config.apiKey && config.model)
  };
}

export async function chatComplete(
  messages: ChatMessage[],
  reasoningEffort?: ChatReasoningEffort
): Promise<ChatCompletionResult> {
  return chatCompleteWithFallback(messages, reasoningEffort);
}

export async function streamResponseText(input: {
  messages: ChatMessage[];
  reasoningEffort?: ChatReasoningEffort;
  tools?: ChatTool[];
  maxOutputTokens?: number;
  signal?: AbortSignal;
  onDelta: (delta: string) => void;
}) {
  const config = chatConfig();
  if (!config.apiKey || !config.model) {
    return fallbackChatCompletion(config.model || "local-fallback");
  }

  if (config.wireApi === "chat_completions") {
    return streamChatCompletion(config, input);
  }

  try {
    return await streamResponseApi(config, input);
  } catch (error) {
    if (
      !(error instanceof StreamResponseTextError) &&
      !input.tools?.length &&
      (config.wireApi === "auto" || shouldRetryResponsesAsChatCompletions(error))
    ) {
      return streamChatCompletion(config, input);
    }
    throw error;
  }
}

async function streamResponseApi(
  config: ReturnType<typeof chatConfig>,
  input: {
    messages: ChatMessage[];
    reasoningEffort?: ChatReasoningEffort;
    tools?: ChatTool[];
    maxOutputTokens?: number;
    signal?: AbortSignal;
    onDelta: (delta: string) => void;
  }
): Promise<ChatCompletionResult> {
  const system = input.messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");
  const requestInput = input.messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role,
      content: message.content
    }));

  const response = await postModelRequest(config, "/responses", {
    model: config.model,
    instructions: system || undefined,
    input: requestInput,
    stream: true,
    tools: input.tools,
    tool_choice: input.tools?.length ? "auto" : undefined,
    reasoning: responseReasoning(input.reasoningEffort || config.reasoningEffort),
    store: false
  }, input.signal);

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("模型服务没有返回可读取的流式内容");
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let aggregatedText = "";
  let streamFinished = false;

  try {
    while (!streamFinished) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop() || "";

      for (const rawEvent of events) {
        const lines = rawEvent
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean);
        const dataLine = lines.find((line) => line.startsWith("data: "));
        if (!dataLine) continue;
        const payload = dataLine.slice(6);
        if (!payload || payload === "[DONE]") continue;

        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(payload) as Record<string, unknown>;
        } catch {
          continue;
        }

        if (parsed.type === "response.output_text.delta" && typeof parsed.delta === "string") {
          aggregatedText += parsed.delta;
          input.onDelta(parsed.delta);
        } else if (parsed.type === "response.output_text.done") {
          aggregatedText = syncResponseText(
            aggregatedText,
            typeof parsed.text === "string" ? parsed.text : "",
            input.onDelta
          );
        } else if (parsed.type === "response.content_part.done" || parsed.type === "response.output_item.done") {
          aggregatedText = syncResponseText(aggregatedText, extractResponseText(parsed), input.onDelta);
        } else if (parsed.type === "response.completed") {
          aggregatedText = syncResponseText(aggregatedText, extractResponseText(parsed.response), input.onDelta);
          streamFinished = true;
        } else if (parsed.type === "response.failed" || parsed.type === "response.incomplete") {
          const errorMessage =
            extractResponseErrorMessage(parsed.response) || extractResponseErrorMessage(parsed) || "模型流式输出失败";
          throw new Error(errorMessage);
        }
      }
    }
    if (streamFinished) {
      await reader.cancel().catch(() => undefined);
    }
  } catch (error) {
    if (aggregatedText.trim()) {
      throw new StreamResponseTextError(error, aggregatedText);
    }
    throw error;
  }

  return {
    text: aggregatedText.trim(),
    model: config.model,
    fallback: false
  } satisfies ChatCompletionResult;
}

async function streamChatCompletion(
  config: ReturnType<typeof chatConfig>,
  input: {
    messages: ChatMessage[];
    reasoningEffort?: ChatReasoningEffort;
    maxOutputTokens?: number;
    signal?: AbortSignal;
    onDelta: (delta: string) => void;
  }
): Promise<ChatCompletionResult> {
  const response = await postModelRequest(config, "/chat/completions", chatCompletionPayload({
    config,
    messages: input.messages,
    reasoningEffort: input.reasoningEffort,
    maxOutputTokens: input.maxOutputTokens,
    stream: true
  }), input.signal);

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("模型服务没有返回可读取的流式内容");
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let aggregatedText = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop() || "";

      for (const rawEvent of events) {
        const delta = parseChatCompletionStreamDelta(rawEvent);
        if (delta) {
          aggregatedText += delta;
          input.onDelta(delta);
        }
      }
    }

    const remaining = parseChatCompletionStreamDelta(buffer);
    if (remaining) {
      aggregatedText += remaining;
      input.onDelta(remaining);
    }
  } catch (error) {
    if (aggregatedText.trim()) {
      throw new StreamResponseTextError(error, aggregatedText);
    }
    throw error;
  }

  return {
    text: aggregatedText.trim(),
    model: config.model,
    fallback: false
  } satisfies ChatCompletionResult;
}

export async function streamResponseTextWithFallback(input: {
  messages: ChatMessage[];
  reasoningEffort?: ChatReasoningEffort;
  tools?: ChatTool[];
  maxOutputTokens?: number;
  signal?: AbortSignal;
  onDelta: (delta: string) => void;
}) {
  try {
    return await streamResponseText(input);
  } catch (error) {
    if (error instanceof StreamResponseTextError && error.partialText.trim()) {
      return {
        text: error.partialText.trim(),
        model: chatConfig().model,
        fallback: true,
        fallbackReason: `${summarizeChatFailure(error)}，已保留模型已生成的内容，请检查后再使用。`
      };
    }
    try {
      return await chatCompleteWithEffort(input.messages, input.reasoningEffort, input.tools, {
        signal: input.signal
      });
    } catch (retryError) {
      return fallbackChatCompletion("local-fallback", retryError);
    }
  }
}

async function chatCompleteWithEffort(
  messages: ChatMessage[],
  reasoningEffort?: ChatReasoningEffort,
  tools?: ChatTool[],
  options: ChatRequestOptions = {}
): Promise<ChatCompletionResult> {
  const config = chatConfig();
  if (!config.apiKey || !config.model) {
    return fallbackChatCompletion(config.model || "local-fallback");
  }

  if (config.wireApi === "chat_completions") {
    return createChatCompletion(config, messages, reasoningEffort, options);
  }

  try {
    return await createResponse(config, messages, reasoningEffort, tools, options);
  } catch (error) {
    if (!tools?.length && (config.wireApi === "auto" || shouldRetryResponsesAsChatCompletions(error))) {
      return createChatCompletion(config, messages, reasoningEffort, options);
    }
    throw error;
  }
}

async function createChatCompletion(
  config: ReturnType<typeof chatConfig>,
  messages: ChatMessage[],
  reasoningEffort?: ChatReasoningEffort,
  options: ChatRequestOptions = {}
): Promise<ChatCompletionResult> {
  const response = await postModelRequest(config, "/chat/completions", chatCompletionPayload({
    config,
    messages,
    reasoningEffort,
    stream: false
  }), options.signal);

  const text = await parseChatCompletionResponseBody(response);

  return {
    text,
    model: config.model,
    fallback: false
  };
}

function chatCompletionPayload(input: {
  config: ReturnType<typeof chatConfig>;
  messages: ChatMessage[];
  reasoningEffort?: ChatReasoningEffort;
  maxOutputTokens?: number;
  stream: boolean;
}) {
  const effort = input.reasoningEffort || input.config.chatCompletionReasoningEffort;
  return {
    model: input.config.model,
    messages: input.messages,
    temperature: 0.75,
    stream: input.stream,
    max_tokens: input.maxOutputTokens,
    ...(effort === "none" ? {} : { reasoning_effort: effort })
  };
}

async function postModelRequest(
  config: ReturnType<typeof chatConfig>,
  pathName: "/responses" | "/chat/completions",
  payload: unknown,
  signal?: AbortSignal
) {
  const init: FetchInitWithDispatcher = {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload),
    dispatcher: chatDispatcher(config.proxyUrl),
    signal
  };
  const response = await undiciFetch(modelEndpoint(config, pathName), init);
  if (!response.ok) {
    throw new ModelHttpError(response.status, await response.text(), response.headers.get("content-type"));
  }
  return response;
}

function modelEndpoint(config: ReturnType<typeof chatConfig>, pathName: "/responses" | "/chat/completions") {
  const configured = pathName === "/responses" ? config.responsesUrl : config.chatCompletionsUrl;
  if (configured) return configured;

  if (config.baseUrl.endsWith(pathName)) {
    return config.baseUrl;
  }
  if (config.baseUrl.endsWith("/responses")) {
    return `${config.baseUrl.slice(0, -"/responses".length)}${pathName}`;
  }
  if (config.baseUrl.endsWith("/chat/completions")) {
    return `${config.baseUrl.slice(0, -"/chat/completions".length)}${pathName}`;
  }

  return `${config.baseUrl}${pathName}`;
}

function responseReasoning(effort: ChatReasoningEffort) {
  return effort === "none" ? undefined : { effort };
}

function parseChatCompletionStreamDelta(rawEvent: string) {
  const lines = rawEvent
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const dataLines = lines
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.replace(/^data:\s*/, ""));

  for (const payload of dataLines) {
    if (!payload || payload === "[DONE]") continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      continue;
    }

    const delta = extractChatCompletionDelta(parsed);
    if (delta) return delta;
  }

  return "";
}

async function parseChatCompletionResponseBody(response: UndiciResponse) {
  const contentType = response.headers.get("content-type");
  const body = await response.text();

  if (contentType?.includes("text/event-stream")) {
    return parseChatCompletionEventStream(body);
  }

  return extractChatCompletionText(parseModelJsonBody(body, contentType));
}

function parseChatCompletionEventStream(body: string) {
  let aggregatedText = "";

  for (const rawEvent of body.split("\n\n")) {
    const delta = parseChatCompletionStreamDelta(rawEvent);
    if (delta) aggregatedText += delta;
  }

  return aggregatedText.trim();
}

function extractChatCompletionDelta(data: unknown) {
  if (!data || typeof data !== "object") return "";
  const object = data as Record<string, unknown>;
  const choices = Array.isArray(object.choices) ? object.choices : [];
  return choices
    .map((choice) => {
      if (!choice || typeof choice !== "object") return "";
      const choiceObject = choice as Record<string, unknown>;
      const delta = choiceObject.delta && typeof choiceObject.delta === "object"
        ? (choiceObject.delta as Record<string, unknown>)
        : {};
      const message = choiceObject.message && typeof choiceObject.message === "object"
        ? (choiceObject.message as Record<string, unknown>)
        : {};
      return stringFromChatContent(delta.content) || stringFromChatContent(message.content) || "";
    })
    .filter(Boolean)
    .join("");
}

function extractChatCompletionText(data: unknown) {
  if (!data || typeof data !== "object") return "";
  const object = data as Record<string, unknown>;
  const choices = Array.isArray(object.choices) ? object.choices : [];

  return choices
    .map((choice) => {
      if (!choice || typeof choice !== "object") return "";
      const choiceObject = choice as Record<string, unknown>;
      const message = choiceObject.message && typeof choiceObject.message === "object"
        ? (choiceObject.message as Record<string, unknown>)
        : {};
      return stringFromChatContent(message.content) || extractChatCompletionDelta(choiceObject);
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

function stringFromChatContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (!part || typeof part !== "object") return "";
      const object = part as Record<string, unknown>;
      return typeof object.text === "string" ? object.text : "";
    })
    .join("");
}

async function createResponse(
  config: ReturnType<typeof chatConfig>,
  messages: ChatMessage[],
  reasoningEffort?: ChatReasoningEffort,
  tools?: ChatTool[],
  options: ChatRequestOptions = {}
): Promise<ChatCompletionResult> {
  const system = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");
  const input = messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role,
      content: message.content
    }));

  const response = await postModelRequest(config, "/responses", {
    model: config.model,
    instructions: system || undefined,
    input,
    stream: false,
    tools,
    tool_choice: tools?.length ? "auto" : undefined,
    reasoning: responseReasoning(reasoningEffort || config.reasoningEffort),
    store: false
  }, options.signal);

  const text = await parseResponseApiBody(response);
  return {
    text,
    model: config.model,
    fallback: false
  };
}

function normalizeWireApi(value?: string): ChatWireApi {
  if (value === "chat_completions" || value === "chat-completions" || value === "chat") return "chat_completions";
  if (value === "auto") return "auto";
  return "responses";
}

function normalizeReasoningEffort(value?: string): ChatReasoningEffort {
  return value === "none" || value === "low" || value === "medium" || value === "high" || value === "xhigh"
    ? value
    : "xhigh";
}

function fallbackChatCompletion(model = "local-fallback", error?: unknown): ChatCompletionResult {
  return {
    text: "",
    model,
    fallback: true,
    fallbackReason: error ? buildChatFallbackReason(error) : undefined
  };
}

async function chatCompleteWithFallback(
  messages: ChatMessage[],
  reasoningEffort?: ChatReasoningEffort,
  tools?: ChatTool[]
): Promise<ChatCompletionResult> {
  try {
    return await chatCompleteWithEffort(messages, reasoningEffort, tools);
  } catch (error) {
    return fallbackChatCompletion("local-fallback", error);
  }
}

function completeStyleGeneration(messages: ChatMessage[]) {
  return streamResponseTextWithFallback({
    messages,
    maxOutputTokens: STYLE_MAX_OUTPUT_TOKENS,
    onDelta() {
      // Keep the request streaming so upstream proxies do not close long style-generation calls.
    }
  });
}

function chatDispatcher(proxyUrl: string): ProxyAgent | undefined {
  return proxyUrl ? new ProxyAgent(proxyUrl) : undefined;
}

function describeChatHttpFailure(status: number, body: string, contentType?: string | null) {
  const detail = summarizeChatErrorBody(body, contentType);
  return `对话模型调用失败：${status}${detail ? ` ${detail}` : ""}`;
}

function summarizeChatErrorBody(body: string, contentType?: string | null) {
  const trimmed = body.trim();
  if (!trimmed) return "";

  const isHtml = Boolean(contentType?.includes("text/html")) || /^<!doctype html\b/i.test(trimmed) || /^<html\b/i.test(trimmed);
  if (isHtml) {
    if (/error code 524|a timeout occurred/i.test(trimmed)) {
      return "模型服务响应超时";
    }

    const title = trimmed.match(/<title>([^<]+)<\/title>/i)?.[1]?.replace(/\s+/g, " ").trim();
    return title ? `服务返回 HTML 错误页（${title}）` : "服务返回 HTML 错误页";
  }

  return trimmed.replace(/\s+/g, " ").slice(0, 240);
}

function shouldRetryResponsesAsChatCompletions(error: unknown) {
  if (!(error instanceof ModelHttpError)) return false;
  const detail = `${error.status} ${error.body}`.toLowerCase();
  return (
    error.status === 404 ||
    error.status === 405 ||
    /responses|response api|unknown endpoint|not found|unsupported|invalid url|no route|cannot post/.test(detail)
  );
}

function buildChatFallbackReason(error: unknown) {
  return `${summarizeChatFailure(error)}，已自动切换到本地模板，可先编辑后再重试。`;
}

function summarizeChatFailure(error: unknown) {
  if (!(error instanceof Error)) return "对话模型暂时不可用";

  const originalError = error instanceof StreamResponseTextError ? error.originalError : error;
  const cause = originalError instanceof Error ? originalError.cause : undefined;
  const causeMessage =
    cause instanceof Error
      ? `${cause.name} ${cause.message} ${(cause as { code?: string }).code || ""}`
      : "";
  const message = [
    error.name,
    error.message,
    originalError instanceof Error ? originalError.message : "",
    causeMessage
  ].join(" ");

  if (/524\b|响应超时|a timeout occurred|timeout|timed out|AbortError|TimeoutError|aborted|UND_ERR_HEADERS_TIMEOUT/i.test(message)) {
    return "对话模型服务超时";
  }
  if (/429\b|rate limit/i.test(message)) return "对话模型服务限流";
  if (/401\b|403\b|unauthorized|forbidden/i.test(message)) return "对话模型服务鉴权异常";
  if (/ECONNREFUSED|ENOTFOUND|UND_ERR_CONNECT_TIMEOUT|UND_ERR_SOCKET|other side closed|fetch failed|SocketError/i.test(message)) {
    return "对话模型服务连接异常";
  }
  if (/5\d\d\b|对话模型调用失败：/i.test(message)) return "对话模型服务暂时异常";
  return "对话模型暂时不可用";
}

async function parseResponseApiBody(response: UndiciResponse) {
  const contentType = response.headers.get("content-type");
  const body = await response.text();

  if (contentType?.includes("text/event-stream")) {
    return parseResponseEventStream(body);
  }

  return extractResponseText(parseModelJsonBody(body, contentType));
}

function parseResponseEventStream(body: string) {
  let aggregatedText = "";

  for (const rawEvent of body.split("\n\n")) {
    const lines = rawEvent
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const dataLines = lines
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.replace(/^data:\s*/, ""));

    for (const payload of dataLines) {
      if (!payload || payload === "[DONE]") continue;

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(payload) as Record<string, unknown>;
      } catch {
        continue;
      }

      if (parsed.type === "response.output_text.delta" && typeof parsed.delta === "string") {
        aggregatedText += parsed.delta;
      } else if (
        parsed.type === "response.output_text.done" ||
        parsed.type === "response.content_part.done" ||
        parsed.type === "response.output_item.done"
      ) {
        aggregatedText = mergeResponseText(aggregatedText, extractResponseText(parsed));
      } else if (parsed.type === "response.completed") {
        aggregatedText = mergeResponseText(aggregatedText, extractResponseText(parsed.response));
      } else if (parsed.type === "response.failed" || parsed.type === "response.incomplete") {
        const errorMessage =
          extractResponseErrorMessage(parsed.response) || extractResponseErrorMessage(parsed) || "模型输出失败";
        throw new Error(errorMessage);
      }
    }
  }

  return aggregatedText.trim();
}

function parseModelJsonBody(body: string, contentType?: string | null) {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    const detail = summarizeChatErrorBody(body, contentType);
    throw new Error(detail ? `模型服务返回了无法解析的内容：${detail}` : "模型服务返回了无法解析的内容");
  }
}

function extractResponseText(data: unknown): string {
  return extractResponseTextValue(data).trim();
}

function extractResponseTextValue(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const object = data as Record<string, unknown>;

  if (typeof object.output_text === "string") return object.output_text;
  if (typeof object.text === "string") return object.text;
  if (object.response) return extractResponseTextValue(object.response);
  if (object.item) return extractResponseTextValue(object.item);
  if (object.part) return extractResponseTextValue(object.part);
  if (Array.isArray(object.content)) return extractResponseContentText(object.content);
  if (!Array.isArray(object.output)) return "";

  return object.output
    .map((item) => extractResponseTextValue(item))
    .filter(Boolean)
    .join("\n");
}

function extractResponseContentText(content: unknown[]) {
  return content
    .map((item) => {
      if (typeof item === "string") return item;
      return extractResponseTextValue(item);
    })
    .filter(Boolean)
    .join("\n");
}

function mergeResponseText(current: string, candidate: string) {
  if (!candidate.trim()) return current;
  if (!current) return candidate;
  if (candidate === current || current.startsWith(candidate)) return current;
  if (candidate.startsWith(current)) return candidate;
  return candidate.length > current.length ? candidate : current;
}

function syncResponseText(current: string, candidate: string, onDelta: (delta: string) => void) {
  const next = mergeResponseText(current, candidate);
  if (next === current) return current;

  if (!current) {
    onDelta(next);
    return next;
  }

  if (next.startsWith(current)) {
    const delta = next.slice(current.length);
    if (delta) onDelta(delta);
  }

  return next;
}

function extractResponseErrorMessage(data: unknown) {
  if (!data || typeof data !== "object") return "";
  const object = data as Record<string, unknown>;
  const error = object.error;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const errorObject = error as Record<string, unknown>;
    return [errorObject.message, errorObject.code, errorObject.type]
      .filter((part): part is string => typeof part === "string" && Boolean(part.trim()))
      .join(" ");
  }
  return "";
}

async function buildWebResearchContext(input: { mode: Draft["mode"]; prompt: string; sourceText?: string }) {
  try {
    return await buildNativeWebResearchContext(input);
  } catch (error) {
    console.warn("[ai] web research failed:", describeErrorForLog(error));
    return buildWebResearchFailureContext(error);
  }
}

function buildWebResearchFailureContext(error: unknown) {
  const reason = summarizeWebResearchFailure(error);

  return [
    `联网资料：模型联网暂时不可用${reason ? `，${reason}` : ""}。`,
    "写作处理：不要硬编最新事实，先按已有风格、原文和用户要求继续完成成稿。",
    "如果这条内容必须追热点、价格或具体型号，请让用户补一个链接、品牌型号，或者更具体的关键词后再试。"
  ].join("\n");
}

function summarizeWebResearchFailure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  if (/524\b|响应超时|a timeout occurred|timeout|UND_ERR_CONNECT_TIMEOUT|UND_ERR_HEADERS_TIMEOUT|ETIMEDOUT|Connect Timeout/i.test(message)) {
    return "模型联网搜索超时";
  }
  if (/fetch failed|SocketError|ECONNRESET|ECONNREFUSED/i.test(message)) {
    return "模型联网搜索没连上";
  }
  if (/ENOTFOUND|EAI_AGAIN|DNS/i.test(message)) {
    return "模型联网搜索域名解析失败";
  }
  if (/429\b|rate limit/i.test(message)) {
    return "模型联网搜索被限流";
  }
  if (/401\b|403\b|unauthorized|forbidden/i.test(message)) {
    return "模型联网搜索鉴权异常";
  }
  if (/原生联网搜索未返回可用结果/.test(message)) return "没有返回可用资料";
  return "";
}

async function buildNativeWebResearchContext(input: { mode: Draft["mode"]; prompt: string; sourceText?: string }) {
  const researchTask =
    input.mode === "topic"
      ? `请围绕这个写作主题联网检索最新事实，并整理成写作参考：\n${input.prompt}`
      : `请围绕这次改写任务联网检索相关最新事实，并整理成写作参考。\n改写要求：${input.prompt}\n\n原文：\n${input.sourceText || ""}`;

  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        "你是中文写作研究助手。请使用联网搜索工具查找与任务直接相关的最新事实，优先采用权威来源。输出必须使用中文纯文本，结构固定为：检索结论、关键信息、来源。若信息不足，明确写出“信息不足”。"
    },
    {
      role: "user",
      content: `${researchTask}\n\n要求：\n1. 只整理和写作任务强相关的信息。\n2. 每条信息尽量带上日期或时间线索。\n3. 来源部分列出站点名和链接。\n4. 不要直接写成成稿文案。`
    }
  ];

  const result = await withWebResearchTimeout((signal) =>
    streamResponseText({
      messages,
      reasoningEffort: "medium",
      tools: [{ type: "web_search" }],
      maxOutputTokens: WEB_RESEARCH_MAX_OUTPUT_TOKENS,
      signal,
      onDelta() {
        // Consume the Responses stream so long web searches do not sit behind an idle proxy connection.
      }
    })
  );

  if (result.fallback || !result.text.trim()) {
    throw new Error(result.fallbackReason || "原生联网搜索未返回可用结果");
  }

  return `检索时间：${new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}\n检索方式：Responses API web_search\n${result.text.trim()}`;
}

async function withWebResearchTimeout<T>(run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WEB_RESEARCH_TIMEOUT_MS);

  try {
    return await run(controller.signal);
  } catch (error) {
    if (controller.signal.aborted && !(error instanceof StreamResponseTextError && error.partialText.trim())) {
      throw new Error(`模型联网搜索超时（超过 ${Math.round(WEB_RESEARCH_TIMEOUT_MS / 1000)} 秒）`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function describeErrorForLog(error: unknown) {
  if (!(error instanceof Error)) return String(error || "");
  const cause = error.cause;
  const causeDetail =
    cause instanceof Error
      ? ` cause=${cause.name}: ${cause.message}${(cause as { code?: string }).code ? ` code=${(cause as { code?: string }).code}` : ""}`
      : "";
  return `${error.name}: ${error.message}${causeDetail}`;
}

export async function prepareAccountStyleContext(platform: Platform, accountId: string): Promise<PreparedAccountStyleContext> {
  const account = await resolveAccount(platform, accountId);
  const samples = await getTopTranscriptSamples(platform, accountId, 8);

  if (!samples.length) {
    throw new Error("这个账号还没有可用于总结的转写稿");
  }

  const corpus = samples
    .map(
      ({ video, transcript }, index) =>
        `样本 ${index + 1}｜${video.title}\n播放:${video.stats.views} 点赞:${video.stats.likes}\n${clampText(
          transcript,
          2200
        )}`
    )
    .join("\n\n---\n\n");

  const fallback = buildFallbackStyle(account.name, corpus);
  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        "你是短视频账号风格分析师。请根据爆款转写稿，提炼可复用的中文文案风格卡。输出 Markdown，结构必须包含：内容定位、开头方式、句式与节奏、常用话术、叙事结构、结尾 CTA、写作禁忌。结论要具体贴合样本，不要输出泛泛模板。"
    },
    {
      role: "user",
      content: `账号：${account.name}\n平台：${platform}\n\n爆款样本：\n${corpus}`
    }
  ];

  return {
    platform,
    accountId,
    accountName: account.name,
    messages,
    fallback
  };
}

export async function completePreparedAccountStyle(
  context: PreparedAccountStyleContext,
  result: ChatCompletionResult
) {
  const style = result.text || context.fallback;
  await saveStyle(context.platform, context.accountId, style);
  return { style, fallback: result.fallback, usedModel: result.model, fallbackReason: result.fallbackReason };
}

export async function generateStyleProfile(platform: Platform, accountId: string) {
  const context = await prepareAccountStyleContext(platform, accountId);
  const result = await completeStyleGeneration(context.messages);
  return completePreparedAccountStyle(context, result);
}

export async function generateProjectStyleProfile(projectId: string) {
  const project = await resolveProject(projectId);
  if (!project.sourceAccountIds.length) {
    throw new Error("这个项目还没有绑定参考账号");
  }

  const accountContexts = await Promise.all(
    project.sourceAccountIds.map(async (sourceAccountId) => {
      const [platform] = sourceAccountId.split(":") as [Platform, string];
      const account = await resolveAccount(platform, sourceAccountId);
      const style = await fs
        .readFile(path.join(libraryRoot(), platform, account.slug, "style.md"), "utf8")
        .catch(() => "");
      const samples = await getTopTranscriptSamples(platform, sourceAccountId, 3);
      return {
        account,
        style,
        samples
      };
    })
  );

  const corpus = accountContexts
    .map(({ account, style, samples }) => {
      const transcriptBlock = samples
        .map(
          ({ video, transcript }, index) =>
            `样本 ${index + 1}｜${video.title}\n${clampText(transcript, 1600)}`
        )
        .join("\n\n");
      return `参考账号：${account.name}｜${account.platform}\n\n账号风格卡：\n${clampText(
        style,
        2200
      )}\n\n爆款样本：\n${transcriptBlock || "暂无转写样本"}`;
    })
    .join("\n\n---\n\n");

  const fallback = buildFallbackStyle(project.name, corpus);
  const result = await completeStyleGeneration([
    {
      role: "system",
      content:
        "你是项目级中文短视频风格策略师。请把多个账号的风格卡和爆款转写稿融合成一个可执行的项目风格卡。输出 Markdown，结构必须包含：项目定位、适合选题、开头方式、句式与节奏、常用话术、叙事结构、结尾 CTA、写作禁忌。结论要具体贴合参考账号，不要输出泛泛模板。"
    },
    {
      role: "user",
      content: `项目：${project.name}\n项目说明：${project.description || "暂无"}\n\n参考素材：\n${corpus}`
    }
  ]);

  const style = result.text || fallback;
  await saveProjectStyle(projectId, style);
  return { style, fallback: result.fallback, usedModel: result.model, fallbackReason: result.fallbackReason };
}

export async function saveAndGenerateProjectStyleProfile(
  input: SaveAndGenerateProjectStyleInput
): Promise<ProjectStyleGenerationResult> {
  if (!input.sourceAccountIds.length) {
    throw new Error("请至少选择一个参考账号后再总结项目风格");
  }

  await assertProjectSourceAccountsExist(input.sourceAccountIds);
  const project = await upsertProject(input);
  const result = await generateProjectStyleProfile(project.id);
  const summary = await getProjectSummary(project);

  return {
    project: summary,
    style: result.style,
    fallback: result.fallback,
    usedModel: result.usedModel,
    fallbackReason: result.fallbackReason
  };
}

export async function writeCopy(input: WriteCopyInput): Promise<WriteResult> {
  const prepared = await prepareWriteCopyContext(input);
  const result = await chatCompleteWithFallback(prepared.messages);
  const content = result.text || buildFallbackCopy(prepared.fallbackName, prepared.fallbackStyle, prepared.fallbackInput);
  const draft = await savePreparedDraft(input, prepared, content);

  return {
    content,
    research: prepared.research,
    draft,
    usedModel: result.model,
    fallback: result.fallback,
    fallbackReason: result.fallbackReason
  };
}

export async function completePreparedWriteCopy(input: {
  prepared: PreparedWriteContext;
  result: ChatCompletionResult;
  save?: boolean;
}): Promise<WriteResult> {
  const content =
    input.result.text ||
    buildFallbackCopy(
      input.prepared.fallbackName,
      input.prepared.fallbackStyle,
      input.prepared.fallbackInput
    );
  const draft = await savePreparedDraft({ save: input.save }, input.prepared, content);

  return {
    content,
    research: input.prepared.research,
    draft,
    usedModel: input.result.model,
    fallback: input.result.fallback || !input.result.text.trim(),
    fallbackReason:
      input.result.fallbackReason ||
      (!input.result.text.trim() ? "模型没有返回可用内容，已自动切换到本地模板。" : undefined)
  };
}

export async function prepareWriteCopyContext(input: WriteCopyInput): Promise<PreparedWriteContext> {
  const normalizedInput = await normalizeWriteCopyInput(input);

  if (normalizedInput.targetType === "project" || normalizedInput.projectId) {
    return prepareProjectWriteContext(normalizedInput);
  }

  if (!normalizedInput.platform || !normalizedInput.accountId) {
    throw new Error("请选择参考账号");
  }

  const account = await resolveAccount(normalizedInput.platform, normalizedInput.accountId);
  const style = await fs.readFile(path.join(libraryRoot(), normalizedInput.platform, account.slug, "style.md"), "utf8");
  const samples = await getTopTranscriptSamples(normalizedInput.platform, normalizedInput.accountId, 3);
  const sampleContext = samples
    .map(({ video, transcript }) => `《${video.title}》\n${clampText(transcript, 1200)}`)
    .join("\n\n---\n\n");

  const userTask =
    normalizedInput.mode === "topic"
      ? `请基于这个主题生成文案：\n${normalizedInput.prompt}`
      : `请按账号风格改写下面文案。改写要求：${normalizedInput.prompt}\n\n原文素材：\n${normalizedInput.sourceText || ""}`;
  const webContext = normalizedInput.useWebResearch ? await buildWebResearchContext(normalizedInput) : "未启用联网检索。";

  return {
    messages: [
      {
        role: "system",
        content:
          "你是中文短视频文案助手。严格参考给定账号风格卡和样本话术，但不要照抄原转写稿。只有在联网检索资料明确启用并提供结果时，才基于资料写最新事实；资料不足时说明需要用户补充更明确关键词。输出可以直接使用的成稿，必要时给出标题、正文、口播节奏和结尾互动。"
      },
      {
        role: "user",
        content: `参考账号：${account.name}\n平台：${normalizedInput.platform}\n\n风格卡：\n${style}\n\n代表样本：\n${sampleContext || "暂无样本，仅参考风格卡。"}\n\n联网检索资料：\n${webContext}\n\n任务：\n${userTask}`
      }
    ],
    fallbackName: account.name,
    fallbackStyle: style,
    fallbackInput: normalizedInput,
    research: normalizedInput.useWebResearch ? webContext : undefined,
    draftBase: {
      platform: normalizedInput.platform,
      accountId: normalizedInput.accountId,
      accountName: account.name,
      title: makeTitleFromPrompt(normalizedInput.prompt),
      mode: normalizedInput.mode,
      prompt: normalizedInput.prompt,
      input: normalizedInput.sourceText,
      styleRef: {
        platform: normalizedInput.platform,
        accountId: normalizedInput.accountId,
        accountName: account.name,
        videoIds: samples.map((sample) => sample.video.id)
      }
    }
  };
}

async function prepareProjectWriteContext(input: WriteCopyInput): Promise<PreparedWriteContext> {
  if (!input.projectId) {
    throw new Error("请选择参考项目");
  }

  const project = await resolveProject(input.projectId);
  const style = await fs.readFile(path.join(libraryRoot(), "projects", project.slug, "style.md"), "utf8");

  const accountContexts = await Promise.all(
    project.sourceAccountIds.slice(0, 4).map(async (sourceAccountId) => {
      const [platform] = sourceAccountId.split(":") as [Platform, string];
      const account = await resolveAccount(platform, sourceAccountId);
      const samples = await getTopTranscriptSamples(platform, sourceAccountId, 2);
      return {
        account,
        samples
      };
    })
  );

  const sampleContext = accountContexts
    .map(({ account, samples }) => {
      const block = samples
        .map(({ video, transcript }) => `《${video.title}》\n${clampText(transcript, 900)}`)
        .join("\n\n");
      return `参考账号：${account.name}\n${block || "暂无样本"}`;
    })
    .join("\n\n---\n\n");
  const materialContext = await buildProjectCopySourceContext(project.sourceMaterialIds || []);
  const referenceContext = [sampleContext, materialContext].filter(Boolean).join("\n\n---\n\n");

  const userTask =
    input.mode === "topic"
      ? `请基于这个主题生成文案：\n${input.prompt}`
      : `请按项目风格改写下面文案。改写要求：${input.prompt}\n\n原文素材：\n${input.sourceText || ""}`;
  const webContext = input.useWebResearch ? await buildWebResearchContext(input) : "未启用联网检索。";

  return {
    messages: [
      {
        role: "system",
        content:
          "你是中文短视频文案助手。严格参考给定项目风格卡和样本话术，但不要照抄原转写稿。只有在联网检索资料明确启用并提供结果时，才基于资料写最新事实；资料不足时说明需要用户补充更明确关键词。输出可以直接使用的成稿，必要时给出标题、正文、口播节奏和结尾互动。"
      },
      {
        role: "user",
        content: `参考项目：${project.name}\n项目说明：${project.description || "暂无"}\n\n项目风格卡：\n${style}\n\n代表样本：\n${referenceContext || "暂无样本，仅参考风格卡。"}\n\n联网检索资料：\n${webContext}\n\n任务：\n${userTask}`
      }
    ],
    fallbackName: project.name,
    fallbackStyle: style,
    fallbackInput: {
      mode: input.mode,
      prompt: input.prompt,
      sourceText: input.sourceText
    },
    research: input.useWebResearch ? webContext : undefined,
    draftBase: {
      targetType: "project",
      projectId: project.id,
      projectName: project.name,
      title: makeTitleFromPrompt(input.prompt),
      mode: input.mode,
      prompt: input.prompt,
      input: input.sourceText,
      styleRef: {
        projectId: project.id,
        projectName: project.name,
        sourceAccountIds: project.sourceAccountIds,
        sourceMaterialIds: project.sourceMaterialIds
      }
    }
  };
}

async function buildProjectCopySourceContext(sourceIds: string[]) {
  if (!sourceIds.length) return "";
  const sources = await Promise.all(sourceIds.slice(0, 8).map((sourceId) => resolveCopySource(sourceId).catch(() => null)));

  return sources
    .filter(Boolean)
    .map((source, index) => {
      if (!source) return "";
      return `文案素材 ${index + 1}｜${source.title}\n平台：${source.platform}\n来源：${source.url}\n${clampText(source.transcript, 1400)}`;
    })
    .filter(Boolean)
    .join("\n\n");
}

async function normalizeWriteCopyInput(input: WriteCopyInput): Promise<WriteCopyInput> {
  const prompt = normalizeRewritePrompt(input.mode, input.prompt, input.sourceText);

  if (input.mode !== "rewrite") {
    return {
      ...input,
      prompt
    };
  }

  const sourceText = await normalizeRewriteSourceText(input.sourceText || "");

  return {
    ...input,
    prompt,
    sourceText
  };
}

async function normalizeRewriteSourceText(sourceText: string) {
  const trimmed = sourceText.trim();
  if (!trimmed || isNormalizedMaterialText(trimmed)) return trimmed;
  return (await resolveRewriteSourceMaterial(trimmed)).normalizedText || trimmed;
}

function isNormalizedMaterialText(sourceText: string) {
  return /^素材\s*\d+\s*[：:]/m.test(sourceText);
}

async function savePreparedDraft(
  input: Pick<WriteCopyInput, "save">,
  prepared: PreparedWriteContext,
  content: string
) {
  if (!input.save || !prepared.draftBase) return undefined;
  return saveDraft({ ...prepared.draftBase, content } as AccountDraftInput | ProjectDraftInput);
}

async function assertProjectSourceAccountsExist(sourceAccountIds: string[]) {
  const uniqueIds = [...new Set(sourceAccountIds)].filter(Boolean);

  for (const sourceAccountId of uniqueIds) {
    const [platform] = sourceAccountId.split(":") as [Platform, string];
    if (!platforms.includes(platform)) {
      throw new Error(`参考账号格式不正确：${sourceAccountId}`);
    }

    await resolveAccount(platform, sourceAccountId);
  }
}

function buildFallbackStyle(accountName: string, corpus: string) {
  const shortCorpus = corpus.replace(/\s+/g, " ").slice(0, 500);
  return `# ${accountName} 风格卡

## 内容定位
- 根据现有爆款转写稿，围绕账号已验证的话题与表达方式输出。

## 开头方式
- 先抛出明确判断或问题，用一句话制造继续看的理由。

## 句式与节奏
- 短句优先，观点先行，再用例子或细节补足。
- 每段只推进一个信息点，避免长铺垫。

## 常用话术
- “你会发现...”
- “真正关键的是...”
- “这件事别只看表面...”

## 叙事结构
- 钩子开头 → 场景/问题 → 关键观点 → 具体展开 → 结尾互动。

## 结尾 CTA
- 用一个低门槛问题引导评论或收藏。

## 写作禁忌
- 不要照搬原文。
- 不要堆砌抽象形容词。

## 样本线索
${shortCorpus || "- 暂无可提取线索。"}
`;
}

function buildFallbackCopy(
  accountName: string,
  style: string,
  input: { mode: Draft["mode"]; prompt: string; sourceText?: string }
) {
  const task = input.mode === "topic" ? input.prompt : input.sourceText || input.prompt;
  return `标题：${task.slice(0, 26)}

开头：
你可能也遇到过这个问题：${task}

正文：
先别急着下结论。真正影响结果的，往往不是表面那个动作，而是背后的判断方式。

第一，把问题拆小。先看它到底卡在目标、素材、表达，还是执行节奏。
第二，找到一个可复用的参照。像「${accountName}」这类账号，核心不是某一句话术，而是它每次都能快速建立场景、给出判断，再把观众带到一个具体行动。
第三，落到一个明确动作。不要泛泛地说“提升质量”，而是直接写出下一步要做什么。

结尾：
如果你也在做类似内容，可以先从这个角度改一版，效果通常会更清楚。

参考风格摘要：
${style.slice(0, 500)}`;
}
