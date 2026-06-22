import { promises as fs } from "fs";
import path from "path";
import {
  GrossMarginAccountPrice,
  GrossMarginCategory,
  GrossMarginLibrary,
  GrossMarginMonitorMetric,
  GrossMarginMonitorPlaySample,
  GrossMarginMonitorRecord,
  GrossMarginMonitorStatus,
  GrossMarginPriceOption,
  GrossMarginPriceTable,
  GrossMarginPriceTableSaveItem,
  GrossMarginReviewTemplate,
  GrossMarginServiceKind,
  GrossMarginTier
} from "../types";
import {
  getDefaultGrossMarginReviewTemplate,
  normalizeGrossMarginReviewTemplateContent,
  validateGrossMarginReviewTemplate
} from "../gross-margin-template";
import { nowIso, safeSegment, shortHash } from "../utils";
import { fileExists, readJsonFile, writeJsonFile } from "./fs";
import { libraryRoot, normalizeStorageSegment } from "./core";

const grossMarginTablePlatforms = ["douyin", "bilibili"] as const;
const grossMarginServices = ["play", "like", "douPlus", "coin", "comment", "share", "favorite", "danmaku", "blueLink"] as const;
const maxGrossMarginPlaySamples = 180;

function grossMarginPath() {
  return path.join(libraryRoot(), "gross-margin");
}

function grossMarginCategoriesPath() {
  return path.join(grossMarginPath(), "categories");
}

function grossMarginMonitorRecordsPath() {
  return path.join(grossMarginPath(), "monitor-records");
}

function grossMarginMonitorRecordJsonPath(id: string) {
  return path.join(grossMarginMonitorRecordsPath(), id + ".json");
}

function grossMarginCategoryJsonPath(id: string) {
  return path.join(grossMarginCategoriesPath(), id + ".json");
}

function grossMarginPriceTablePath(platform: GrossMarginPriceTable["platform"]) {
  return path.join(grossMarginPath(), platform + ".json");
}

function grossMarginReviewTemplatePath(platform: GrossMarginPriceTable["platform"]) {
  return path.join(grossMarginPath(), `${platform}.template.json`);
}

function grossMarginAccountsPath() {
  return path.join(grossMarginPath(), "accounts.json");
}

function normalizeGrossMarginCategoryId(categoryId: string) {
  return normalizeStorageSegment(categoryId, "毛利类目 ID");
}

function normalizeGrossMarginTierId(tierId: string) {
  return normalizeStorageSegment(tierId, "毛利档位 ID");
}

function normalizeGrossMarginMonitorRecordId(recordId: string) {
  return normalizeStorageSegment(recordId, "维护监控记录 ID");
}

function createGrossMarginMonitorRecordId(
  platform: GrossMarginPriceTable["platform"],
  videoKey: string,
  projectId?: string
) {
  const videoSegment = safeSegment(videoKey, shortHash(videoKey));
  const baseId = `${platform}-${videoSegment}`;
  if (!projectId?.trim()) return normalizeGrossMarginMonitorRecordId(baseId);
  const projectSegment = safeSegment(projectId, shortHash(projectId));
  return normalizeGrossMarginMonitorRecordId(`${baseId}-${projectSegment}`);
}

async function resolveExistingGrossMarginMonitorRecordId(input: {
  platform: GrossMarginPriceTable["platform"];
  videoKey: string;
  projectId?: string;
}) {
  const scopedId = createGrossMarginMonitorRecordId(input.platform, input.videoKey, input.projectId);
  if (!input.projectId?.trim()) return scopedId;
  if (await readJson<GrossMarginMonitorRecord>(grossMarginMonitorRecordJsonPath(scopedId))) return scopedId;

  const legacyId = createGrossMarginMonitorRecordId(input.platform, input.videoKey);
  const legacy = await readJson<GrossMarginMonitorRecord>(grossMarginMonitorRecordJsonPath(legacyId));
  if (legacy?.projectId?.trim() === input.projectId.trim()) return legacyId;
  return scopedId;
}

export async function ensureGrossMarginDirs() {
  await fs.mkdir(libraryRoot(), { recursive: true });
  await Promise.all([
    fs.mkdir(grossMarginPath(), { recursive: true }),
    fs.mkdir(grossMarginCategoriesPath(), { recursive: true }),
    fs.mkdir(grossMarginMonitorRecordsPath(), { recursive: true })
  ]);
}

async function exists(target: string) {
  return fileExists(target);
}

async function readJson<T>(target: string): Promise<T | null> {
  return readJsonFile<T>(target);
}

async function writeJson(target: string, value: unknown) {
  return writeJsonFile(target, value);
}

export async function getGrossMarginLibrary(): Promise<GrossMarginLibrary> {
  await ensureGrossMarginDirs();
  const tables = await Promise.all(
    grossMarginTablePlatforms.map(async (platform) => {
      const table = await readJson<GrossMarginPriceTable>(grossMarginPriceTablePath(platform));
      return normalizeGrossMarginPriceTable(platform, table);
    })
  );
  const templates = await Promise.all(grossMarginTablePlatforms.map((platform) => getGrossMarginReviewTemplate(platform)));
  const monitorRecords = await getGrossMarginMonitorRecords();

  return {
    root: grossMarginPath(),
    tables,
    templates,
    accounts: normalizeGrossMarginAccounts(await readJson<GrossMarginAccountPrice[]>(grossMarginAccountsPath())),
    monitorRecords,
    monitorProjects: buildGrossMarginMonitorProjects(monitorRecords)
  };
}

export async function getGrossMarginReviewTemplate(
  platformInput: GrossMarginPriceTable["platform"]
): Promise<GrossMarginReviewTemplate> {
  await ensureGrossMarginDirs();
  const platform = normalizeGrossMarginPlatform(platformInput);
  const template = await readJson<Partial<GrossMarginReviewTemplate>>(grossMarginReviewTemplatePath(platform));
  return normalizeGrossMarginReviewTemplate(platform, template);
}

export async function getGrossMarginMonitorRecords() {
  await ensureGrossMarginDirs();
  const files = await fs.readdir(grossMarginMonitorRecordsPath()).catch(() => []);
  const records = (
    await Promise.all(
      files
        .filter((file) => file.endsWith(".json"))
        .map((file) => readJson<GrossMarginMonitorRecord>(path.join(grossMarginMonitorRecordsPath(), file)))
    )
  ).filter(Boolean) as GrossMarginMonitorRecord[];

  return records
    .map(normalizeGrossMarginMonitorRecord)
    .sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt));
}

export async function upsertGrossMarginMonitorRecord(input: {
  platform: GrossMarginPriceTable["platform"];
  accountName: string;
  projectId?: string;
  projectName?: string;
  videoUrl: string;
  videoKey: string;
  sourceText: string;
  targetStats: Partial<Record<GrossMarginServiceKind, number>>;
  warnings?: string[];
}) {
  await ensureGrossMarginDirs();
  const now = nowIso();
  const platform = normalizeGrossMarginPlatform(input.platform);
  const videoKey = input.videoKey.trim();
  if (!videoKey) throw new Error("监控记录缺少视频标识");
  const projectId = input.projectId?.trim();
  const id = await resolveExistingGrossMarginMonitorRecordId({ platform, videoKey, projectId });
  const existing = await readJson<GrossMarginMonitorRecord>(grossMarginMonitorRecordJsonPath(id));
  const record = normalizeGrossMarginMonitorRecord({
    id,
    platform,
    accountName: input.accountName.trim() || existing?.accountName || "",
    projectId: projectId || existing?.projectId,
    projectName: input.projectName?.trim() || existing?.projectName,
    videoUrl: input.videoUrl.trim(),
    videoKey,
    title: existing?.title,
    publishedAt: existing?.publishedAt,
    sourceText: input.sourceText,
    targetStats: normalizeGrossMarginTargetStats(input.targetStats, platform),
    currentStats: existing?.currentStats,
    previousStats: existing?.previousStats,
    playSamples: existing?.playSamples,
    metrics: [],
    maxDifferencePercent: 0,
    highRisk: false,
    status: existing?.status || "pending",
    warnings: uniqueStrings(input.warnings ?? existing?.warnings ?? []),
    lastRefreshedAt: existing?.lastRefreshedAt,
    createdAt: existing?.createdAt || now,
    updatedAt: now
  });
  await writeJson(grossMarginMonitorRecordJsonPath(id), record);
  return record;
}

export async function saveGrossMarginMonitorRecord(record: GrossMarginMonitorRecord) {
  await ensureGrossMarginDirs();
  const normalized = normalizeGrossMarginMonitorRecord(record);
  await writeJson(grossMarginMonitorRecordJsonPath(normalized.id), normalized);
  return normalized;
}

export async function resolveGrossMarginMonitorRecord(recordId: string) {
  await ensureGrossMarginDirs();
  const id = normalizeGrossMarginMonitorRecordId(recordId);
  const record = await readJson<GrossMarginMonitorRecord>(grossMarginMonitorRecordJsonPath(id));
  if (!record) {
    throw new Error(`找不到维护监控记录：${id}`);
  }
  return normalizeGrossMarginMonitorRecord(record);
}

export async function deleteGrossMarginMonitorRecord(recordId: string) {
  await ensureGrossMarginDirs();
  const id = normalizeGrossMarginMonitorRecordId(recordId);
  const target = grossMarginMonitorRecordJsonPath(id);
  if (await exists(target)) {
    await fs.rm(target, { force: true });
  }
  return { deleted: id };
}

export async function saveGrossMarginPriceTable(input: {
  platform: GrossMarginPriceTable["platform"];
  items: GrossMarginPriceTableSaveItem[];
}) {
  await ensureGrossMarginDirs();
  const platform = normalizeGrossMarginPlatform(input.platform);
  const now = nowIso();
  const current = normalizeGrossMarginPriceTable(platform, await readJson<GrossMarginPriceTable>(grossMarginPriceTablePath(platform)));
  const byId = new Map(current.items.map((item) => [item.id, item]));

  for (const incoming of input.items) {
    const service = normalizeGrossMarginService(incoming.service);
    const id = normalizeStorageSegment(incoming.id, "单价项 ID");
    const currentItem = byId.get(id);
    byId.set(id, {
      id,
      service,
      name: incoming.name.trim() || formatGrossMarginServiceName(service),
      unitPrice: normalizeGrossMarginUnitPrice(incoming.unitPrice),
      quantityUnit: normalizeGrossMarginQuantityUnit(incoming.quantityUnit),
      minimumQuantity: normalizeIncomingGrossMarginMinimumQuantity(incoming, currentItem),
      note: incoming.note?.trim() || undefined,
      active: incoming.active ?? currentItem?.active ?? true,
      updatedAt: now
    });
  }

  const table = normalizeGrossMarginPriceTable(platform, {
    platform,
    items: [...byId.values()],
    updatedAt: now
  });

  await writeJson(grossMarginPriceTablePath(platform), table);
  return table;
}

export async function saveGrossMarginReviewTemplate(input: {
  platform: GrossMarginPriceTable["platform"];
  content: string;
}) {
  await ensureGrossMarginDirs();
  const platform = normalizeGrossMarginPlatform(input.platform);
  const content = validateGrossMarginReviewTemplate(input.content);
  const template = normalizeGrossMarginReviewTemplate(platform, {
    platform,
    content,
    customized: true,
    updatedAt: nowIso()
  });
  await writeJson(grossMarginReviewTemplatePath(platform), template);
  return template;
}

export async function resetGrossMarginReviewTemplate(platformInput: GrossMarginPriceTable["platform"]) {
  await ensureGrossMarginDirs();
  const platform = normalizeGrossMarginPlatform(platformInput);
  await fs.rm(grossMarginReviewTemplatePath(platform), { force: true });
  return normalizeGrossMarginReviewTemplate(platform, null);
}

export async function upsertGrossMarginCategory(input: {
  categoryId?: string;
  name: string;
  description?: string;
}) {
  await ensureGrossMarginDirs();
  const now = nowIso();
  const fallbackId = safeSegment(input.name, shortHash(input.name));
  const existing = input.categoryId
    ? await resolveGrossMarginCategory(input.categoryId)
    : await readJson<GrossMarginCategory>(grossMarginCategoryJsonPath(fallbackId));
  const id = existing?.id ?? normalizeGrossMarginCategoryId(fallbackId);
  const category: GrossMarginCategory = {
    id,
    name: input.name.trim() || existing?.name || "未命名类目",
    description: input.description?.trim() || undefined,
    tiers: existing?.tiers || [],
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };

  await writeJson(grossMarginCategoryJsonPath(id), normalizeGrossMarginCategory(category));
  return normalizeGrossMarginCategory(category);
}

export async function deleteGrossMarginCategories(categoryIds: string[]) {
  await ensureGrossMarginDirs();
  const uniqueIds = [...new Set(categoryIds)].filter(Boolean).map(normalizeGrossMarginCategoryId);
  const deleted: string[] = [];

  for (const categoryId of uniqueIds) {
    const target = grossMarginCategoryJsonPath(categoryId);
    if (!(await exists(target))) continue;
    await fs.rm(target, { force: true });
    deleted.push(categoryId);
  }

  return { deleted };
}

export async function upsertGrossMarginTier(input: {
  categoryId: string;
  tierId?: string;
  name: string;
  originalPrice: number;
  maintenanceCost: number;
  note?: string;
}) {
  await ensureGrossMarginDirs();
  const now = nowIso();
  const category = await resolveGrossMarginCategory(input.categoryId);
  const existingTier = input.tierId
    ? category.tiers.find((tier) => tier.id === normalizeGrossMarginTierId(input.tierId!))
    : undefined;
  if (input.tierId && !existingTier) {
    throw new Error(`找不到毛利档位：${input.tierId}`);
  }
  const id = existingTier?.id ?? safeSegment(`${input.name}-${shortHash(`${input.name}-${now}`)}`);
  const tier: GrossMarginTier = {
    id,
    name: input.name.trim() || existingTier?.name || "未命名档位",
    originalPrice: normalizeMoney(input.originalPrice),
    maintenanceCost: normalizeMoney(input.maintenanceCost),
    note: input.note?.trim() || undefined,
    createdAt: existingTier?.createdAt ?? now,
    updatedAt: now
  };
  const tiers = category.tiers.filter((item) => item.id !== id);
  const updated = normalizeGrossMarginCategory({
    ...category,
    tiers: [...tiers, tier],
    updatedAt: now
  });

  await writeJson(grossMarginCategoryJsonPath(category.id), updated);
  return { category: updated, tier };
}

export async function deleteGrossMarginTier(categoryId: string, tierId: string) {
  await ensureGrossMarginDirs();
  const category = await resolveGrossMarginCategory(categoryId);
  const normalizedTierId = normalizeGrossMarginTierId(tierId);
  const tiers = category.tiers.filter((tier) => tier.id !== normalizedTierId);
  if (tiers.length === category.tiers.length) {
    throw new Error(`找不到毛利档位：${normalizedTierId}`);
  }

  const updated = normalizeGrossMarginCategory({
    ...category,
    tiers,
    updatedAt: nowIso()
  });
  await writeJson(grossMarginCategoryJsonPath(category.id), updated);
  return { category: updated, deleted: normalizedTierId };
}

async function resolveGrossMarginCategory(categoryId: string) {
  const id = normalizeGrossMarginCategoryId(categoryId);
  const category = await readJson<GrossMarginCategory>(grossMarginCategoryJsonPath(id));
  if (!category) {
    throw new Error(`找不到毛利类目：${id}`);
  }
  return normalizeGrossMarginCategory(category);
}

function normalizeGrossMarginCategory(category: GrossMarginCategory): GrossMarginCategory {
  return {
    ...category,
    description: category.description?.trim() || undefined,
    tiers: (category.tiers || [])
      .map((tier) => ({
        ...tier,
        originalPrice: normalizeMoney(tier.originalPrice),
        maintenanceCost: normalizeMoney(tier.maintenanceCost),
        note: tier.note?.trim() || undefined
      }))
      .sort((a, b) => {
        if (a.originalPrice !== b.originalPrice) return a.originalPrice - b.originalPrice;
        return +new Date(a.createdAt) - +new Date(b.createdAt);
      })
  };
}

function normalizeGrossMarginPriceTable(
  platform: GrossMarginPriceTable["platform"],
  table?: GrossMarginPriceTable | null
): GrossMarginPriceTable {
  const now = table?.updatedAt || nowIso();
  const defaults = getDefaultGrossMarginPriceOptions(platform, now);
  const byId = new Map(defaults.map((item) => [item.id, item]));

  for (const item of table?.items || []) {
    const service = grossMarginServices.includes(item.service) ? item.service : undefined;
    if (!service) continue;
    const id = safeSegment(item.id, shortHash(`${platform}-${service}-${item.name}`));
    if (isRetiredGrossMarginOption(platform, id)) continue;
    const defaultItem = byId.get(id);
    const legacyName = normalizeLegacyGrossMarginOptionName(platform, id, item.name);
    byId.set(id, {
      id,
      service,
      name: legacyName || formatGrossMarginServiceName(service),
      unitPrice: normalizeGrossMarginUnitPrice(item.unitPrice),
      quantityUnit: normalizeGrossMarginQuantityUnit(item.quantityUnit),
      minimumQuantity: normalizeGrossMarginMinimumQuantity(item.minimumQuantity) ?? defaultItem?.minimumQuantity,
      note: normalizeLegacyGrossMarginOptionNote(platform, id, item.note) || undefined,
      active: item.active ?? defaultItem?.active ?? true,
      updatedAt: item.updatedAt || now
    });
  }

  return {
    platform,
    items: [...byId.values()].sort(compareGrossMarginPriceOptions),
    updatedAt: now
  };
}

function normalizeGrossMarginReviewTemplate(
  platform: GrossMarginPriceTable["platform"],
  template?: Partial<GrossMarginReviewTemplate> | null
): GrossMarginReviewTemplate {
  const defaultContent = getDefaultGrossMarginReviewTemplate(platform);
  const content = normalizeGrossMarginReviewTemplateContent(template?.content || "");
  const customized = Boolean(content);
  const effectiveContent = customized ? validateGrossMarginReviewTemplate(content) : defaultContent;

  return {
    platform,
    content: effectiveContent,
    defaultContent,
    customized,
    updatedAt: template?.updatedAt || nowIso()
  };
}

function normalizeLegacyGrossMarginOptionName(
  platform: GrossMarginPriceTable["platform"],
  id: string,
  name?: string
) {
  const trimmed = name?.trim() || "";
  if (platform !== "douyin") return trimmed;
  if (id === "douyin-play-tech" && trimmed === "科技（5w起）") return "千川无视版（5w起）";
  if (id === "douyin-play-qianchuan-10w" && trimmed === "低质千川（10w起）") return "普通千川（10w起）";
  return trimmed;
}

function normalizeLegacyGrossMarginOptionNote(
  platform: GrossMarginPriceTable["platform"],
  id: string,
  note?: string
) {
  const trimmed = note?.trim() || "";
  if (platform !== "douyin") return trimmed;
  if (id === "douyin-play-tech" && trimmed === "5w 起播放，55 元 / 万") return "千川无视版，5w 起播放，55 元 / 万";
  if (id === "douyin-play-qianchuan-10w" && trimmed === "低质千川，10w 起播放，23 元 / 万") {
    return "普通千川，10w 起播放，23 元 / 万";
  }
  return trimmed;
}

function normalizeGrossMarginAccounts(accounts?: GrossMarginAccountPrice[] | null): GrossMarginAccountPrice[] {
  const normalized: GrossMarginAccountPrice[] = [];

  for (const account of accounts || []) {
      const platform = account.platform === "bilibili" ? "bilibili" : account.platform === "douyin" ? "douyin" : undefined;
      const name = account.name?.trim();
      if (!platform || !name) continue;
      normalized.push({
        platform,
        name,
        defaultPrice: normalizeMoney(account.defaultPrice),
        priceLabel: account.priceLabel?.trim() || (platform === "douyin" ? "20-60秒报价" : "定制报价"),
        secondaryPrice: account.secondaryPrice ? normalizeMoney(account.secondaryPrice) : undefined,
        secondaryPriceLabel: account.secondaryPriceLabel?.trim() || undefined,
        douyinId: account.douyinId?.trim() || undefined,
        cooperationCode: account.cooperationCode?.trim() || undefined,
        bilibiliUid: account.bilibiliUid?.trim() || undefined,
        homepage: account.homepage?.trim() || undefined
      });
  }

  return normalized.sort((a, b) => {
    if (a.platform !== b.platform) return a.platform.localeCompare(b.platform);
    return a.name.localeCompare(b.name, "zh-CN");
  });
}

function normalizeGrossMarginMonitorRecord(record: GrossMarginMonitorRecord): GrossMarginMonitorRecord {
  const platform = record.platform === "bilibili" ? "bilibili" : "douyin";
  const targetStats = normalizeGrossMarginTargetStats(record.targetStats, platform);
  const currentStats = normalizeGrossMarginCurrentStats(record.currentStats);
  const previousStats = normalizeGrossMarginCurrentStats(record.previousStats);
  const playSamples = normalizeGrossMarginPlaySamples(record, currentStats);
  const metrics = buildGrossMarginMonitorMetrics(platform, targetStats, currentStats);
  const maxDifferencePercent = metrics.reduce((max, metric) => Math.max(max, metric.differencePercent), 0);
  const status = normalizeGrossMarginMonitorStatus(record.status);

  return {
    id: normalizeGrossMarginMonitorRecordId(record.id || `${platform}-${shortHash(record.videoUrl || record.videoKey || nowIso())}`),
    platform,
    accountName: record.accountName?.trim() || "",
    projectId: record.projectId?.trim() || undefined,
    projectName: record.projectName?.trim() || undefined,
    videoUrl: record.videoUrl?.trim() || "",
    videoKey: record.videoKey?.trim() || record.videoUrl?.trim() || "",
    title: record.title?.trim() || undefined,
    publishedAt: record.publishedAt?.trim() || undefined,
    sourceText: record.sourceText || "",
    targetStats,
    currentStats: Object.keys(currentStats).length ? currentStats : undefined,
    previousStats: Object.keys(previousStats).length ? previousStats : undefined,
    playSamples: playSamples.length ? playSamples : undefined,
    metrics,
    maxDifferencePercent,
    highRisk: metrics.some((metric) => metric.highRisk),
    status,
    warnings: uniqueStrings(record.warnings || []),
    lastRefreshedAt: record.lastRefreshedAt || undefined,
    createdAt: record.createdAt || nowIso(),
    updatedAt: record.updatedAt || record.createdAt || nowIso()
  };
}

function normalizeGrossMarginPlaySamples(
  record: GrossMarginMonitorRecord,
  currentStats: Partial<Record<GrossMarginServiceKind, number>>
) {
  const samples = normalizeGrossMarginPlaySampleList(record.playSamples);
  if (
    record.platform !== "bilibili" ||
    samples.length ||
    typeof currentStats.play !== "number" ||
    !record.lastRefreshedAt
  ) {
    return samples;
  }

  return normalizeGrossMarginPlaySampleList([
    {
      value: currentStats.play,
      capturedAt: record.lastRefreshedAt,
      source: "refresh"
    }
  ]);
}

function normalizeGrossMarginPlaySampleList(samples: GrossMarginMonitorPlaySample[] | undefined) {
  const byTimestamp = new Map<string, GrossMarginMonitorPlaySample>();

  for (const sample of samples || []) {
    const capturedAt = normalizeIsoTime(sample.capturedAt);
    if (!capturedAt) continue;
    byTimestamp.set(capturedAt, {
      value: normalizeGrossMarginMetricValue(sample.value),
      capturedAt,
      source: sample.source === "manual" ? "manual" : "refresh"
    });
  }

  return [...byTimestamp.values()]
    .sort((left, right) => +new Date(left.capturedAt) - +new Date(right.capturedAt))
    .slice(-maxGrossMarginPlaySamples);
}

export function appendGrossMarginPlaySample(
  samples: GrossMarginMonitorPlaySample[] | undefined,
  value: number | undefined,
  capturedAt: string,
  source: GrossMarginMonitorPlaySample["source"]
) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return normalizeGrossMarginPlaySampleList(samples);
  }

  return normalizeGrossMarginPlaySampleList([
    ...(samples || []),
    {
      value,
      capturedAt,
      source
    }
  ]);
}

function normalizeIsoTime(value?: string) {
  if (!value) return "";
  const time = +new Date(value);
  if (!Number.isFinite(time)) return "";
  return new Date(time).toISOString();
}

function buildGrossMarginMonitorProjects(records: GrossMarginMonitorRecord[]) {
  const projects = new Map<string, { id: string; name: string; count: number; updatedAt: string }>();

  for (const record of records) {
    const id = record.projectId?.trim();
    if (!id) continue;
    const current = projects.get(id);
    const updatedAt = record.updatedAt || record.createdAt || nowIso();
    if (!current) {
      projects.set(id, {
        id,
        name: record.projectName?.trim() || "未命名项目",
        count: 1,
        updatedAt
      });
      continue;
    }
    current.count += 1;
    if (+new Date(updatedAt) > +new Date(current.updatedAt)) current.updatedAt = updatedAt;
    if (record.projectName?.trim()) current.name = record.projectName.trim();
  }

  return [...projects.values()].sort((left, right) => +new Date(right.updatedAt) - +new Date(left.updatedAt));
}

function normalizeGrossMarginMonitorStatus(status?: GrossMarginMonitorStatus) {
  if (status === "completed" || status === "partial" || status === "failed" || status === "pending") return status;
  return "pending";
}

function normalizeGrossMarginTargetStats(
  stats: Partial<Record<GrossMarginServiceKind, number>> | undefined,
  platform: GrossMarginPriceTable["platform"]
) {
  const allowedServices =
    platform === "bilibili"
      ? (["play", "like", "coin", "favorite", "comment", "share", "danmaku", "blueLink"] as const)
      : (["play", "like", "comment", "favorite", "share"] as const);
  const normalized: Partial<Record<GrossMarginServiceKind, number>> = {};

  for (const service of allowedServices) {
    const value = normalizeGrossMarginMetricValue(stats?.[service]);
    if (value <= 0) continue;
    if (service === "blueLink" && value <= 0) continue;
    normalized[service] = value;
  }

  return normalized;
}

function normalizeGrossMarginCurrentStats(stats: Partial<Record<GrossMarginServiceKind, number>> | undefined) {
  const normalized: Partial<Record<GrossMarginServiceKind, number>> = {};
  for (const service of grossMarginServices) {
    if (!(service in (stats || {}))) continue;
    normalized[service] = normalizeGrossMarginMetricValue(stats?.[service]);
  }
  return normalized;
}

function normalizeGrossMarginMetricValue(value: number | undefined) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(Number(value)));
}

function buildGrossMarginMonitorMetrics(
  platform: GrossMarginPriceTable["platform"],
  targetStats: Partial<Record<GrossMarginServiceKind, number>>,
  currentStats?: Partial<Record<GrossMarginServiceKind, number>>
): GrossMarginMonitorMetric[] {
  const services =
    platform === "bilibili"
      ? (["play", "like", "coin", "favorite", "comment", "share", "danmaku", "blueLink"] as const)
      : (["play", "like", "comment", "favorite", "share"] as const);

  return services
    .map((service) => {
      const target = targetStats[service] || 0;
      if (target <= 0) return null;
      const hasCurrent = Boolean(currentStats && service in currentStats);
      const current = hasCurrent ? currentStats?.[service] || 0 : undefined;
      const difference = hasCurrent ? Math.max(0, target - (current ?? 0)) : 0;
      const differencePercent = hasCurrent && target > 0 ? difference / target : 0;
      return {
        service,
        label: formatGrossMarginMonitorServiceLabel(service, platform),
        target,
        current,
        difference,
        differencePercent,
        highRisk: hasCurrent && differencePercent >= 0.7,
        manualOnly: service === "blueLink" || (platform === "douyin" && service === "play")
      } satisfies GrossMarginMonitorMetric;
    })
    .filter(Boolean) as GrossMarginMonitorMetric[];
}

function formatGrossMarginMonitorServiceLabel(service: GrossMarginServiceKind, platform: GrossMarginPriceTable["platform"]) {
  if (service === "play") return "播放量";
  if (service === "like") return "点赞";
  if (service === "coin") return "投币";
  if (service === "favorite") return "收藏";
  if (service === "comment") return "评论";
  if (service === "share") return platform === "douyin" ? "转发" : "分享";
  if (service === "danmaku") return "弹幕";
  if (service === "blueLink") return "蓝链点击";
  return "抖加";
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function getDefaultGrossMarginPriceOptions(
  platform: GrossMarginPriceTable["platform"],
  now: string
): GrossMarginPriceOption[] {
  if (platform === "douyin") {
    return [
      {
        id: "douyin-play-tech",
        service: "play",
        name: "千川无视版（5w起）",
        unitPrice: 55,
        quantityUnit: "万",
        minimumQuantity: 5,
        note: "千川无视版，5w 起播放，55 元 / 万",
        updatedAt: now
      },
      {
        id: "douyin-play-qianchuan-10w",
        service: "play",
        name: "普通千川（10w起）",
        unitPrice: 23,
        quantityUnit: "万",
        minimumQuantity: 10,
        note: "普通千川，10w 起播放，23 元 / 万",
        updatedAt: now
      },
      {
        id: "douyin-play-qianchuan-high-10w",
        service: "play",
        name: "高质千川（10w起）",
        unitPrice: 55,
        quantityUnit: "万",
        minimumQuantity: 10,
        note: "高质千川，10w 起播放，55 元 / 万",
        updatedAt: now
      },
      {
        id: "douyin-like-tech",
        service: "like",
        name: "科技",
        unitPrice: 20,
        quantityUnit: "千",
        note: "20 / 千",
        updatedAt: now
      },
      {
        id: "douyin-like-qianchuan-1000",
        service: "like",
        name: "千川（1000起）",
        unitPrice: 110,
        quantityUnit: "千",
        minimumQuantity: 1,
        note: "110 / 千，1000 起安排",
        updatedAt: now
      },
      {
        id: "douyin-douplus-default",
        service: "douPlus",
        name: "默认",
        unitPrice: 1,
        quantityUnit: "元",
        note: "按实际投放金额计入成本",
        updatedAt: now
      },
      {
        id: "douyin-comment-custom",
        service: "comment",
        name: "自定义",
        unitPrice: 1,
        quantityUnit: "个",
        note: "1 / 个",
        updatedAt: now
      },
      {
        id: "douyin-share-standard",
        service: "share",
        name: "默认",
        unitPrice: 0.2,
        quantityUnit: "个",
        note: "0.2 / 个",
        updatedAt: now
      },
      {
        id: "douyin-favorite-standard",
        service: "favorite",
        name: "默认",
        unitPrice: 0.1,
        quantityUnit: "个",
        note: "0.1 / 个",
        updatedAt: now
      }
    ];
  }

  return [
    {
      id: "bilibili-play-default",
      service: "play",
      name: "正常通道（日速几千）",
      unitPrice: 60,
      quantityUnit: "万",
      note: "正常通道，日速几千，60 元 / 万",
      updatedAt: now
    },
    {
      id: "bilibili-play-fast",
      service: "play",
      name: "高速通道（日速2w）",
      unitPrice: 180,
      quantityUnit: "万",
      note: "高速通道，日速 2w，180 元 / 万",
      updatedAt: now
    },
    {
      id: "bilibili-like-default",
      service: "like",
      name: "默认",
      unitPrice: 30,
      quantityUnit: "千",
      note: "30 / 千",
      updatedAt: now
    },
    {
      id: "bilibili-coin-default",
      service: "coin",
      name: "默认",
      unitPrice: 0.2,
      quantityUnit: "个",
      note: "0.2 / 个",
      updatedAt: now
    },
    {
      id: "bilibili-comment-custom",
      service: "comment",
      name: "自定义",
      unitPrice: 0.7,
      quantityUnit: "个",
      note: "0.7 / 个",
      updatedAt: now
    },
    {
      id: "bilibili-share-standard",
      service: "share",
      name: "默认",
      unitPrice: 20,
      quantityUnit: "千",
      note: "20 / 千",
      updatedAt: now
    },
    {
      id: "bilibili-favorite-standard",
      service: "favorite",
      name: "默认",
      unitPrice: 20,
      quantityUnit: "千",
      note: "20 / 千",
      updatedAt: now
    },
    {
      id: "bilibili-danmaku-custom",
      service: "danmaku",
      name: "自定义",
      unitPrice: 0.15,
      quantityUnit: "个",
      note: "0.15 / 个",
      updatedAt: now
    },
    {
      id: "bilibili-blue-link-default",
      service: "blueLink",
      name: "默认",
      unitPrice: 0.8,
      quantityUnit: "个",
      note: "0.8 / 个",
      updatedAt: now
    }
  ];
}

function compareGrossMarginPriceOptions(a: GrossMarginPriceOption, b: GrossMarginPriceOption) {
  const serviceOrder = grossMarginServices.indexOf(a.service) - grossMarginServices.indexOf(b.service);
  if (serviceOrder !== 0) return serviceOrder;
  const optionOrder = grossMarginOptionRank(a.id) - grossMarginOptionRank(b.id);
  if (optionOrder !== 0) return optionOrder;
  return a.name.localeCompare(b.name, "zh-CN");
}

function grossMarginOptionRank(id: string) {
  if (id.includes("-play-tech")) return 10;
  if (id.includes("-play-qianchuan-10w")) return 20;
  if (id.includes("-play-qianchuan-high-10w")) return 30;
  if (id.includes("-play-qianchuan")) return 30;
  if (id.includes("-play-default")) return 40;
  if (id.includes("-play-fast")) return 50;
  if (id.includes("-like-tech")) return 10;
  if (id.includes("-like-qianchuan-1000")) return 20;
  if (id.includes("-like-default")) return 30;
  if (id.includes("-coin-default")) return 10;
  if (id.includes("-comment-custom")) return 10;
  if (id.includes("-danmaku-custom")) return 10;
  if (id.includes("-blue-link-default")) return 10;
  if (id.includes("-share-standard")) return 10;
  if (id.includes("-favorite-standard")) return 10;
  return 100;
}

function isRetiredGrossMarginOption(
  platform: GrossMarginPriceTable["platform"],
  id: string
) {
  if (platform !== "douyin") return false;
  return [
    "douyin-play-qianchuan-1-9w",
    "douyin-play-qianchuan-100w",
    "douyin-like-qianchuan-500",
    "douyin-comment-standard-boost",
    "douyin-comment-standard-quality"
  ].includes(id);
}

function normalizeGrossMarginPlatform(platform: string): GrossMarginPriceTable["platform"] {
  if (platform === "douyin" || platform === "bilibili") return platform;
  throw new Error("平台不支持");
}

function normalizeGrossMarginService(service: string): GrossMarginServiceKind {
  if (grossMarginServices.includes(service as GrossMarginServiceKind)) return service as GrossMarginServiceKind;
  throw new Error("维护项目不支持");
}

function formatGrossMarginServiceName(service: GrossMarginServiceKind) {
  if (service === "play") return "播放";
  if (service === "like") return "点赞";
  if (service === "douPlus") return "dou+";
  if (service === "coin") return "投币";
  if (service === "comment") return "评论";
  if (service === "share") return "转发量";
  if (service === "favorite") return "收藏量";
  if (service === "danmaku") return "自定义弹幕";
  return "蓝链点击";
}

function normalizeMoney(value: number) {
  return Number.isFinite(value) ? Number(value.toFixed(2)) : 0;
}

function normalizeGrossMarginUnitPrice(value: number) {
  return Number.isFinite(value) ? Number(value.toFixed(6)) : 0;
}

function normalizeGrossMarginQuantityUnit(value: string | undefined) {
  return value?.trim() || "个";
}

function normalizeGrossMarginMinimumQuantity(value: number | undefined) {
  if (!Number.isFinite(value)) return undefined;
  const safeValue = Number(value);
  if (safeValue <= 0) return undefined;
  return Number(safeValue.toFixed(6));
}

function normalizeIncomingGrossMarginMinimumQuantity(
  incoming: GrossMarginPriceTableSaveItem,
  currentItem?: GrossMarginPriceOption
) {
  if (!("minimumQuantity" in incoming)) return currentItem?.minimumQuantity;
  if (incoming.minimumQuantity === null) return undefined;
  return normalizeGrossMarginMinimumQuantity(incoming.minimumQuantity ?? undefined);
}
