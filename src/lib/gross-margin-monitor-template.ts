import type { GrossMarginPriceTable, GrossMarginServiceKind } from "./types";
import { extractVideoUrl, normalizeVideoUrlInput } from "./platform-links";

export type GrossMarginBulkMonitorItem = {
  platform: GrossMarginPriceTable["platform"];
  accountName: string;
  douyinId?: string;
  cooperationCode?: string;
  videoUrl: string;
  sourceText: string;
  targetStats: Partial<Record<GrossMarginServiceKind, number>>;
  warnings: string[];
};

export type GrossMarginBulkMonitorParseResult = {
  items: GrossMarginBulkMonitorItem[];
  warnings: string[];
};

const metricRules: Array<{
  service: GrossMarginServiceKind;
  labels: RegExp[];
}> = [
  {
    service: "play",
    labels: [
      /^(?:普通|低质|高质)?千川$/,
      /^千川无视版(?:播放)?$/,
      /^播放量?$/,
      /^播放量?（[^）]+）$/,
      /^科技播放$/
    ]
  },
  {
    service: "like",
    labels: [/^HKJ\s*点赞$/i, /^点赞$/, /^点赞（[^）]+）$/, /^科技点赞$/, /^千川点赞$/]
  },
  {
    service: "comment",
    labels: [/^自定义评论$/, /^评论$/, /^评论（[^）]+）$/]
  },
  {
    service: "favorite",
    labels: [/^收藏$/]
  },
  {
    service: "share",
    labels: [/^转发$/, /^分享$/]
  }
];

export function parseGrossMarginBulkMonitorTemplate(input: string): GrossMarginBulkMonitorParseResult {
  const blocks = splitMonitorTemplateBlocks(input);
  const warnings: string[] = [];
  const items = blocks
    .map((block, index) => parseMonitorTemplateBlock(block, index + 1))
    .filter((item): item is GrossMarginBulkMonitorItem => {
      if (item) return true;
      warnings.push("有一段模板没有识别到视频链接，已跳过。");
      return false;
    });

  if (!blocks.length && input.trim()) {
    warnings.push("没有识别到可用模板，请确认每条至少包含账号昵称和视频链接。");
  }

  return {
    items,
    warnings
  };
}

function splitMonitorTemplateBlocks(input: string) {
  const lines = input.replace(/\r\n/g, "\n").split("\n");
  const blocks: string[][] = [];
  let current: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      if (current.length) {
        blocks.push(current);
        current = [];
      }
      continue;
    }

    if (isAccountStartLine(line) && current.length) {
      blocks.push(current);
      current = [];
    }

    current.push(line);
  }

  if (current.length) blocks.push(current);
  return blocks.filter((block) => block.some((line) => line.includes("：") || line.includes(":")));
}

function parseMonitorTemplateBlock(lines: string[], position: number): GrossMarginBulkMonitorItem | null {
  const sourceText = lines.join("\n");
  const videoUrl = normalizeVideoUrlInput(extractVideoUrl(sourceText) || extractLineValue(lines, "视频链接"));
  if (!videoUrl) return null;

  const targetStats: Partial<Record<GrossMarginServiceKind, number>> = {};
  const warnings: string[] = [];
  for (const line of lines) {
    const pair = parseKeyValueLine(line);
    if (!pair) continue;
    const service = resolveMetricService(pair.key);
    if (!service) continue;
    const value = parseMetricValue(pair.value);
    if (value > 0) {
      targetStats[service] = value;
    }
  }

  if (!Object.keys(targetStats).length) {
    warnings.push(`第 ${position} 条没有识别到监控目标。`);
  }

  return {
    platform: "douyin",
    accountName: extractLineValue(lines, ["账号昵称", "账号", "账号名", "账号名称"]) || `未命名账号 ${position}`,
    douyinId: extractLineValue(lines, ["抖音 ID", "抖音ID"]),
    cooperationCode: extractLineValue(lines, "合作码"),
    videoUrl,
    sourceText,
    targetStats,
    warnings
  };
}

function isAccountStartLine(line: string) {
  return /^账号(?:昵称|名|名称)?\s*[：:]/.test(line);
}

function parseKeyValueLine(line: string) {
  const match = line.match(/^([^：:]+)\s*[：:]\s*(.+)$/);
  if (!match) return null;
  return {
    key: normalizeMetricLabel(match[1]),
    value: match[2].trim()
  };
}

function extractLineValue(lines: string[], labels: string | string[]) {
  const labelList = Array.isArray(labels) ? labels : [labels];
  for (const line of lines) {
    const pair = parseKeyValueLine(line);
    if (!pair) continue;
    if (labelList.some((label) => normalizeMetricLabel(label) === pair.key)) return pair.value;
  }
  return "";
}

function resolveMetricService(label: string) {
  return metricRules.find((rule) => rule.labels.some((pattern) => pattern.test(label)))?.service || null;
}

function normalizeMetricLabel(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function parseMetricValue(value: string) {
  const normalized = value.replace(/,/g, "").trim();
  const match = normalized.match(/([\d.]+)/);
  if (!match) return 0;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return 0;
  if (/[wW万]/.test(normalized)) return Math.round(amount * 10000);
  if (/千/.test(normalized)) return Math.round(amount * 1000);
  return Math.round(amount);
}
