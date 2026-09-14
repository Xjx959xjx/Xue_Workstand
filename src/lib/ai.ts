import { randomUUID } from "crypto";
import { preserveWriterPreferences } from "./writer-preference";
import { logPipelineEvent } from "./observability";
import { selectFastReferences, fastWriterPlan, type FastReference } from "./writer-fast-reference";
import {
  STYLE_ANALYSIS_VERSION, WRITER_PROMPT_VERSION,
  parseModelJson, parseStyleEvidence,
  styleAnalysisInstruction, styleEvidenceQuotes as collectStyleEvidenceQuotes,
  checkWriterConstraints, validateStyleCardCitations,
  type StyleEvidence, type WriterContextSnapshot
} from "./writer-context";
import type { ModelResponseBody } from "./model-runtime";
import {
  AccountDraftInput,
  Draft,
  Platform,
  CopySource,
  ProjectDraftInput,
  ProjectSummary,
  WriteBatchResult,
  WriteGenerationResult,
  WriteResult,
  WriteSourceDigest,
  WriteStyleReference,
  WriteStyleReferenceInput,
  WriteVariantFailure,
  WriteVariantResult,
  platforms
} from "./types";
import { clampText, makeTitleFromPrompt, nowIso, shortHash } from "./utils";
import { openCliRows, parseOpenCliJsonish, runOpenCli, stringField } from "./opencli-runtime";
import {
  fetchSupportDocuments,
  hasPlainSupportText,
  hasSupportDocumentReference,
  supportDocumentProviderLabel
} from "./support-documents";
import {
  getTopTranscriptSamples,
  getProjectSummary,
  resolveCopySource,
  readAccountStyleSampleAnalysis,
  readAccountStyleMeta,
  readCopySourceStyleAnalysis,
  readProjectStyle,
  readProjectStyleMeta,
  readStyle,
  resolveAccount,
  resolveDraft,
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
import {
  extractRewriteSourceMaterial,
  mergeWriterSourceInput,
  normalizeRewritePrompt,
  splitWriterSourceInput
} from "./source-extraction";
import { resolveRewriteSourceMaterial } from "./source-transcription";
import {
  draftWriteStyleReferenceInputs,
  normalizeWriteStyleReferenceInputs,
  writeStyleReferenceKey
} from "./write-references";
import {
  buildChatFallbackReason,
  chatCompletionPayload,
  classifyModelFailure,
  getConfiguredChatConfigs,
  getConfiguredWebResearchConfigs,
  getChatConfig,
  getChatRuntimeConfig as getModelRuntimeConfig,
  getWebResearchRuntimeConfig as getModelWebResearchRuntimeConfig,
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
  action?: "create" | "revise";
  platform?: Platform;
  accountId?: string;
  targetType?: "account" | "project";
  projectId?: string;
  styleRefs?: WriteStyleReferenceInput[];
  mode: Draft["mode"];
  prompt: string;
  originalSourceInput?: string;
  sourceText?: string;
  supportDocLinks?: string;
  save?: boolean;
  useWebResearch?: boolean;
  parentDraftId?: string;
  currentContent?: string;
  revisionInstruction?: string;
  revisionScope?: "full" | "selection";
  revisionMode?: "edit" | "recalibrate";
  selectedText?: string;
};

export type PreparedWriteContext = {
  messages: ChatMessage[];
  research?: string;
  contextFingerprint: string;
  sourceDigest: WriteSourceDigest;
  draftBase?: Omit<AccountDraftInput, "content"> | Omit<ProjectDraftInput, "content">;
  writerContext?: WriterContextSnapshot;
};

export type PreparedWriteVariantContext = {
  styleKey: string;
  styleTitle: string;
  styleReference: WriteStyleReference;
  prepared: PreparedWriteContext;
};

export type PreparedWriteBatchContext = {
  preparationFailures?: WriteVariantFailure[];
  variants: PreparedWriteVariantContext[];
  research?: string;
  sourceDigest: WriteSourceDigest;
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
  previousStyleHash?: string;
  evidenceQuotes?: Array<{ sourceId: string; quote: string }>;
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
const STYLE_REASONING_EFFORT: ChatReasoningEffort = "medium";
const STYLE_SAMPLE_ANALYSIS_CONCURRENCY = boundedEnvInteger("STYLE_SAMPLE_ANALYSIS_CONCURRENCY", 2, 1, 4);
const STYLE_SAMPLE_ANALYSIS_PROMPT_VERSION = STYLE_ANALYSIS_VERSION;
const STYLE_SAMPLE_ANALYSIS_MAX_OUTPUT_TOKENS = 4500;
export const WRITE_COPY_REASONING_EFFORT: ChatReasoningEffort = "medium";
export const WRITE_COPY_MAX_OUTPUT_TOKENS = 2600;
const WRITE_PROMPT_VERSION = WRITER_PROMPT_VERSION;
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

export function getWebResearchCapability() {
  const runtime = getModelWebResearchRuntimeConfig();
  if (runtime.configured) {
    return {
      available: true,
      wireApi: "responses" as const,
      model: runtime.model,
      source: runtime.source
    } as const;
  }

  const chat = getChatRuntimeConfig();
  return {
    available: false,
    wireApi: "responses" as const,
    model: runtime.model,
    source: runtime.source,
    reason: chat.configured
      ? "当前写作模型使用 Chat Completions；请配置独立的 WEB_RESEARCH_* Responses 接口。"
      : "尚未配置独立的 WEB_RESEARCH_* Responses 联网接口。"
  } as const;
}

export async function webSearchCompleteStrict(
  messages: ChatMessage[],
  reasoningEffort: ChatReasoningEffort = "low",
  options: { signal?: AbortSignal; maxOutputTokens?: number } = {}
): Promise<ChatCompletionResult> {
  throwIfAborted(options.signal);
  const result = await withWebResearchTimeout(
    (signal) =>
      streamWebResearchResponseText({
        messages,
        reasoningEffort,
        tools: [{ type: "web_search" }],
        maxOutputTokens: options.maxOutputTokens || WEB_RESEARCH_MAX_OUTPUT_TOKENS,
        signal,
        onDelta() {
          // Consume the Responses stream so long searches keep the connection active.
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
  return { ...result, text };
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
  if (kind === "auth") return "请检查主模型或 CHAT_FALLBACK_* 备用模型的 API Key。";
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

  const text = aggregatedText.trim();
  if (!text) {
    throw new Error("对话模型流式响应没有返回可用内容");
  }

  return {
    text,
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

  const text = aggregatedText.trim();
  if (!text) {
    throw new Error("对话模型流式响应没有返回可用内容");
  }

  return {
    text,
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
      const result = await chatCompleteWithConfig(config, messages, reasoningEffort, tools, options);
      if (!result.text.trim()) {
        throw new Error("对话模型没有返回可用内容");
      }
      return result;
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

    if (parsed && typeof parsed === "object" && "error" in parsed && parsed.error) {
      const detail = typeof parsed.error === "object" ? parsed.error as Record<string, unknown> : {};
      const message = String(detail.message || "");
      if (/overload|capacity|busy/i.test(message)) throw new Error("对话模型调用失败：上游服务过载，请稍后重试。");
      if (/rate.?limit|429/i.test(message)) throw new Error("对话模型服务限流（429），请稍后重试。");
      // Never expose an upstream body: it may contain request details or credentials.
      throw new Error("对话模型调用失败：流式响应返回错误，请检查模型服务状态。");
    }
    serviceTier = extractServiceTier(parsed) || serviceTier;
    delta += extractChatCompletionDelta(parsed);
  }

  return { delta, serviceTier };
}

async function parseChatCompletionResponseBody(response: ModelResponseBody) {
  return (await parseChatCompletionResponseBodyWithMeta(response)).text;
}

async function parseChatCompletionResponseBodyWithMeta(response: ModelResponseBody) {
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

async function parseResponseApiBody(response: ModelResponseBody) {
  return (await parseResponseApiBodyWithMeta(response)).text;
}

async function parseResponseApiBodyWithMeta(response: ModelResponseBody) {
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

type WebResearchInput = {
  mode: Draft["mode"];
  prompt: string;
  sourceText?: string;
  supportDocContext?: string;
};

async function buildWebResearchContext(
  input: WebResearchInput,
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
  input: WebResearchInput,
  options: { signal?: AbortSignal } = {}
) {
  const supportMaterial = input.supportDocContext?.trim() && input.supportDocContext !== "未提供支持文档。"
    ? `\n\n已读取的支持文档（请据此确定检索对象和关键词）：\n${clampText(input.supportDocContext, 3_500)}`
    : "";
  const researchTask =
    input.mode === "topic"
      ? `请围绕这个写作主题联网检索最新事实，并整理成写作参考：\n${input.prompt}${supportMaterial}`
      : `请围绕这次改写任务联网检索相关最新事实，并整理成写作参考。\n改写要求：${input.prompt}\n\n原文：\n${input.sourceText || ""}${supportMaterial}`;

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
      streamWebResearchResponseText({
        messages,
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

async function streamWebResearchResponseText(input: {
  messages: ChatMessage[];
  reasoningEffort?: ChatReasoningEffort;
  tools: ChatTool[];
  maxOutputTokens?: number;
  signal?: AbortSignal;
  onDelta: (delta: string) => void;
}) {
  throwIfAborted(input.signal);
  const configs = getConfiguredWebResearchConfigs();
  if (!configs.length) {
    throw new Error("尚未配置独立的 WEB_RESEARCH_* Responses 联网接口");
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

  throw lastError instanceof Error ? lastError : new Error("Responses 联网接口暂时不可用");
}

async function buildOpenCliWebResearchContext(
  input: WebResearchInput,
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

function buildOpenCliSearchQuery(input: WebResearchInput) {
  const supportSource = input.supportDocContext && input.supportDocContext !== "未提供支持文档。"
    ? buildSupportResearchSeed(input.supportDocContext)
    : "";
  const source = [
    supportSource,
    input.prompt,
    input.mode === "rewrite" ? input.sourceText : ""
  ].filter(Boolean).join("\n");
  return clampText(source.replace(/https?:\/\/\S+/gi, " ").replace(/\s+/g, " ").trim(), 180);
}

function buildSupportResearchSeed(context: string) {
  return context
    .replace(/^用户补充资料原文：\s*$/gim, "")
    .replace(/^文档\s+\d+｜/gim, "")
    .replace(/^(?:类型|来源|读取失败)：.*$/gim, "")
    .replace(/[-#>*_`|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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

function boundedEnvInteger(name: string, fallback: number, min: number, max: number) {
  const parsed = Number.parseInt(process.env[name] || "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

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
    sampleHash: shortHash(JSON.stringify({ sampleFingerprints, learning: styleLearningSignature() }))
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
  transcript: string;
  readCache: () => Promise<StyleSampleAnalysisCache | null>;
  saveCache: (cache: StyleSampleAnalysisCache) => Promise<StyleSampleAnalysisCache>;
  messages: () => ChatMessage[];
};

type StylePreparationOptions = {
  force?: boolean;
  signal?: AbortSignal;
  onAnalysisProgress?: (progress: StyleAnalysisProgress) => void;
};

type WritePreparationOptions = {
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
};

function styleCardInstruction() {
  return [
    "根据全部已核验的逐篇分析生成 Markdown 风格卡，作为检索和写作指南。",
    "结构：账号定位；跨文体稳定习惯；目的与讲法的组合；段落衔接；不适用情形；证据与覆盖限制。",
    "稳定习惯须有多个独立样本依据，凑不够就明确说明，不固定规则数量。目的和讲法不是互斥分类：推广可以用吃瓜形式切入，不因周报或争议开头就忽略后面的介绍、推广段落。",
    "结合narrative.beats和bridges归纳怎样从趣事、问题或评论转入游戏、卖点或参与规则，引用转接前后两处原句，写清需要什么真实素材。没有转接证据就说明缺口，不能给每篇强加推广或反转。",
    "每条写法写清适用条件、具体表达动作、例外，附来源ID及提供的连续原文段落。保留能看懂开场、推进、反差和收尾的证据，不只抄口头禅。",
    "引句只能逐字引用已提供的quote或衔接before/after，不能改写；单篇证据说明有限。摘要没记录不等于账号从未使用，不推测未提供的画面或付费合作关系。",
    "证据统一写为 [[来源ID]]「完整quote原句」，每条规则附这种引用；至少保留一处，不改写quote。来源ID使用分析条目的来源字段。",
    "写作时按任务选择适用规则，规则不适用时不要硬套；不用统一开头或固定段落公式。"
  ].join("\n");
}

const emptyStyleAnalysisStats = (): StyleAnalysisStats => ({
  analysisCount: 0,
  analysisGeneratedCount: 0,
  analysisCachedCount: 0,
  analysisConcurrency: STYLE_SAMPLE_ANALYSIS_CONCURRENCY,
  inputChars: 0
});

function styleLearningSignature() {
  return { version: STYLE_SAMPLE_ANALYSIS_PROMPT_VERSION, models: configuredChatConfigs().map(c => ({
    model: c.model, wireApi: c.wireApi, endpointHash: shortHash([c.baseUrl, c.responsesUrl, c.chatCompletionsUrl].join("|"))
  })), reasoning: STYLE_REASONING_EFFORT };
}

function accountStyleAnalysisCacheKey(sample: AccountStyleSample) {
  return shortHash(JSON.stringify({
    version: 1,
    promptVersion: STYLE_SAMPLE_ANALYSIS_PROMPT_VERSION,
    learning: styleLearningSignature(),
    kind: "account-video",
    videoId: sample.video.id,
    title: sample.video.title,
    transcript: sample.transcript
  }));
}

function copySourceStyleAnalysisCacheKey(source: CopySource) {
  return shortHash(JSON.stringify({
    version: 1,
    promptVersion: STYLE_SAMPLE_ANALYSIS_PROMPT_VERSION,
    learning: styleLearningSignature(),
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
    transcript: sample.transcript,
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
    transcript: source.transcript,
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
        styleAnalysisInstruction()
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
        styleAnalysisInstruction()
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
  const analysisStartedAt = Date.now();
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
      parseStyleEvidence(cached.analysis, task.transcript, task.title);
      analysisCachedCount += 1;
      emitProgress(task);
      return styleAnalysisEntryFromCache(task, cached);
    }

    const result = await chatCompleteStrict(task.messages(), STYLE_REASONING_EFFORT, {
      signal: options.signal,
      maxOutputTokens: STYLE_SAMPLE_ANALYSIS_MAX_OUTPUT_TOKENS
    });
    const analysis = result.text.trim();
    if (result.fallback || !analysis) {
      throw new Error(
        `样本「${task.title}」风格分析失败：${result.fallbackReason || result.userMessage || "模型没有返回可用分析"}`
      );
    }

    const evidence = parseStyleEvidence(analysis, task.transcript, task.title);
    throwIfAborted(options.signal);
    const cache: StyleSampleAnalysisCache = {
      version: 1,
      cacheKey: task.cacheKey,
      kind: task.kind,
      sourceId: task.sourceId,
      title: task.title,
      inputChars: task.inputChars,
      analysis,
      evidence,
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

  logPipelineEvent("writer.sample-analysis", { totalMs: Date.now() - analysisStartedAt, analysisCount: tasks.length, analysisGeneratedCount, analysisCachedCount, concurrency: STYLE_SAMPLE_ANALYSIS_CONCURRENCY });
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
  return Boolean(cache?.version === 1 && cache.cacheKey === cacheKey && cache.evidence?.narrative && cache.analysis.trim());
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
  let failed = false;
  const outcomes = await Promise.allSettled(
    Array.from({ length: workerCount }, async () => {
      while (!failed && nextIndex < items.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        try {
          results[currentIndex] = await run(items[currentIndex], currentIndex);
        } catch (error) {
          failed = true;
          throw error;
        }
      }
    })
  );
  const failure = outcomes.find(outcome => outcome.status === "rejected");
  if (failure?.status === "rejected") throw failure.reason;
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

function styleEvidenceQuotes(entries: StyleAnalysisEntry[]) {
  return entries.flatMap(entry => {
    const data = parseModelJson(entry.analysis, "样本分析") as StyleEvidence;
    return collectStyleEvidenceQuotes(data).map(quote => ({ sourceId: entry.sourceId, quote }));
  });
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
  if (!options.force && styleMeta?.sampleHash === sampleState.sampleHash && currentStyle && !styleMeta.fallback) {
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
  const messages: ChatMessage[] = [
    { role: "system", content: styleCardInstruction() },
    { role: "user", content: `账号：${account.name}\n平台：${platform}\n已有卡仅作基线，不沿用无证据结论：\n${currentStyle}\n\n全部逐篇分析及核验原句：\n${corpus}` }
  ];

  return {
    platform,
    accountId,
    accountName: account.name,
    messages,
    fallback,
    ...sampleState,
    generationMode,
    analysisStats: analysis.stats,
    previousStyleHash: shortHash(currentStyle),
    evidenceQuotes: styleEvidenceQuotes(analysis.entries)
  };
}

export async function completePreparedAccountStyle(
  context: PreparedAccountStyleContext,
  result: ChatCompletionResult,
  timings: StyleCompletionTimings = {}
): Promise<AccountStyleGenerationResult> {
  const generatedStyle = result.text.trim();
  if (!result.ok || result.fallback || !generatedStyle) throw new Error(result.userMessage || result.fallbackReason || "风格卡生成失败，原卡已保留，请重试。");
  validateStyleCardCitations(generatedStyle, context.evidenceQuotes);
  const style = preserveWriterPreferences(generatedStyle || context.fallback, await readStyle(context.platform, context.accountId));
  const isFallbackResult = result.fallback || !generatedStyle;
  const shouldUpdateSampleCache = Boolean(generatedStyle) && !isFallbackResult;
  const shouldSaveStyle = Boolean(style.trim());

  if (shouldSaveStyle) {
    await saveStyle(context.platform, context.accountId, style, context.previousStyleHash);
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
  options: StylePreparationOptions = {}
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
    learning: styleLearningSignature(),
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
  previousStyleHash?: string;
  evidenceQuotes?: Array<{ sourceId: string; quote: string }>;
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
  if (!options.force && styleMeta?.sampleHash === sampleState.sampleHash && trimmedCurrentStyle && !styleMeta.fallback) {
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
          styleCardInstruction() + "\n这是项目风格，只在项目已指定来源范围内归纳。"
      },
      {
        role: "user",
        content: `项目：${project.name}\n项目说明：${project.description || "暂无"}\n\n参考素材：\n${corpus}`
      }
    ],
    fallback,
    sampleState,
    analysisStats: analysis.stats,
    previousStyleHash: shortHash(trimmedCurrentStyle),
    evidenceQuotes: styleEvidenceQuotes(analysis.entries)
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
  if (!result.ok || result.fallback || !generatedStyle) throw new Error(result.userMessage || result.fallbackReason || "项目风格生成失败，原卡已保留，请重试。");
  validateStyleCardCitations(generatedStyle, context.evidenceQuotes);
  const style = preserveWriterPreferences(generatedStyle || context.fallback, await readProjectStyle(context.projectId));
  const isFallbackResult = result.fallback || !generatedStyle;
  await saveProjectStyle(context.projectId, style, context.previousStyleHash);

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

export async function writeCopy(
  input: WriteCopyInput,
  options: { signal?: AbortSignal } = {}
): Promise<WriteGenerationResult> {
  if (input.action === "revise") {
    const prepared = await prepareWriteCopyContext(input, options);
    const result = await chatCompleteWithFallback(prepared.messages, WRITE_COPY_REASONING_EFFORT, undefined, {
      signal: options.signal,
      maxOutputTokens: WRITE_COPY_MAX_OUTPUT_TOKENS
    });
    throwIfAborted(options.signal);
    return completePreparedWriteCopy({ prepared, result, save: input.save, signal: options.signal });
  }

  const batch = await prepareWriteCopyBatchContext(input, options);
  const outcomes = await Promise.all(batch.variants.map(async (variant) => {
    try {
      const result = await chatCompleteWithFallback(variant.prepared.messages, WRITE_COPY_REASONING_EFFORT, undefined, {
        signal: options.signal,
        maxOutputTokens: WRITE_COPY_MAX_OUTPUT_TOKENS
      });
      return {
        result: await completePreparedWriteVariant({
          variant,
          result,
          save: input.save,
          signal: options.signal
        })
      };
    } catch (error) {
      if (isAbortError(error)) throw error;
      return { failure: writeVariantFailure(variant, error) };
    }
  }));
  throwIfAborted(options.signal);
  return resolveWriteBatchOutcome(batch, outcomes);
}

export async function completePreparedWriteCopy(input: {
  prepared: PreparedWriteContext;
  result: ChatCompletionResult;
  save?: boolean;
  signal?: AbortSignal;
}): Promise<WriteResult> {
  throwIfAborted(input.signal);
  const content = resolvePreparedWriteContent(input.result);
  const issues = input.prepared.draftBase?.version?.origin === "revision" ? [] : checkWriterConstraints(content, (input.prepared.writerContext || input.prepared.draftBase?.writerContext)?.plan?.task);
  const research = [input.prepared.research, ...(issues.length ? [`成稿检查（需修改）：\n${issues.join("；")}`] : [])].filter(Boolean).join("\n\n");
  const prepared = { ...input.prepared, research, draftBase: input.prepared.draftBase ? { ...input.prepared.draftBase, research } : undefined };
  const draft = await savePreparedDraft({ save: input.save }, prepared, content);

  return {
    content,
    research,
    contextFingerprint: input.prepared.contextFingerprint,
    sourceDigest: input.prepared.sourceDigest,
    draft,
    usedModel: input.result.model,
    fallback: input.result.fallback,
    fallbackReason: input.result.fallbackReason
  };
}

export async function completePreparedWriteVariant(input: {
  variant: PreparedWriteVariantContext;
  result: ChatCompletionResult;
  save?: boolean;
  signal?: AbortSignal;
}): Promise<WriteVariantResult> {
  const completed = await completePreparedWriteCopy({
    prepared: input.variant.prepared,
    result: input.result,
    save: input.save,
    signal: input.signal
  });
  return {
    ...completed,
    styleKey: input.variant.styleKey,
    styleTitle: input.variant.styleTitle,
    styleReference: input.variant.styleReference
  };
}

export function writeVariantFailure(
  variant: PreparedWriteVariantContext,
  error: unknown
): WriteVariantFailure {
  return {
    styleKey: variant.styleKey,
    styleTitle: variant.styleTitle,
    styleReference: variant.styleReference,
    error: error instanceof Error ? error.message : "文案生成失败"
  };
}

export function resolveWriteBatchOutcome(
  batch: PreparedWriteBatchContext,
  outcomes: Array<{ result?: WriteVariantResult; failure?: WriteVariantFailure }>
): WriteGenerationResult {
  const results = outcomes.flatMap((outcome) => outcome.result ? [outcome.result] : []);
  const failures = [...(batch.preparationFailures || []), ...outcomes.flatMap((outcome) => outcome.failure ? [outcome.failure] : [])];
  if (!results.length) {
    const reasons = failures.map((failure) => `${failure.styleTitle}：${failure.error}`).join("；");
    throw new Error(reasons || "所有风格的文案都生成失败，请检查模型配置后重试。");
  }
  if (batch.variants.length === 1 && failures.length === 0) return results[0];
  const result: WriteBatchResult = {
    kind: "write-batch",
    results,
    failures,
    research: batch.research,
    sourceDigest: batch.sourceDigest
  };
  return result;
}

export async function prepareWriteCopyContext(input: WriteCopyInput, options: { signal?: AbortSignal } = {}): Promise<PreparedWriteContext> {
  throwIfAborted(options.signal);
  if (input.action === "revise") {
    return prepareWriteRevisionContext(input, options);
  }
  const batch = await prepareWriteCopyBatchContext(input, options);
  if (batch.variants.length !== 1 || batch.preparationFailures?.length) {
    throw new Error("多选风格会分别生成多篇文案，请使用并发写作流程");
  }
  return batch.variants[0].prepared;
}

async function measureWritePreparation<T>(
  traceId: string,
  stage: string,
  options: WritePreparationOptions,
  message: string,
  run: () => Promise<T>
): Promise<T> {
  options.onProgress?.(message);
  const startedAt = Date.now();
  try {
    const result = await run();
    logPipelineEvent("writer.preparation", { traceId, stage, status: "completed", totalMs: Date.now() - startedAt });
    return result;
  } catch (error) {
    logPipelineEvent("writer.preparation", { traceId, stage, status: "failed", totalMs: Date.now() - startedAt });
    throw error;
  }
}

export async function prepareWriteCopyBatchContext(
  input: WriteCopyInput,
  options: WritePreparationOptions = {}
): Promise<PreparedWriteBatchContext> {
  throwIfAborted(options.signal);
  if (input.action === "revise") throw new Error("续改只针对当前选中的单篇稿件");
  if (input.useWebResearch) {
    const capability = getWebResearchCapability();
    if (!capability.available) throw new Error(capability.reason);
  }

  const originalSourceInput = input.originalSourceInput
    ?? mergeWriterSourceInput(input.sourceText, input.supportDocLinks);
  const traceId = randomUUID();
  const normalizedInput = await measureWritePreparation(traceId, "source", options, "正在解析本次素材", () => normalizeWriteCopyInput({
    ...input,
    originalSourceInput
  }, options));
  throwIfAborted(options.signal);
  const styleInputs = normalizeWriteStyleReferenceInputs(normalizedInput);
  if (!styleInputs.length) throw new Error("请选择至少一个参考风格");

  const userTask =
    normalizedInput.mode === "topic"
      ? `请基于这个主题生成文案：\n${normalizedInput.prompt}`
      : `请按所选参考风格改写下面文案。改写要求：${normalizedInput.prompt}\n\n原文素材：\n${normalizedInput.sourceText || ""}`;
  const supportDocContext = await measureWritePreparation(traceId, "support-documents", options, "正在读取支持文档", () => buildSupportDocumentContext(normalizedInput.supportDocLinks, options));
  const webContext = normalizedInput.useWebResearch
    ? await measureWritePreparation(traceId, "web-research", options, "正在联网检索资料", () => buildWebResearchContext({ ...normalizedInput, supportDocContext }, options))
    : "未启用联网检索。";
  const taskContext = `用户本次要求：\n${normalizedInput.prompt}\n\n原始资料：\n${normalizedInput.sourceText || ""}\n\n支持文档：\n${supportDocContext}\n\n检索资料：\n${webContext}`;
  const preparation = await Promise.allSettled(styleInputs.map((reference, index) =>
    measureWritePreparation(traceId, `style-preparation-${index + 1}`, options, "正在准备风格分析与写作参考", () => resolveWriteStyleContext(reference, true, taskContext, options))));
  throwIfAborted(options.signal);
  const styleContexts: WriteStyleContext[] = [];
  const preparationFailures: WriteVariantFailure[] = [];
  for (const [index, outcome] of preparation.entries()) {
    if (outcome.status === "fulfilled") { styleContexts.push(outcome.value); continue; }
    const reference = styleInputs[index];
    const styleTitle = reference.targetType === "account" ? reference.accountId : reference.projectId;
    preparationFailures.push({ styleKey: writeStyleReferenceKey(reference), styleTitle,
      styleReference: reference.targetType === "account" ? { ...reference, accountName: styleTitle } : { ...reference, projectName: styleTitle },
      error: outcome.reason instanceof Error ? outcome.reason.message : "准备风格参考失败" });
  }
  if (!styleContexts.length) throw new Error(preparationFailures.map(f => `${f.styleTitle}：${f.error}`).join("；"));
  const research = buildReferenceSummary({
    supportDocLinks: normalizedInput.supportDocLinks,
    supportDocContext,
    useWebResearch: normalizedInput.useWebResearch,
    webContext
  });
  const sourceDigest = buildWriteSourceDigest(normalizedInput);

  return {
    preparationFailures,
    variants: styleContexts.map((styleContext) => {
      const styleInput = styleContext.reference;
      const variantInput: WriteCopyInput = {
        ...normalizedInput,
        targetType: styleInput.targetType,
        platform: styleInput.targetType === "account" ? styleInput.platform : undefined,
        accountId: styleInput.targetType === "account" ? styleInput.accountId : undefined,
        projectId: styleInput.targetType === "project" ? styleInput.projectId : undefined,
        styleRefs: [styleInput]
      };
      const contextFingerprint = shortHash(JSON.stringify({ input: buildWriteContextFingerprint(variantInput), snapshot: styleContext.snapshot }));
      const variantResearch = [research, formatWriterPreparationNotes(styleContext.snapshot)].filter(Boolean).join("\n\n");
      return {
        styleKey: writeStyleReferenceKey(styleContext.reference),
        styleTitle: styleContext.title,
        styleReference: styleContext.reference,
        prepared: {
          writerContext: styleContext.snapshot,
          messages: buildInitialWriteMessages({ styleContext, supportDocContext, webContext, userTask }),
          research: variantResearch,
          contextFingerprint,
          sourceDigest,
          draftBase: buildPreparedWriteDraftBase({
            input: variantInput,
            styleContexts: [styleContext],
            research: variantResearch,
            sourceDigest,
            contextFingerprint,
            includeStyleInTitle: styleContexts.length > 1
          })
        }
      };
    }),
    research,
    sourceDigest
  };
}

function buildInitialWriteMessages(input: {
  styleContext: WriteStyleContext;
  supportDocContext: string;
  webContext: string;
  userTask: string;
}): ChatMessage[] {
  return [
    {
      role: "system",
      content:
        "你是中文短视频文案写手。本次只使用用户指定的这一张风格卡及其代表样本，独立完成一篇成稿。不要融合、借用或补入其他账号或项目的风格，也不要输出中间策划过程、创作思路或审稿意见。"
    },
    {
      role: "user",
      content: [
        `本篇唯一参考风格：\n${formatWriteStyleContexts([input.styleContext], true)}`,
        `支持文档资料：\n${input.supportDocContext}`,
        `联网检索资料：\n${input.webContext}`,
        `任务：\n${input.userTask}`,
        "先在内部判断本次素材适合怎样的开头、叙事与衔接，选择参考中适用的写法，然后直接输出正文；不输出计划。用户明确保存的写作偏好只约束表达，本次明确要求优先。",
        [
          "写作边界：",
          "1. 只输出可直接使用的成稿，不解释创作思路。",
          "2. 开头方式、句长、节奏、具象程度和结尾方式只服从本篇风格卡与代表样本，不自行补统一模板。",
          "3. 推广目的与吃瓜、趣事等讲法可以组合，按本次资料选择有依据的切入，并自然承接到游戏、卖点或活动规则。参考段落只学承接方法，不搬用旧事件，不为制造悬念编造爆料、争议、玩家反应或亲身经历；资料不支持时换合适切入。不照搬整套栏目结构。",
          "4. 事实仅来自本次用户资料、支持文档和检索资料；范文只学表达，其中旧产品、事件、数字和个人经历不能成为本次事实。事实冲突不可自行认定，宣传评价不得升级为实测结论。",
          "5. 保留明确必留信息、指定原话及硬性品牌口径。普通素材顺序、创意示例与未锁定框架均可重组；要求不完整时依据目的选择合理切入，不发明客户要求。用户明确要求润色或保留框架时遵从。",
          "6. 输出前核对明确字数和禁用词。字数按汉字、字母和数字计数，不计标点空白；未给字数时不自行增加硬性范围。"
        ].join("\n")
      ].join("\n\n")
    }
  ];
}

async function prepareWriteRevisionContext(
  input: WriteCopyInput,
  options: { signal?: AbortSignal } = {}
): Promise<PreparedWriteContext> {
  throwIfAborted(options.signal);
  if (!input.parentDraftId) throw new Error("请选择要继续修改的稿件版本");

  const instruction = input.revisionInstruction?.trim() || "";
  if (!instruction) throw new Error("请填写本轮修改要求");

  const currentContent = input.currentContent?.trim() || "";
  if (!currentContent) throw new Error("当前稿件内容为空，无法继续修改");

  const scope = input.revisionScope === "selection" ? "selection" : "full";
  const selectedText = input.selectedText?.trim() || "";
  if (scope === "selection" && !selectedText) {
    throw new Error("请先在稿件中选中需要修改的段落");
  }

  const resolved = await resolveDraft(input.parentDraftId);
  const parent = resolved.draft;
  const isProject = parent.targetType === "project";
  const references = draftWriteStyleReferenceInputs(parent);
  const snapshot = parent.writerContext;
  if (snapshot && !references.some(reference => writeStyleReferenceKey(reference) === snapshot.referenceKey)) {
    throw new Error("草稿风格快照与当前引用不一致，请从原始资料重新生成。");
  }
  if (snapshot && (shortHash(snapshot.styleText) !== snapshot.styleHash || snapshot.samples.some(sample => shortHash(sample.text) !== sample.hash))) {
    throw new Error("草稿风格快照校验失败，请检查历史版本；不会改用最新风格覆盖。");
  }
  const styleContexts: WriteStyleContext[] = snapshot ? [{
    reference: (parent.styleRefs?.[0] || (parent.targetType === "project"
      ? { targetType: "project", projectId: parent.projectId, projectName: parent.projectName }
      : { targetType: "account", platform: parent.platform, accountId: parent.accountId, accountName: parent.accountName })) as WriteStyleReference,
    title: parent.targetType === "project" ? parent.projectName : parent.accountName,
    subtitle: "本稿保存的风格与参考", style: snapshot.styleText, sampleContext: formatSnapshotSamples(snapshot), snapshot
  }] : await Promise.all(references.map(reference => resolveWriteStyleContext(reference, false)));
  const targetName = styleContexts.map(context => context.title).join("、");
  const style = formatWriteStyleContexts(styleContexts, true);
  const revisionSnapshot: WriterContextSnapshot = snapshot || {
    schemaVersion: 1, promptVersion: WRITE_PROMPT_VERSION, referenceKey: writeStyleReferenceKey(styleContexts[0].reference),
    styleText: styleContexts.map(c => c.style).join("\n\n"), styleHash: shortHash(styleContexts.map(c => c.style).join("\n\n")),
    samples: [], plan: null, notes: ["旧稿未保存原始风格快照：本次使用当前关联风格卡并保存，未重新采集或选样。"],
    preparedAt: nowIso(), compatibility: "legacy-current-style"
  };
  const recalibrate = input.revisionMode === "recalibrate";
  const revisionResearch = [parent.research, ...(!snapshot ? revisionSnapshot.notes : [])].filter(Boolean).join("\n\n");
  const contextFingerprint = parent.version?.contextFingerprint || buildWriteContextFingerprint({
    action: "create",
    targetType: isProject ? "project" : "account",
    platform: isProject ? undefined : parent.platform,
    accountId: isProject ? undefined : parent.accountId,
    projectId: isProject ? parent.projectId : undefined,
    styleRefs: draftWriteStyleReferenceInputs(parent),
    mode: parent.mode,
    prompt: parent.prompt,
    sourceText: parent.input,
    supportDocLinks: parent.supportDocLinks,
    useWebResearch: parent.sourceDigest?.webResearchEnabled
  });
  const sourceDigest = parent.sourceDigest || buildWriteSourceDigest({
    mode: parent.mode,
    prompt: parent.prompt,
    sourceText: parent.input
  });
  const version = {
    sessionId: parent.version?.sessionId || parent.id,
    parentDraftId: parent.id,
    revision: (parent.version?.revision || 1) + 1,
    instruction,
    contextFingerprint,
    promptVersion: WRITE_PROMPT_VERSION,
    origin: "revision" as const
  };
  const scopeInstruction = scope === "selection"
    ? `只重写下面选中的段落，并把修改后的段落放回原位置。除必要衔接外，其他段落保持不变。\n\n选中段落：\n${selectedText}`
    : recalibrate ? "根据本稿保存的风格规则与原文证据重新组织全文；保留已确认事实和硬约束，不将当前稿件的句法当作必须模仿的模板。" : "按本轮要求修改全文；没有被要求调整的事实、结构和表达尽量保持不变。";
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: [
        recalibrate ? "你是中文短视频文案修订编辑。本轮重新校准风格，按已保存的表达证据重组允许修改的内容，保留事实和明确硬约束。" : "你是中文短视频文案修订编辑。你的任务是在现有成稿上做有边界的修改，而不是重新另写一篇。",
        "只输出修改后的完整成稿，不解释修改过程，不输出差异说明。",
        recalibrate ? "未锁定的结构、类比和衔接可以重写；选中段落模式下范围外仍不改。" : "未被本轮要求点名的事实、产品信息、梗、结构和语气尽量保持不变。",
        "表达方式以当前稿件和它保存的风格卡为准；不要在续改时引入其他账号或项目的风格。",
        "不得添加原始素材及已保存事实资料没有依据的新事实；风格样本不是事实来源，旧稿的无依据说法也不能作为证据。"
      ].join("\n")
    },
    {
      role: "user",
      content: [
        `参考对象：${targetName}`,
        `当前版本：V${parent.version?.revision || 1}`,
        `原始要求：${parent.prompt}`,
        `本稿任务约束与写法：${JSON.stringify(revisionSnapshot.plan)}`,
        `兼容说明：${revisionSnapshot.notes.join("；")}`,
        `本轮修改要求：\n${instruction}`,
        `修改范围：\n${scopeInstruction}`,
        ...(parent.brief ? [`历史策划备注：\n${clampText(parent.brief, 12_000)}`] : []),
        `风格卡：\n${style}`,
        parent.input ? `原始素材：\n${parent.input}` : "原始素材：未保存",
        parent.research ? `已保存参考资料：\n${parent.research}` : "已保存参考资料：无",
        `当前完整稿件：\n${clampText(currentContent, 70_000)}`,
        [
          "输出检查：",
          "1. 输出必须是完整成稿，不能只返回局部段落。",
          "2. 本轮要求优先级最高，但不得突破已有事实边界。",
          "3. 修改范围外的内容不要无故换词、换结构或删减。",
          recalibrate ? "4. 依据已保存参考的适用写法调整句法、节奏与收尾，不硬套不适用的栏目结构。" : "4. 保持当前稿件原有的句法、停顿、段落长度和收尾方式。"
        ].join("\n")
      ].join("\n\n")
    }
  ];
  const sharedDraftBase = {
    title: parent.title,
    mode: parent.mode,
    prompt: parent.prompt,
    originalSourceInput: parent.originalSourceInput,
    input: parent.input,
    supportDocLinks: parent.supportDocLinks,
    brief: parent.brief,
    research: revisionResearch,
    sourceDigest,
    writerContext: revisionSnapshot,
    styleRefs: parent.styleRefs?.length ? parent.styleRefs : styleContexts.map((context) => context.reference),
    version
  };
  const draftBase: PreparedWriteContext["draftBase"] = isProject
    ? {
        ...sharedDraftBase,
        targetType: "project",
        projectId: parent.projectId,
        projectName: parent.projectName,
        styleRef: parent.styleRef
      }
    : {
        ...sharedDraftBase,
        platform: parent.platform,
        accountId: parent.accountId,
        accountName: parent.accountName,
        styleRef: parent.styleRef
      };

  return {
    messages,
    research: revisionResearch,
    contextFingerprint,
    sourceDigest,
    draftBase
  };
}

type WriteStyleContext = {
  reference: WriteStyleReference;
  title: string;
  subtitle: string;
  style: string;
  sampleContext?: string;
  snapshot?: WriterContextSnapshot;
};

async function resolveWriteStyleContext(
  reference: WriteStyleReferenceInput,
  includeSamples: boolean,
  taskContext = "",
  options: WritePreparationOptions = {}
): Promise<WriteStyleContext> {
  let context: WriteStyleContext;
  const candidates: FastReference[] = [];
  const collectAccount = async (platform: Platform, accountId: string) => {
    const samples = await getTopTranscriptSamples(platform, accountId, "all");
    if (!samples.length) return;
    options.onProgress?.("正在匹配已有博主原文，不重复学习");
    for (const task of buildAccountStyleAnalysisTasks(platform, accountId, samples)) {
      const cached = await task.readCache();
      // A changed model endpoint does not invalidate evidence on the write path.
      // Quotes must still match the current source; incompatible evidence is explicit.
      let indexText = "";
      if (cached?.analysis) {
        try { indexText = JSON.stringify(parseStyleEvidence(cached.analysis, task.transcript, task.title)); }
        catch { options.onProgress?.("部分旧分析与当前原文不符，本次直接匹配原文；可更新风格重新学习。"); }
      }
      candidates.push({ id: `${platform}:${accountId}:${task.sourceId}`, title: task.title, transcript: task.transcript, indexText });
    }
  };
  if (reference.targetType === "account") {
    const account = await resolveAccount(reference.platform, reference.accountId);
    context = { reference: { targetType: "account", platform: account.platform, accountId: account.id, accountName: account.name },
      title: account.name, subtitle: `账号风格｜${account.platform}`, style: await readStyle(account.platform, account.id) };
    if (includeSamples) await collectAccount(account.platform, account.id);
  } else {
    const project = await resolveProject(reference.projectId);
    context = { reference: { targetType: "project", projectId: project.id, projectName: project.name,
      sourceAccountIds: project.sourceAccountIds, sourceMaterialIds: project.sourceMaterialIds },
      title: project.name, subtitle: `项目风格｜${project.description || project.name}`, style: await readProjectStyle(project.id) };
    if (includeSamples) {
      for (const accountId of project.sourceAccountIds) {
        await collectAccount(accountId.split(":")[0] as Platform, accountId);
      }
      const sources = await resolveProjectCopySourcesForStyle(project.sourceMaterialIds || []);
      for (const source of sources) {
        candidates.push({ id: `material:${source.id}`, title: source.title, transcript: source.transcript });
      }
    }
  }
  if (!includeSamples) return context;
  const unique = [...new Map(candidates.map(c => [shortHash(c.transcript.replace(/\s/g, "")), c])).values()];
  const snapshot: WriterContextSnapshot = {
    schemaVersion: 1, promptVersion: WRITE_PROMPT_VERSION, referenceKey: writeStyleReferenceKey(context.reference),
    styleText: context.style, styleHash: shortHash(context.style), samples: [], plan: null,
    notes: [], preparedAt: nowIso()
  };
  snapshot.samples = selectFastReferences(unique, taskContext);
  snapshot.plan = fastWriterPlan(taskContext, snapshot.samples);
  snapshot.notes = ["直接写作：使用已有风格卡与本地匹配原文，在正文生成时完成构思；未调用模型逐篇分析或单独生成计划。"];
  if (!snapshot.samples.length) snapshot.notes.push("没有可用原文，本次仅使用现有风格卡；补充博主作品有助于提高相似度。");
  options.onProgress?.(`已匹配「${context.title}」的 ${snapshot.samples.length} 份原文参考，准备直接出稿`);
  if (context.reference.targetType === "account") {
    context.reference.videoIds = snapshot.samples.map(sample => sample.id.split(":").at(-1)!);
  }
  return { ...context, snapshot, sampleContext: formatSnapshotSamples(snapshot) };
}

function formatSnapshotSamples(snapshot: WriterContextSnapshot) {
  return snapshot.samples.map(s => `原文ID：${s.id}｜${s.title}\n本次用途：${s.reason}\n${s.text}`).join("\n\n---\n\n");
}

function formatWriterPreparationNotes(snapshot?: WriterContextSnapshot) {
  if (!snapshot) return "";
  return ["本次风格参考：", ...snapshot.samples.map(s => `- ${s.title}：${s.reason}`),
    ...snapshot.notes.map(note => `- ${note}`),
    ...(snapshot.plan ? [`表达用途：${snapshot.plan.task.purpose}`, `可改范围：${snapshot.plan.task.creativeFreedom}`,
      ...snapshot.plan.task.uncertainties.map(note => `待核实：${note}`)] : [])].join("\n");
}

function formatWriteStyleContexts(contexts: WriteStyleContext[], includeSamples: boolean) {
  return contexts.map((context, index) => [
    `## ${contexts.length > 1 ? `风格卡 ${index + 1}` : "风格卡"}｜${context.title}`,
    context.subtitle,
    `风格卡：\n${includeSamples ? context.style : clampText(context.style, 12_000)}`,
    ...(includeSamples ? [`代表样本：\n${context.sampleContext || "暂无样本，仅参考风格卡。"}`] : [])
  ].join("\n\n")).join("\n\n---\n\n");
}

function buildPreparedWriteDraftBase(input: {
  input: WriteCopyInput;
  styleContexts: WriteStyleContext[];
  research?: string;
  sourceDigest: WriteSourceDigest;
  contextFingerprint: string;
  includeStyleInTitle?: boolean;
}): PreparedWriteContext["draftBase"] {
  const reference = input.styleContexts[0].reference;
  const shared = {
    title: input.includeStyleInTitle
      ? `${makeTitleFromPrompt(input.input.prompt)} · ${input.styleContexts[0].title}`
      : makeTitleFromPrompt(input.input.prompt),
    mode: input.input.mode,
    prompt: input.input.prompt,
    originalSourceInput: input.input.originalSourceInput?.trim()
      ? input.input.originalSourceInput
      : undefined,
    input: input.input.sourceText,
    supportDocLinks: input.input.supportDocLinks,
    research: input.research,
    sourceDigest: input.sourceDigest,
    writerContext: input.styleContexts[0].snapshot,
    styleRefs: input.styleContexts.map((context) => context.reference),
    version: createInitialDraftVersion(input.contextFingerprint)
  };

  if (reference.targetType === "project") {
    return {
      ...shared,
      targetType: "project",
      projectId: reference.projectId,
      projectName: reference.projectName,
      styleRef: {
        projectId: reference.projectId,
        projectName: reference.projectName,
        sourceAccountIds: reference.sourceAccountIds,
        sourceMaterialIds: reference.sourceMaterialIds
      }
    };
  }

  return {
    ...shared,
    targetType: "account",
    platform: reference.platform,
    accountId: reference.accountId,
    accountName: reference.accountName,
    styleRef: {
      platform: reference.platform,
      accountId: reference.accountId,
      accountName: reference.accountName,
      videoIds: reference.videoIds
    }
  };
}

function buildWriteContextFingerprint(input: WriteCopyInput) {
  const styleRefs = normalizeWriteStyleReferenceInputs(input);
  return shortHash(JSON.stringify({
    promptVersion: WRITE_PROMPT_VERSION,
    targetType: input.targetType || (input.projectId ? "project" : "account"),
    platform: input.platform || "",
    accountId: input.accountId || "",
    projectId: input.projectId || "",
    styleRefs,
    mode: input.mode,
    prompt: input.prompt.trim(),
    sourceText: input.sourceText?.trim() || "",
    supportDocLinks: (input.supportDocLinks || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .join("\n"),
    useWebResearch: Boolean(input.useWebResearch)
  }));
}

function createInitialDraftVersion(contextFingerprint: string) {
  return {
    sessionId: `writing-${randomUUID()}`,
    revision: 1,
    contextFingerprint,
    promptVersion: WRITE_PROMPT_VERSION,
    origin: "generated" as const
  };
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

  if (!hasSupportDocumentReference(trimmed)) {
    return `用户粘贴的支持资料：\n${trimmed}`;
  }

  const documents = await fetchSupportDocuments(trimmed, { signal: options.signal });
  const readableDocuments = documents.filter((document) => document.content?.trim());
  if (!readableDocuments.length && !hasPlainSupportText(trimmed)) {
    const reasons = documents.length
      ? documents.map((document) => `${supportDocumentProviderLabel(document.provider)}：${document.error || "没有返回可用正文"}`)
      : ["没有识别到可读取的文档链接"];
    throw new Error(`支持文档读取失败：${reasons.join("；")}。请确认链接已开放查看权限，或直接粘贴正文。`);
  }

  const blocks: string[] = [];
  if (hasPlainSupportText(trimmed)) {
    blocks.push(`用户补充资料原文：\n${trimmed}`);
  }

  blocks.push(...documents.map((document, index) => {
    const title = document.title?.trim() || `文档 ${index + 1}`;
    const provider = supportDocumentProviderLabel(document.provider);
    if (document.content?.trim()) {
      return `文档 ${index + 1}｜${title}\n类型：${provider}\n来源：${document.url}\n${document.content}`;
    }
    return `文档 ${index + 1}｜${title}\n类型：${provider}\n来源：${document.url}\n读取失败：${document.error || "没有返回可用正文"}`;
  }));

  return clampText(blocks.join("\n\n---\n\n"), 20_000);
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

async function normalizeWriteCopyInput(input: WriteCopyInput, options: { signal?: AbortSignal } = {}): Promise<WriteCopyInput> {
  const combinedSourceInput = [input.sourceText?.trim(), input.supportDocLinks?.trim()].filter(Boolean).join("\n\n");
  const separatedInput = splitWriterSourceInput(input.sourceText || "", input.supportDocLinks || "");
  const prompt = normalizeRewritePrompt(input.mode, input.prompt, combinedSourceInput);
  throwIfAborted(options.signal);

  if (input.mode !== "rewrite") {
    return {
      ...input,
      prompt,
      sourceText: separatedInput.sourceText || undefined,
      supportDocLinks: separatedInput.supportDocLinks || undefined
    };
  }

  const sourceText = await normalizeRewriteSourceText(separatedInput.sourceText, options);

  return {
    ...input,
    prompt,
    sourceText,
    supportDocLinks: separatedInput.supportDocLinks || undefined
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

function resolvePreparedWriteContent(result: ChatCompletionResult) {
  if (!result.ok) {
    throw new Error(result.userMessage || result.fallbackReason || "模型没有返回完整文案，请检查模型配置后重试。");
  }
  if (result.text.trim()) return result.text;
  throw new Error(result.fallbackReason || "模型没有返回可用文案，请检查模型配置后重试。");
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

## 分析状态
- 模型没有返回可用的风格分析，本卡不添加统一开头、句长、结构或结尾模板。
- 生成文案前请优先重新分析完整样本；当前仅保留一段原始语料供人工判断。

## 样本线索
${shortCorpus || "- 暂无可提取线索。"}
`;
}
