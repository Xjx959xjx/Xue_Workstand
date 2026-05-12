import { AccountSummary, BatchTranscribeResult, CollectOrder, CollectResult, Draft, DraftInput, LibraryState, Platform, ProjectSummary, Video } from "./types";

async function requestJson<T>(url: string, options?: RequestInit): Promise<T> {
  let response: Response;

  try {
    response = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options?.headers || {})
      },
      cache: "no-store"
    });
  } catch (error) {
    throw new Error(describeRequestError(error));
  }

  const fallbackResponse = response.clone();
  const data = await response.json().catch(async () => {
    const text = await fallbackResponse.text().catch(() => "");
    return { error: summarizeHttpError(response.status, text, response.headers.get("content-type")) };
  });

  if (!response.ok) {
    throw new Error(data.error || summarizeHttpError(response.status));
  }
  return data as T;
}

function describeRequestError(error: unknown) {
  if (!(error instanceof Error)) {
    return "请求失败：无法连接到本地服务，请确认开发服务器仍在运行。";
  }

  if (error.name === "AbortError") {
    return "请求失败：连接超时，请稍后重试。";
  }

  if (/Failed to fetch|Load failed|NetworkError/i.test(error.message)) {
    return "请求失败：无法连接到本地服务，请确认开发服务器仍在运行。";
  }

  return `请求失败：${error.message || "网络异常"}`;
}

function summarizeHttpError(status: number, body = "", contentType?: string | null) {
  const trimmed = body.trim();
  if (!trimmed) return `请求失败：服务返回 ${status}`;

  const isHtml = Boolean(contentType?.includes("text/html")) || /^<!doctype html\b/i.test(trimmed) || /^<html\b/i.test(trimmed);
  if (isHtml) {
    const title = trimmed.match(/<title>([^<]+)<\/title>/i)?.[1]?.replace(/\s+/g, " ").trim();
    return title ? `请求失败：服务返回异常页面（${title}）` : `请求失败：服务返回异常页面（${status}）`;
  }

  return trimmed.replace(/\s+/g, " ").slice(0, 220);
}

export function getLibrary() {
  return requestJson<LibraryState>("/api/library");
}

export function collectAccount(input: {
  platform: Platform;
  name: string;
  uidOrUrl?: string;
  limit: number;
  order: CollectOrder;
  fromDate?: string;
  toDate?: string;
}) {
  return requestJson<CollectResult>("/api/collect", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function createAccount(input: { platform: Platform; name: string; uidOrUrl?: string }) {
  return requestJson<AccountSummary>("/api/accounts", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function deleteAccounts(accountIds: string[]) {
  return requestJson<{ deleted: string[] }>("/api/accounts", {
    method: "DELETE",
    body: JSON.stringify({ accountIds })
  });
}

export function transcribeVideo(input: {
  platform: Platform;
  accountId: string;
  videoId: string;
  mediaPath?: string;
  allowRemoteDownload?: boolean;
}) {
  return requestJson("/api/transcribe", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function hydrateVideo(input: { platform: Platform; accountId: string; videoId: string }) {
  return requestJson<{ video: Video }>("/api/videos/hydrate", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function batchTranscribe(input: {
  platform: Platform;
  accountId: string;
  limit: number | "all";
  updateStyle?: boolean;
}) {
  return requestJson<BatchTranscribeResult>("/api/batch-transcribe", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function streamBatchTranscribe(
  input: {
    platform: Platform;
    accountId: string;
    limit: number | "all";
    updateStyle?: boolean;
  },
  handlers: {
    onStage?: (payload: { stage: string; message: string; progress?: number }) => void;
    onVideo?: (payload: {
      videoId: string;
      title: string;
      status: "completed" | "skipped" | "failed";
      error?: string;
      completed: number;
      skipped: number;
      failed: number;
    }) => void;
    onResult?: (result: BatchTranscribeResult) => void;
  }
) {
  const response = await fetch("/api/batch-transcribe/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    cache: "no-store"
  }).catch((error) => {
    throw new Error(describeRequestError(error));
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(summarizeHttpError(response.status, text, response.headers.get("content-type")));
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("请求失败：服务没有返回可读取的流式内容。");

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const event = JSON.parse(trimmed) as
        | { type: "stage"; stage: string; message: string; progress?: number }
        | { type: "result"; data: BatchTranscribeResult | ({ phase: "video" } & Record<string, unknown>) }
        | { type: "error"; message: string }
        | { type: "done" };

      if (event.type === "stage") handlers.onStage?.(event);
      if (event.type === "result" && (event.data as { phase?: string }).phase === "video") {
        handlers.onVideo?.(event.data as never);
      }
      if (event.type === "result" && !(event.data as { phase?: string }).phase) {
        handlers.onResult?.(event.data as BatchTranscribeResult);
      }
      if (event.type === "error") throw new Error(event.message);
    }
  }
}

export function getTranscript(input: { platform: Platform; accountId: string; videoId: string }) {
  const params = new URLSearchParams(input);
  return requestJson<{ transcript: string }>(`/api/transcripts?${params.toString()}`);
}

export function saveTranscript(input: {
  platform: Platform;
  accountId: string;
  videoId: string;
  transcript: string;
}) {
  return requestJson<{ transcript: string }>("/api/transcripts", {
    method: "PUT",
    body: JSON.stringify(input)
  });
}

export function deleteTranscript(input: { platform: Platform; accountId: string; videoId: string }) {
  return requestJson<{ video: Video }>("/api/transcripts", {
    method: "DELETE",
    body: JSON.stringify(input)
  });
}

export function deleteVideos(input: { platform: Platform; accountId: string; videoIds: string[] }) {
  return requestJson<{ deleted: string[] }>("/api/videos", {
    method: "DELETE",
    body: JSON.stringify(input)
  });
}

export type StyleGenerationResponse = {
  style: string;
  fallback: boolean;
  usedModel: string;
  fallbackReason?: string;
};

export function generateStyle(platform: Platform, accountId: string) {
  return requestJson<StyleGenerationResponse>("/api/style", {
    method: "POST",
    body: JSON.stringify({ platform, accountId })
  });
}

export async function streamGenerateStyle(
  input: {
    platform: Platform;
    accountId: string;
  },
  handlers: {
    onStage?: (payload: { stage: string; message: string; progress?: number }) => void;
    onDelta?: (delta: string) => void;
    onResult?: (result: StyleGenerationResponse) => void;
  }
) {
  const response = await fetch("/api/style/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    cache: "no-store"
  }).catch((error) => {
    throw new Error(describeRequestError(error));
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(summarizeHttpError(response.status, text, response.headers.get("content-type")));
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("请求失败：服务没有返回可读取的流式内容。");

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const event = JSON.parse(trimmed) as
        | { type: "stage"; stage: string; message: string; progress?: number }
        | { type: "delta"; delta: string }
        | { type: "result"; data: StyleGenerationResponse }
        | { type: "error"; message: string }
        | { type: "done" };

      if (event.type === "stage") handlers.onStage?.(event);
      if (event.type === "delta") handlers.onDelta?.(event.delta);
      if (event.type === "result") handlers.onResult?.(event.data);
      if (event.type === "error") throw new Error(event.message);
    }
  }
}

export function upsertProject(input: {
  projectId?: string;
  name: string;
  description?: string;
  sourceAccountIds: string[];
}) {
  return requestJson<ProjectSummary>("/api/projects", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function deleteProjects(projectIds: string[]) {
  return requestJson<{ deleted: string[] }>("/api/projects", {
    method: "DELETE",
    body: JSON.stringify({ projectIds })
  });
}

export function generateProjectStyle(projectId: string) {
  return requestJson<StyleGenerationResponse>("/api/projects", {
    method: "PATCH",
    body: JSON.stringify({ projectId })
  });
}

export async function streamGenerateProjectStyle(
  input: {
    projectId?: string;
    name: string;
    description?: string;
    sourceAccountIds: string[];
  },
  handlers: {
    onStage?: (payload: { stage: string; message: string; progress?: number }) => void;
    onResult?: (result: { project: ProjectSummary } & StyleGenerationResponse) => void;
  }
) {
  const response = await fetch("/api/projects/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    cache: "no-store"
  }).catch((error) => {
    throw new Error(describeRequestError(error));
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(summarizeHttpError(response.status, text, response.headers.get("content-type")));
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("请求失败：服务没有返回可读取的流式内容。");

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const event = JSON.parse(trimmed) as
        | { type: "stage"; stage: string; message: string; progress?: number }
        | { type: "result"; data: { project: ProjectSummary } & StyleGenerationResponse }
        | { type: "error"; message: string }
        | { type: "done" };

      if (event.type === "stage") handlers.onStage?.(event);
      if (event.type === "result") handlers.onResult?.(event.data);
      if (event.type === "error") throw new Error(event.message);
    }
  }
}

export function saveProjectStyle(projectId: string, content: string) {
  return requestJson<{ style: string }>("/api/projects", {
    method: "PUT",
    body: JSON.stringify({ projectId, content })
  });
}

export function saveStyle(platform: Platform, accountId: string, content: string) {
  return requestJson<{ style: string }>("/api/style", {
    method: "PUT",
    body: JSON.stringify({ platform, accountId, content })
  });
}

export function writeCopy(input: {
  targetType?: "account" | "project";
  platform?: Platform;
  accountId?: string;
  projectId?: string;
  mode: Draft["mode"];
  prompt: string;
  sourceText?: string;
  save?: boolean;
  useWebResearch?: boolean;
}) {
  return requestJson<{ content: string; research?: string; draft?: Draft; usedModel: string; fallback: boolean; fallbackReason?: string }>("/api/write", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function streamWriteCopy(
  input: {
    targetType?: "account" | "project";
    platform?: Platform;
    accountId?: string;
    projectId?: string;
    mode: Draft["mode"];
    prompt: string;
    sourceText?: string;
    save?: boolean;
    useWebResearch?: boolean;
  },
  handlers: {
    onStage?: (payload: { stage: string; message: string; progress?: number }) => void;
    onDelta?: (delta: string) => void;
    onResearch?: (research: string) => void;
    onResult?: (result: { content: string; research?: string; draft?: Draft; usedModel: string; fallback: boolean; fallbackReason?: string }) => void;
  }
) {
  const response = await fetch("/api/write/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    cache: "no-store"
  }).catch((error) => {
    throw new Error(describeRequestError(error));
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(summarizeHttpError(response.status, text, response.headers.get("content-type")));
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("请求失败：服务没有返回可读取的流式内容。");
  }

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const event = JSON.parse(trimmed) as
        | { type: "stage"; stage: string; message: string; progress?: number }
        | { type: "delta"; delta: string }
        | { type: "result"; data: { research?: string; phase?: string; content?: string; draft?: Draft; usedModel?: string; fallback?: boolean; fallbackReason?: string } }
        | { type: "error"; message: string }
        | { type: "done" };

      if (event.type === "stage") {
        handlers.onStage?.(event);
      }
      if (event.type === "delta") {
        handlers.onDelta?.(event.delta);
      }
      if (event.type === "result" && event.data.phase === "research" && event.data.research) {
        handlers.onResearch?.(event.data.research);
      }
      if (event.type === "result" && typeof event.data.content === "string" && typeof event.data.usedModel === "string") {
        handlers.onResult?.({
          content: event.data.content,
          research: event.data.research,
          draft: event.data.draft,
          usedModel: event.data.usedModel,
          fallback: Boolean(event.data.fallback),
          fallbackReason: event.data.fallbackReason
        });
      }
      if (event.type === "error") {
        throw new Error(event.message);
      }
    }
  }
}

export function saveDraft(input: DraftInput) {
  return requestJson<Draft>("/api/drafts", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function publishFeishuDocument(input: { title: string; content: string }) {
  return requestJson<{ title: string; documentId: string; url: string }>("/api/feishu/document", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function getHealth() {
  return requestJson<{
    opencli: { ok: boolean; bin: string; version: string };
    libraryRoot: string;
    siliconflowConfigured: boolean;
    chatConfigured: boolean;
    chat: {
      baseUrl: string;
      model: string;
      wireApi: "responses" | "chat_completions";
      reasoningEffort: "none" | "low" | "medium" | "high" | "xhigh";
      proxyConfigured: boolean;
      configured: boolean;
    };
    feishuConfigured: boolean;
    feishu: {
      configured: boolean;
      mode: "lark-cli";
      opencliBin: string;
      identity: string;
      folderConfigured: boolean;
      doctor: { ok: boolean; message: string };
    };
  }>("/api/health");
}
