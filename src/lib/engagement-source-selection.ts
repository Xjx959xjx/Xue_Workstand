export const SOURCE_VIDEO_COMMENT_THRESHOLD = 200;

/** 只接受明确的评论计数；缺失值不能当成零或用点赞、弹幕数替代。 */
export function sourceCommentCount(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value !== "number" && !(typeof value === "string" && /^\d+$/.test(value.trim()))) continue;
    const count = Number(value);
    if (Number.isSafeInteger(count) && count >= 0) return count;
  }
  return undefined;
}

export async function selectEligibleCommentSources<T extends { id: string; commentCount?: number }>(
  candidates: T[], limit: number, resolveCount: (video: T) => Promise<number | undefined>, signal?: AbortSignal
) {
  const videos: T[] = [];
  const errors: string[] = [];
  for (const video of candidates) {
    signal?.throwIfAborted();
    if (videos.length >= limit) break;
    try {
      const count = sourceCommentCount(video.commentCount ?? await resolveCount(video));
      signal?.throwIfAborted();
      if (count === undefined || count <= SOURCE_VIDEO_COMMENT_THRESHOLD) {
        errors.push(`${video.id}：${count === undefined ? "无法确认评论总数" : `评论总数 ${count} 条`}，要求超过 ${SOURCE_VIDEO_COMMENT_THRESHOLD} 条，已跳过`);
        continue;
      }
      videos.push({ ...video, commentCount: count });
    } catch (error) {
      if (signal?.aborted || (error instanceof Error && error.name === "AbortError")) throw error;
      const reason = error instanceof Error ? error.message : String(error);
      errors.push(`${video.id}：评论总数核验失败，已跳过：${reason}`);
      if (/401|403|412|429|444|登录|验证码|风控/.test(reason)) break;
    }
  }
  return { videos, errors };
}

export type CommentPageTrace = {
  cursor: number;
  nextCursor: number;
  returnedCount: number;
  addedCount: number;
  hasMore: boolean;
};

export type CommentCollectionAttempt = {
  videoId: string;
  requestedCount: number;
  collectedCount: number;
  acceptedCount?: number;
  pages: CommentPageTrace[];
  stopReason: "target_reached" | "exhausted" | "failed" | "cancelled";
  elapsedMs: number;
  error?: string;
};

export function commentCorpusKey(text: string) {
  return text.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
}

/** 两个平台共享实际去重数量，先各尝试两个来源，再按缺口补已有候选。 */
export function createCommentCollectionBudget(target = 600) {
  const seen = new Set<string>();
  return {
    target,
    get count() { return seen.size; },
    needsMore: () => seen.size < target,
    add(texts: string[]) {
      for (const text of texts) {
        const key = commentCorpusKey(text);
        if (key) seen.add(key);
      }
    }
  };
}

export type CommentCollectionBudget = ReturnType<typeof createCommentCollectionBudget>;

/** 初选不足时只使用已有搜索候选补充，不重新规划或无限采集。 */
export async function collectCommentSources<T, R>(input: {
  candidates: T[];
  sourceTarget: number;
  read: (video: T) => Promise<R>;
  count: (result: R) => number;
  shouldStop?: () => boolean;
  budget?: CommentCollectionBudget;
  signal?: AbortSignal;
}) {
  const videos: T[] = [];
  const results: R[] = [];
  let sources = 0;
  let attempts = 0;
  for (const video of input.candidates) {
    input.signal?.throwIfAborted();
    const complete = input.budget
      ? attempts >= input.sourceTarget && !input.budget.needsMore()
      : sources >= input.sourceTarget;
    if (input.shouldStop?.() || complete) break;
    attempts += 1;
    const result = await input.read(video);
    const count = input.count(result);
    if (count <= 0) continue;
    videos.push(video);
    results.push(result);
    sources += 1;
  }
  return { videos, results };
}
