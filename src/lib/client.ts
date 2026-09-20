import type { ImageFile, ImageGenerationConfig, ImageGenerationList, ImageGenerationRecord } from "./image-generation-types";
import {
  AccountDraftInput,
  AccountDetail,
  BatchTranscribeResult,
  CollectOrder,
  CollectResult,
  CopySource,
  Draft,
  DraftSummary,
  DraftCoverReference,
  DouyinHotlistRefreshResult,
  DouyinHotlistResponse,
  EngagementGenerationRequest,
  EngagementRecord,
  EngagementRecordSummary,
  GrossMarginLibrary,
  GrossMarginMonitorRecord,
  GrossMarginPriceTable,
  GrossMarginPriceTableSaveItem,
  GrossMarginReviewTemplate,
  GrossMarginServiceKind,
  HotspotRadarRefreshResult,
  HotspotRadarResponse,
  JobListResponse,
  JobRecord,
  JobStartInput,
  LibraryTrashOperation,
  LibraryOverviewResponse,
  Platform,
  ProjectDraftInput,
  ProjectDetail,
  ProjectSummary,
  RemoteStatusResponse,
  TranscriptVersion,
  Video,
  WriteAction,
  WriteBatchResult,
  WriteGenerationResult,
  WriteRevisionScope,
  WriteResult,
  WriteStyleReferenceInput,
  WriterSourceFileImport
} from "./types";
import type { LinkTranscriptionResult } from "./transcription";
import type { PublishCopyInput, PublishCopyResult } from "./publish-copy-types";
import type { DouyinHotlistRefreshLogResponse } from "./douyin-hotlist-refresh-log";

let draftsCache: { drafts: DraftSummary[] } | null = null;
let draftsRequest: Promise<{ drafts: DraftSummary[] }> | null = null;
let draftsCacheRevision = 0;
const draftOverrides = new Map<string, Draft>();
const deletedDraftIds = new Set<string>();
let copySourcesCache: { sources: CopySource[] } | null = null;
let copySourcesRequest: Promise<{ sources: CopySource[] }> | null = null;
let engagementRecordsCache: { records: EngagementRecordSummary[] } | null = null;
let engagementRecordsRequest: Promise<{ records: EngagementRecordSummary[] }> | null = null;
let engagementRecordsCacheRevision = 0;
const engagementRecordOverrides = new Map<string, EngagementRecord>();
let grossMarginLibraryCache: GrossMarginLibrary | null = null;
let grossMarginLibraryRequest: Promise<GrossMarginLibrary> | null = null;
let grossMarginLibraryCacheRevision = 0;
const DEFAULT_DOUYIN_HOTLIST_WINDOW_DAYS = 3;
const DEFAULT_DOUYIN_HOTLIST_WINDOW = "3d";
const douyinHotlistCache = new Map<string, DouyinHotlistResponse>();
const douyinHotlistRequests = new Map<string, Promise<DouyinHotlistResponse>>();
let douyinHotlistCacheRevision = 0;
let hotspotRadarCache: HotspotRadarResponse | null = null;
let hotspotRadarRequest: Promise<HotspotRadarResponse> | null = null;
let hotspotRadarCacheRevision = 0;

type DraftSaveInput = Omit<AccountDraftInput, "assets"> | Omit<ProjectDraftInput, "assets">;

type WriteCopyRequest = {
  action?: WriteAction;
  targetType?: "account" | "project";
  platform?: Platform;
  accountId?: string;
  projectId?: string;
  styleRefs?: WriteStyleReferenceInput[];
  mode: Draft["mode"];
  prompt?: string;
  originalSourceInput?: string;
  sourceText?: string;
  supportDocLinks?: string;
  save?: boolean;
  useWebResearch?: boolean;
  parentDraftId?: string;
  currentContent?: string;
  revisionInstruction?: string;
  revisionScope?: WriteRevisionScope;
  revisionMode?: "edit" | "recalibrate";
  selectedText?: string;
};

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
    throw new Error(formatApiErrorResponse(response, data));
  }
  return data as T;
}

async function readApiErrorResponse(response: Response) {
  const fallbackResponse = response.clone();
  const data = await response.json().catch(async () => {
    const text = await fallbackResponse.text().catch(() => "");
    return { error: summarizeHttpError(response.status, text, response.headers.get("content-type")) };
  });
  return formatApiErrorResponse(response, data);
}

function formatApiErrorResponse(response: Response, data: unknown) {
  const error = data && typeof data === "object" && "error" in data ? (data as { error?: unknown }).error : undefined;
  return normalizeApiError(error) || summarizeHttpError(response.status);
}

function normalizeApiError(error: unknown) {
  if (typeof error !== "string") return "";
  const message = error.trim();
  if (!message) return "";

  const zodMessage = summarizeZodErrorMessage(message);
  return zodMessage || message;
}

function summarizeZodErrorMessage(message: string) {
  if (!message.startsWith("[") && !message.startsWith("{")) return "";

  try {
    const parsed = JSON.parse(message) as unknown;
    const issues = Array.isArray(parsed) ? parsed : [parsed];
    const firstIssue = issues.find(
      (issue): issue is { code?: unknown; message?: unknown; path?: unknown; validation?: unknown } =>
        Boolean(issue) && typeof issue === "object"
    );
    if (!firstIssue) return "";

    const path = Array.isArray(firstIssue.path) ? firstIssue.path.join(".") : "";
    if (firstIssue.validation === "url" || path.endsWith("url") || path.endsWith("mediaUrl")) {
      return "链接格式不正确，请粘贴完整的 http(s) 地址。";
    }
    if (typeof firstIssue.message === "string" && firstIssue.message.trim() && !/^Invalid\b/i.test(firstIssue.message)) {
      return firstIssue.message.trim();
    }
    return "请求参数不完整或格式不正确。";
  } catch {
    return "";
  }
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

async function readNdjsonStream<TEvent extends { type: string }>(
  url: string,
  options: RequestInit,
  onEvent: (event: TEvent) => void | Promise<void>
) {
  const response = await fetch(url, {
    ...options,
    cache: "no-store"
  }).catch((error) => {
    throw new Error(describeRequestError(error));
  });

  if (!response.ok) {
    throw new Error(await readApiErrorResponse(response));
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("请求失败：服务没有返回可读取的流式内容。");

  const decoder = new TextDecoder();
  let buffer = "";
  let sawDone = false;

  const handleLine = async (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    let event: TEvent;
    try {
      event = JSON.parse(trimmed) as TEvent;
    } catch {
      throw new Error("请求失败：服务返回了无法解析的流式事件。");
    }

    if (!event || typeof event !== "object" || typeof (event as { type?: unknown }).type !== "string") {
      throw new Error("请求失败：服务返回了无效的流式事件。");
    }

    if (event.type === "error") {
      const message = (event as { message?: unknown }).message;
      throw new Error(typeof message === "string" && message.trim() ? message : "请求处理失败");
    }

    if (event.type === "done") {
      sawDone = true;
      return;
    }

    await onEvent(event);
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        await handleLine(line);
      }
    }

    buffer += decoder.decode();
    if (buffer.trim()) {
      await handleLine(buffer);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }

  if (!sawDone) {
    throw new Error("请求失败：流式响应提前结束，请重试。");
  }
}

function rememberDrafts(drafts: Draft[]) {
  const activeDrafts = drafts.filter((draft) => !deletedDraftIds.has(draft.id));
  if (!activeDrafts.length) return;
  for (const draft of activeDrafts) draftOverrides.set(draft.id, draft);
  draftsCache = {
    drafts: mergeDraftOverrides(draftsCache?.drafts ?? [], activeDrafts.map(draftSummaryFromDraft))
  };
}

function rememberDraftList(drafts: DraftSummary[]) {
  draftsCache = {
    drafts: mergeDraftOverrides(drafts)
  };
  return draftsCache;
}

function mergeDraftOverrides(drafts: DraftSummary[], additions: DraftSummary[] = []) {
  const byId = new Map(
    [...drafts, ...additions]
      .filter((draft) => !deletedDraftIds.has(draft.id))
      .map((draft) => [draft.id, draft])
  );
  for (const [draftId, draft] of draftOverrides) {
    if (!deletedDraftIds.has(draftId)) byId.set(draftId, draftSummaryFromDraft(draft));
  }
  return [...byId.values()].sort(compareCreatedAtDesc);
}

export function draftSummaryFromDraft(draft: Draft): DraftSummary {
  const base = {
    id: draft.id,
    title: draft.title,
    mode: draft.mode,
    version: draft.version,
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt
  };
  return draft.targetType === "project"
    ? { ...base, targetType: "project", projectId: draft.projectId, projectName: draft.projectName }
    : { ...base, targetType: draft.targetType, platform: draft.platform, accountId: draft.accountId, accountName: draft.accountName };
}

function rememberDraftFromJob(job: JobRecord) {
  const result = job.result;
  if (!result || typeof result !== "object") return;

  if ((result as { kind?: string }).kind === "write-batch") {
    const drafts = ((result as { results?: Array<Partial<WriteResult>> }).results || [])
      .map((item) => item.draft)
      .filter((draft): draft is Draft => Boolean(draft && typeof draft === "object" && typeof draft.id === "string"));
    rememberDrafts(drafts);
    return;
  }

  const draft = (result as Partial<WriteResult>).draft;
  if (draft && typeof draft === "object" && typeof draft.id === "string") rememberDrafts([draft as Draft]);
}

function rememberEngagementRecordFromJob(job: JobRecord) {
  if (job.kind !== "engagement" || !job.result || typeof job.result !== "object") return;
  const record = (job.result as { record?: EngagementRecord }).record;
  if (!record || typeof record.id !== "string") return;
  rememberEngagementRecords([record]);
}

function rememberCopySources(sources: CopySource[]) {
  if (!sources.length || !copySourcesCache) return;
  copySourcesCache = {
    sources: mergeById(sources, copySourcesCache.sources, compareCreatedAtDesc)
  };
}

function rememberEngagementRecords(records: EngagementRecord[]) {
  if (!records.length) return;
  for (const record of records) {
    const current = engagementRecordOverrides.get(record.id);
    if (!current || recordUpdatedAt(record) >= recordUpdatedAt(current)) {
      engagementRecordOverrides.set(record.id, record);
    }
  }
  const rememberedRecords = records
    .map((record) => engagementRecordOverrides.get(record.id))
    .filter((record): record is EngagementRecord => Boolean(record));
  engagementRecordsCache = {
    records: mergeById(rememberedRecords.map(engagementSummaryFromRecord), engagementRecordsCache?.records ?? [], compareCreatedAtDesc)
  };
}

function rememberEngagementRecordList(records: EngagementRecordSummary[]) {
  for (const record of records) {
    const current = engagementRecordOverrides.get(record.id);
    if (current && recordUpdatedAt(record) > recordUpdatedAt(current)) {
      engagementRecordOverrides.delete(record.id);
    }
  }
  const completedRecords = [...engagementRecordOverrides.values()].map(engagementSummaryFromRecord);
  engagementRecordsCache = {
    records: mergeById(completedRecords, records, compareCreatedAtDesc)
  };
  return engagementRecordsCache;
}

function recordUpdatedAt(record: Pick<EngagementRecord, "updatedAt"> | Pick<EngagementRecordSummary, "updatedAt">) {
  const value = Date.parse(record.updatedAt);
  return Number.isFinite(value) ? value : 0;
}

export function engagementSummaryFromRecord(record: EngagementRecord): EngagementRecordSummary {
  return {
    id: record.id,
    sourceType: record.sourceType,
    title: record.title,
    sourceAccountName: record.sourceAccountName,
    sourceUrl: record.sourceUrl,
    platform: record.platform,
    draftId: record.draftId,
    fallback: record.fallback,
    fallbackReason: record.fallbackReason,
    commentCount: record.comments?.items.length || 0,
    danmakuCount: record.danmaku?.items.length || 0,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
}

function rememberGrossMarginLibrary(library: GrossMarginLibrary) {
  grossMarginLibraryCache = library;
}

function getDouyinHotlistWindowDays(windowDays?: number) {
  if (!Number.isFinite(windowDays)) return DEFAULT_DOUYIN_HOTLIST_WINDOW_DAYS;
  return Math.max(1, Math.min(14, Math.trunc(windowDays || DEFAULT_DOUYIN_HOTLIST_WINDOW_DAYS)));
}

function getDouyinHotlistWindowKey(input: { windowDays?: number; window?: string } = {}) {
  const window = input.window?.trim().toLowerCase();
  if (window) return window;
  const windowDays = getDouyinHotlistWindowDays(input.windowDays);
  return windowDays === DEFAULT_DOUYIN_HOTLIST_WINDOW_DAYS ? DEFAULT_DOUYIN_HOTLIST_WINDOW : `${windowDays}d`;
}

function rememberDouyinHotlist(snapshot: DouyinHotlistResponse) {
  douyinHotlistCache.set(snapshot.summary.windowKey || getDouyinHotlistWindowKey({ windowDays: snapshot.summary.windowDays }), snapshot);
}

function resetDouyinHotlistCache(snapshot?: DouyinHotlistResponse) {
  douyinHotlistCacheRevision += 1;
  douyinHotlistCache.clear();
  douyinHotlistRequests.clear();
  if (snapshot) rememberDouyinHotlist(snapshot);
}

export function invalidateDouyinHotlistCache() {
  resetDouyinHotlistCache();
}

function mergeById<T extends { id: string }>(
  nextItems: T[],
  currentItems: T[],
  compare: (left: T, right: T) => number
) {
  const byId = new Map(currentItems.map((item) => [item.id, item]));
  for (const item of nextItems) byId.set(item.id, item);
  return [...byId.values()].sort(compare);
}

function compareCreatedAtDesc(left: { createdAt: string }, right: { createdAt: string }) {
  return +new Date(right.createdAt) - +new Date(left.createdAt);
}

function fileNameFromContentDisposition(header: string | null) {
  if (!header) return "";
  const encoded = header.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded);
    } catch {
      return encoded;
    }
  }

  return header.match(/filename="?([^";]+)"?/i)?.[1] || "";
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function getLibraryOverview() {
  return requestJson<LibraryOverviewResponse>("/api/library/overview");
}

export function getGrossMarginLibrary(options: { fresh?: boolean } = {}) {
  if (!options.fresh && grossMarginLibraryCache) return Promise.resolve(grossMarginLibraryCache);
  if (grossMarginLibraryRequest) return grossMarginLibraryRequest;

  const suffix = options.fresh ? "?refreshAccounts=1" : "";
  const cacheRevision = grossMarginLibraryCacheRevision;
  const request = requestJson<GrossMarginLibrary>(`/api/gross-margin${suffix}`)
    .then((library) => {
      if (cacheRevision === grossMarginLibraryCacheRevision) rememberGrossMarginLibrary(library);
      return library;
    })
    .finally(() => {
      if (grossMarginLibraryRequest === request) grossMarginLibraryRequest = null;
    });
  grossMarginLibraryRequest = request;
  return grossMarginLibraryRequest;
}

export function invalidateGrossMarginLibraryCache() {
  grossMarginLibraryCacheRevision += 1;
  grossMarginLibraryCache = null;
  grossMarginLibraryRequest = null;
}

export function refreshGrossMarginLibraryCache() {
  invalidateGrossMarginLibraryCache();
  return getGrossMarginLibrary();
}

export function saveGrossMarginPriceTable(input: { platform: GrossMarginPriceTable["platform"]; items: GrossMarginPriceTableSaveItem[] }) {
  return requestJson<{ table: GrossMarginPriceTable; library: GrossMarginLibrary }>("/api/gross-margin", {
    method: "POST",
    body: JSON.stringify({ action: "savePriceTable", ...input })
  }).then((result) => {
    rememberGrossMarginLibrary(result.library);
    return result;
  });
}

export function saveGrossMarginReviewTemplate(input: Pick<GrossMarginReviewTemplate, "platform" | "content">) {
  return requestJson<{ template: GrossMarginReviewTemplate; library: GrossMarginLibrary }>("/api/gross-margin", {
    method: "POST",
    body: JSON.stringify({ action: "saveReviewTemplate", ...input })
  }).then((result) => {
    rememberGrossMarginLibrary(result.library);
    return result;
  });
}

export function resolveGrossMarginVideoAccount(videoUrl: string, options: { signal?: AbortSignal } = {}) {
  return requestJson<{
    platform: GrossMarginPriceTable["platform"];
    accountName: string;
    videoUrl: string;
  }>("/api/gross-margin", {
    method: "POST",
    body: JSON.stringify({ action: "resolveVideoAccount", videoUrl }),
    signal: options.signal
  });
}

export function resetGrossMarginReviewTemplate(platform: GrossMarginReviewTemplate["platform"]) {
  return requestJson<{ template: GrossMarginReviewTemplate; library: GrossMarginLibrary }>("/api/gross-margin", {
    method: "POST",
    body: JSON.stringify({ action: "resetReviewTemplate", platform })
  }).then((result) => {
    rememberGrossMarginLibrary(result.library);
    return result;
  });
}

export function saveGrossMarginMonitorRecord(input: {
  platform: GrossMarginPriceTable["platform"];
  accountName: string;
  videoUrl: string;
  sourceText: string;
  targetStats: Partial<Record<GrossMarginServiceKind, number>>;
}) {
  return requestJson<{ record: GrossMarginMonitorRecord; library: GrossMarginLibrary }>("/api/gross-margin", {
    method: "POST",
    body: JSON.stringify({ action: "saveMonitorRecord", ...input })
  }).then((result) => {
    rememberGrossMarginLibrary(result.library);
    return result;
  });
}

export function bulkSaveGrossMarginMonitorRecords(input: {
  template: string;
  createProject?: boolean;
  projectName?: string;
}) {
  return requestJson<{
    records: GrossMarginMonitorRecord[];
    library: GrossMarginLibrary;
    project: { id: string; name: string } | null;
    parsed: unknown;
  }>("/api/gross-margin", {
    method: "POST",
    body: JSON.stringify({ action: "bulkSaveMonitorRecords", ...input })
  }).then((result) => {
    rememberGrossMarginLibrary(result.library);
    return result;
  });
}

export function refreshGrossMarginMonitorRecord(recordId: string) {
  return requestJson<{ record: GrossMarginMonitorRecord; library: GrossMarginLibrary }>("/api/gross-margin", {
    method: "POST",
    body: JSON.stringify({ action: "refreshMonitorRecord", recordId })
  }).then((result) => {
    rememberGrossMarginLibrary(result.library);
    return result;
  });
}

export function refreshGrossMarginMonitorRecords(recordIds?: string[]) {
  return requestJson<{ records: GrossMarginMonitorRecord[]; library: GrossMarginLibrary }>("/api/gross-margin", {
    method: "POST",
    body: JSON.stringify({ action: "refreshMonitorRecords", recordIds })
  }).then((result) => {
    rememberGrossMarginLibrary(result.library);
    return result;
  });
}

export function updateGrossMarginMonitorPlayTarget(recordId: string, target: number) {
  return requestJson<{ record: GrossMarginMonitorRecord; library: GrossMarginLibrary }>("/api/gross-margin", {
    method: "POST",
    body: JSON.stringify({ action: "updateMonitorPlayTarget", recordId, target })
  }).then((result) => {
    rememberGrossMarginLibrary(result.library);
    return result;
  });
}

export function updateGrossMarginMonitorPlayCurrent(recordId: string, current: number) {
  return requestJson<{ record: GrossMarginMonitorRecord; library: GrossMarginLibrary }>("/api/gross-margin", {
    method: "POST",
    body: JSON.stringify({ action: "updateMonitorPlayCurrent", recordId, current })
  }).then((result) => {
    rememberGrossMarginLibrary(result.library);
    return result;
  });
}

export function deleteGrossMarginMonitorRecord(recordId: string) {
  return requestJson<{ deleted: string; library: GrossMarginLibrary }>("/api/gross-margin", {
    method: "POST",
    body: JSON.stringify({ action: "deleteMonitorRecord", recordId })
  }).then((result) => {
    rememberGrossMarginLibrary(result.library);
    return result;
  });
}

export function getAccountDetail(input: { platform: Platform; accountId: string; includeStyle?: boolean }) {
  const params = new URLSearchParams({
    platform: input.platform,
    accountId: input.accountId
  });
  if (input.includeStyle) params.set("includeStyle", "1");
  return requestJson<AccountDetail>(`/api/accounts?${params.toString()}`);
}

export async function exportAccountTranscripts(input: { platform: Platform; accountId: string; videoIds?: string[] }) {
  const params = new URLSearchParams({ platform: input.platform, accountId: input.accountId });
  input.videoIds?.forEach((videoId) => params.append("videoId", videoId));
  const response = await fetch(`/api/accounts/transcripts-export?${params.toString()}`, {
    cache: "no-store"
  }).catch((error) => {
    throw new Error(describeRequestError(error));
  });

  if (!response.ok) {
    const fallbackResponse = response.clone();
    const data = (await response.json().catch(async () => {
      const text = await fallbackResponse.text().catch(() => "");
      return { error: summarizeHttpError(response.status, text, response.headers.get("content-type")) };
    })) as { error?: unknown };
    throw new Error(normalizeApiError(data.error) || summarizeHttpError(response.status));
  }

  const fileName = fileNameFromContentDisposition(response.headers.get("content-disposition")) || "账号转写稿.docx";
  const transcriptCount = Number(response.headers.get("x-transcript-count") || 0);
  downloadBlob(await response.blob(), fileName);
  return { fileName, transcriptCount };
}

export function getProjectDetail(projectId: string, options: { includeStyle?: boolean } = {}) {
  const params = new URLSearchParams({ projectId });
  if (options.includeStyle) params.set("includeStyle", "1");
  return requestJson<ProjectDetail>(`/api/projects?${params.toString()}`);
}

export function getJobs(cursor?: string) {
  const params = new URLSearchParams();
  if (cursor) params.set("cursor", cursor);
  const query = params.size ? `?${params.toString()}` : "";
  return requestJson<JobListResponse>(`/api/jobs${query}`);
}

export function getLibraryTrashOperations() {
  return requestJson<{ operations: LibraryTrashOperation[] }>("/api/library/trash");
}

export function restoreLibraryTrashOperation(operationId: string) {
  return requestJson<{ operation: LibraryTrashOperation }>("/api/library/trash", {
    method: "POST",
    body: JSON.stringify({ action: "restore", operationId })
  });
}

export function getJob(jobId: string) {
  return requestJson<{ job: JobRecord }>(`/api/jobs/${encodeURIComponent(jobId)}`).then((result) => {
    rememberDraftFromJob(result.job);
    rememberEngagementRecordFromJob(result.job);
    return result;
  });
}

export function startJob(input: JobStartInput) {
  return requestJson<{ job: JobRecord; jobId: string }>("/api/jobs", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function cancelJob(jobId: string) {
  return requestJson<{ job: JobRecord }>(`/api/jobs/${encodeURIComponent(jobId)}`, {
    method: "PATCH",
    body: JSON.stringify({ action: "cancel" })
  });
}

export function retryJob(jobId: string) {
  return requestJson<{ job: JobRecord }>(`/api/jobs/${encodeURIComponent(jobId)}`, {
    method: "PATCH",
    body: JSON.stringify({ action: "retry" })
  });
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

export function getDouyinHotlist(input: { force?: boolean; windowDays?: number; window?: string } = {}) {
  const windowKey = getDouyinHotlistWindowKey(input);
  if (input.force) resetDouyinHotlistCache();
  const cached = douyinHotlistCache.get(windowKey);
  if (cached) return Promise.resolve(cached);

  const inFlight = douyinHotlistRequests.get(windowKey);
  if (inFlight) return inFlight;

  const params = new URLSearchParams();
  params.set("window", windowKey);
  if (input.force) params.set("force", "1");
  const cacheRevision = douyinHotlistCacheRevision;
  const request = requestJson<DouyinHotlistResponse>(`/api/douyin-hotlist?${params.toString()}`)
    .then((result) => {
      if (cacheRevision === douyinHotlistCacheRevision) rememberDouyinHotlist(result);
      return result;
    })
    .finally(() => {
      if (douyinHotlistRequests.get(windowKey) === request) {
        douyinHotlistRequests.delete(windowKey);
      }
    });
  douyinHotlistRequests.set(windowKey, request);
  return request;
}

export function getCachedDouyinHotlist(input: { windowDays?: number; window?: string } = {}) {
  return douyinHotlistCache.get(getDouyinHotlistWindowKey(input)) || null;
}

export function getDouyinHotlistRefreshLogs(options: { signal?: AbortSignal } = {}) {
  return requestJson<DouyinHotlistRefreshLogResponse>("/api/douyin-hotlist/refresh-logs", {
    signal: options.signal
  });
}

export function addDouyinHotlistAccount(input: { platform: Platform; query: string; window?: string }) {
  return requestJson<DouyinHotlistResponse>("/api/douyin-hotlist", {
    method: "POST",
    body: JSON.stringify({ action: "addAccount", ...input })
  }).then((result) => {
    resetDouyinHotlistCache(result);
    return result;
  });
}

export function removeDouyinHotlistAccount(accountId: string, input: { window?: string } = {}) {
  return requestJson<DouyinHotlistResponse>("/api/douyin-hotlist", {
    method: "POST",
    body: JSON.stringify({ action: "removeAccount", accountId, ...input })
  }).then((result) => {
    resetDouyinHotlistCache(result);
    return result;
  });
}

export function refreshDouyinHotlist(input: {
  accountIds?: string[];
  limit?: number;
  windowDays?: number;
  window?: string;
} = {}) {
  return requestJson<DouyinHotlistRefreshResult>("/api/douyin-hotlist", {
    method: "POST",
    body: JSON.stringify({ action: "refresh", ...input })
  }).then((result) => {
    resetDouyinHotlistCache(result);
    return result;
  });
}

export function getHotspotRadar() {
  if (hotspotRadarCache) return Promise.resolve(hotspotRadarCache);
  if (hotspotRadarRequest) return hotspotRadarRequest;

  const cacheRevision = hotspotRadarCacheRevision;
  const request = requestJson<HotspotRadarResponse>("/api/hotspots")
    .then((result) => {
      if (cacheRevision === hotspotRadarCacheRevision) hotspotRadarCache = result;
      return result;
    })
    .finally(() => {
      if (hotspotRadarRequest === request) hotspotRadarRequest = null;
    });
  hotspotRadarRequest = request;
  return hotspotRadarRequest;
}

export function invalidateHotspotRadarCache() {
  hotspotRadarCacheRevision += 1;
  hotspotRadarCache = null;
  hotspotRadarRequest = null;
}

export function refreshHotspotRadar() {
  return requestJson<HotspotRadarRefreshResult>("/api/hotspots", {
    method: "POST",
    body: JSON.stringify({ action: "refresh" })
  }).then((result) => {
    hotspotRadarCache = result;
    return result;
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
  mediaUrl?: string;
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

export function hydrateVideos(input: { platform: Platform; accountId: string; videoIds: string[] }) {
  return requestJson<{ videos: Video[]; failedCount: number }>("/api/videos/hydrate", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function batchTranscribe(input: {
  platform: Platform;
  accountId: string;
  limit: number | "all";
  videoIds?: string[];
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
    videoIds?: string[];
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
  await readNdjsonStream<
    | { type: "stage"; stage: string; message: string; progress?: number }
    | { type: "result"; data: BatchTranscribeResult | ({ phase: "video" } & Record<string, unknown>) }
    | { type: "error"; message: string }
    | { type: "done" }
  >(
    "/api/batch-transcribe/stream",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input)
    },
    (event) => {
      if (event.type === "stage") handlers.onStage?.(event);
      if (event.type === "result" && (event.data as { phase?: string }).phase === "video") {
        handlers.onVideo?.(event.data as never);
      }
      if (event.type === "result" && !(event.data as { phase?: string }).phase) {
        handlers.onResult?.(event.data as BatchTranscribeResult);
      }
    }
  );
}

export function getTranscript(input: { platform: Platform; accountId: string; videoId: string }) {
  const params = new URLSearchParams(input);
  return requestJson<{ transcript: string; revision: string | null; versions: TranscriptVersion[] }>(`/api/transcripts?${params.toString()}`);
}

export function saveTranscript(input: {
  platform: Platform;
  accountId: string;
  videoId: string;
  transcript: string;
  expectedRevision: string | null;
}) {
  return requestJson<{
    transcript: string;
    revision: string | null;
    previousVersionCreated: boolean;
    versions: TranscriptVersion[];
  }>("/api/transcripts", {
    method: "PUT",
    body: JSON.stringify(input)
  });
}

export function restoreTranscriptVersion(input: {
  platform: Platform;
  accountId: string;
  videoId: string;
  versionId: string;
  expectedRevision: string | null;
}) {
  return requestJson<{
    transcript: string;
    revision: string | null;
    previousVersionCreated: boolean;
    versions: TranscriptVersion[];
  }>("/api/transcripts", {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export function getCopySources() {
  if (copySourcesCache) return Promise.resolve(copySourcesCache);
  if (copySourcesRequest) return copySourcesRequest;

  copySourcesRequest = requestJson<{ sources: CopySource[] }>("/api/copy-sources")
    .then((result) => {
      copySourcesCache = result;
      return result;
    })
    .finally(() => {
      copySourcesRequest = null;
    });
  return copySourcesRequest;
}

export function refreshCopySources() {
  copySourcesCache = null;
  copySourcesRequest = null;
  return getCopySources();
}

export function getCachedEngagementRecords() {
  return engagementRecordsCache;
}

export function getEngagementRecords() {
  if (engagementRecordsCache) return Promise.resolve(engagementRecordsCache);
  if (engagementRecordsRequest) return engagementRecordsRequest;

  const cacheRevision = engagementRecordsCacheRevision;
  const request = requestJson<{ records: EngagementRecordSummary[] }>("/api/engagement")
    .then((result) => {
      return cacheRevision === engagementRecordsCacheRevision
        ? rememberEngagementRecordList(result.records)
        : result;
    })
    .finally(() => {
      if (engagementRecordsRequest === request) engagementRecordsRequest = null;
    });
  engagementRecordsRequest = request;
  return engagementRecordsRequest;
}

export function getEngagementRecord(recordId: string, options: { fresh?: boolean } = {}) {
  const cached = engagementRecordOverrides.get(recordId);
  if (cached && !options.fresh) return Promise.resolve(cached);
  return requestJson<{ record: EngagementRecord }>(`/api/engagement?recordId=${encodeURIComponent(recordId)}`)
    .then(({ record }) => {
      rememberEngagementRecords([record]);
      return record;
    });
}

export function invalidateEngagementRecordsCache() {
  engagementRecordsCacheRevision += 1;
  engagementRecordsCache = null;
  engagementRecordsRequest = null;
}

export function refreshEngagementRecords() {
  invalidateEngagementRecordsCache();
  return getEngagementRecords();
}

export function transcribeCopySource(input: { url: string; titleHint?: string; analyzeVideo?: boolean }) {
  return requestJson<{ source: CopySource; result: LinkTranscriptionResult }>("/api/copy-sources", {
    method: "POST",
    body: JSON.stringify({ action: "transcribe", ...input })
  }).then((result) => {
    rememberCopySources([result.source]);
    return result;
  });
}

export type SingleVideoAssetKind = "video" | "cover" | "audio";

export type SingleVideoTranscribeResult = {
  url: string;
  resolvedUrl?: string;
  platform: Platform | "unknown";
  title?: string;
  sourceAccountName?: string;
  coverUrl?: string;
  mediaUrls?: string[];
  text: string;
  source: "platform_subtitle" | "volcengine" | "metadata";
  metadataTitle?: string;
  fallback?: boolean;
  fallbackReason?: string;
  timings?: { stage: string; ms: number }[];
};

export function transcribeSingleVideoLink(input: { url: string; titleHint?: string }) {
  return requestJson<{ result: SingleVideoTranscribeResult }>("/api/tools/single-video/transcribe", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function generatePublishCopy(input: PublishCopyInput) {
  return requestJson<PublishCopyResult>("/api/tools/publish-copy", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function downloadSingleVideoAsset(input: { url: string; kind: SingleVideoAssetKind }) {
  const response = await fetch("/api/tools/single-video/download", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(input),
    cache: "no-store"
  }).catch((error) => {
    throw new Error(describeRequestError(error));
  });

  if (!response.ok) {
    const fallbackResponse = response.clone();
    const data = (await response.json().catch(async () => {
      const text = await fallbackResponse.text().catch(() => "");
      return { error: summarizeHttpError(response.status, text, response.headers.get("content-type")) };
    })) as { error?: unknown };
    throw new Error(normalizeApiError(data.error) || summarizeHttpError(response.status));
  }

  const fallbackName = input.kind === "cover" ? "视频封面.jpg" : input.kind === "audio" ? "视频音频.mp3" : "视频文件.mp4";
  const fileName = fileNameFromContentDisposition(response.headers.get("content-disposition")) || fallbackName;
  const blob = await response.blob().catch((error) => {
    throw new Error(`下载中断：${error instanceof Error && error.message ? error.message : "服务传输过程中断，请重试。"}`);
  });
  downloadBlob(blob, fileName);
  return { fileName };
}

export function createProjectFromCopySources(input: {
  name: string;
  description?: string;
  sourceMaterialIds: string[];
}) {
  return requestJson<{ project: ProjectSummary }>("/api/copy-sources", {
    method: "POST",
    body: JSON.stringify({ action: "create_project", ...input })
  });
}

export function deleteCopySources(sourceIds: string[]) {
  return requestJson<{ deleted: string[] }>("/api/copy-sources", {
    method: "DELETE",
    body: JSON.stringify({ sourceIds })
  }).then((result) => {
    if (copySourcesCache) {
      const deleted = new Set(result.deleted);
      copySourcesCache = {
        sources: copySourcesCache.sources.filter((source) => !deleted.has(source.id))
      };
    }
    return result;
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

export function generateStyle(platform: Platform, accountId: string, force = false) {
  return requestJson<StyleGenerationResponse>("/api/style", {
    method: "POST",
    body: JSON.stringify({ platform, accountId, force })
  });
}

export async function streamGenerateStyle(
  input: {
    platform: Platform;
    accountId: string;
    force?: boolean;
  },
  handlers: {
    onStage?: (payload: { stage: string; message: string; progress?: number }) => void;
    onDelta?: (delta: string) => void;
    onResult?: (result: StyleGenerationResponse) => void;
  }
) {
  await readNdjsonStream<
    | { type: "stage"; stage: string; message: string; progress?: number }
    | { type: "delta"; delta: string }
    | { type: "result"; data: StyleGenerationResponse }
    | { type: "error"; message: string }
    | { type: "done" }
  >(
    "/api/style/stream",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input)
    },
    (event) => {
      if (event.type === "stage") handlers.onStage?.(event);
      if (event.type === "delta") handlers.onDelta?.(event.delta);
      if (event.type === "result") handlers.onResult?.(event.data);
    }
  );
}

export function upsertProject(input: {
  projectId?: string;
  name: string;
  description?: string;
  sourceAccountIds: string[];
  sourceMaterialIds?: string[];
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
    sourceMaterialIds?: string[];
  },
  handlers: {
    onStage?: (payload: { stage: string; message: string; progress?: number }) => void;
    onDelta?: (delta: string) => void;
    onResult?: (result: { project: ProjectSummary } & StyleGenerationResponse) => void;
  }
) {
  await readNdjsonStream<
    | { type: "stage"; stage: string; message: string; progress?: number }
    | { type: "delta"; delta: string }
    | { type: "result"; data: { project: ProjectSummary } & StyleGenerationResponse }
    | { type: "error"; message: string }
    | { type: "done" }
  >(
    "/api/projects/stream",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input)
    },
    (event) => {
      if (event.type === "stage") handlers.onStage?.(event);
      if (event.type === "delta") handlers.onDelta?.(event.delta);
      if (event.type === "result") handlers.onResult?.(event.data);
    }
  );
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

export function writeCopy(input: WriteCopyRequest) {
  return requestJson<WriteGenerationResult>("/api/write", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function uploadWriterSourceFiles(files: File[]) {
  const formData = new FormData();
  files.forEach((file) => formData.append("files", file));

  const response = await fetch("/api/write/file", {
    method: "POST",
    body: formData,
    cache: "no-store"
  }).catch((error) => {
    throw new Error(describeRequestError(error));
  });

  if (!response.ok) {
    throw new Error(await readApiErrorResponse(response));
  }
  return response.json() as Promise<{ files: WriterSourceFileImport[] }>;
}

export async function streamWriteCopy(
  input: WriteCopyRequest,
  handlers: {
    onStage?: (payload: { stage: string; message: string; progress?: number }) => void;
    onDelta?: (delta: string) => void;
    onResearch?: (research: string) => void;
    onResult?: (result: WriteGenerationResult) => void;
  }
) {
  await readNdjsonStream<
    | { type: "stage"; stage: string; message: string; progress?: number }
    | { type: "delta"; delta: string }
    | { type: "result"; data: (Partial<WriteResult> & { phase?: string }) | WriteBatchResult }
    | { type: "error"; message: string }
    | { type: "done" }
  >(
    "/api/write/stream",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input)
    },
    (event) => {
      if (event.type === "stage") {
        handlers.onStage?.(event);
      }
      if (event.type === "delta") {
        handlers.onDelta?.(event.delta);
      }
      if (event.type === "result") {
        if ("kind" in event.data && event.data.kind === "write-batch") {
          handlers.onResult?.(event.data);
          return;
        }
        const singleData = event.data as Partial<WriteResult> & { phase?: string };
        if (singleData.phase === "research" && singleData.research) {
          handlers.onResearch?.(singleData.research);
        }
        if (typeof singleData.content === "string" && typeof singleData.usedModel === "string") {
          handlers.onResult?.({
            content: singleData.content,
            research: singleData.research,
            contextFingerprint: singleData.contextFingerprint,
            sourceDigest: singleData.sourceDigest,
            draft: singleData.draft,
            usedModel: singleData.usedModel,
            fallback: Boolean(singleData.fallback),
            fallbackReason: singleData.fallbackReason
          });
        }
      }
    }
  );
}

export function saveDraft(input: DraftSaveInput) {
  return requestJson<Draft>("/api/drafts", {
    method: "POST",
    body: JSON.stringify(input)
  }).then((draft) => {
    rememberDrafts([draft]);
    return draft;
  });
}

export function renameDraft(input: { draftId: string; title: string }) {
  return requestJson<Draft>("/api/drafts", {
    method: "PATCH",
    body: JSON.stringify(input)
  }).then((draft) => {
    rememberDrafts([draft]);
    return draft;
  });
}

export function getDrafts() {
  if (draftsCache) return Promise.resolve(draftsCache);
  if (draftsRequest) return draftsRequest;

  const cacheRevision = draftsCacheRevision;
  const request = requestJson<{ drafts: DraftSummary[] }>("/api/drafts")
    .then((result) => {
      return cacheRevision === draftsCacheRevision ? rememberDraftList(result.drafts) : result;
    })
    .finally(() => {
      if (draftsRequest === request) draftsRequest = null;
    });
  draftsRequest = request;
  return draftsRequest;
}

export function getDraft(draftId: string, options: { fresh?: boolean } = {}) {
  const cached = draftOverrides.get(draftId);
  if (cached && !options.fresh) return Promise.resolve(cached);
  return requestJson<{ draft: Draft }>(`/api/drafts?draftId=${encodeURIComponent(draftId)}`)
    .then(({ draft }) => {
      rememberDrafts([draft]);
      return draft;
    });
}

export function invalidateDraftsCache() {
  draftsCacheRevision += 1;
  draftsCache = null;
  draftsRequest = null;
}

export function refreshDrafts() {
  invalidateDraftsCache();
  return getDrafts();
}

export function getCachedDrafts() {
  return draftsCache;
}

export function deleteDrafts(draftIds: string[]) {
  return requestJson<{ deleted: string[] }>("/api/drafts", {
    method: "DELETE",
    body: JSON.stringify({ draftIds })
  }).then((result) => {
    for (const draftId of result.deleted) {
      deletedDraftIds.add(draftId);
      draftOverrides.delete(draftId);
    }
    if (draftsCache) {
      const deleted = new Set(result.deleted);
      draftsCache = {
        drafts: draftsCache.drafts.filter((draft) => !deleted.has(draft.id))
      };
    }
    return result;
  });
}

export function deleteEngagementRecords(recordIds: string[]) {
  return requestJson<{ deleted: string[] }>("/api/engagement", {
    method: "DELETE",
    body: JSON.stringify({ recordIds })
  }).then((result) => {
    for (const recordId of result.deleted) engagementRecordOverrides.delete(recordId);
    if (engagementRecordsCache) {
      const deleted = new Set(result.deleted);
      engagementRecordsCache = {
        records: engagementRecordsCache.records.filter((record) => !deleted.has(record.id))
      };
    }
    return result;
  });
}

export async function exportEngagementRecord(recordId: string) {
  const params = new URLSearchParams({ recordId });
  const response = await fetch(`/api/engagement/export?${params.toString()}`, {
    cache: "no-store"
  }).catch((error) => {
    throw new Error(describeRequestError(error));
  });

  if (!response.ok) {
    const fallbackResponse = response.clone();
    const data = (await response.json().catch(async () => {
      const text = await fallbackResponse.text().catch(() => "");
      return { error: summarizeHttpError(response.status, text, response.headers.get("content-type")) };
    })) as { error?: unknown };
    throw new Error(normalizeApiError(data.error) || summarizeHttpError(response.status));
  }

  const fileName = fileNameFromContentDisposition(response.headers.get("content-disposition")) || "数据维护.docx";
  downloadBlob(await response.blob(), fileName);
  return { fileName };
}

export function generateDraftEngagement(input: {
  draftId: string;
  commentCount: number;
  danmakuCount: number;
}) {
  return requestJson<{
    draft: Draft;
    comments?: Draft["assets"] extends infer Assets
      ? Assets extends { comments?: infer Comments }
        ? Comments
        : never
      : never;
    danmaku?: Draft["assets"] extends infer Assets
      ? Assets extends { danmaku?: infer Danmaku }
        ? Danmaku
        : never
      : never;
    supportsDanmaku: boolean;
  }>("/api/draft-assets/engagement", {
    method: "POST",
    body: JSON.stringify(input)
  }).then((result) => {
    rememberDrafts([result.draft]);
    return result;
  });
}

export function generateEngagement(input: EngagementGenerationRequest) {
  return requestJson<{
    draft?: Draft;
    record: EngagementRecord;
    comments?: EngagementRecord["comments"];
    danmaku?: EngagementRecord["danmaku"];
  }>("/api/engagement", {
    method: "POST",
    body: JSON.stringify(input)
  }).then((result) => {
    if (result.draft) rememberDrafts([result.draft]);
    rememberEngagementRecords([result.record]);
    return result;
  });
}

export function collectDraftCoverReferences(draftId: string) {
  return requestJson<{ draft: Draft; references: DraftCoverReference[]; supportsCover: boolean }>("/api/draft-assets/cover/references", {
    method: "POST",
    body: JSON.stringify({ draftId })
  }).then((result) => {
    rememberDrafts([result.draft]);
    return result;
  });
}

export async function uploadDraftCoverReferences(input: { draftId: string; files: File[] }) {
  const formData = new FormData();
  formData.set("draftId", input.draftId);
  input.files.forEach((file) => formData.append("files", file));

  const response = await fetch("/api/draft-assets/cover/references", {
    method: "POST",
    body: formData,
    cache: "no-store"
  }).catch((error) => {
    throw new Error(describeRequestError(error));
  });

  const fallbackResponse = response.clone();
  const data = (await response.json().catch(async () => {
    const text = await fallbackResponse.text().catch(() => "");
    return { error: summarizeHttpError(response.status, text, response.headers.get("content-type")) };
  })) as { error?: unknown; draft?: Draft };

  if (!response.ok) {
    throw new Error(normalizeApiError(data.error) || summarizeHttpError(response.status));
  }
  if (data.draft) rememberDrafts([data.draft]);
  return data as { draft: Draft; references: DraftCoverReference[] };
}

export async function streamGenerateDraftCover(
  input: {
    draftId: string;
    referenceIds: string[];
    prompt?: string;
    count: number;
  },
  handlers: {
    onStage?: (payload: { stage: string; message: string; progress?: number }) => void;
    onResult?: (result: { draft: Draft; images: NonNullable<NonNullable<Draft["assets"]>["cover"]>["images"]; references: DraftCoverReference[] }) => void;
  }
) {
  await readNdjsonStream<
    | { type: "stage"; stage: string; message: string; progress?: number }
    | { type: "result"; data: { draft: Draft; images: NonNullable<NonNullable<Draft["assets"]>["cover"]>["images"]; references: DraftCoverReference[] } }
    | { type: "error"; message: string }
    | { type: "done" }
  >(
    "/api/draft-assets/cover/stream",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input)
    },
    (event) => {
      if (event.type === "stage") handlers.onStage?.(event);
      if (event.type === "result") {
        rememberDrafts([event.data.draft]);
        handlers.onResult?.(event.data);
      }
    }
  );
}

export function draftAssetFileUrl(draftId: string, path: string) {
  const params = new URLSearchParams({ draftId, path });
  return `/api/draft-assets/file?${params.toString()}`;
}

export function publishFeishuDocument(input: { title: string; content: string }) {
  return requestJson<{ title: string; documentId: string; url: string }>("/api/feishu/document", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export type WorkspaceHealthResponse = {
  appMode?: "workspace";
  opencli: { ok: boolean; bin: string; version: string };
  libraryRoot: string;
  volcengineAsrConfigured: boolean;
  chatConfigured: boolean;
  chatReachable: boolean;
  chat: {
    baseUrl: string;
    model: string;
    wireApi: "responses" | "chat_completions" | "auto";
    reasoningEffort: "none" | "low" | "medium" | "high" | "xhigh";
    serviceTier: string;
    responsesUrlConfigured: boolean;
    chatCompletionsUrlConfigured: boolean;
    proxyConfigured: boolean;
    configured: boolean;
    primary: {
      baseUrl: string;
      model: string;
      wireApi: "responses" | "chat_completions" | "auto";
      reasoningEffort: "none" | "low" | "medium" | "high" | "xhigh";
      serviceTier: string;
      responsesUrlConfigured: boolean;
      chatCompletionsUrlConfigured: boolean;
      proxyConfigured: boolean;
      configured: boolean;
    };
    fallback: {
      baseUrl: string;
      model: string;
      wireApi: "responses" | "chat_completions" | "auto";
      reasoningEffort: "none" | "low" | "medium" | "high" | "xhigh";
      serviceTier: string;
      responsesUrlConfigured: boolean;
      chatCompletionsUrlConfigured: boolean;
      proxyConfigured: boolean;
      configured: boolean;
    };
    fallbackEnabled: boolean;
    fallbackConfigured: boolean;
  };
  chatProbe: {
    ok: boolean;
    configured: boolean;
    source: "primary" | "fallback";
    model: string;
    wireApi: "responses" | "chat_completions" | "auto";
    attemptedWireApi?: "responses" | "chat_completions";
    endpoint?: string;
    latencyMs?: number;
    checkedAt: string;
    errorKind?: "not_configured" | "auth" | "quota" | "rate_limit" | "timeout" | "network" | "server" | "endpoint" | "parse" | "empty" | "unknown";
    message?: string;
    rawError?: string;
    primaryErrorKind?: "not_configured" | "auth" | "quota" | "rate_limit" | "timeout" | "network" | "server" | "endpoint" | "parse" | "empty" | "unknown";
    primaryMessage?: string;
    primaryRawError?: string;
  };
  imageConfigured?: boolean;
  image?: {
    baseUrl: string;
    model: string;
    size: string;
    quality: string;
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
};

export type GrossMarginHealthResponse = {
  appMode: "gross-margin";
  opencli: { ok: boolean; version: string; error?: string };
  storage: { ok: boolean; root: string; error?: string };
};

export type HealthResponse = WorkspaceHealthResponse | GrossMarginHealthResponse;

export async function getHealth(): Promise<HealthResponse> {
  const response = await fetch("/api/health", {
    headers: { "Content-Type": "application/json" },
    cache: "no-store"
  }).catch((error) => {
    throw new Error(describeRequestError(error));
  });
  const fallbackResponse = response.clone();
  const data = await response.json().catch(async () => {
    const text = await fallbackResponse.text().catch(() => "");
    return { error: summarizeHttpError(response.status, text, response.headers.get("content-type")) };
  });

  if (!response.ok && !isGrossMarginHealthResponse(data)) {
    throw new Error(formatApiErrorResponse(response, data));
  }
  return data as HealthResponse;
}

export function getRemoteStatus(options: { fresh?: boolean; signal?: AbortSignal } = {}) {
  const params = new URLSearchParams();
  if (options.fresh) params.set("fresh", "1");
  const suffix = params.size ? `?${params.toString()}` : "";
  return requestJson<RemoteStatusResponse>(`/api/remote/status${suffix}`, {
    signal: options.signal
  });
}

function isGrossMarginHealthResponse(value: unknown): value is GrossMarginHealthResponse {
  return Boolean(
    value &&
    typeof value === "object" &&
    (value as { appMode?: unknown }).appMode === "gross-margin" &&
    typeof (value as { opencli?: unknown }).opencli === "object" &&
    typeof (value as { storage?: unknown }).storage === "object"
  );
}

export function updateWriterPreference(input: { action: "remember"; draftId: string; text: string } | { action: "undo"; draftId: string; preferenceId: string }) {
  return requestJson<{ preferenceId: string; reference: import("./types").WriteStyleReferenceInput; action: "remember" | "undo" }>("/api/write/preference", { method: "POST", body: JSON.stringify(input) });
}

let imageRecordsCache: ImageGenerationList | null = null;
let imageRecordsRequest: Promise<ImageGenerationList> | null = null;
let imageRecordsRevision = 0;
export function invalidateImageRecordsCache() {
  imageRecordsCache = null;
  imageRecordsRequest = null;
  imageRecordsRevision += 1;
}
export function getImageRecords(offset = 0, canvasId?: string) {
  if (canvasId) return requestJson<ImageGenerationList>(`/api/images?offset=${offset}&canvasId=${encodeURIComponent(canvasId)}`);
  if (offset) return requestJson<ImageGenerationList>(`/api/images?offset=${offset}`);
  if (imageRecordsCache) return Promise.resolve(imageRecordsCache);
  if (imageRecordsRequest) return imageRecordsRequest;
  const revision = imageRecordsRevision;
  const request = requestJson<ImageGenerationList>("/api/images").then((result) => {
    if (revision === imageRecordsRevision) imageRecordsCache = result;
    return result;
  }).finally(() => { if (imageRecordsRequest === request) imageRecordsRequest = null; });
  imageRecordsRequest = request;
  return request;
}
export function getImageGenerationConfig() {
  return requestJson<ImageGenerationConfig>("/api/images/config");
}
export function getImageGenerationRecord(id: string) {
  return requestJson<{ record: ImageGenerationRecord; references: ImageFile[] }>(`/api/images/${encodeURIComponent(id)}`);
}
export async function uploadImageReferences(files: File[]) {
  const form = new FormData();
  files.forEach((file) => form.append("files", file));
  const response = await fetch("/api/images/references", { method: "POST", body: form }).catch((error) => {
    throw new Error(describeRequestError(error));
  });
  const data = await response.json().catch(() => { throw new Error("上传图片响应无效，请检查服务状态。"); }) as { references: ImageFile[]; error?: unknown };
  if (!response.ok) throw new Error(normalizeApiError(data.error) || "上传参考图失败，请重试。");
  return data;
}

export async function deleteImageGenerationRecords(input: { action: "delete"; id: string } | { action: "clear-failed" }) {
  const result = await requestJson<import("./image-generation-types").ImageRecordDeleteResult>("/api/images", { method: "DELETE", body: JSON.stringify(input) });
  invalidateImageRecordsCache();
  return result;
}

let aiSettingsRequest: Promise<import("./ai-policy-catalog").AiSettingsView> | null = null;
export function getAiModelSettings() {
  if (!aiSettingsRequest) {
    aiSettingsRequest = requestJson<import("./ai-policy-catalog").AiSettingsView>("/api/ai-settings")
      .finally(() => { aiSettingsRequest = null; });
  }
  return aiSettingsRequest;
}
export function saveAiModelSettings(value: import("./ai-policy-catalog").AiSettings) {
  return requestJson<import("./ai-policy-catalog").AiSettingsView>("/api/ai-settings", {
    method: "PUT", body: JSON.stringify(value)
  });
}
