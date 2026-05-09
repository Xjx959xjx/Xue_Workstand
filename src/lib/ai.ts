import { promises as fs } from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { fetch as undiciFetch, ProxyAgent, type RequestInit as UndiciRequestInit } from "undici";
import { Draft, Platform, WriteResult } from "./types";
import { clampText, makeTitleFromPrompt } from "./utils";
import {
  getTopTranscriptSamples,
  libraryRoot,
  resolveAccount,
  resolveProject,
  saveDraft,
  saveProjectStyle,
  saveStyle
} from "./storage";

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ChatWireApi = "responses" | "chat_completions";
type ChatCompletionResult = {
  text: string;
  model: string;
  fallback: boolean;
  fallbackReason?: string;
};

type FetchInitWithDispatcher = UndiciRequestInit & {
  dispatcher?: ProxyAgent;
};

const execFileAsync = promisify(execFile);
const WEB_RESEARCH_TIMEOUT_MS = 12_000;

function chatConfig() {
  return {
    apiKey: process.env.CHAT_API_KEY || "",
    baseUrl: (process.env.CHAT_BASE_URL || "https://www.fhl.mom").replace(/\/$/, ""),
    model: process.env.CHAT_MODEL || "gpt-5.5",
    wireApi: normalizeWireApi(process.env.CHAT_WIRE_API),
    proxyUrl: process.env.CHAT_PROXY_URL || ""
  };
}

export function getChatRuntimeConfig() {
  const config = chatConfig();
  return {
    baseUrl: config.baseUrl,
    model: config.model,
    wireApi: config.wireApi,
    proxyConfigured: Boolean(config.proxyUrl),
    configured: Boolean(config.apiKey && config.model)
  };
}

export async function chatComplete(messages: ChatMessage[]): Promise<ChatCompletionResult> {
  const config = chatConfig();
  if (!config.apiKey || !config.model) {
    return fallbackChatCompletion(config.model || "local-fallback");
  }

  if (config.wireApi === "responses") {
    return createResponse(config, messages);
  }

  return createChatCompletion(config, messages);
}

async function createChatCompletion(
  config: ReturnType<typeof chatConfig>,
  messages: ChatMessage[]
): Promise<ChatCompletionResult> {
  const init: FetchInitWithDispatcher = {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      temperature: 0.75
    }),
    dispatcher: chatDispatcher(config.proxyUrl)
  };
  const response = await undiciFetch(`${config.baseUrl}/chat/completions`, init);

  if (!response.ok) {
    throw new Error(describeChatHttpFailure(response.status, await response.text(), response.headers.get("content-type")));
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  return {
    text: data.choices?.[0]?.message?.content?.trim() || "",
    model: config.model,
    fallback: false
  };
}

async function createResponse(
  config: ReturnType<typeof chatConfig>,
  messages: ChatMessage[]
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

  const init: FetchInitWithDispatcher = {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: config.model,
      instructions: system || undefined,
      input,
      temperature: 0.75,
      store: false
    }),
    dispatcher: chatDispatcher(config.proxyUrl)
  };
  const response = await undiciFetch(`${config.baseUrl}/responses`, init);

  if (!response.ok) {
    throw new Error(describeChatHttpFailure(response.status, await response.text(), response.headers.get("content-type")));
  }

  const data = (await response.json()) as unknown;
  return {
    text: extractResponseText(data),
    model: config.model,
    fallback: false
  };
}

function normalizeWireApi(value?: string): ChatWireApi {
  return value === "chat_completions" || value === "chat-completions" ? "chat_completions" : "responses";
}

function fallbackChatCompletion(model = "local-fallback", error?: unknown): ChatCompletionResult {
  return {
    text: "",
    model,
    fallback: true,
    fallbackReason: error ? buildChatFallbackReason(error) : undefined
  };
}

async function chatCompleteWithFallback(messages: ChatMessage[]): Promise<ChatCompletionResult> {
  try {
    return await chatComplete(messages);
  } catch (error) {
    return fallbackChatCompletion("local-fallback", error);
  }
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

function buildChatFallbackReason(error: unknown) {
  return `${summarizeChatFailure(error)}，已自动切换到本地模板，可先编辑后再重试。`;
}

function summarizeChatFailure(error: unknown) {
  if (!(error instanceof Error)) return "对话模型暂时不可用";

  const message = error.message;
  if (/524\b|响应超时|a timeout occurred/i.test(message)) return "对话模型服务超时";
  if (/429\b|rate limit/i.test(message)) return "对话模型服务限流";
  if (/401\b|403\b|unauthorized|forbidden/i.test(message)) return "对话模型服务鉴权异常";
  if (/ECONNREFUSED|ENOTFOUND|UND_ERR_CONNECT_TIMEOUT|UND_ERR_HEADERS_TIMEOUT|fetch failed|SocketError/i.test(message)) {
    return "对话模型服务连接异常";
  }
  if (/5\d\d\b|对话模型调用失败：/i.test(message)) return "对话模型服务暂时异常";
  return "对话模型暂时不可用";
}

function extractResponseText(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const object = data as Record<string, unknown>;
  if (typeof object.output_text === "string") return object.output_text.trim();
  if (!Array.isArray(object.output)) return "";

  return object.output
    .flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const itemObject = item as Record<string, unknown>;
      if (!Array.isArray(itemObject.content)) return [];
      return itemObject.content.map((content) => {
        if (!content || typeof content !== "object") return "";
        const contentObject = content as Record<string, unknown>;
        return typeof contentObject.text === "string" ? contentObject.text : "";
      });
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

async function buildWebResearchContext(input: { mode: Draft["mode"]; prompt: string; sourceText?: string }) {
  const queries = makeSearchQueries(input);
  if (!queries.length) return "未触发检索：需求为空。";

  try {
    const results = await searchWeb(queries);
    if (!results.length) return `已联网检索「${queries.join(" / ")}」，但没有拿到可用结果。`;

    const lines = results
      .slice(0, 6)
      .map((item, index) => {
        const date = item.date ? `｜${item.date}` : "";
        const source = item.source ? `｜${item.source}` : "";
        return `${index + 1}. ${item.title}${source}${date}\n   ${item.snippet || "暂无摘要"}\n   ${item.url}`;
      })
      .join("\n");

    return `检索时间：${new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}\n检索关键词：${queries.join(" / ")}\n${lines}`;
  } catch (error) {
    return `联网检索失败：${error instanceof Error ? error.message : "未知错误"}。如需最新事实，请让用户提供事件链接或关键词。`;
  }
}

async function searchWeb(queries: string[]) {
  const settled = await Promise.allSettled(
    queries.map((query) => runOpenCliJson(["google", "search", query, "--limit", "6", "--lang", "zh", "-f", "json"]))
  );
  const rows = settled.flatMap((result) =>
    result.status === "fulfilled" ? asArray(result.value).map(normalizeSearchResult).filter((item) => item.title || item.snippet) : []
  );
  const uniqueRows = dedupeSearchResults(rows);
  if (uniqueRows.length) return uniqueRows;

  const newsResults = await runOpenCliJson(["google", "news", queries[0], "--limit", "6", "--lang", "zh", "--region", "CN", "-f", "json"]);
  return asArray(newsResults).map(normalizeSearchResult).filter((item) => item.title || item.snippet);
}

async function runOpenCliJson(args: string[]) {
  const { stdout, stderr } = await execFileAsync(process.env.OPENCLI_BIN || "opencli", args, {
    maxBuffer: 1024 * 1024 * 20,
    timeout: WEB_RESEARCH_TIMEOUT_MS
  });
  if (stderr && stderr.toLowerCase().includes("error")) {
    throw new Error(stderr.trim());
  }
  return parseJsonish(stdout.trim());
}

function parseJsonish(output: string): unknown {
  if (!output) return [];
  try {
    return JSON.parse(output);
  } catch {
    const firstBrace = output.indexOf("{");
    const firstBracket = output.indexOf("[");
    const candidates = [firstBrace, firstBracket].filter((index) => index >= 0);
    const start = Math.min(...candidates);
    if (Number.isFinite(start)) {
      try {
        return JSON.parse(output.slice(start));
      } catch {
        return [];
      }
    }
    return [];
  }
}

function asArray(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) return value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"));
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    for (const key of ["data", "items", "results", "list"]) {
      if (Array.isArray(object[key])) return asArray(object[key]);
    }
    if (object.data && typeof object.data === "object") {
      const nested = object.data as Record<string, unknown>;
      for (const key of ["items", "results", "list"]) {
        if (Array.isArray(nested[key])) return asArray(nested[key]);
      }
    }
  }
  return [];
}

function normalizeSearchResult(item: Record<string, unknown>) {
  return {
    title: String(item.title || ""),
    snippet: String(item.snippet || item.summary || item.description || ""),
    url: String(item.url || item.link || ""),
    source: String(item.source || ""),
    date: String(item.date || item.publishedAt || "")
  };
}

function dedupeSearchResults(results: Array<ReturnType<typeof normalizeSearchResult>>) {
  const seen = new Set<string>();
  return results.filter((result) => {
    const key = result.url || result.title;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function makeSearchQueries(input: { mode: Draft["mode"]; prompt: string; sourceText?: string }) {
  const text = `${input.prompt} ${input.mode === "rewrite" ? input.sourceText || "" : ""}`
    .replace(/[，。！？、；："'“”‘’（）()[\]{}#*_`>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return [];

  const queries = [text.slice(0, 80)];
  if (/游戏|手游|二游|steam|玩家|官方|开服|周年|抽卡/i.test(text)) {
    queries.push("游戏圈 最新 争议 翻车 事件 2026");
    queries.push("最近 二游 翻车 争议 官方 道歉 玩家 不满 2026");
    queries.push("游戏 最新 离谱 事件 争议 玩家 2026");
  }
  if (/最新|最近|热点|事件|新闻|离谱|翻车|争议/.test(text) && !queries.some((query) => query.includes("最新"))) {
    queries.push(`${text.slice(0, 42)} 最新 争议 事件`);
  }
  return [...new Set(queries)].slice(0, 4);
}

export async function generateStyleProfile(platform: Platform, accountId: string) {
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
  const result = await chatCompleteWithFallback([
    {
      role: "system",
      content:
        "你是短视频账号风格分析师。请根据爆款转写稿，提炼可复用的中文文案风格卡。输出 Markdown，结构必须包含：内容定位、开头方式、句式与节奏、常用话术、叙事结构、结尾 CTA、写作禁忌。"
    },
    {
      role: "user",
      content: `账号：${account.name}\n平台：${platform}\n\n爆款样本：\n${corpus}`
    }
  ]);

  const style = result.text || fallback;
  await saveStyle(platform, accountId, style);
  return { style, fallback: result.fallback, usedModel: result.model };
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
  const result = await chatCompleteWithFallback([
    {
      role: "system",
      content:
        "你是项目级中文短视频风格策略师。请把多个账号的风格卡和爆款转写稿融合成一个可执行的项目风格卡。输出 Markdown，结构必须包含：项目定位、适合选题、开头方式、句式与节奏、常用话术、叙事结构、结尾 CTA、写作禁忌。"
    },
    {
      role: "user",
      content: `项目：${project.name}\n项目说明：${project.description || "暂无"}\n\n参考素材：\n${corpus}`
    }
  ]);

  const style = result.text || fallback;
  await saveProjectStyle(projectId, style);
  return { style, fallback: result.fallback, usedModel: result.model };
}

export async function writeCopy(input: {
  platform?: Platform;
  accountId?: string;
  targetType?: "account" | "project";
  projectId?: string;
  mode: Draft["mode"];
  prompt: string;
  sourceText?: string;
  save?: boolean;
  useWebResearch?: boolean;
}): Promise<WriteResult> {
  if (input.targetType === "project" || input.projectId) {
    return writeProjectCopy(input);
  }

  if (!input.platform || !input.accountId) {
    throw new Error("请选择参考账号");
  }

  const account = await resolveAccount(input.platform, input.accountId);
  const style = await fs.readFile(path.join(libraryRoot(), input.platform, account.slug, "style.md"), "utf8");
  const samples = await getTopTranscriptSamples(input.platform, input.accountId, 3);
  const sampleContext = samples
    .map(({ video, transcript }) => `《${video.title}》\n${clampText(transcript, 1200)}`)
    .join("\n\n---\n\n");

  const userTask =
    input.mode === "topic"
      ? `请基于这个主题生成文案：\n${input.prompt}`
      : `请按账号风格改写下面文案。改写要求：${input.prompt}\n\n原文：\n${input.sourceText || ""}`;
  const webContext = input.useWebResearch ? await buildWebResearchContext(input) : "未启用联网检索。";

  const result = await chatCompleteWithFallback([
    {
      role: "system",
      content:
        "你是中文短视频文案助手。严格参考给定账号风格卡和样本话术，但不要照抄原转写稿。只有在联网检索资料明确启用并提供结果时，才基于资料写最新事实；资料不足时说明需要用户补充更明确关键词。输出可以直接使用的成稿，必要时给出标题、正文、口播节奏和结尾互动。"
    },
    {
      role: "user",
      content: `参考账号：${account.name}\n平台：${input.platform}\n\n风格卡：\n${style}\n\n代表样本：\n${sampleContext || "暂无样本，仅参考风格卡。"}\n\n联网检索资料：\n${webContext}\n\n任务：\n${userTask}`
    }
  ]);

  const content = result.text || buildFallbackCopy(account.name, style, input);
  let draft;

  if (input.save) {
    draft = await saveDraft({
      platform: input.platform,
      accountId: input.accountId,
      accountName: account.name,
      title: makeTitleFromPrompt(input.prompt),
      mode: input.mode,
      prompt: input.prompt,
      input: input.sourceText,
      content,
      styleRef: {
        platform: input.platform,
        accountId: input.accountId,
        accountName: account.name,
        videoIds: samples.map((sample) => sample.video.id)
      }
    });
  }

  return {
    content,
    draft,
    usedModel: result.model,
    fallback: result.fallback,
    fallbackReason: result.fallbackReason
  };
}

async function writeProjectCopy(input: {
  projectId?: string;
  mode: Draft["mode"];
  prompt: string;
  sourceText?: string;
  save?: boolean;
  useWebResearch?: boolean;
}): Promise<WriteResult> {
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

  const userTask =
    input.mode === "topic"
      ? `请基于这个主题生成文案：\n${input.prompt}`
      : `请按项目风格改写下面文案。改写要求：${input.prompt}\n\n原文：\n${input.sourceText || ""}`;
  const webContext = input.useWebResearch ? await buildWebResearchContext(input) : "未启用联网检索。";

  const result = await chatCompleteWithFallback([
    {
      role: "system",
      content:
        "你是中文短视频文案助手。严格参考给定项目风格卡和样本话术，但不要照抄原转写稿。只有在联网检索资料明确启用并提供结果时，才基于资料写最新事实；资料不足时说明需要用户补充更明确关键词。输出可以直接使用的成稿，必要时给出标题、正文、口播节奏和结尾互动。"
    },
    {
      role: "user",
      content: `参考项目：${project.name}\n项目说明：${project.description || "暂无"}\n\n项目风格卡：\n${style}\n\n代表样本：\n${sampleContext || "暂无样本，仅参考风格卡。"}\n\n联网检索资料：\n${webContext}\n\n任务：\n${userTask}`
    }
  ]);

  const content = result.text || buildFallbackCopy(project.name, style, {
    mode: input.mode,
    prompt: input.prompt,
    sourceText: input.sourceText
  });

  let draft;

  if (input.save) {
    draft = await saveDraft({
      targetType: "project",
      projectId: project.id,
      projectName: project.name,
      title: makeTitleFromPrompt(input.prompt),
      mode: input.mode,
      prompt: input.prompt,
      input: input.sourceText,
      content,
      styleRef: {
        projectId: project.id,
        projectName: project.name,
        sourceAccountIds: project.sourceAccountIds
      }
    });
  }

  return {
    content,
    draft,
    usedModel: result.model,
    fallback: result.fallback,
    fallbackReason: result.fallbackReason
  };
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
