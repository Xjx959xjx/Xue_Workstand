import { promises as fs } from "fs";
import path from "path";
import type { Response as UndiciResponse } from "undici";
import {
  AccountDraftInput,
  Draft,
  Platform,
  CopySource,
  ProjectDraftInput,
  ProjectSummary,
  WriteBriefResult,
  WriteResult,
  WriteSourceDigest,
  platforms
} from "./types";
import { clampText, makeTitleFromPrompt, nowIso, shortHash } from "./utils";
import { fetchFeishuSupportDocuments, hasFeishuDocLink } from "./feishu";
import { openCliRows, parseOpenCliJsonish, runOpenCli, stringField } from "./opencli-runtime";
import {
  getTopTranscriptSamples,
  getProjectSummary,
  resolveCopySource,
  libraryRoot,
  readAccountStyleSampleAnalysis,
  readAccountStyleMeta,
  readCopySourceStyleAnalysis,
  readProjectStyle,
  readProjectStyleMeta,
  readStyle,
  resolveAccount,
  resolveProject,
  saveDraft,
  saveAccountStyleSampleAnalysis,
  saveAccountStyleMeta,
  saveCopySourceStyleAnalysis,
  saveProjectStyleMeta,
  saveProjectStyle,
  saveStyle,
  upsertProject,
  type StyleSampleAnalysisCache
} from "./storage";
import { extractRewriteSourceMaterial, normalizeRewritePrompt } from "./source-extraction";
import { resolveRewriteSourceMaterial } from "./source-transcription";
import {
  buildChatFallbackReason,
  chatCompletionPayload,
  classifyModelFailure,
  getConfiguredChatConfigs,
  getChatConfig,
  getChatRuntimeConfig as getModelRuntimeConfig,
  postModelRequest,
  responseReasoning,
  shouldRetryResponsesAsChatCompletions,
  summarizeChatErrorBody,
  type ChatRuntimeConfig,
  type ChatReasoningEffort,
  type ChatTool,
  type ModelErrorKind
} from "./model-runtime";

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type { ChatReasoningEffort, ChatWireApi, ModelErrorKind } from "./model-runtime";
type ChatRequestOptions = {
  signal?: AbortSignal;
  maxOutputTokens?: number;
};

type StyleSampleFingerprint = {
  videoId: string;
  hash: string;
};
export type ChatCompletionResult = {
  text: string;
  model: string;
  fallback: boolean;
  fallbackReason?: string;
  ok: boolean;
  wireApi?: string;
  reasoningEffort?: string;
  requestedServiceTier?: string;
  actualServiceTier?: string;
  errorKind?: ModelErrorKind;
  userMessage?: string;
  rawErrorMessage?: string;
  usedTools?: string[];
};

export type WriteCopyInput = {
  platform?: Platform;
  accountId?: string;
  targetType?: "account" | "project";
  projectId?: string;
  mode: Draft["mode"];
  prompt: string;
  sourceText?: string;
  supportDocLinks?: string;
  brief?: string;
  save?: boolean;
  useWebResearch?: boolean;
};

export type PreparedWriteContext = {
  messages: ChatMessage[];
  fallbackName: string;
  fallbackStyle: string;
  fallbackInput: { mode: Draft["mode"]; prompt: string; sourceText?: string };
  brief: string;
  briefFallback: boolean;
  briefFallbackReason?: string;
  briefModel: string;
  research?: string;
  sourceDigest: WriteSourceDigest;
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
  cached?: boolean;
  generationMode?: "full" | "cached";
  sampleHash?: string;
  analysisCount?: number;
  analysisGeneratedCount?: number;
  analysisCachedCount?: number;
  analysisConcurrency?: number;
  inputChars?: number;
  firstDeltaMs?: number;
  totalMs?: number;
  wireApi?: string;
  reasoningEffort?: string;
  requestedServiceTier?: string;
  actualServiceTier?: string;
};

export type MaterialFrameAnalysis = {
  summary: string;
  visualNotes?: string;
  structureNotes?: string;
  titleNotes?: string;
  fallbackReason?: string;
};

export type PreparedAccountStyleContext = {
  platform: Platform;
  accountId: string;
  accountName: string;
  messages: ChatMessage[];
  fallback: string;
  sampleHash: string;
  sampleFingerprints: StyleSampleFingerprint[];
  sampleVideoIds: string[];
  generationMode: "full" | "incremental";
  analysisStats: StyleAnalysisStats;
  cachedStyle?: string;
  cachedFallback?: boolean;
  cachedFallbackReason?: string;
};

export type AccountStyleGenerationResult = {
  style: string;
  fallback: boolean;
  usedModel: string;
  fallbackReason?: string;
  cached?: boolean;
  generationMode?: "full" | "incremental" | "cached";
  sampleHash?: string;
  analysisCount?: number;
  analysisGeneratedCount?: number;
  analysisCachedCount?: number;
  analysisConcurrency?: number;
  inputChars?: number;
  firstDeltaMs?: number;
  totalMs?: number;
  wireApi?: string;
  reasoningEffort?: string;
  requestedServiceTier?: string;
  actualServiceTier?: string;
};

const STYLE_MAX_OUTPUT_TOKENS = 3200;
const STYLE_REASONING_EFFORT: ChatReasoningEffort = "xhigh";
const STYLE_SAMPLE_ANALYSIS_CONCURRENCY = 8;
const STYLE_SAMPLE_ANALYSIS_PROMPT_VERSION = 2;
const STYLE_SAMPLE_ANALYSIS_MAX_OUTPUT_TOKENS = 1200;
const WRITE_BRIEF_REASONING_EFFORT: ChatReasoningEffort = "medium";
export const WRITE_COPY_REASONING_EFFORT: ChatReasoningEffort = "medium";
export const WRITE_COPY_MAX_OUTPUT_TOKENS = 2600;
const WRITE_BRIEF_MAX_OUTPUT_TOKENS = 1400;
const WRITE_ACCOUNT_SAMPLE_LIMIT = 8;
const WRITE_PROJECT_SAMPLE_LIMIT_PER_ACCOUNT = 4;
const WRITE_SAMPLE_TRANSCRIPT_MAX_CHARS = 4200;
const WRITE_PROJECT_MATERIAL_MAX_CHARS = 4200;
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

function chatConfig() {
  return getChatConfig();
}

export function getChatRuntimeConfig() {
  return getModelRuntimeConfig();
}

function configuredChatConfigs() {
  return getConfiguredChatConfigs();
}

function firstRunnableChatModel() {
  return configuredChatConfigs()[0]?.model || chatConfig().model || "local-fallback";
}

export async function chatComplete(
  messages: ChatMessage[],
  reasoningEffort?: ChatReasoningEffort,
  options: ChatRequestOptions = {}
): Promise<ChatCompletionResult> {
  return chatCompleteWithFallback(messages, reasoningEffort, undefined, options);
}

export async function chatCompleteStrict(
  messages: ChatMessage[],
  reasoningEffort?: ChatReasoningEffort,
  options: ChatRequestOptions = {}
): Promise<ChatCompletionResult> {
  throwIfAborted(options.signal);
  const configs = configuredChatConfigs();
  if (!configs.length) {
    throw new Error("未配置对话模型，请先配置 CHAT_API_KEY / OPENAI_API_KEY、CHAT_BASE_URL 和 CHAT_MODEL 后再生成。");
  }

  let lastError: unknown;
  for (const config of configs) {
    try {
      return await chatCompleteWithConfig(config, messages, reasoningEffort, undefined, options);
    } catch (error) {
      if (isAbortError(error)) throw error;
      lastError = error;
    }
  }

  throw new Error(formatStrictChatError(lastError));
}

function formatStrictChatError(error: unknown) {
  const failure = error
    ? classifyModelFailure(error)
    : {
        kind: "unknown" as const,
        userMessage: "对话模型暂时不可用",
        rawMessage: "unknown model error"
      };
  return `${failure.userMessage}，此功能不会切到本地模板。${strictChatFailureAction(failure.kind)}`;
}

function strictChatFailureAction(kind: ModelErrorKind) {
  if (kind === "not_configured") return "请配置 CHAT_API_KEY / OPENAI_API_KEY、CHAT_BASE_URL 和 CHAT_MODEL。";
  if (kind === "auth") return "请检查 CHAT_API_KEY / OPENAI_API_KEY；如果使用备用模型，也检查 CHAT_FALLBACK_API_KEY / FHL_API_KEY。";
  if (kind === "quota") return "请检查模型额度是否不足，必要时补余额或切换到可用的备用对话模型。";
  if (kind === "endpoint") return "请检查 CHAT_BASE_URL、CHAT_WIRE_API、CHAT_RESPONSES_URL 或 CHAT_COMPLETIONS_URL。";
  if (kind === "network") return "请检查网络、中转站地址和 CHAT_PROXY_URL。";
  if (kind === "rate_limit") return "可以稍后重试，或先把 ENGAGEMENT_MODEL_CONCURRENCY 调低。";
  if (kind === "timeout") return "可以稍后重试，或先把 ENGAGEMENT_MODEL_CONCURRENCY 调低。";
  if (kind === "server") return "请稍后重试，或切换到可用的备用对话模型。";
  if (kind === "parse" || kind === "empty") return "请重试或切换到更稳定的对话模型。";
  return "请检查对话模型配置后再重试。";
}

export async function analyzeMaterialFrames(input: {
  frames: string[];
  platform: Platform | "unknown";
  title?: string;
  transcript: string;
  url: string;
  signal?: AbortSignal;
}): Promise<MaterialFrameAnalysis> {
  const configs = configuredChatConfigs();
  if (!configs.length) {
    throw new Error("未配置对话模型，无法生成原视频画面描述。");
  }

  const prompt = [
    "请把这条短视频整理成“转写 + 画面描述”的素材底稿，输出严格 JSON。",
    "不要写观点摘要，不要写营销总结，不要把内容概括成一句话。",
    "只基于图片里能看到的内容和提供的标题/转写，不要补脑未出现的细节。",
    "必须包含字段：visualNotes、structureNotes、titleNotes。",
    "visualNotes 是核心字段，要按画面出现顺序描述实际看见的场景、人物、UI、字幕、道具、价格、动作、特效；写成可供后续剪辑/仿写参考的画面描述。",
    "structureNotes 只描述镜头顺序、字幕节奏和信息推进，不要评价好坏。",
    "titleNotes 只描述标题/封面/首帧可见钩子。",
    '返回格式必须类似：{"visualNotes":"按顺序写画面描述","structureNotes":"镜头和信息推进","titleNotes":"标题/封面/首帧钩子"}',
    `平台：${input.platform}`,
    `标题：${input.title || "暂无"}`,
    `链接：${input.url}`,
    `转写节选：${clampText(input.transcript, 900)}`
  ].join("\n");

  let lastError: unknown;
  for (const config of configs) {
    try {
      const text = config.wireApi === "chat_completions"
        ? await createVisionChatCompletion(config, prompt, input.frames, { signal: input.signal })
        : await createVisionWithResponseFallback(config, prompt, input.frames, { signal: input.signal });
      return ensureMaterialFrameAnalysisFields(parseMaterialFrameAnalysis(text));
    } catch (error) {
      if (isAbortError(error)) throw error;
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("模型没有返回画面描述结果");
}

export async function streamResponseText(input: {
  messages: ChatMessage[];
  reasoningEffort?: ChatReasoningEffort;
  tools?: ChatTool[];
  maxOutputTokens?: number;
  signal?: AbortSignal;
  onDelta: (delta: string) => void;
}) {
  throwIfAborted(input.signal);
  const configs = configuredChatConfigs();
  if (!configs.length) {
    return fallbackChatCompletion(firstRunnableChatModel());
  }

  let lastError: unknown;
  for (const config of configs) {
    try {
      return await streamResponseTextForConfig(config, input);
    } catch (error) {
      if (isAbortError(error) || error instanceof StreamResponseTextError) throw error;
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("对话模型暂时不可用");
}

async function streamResponseTextForConfig(
  config: ChatRuntimeConfig,
  input: {
    messages: ChatMessage[];
    reasoningEffort?: ChatReasoningEffort;
    tools?: ChatTool[];
    maxOutputTokens?: number;
    signal?: AbortSignal;
    onDelta: (delta: string) => void;
  }
) {
  if (hasWebSearchTool(input.tools) && config.wireApi === "chat_completions" && !supportsChatCompletionWebSearch(config.model)) {
    throw new Error("当前模型接口是 Chat Completions，不能使用 Responses web_search 工具");
  }

  if (config.wireApi === "chat_completions") {
    return streamChatCompletion(config, input);
  }

  try {
    return await streamResponseApi(config, input);
  } catch (error) {
    if (isAbortError(error)) throw error;
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
  config: ChatRuntimeConfig,
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
    tool_choice: input.tools?.length ? "required" : undefined,
    include: input.tools?.length ? ["web_search_call.action.sources"] : undefined,
    reasoning: responseReasoning(input.reasoningEffort || config.reasoningEffort),
    max_output_tokens: input.maxOutputTokens,
    service_tier: config.serviceTier || undefined,
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
  let actualServiceTier: string | undefined;
  const usedTools = new Set<string>();
  const requestedReasoningEffort = input.reasoningEffort || config.reasoningEffort;

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
        actualServiceTier = extractServiceTier(parsed) || actualServiceTier;
        collectResponseToolTypes(parsed, usedTools);

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
          actualServiceTier = extractServiceTier(parsed.response) || actualServiceTier;
          collectResponseToolTypes(parsed.response, usedTools);
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
    fallback: false,
    ok: true,
    wireApi: config.wireApi === "auto" ? "responses" : config.wireApi,
    reasoningEffort: requestedReasoningEffort,
    requestedServiceTier: config.serviceTier || undefined,
    actualServiceTier,
    usedTools: [...usedTools]
  } satisfies ChatCompletionResult;
}

async function streamChatCompletion(
  config: ChatRuntimeConfig,
  input: {
    messages: ChatMessage[];
    reasoningEffort?: ChatReasoningEffort;
    tools?: ChatTool[];
    maxOutputTokens?: number;
    signal?: AbortSignal;
    onDelta: (delta: string) => void;
  }
): Promise<ChatCompletionResult> {
  const webSearch = hasWebSearchTool(input.tools);
  const response = await postModelRequest(config, "/chat/completions", chatCompletionPayload({
    config,
    messages: input.messages,
    reasoningEffort: input.reasoningEffort,
    maxOutputTokens: input.maxOutputTokens,
    webSearch,
    stream: true
  }), input.signal);

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("模型服务没有返回可读取的流式内容");
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let aggregatedText = "";
  let actualServiceTier: string | undefined;
  const requestedReasoningEffort = input.reasoningEffort || config.chatCompletionReasoningEffort;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop() || "";

      for (const rawEvent of events) {
        const event = parseChatCompletionStreamEvent(rawEvent);
        actualServiceTier = event.serviceTier || actualServiceTier;
        if (event.delta) {
          aggregatedText += event.delta;
          input.onDelta(event.delta);
        }
      }
    }

    const remaining = parseChatCompletionStreamEvent(buffer);
    actualServiceTier = remaining.serviceTier || actualServiceTier;
    if (remaining.delta) {
      aggregatedText += remaining.delta;
      input.onDelta(remaining.delta);
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
    fallback: false,
    ok: true,
    wireApi: "chat_completions",
    reasoningEffort: requestedReasoningEffort,
    requestedServiceTier: config.serviceTier || undefined,
    actualServiceTier,
    usedTools: webSearch ? ["web_search"] : undefined
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
  throwIfAborted(input.signal);
  try {
    return await streamResponseText(input);
  } catch (error) {
    if (isAbortError(error)) throw error;
    if (error instanceof StreamResponseTextError && error.partialText.trim()) {
      const failure = classifyModelFailure(error);
      return {
        text: error.partialText.trim(),
        model: firstRunnableChatModel(),
        fallback: true,
        fallbackReason: `${failure.userMessage}，已保留模型已生成的内容，请检查后再使用。`,
        ok: false,
        reasoningEffort: input.reasoningEffort,
        errorKind: failure.kind,
        userMessage: failure.userMessage,
        rawErrorMessage: failure.rawMessage
      };
    }
    try {
      return await chatCompleteWithEffort(input.messages, input.reasoningEffort, input.tools, {
        signal: input.signal
      });
    } catch (retryError) {
      if (isAbortError(retryError)) throw retryError;
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
  const configs = configuredChatConfigs();
  if (!configs.length) {
    return fallbackChatCompletion(firstRunnableChatModel());
  }

  let lastError: unknown;
  for (const config of configs) {
    try {
      return await chatCompleteWithConfig(config, messages, reasoningEffort, tools, options);
    } catch (error) {
      if (isAbortError(error)) throw error;
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("对话模型暂时不可用");
}

async function chatCompleteWithConfig(
  config: ChatRuntimeConfig,
  messages: ChatMessage[],
  reasoningEffort?: ChatReasoningEffort,
  tools?: ChatTool[],
  options: ChatRequestOptions = {}
): Promise<ChatCompletionResult> {
  if (hasWebSearchTool(tools) && config.wireApi === "chat_completions" && !supportsChatCompletionWebSearch(config.model)) {
    throw new Error("当前模型接口是 Chat Completions，不能使用 Responses web_search 工具");
  }

  if (config.wireApi === "chat_completions") {
    return createChatCompletion(config, messages, reasoningEffort, tools, options);
  }

  try {
    return await createResponse(config, messages, reasoningEffort, tools, options);
  } catch (error) {
    if (!tools?.length && (config.wireApi === "auto" || shouldRetryResponsesAsChatCompletions(error))) {
      return createChatCompletion(config, messages, reasoningEffort, tools, options);
    }
    throw error;
  }
}

async function createChatCompletion(
  config: ChatRuntimeConfig,
  messages: ChatMessage[],
  reasoningEffort?: ChatReasoningEffort,
  tools?: ChatTool[],
  options: ChatRequestOptions = {}
): Promise<ChatCompletionResult> {
  const webSearch = hasWebSearchTool(tools);
  const response = await postModelRequest(config, "/chat/completions", chatCompletionPayload({
    config,
    messages,
    reasoningEffort,
    maxOutputTokens: options.maxOutputTokens,
    webSearch,
    stream: false
  }), options.signal);

  const parsed = await parseChatCompletionResponseBodyWithMeta(response);
  const requestedReasoningEffort = reasoningEffort || config.chatCompletionReasoningEffort;

  return {
    text: parsed.text,
    model: config.model,
    fallback: false,
    ok: true,
    wireApi: "chat_completions",
    reasoningEffort: requestedReasoningEffort,
    requestedServiceTier: config.serviceTier || undefined,
    actualServiceTier: parsed.serviceTier,
    usedTools: webSearch ? ["web_search"] : undefined
  };
}

function parseChatCompletionStreamEvent(rawEvent: string) {
  let delta = "";
  let serviceTier: string | undefined;
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

    serviceTier = extractServiceTier(parsed) || serviceTier;
    delta += extractChatCompletionDelta(parsed);
  }

  return { delta, serviceTier };
}

async function parseChatCompletionResponseBody(response: UndiciResponse) {
  return (await parseChatCompletionResponseBodyWithMeta(response)).text;
}

async function parseChatCompletionResponseBodyWithMeta(response: UndiciResponse) {
  const contentType = response.headers.get("content-type");
  const body = await response.text();

  if (contentType?.includes("text/event-stream") || looksLikeEventStreamBody(body)) {
    return parseChatCompletionEventStreamWithMeta(body);
  }

  const parsed = parseModelJsonBody(body, contentType);
  return {
    text: extractChatCompletionText(parsed),
    serviceTier: extractServiceTier(parsed)
  };
}

function parseChatCompletionEventStreamWithMeta(body: string) {
  let aggregatedText = "";
  let serviceTier: string | undefined;

  for (const rawEvent of body.split("\n\n")) {
    const event = parseChatCompletionStreamEvent(rawEvent);
    serviceTier = event.serviceTier || serviceTier;
    if (event.delta) aggregatedText += event.delta;
  }

  return {
    text: aggregatedText.trim(),
    serviceTier
  };
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
  config: ChatRuntimeConfig,
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
    tool_choice: tools?.length ? "required" : undefined,
    include: tools?.length ? ["web_search_call.action.sources"] : undefined,
    reasoning: responseReasoning(reasoningEffort || config.reasoningEffort),
    max_output_tokens: options.maxOutputTokens,
    service_tier: config.serviceTier || undefined,
    store: false
  }, options.signal);

  const parsed = await parseResponseApiBodyWithMeta(response);
  return {
    text: parsed.text,
    model: config.model,
    fallback: false,
    ok: true,
    wireApi: config.wireApi === "auto" ? "responses" : config.wireApi,
    reasoningEffort: reasoningEffort || config.reasoningEffort,
    requestedServiceTier: config.serviceTier || undefined,
    actualServiceTier: parsed.serviceTier,
    usedTools: parsed.usedTools
  };
}

async function createVisionWithResponseFallback(
  config: ChatRuntimeConfig,
  prompt: string,
  frames: string[],
  options: ChatRequestOptions = {}
) {
  try {
    return await createVisionResponse(config, prompt, frames, options);
  } catch (error) {
    if (config.wireApi === "auto" || shouldRetryResponsesAsChatCompletions(error)) {
      return createVisionChatCompletion(config, prompt, frames, options);
    }
    throw error;
  }
}

async function createVisionResponse(
  config: ChatRuntimeConfig,
  prompt: string,
  frames: string[],
  options: ChatRequestOptions = {}
) {
  const response = await postModelRequest(config, "/responses", {
    model: config.model,
    instructions: "你是短视频素材画面描述整理员。输出严格 JSON，不要 Markdown。",
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: prompt },
          ...frames.map((imageUrl) => ({ type: "input_image", image_url: imageUrl }))
        ]
      }
    ],
    reasoning: responseReasoning("low"),
    service_tier: config.serviceTier || undefined,
    store: false
  }, options.signal);
  return parseResponseApiBody(response);
}

async function createVisionChatCompletion(
  config: ChatRuntimeConfig,
  prompt: string,
  frames: string[],
  options: ChatRequestOptions = {}
) {
  const response = await postModelRequest(config, "/chat/completions", {
    model: config.model,
    messages: [
      {
        role: "system",
        content: "你是短视频素材画面描述整理员。输出严格 JSON，不要 Markdown。"
      },
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          ...frames.map((url) => ({ type: "image_url", image_url: { url } }))
        ]
      }
    ],
    max_tokens: 900
  }, options.signal);
  return parseChatCompletionResponseBody(response);
}

function fallbackChatCompletion(model = "local-fallback", error?: unknown): ChatCompletionResult {
  const failure = error
    ? classifyModelFailure(error)
    : {
        kind: "not_configured" as const,
        userMessage: "未配置对话模型",
        rawMessage: "CHAT_API_KEY / OPENAI_API_KEY is missing"
      };
  return {
    text: "",
    model,
    fallback: true,
    fallbackReason: error ? buildChatFallbackReason(error) : undefined,
    ok: false,
    reasoningEffort: undefined,
    errorKind: failure.kind,
    userMessage: failure.userMessage,
    rawErrorMessage: failure.rawMessage
  };
}

function parseMaterialFrameAnalysis(text: string): MaterialFrameAnalysis {
  const trimmed = text.trim();
  const jsonText = trimmed.match(/```json\s*([\s\S]*?)```/i)?.[1] || trimmed.match(/\{[\s\S]*\}/)?.[0] || trimmed;
  try {
    const parsed = JSON.parse(jsonText) as Record<string, unknown>;
    const visualNotes =
      readStringField(parsed, "visualNotes") ||
      readStringField(parsed, "visualDescription") ||
      readStringField(parsed, "sceneDescription") ||
      readStringField(parsed, "frameDescription");
    const structureNotes = readStringField(parsed, "structureNotes");
    const titleNotes = readStringField(parsed, "titleNotes") || readStringField(parsed, "coverNotes");
    const summary = readStringField(parsed, "summary") || visualNotes || [structureNotes, titleNotes].filter(Boolean).join("\n");
    if (!summary && !visualNotes) throw new Error("empty visual notes");
    return {
      summary,
      visualNotes: visualNotes || undefined,
      structureNotes: structureNotes || undefined,
      titleNotes: titleNotes || undefined
    };
  } catch {
    if (!trimmed) throw new Error("模型没有返回画面描述结果");
    return {
      summary: trimmed.slice(0, 1200),
      fallbackReason: "模型没有返回标准 JSON，已保存原始分析文本。"
    };
  }
}

function readStringField(object: Record<string, unknown>, key: string) {
  const value = object[key];
  return typeof value === "string" ? value.trim() : "";
}

function ensureMaterialFrameAnalysisFields(analysis: MaterialFrameAnalysis): MaterialFrameAnalysis {
  if (analysis.visualNotes || analysis.structureNotes || analysis.titleNotes) return analysis;

  const summary = analysis.summary.trim();
  return {
    ...analysis,
    visualNotes: bestSummarySentence(summary, /画面|场景|人物|字幕|道具|界面|截图|特效|镜头/) || summary,
    structureNotes: bestSummarySentence(summary, /镜头|剪辑|推进|开头|结尾|转场|通过/) || summary,
    titleNotes: bestSummarySentence(summary, /标题|封面|钩子|卖点|价格|商品|口播/) || summary,
    fallbackReason: analysis.fallbackReason || "模型只返回了一段画面文本，已作为画面描述保存。"
  };
}

function bestSummarySentence(summary: string, pattern: RegExp) {
  return (summary.match(/[^。！？!?]+[。！？!?]?/g) || [summary])
    .map((sentence) => sentence.trim())
    .find((sentence) => pattern.test(sentence));
}

async function chatCompleteWithFallback(
  messages: ChatMessage[],
  reasoningEffort?: ChatReasoningEffort,
  tools?: ChatTool[],
  options: ChatRequestOptions = {}
): Promise<ChatCompletionResult> {
  try {
    return await chatCompleteWithEffort(messages, reasoningEffort, tools, options);
  } catch (error) {
    if (isAbortError(error)) throw error;
    return fallbackChatCompletion("local-fallback", error);
  }
}

export function streamStyleResponseTextWithFallback(input: {
  messages: ChatMessage[];
  maxOutputTokens?: number;
  signal?: AbortSignal;
  onDelta: (delta: string) => void;
}) {
  return streamResponseTextWithFallback({
    messages: input.messages,
    reasoningEffort: STYLE_REASONING_EFFORT,
    maxOutputTokens: input.maxOutputTokens ?? STYLE_MAX_OUTPUT_TOKENS,
    signal: input.signal,
    onDelta: input.onDelta
  });
}

function completeStyleGeneration(messages: ChatMessage[], options: { signal?: AbortSignal } = {}) {
  return streamStyleResponseTextWithFallback({
    messages,
    signal: options.signal,
    onDelta() {
      // Keep the request streaming so upstream proxies do not close long style-generation calls.
    }
  });
}

function throwIfAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return;
  const error = new Error("任务已停止");
  error.name = "AbortError";
  throw error;
}

function isAbortError(error: unknown) {
  if (error instanceof StreamResponseTextError) return isAbortError(error.originalError);
  if (!(error instanceof Error)) return false;
  return error.name === "AbortError" || /任务已停止|aborted/i.test(error.message);
}

async function parseResponseApiBody(response: UndiciResponse) {
  return (await parseResponseApiBodyWithMeta(response)).text;
}

async function parseResponseApiBodyWithMeta(response: UndiciResponse) {
  const contentType = response.headers.get("content-type");
  const body = await response.text();

  if (contentType?.includes("text/event-stream") || looksLikeEventStreamBody(body)) {
    return parseResponseEventStreamWithMeta(body);
  }

  const parsed = parseModelJsonBody(body, contentType);
  const usedTools = new Set<string>();
  collectResponseToolTypes(parsed, usedTools);
  return {
    text: extractResponseText(parsed),
    serviceTier: extractServiceTier(parsed),
    usedTools: [...usedTools]
  };
}

function looksLikeEventStreamBody(body: string) {
  const trimmed = body.trimStart();
  return trimmed.startsWith("event:") || trimmed.startsWith("data:");
}

function parseResponseEventStreamWithMeta(body: string) {
  let aggregatedText = "";
  let serviceTier: string | undefined;
  const usedTools = new Set<string>();

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
      serviceTier = extractServiceTier(parsed) || serviceTier;
      collectResponseToolTypes(parsed, usedTools);

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
        serviceTier = extractServiceTier(parsed.response) || serviceTier;
        collectResponseToolTypes(parsed.response, usedTools);
      } else if (parsed.type === "response.failed" || parsed.type === "response.incomplete") {
        const errorMessage =
          extractResponseErrorMessage(parsed.response) || extractResponseErrorMessage(parsed) || "模型输出失败";
        throw new Error(errorMessage);
      }
    }
  }

  return {
    text: aggregatedText.trim(),
    serviceTier,
    usedTools: [...usedTools]
  };
}

function parseModelJsonBody(body: string, contentType?: string | null) {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    const detail = summarizeChatErrorBody(body, contentType);
    throw new Error(detail ? `模型服务返回了无法解析的内容：${detail}` : "模型服务返回了无法解析的内容");
  }
}

function hasWebSearchTool(tools?: ChatTool[]) {
  return Boolean(tools?.some((tool) => tool.type === "web_search"));
}

function supportsChatCompletionWebSearch(model: string) {
  return /(?:^|[-_])search(?:[-_]|$)|search-preview/i.test(model);
}

function collectResponseToolTypes(data: unknown, tools: Set<string>) {
  if (!data || typeof data !== "object") return;
  const object = data as Record<string, unknown>;
  const type = typeof object.type === "string" ? object.type : "";
  if (type === "web_search" || type === "web_search_preview" || type === "web_search_call") {
    tools.add("web_search");
  }
  if (/response\.web_search_call\./.test(type)) {
    tools.add("web_search");
  }
  if (object.response) collectResponseToolTypes(object.response, tools);
  if (object.item) collectResponseToolTypes(object.item, tools);
  if (object.part) collectResponseToolTypes(object.part, tools);
  if (Array.isArray(object.output)) {
    for (const item of object.output) collectResponseToolTypes(item, tools);
  }
  if (Array.isArray(object.content)) {
    for (const item of object.content) collectResponseToolTypes(item, tools);
  }
}

function extractResponseText(data: unknown): string {
  return extractResponseTextValue(data).trim();
}

function extractServiceTier(data: unknown): string | undefined {
  if (!data || typeof data !== "object") return undefined;
  const object = data as Record<string, unknown>;
  if (typeof object.service_tier === "string") return object.service_tier;
  if (object.response) return extractServiceTier(object.response);
  if (object.item) return extractServiceTier(object.item);
  if (object.part) return extractServiceTier(object.part);
  if (Array.isArray(object.output)) {
    for (const item of object.output) {
      const serviceTier = extractServiceTier(item);
      if (serviceTier) return serviceTier;
    }
  }
  if (Array.isArray(object.choices)) {
    for (const choice of object.choices) {
      const serviceTier = extractServiceTier(choice);
      if (serviceTier) return serviceTier;
    }
  }
  return undefined;
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

async function buildWebResearchContext(
  input: { mode: Draft["mode"]; prompt: string; sourceText?: string },
  options: { signal?: AbortSignal } = {}
) {
  throwIfAborted(options.signal);
  try {
    return await buildNativeWebResearchContext(input, options);
  } catch (error) {
    if (options.signal?.aborted) throw error;
    console.warn("[ai] web research failed:", describeErrorForLog(error));
    try {
      return await buildOpenCliWebResearchContext(input, error, options);
    } catch (openCliError) {
      if (options.signal?.aborted) throw openCliError;
      console.warn("[ai] opencli web research failed:", describeErrorForLog(openCliError));
      return buildWebResearchFailureContext(openCliError);
    }
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
  if (/402\b|insufficient[_\s-]*(?:user[_\s-]*)?quota|insufficient[_\s-]*balance|quota[_\s-]*exceeded|billing|payment[_\s-]*required|credit|余额|额度|预扣费|扣费/i.test(message)) {
    return "模型联网搜索额度不足";
  }
  if (/401\b|403\b|unauthorized|forbidden/i.test(message)) {
    return "模型联网搜索鉴权异常";
  }
  if (/没有获得可用联网搜索工具|没有联网搜索工具|未提供可用的联网搜索工具/i.test(message)) {
    return "模型没有获得 web_search 工具";
  }
  if (/模型没有实际调用 web_search 工具/.test(message)) {
    return "模型没有实际调用 web_search 工具";
  }
  if (/OpenCLI 本地搜索失败/i.test(message)) {
    return "本地 opencli 搜索失败";
  }
  if (/原生联网搜索未返回可用结果/.test(message)) return "没有返回可用资料";
  return "";
}

async function buildNativeWebResearchContext(
  input: { mode: Draft["mode"]; prompt: string; sourceText?: string },
  options: { signal?: AbortSignal } = {}
) {
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

  const result = await withWebResearchTimeout(
    (signal) =>
      streamResponseText({
        messages,
        reasoningEffort: "medium",
        tools: [{ type: "web_search" }],
        maxOutputTokens: WEB_RESEARCH_MAX_OUTPUT_TOKENS,
        signal,
        onDelta() {
          // Consume the Responses stream so long web searches do not sit behind an idle proxy connection.
        }
      }),
    options.signal
  );

  const text = result.text.trim();
  if (result.fallback || !text) {
    throw new Error(result.fallbackReason || "原生联网搜索未返回可用结果");
  }

  if (!result.usedTools?.includes("web_search")) {
    throw new Error("模型没有实际调用 web_search 工具");
  }

  if (isWebResearchToolUnavailableText(text)) {
    throw new Error("模型没有获得可用联网搜索工具");
  }

  return `检索时间：${new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}\n检索方式：Responses API web_search\n${text}`;
}

async function buildOpenCliWebResearchContext(
  input: { mode: Draft["mode"]; prompt: string; sourceText?: string },
  nativeError: unknown,
  options: { signal?: AbortSignal } = {}
) {
  throwIfAborted(options.signal);
  const query = buildOpenCliSearchQuery(input);
  if (!query) throw new Error("OpenCLI 本地搜索失败：缺少可搜索关键词");

  const stdout = await runOpenCli([
    "duckduckgo",
    "search",
    query,
    "--limit",
    "8",
    "--region",
    "cn-zh",
    "--window",
    "background",
    "-f",
    "json"
  ], {
    signal: options.signal,
    timeout: 60_000,
    timingStage: "web-research-opencli"
  });
  const results = normalizeOpenCliSearchResults(openCliRows(parseOpenCliJsonish(stdout))).slice(0, 8);
  if (!results.length) {
    throw new Error("OpenCLI 本地搜索失败：没有返回可用搜索结果");
  }

  return [
    `检索时间：${new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}`,
    "检索方式：opencli duckduckgo search",
    `原生 web_search 状态：不可用（${summarizeWebResearchFailure(nativeError) || describeShortError(nativeError)}）`,
    `搜索词：${query}`,
    "搜索结果：",
    ...results.map((result, index) =>
      [
        `${index + 1}. ${result.title}`,
        `来源：${result.displayUrl || result.url}`,
        `链接：${result.url}`,
        result.snippet ? `摘要：${result.snippet}` : ""
      ].filter(Boolean).join("\n")
    )
  ].join("\n\n");
}

function buildOpenCliSearchQuery(input: { mode: Draft["mode"]; prompt: string; sourceText?: string }) {
  const source = input.mode === "topic"
    ? input.prompt
    : [input.prompt, input.sourceText].filter(Boolean).join("\n");
  return clampText(source.replace(/https?:\/\/\S+/gi, " ").replace(/\s+/g, " ").trim(), 180);
}

function normalizeOpenCliSearchResults(rows: unknown[]) {
  return rows
    .map((row) => {
      const object = row && typeof row === "object" ? row as Record<string, unknown> : {};
      return {
        title: stringField(object.title),
        url: stringField(object.url),
        snippet: stringField(object.snippet),
        displayUrl: stringField(object.displayUrl)
      };
    })
    .filter((result) => result.title && /^https?:\/\//i.test(result.url));
}

function describeShortError(error: unknown) {
  if (error instanceof Error) return error.message.replace(/\s+/g, " ").slice(0, 180);
  return String(error || "未知错误").replace(/\s+/g, " ").slice(0, 180);
}

function isWebResearchToolUnavailableText(text: string) {
  const normalized = text.replace(/\s+/g, " ").slice(0, 1200);
  return [
    /当前对话环境未提供可用的联网搜索工具/,
    /没有(?:可用的)?联网搜索工具/,
    /无法(?:访问|连接)(?:互联网|外部网络|实时网络)/,
    /不能(?:联网|浏览网页|访问网页|搜索网络)/,
    /没有(?:浏览器|搜索|web_search|web search)(?:工具|权限|能力)/i
  ].some((pattern) => pattern.test(normalized));
}

async function withWebResearchTimeout<T>(run: (signal: AbortSignal) => Promise<T>, parentSignal?: AbortSignal): Promise<T> {
  throwIfAborted(parentSignal);
  const controller = new AbortController();
  const abort = () => controller.abort();
  parentSignal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(() => controller.abort(), WEB_RESEARCH_TIMEOUT_MS);

  try {
    return await run(controller.signal);
  } catch (error) {
    if (parentSignal?.aborted) throw error;
    if (controller.signal.aborted) {
      throw new Error(`模型联网搜索超时（超过 ${Math.round(WEB_RESEARCH_TIMEOUT_MS / 1000)} 秒）`);
    }
    throw error;
  } finally {
    parentSignal?.removeEventListener("abort", abort);
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

type AccountStyleSample = Awaited<ReturnType<typeof getTopTranscriptSamples>>[number];

function buildAccountStyleSampleState(samples: AccountStyleSample[]) {
  const sampleFingerprints = samples.map(({ video, transcript }) => ({
    videoId: video.id,
    hash: shortHash([
      video.id,
      video.title,
      transcript
    ].join("\n"))
  }));

  return {
    sampleFingerprints,
    sampleVideoIds: sampleFingerprints.map((sample) => sample.videoId),
    sampleHash: shortHash(JSON.stringify(sampleFingerprints))
  };
}

type StyleAnalysisStats = {
  analysisCount: number;
  analysisGeneratedCount: number;
  analysisCachedCount: number;
  analysisConcurrency: number;
  inputChars: number;
};

export type StyleAnalysisProgress = StyleAnalysisStats & {
  completedCount: number;
  currentTitle?: string;
};

type StyleCompletionTimings = {
  firstDeltaMs?: number;
  totalMs?: number;
};

type StyleAnalysisEntry = {
  kind: StyleSampleAnalysisCache["kind"];
  sourceId: string;
  title: string;
  groupId?: string;
  groupLabel?: string;
  inputChars: number;
  analysis: string;
  cacheKey: string;
};

type StyleAnalysisTask = {
  kind: StyleSampleAnalysisCache["kind"];
  sourceId: string;
  title: string;
  groupId?: string;
  groupLabel?: string;
  inputChars: number;
  cacheKey: string;
  readCache: () => Promise<StyleSampleAnalysisCache | null>;
  saveCache: (cache: StyleSampleAnalysisCache) => Promise<StyleSampleAnalysisCache>;
  messages: () => ChatMessage[];
};

type StylePreparationOptions = {
  signal?: AbortSignal;
  onAnalysisProgress?: (progress: StyleAnalysisProgress) => void;
};

const emptyStyleAnalysisStats = (): StyleAnalysisStats => ({
  analysisCount: 0,
  analysisGeneratedCount: 0,
  analysisCachedCount: 0,
  analysisConcurrency: STYLE_SAMPLE_ANALYSIS_CONCURRENCY,
  inputChars: 0
});

function accountStyleAnalysisCacheKey(sample: AccountStyleSample) {
  return shortHash(JSON.stringify({
    version: 1,
    promptVersion: STYLE_SAMPLE_ANALYSIS_PROMPT_VERSION,
    kind: "account-video",
    videoId: sample.video.id,
    title: sample.video.title,
    stats: sample.video.stats,
    transcript: sample.transcript
  }));
}

function copySourceStyleAnalysisCacheKey(source: CopySource) {
  return shortHash(JSON.stringify({
    version: 1,
    promptVersion: STYLE_SAMPLE_ANALYSIS_PROMPT_VERSION,
    kind: "copy-source",
    sourceId: source.id,
    title: source.title,
    platform: source.platform,
    url: source.url,
    resolvedUrl: source.resolvedUrl || "",
    materialAnalysis: source.materialAnalysis || null,
    transcript: source.transcript
  }));
}

function buildAccountStyleAnalysisTasks(
  platform: Platform,
  accountId: string,
  samples: AccountStyleSample[],
  group?: { id: string; label: string }
): StyleAnalysisTask[] {
  return samples.map((sample) => ({
    kind: "account-video" as const,
    sourceId: sample.video.id,
    title: sample.video.title,
    groupId: group?.id,
    groupLabel: group?.label,
    inputChars: sample.transcript.length,
    cacheKey: accountStyleAnalysisCacheKey(sample),
    readCache: () => readAccountStyleSampleAnalysis(platform, accountId, sample.video.id),
    saveCache: (cache) => saveAccountStyleSampleAnalysis(platform, accountId, sample.video.id, cache),
    messages: () => buildAccountSampleAnalysisMessages(platform, sample)
  }));
}

function buildCopySourceStyleAnalysisTasks(sources: CopySource[]): StyleAnalysisTask[] {
  return sources.map((source) => ({
    kind: "copy-source" as const,
    sourceId: source.id,
    title: source.title,
    groupId: "project-materials",
    groupLabel: "项目素材",
    inputChars: source.transcript.length,
    cacheKey: copySourceStyleAnalysisCacheKey(source),
    readCache: () => readCopySourceStyleAnalysis(source.id),
    saveCache: (cache) => saveCopySourceStyleAnalysis(source.id, cache),
    messages: () => buildCopySourceSampleAnalysisMessages(source)
  }));
}

function buildAccountSampleAnalysisMessages(platform: Platform, sample: AccountStyleSample): ChatMessage[] {
  return [
    {
      role: "system",
      content:
        "你是短视频中文文案风格分析师。你必须完整阅读用户提供的单条完整转写，不要跳读、不要摘要替代阅读。输出紧凑 Markdown 结构化分析，总字数控制在 900-1400 个中文字符，不要逐句复述原文。必须包含：内容定位、开头方式、句式与节奏、常用话术、叙事结构、结尾 CTA、写作禁忌、证据摘录、样本覆盖说明。只基于这条样本，不要泛泛套模板。"
    },
    {
      role: "user",
      content: [
        `平台：${platform}`,
        `标题：${sample.video.title}`,
        `播放:${sample.video.stats.views} 点赞:${sample.video.stats.likes} 评论:${sample.video.stats.comments} 收藏:${sample.video.stats.favorites} 分享:${sample.video.stats.shares ?? 0}`,
        `完整转写（${sample.transcript.length} 字）：`,
        sample.transcript
      ].join("\n")
    }
  ];
}

function buildCopySourceSampleAnalysisMessages(source: CopySource): ChatMessage[] {
  const materialAnalysis = source.materialAnalysis
    ? [
        `素材底稿：${source.materialAnalysis.mode === "multimodal" ? "转写 + 画面描述" : "标题/转写线索"}`,
        `状态：${source.materialAnalysis.status}`,
        source.materialAnalysis.visualNotes ? `画面描述：${source.materialAnalysis.visualNotes}` : "",
        source.materialAnalysis.structureNotes ? `镜头顺序：${source.materialAnalysis.structureNotes}` : "",
        source.materialAnalysis.titleNotes ? `标题/封面线索：${source.materialAnalysis.titleNotes}` : "",
        source.materialAnalysis.fallbackReason ? `说明：${source.materialAnalysis.fallbackReason}` : ""
      ]
        .filter(Boolean)
        .join("\n")
    : "素材底稿：只有转写，未做原视频画面描述";
  return [
    {
      role: "system",
      content:
        "你是项目级短视频素材风格分析师。你必须完整阅读用户提供的单条完整素材转写，不要跳读、不要摘要替代阅读。输出紧凑 Markdown 结构化分析，总字数控制在 900-1400 个中文字符，不要逐句复述原文。必须包含：内容定位、开头方式、句式与节奏、常用话术、素材与画面方向、叙事结构、结尾 CTA、写作禁忌、证据摘录、样本覆盖说明。只基于这条素材，不要泛泛套模板。"
    },
    {
      role: "user",
      content: [
        `标题：${source.title}`,
        `平台：${source.platform}`,
        `来源：${source.url}`,
        materialAnalysis,
        `完整转写（${source.transcript.length} 字）：`,
        source.transcript
      ].join("\n")
    }
  ];
}

async function resolveStyleSampleAnalyses(
  tasks: StyleAnalysisTask[],
  options: StylePreparationOptions = {}
) {
  const totalInputChars = tasks.reduce((total, task) => total + task.inputChars, 0);
  let completedCount = 0;
  let analysisGeneratedCount = 0;
  let analysisCachedCount = 0;

  const emitProgress = (task: StyleAnalysisTask) => {
    completedCount += 1;
    options.onAnalysisProgress?.({
      analysisCount: tasks.length,
      analysisGeneratedCount,
      analysisCachedCount,
      analysisConcurrency: STYLE_SAMPLE_ANALYSIS_CONCURRENCY,
      inputChars: totalInputChars,
      completedCount,
      currentTitle: task.title
    });
  };

  const entries = await mapWithConcurrency(tasks, STYLE_SAMPLE_ANALYSIS_CONCURRENCY, async (task) => {
    throwIfAborted(options.signal);
    const cached = await task.readCache();
    if (isUsableStyleSampleAnalysisCache(cached, task.cacheKey)) {
      analysisCachedCount += 1;
      emitProgress(task);
      return styleAnalysisEntryFromCache(task, cached);
    }

    const result = await chatCompleteWithEffort(task.messages(), STYLE_REASONING_EFFORT, undefined, {
      signal: options.signal,
      maxOutputTokens: STYLE_SAMPLE_ANALYSIS_MAX_OUTPUT_TOKENS
    });
    const analysis = result.text.trim();
    if (result.fallback || !analysis) {
      throw new Error(
        `样本「${task.title}」风格分析失败：${result.fallbackReason || result.userMessage || "模型没有返回可用分析"}`
      );
    }

    const cache: StyleSampleAnalysisCache = {
      version: 1,
      cacheKey: task.cacheKey,
      kind: task.kind,
      sourceId: task.sourceId,
      title: task.title,
      inputChars: task.inputChars,
      analysis,
      usedModel: result.model,
      reasoningEffort: STYLE_REASONING_EFFORT,
      requestedServiceTier: result.requestedServiceTier,
      actualServiceTier: result.actualServiceTier,
      wireApi: result.wireApi,
      generatedAt: nowIso()
    };
    await task.saveCache(cache);
    analysisGeneratedCount += 1;
    logStyleModelRequest("style-sample-analysis", result, {
      title: task.title,
      sourceId: task.sourceId,
      inputChars: task.inputChars
    });
    emitProgress(task);
    return styleAnalysisEntryFromCache(task, cache);
  });

  return {
    entries,
    stats: {
      analysisCount: tasks.length,
      analysisGeneratedCount,
      analysisCachedCount,
      analysisConcurrency: STYLE_SAMPLE_ANALYSIS_CONCURRENCY,
      inputChars: totalInputChars
    } satisfies StyleAnalysisStats
  };
}

function isUsableStyleSampleAnalysisCache(
  cache: StyleSampleAnalysisCache | null,
  cacheKey: string
): cache is StyleSampleAnalysisCache {
  return Boolean(cache?.version === 1 && cache.cacheKey === cacheKey && cache.analysis.trim());
}

function styleAnalysisEntryFromCache(task: StyleAnalysisTask, cache: StyleSampleAnalysisCache): StyleAnalysisEntry {
  return {
    kind: task.kind,
    sourceId: task.sourceId,
    title: task.title,
    groupId: task.groupId,
    groupLabel: task.groupLabel,
    inputChars: cache.inputChars,
    analysis: cache.analysis,
    cacheKey: cache.cacheKey
  };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  run: (item: T, index: number) => Promise<R>
) {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(concurrency, 1), items.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        results[currentIndex] = await run(items[currentIndex], currentIndex);
      }
    })
  );
  return results;
}

function formatStyleAnalysisCorpus(entries: StyleAnalysisEntry[], label = "样本分析") {
  return entries
    .map(
      (entry, index) =>
        `${label} ${index + 1}｜${entry.title}\n来源:${entry.sourceId} 原文完整字数:${entry.inputChars}\n${entry.analysis}`
    )
    .join("\n\n---\n\n");
}

function styleGenerationMetrics(
  stats: StyleAnalysisStats,
  result?: ChatCompletionResult,
  timings: StyleCompletionTimings = {}
) {
  return {
    analysisCount: stats.analysisCount,
    analysisGeneratedCount: stats.analysisGeneratedCount,
    analysisCachedCount: stats.analysisCachedCount,
    analysisConcurrency: stats.analysisConcurrency,
    inputChars: stats.inputChars,
    firstDeltaMs: timings.firstDeltaMs,
    totalMs: timings.totalMs,
    wireApi: result?.wireApi,
    reasoningEffort: result?.reasoningEffort || STYLE_REASONING_EFFORT,
    requestedServiceTier: result?.requestedServiceTier,
    actualServiceTier: result?.actualServiceTier
  };
}

function logStyleModelRequest(scope: string, result: ChatCompletionResult, extra: Record<string, unknown> = {}) {
  const payload = {
    scope,
    model: result.model,
    wireApi: result.wireApi,
    reasoningEffort: result.reasoningEffort || STYLE_REASONING_EFFORT,
    requestedServiceTier: result.requestedServiceTier,
    actualServiceTier: result.actualServiceTier,
    fallback: result.fallback,
    ...extra
  };
  console.info(`[style-model] ${JSON.stringify(payload)}`);
}

function selectIncrementalAccountStyleSamples(
  samples: AccountStyleSample[],
  sampleFingerprints: PreparedAccountStyleContext["sampleFingerprints"],
  previousFingerprints?: PreparedAccountStyleContext["sampleFingerprints"]
) {
  if (!previousFingerprints?.length) return { samples, canIncremental: false };

  const currentById = new Map(sampleFingerprints.map((sample) => [sample.videoId, sample.hash]));
  const previousById = new Map(previousFingerprints.map((sample) => [sample.videoId, sample.hash]));
  const removedSamples = previousFingerprints.some((sample) => !currentById.has(sample.videoId));
  const changedSamples = samples.filter((sample) => previousById.get(sample.video.id) !== currentById.get(sample.video.id));

  return {
    samples: changedSamples.length && !removedSamples ? changedSamples : samples,
    canIncremental: Boolean(changedSamples.length && !removedSamples)
  };
}

export async function prepareAccountStyleContext(
  platform: Platform,
  accountId: string,
  options: StylePreparationOptions = {}
): Promise<PreparedAccountStyleContext> {
  const account = await resolveAccount(platform, accountId);
  const samples = await getTopTranscriptSamples(platform, accountId, "all");

  if (!samples.length) {
    throw new Error("这个账号还没有可用于总结的转写稿");
  }

  const sampleState = buildAccountStyleSampleState(samples);
  const [styleMeta, existingStyle] = await Promise.all([
    readAccountStyleMeta(platform, accountId),
    readStyle(platform, accountId)
  ]);
  const currentStyle = existingStyle.trim();
  if (styleMeta?.sampleHash === sampleState.sampleHash && currentStyle && !styleMeta.fallback) {
    return {
      platform,
      accountId,
      accountName: account.name,
      messages: [],
      fallback: currentStyle,
      ...sampleState,
      generationMode: "full",
      analysisStats: emptyStyleAnalysisStats(),
      cachedStyle: currentStyle,
      cachedFallback: styleMeta.fallback,
      cachedFallbackReason: styleMeta.fallbackReason
    };
  }

  const incremental = currentStyle
    ? selectIncrementalAccountStyleSamples(samples, sampleState.sampleFingerprints, styleMeta?.sampleFingerprints)
    : { samples, canIncremental: false };
  const generationMode = incremental.canIncremental ? "incremental" : "full";
  const analysis = await resolveStyleSampleAnalyses(
    buildAccountStyleAnalysisTasks(platform, accountId, samples),
    options
  );
  const corpus = formatStyleAnalysisCorpus(analysis.entries, "样本分析");
  const fallback = generationMode === "incremental" ? currentStyle : buildFallbackStyle(account.name, corpus);
  const messages: ChatMessage[] = generationMode === "incremental"
    ? [
        {
          role: "system",
          content:
            "你是短视频账号风格分析师。请基于已有风格卡和全量样本分析做增量更新，输出一份完整 Markdown 风格卡。每条样本分析都来自完整转写阅读结果；保留仍然成立的洞察，只在样本提供充分证据时修订；结论要具体贴合样本，不要输出泛泛模板。"
        },
        {
          role: "user",
          content: [
            `账号：${account.name}`,
            `平台：${platform}`,
            `已有风格卡：\n${currentStyle}`,
            `全量样本分析（每条分析均已读取对应完整转写；本次新增/变化样本数：${incremental.samples.length}）：\n${corpus}`,
            [
              "输出要求：",
              "1. 输出完整风格卡，不要只输出差异说明。",
              "2. 结构必须包含：内容定位、开头方式、句式与节奏、常用话术、叙事结构、结尾 CTA、写作禁忌。",
              "3. 不要编造样本没有体现的新定位或事实。"
            ].join("\n")
          ].join("\n\n")
        }
      ]
    : [
        {
          role: "system",
          content:
            "你是短视频账号风格分析师。请根据全量样本分析提炼可复用的中文文案风格卡。每条样本分析都来自完整转写阅读结果；输出 Markdown，结构必须包含：内容定位、开头方式、句式与节奏、常用话术、叙事结构、结尾 CTA、写作禁忌。结论要具体贴合样本，不要输出泛泛模板。"
        },
        {
          role: "user",
          content: `账号：${account.name}\n平台：${platform}\n\n全量样本分析（每条分析均已读取对应完整转写）：\n${corpus}`
        }
      ];

  return {
    platform,
    accountId,
    accountName: account.name,
    messages,
    fallback,
    ...sampleState,
    generationMode,
    analysisStats: analysis.stats
  };
}

export async function completePreparedAccountStyle(
  context: PreparedAccountStyleContext,
  result: ChatCompletionResult,
  timings: StyleCompletionTimings = {}
): Promise<AccountStyleGenerationResult> {
  const generatedStyle = result.text.trim();
  const style = generatedStyle || context.fallback;
  const isFallbackResult = result.fallback || !generatedStyle;
  const shouldUpdateSampleCache = Boolean(generatedStyle) && !isFallbackResult;
  const shouldSaveStyle = Boolean(style.trim());

  if (shouldSaveStyle) {
    await saveStyle(context.platform, context.accountId, style);
  }

  if (shouldUpdateSampleCache) {
    await saveAccountStyleMeta(context.platform, context.accountId, {
      sampleHash: context.sampleHash,
      sampleFingerprints: context.sampleFingerprints,
      sampleVideoIds: context.sampleVideoIds,
      sampleCount: context.sampleVideoIds.length,
      generationMode: context.generationMode,
      usedModel: result.model,
      fallback: isFallbackResult,
      fallbackReason: isFallbackResult
        ? result.fallbackReason || "模型没有返回完整可用内容，已保存降级风格卡。"
        : undefined
    });
  }

  const metrics = styleGenerationMetrics(context.analysisStats, result, timings);
  logStyleModelRequest("account-style-final", result, {
    accountId: context.accountId,
    generationMode: context.generationMode,
    ...metrics
  });

  return {
    style,
    fallback: isFallbackResult,
    usedModel: result.model,
    fallbackReason: result.fallbackReason,
    cached: false,
    generationMode: context.generationMode,
    sampleHash: shouldUpdateSampleCache ? context.sampleHash : undefined,
    ...metrics
  };
}

export function completeCachedAccountStyle(context: PreparedAccountStyleContext): AccountStyleGenerationResult | null {
  if (!context.cachedStyle) return null;
  return {
    style: context.cachedStyle,
    fallback: Boolean(context.cachedFallback),
    usedModel: "style-cache",
    fallbackReason: context.cachedFallbackReason,
    cached: true,
    generationMode: "cached",
    sampleHash: context.sampleHash,
    ...styleGenerationMetrics(context.analysisStats)
  };
}

export async function generateStyleProfile(
  platform: Platform,
  accountId: string,
  options: { signal?: AbortSignal } = {}
): Promise<AccountStyleGenerationResult> {
  const startedAt = Date.now();
  const context = await prepareAccountStyleContext(platform, accountId, options);
  const cached = completeCachedAccountStyle(context);
  if (cached) return { ...cached, totalMs: Date.now() - startedAt };
  const result = await completeStyleGeneration(context.messages, options);
  return completePreparedAccountStyle(context, result, { totalMs: Date.now() - startedAt });
}

type ProjectStyleAccountContext = {
  account: Awaited<ReturnType<typeof resolveAccount>>;
  style: string;
  samples: AccountStyleSample[];
  sampleFingerprints: StyleSampleFingerprint[];
  analyses: StyleAnalysisEntry[];
};

async function buildProjectStyleAccountContexts(sourceAccountIds: string[]): Promise<ProjectStyleAccountContext[]> {
  return Promise.all(
    sourceAccountIds.map(async (sourceAccountId) => {
      const [platform] = sourceAccountId.split(":") as [Platform, string];
      const account = await resolveAccount(platform, sourceAccountId);
      const [style, samples] = await Promise.all([
        readStyle(platform, sourceAccountId),
        getTopTranscriptSamples(platform, sourceAccountId, "all")
      ]);
      return {
        account,
        style,
        samples,
        sampleFingerprints: buildAccountStyleSampleState(samples).sampleFingerprints,
        analyses: []
      };
    })
  );
}

function formatProjectStyleAccountCorpus(accountContexts: ProjectStyleAccountContext[]) {
  return accountContexts
    .map(({ account, style, analyses }) => {
      const analysisBlock = formatStyleAnalysisCorpus(analyses, "账号样本分析");
      return `参考账号：${account.name}｜${account.platform}\n\n账号风格卡：\n${style}\n\n爆款样本分析（每条分析均已读取对应完整转写）：\n${analysisBlock || "暂无转写样本"}`;
    })
    .join("\n\n---\n\n");
}

function formatProjectStyleCopySourceContext(sources: CopySource[], analyses: StyleAnalysisEntry[]) {
  const analysisBySourceId = new Map(analyses.map((entry) => [entry.sourceId, entry]));
  return sources
    .map((source, index) => {
      const analysis = analysisBySourceId.get(source.id);
      const materialAnalysis = source.materialAnalysis
        ? [
            `素材底稿：${source.materialAnalysis.mode === "multimodal" ? "转写 + 画面描述" : "标题/转写线索"}`,
            `状态：${source.materialAnalysis.status}`,
            source.materialAnalysis.visualNotes ? `画面描述：${source.materialAnalysis.visualNotes}` : "",
            source.materialAnalysis.structureNotes ? `镜头顺序：${source.materialAnalysis.structureNotes}` : "",
            source.materialAnalysis.titleNotes ? `标题/封面线索：${source.materialAnalysis.titleNotes}` : "",
            source.materialAnalysis.fallbackReason ? `说明：${source.materialAnalysis.fallbackReason}` : ""
          ]
            .filter(Boolean)
            .join("\n")
        : "素材底稿：只有转写，未做原视频画面描述";
      return `文案素材 ${index + 1}｜${source.title}\n平台：${source.platform}\n来源：${source.url}\n${materialAnalysis}\n\n素材样本分析（已读取完整转写 ${source.transcript.length} 字）：\n${analysis?.analysis || "暂无样本分析"}`;
    })
    .filter(Boolean)
    .join("\n\n");
}

async function resolveProjectCopySourcesForStyle(sourceIds: string[]) {
  return resolveProjectCopySources(sourceIds);
}

async function resolveProjectCopySources(sourceIds: string[], maxSources?: number) {
  if (!sourceIds.length) return [];
  const selectedIds = maxSources ? sourceIds.slice(0, maxSources) : sourceIds;
  const sources = await Promise.all(selectedIds.map((sourceId) => resolveCopySource(sourceId).catch(() => null)));
  return sources.filter(Boolean) as CopySource[];
}

function buildProjectStyleSampleState(
  project: Awaited<ReturnType<typeof resolveProject>>,
  accountContexts: ProjectStyleAccountContext[],
  materialSources: CopySource[]
) {
  const sourceAccountIds = [...project.sourceAccountIds];
  const sourceMaterialIds = [...(project.sourceMaterialIds || [])];
  const accountFingerprints = accountContexts.map(({ account, style, sampleFingerprints }) => ({
    accountId: account.id,
    styleHash: shortHash(style),
    sampleFingerprints
  }));
  const materialFingerprints = materialSources.map((source) => ({
    sourceId: source.id,
    hash: shortHash([
      source.id,
      source.title,
      source.platform,
      source.url,
      source.resolvedUrl || "",
      source.transcript,
      JSON.stringify(source.materialAnalysis || {})
    ].join("\n"))
  }));
  const sampleHash = shortHash(JSON.stringify({
    project: {
      name: project.name,
      description: project.description || "",
      sourceAccountIds,
      sourceMaterialIds
    },
    accountFingerprints,
    materialFingerprints
  }));

  return {
    sampleHash,
    sourceAccountIds,
    sourceMaterialIds,
    accountFingerprints,
    materialFingerprints,
    sampleCount: accountFingerprints.reduce((total, item) => total + item.sampleFingerprints.length, 0),
    materialCount: materialFingerprints.length
  };
}

type ProjectStyleSampleState = ReturnType<typeof buildProjectStyleSampleState>;
type ProjectStyleProfileResult = Omit<ProjectStyleGenerationResult, "project">;

export type PreparedProjectStyleContext = {
  projectId: string;
  projectName: string;
  messages: ChatMessage[];
  fallback: string;
  sampleState: ProjectStyleSampleState;
  analysisStats: StyleAnalysisStats;
  cachedStyle?: string;
};

export type PreparedSavedProjectStyleContext = {
  project: Awaited<ReturnType<typeof upsertProject>>;
  context: PreparedProjectStyleContext;
};

export async function prepareProjectStyleContext(
  projectId: string,
  options: StylePreparationOptions = {}
): Promise<PreparedProjectStyleContext> {
  const project = await resolveProject(projectId);
  if (!project.sourceAccountIds.length && !project.sourceMaterialIds?.length) {
    throw new Error("先加案例或账号");
  }

  const [accountContexts, materialSources, currentStyle, styleMeta] = await Promise.all([
    buildProjectStyleAccountContexts(project.sourceAccountIds),
    resolveProjectCopySourcesForStyle(project.sourceMaterialIds || []),
    readProjectStyle(project.id),
    readProjectStyleMeta(project.id)
  ]);
  const sampleState = buildProjectStyleSampleState(project, accountContexts, materialSources);
  const trimmedCurrentStyle = currentStyle.trim();
  if (styleMeta?.sampleHash === sampleState.sampleHash && trimmedCurrentStyle && !styleMeta.fallback) {
    return {
      projectId: project.id,
      projectName: project.name,
      messages: [],
      fallback: trimmedCurrentStyle,
      sampleState,
      analysisStats: emptyStyleAnalysisStats(),
      cachedStyle: trimmedCurrentStyle
    };
  }

  const accountTasks = accountContexts.flatMap((context) =>
    buildAccountStyleAnalysisTasks(context.account.platform, context.account.id, context.samples, {
      id: context.account.id,
      label: `${context.account.name}｜${context.account.platform}`
    })
  );
  const materialTasks = buildCopySourceStyleAnalysisTasks(materialSources);
  const analysis = await resolveStyleSampleAnalyses([...accountTasks, ...materialTasks], options);
  const analysesByGroupId = new Map<string, StyleAnalysisEntry[]>();
  for (const entry of analysis.entries) {
    const groupId = entry.groupId || entry.sourceId;
    analysesByGroupId.set(groupId, [...(analysesByGroupId.get(groupId) || []), entry]);
  }
  const accountContextsWithAnalyses = accountContexts.map((context) => ({
    ...context,
    analyses: analysesByGroupId.get(context.account.id) || []
  }));
  const materialAnalyses = analysis.entries.filter((entry) => entry.kind === "copy-source");
  const accountCorpus = formatProjectStyleAccountCorpus(accountContextsWithAnalyses);
  const materialCorpus = formatProjectStyleCopySourceContext(materialSources, materialAnalyses);
  const corpus = [accountCorpus, materialCorpus].filter(Boolean).join("\n\n---\n\n");

  const fallback = buildFallbackStyle(project.name, corpus);
  return {
    projectId: project.id,
    projectName: project.name,
    messages: [
      {
        role: "system",
        content:
          "你是项目级中文短视频风格策略师。请把参考账号风格卡、全量样本分析、项目案例素材分析，以及素材里已经保存的画面描述融合成一个可执行的项目风格卡。输出 Markdown，结构必须包含：项目定位、适合选题、开头方式、句式与节奏、常用话术、素材与画面方向、叙事结构、结尾 CTA、写作禁忌。只使用参考素材里已经存在的信息，不要假装看到了未提供的视频画面。结论要具体贴合参考素材，不要输出泛泛模板。"
      },
      {
        role: "user",
        content: `项目：${project.name}\n项目说明：${project.description || "暂无"}\n\n参考素材：\n${corpus}`
      }
    ],
    fallback,
    sampleState,
    analysisStats: analysis.stats
  };
}

export function completeCachedProjectStyle(context: PreparedProjectStyleContext): ProjectStyleProfileResult | null {
  if (!context.cachedStyle) return null;
  return {
    style: context.cachedStyle,
    fallback: false,
    usedModel: "style-cache",
    cached: true,
    generationMode: "cached" as const,
    sampleHash: context.sampleState.sampleHash,
    ...styleGenerationMetrics(context.analysisStats)
  };
}

export async function completePreparedProjectStyle(
  context: PreparedProjectStyleContext,
  result: ChatCompletionResult,
  timings: StyleCompletionTimings = {}
): Promise<ProjectStyleProfileResult> {
  const generatedStyle = result.text.trim();
  const style = generatedStyle || context.fallback;
  const isFallbackResult = result.fallback || !generatedStyle;
  await saveProjectStyle(context.projectId, style);

  if (!isFallbackResult) {
    await saveProjectStyleMeta(context.projectId, {
      ...context.sampleState,
      usedModel: result.model,
      fallback: false
    });
  }

  const metrics = styleGenerationMetrics(context.analysisStats, result, timings);
  logStyleModelRequest("project-style-final", result, {
    projectId: context.projectId,
    ...metrics
  });

  return {
    style,
    fallback: isFallbackResult,
    usedModel: result.model,
    fallbackReason: result.fallbackReason,
    cached: false,
    generationMode: "full" as const,
    sampleHash: isFallbackResult ? undefined : context.sampleState.sampleHash,
    ...metrics
  };
}

export async function generateProjectStyleProfile(projectId: string, options: { signal?: AbortSignal } = {}) {
  const startedAt = Date.now();
  const context = await prepareProjectStyleContext(projectId, options);
  const cached = completeCachedProjectStyle(context);
  if (cached) return { ...cached, totalMs: Date.now() - startedAt };
  const result = await completeStyleGeneration(context.messages, options);
  return completePreparedProjectStyle(context, result, { totalMs: Date.now() - startedAt });
}

export async function prepareSavedProjectStyleContext(
  input: SaveAndGenerateProjectStyleInput,
  options: StylePreparationOptions = {}
): Promise<PreparedSavedProjectStyleContext> {
  if (!input.sourceAccountIds.length && !input.sourceMaterialIds?.length) {
    throw new Error("先加案例或账号");
  }

  if (input.sourceAccountIds.length) {
    await assertProjectSourceAccountsExist(input.sourceAccountIds);
  }

  const project = await upsertProject(input);
  const context = await prepareProjectStyleContext(project.id, options);
  return { project, context };
}

export async function buildSavedProjectStyleResult(
  prepared: PreparedSavedProjectStyleContext,
  result: ProjectStyleProfileResult
): Promise<ProjectStyleGenerationResult> {
  const summary = await getProjectSummary(prepared.project);
  return {
    project: summary,
    style: result.style,
    fallback: result.fallback,
    usedModel: result.usedModel,
    fallbackReason: result.fallbackReason,
    cached: result.cached,
    generationMode: result.generationMode,
    sampleHash: result.sampleHash,
    analysisCount: result.analysisCount,
    analysisGeneratedCount: result.analysisGeneratedCount,
    analysisCachedCount: result.analysisCachedCount,
    analysisConcurrency: result.analysisConcurrency,
    inputChars: result.inputChars,
    firstDeltaMs: result.firstDeltaMs,
    totalMs: result.totalMs,
    wireApi: result.wireApi,
    reasoningEffort: result.reasoningEffort,
    requestedServiceTier: result.requestedServiceTier,
    actualServiceTier: result.actualServiceTier
  };
}

export async function saveAndGenerateProjectStyleProfile(
  input: SaveAndGenerateProjectStyleInput,
  options: { signal?: AbortSignal } = {}
): Promise<ProjectStyleGenerationResult> {
  const startedAt = Date.now();
  const prepared = await prepareSavedProjectStyleContext(input, options);
  const cached = completeCachedProjectStyle(prepared.context);
  const result = cached
    ? { ...cached, totalMs: Date.now() - startedAt }
    : await completePreparedProjectStyle(
        prepared.context,
        await completeStyleGeneration(prepared.context.messages, options),
        { totalMs: Date.now() - startedAt }
      );
  return buildSavedProjectStyleResult(prepared, result);
}

export async function writeCopy(input: WriteCopyInput, options: { signal?: AbortSignal } = {}): Promise<WriteResult> {
  const prepared = await prepareWriteCopyContext(input, options);
  const result = await chatCompleteWithFallback(prepared.messages, WRITE_COPY_REASONING_EFFORT, undefined, {
    signal: options.signal,
    maxOutputTokens: WRITE_COPY_MAX_OUTPUT_TOKENS
  });
  throwIfAborted(options.signal);
  const content = result.text || buildFallbackCopy(prepared.fallbackName, prepared.fallbackStyle, prepared.fallbackInput);
  const draft = await savePreparedDraft(input, prepared, content);

  return {
    content,
    brief: prepared.brief,
    research: prepared.research,
    sourceDigest: prepared.sourceDigest,
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
  signal?: AbortSignal;
}): Promise<WriteResult> {
  throwIfAborted(input.signal);
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
    brief: input.prepared.brief,
    research: input.prepared.research,
    sourceDigest: input.prepared.sourceDigest,
    draft,
    usedModel: input.result.model,
    fallback: input.result.fallback || !input.result.text.trim(),
    fallbackReason:
      input.result.fallbackReason ||
      (!input.result.text.trim() ? "模型没有返回可用内容，已自动切换到本地模板。" : undefined)
  };
}

export async function prepareWriteBrief(input: WriteCopyInput, options: { signal?: AbortSignal } = {}): Promise<WriteBriefResult> {
  const prepared = await prepareWriteCopyContext(input, options);
  return {
    brief: prepared.brief,
    research: prepared.research,
    sourceDigest: prepared.sourceDigest,
    targetTitle: prepared.draftBase?.title || makeTitleFromPrompt(input.prompt),
    usedModel: prepared.briefModel,
    fallback: prepared.briefFallback,
    fallbackReason: prepared.briefFallbackReason
  };
}

export async function prepareWriteCopyContext(input: WriteCopyInput, options: { signal?: AbortSignal } = {}): Promise<PreparedWriteContext> {
  throwIfAborted(options.signal);
  const normalizedInput = await normalizeWriteCopyInput(input, options);
  throwIfAborted(options.signal);

  if (normalizedInput.targetType === "project" || normalizedInput.projectId) {
    return prepareProjectWriteContext(normalizedInput, options);
  }

  if (!normalizedInput.platform || !normalizedInput.accountId) {
    throw new Error("请选择参考账号");
  }

  const account = await resolveAccount(normalizedInput.platform, normalizedInput.accountId);
  const style = await fs.readFile(path.join(libraryRoot(), normalizedInput.platform, account.slug, "style.md"), "utf8");
  const samples = await getTopTranscriptSamples(normalizedInput.platform, normalizedInput.accountId, WRITE_ACCOUNT_SAMPLE_LIMIT);
  const sampleContext = formatWriteSampleContext(samples);

  const userTask =
    normalizedInput.mode === "topic"
      ? `请基于这个主题生成文案：\n${normalizedInput.prompt}`
      : `请按账号风格改写下面文案。改写要求：${normalizedInput.prompt}\n\n原文素材：\n${normalizedInput.sourceText || ""}`;
  const supportDocContext = await buildSupportDocumentContext(normalizedInput.supportDocLinks, options);
  const webContext = normalizedInput.useWebResearch ? await buildWebResearchContext(normalizedInput, options) : "未启用联网检索。";
  const research = buildReferenceSummary({
    supportDocLinks: normalizedInput.supportDocLinks,
    supportDocContext,
    useWebResearch: normalizedInput.useWebResearch,
    webContext
  });
  const sourceDigest = buildWriteSourceDigest(normalizedInput);
  const briefResult = await buildAccountWritingBrief({
    accountName: account.name,
    platform: normalizedInput.platform,
    style,
    sampleContext,
    input: normalizedInput,
    supportDocContext,
    webContext,
    signal: options.signal
  });
  const writingBrief = briefResult.text.trim();

  return {
    messages: [
      {
        role: "system",
        content:
          "你是中文短视频爆款文案写手。严格按账号写作 brief 成稿，不要解释创作思路，不要输出审稿意见。必须保留用户给出的具体梗和事实线索，把它们写成能直接口播的短视频文案。"
      },
      {
        role: "user",
        content: [
          `参考账号：${account.name}`,
          `平台：${normalizedInput.platform}`,
          `账号写作 brief：\n${writingBrief}`,
          `账号风格卡：\n${style}`,
          `代表样本：\n${sampleContext || "暂无样本，仅参考风格卡。"}`,
          `声音指纹要求：\n${buildVoiceFingerprintInstruction()}`,
          `支持文档资料：\n${supportDocContext}`,
          `联网检索资料：\n${webContext}`,
          `任务：\n${userTask}`,
          [
            "成稿硬性要求：",
            "1. 只输出可直接使用的成稿，不解释创作思路。",
            "2. 开头必须先给明确钩子或反差判断，不能铺垫背景。",
            "3. 事实、数据、产品信息只能来自用户输入、支持文档、样本或联网资料；不要编造。",
            "4. 保留用户给出的具体梗、场景、原话和事实线索。",
            "5. 优先模仿账号的句法、转折和停顿，不要只堆口癖。",
            "6. 句子短，口播感强，少用抽象形容词。",
            "7. 结尾给一个自然的评论区问题或行动引导。"
          ].join("\n")
        ].join("\n\n")
      }
    ],
    fallbackName: account.name,
    fallbackStyle: style,
    fallbackInput: normalizedInput,
    brief: writingBrief,
    briefFallback: briefResult.fallback,
    briefFallbackReason: briefResult.fallbackReason,
    briefModel: briefResult.model,
    research,
    sourceDigest,
    draftBase: {
      platform: normalizedInput.platform,
      accountId: normalizedInput.accountId,
      accountName: account.name,
      title: makeTitleFromPrompt(normalizedInput.prompt),
      mode: normalizedInput.mode,
      prompt: normalizedInput.prompt,
      input: normalizedInput.sourceText,
      supportDocLinks: normalizedInput.supportDocLinks,
      brief: writingBrief,
      sourceDigest,
      styleRef: {
        platform: normalizedInput.platform,
        accountId: normalizedInput.accountId,
        accountName: account.name,
        videoIds: samples.map((sample) => sample.video.id)
      }
    }
  };
}

async function prepareProjectWriteContext(input: WriteCopyInput, options: { signal?: AbortSignal } = {}): Promise<PreparedWriteContext> {
  throwIfAborted(options.signal);
  if (!input.projectId) {
    throw new Error("请选择参考项目");
  }

  const project = await resolveProject(input.projectId);
  const style = await fs.readFile(path.join(libraryRoot(), "projects", project.slug, "style.md"), "utf8");

  const accountContexts = await Promise.all(
    project.sourceAccountIds.map(async (sourceAccountId) => {
      const [platform] = sourceAccountId.split(":") as [Platform, string];
      const account = await resolveAccount(platform, sourceAccountId);
      const samples = await getTopTranscriptSamples(platform, sourceAccountId, WRITE_PROJECT_SAMPLE_LIMIT_PER_ACCOUNT);
      return {
        account,
        samples
      };
    })
  );

  const sampleContext = accountContexts
    .map(({ account, samples }) => {
      const block = formatWriteSampleContext(samples);
      return `参考账号：${account.name}\n${block || "暂无样本"}`;
    })
    .join("\n\n---\n\n");
  const materialContext = await buildProjectCopySourceContext(project.sourceMaterialIds || []);
  const referenceContext = [sampleContext, materialContext].filter(Boolean).join("\n\n---\n\n");

  const userTask =
    input.mode === "topic"
      ? `请基于这个主题生成文案：\n${input.prompt}`
      : `请按项目风格改写下面文案。改写要求：${input.prompt}\n\n原文素材：\n${input.sourceText || ""}`;
  const supportDocContext = await buildSupportDocumentContext(input.supportDocLinks, options);
  const webContext = input.useWebResearch ? await buildWebResearchContext(input, options) : "未启用联网检索。";
  const research = buildReferenceSummary({
    supportDocLinks: input.supportDocLinks,
    supportDocContext,
    useWebResearch: input.useWebResearch,
    webContext
  });
  const sourceDigest = buildWriteSourceDigest(input);
  const briefResult = await buildProjectWritingBrief({
    projectName: project.name,
    projectDescription: project.description,
    style,
    referenceContext,
    input,
    supportDocContext,
    webContext,
    signal: options.signal
  });
  const writingBrief = briefResult.text.trim();

  return {
    messages: [
      {
        role: "system",
        content:
          "你是中文短视频文案助手。严格参考给定项目风格卡和样本话术，但不要照抄原转写稿。只有在联网检索资料明确启用并提供结果时，才基于资料写最新事实；资料不足时说明需要用户补充更明确关键词。输出可以直接使用的成稿，必要时给出标题、正文、口播节奏和结尾互动。"
      },
      {
        role: "user",
        content: [
          `参考项目：${project.name}`,
          `项目说明：${project.description || "暂无"}`,
          `项目写作 brief：\n${writingBrief}`,
          `项目风格卡：\n${style}`,
          `代表样本：\n${referenceContext || "暂无样本，仅参考风格卡。"}`,
          `声音指纹要求：\n${buildVoiceFingerprintInstruction()}`,
          `支持文档资料：\n${supportDocContext}`,
          `联网检索资料：\n${webContext}`,
          `任务：\n${userTask}`,
          [
            "成稿硬性要求：",
            "1. 只输出可直接使用的成稿，不解释创作思路。",
            "2. 开头必须先给明确钩子或反差判断，不能铺垫背景。",
            "3. 事实、数据、产品信息只能来自用户输入、支持文档、样本或联网资料；不要编造。",
            "4. 保留用户给出的具体梗、场景、原话和事实线索。",
            "5. 优先模仿项目样本的句法、转折和停顿，不要只堆口癖。",
            "6. 句子短，口播感强，少用抽象形容词。",
            "7. 结尾给一个自然的评论区问题或行动引导。"
          ].join("\n")
        ].join("\n\n")
      }
    ],
    fallbackName: project.name,
    fallbackStyle: style,
    fallbackInput: {
      mode: input.mode,
      prompt: input.prompt,
      sourceText: input.sourceText
    },
    brief: writingBrief,
    briefFallback: briefResult.fallback,
    briefFallbackReason: briefResult.fallbackReason,
    briefModel: briefResult.model,
    research,
    sourceDigest,
    draftBase: {
      targetType: "project",
      projectId: project.id,
      projectName: project.name,
      title: makeTitleFromPrompt(input.prompt),
      mode: input.mode,
      prompt: input.prompt,
      input: input.sourceText,
      supportDocLinks: input.supportDocLinks,
      brief: writingBrief,
      sourceDigest,
      styleRef: {
        projectId: project.id,
        projectName: project.name,
        sourceAccountIds: project.sourceAccountIds,
        sourceMaterialIds: project.sourceMaterialIds
      }
    }
  };
}

async function buildAccountWritingBrief(input: {
  accountName: string;
  platform: Platform;
  style: string;
  sampleContext: string;
  input: WriteCopyInput;
  supportDocContext: string;
  webContext: string;
  signal?: AbortSignal;
}) {
  throwIfAborted(input.signal);
  const manualBrief = input.input.brief?.trim();
  if (manualBrief) {
    return {
      text: manualBrief,
      model: "edited-brief",
      fallback: false,
      ok: true
    } satisfies ChatCompletionResult;
  }

  const sourceText = input.input.sourceText?.trim() || "暂无原文素材";
  const userTask =
    input.input.mode === "topic"
      ? input.input.prompt
      : `${input.input.prompt}\n\n${sourceText}`;

  const result = await completeWriteBriefGeneration(
    [
      {
        role: "system",
        content:
          "你是短视频文案策划。你的任务是把账号风格、代表样本和用户输入压缩成写作 brief，供下一步直接成稿使用。不要生成正文，不要解释过程。"
      },
      {
        role: "user",
        content: [
          `参考账号：${input.accountName}`,
          `平台：${input.platform}`,
          `任务：\n${userTask}`,
          `账号风格卡：\n${input.style}`,
          `代表样本：\n${input.sampleContext || "暂无样本"}`,
          `声音指纹要求：\n${buildVoiceFingerprintInstruction()}`,
          `支持文档资料：\n${input.supportDocContext}`,
          `联网检索资料：\n${input.webContext}`,
          [
            "请只输出以下结构：",
            "## 核心事件",
            "## 可见画面/具体细节",
            "## 声音指纹",
            "## 账号化切入",
            "## 梗和映射",
            "## 成稿路线",
            "## 避坑"
          ].join("\n")
        ].join("\n\n")
      }
    ],
    { signal: input.signal }
  );

  return requireWriteBriefResult(result, () =>
    buildLocalAccountWritingBrief({
      ...input,
      userTask
    })
  );
}

async function buildProjectWritingBrief(input: {
  projectName: string;
  projectDescription?: string;
  style: string;
  referenceContext: string;
  input: WriteCopyInput;
  supportDocContext: string;
  webContext: string;
  signal?: AbortSignal;
}) {
  throwIfAborted(input.signal);
  const manualBrief = input.input.brief?.trim();
  if (manualBrief) {
    return {
      text: manualBrief,
      model: "edited-brief",
      fallback: false,
      ok: true
    } satisfies ChatCompletionResult;
  }

  const sourceText = input.input.sourceText?.trim() || "暂无原文素材";
  const userTask =
    input.input.mode === "topic"
      ? input.input.prompt
      : `${input.input.prompt}\n\n${sourceText}`;

  const result = await completeWriteBriefGeneration(
    [
      {
        role: "system",
        content:
          "你是短视频项目文案策划。你的任务是把项目风格、案例素材和用户输入压缩成写作 brief，供下一步直接成稿使用。不要生成正文，不要解释过程。"
      },
      {
        role: "user",
        content: [
          `参考项目：${input.projectName}`,
          `项目说明：${input.projectDescription || "暂无"}`,
          `任务：\n${userTask}`,
          `项目风格卡：\n${input.style}`,
          `代表样本和案例素材：\n${input.referenceContext || "暂无样本"}`,
          `声音指纹要求：\n${buildVoiceFingerprintInstruction()}`,
          `支持文档资料：\n${input.supportDocContext}`,
          `联网检索资料：\n${input.webContext}`,
          [
            "请只输出以下结构：",
            "## 核心事件",
            "## 可见画面/具体细节",
            "## 声音指纹",
            "## 项目化切入",
            "## 梗和映射",
            "## 成稿路线",
            "## 避坑"
          ].join("\n")
        ].join("\n\n")
      }
    ],
    { signal: input.signal }
  );

  return requireWriteBriefResult(result, () =>
    buildLocalProjectWritingBrief({
      ...input,
      userTask
    })
  );
}

function completeWriteBriefGeneration(messages: ChatMessage[], options: { signal?: AbortSignal } = {}) {
  return streamResponseText({
    messages,
    reasoningEffort: WRITE_BRIEF_REASONING_EFFORT,
    maxOutputTokens: WRITE_BRIEF_MAX_OUTPUT_TOKENS,
    signal: options.signal,
    onDelta() {
      // Keep the brief bounded without surfacing intermediate planning text to the UI.
    }
  });
}

function requireWriteBriefResult(result: ChatCompletionResult, buildLocalBrief?: () => string) {
  const text = result.text.trim();
  if (text) return { ...result, text };

  if (buildLocalBrief) {
    return {
      ...result,
      text: buildLocalBrief(),
      fallback: true,
      fallbackReason: result.fallbackReason || "模型没有返回可用写作 Brief，已使用本地结构整理。",
      ok: false,
      errorKind: result.errorKind || "empty",
      userMessage: result.userMessage || "对话模型没有返回可用内容"
    };
  }

  throw new Error(result.fallbackReason || "对话模型没有返回可用写作 Brief，请稍后重试或检查模型配置。");
}

function buildLocalAccountWritingBrief(input: {
  accountName: string;
  platform: Platform;
  style: string;
  sampleContext: string;
  input: WriteCopyInput;
  supportDocContext: string;
  webContext: string;
  userTask: string;
}) {
  return buildLocalWritingBrief({
    targetLabel: `参考账号：${input.accountName}｜${input.platform}`,
    angleHeading: "账号化切入",
    style: input.style,
    referenceContext: input.sampleContext,
    copyInput: input.input,
    supportDocContext: input.supportDocContext,
    webContext: input.webContext,
    userTask: input.userTask
  });
}

function buildLocalProjectWritingBrief(input: {
  projectName: string;
  projectDescription?: string;
  style: string;
  referenceContext: string;
  input: WriteCopyInput;
  supportDocContext: string;
  webContext: string;
  userTask: string;
}) {
  return buildLocalWritingBrief({
    targetLabel: `参考项目：${input.projectName}${input.projectDescription ? `｜${input.projectDescription}` : ""}`,
    angleHeading: "项目化切入",
    style: input.style,
    referenceContext: input.referenceContext,
    copyInput: input.input,
    supportDocContext: input.supportDocContext,
    webContext: input.webContext,
    userTask: input.userTask
  });
}

function buildLocalWritingBrief(input: {
  targetLabel: string;
  angleHeading: string;
  style: string;
  referenceContext: string;
  copyInput: WriteCopyInput;
  supportDocContext: string;
  webContext: string;
  userTask: string;
}) {
  const prompt = input.copyInput.prompt.trim();
  const sourceText = input.copyInput.sourceText?.trim();
  const coreEvent = input.copyInput.mode === "topic" ? prompt : sourceText || prompt;
  const reference = input.referenceContext.trim() || input.style.trim();
  const externalContext = [input.supportDocContext, input.webContext]
    .filter((section) => section && !/^未(提供|启用)/.test(section.trim()))
    .join("\n\n");

  return [
    "## 核心事件",
    coreEvent || input.userTask,
    "## 可见画面/具体细节",
    [
      sourceText ? `- 原文线索：${sourceText}` : "- 暂无原文素材，围绕主题提取可口播的具体场景。",
      reference ? `- 参考样本/风格线索：${reference}` : "- 样本不足时，只使用用户输入里的事实和场景。"
    ].join("\n"),
    "## 声音指纹",
    [
      "- 先模仿句法、停顿、转折方式和判断习惯，再少量使用原账号口癖。",
      "- 避免套话开场、万能鸡汤、连续排比和过度完整的书面句。",
      "- 每段至少落一个可看见的动作、场景、物件、数字或原话。"
    ].join("\n"),
    `## ${input.angleHeading}`,
    [
      `- ${input.targetLabel}`,
      "- 开头先给明确判断、反差或问题，避免背景铺垫。",
      "- 句子短，口播感强，每段只推进一个信息点。"
    ].join("\n"),
    "## 梗和映射",
    "- 优先保留用户输入中的梗、原话、场景、数字和事实线索；没有来源支持的事实不要新增。",
    "## 成稿路线",
    [
      "1. 钩子：一句话点出冲突、反差或判断。",
      "2. 展开：用具体场景或原文线索解释为什么成立。",
      "3. 转折：补一层反常识或观众容易忽略的点。",
      "4. 收束：给出清晰态度、行动建议或评论区问题。"
    ].join("\n"),
    "## 避坑",
    [
      "- 不编造人物、数据、产品信息或最新事实。",
      "- 不照抄样本文案和原文表达。",
      "- 不输出空泛鸡汤、抽象形容词堆叠或解释创作过程。",
      externalContext ? `- 外部资料只采用已提供内容：${externalContext}` : "- 未提供外部资料时，不写需要外部事实支撑的结论。"
    ].join("\n")
  ].join("\n\n");
}

function buildWriteSourceDigest(input: WriteCopyInput): WriteSourceDigest {
  const sourceText = input.sourceText || "";
  const extracted = extractRewriteSourceMaterial(sourceText);
  return {
    resolvedSourceText: sourceText.trim() || undefined,
    materialCount: extracted.materials.length,
    linkCount: extracted.linkCount,
    textMaterialCount: extracted.textMaterialCount,
    onlyLinkCount: extracted.onlyLinkCount,
    supportDocProvided: Boolean(input.supportDocLinks?.trim()),
    webResearchEnabled: Boolean(input.useWebResearch)
  };
}

async function buildSupportDocumentContext(input?: string, options: { signal?: AbortSignal } = {}) {
  throwIfAborted(options.signal);
  const trimmed = input?.trim() || "";
  if (!trimmed) return "未提供支持文档。";

  if (!hasFeishuDocLink(trimmed)) {
    return `用户粘贴的支持资料：\n${trimmed}`;
  }

  const documents = await fetchFeishuSupportDocuments(trimmed, { signal: options.signal });
  if (!documents.length) {
    return `用户粘贴的支持资料：\n${trimmed}`;
  }

  const blocks: string[] = [];
  if (hasPlainSupportText(trimmed)) {
    blocks.push(`用户补充资料原文：\n${trimmed}`);
  }

  blocks.push(...documents.map((document, index) => {
    const title = document.title?.trim() || `文档 ${index + 1}`;
    if (document.content?.trim()) {
      return `文档 ${index + 1}｜${title}\n来源：${document.url}\n${document.content}`;
    }
    return `文档 ${index + 1}｜${title}\n来源：${document.url}\n读取失败：${document.error || "没有返回可用正文"}`;
  }));

  return blocks.join("\n\n---\n\n");
}

function hasPlainSupportText(input: string) {
  const withoutUrls = input
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/(?:[a-z0-9-]+\.)*(?:feishu\.cn|larksuite\.com|feishu-boe\.cn)\/\S+/gi, " ")
    .replace(/\b(?:docxcn|doxcn|doccn|wikcn)[A-Za-z0-9_-]{8,}\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  return /[\u4e00-\u9fff]/.test(withoutUrls) || withoutUrls.length >= 20;
}

function buildReferenceSummary(input: {
  supportDocLinks?: string;
  supportDocContext: string;
  useWebResearch?: boolean;
  webContext: string;
}) {
  const sections: string[] = [];
  if (input.supportDocLinks?.trim()) {
    sections.push(`支持文档资料：\n${input.supportDocContext}`);
  }
  if (input.useWebResearch) {
    sections.push(`联网检索资料：\n${input.webContext}`);
  }
  return sections.length ? sections.join("\n\n---\n\n") : undefined;
}

async function buildProjectCopySourceContext(sourceIds: string[]) {
  return formatProjectCopySourceContext(await resolveProjectCopySources(sourceIds));
}

function formatProjectCopySourceContext(sources: CopySource[]) {
  return sources
    .map((source, index) => {
      const materialAnalysis = source.materialAnalysis
        ? [
            `素材底稿：${source.materialAnalysis.mode === "multimodal" ? "转写 + 画面描述" : "标题/转写线索"}`,
            `状态：${source.materialAnalysis.status}`,
            source.materialAnalysis.visualNotes ? `画面描述：${source.materialAnalysis.visualNotes}` : "",
            source.materialAnalysis.structureNotes ? `镜头顺序：${source.materialAnalysis.structureNotes}` : "",
            source.materialAnalysis.titleNotes ? `标题/封面线索：${source.materialAnalysis.titleNotes}` : "",
            source.materialAnalysis.fallbackReason ? `说明：${source.materialAnalysis.fallbackReason}` : ""
          ]
            .filter(Boolean)
            .join("\n")
        : "素材底稿：只有转写，未做原视频画面描述";
      return `文案素材 ${index + 1}｜${source.title}\n平台：${source.platform}\n来源：${source.url}\n${materialAnalysis}\n\n转写节选：\n${clampText(source.transcript, WRITE_PROJECT_MATERIAL_MAX_CHARS)}`;
    })
    .filter(Boolean)
    .join("\n\n");
}

function formatWriteSampleContext(samples: AccountStyleSample[]) {
  return samples
    .map(({ video, transcript }, index) => {
      const stats = [
        `播放:${video.stats.views}`,
        `点赞:${video.stats.likes}`,
        `评论:${video.stats.comments}`,
        `收藏:${video.stats.favorites}`,
        video.stats.shares === undefined ? "" : `分享:${video.stats.shares}`
      ].filter(Boolean).join(" ");
      return [
        `样本 ${index + 1}｜《${video.title}》`,
        stats,
        `转写节选（原 ${transcript.length} 字）：`,
        clampText(transcript, WRITE_SAMPLE_TRANSCRIPT_MAX_CHARS)
      ].join("\n");
    })
    .join("\n\n---\n\n");
}

function buildVoiceFingerprintInstruction() {
  return [
    "1. 先抓句法和节奏：开头如何下判断、怎样转折、每句话多长、停顿在哪里。",
    "2. 再抓表达习惯：反问、类比、吐槽、提示观众的方式，只保留样本里真的出现过的倾向。",
    "3. 不要把风格理解成堆口癖；同一个口头词最多自然出现一次。",
    "4. 避免通用 AI 腔：不要用“在这个快节奏时代”“不仅是…更是…”“你是否也…”这类万能句。",
    "5. 每 2-3 句必须落到一个具体画面、动作、物件、数字或原话。"
  ].join("\n");
}

async function normalizeWriteCopyInput(input: WriteCopyInput, options: { signal?: AbortSignal } = {}): Promise<WriteCopyInput> {
  const prompt = normalizeRewritePrompt(input.mode, input.prompt, input.sourceText);
  throwIfAborted(options.signal);

  if (input.mode !== "rewrite") {
    return {
      ...input,
      prompt
    };
  }

  const sourceText = await normalizeRewriteSourceText(input.sourceText || "", options);

  return {
    ...input,
    prompt,
    sourceText
  };
}

async function normalizeRewriteSourceText(sourceText: string, options: { signal?: AbortSignal } = {}) {
  const trimmed = sourceText.trim();
  if (!trimmed || isNormalizedMaterialText(trimmed)) return trimmed;
  return (await resolveRewriteSourceMaterial(trimmed, { signal: options.signal })).normalizedText || trimmed;
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
