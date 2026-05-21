export type LinkInputKind = "any" | "video" | "account";

export type ExtractedLinkInput = {
  raw: string;
  url: string;
  start: number;
  end: number;
};

type LinkInputOptions = {
  kind?: LinkInputKind;
};

const TRAILING_PUNCTUATION = /[)\]}>，。！？、；;,.!?）】\]]+$/;
const EXPLICIT_URL_PATTERN = /https?:\/\/[^\s<>"']+/gi;
const KNOWN_DOMAIN_PATTERN = /(?:v\.douyin\.com|www\.douyin\.com|douyin\.com|www\.iesdouyin\.com|iesdouyin\.com|b23\.tv|space\.bilibili\.com|www\.bilibili\.com|m\.bilibili\.com|bilibili\.com)\/[^\s<>"']+/gi;

export function extractLinksFromInput(input?: string, options: LinkInputOptions = {}): ExtractedLinkInput[] {
  const text = input || "";
  if (!text.trim()) return [];

  const links = [
    ...collectPatternLinks(text, EXPLICIT_URL_PATTERN, options),
    ...collectPatternLinks(text, KNOWN_DOMAIN_PATTERN, options)
  ].sort((left, right) => left.start - right.start || right.end - left.end);

  const unique: ExtractedLinkInput[] = [];
  const seenRanges = new Set<string>();
  const seenUrls = new Set<string>();
  for (const link of links) {
    const rangeKey = `${link.start}:${link.end}`;
    const urlKey = link.url.toLowerCase();
    if (seenRanges.has(rangeKey) || seenUrls.has(urlKey)) continue;
    if (unique.some((existing) => link.start >= existing.start && link.end <= existing.end)) continue;
    seenRanges.add(rangeKey);
    seenUrls.add(urlKey);
    unique.push(link);
  }

  return unique;
}

export function extractFirstLinkFromInput(input?: string, options: LinkInputOptions = {}) {
  return extractLinksFromInput(input, options)[0]?.url || "";
}

export function normalizeLinkInput(input?: string, options: LinkInputOptions = {}) {
  const trimmed = input?.trim() || "";
  return extractFirstLinkFromInput(trimmed, options) || trimmed;
}

export function createUrlPreprocessor(options: LinkInputOptions = {}) {
  return (value: unknown) => (typeof value === "string" ? normalizeLinkInput(value, options) : value);
}

function collectPatternLinks(text: string, pattern: RegExp, options: LinkInputOptions) {
  return [...text.matchAll(pattern)]
    .map((match) => {
      const raw = trimLinkToken(match[0]);
      const url = normalizeLinkToken(raw);
      const start = match.index || 0;
      return {
        raw,
        url,
        start,
        end: start + raw.length
      };
    })
    .filter((link) => link.raw && link.url && isAllowedLink(link.url, options));
}

function trimLinkToken(token: string) {
  return token.replace(TRAILING_PUNCTUATION, "");
}

function normalizeLinkToken(token: string) {
  const trimmed = trimLinkToken(token.trim());
  if (!trimmed) return "";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function isAllowedLink(url: string, options: LinkInputOptions) {
  if (options.kind === "video") return isVideoLink(url);
  if (options.kind === "account") return isAccountLink(url);
  return true;
}

function isVideoLink(url: string) {
  if (/b23\.tv|BV[0-9A-Za-z]+|\/video\/|\/aweme\/share\/video\//i.test(url)) return true;
  if (/v\.douyin\.com/i.test(url)) return true;
  if (/bilibili\.com|douyin\.com|iesdouyin\.com/i.test(url)) return true;
  return false;
}

function isAccountLink(url: string) {
  if (/space\.bilibili\.com\/\d+|douyin\.com\/user\/|iesdouyin\.com\/share\/user\/|[?&]sec_uid=/i.test(url)) return true;
  return isVideoLink(url);
}
