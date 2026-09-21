export interface RadarSource { id: string; name: string; url: string; type: string; scope: string; tier?: string; itemLimit?: number }
export interface RadarSignal { id: string; sourceId: string; source: string; originalSource: string; title: string; summary: string; url: string; category: string; publishedAt: string; collectedAt: string; coarseScore?: number; coarseReasons?: string[]; modelCoarseReason?: string; related?: RadarSignal[] }
export const SOURCES: RadarSource[];
export function coarseFilter(items: RadarSignal[]): RadarSignal[];
export function isLowValueRoutineSports(item: RadarSignal): boolean;
export function sameHotspotEvent(a: RadarSignal, b: RadarSignal): boolean;
export function sameEvent(a: string, b: string, aDate: string, bDate: string): boolean;
export function isRecentVerifiedSignal(item: {publishedAt?: string}): boolean;
export function extractArticleDate(html: string, url: string): string;
export function filterSourceItems(items: RadarSignal[], source: RadarSource): RadarSignal[];
export function makeSignal(source: RadarSource, title: string, url: string, summary: string, publishedAt: string): RadarSignal;
export function parseRss(html: string, source: RadarSource): RadarSignal[];
export const parseMrs: typeof parseRss;
export const parseFamitsu: typeof parseRss;
export const parseGamersky: typeof parseRss;
export const parse5EPlay: typeof parseRss;
export const parse17173: typeof parseRss;
export const parseDianjinghu: typeof parseRss;
export const parse3DM: typeof parseRss;
export const parseSinaEsports: typeof parseRss;
export const parseDota2CN: typeof parseRss;
export const parseQQNews: typeof parseRss;
export const parseGenericNewsPage: typeof parseRss;
