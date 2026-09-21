import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import { SOURCES, parseRss, makeSignal, isRecentVerifiedSignal } from "../src/lib/hotspot-radar/source-rules.mjs";
import { mergeRadarSignals, safeSourceUrl } from "../src/lib/hotspot-radar/collector";
import { analyzeRadar, parseRadarModelJson, validateModelIds } from "../src/lib/hotspot-radar/analysis";
import { assertCollectionCoverage, getRadarSignals, getHotspotRadar, getHotspotDetail, retainPriorityTopics, saveHotspotFeedback } from "../src/lib/hotspots";
import type { HotspotEvent, HotspotRadarRefreshResult } from "../src/lib/types";

import { parseRadarFeed } from "../src/lib/hotspot-radar/rss";
import { writeRadarCollection, updateRadarCollection, readRadarCollection } from "../src/lib/hotspot-radar/collection";

const source = SOURCES[1];
const signal = () => makeSignal(source, "Faker战队回应赛事争议", "https://www.vlr.gg/123", "赛事人物反转，官方回应引发争议", new Date().toISOString());

test("真实来源、RSS 时间过滤、事件聚类保留来源和模型 ID 边界", () => {
  assert.equal(SOURCES.length, 36);
  assert.ok(SOURCES.every(item => item.url && item.type !== "reference"));
  const items = parseRss(`<rss><item><title>赛事争议</title><link>https://www.vlr.gg/123</link><pubDate>${new Date().toUTCString()}</pubDate><description>摘要</description></item></rss>`, source);
  assert.equal(items.length, 1);
  assert.equal(isRecentVerifiedSignal(items[0]), true);
  assert.equal(isRecentVerifiedSignal({ publishedAt: "" }), false);
  assert.equal(isRecentVerifiedSignal({ publishedAt: new Date(Date.now() - 73 * 3600000).toISOString() }), false);
  assert.equal(isRecentVerifiedSignal({ publishedAt: new Date(Date.now() + 7 * 3600000).toISOString() }), false);
  const first = signal();
  const second = { ...first, id: "other", url: "https://other.example/story", source: "另一媒体" };
  assert.deepEqual(mergeRadarSignals([first, second])[0].related?.map(item => item.url), [second.url]);
  assert.throws(() => validateModelIds([{ signalId: "invented" }], [first]), /未知/);
  assert.throws(() => validateModelIds([{ signalId: first.id }, { signalId: first.id }], [first]), /重复/);
  assert.throws(() => parseRadarModelJson("not json", z.object({})), /格式无效/);
  assert.throws(() => safeSourceUrl("file:///etc/passwd"), /HTTP/);
  assert.throws(() => safeSourceUrl("http://127.0.0.1/private"), /内网/);
  assert.throws(() => assertCollectionCoverage([{ source, items: [], checkedAt: "" }]), /覆盖不足/);
});

test("模型两轮、合法空选题、部分批次失败、取消与持久化反馈", async () => {
  const env = { ...process.env };
  const root = await mkdtemp(path.join(tmpdir(), "hotspot-radar-test-"));
  let mode = "success";
  let requests = 0;
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    const payload = JSON.parse(body.messages[1].content);
    const system = body.messages[0].content as string;
    requests++;
    if (mode === "partial" && payload.items?.some((item: {id: string}) => item.id === "s40")) { res.writeHead(401); res.end("unauthorized"); return; }
    if (mode === "fine-partial" && system.includes("资深") && payload.items?.some((item: {id: string}) => item.id === "s6")) { res.writeHead(401); res.end("unauthorized"); return; }
    let result: unknown;
    if (mode === "empty") result = { items: [] };
    else if (system.includes("第一轮")) result = { items: payload.items.map((item: {id: string}) => ({ signalId: item.id, coarseReason: "人物反转" })) };
    else if (system.includes("资深")) result = { items: payload.items.map((item: {id: string}) => ({ signalId: item.id, subject: "英雄联盟", titleZh: "赛事争议获回应", summaryZh: "赛事争议有了新回应", type: "赛事电竞", grade: "吊爆了", whyHot: "官方回应节点", commentDirection: "讨论责任归属", entryPoint: "这场回应说清了吗" })) };
    else result = { headline: "赛事新进展", overview: "关注回应", signals: ["人物反转"], communityMood: "编辑预测：责任讨论", tomorrowWatch: ["后续回应"] };
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(result) } }] }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  for (const key of Object.keys(process.env)) if (/^(CHAT_|OPENAI_|FHL_|SITES_)/.test(key)) delete process.env[key];
  Object.assign(process.env, { STYLE_LIBRARY_DIR: root, CHAT_API_KEY: "test", CHAT_MODEL: "test", CHAT_BASE_URL: `http://127.0.0.1:${address.port}/v1`, CHAT_WIRE_API: "chat_completions" });
  const feedback = { schemaVersion: 1 as const, ratings: [], history: [] };
  try {
    const first = signal();
    const stages: string[] = [];
    const analyzed = await analyzeRadar([first], feedback, { onProgress: p => { stages.push(p.stage || ""); } });
    assert.equal(analyzed.hotspots.length, 1);
    assert.equal(analyzed.analysis.coverage, 100);
    assert.equal((await analyzed.report(analyzed.hotspots))?.headline, "赛事新进展");
    assert.deepEqual(stages, ["AI 粗筛", "AI 精筛"]);
    const empty = await getHotspotRadar();
    const snapshot: HotspotRadarRefreshResult = { ...empty, generatedAt: new Date().toISOString(), hotspots: analyzed.hotspots, signals: [{ id: first.id, sourceId: first.sourceId, sourceName: first.source, sourceType: "news", board: "game", title: first.title, url: first.url, game: "游戏", category: "赛事", capturedAt: first.collectedAt, publishedAt: first.publishedAt, heat: 0, trend: "", tags: [] }] };
    const retained = retainPriorityTopics(snapshot, analyzed.hotspots);
    const deadline = retained[0].retainedUntil;
    assert.ok(deadline);
    assert.equal(retainPriorityTopics({ ...snapshot, hotspots: retained }, analyzed.hotspots, Date.now() + 3600000)[0].retainedUntil, deadline);
    assert.equal(retainPriorityTopics({ ...snapshot, hotspots: retained }, [], Date.now() + 73 * 3600000).length, 0);
    await mkdir(path.join(root, "hotspots"), { recursive: true });
    await writeFile(path.join(root, "hotspots/radar-snapshot.json"), JSON.stringify(snapshot));
    assert.equal((await getHotspotRadar()).signals.length, 0);
    assert.equal((await getHotspotDetail(analyzed.hotspots[0].id)).signals.length, 1);
    await Promise.all([saveHotspotFeedback(analyzed.hotspots[0].id, "吊爆了"), saveHotspotFeedback(analyzed.hotspots[0].id, "不行")]);
    assert.equal((await getHotspotRadar()).hotspots[0].userRating, "不行");
    const saved = JSON.parse(await readFile(path.join(root, "hotspots/radar-feedback.json"), "utf8"));
    assert.equal(saved.history.length, 2);
    assert.equal(saved.ratings.length, 1);
    await writeRadarCollection({ schemaVersion: 1, generatedAt: snapshot.generatedAt, signals: snapshot.signals.map(item => ({ ...item, summary: "完整摘要" })), scouts: [], status: "analyzing", partialHotspots: analyzed.hotspots, analyzedCount: 1, candidateCount: 7 });
    await updateRadarCollection(current => ({ ...current, status: "failed", error: "模型节点中断" }));
    assert.equal((await readRadarCollection())?.signals.length, 1);
    assert.equal((await getHotspotRadar()).collection?.status, "failed");
    assert.equal((await getHotspotRadar()).provisionalHotspots?.[0].userRating, "不行");
    assert.equal((await getHotspotDetail(first.id.replace(/^/, "hotspot:"))).hotspot.userRating, "不行");
    assert.equal("summary" in (await getRadarSignals()).items[0], false);
    assert.equal((await getRadarSignals({ id: first.id })).items[0].summary, "完整摘要");
    assert.equal((await getRadarSignals({ search: "不存在的内容" })).total, 0);
    await updateRadarCollection(current => ({ ...current, candidateCount: 1 }));
    const reportRequests = requests;
    const recovered = await getHotspotRadar({ refresh: true, retryReport: true });
    assert.equal(requests - reportRequests, 1, "仅重试日报不能重复采集和两轮筛选");
    assert.equal(recovered.dailyReport?.headline, "赛事新进展");
    assert.equal(recovered.hotspots.length, 1);
    assert.equal((await readRadarCollection())?.status, "completed");
    await assert.rejects(getHotspotRadar({ refresh: true, retryReport: true }), /没有已完成精筛/);
    assert.equal((await readRadarCollection())?.status, "completed", "无效恢复不得改变完成状态");
    await writeFile(path.join(root, "hotspots/radar-snapshot.json"), JSON.stringify(snapshot));
    mode = "fine-partial";
    const completed: HotspotEvent[][] = [];
    await assert.rejects(analyzeRadar(Array.from({ length: 7 }, (_, i) => ({ ...first, id: `s${i}` })), feedback, { onPartial: async items => { completed.push(items); } }), /精筛.*批失败/);
    assert.equal(completed.length, 1);
    assert.equal(completed[0].length, 6);
    mode = "empty";
    assert.equal((await analyzeRadar([first], feedback, {})).hotspots.length, 0);
    mode = "partial";
    const many = Array.from({ length: 41 }, (_, index) => ({ ...first, id: `s${index}`, url: `https://www.vlr.gg/${index}` }));
    await assert.rejects(analyzeRadar(many, feedback, {}), /粗筛.*批失败/);
    assert.deepEqual(JSON.parse(await readFile(path.join(root, "hotspots/radar-snapshot.json"), "utf8")), snapshot);
    const beforeCancel = requests;
    await assert.rejects(analyzeRadar([first], feedback, { signal: AbortSignal.abort(new Error("用户取消")) }), /用户取消/);
    assert.equal(requests, beforeCancel);
    await writeFile(path.join(root, "hotspots/radar-snapshot.json"), '{broken');
    await assert.rejects(getHotspotRadar(), /损坏/);
    await writeFile(path.join(root, "hotspots/radar-snapshot.json"), JSON.stringify({ ...snapshot, hotspots: [{} as HotspotEvent] }));
    await assert.rejects(getHotspotRadar(), /格式损坏/);
  } finally {
    process.env = env;
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});


test("RSS 与 Atom 使用标准解析器保留时间和原文链接", async () => {
  const rss = await parseRadarFeed('<rss version="2.0"><channel><title>测试</title><item><title><![CDATA[赛事 & 回应]]></title><link>https://www.vlr.gg/123</link><pubDate>Mon, 21 Sep 2026 01:00:00 GMT</pubDate><description><![CDATA[<p>内容摘要</p>]]></description></item></channel></rss>', source);
  assert.equal(rss[0].title, "赛事 & 回应");
  assert.equal(rss[0].summary, "内容摘要");
  const atom = await parseRadarFeed('<feed xmlns="http://www.w3.org/2005/Atom"><title>测试</title><entry><id>123</id><title>官方回应</title><link href="https://www.vlr.gg/456"/><updated>2026-09-21T02:00:00Z</updated><summary>争议后续</summary></entry></feed>', source);
  assert.equal(atom[0].url, "https://www.vlr.gg/456");
  assert.equal(Date.parse(atom[0].publishedAt), Date.parse("2026-09-21T02:00:00Z"));
  await assert.rejects(parseRadarFeed("<rss><invalid", source));
});
