import { AccountSummary, BatchTranscribeResult, CollectResult, Draft, DraftInput, LibraryState, Platform, ProjectSummary, Video } from "./types";

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
  order: "pubdate" | "click" | "stow";
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

export function generateStyle(platform: Platform, accountId: string) {
  return requestJson<{ style: string; fallback: boolean; usedModel: string }>("/api/style", {
    method: "POST",
    body: JSON.stringify({ platform, accountId })
  });
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
  return requestJson<{ style: string; fallback: boolean; usedModel: string }>("/api/projects", {
    method: "PATCH",
    body: JSON.stringify({ projectId })
  });
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
  return requestJson<{ content: string; draft?: Draft; usedModel: string; fallback: boolean; fallbackReason?: string }>("/api/write", {
    method: "POST",
    body: JSON.stringify(input)
  });
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
