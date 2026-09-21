import Parser from "rss-parser";
import { makeSignal } from "./source-rules.mjs";
import type { RadarSource } from "./source-rules.mjs";

const parser = new Parser({ customFields: { item: ["dc:date", "updated"] } });
/** 保留现有网络超时、代理与取消链，只将 XML 解析交给 rss-parser。 */
export async function parseRadarFeed(xml: string, source: RadarSource) {
  const feed = await parser.parseString(xml);
  return feed.items.flatMap(item => {
    const link = item.link || (item.guid?.startsWith("http") ? item.guid : "");
    if (!item.title || !link) return [];
    const date = item.isoDate || item.pubDate || item["dc:date"] || item.updated || "";
    return [makeSignal(source, item.title, new URL(link, source.url).href, item.contentSnippet || item.summary || item.content || "", date)];
  });
}
