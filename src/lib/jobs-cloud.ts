import type { JobDataChange, JobEvent, JobRecord, JobScope } from "./types";

type CloudJobRow = {
  id: string;
  type: string;
  scope: string;
  state: JobRecord["status"];
  input_json: string;
  progress_json: string | null;
  result_json: string | null;
  error: string | null;
  attempt: number;
  cancel_requested: boolean | number;
  data_revision: number;
  data_change_json: string | null;
  created_at: number;
  updated_at: number;
  started_at: number | null;
  finished_at: number | null;
};

type CloudJobBindings = { DB: D1Database };

let bindingsPromise: Promise<CloudJobBindings> | null = null;

async function getBindings() {
  if (!bindingsPromise) {
    const workersModule = "cloudflare:" + "workers";
    bindingsPromise = import(workersModule).then(({ env }) => {
      const DB = (env as unknown as Partial<CloudJobBindings>).DB;
      if (!DB) throw new Error("Sites 任务存储不可用：请确认 D1 `DB` 已配置。");
      return { DB };
    });
  }
  return bindingsPromise;
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new Error("云端任务记录损坏：JSON 字段无法解析。");
  }
}

function isoFromMillis(value: number | null | undefined) {
  return value ? new Date(value).toISOString() : undefined;
}

function millisFromIso(value: string | undefined) {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function rowToJob(row: CloudJobRow): JobRecord {
  const progress = parseJson<{
    title?: string;
    inputSummary?: string;
    href?: string;
    stage?: string;
    message?: string;
    progress?: number;
    partialText?: string;
    resultRef?: JobRecord["resultRef"];
    resultCompacted?: boolean;
    resultSizeBytes?: number;
    events?: JobEvent[];
    resumedAt?: string;
  }>(row.progress_json, {});
  const result = parseJson<{ value?: unknown }>(row.result_json, {});
  return {
    id: row.id,
    kind: row.type as JobRecord["kind"],
    status: row.state,
    title: progress.title || row.id,
    inputSummary: progress.inputSummary,
    scope: parseJson<JobScope | undefined>(row.scope, undefined),
    stage: progress.stage,
    message: progress.message || "任务状态已更新",
    progress: progress.progress ?? 0,
    href: progress.href,
    partialText: progress.partialText,
    resultRef: progress.resultRef,
    result: result.value,
    resultCompacted: progress.resultCompacted,
    resultSizeBytes: progress.resultSizeBytes,
    events: progress.events,
    dataRevision: row.data_revision || 0,
    dataChange: parseJson<JobDataChange | undefined>(row.data_change_json, undefined),
    attempt: row.attempt || 0,
    resumedAt: progress.resumedAt,
    error: row.error || undefined,
    createdAt: isoFromMillis(row.created_at) || new Date().toISOString(),
    updatedAt: isoFromMillis(row.updated_at) || new Date().toISOString(),
    completedAt: isoFromMillis(row.finished_at)
  };
}

export async function readCloudJob(jobId: string) {
  const { DB } = await getBindings();
  const row = await DB.prepare("SELECT * FROM cloud_jobs WHERE id = ?1 LIMIT 1").bind(jobId).first<CloudJobRow>();
  return row ? rowToJob(row) : null;
}

export async function listCloudJobs() {
  const { DB } = await getBindings();
  const rows = (await DB.prepare("SELECT * FROM cloud_jobs ORDER BY updated_at DESC").all<CloudJobRow>()).results || [];
  return rows.map(rowToJob);
}

export async function writeCloudJob(job: JobRecord) {
  const { DB } = await getBindings();
  const compact = job.resultCompacted ? { resultCompacted: true, resultSizeBytes: job.resultSizeBytes } : { value: job.result };
  const progress = JSON.stringify({
    title: job.title,
    inputSummary: job.inputSummary,
    href: job.href,
    stage: job.stage,
    message: job.message,
    progress: job.progress,
    partialText: job.partialText,
    resultRef: job.resultRef,
    resultCompacted: job.resultCompacted,
    resultSizeBytes: job.resultSizeBytes,
    events: job.events,
    resumedAt: job.resumedAt
  });
  const now = millisFromIso(job.updatedAt);
  await DB.prepare(
    `INSERT INTO cloud_jobs (id,type,scope,state,input_json,progress_json,result_json,error,attempt,cancel_requested,data_revision,data_change_json,created_at,updated_at,started_at,finished_at)
     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,0,?10,?11,?12,?13,?14,?15)
     ON CONFLICT(id) DO UPDATE SET type=?2,scope=?3,state=?4,progress_json=?6,result_json=?7,error=?8,attempt=?9,data_revision=?10,data_change_json=?11,updated_at=?13,started_at=COALESCE(?14,started_at),finished_at=?15,lease_owner=CASE WHEN ?4 IN ('completed','failed','cancelled','interrupted') THEN NULL ELSE lease_owner END,lease_expires_at=CASE WHEN ?4 IN ('completed','failed','cancelled','interrupted') THEN NULL ELSE lease_expires_at END`
  ).bind(
    job.id,
    job.kind,
    JSON.stringify(job.scope || {}),
    job.status,
    "{}",
    progress,
    JSON.stringify(compact),
    job.error || null,
    job.attempt || 0,
    job.dataRevision || 0,
    job.dataChange ? JSON.stringify(job.dataChange) : null,
    millisFromIso(job.createdAt),
    now,
    job.status === "running" ? now : null,
    job.completedAt ? millisFromIso(job.completedAt) : null
  ).run();

  const event = job.events?.at(-1);
  if (event) {
    const payloadJson = JSON.stringify(event);
    const previous = await DB.prepare(
      "SELECT payload_json FROM cloud_job_events WHERE job_id = ?1 ORDER BY id DESC LIMIT 1"
    ).bind(job.id).first<{ payload_json: string }>();
    if (previous?.payload_json !== payloadJson) {
      await DB.prepare("INSERT INTO cloud_job_events (job_id,kind,payload_json,created_at) VALUES (?1,?2,?3,?4)")
        .bind(job.id, "state", payloadJson, millisFromIso(event.at))
        .run();
    }
  }
}

export async function claimCloudJob(jobId: string, owner: string, leaseMs = 120_000) {
  const { DB } = await getBindings();
  const now = Date.now();
  const result = await DB.prepare(
    "UPDATE cloud_jobs SET state='running',lease_owner=?2,lease_expires_at=?3,started_at=COALESCE(started_at,?4),updated_at=?4 WHERE id=?1 AND (state='queued' OR (state='running' AND (lease_expires_at IS NULL OR lease_expires_at < ?4)))"
  ).bind(jobId, owner, now + leaseMs, now).run();
  return (result.meta?.changes || 0) > 0;
}

export async function deleteCloudJob(jobId: string) {
  const { DB } = await getBindings();
  await DB.prepare("DELETE FROM cloud_job_events WHERE job_id = ?1").bind(jobId).run();
  await DB.prepare("DELETE FROM cloud_jobs WHERE id = ?1").bind(jobId).run();
  await DB.prepare("INSERT INTO cloud_job_events (job_id,kind,payload_json,created_at) VALUES (?1,'removed','{}',?2)")
    .bind(jobId, Date.now())
    .run();
}

export async function getCloudJobEventCursor() {
  const { DB } = await getBindings();
  const row = await DB.prepare("SELECT COALESCE(MAX(id), 0) AS cursor FROM cloud_job_events").first<{ cursor: number }>();
  return Number(row?.cursor || 0);
}

export async function listCloudJobEvents(afterId: number) {
  const { DB } = await getBindings();
  return (await DB.prepare("SELECT id,job_id,kind,payload_json FROM cloud_job_events WHERE id > ?1 ORDER BY id LIMIT 1201").bind(afterId).all<{ id: number; job_id: string; kind: string; payload_json: string }>()).results || [];
}

export async function getCloudJobEventBounds() {
  const { DB } = await getBindings();
  const row = await DB.prepare(
    "SELECT MIN(id) AS first_id, MAX(id) AS last_id FROM cloud_job_events"
  ).first<{ first_id: number | null; last_id: number | null }>();
  return {
    firstId: row?.first_id == null ? null : Number(row.first_id),
    lastId: row?.last_id == null ? 0 : Number(row.last_id)
  };
}
