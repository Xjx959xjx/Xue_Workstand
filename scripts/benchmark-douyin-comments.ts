// node --import tsx scripts/benchmark-douyin-comments.ts --video <视频ID或URL> --limit 12
// node --import tsx scripts/benchmark-douyin-comments.ts --query 小米17 --videos 2 --limit 12
// node --import tsx scripts/benchmark-douyin-comments.ts --video <视频ID或URL> --all
// node --import tsx scripts/benchmark-douyin-comments.ts --video <视频ID或URL> --all --transport captured-http
import { parseArgs } from "node:util";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { getDouyinComments, getDouyinRelatedTopicComments, type OpenCliTimingEntry } from "../src/lib/opencli";
import { buildOpenCliBrowserArgs, parseJsonish, runOpenCli, withSharedOpenCliBrowserSession } from "../src/lib/opencli-runtime";
import { extractDouyinAwemeId, buildDouyinVideoUrl } from "../src/lib/platform-links";
import { buildCommentBenchmarkPageJs, buildCommentBenchmarkBatchJs, createBufferedCommentPageFetcher, measureAllCommentPages, type CollectedComment, type CommentPage, type CommentPageBatch, type FullCommentProgress } from "./lib/douyin-comment-benchmark";
import { DOUYIN_VERIFICATION_CHECK_JS } from "../src/lib/opencli-douyin-scripts";
import { writeJsonFile } from "../src/lib/storage/fs";
import { createCapturedHttpCommentPageFetcher } from "./lib/douyin-comment-http";

async function main() {
  const { values } = parseArgs({ allowNegative: true, options: {
    video: { type: "string" }, query: { type: "string" },
    all: { type: "boolean", default: false },
    output: { type: "string" },
    batching: { type: "boolean", default: true },
    transport: { type: "string", default: "browser" },
    limit: { type: "string", default: "12" }, videos: { type: "string", default: "2" }
  } });
  if (Boolean(values.video) === Boolean(values.query)) throw new Error("请指定 --video 或 --query 中的一项");
  if (values.all && !values.video) throw new Error("全量计时必须用 --video 指定视频");
  if (values.output && !values.all) throw new Error("--output 仅用于 --all 全量评论导出");
  if (!["browser", "captured-http"].includes(values.transport)) throw new Error("--transport 必须为 browser 或 captured-http");
  if (!values.all && values.transport !== "browser") throw new Error("HTTP 评论试验仅用于 --all 全量导出");
  if (values.all) {
    const awemeId = extractDouyinAwemeId(values.video);
    if (!awemeId) throw new Error("没有识别到抖音视频 ID");
    const startedAt = Date.now();
    const output = values.output ? path.resolve(values.output)
      : path.join(await fs.mkdtemp(path.join(os.tmpdir(), "douyin-comments-")), `${awemeId}.json`);
    if (values.output) {
      try {
        await fs.stat(output);
        throw new Error("导出文件已存在，请换一个 --output 路径，避免覆盖已有评论");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    let latest: FullCommentProgress | undefined;
    const comments = new Map<string, CollectedComment>();
    let cliCalls = 0;
    let cliMs = 0;
    let apiMs = 0;
    let httpStats: { browserCalls: number; httpCalls: number; apiMs: number } | undefined;
    let saveQueue = Promise.resolve();
    const save = (completed: boolean, error?: string) => {
      const snapshot = {
        schemaVersion: 1, awemeId, url: buildDouyinVideoUrl(awemeId), capturedAt: new Date().toISOString(),
        scope: "all-accessible-comments-and-replies", completed, accessiblePagesExhausted: completed,
        collectedCount: comments.size,
        transport: values.transport, batching: values.transport === "browser" && values.batching, cliCalls, cliMs,
        browserPageCalls: httpStats?.browserCalls, httpCalls: httpStats?.httpCalls, apiMs: httpStats?.apiMs ?? apiMs,
        reportedCountDifference: latest?.advertisedTotal === undefined ? undefined : latest.advertisedTotal - comments.size,
        elapsedMs: Date.now() - startedAt,
        ...latest, ...(error ? { error } : {}), comments: [...comments.values()]
      };
      // 楼中楼可以并发读取，同一导出文件的原子写入仍串行。
      saveQueue = saveQueue.then(() => writeJsonFile(output, snapshot));
      return saveQueue;
    };
    const controller = new AbortController();
    const cancel = () => controller.abort();
    process.once("SIGINT", cancel);
    process.once("SIGTERM", cancel);
    try {
      const result = await withSharedOpenCliBrowserSession(async (session) => {
        const state = parseJsonish(await runOpenCli(buildOpenCliBrowserArgs(session, "eval", [
          `(() => ({url: location.href, verify: ${DOUYIN_VERIFICATION_CHECK_JS}}))()`
        ]), { timeout: 10_000, signal: controller.signal })) as { url?: string; verify?: boolean };
        if (state.verify) throw new Error("抖音登录或安全验证未通过，请在 Chrome 完成验证码后再测全量评论");
        if (state.url !== buildDouyinVideoUrl(awemeId)) {
          await runOpenCli(buildOpenCliBrowserArgs(session, "open", [buildDouyinVideoUrl(awemeId)], { window: "background" }), { timeout: 30_000, signal: controller.signal });
        }
        const singlePage = async (cursor: string, parentId?: string) => {
          // 同一列表串行翻页并留出间隔；不同父评论最多并发两个，不自动重试验证码或限流。
          if (latest) await new Promise((resolve) => setTimeout(resolve, 300));
          cliCalls++;
          const page = parseJsonish(await runOpenCli(buildOpenCliBrowserArgs(session, "eval", [
            buildCommentBenchmarkPageJs(awemeId, cursor, parentId)
          ]), { timeout: 20_000, signal: controller.signal, timingStage: "douyin.comments.full-page", onTiming: timing => { cliMs += timing.ms; } }));
          if (!page || typeof page !== "object" || !("comments" in page) || !Array.isArray(page.comments)) throw new Error("抖音评论接口返回无效结果，全量采集尚未完成");
          apiMs += (page as CommentPage).apiMs || 0;
          return page as CommentPage;
        };
        const buffered = createBufferedCommentPageFetcher(async requests => {
          controller.signal.throwIfAborted();
          // 间隔放在 Node 中，避免后台 Chrome 将短定时器延长到约一秒。
          if (cliCalls) await new Promise(resolve => setTimeout(resolve, 100));
          controller.signal.throwIfAborted();
          cliCalls++;
          const rows = parseJsonish(await runOpenCli(buildOpenCliBrowserArgs(session, "eval", [
            buildCommentBenchmarkBatchJs(awemeId, requests)
          ]), { timeout: 25_000, signal: controller.signal, timingStage: "douyin.comments.full-batch", onTiming: timing => { cliMs += timing.ms; } }));
          if (!Array.isArray(rows)) throw new Error("抖音批量评论接口返回无效结果，采集尚未完成");
          for (const row of rows as CommentPageBatch[]) for (const { page } of row.pages || []) apiMs += page.apiMs || 0;
          return rows as CommentPageBatch[];
        });
        const http = values.transport === "captured-http" ? await createCapturedHttpCommentPageFetcher(session, awemeId, controller.signal) : undefined;
        httpStats = http?.stats;
        return measureAllCommentPages(http?.fetchPage || (values.batching ? buffered : singlePage), (progress) => {
          latest = progress;
          console.log(JSON.stringify({ stage: "progress", elapsedMs: Date.now() - startedAt, ...progress }));
        }, controller.signal, { replyConcurrency: 2, onPage: async (page, parentId) => {
          for (const comment of page.comments) comments.set(comment.id, { ...comment, ...(parentId ? { parentId } : {}) });
          await save(false);
        } });
      }, { signal: controller.signal });
      latest = result;
      await save(true);
      console.log(JSON.stringify({ mode: "all-accessible-comments-and-replies", awemeId, completed: true, output,
        transport: values.transport, batching: values.transport === "browser" && values.batching, cliCalls, cliMs,
        browserPageCalls: httpStats?.browserCalls, httpCalls: httpStats?.httpCalls, apiMs: httpStats?.apiMs ?? apiMs,
        totalMs: Date.now() - startedAt, ...result }, null, 2));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await save(false, message);
      console.log(JSON.stringify({ mode: "all-accessible-comments-and-replies", awemeId, completed: false, output, elapsedMs: Date.now() - startedAt, ...latest, error: message }, null, 2));
      process.exitCode = 1;
    } finally {
      process.removeListener("SIGINT", cancel);
      process.removeListener("SIGTERM", cancel);
    }
    return;
  }
  const limit = Number(values.limit);
  const videoLimit = Number(values.videos);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("--limit 必须为 1 至 100 的整数");
  if (!Number.isInteger(videoLimit) || videoLimit < 1 || videoLimit > 8) throw new Error("--videos 必须为 1 至 8 的整数");
  const timings: OpenCliTimingEntry[] = [];
  const options = { signal: AbortSignal.timeout(120_000), onTiming: (entry: OpenCliTimingEntry) => { timings.push(entry); } };
  const startedAt = Date.now();
  try {
    const result = values.video
      ? { commentSamples: await getDouyinComments({ id: values.video, url: values.video }, limit, options), videos: [{ id: values.video }] }
      : await getDouyinRelatedTopicComments(values.query!, { ...options, videoLimit, commentLimit: limit });
    console.log(JSON.stringify({
      mode: values.video ? "direct" : "search", totalMs: Date.now() - startedAt,
      videoCount: result.videos.length, commentCount: result.commentSamples.length,
      errors: "errors" in result ? result.errors : [], timings
    }, null, 2));
  } catch (error) {
    console.log(JSON.stringify({ totalMs: Date.now() - startedAt, error: error instanceof Error ? error.message : String(error), timings }, null, 2));
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
