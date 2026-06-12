import type { VideoHotlistSurgeState, VideoHotlistTrend } from "./types";

const SURGE_RETENTION_HOURS = 6;
const SURGE_INTERVAL_FLOOR_HOURS = 0.25;
const SURGE_SHORT_INTERVAL_HOURS = 1;
const SURGE_MEDIUM_INTERVAL_HOURS = 6;
const SURGE_MIN_VERY_SHORT_HEAT_DELTA = 6_000;
const SURGE_MIN_SHORT_HEAT_DELTA = 8_000;
const SURGE_MIN_HEAT_DELTA = 12_000;
const SURGE_SHORT_MIN_HEAT_PER_HOUR = 18_000;
const SURGE_MEDIUM_MIN_HEAT_PER_HOUR = 10_000;
const SURGE_LONG_MIN_HEAT_PER_HOUR = 6_000;

export type HotlistSurgeDecision = {
  heatDelta: number;
  heatPerHour: number;
  intervalHours: number;
  minHeatPerHour: number;
};

export function getHotlistSurgeDecision(trend?: VideoHotlistTrend): HotlistSurgeDecision | null {
  if (!trend || trend.heatDelta <= 0 || trend.intervalHours <= 0) return null;

  const intervalHours = Math.max(SURGE_INTERVAL_FLOOR_HOURS, trend.intervalHours);
  const heatPerHour = trend.heatDelta / intervalHours;
  const minHeatPerHour = getSurgeMinHeatPerHour(intervalHours);
  const minHeatDelta = getSurgeMinHeatDelta(intervalHours, minHeatPerHour);
  if (trend.heatDelta < minHeatDelta || heatPerHour < minHeatPerHour) return null;

  return {
    heatDelta: Math.round(trend.heatDelta),
    heatPerHour: Math.round(heatPerHour),
    intervalHours: roundTo(trend.intervalHours, 2),
    minHeatPerHour
  };
}

export function createHotlistSurgeState(
  decision: HotlistSurgeDecision,
  detectedAt: string
): VideoHotlistSurgeState {
  const detectedTime = new Date(detectedAt).getTime();
  const expiresAt = new Date(detectedTime + SURGE_RETENTION_HOURS * 3_600_000).toISOString();

  return {
    heatDelta: decision.heatDelta,
    heatPerHour: decision.heatPerHour,
    intervalHours: decision.intervalHours,
    detectedAt,
    expiresAt
  };
}

export function isHotlistSurgeActive(
  state: VideoHotlistSurgeState | undefined,
  now = Date.now()
): state is VideoHotlistSurgeState {
  if (!state?.expiresAt) return false;
  const expiresAt = new Date(state.expiresAt).getTime();
  return Number.isFinite(expiresAt) && expiresAt > now;
}

export function formatHotlistSurgeReason(input: Pick<VideoHotlistSurgeState, "heatDelta" | "heatPerHour" | "intervalHours">) {
  return `${formatTrendInterval(input.intervalHours)}热度 +${formatCompactCount(input.heatDelta)}，约 ${formatCompactCount(input.heatPerHour)}/小时`;
}

export function getHotlistSurgeLabel(rank: number, heatPerHour: number, minHeatPerHour: number) {
  return rank <= 3 && heatPerHour >= minHeatPerHour * 1.5 ? "猛涨" : "飙升";
}

export function getSurgeMinHeatPerHour(intervalHours: number) {
  if (intervalHours <= SURGE_SHORT_INTERVAL_HOURS) return SURGE_SHORT_MIN_HEAT_PER_HOUR;
  if (intervalHours <= SURGE_MEDIUM_INTERVAL_HOURS) return SURGE_MEDIUM_MIN_HEAT_PER_HOUR;
  return SURGE_LONG_MIN_HEAT_PER_HOUR;
}

function getSurgeMinHeatDelta(intervalHours: number, minHeatPerHour: number) {
  if (intervalHours <= SURGE_INTERVAL_FLOOR_HOURS) return SURGE_MIN_VERY_SHORT_HEAT_DELTA;
  if (intervalHours <= SURGE_SHORT_INTERVAL_HOURS) return SURGE_MIN_SHORT_HEAT_DELTA;
  return Math.max(SURGE_MIN_HEAT_DELTA, minHeatPerHour * Math.min(intervalHours, 3));
}

function formatCompactCount(value: number) {
  if (value >= 10000) return `${Math.round(value / 1000) / 10}万`;
  if (value >= 1000) return `${Math.round(value / 100) / 10}k`;
  return String(value);
}

function formatTrendInterval(intervalHours: number) {
  if (intervalHours < 1) return `${Math.max(1, Math.round(intervalHours * 60))}分钟内`;
  if (intervalHours < 24) return `${Math.round(intervalHours * 10) / 10}小时内`;
  return `${Math.round((intervalHours / 24) * 10) / 10}天内`;
}

function roundTo(value: number, digits: number) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
