import assert from "node:assert/strict";
import test from "node:test";
import {
  buildHotlistHref,
  getRefreshJobSettlement,
  getSurgeClass,
  getVisibleHotlistItems,
  parseStoredRefreshLogs
} from "../src/app/douyin-hotlist/_lib/douyin-hotlist-model";
import type { DouyinHotlistItem, DouyinHotlistRefreshJobResult, JobRecord, Platform } from "../src/lib/types";

test("热榜 URL 只更新自身筛选参数并保留其他查询参数", () => {
  assert.equal(
    buildHotlistHref({
      account: "account-1",
      pathname: "/douyin-hotlist",
      search: "?from=nav&sort=comments",
      sort: "recent",
      window: "24h"
    }),
    "/douyin-hotlist?from=nav&sort=recent&account=account-1&window=24h"
  );

  assert.equal(
    buildHotlistHref({
      account: "all",
      pathname: "/douyin-hotlist",
      search: "?account=old&sort=likes&window=3h",
      sort: "heat",
      window: "3d"
    }),
    "/douyin-hotlist"
  );
});

test("可见热榜按平台过滤后重新排序并生成连续展示名次", () => {
  const items = [
    makeItem({ accountId: "douyin-1", platform: "douyin", likes: 10, heatScore: 500 }),
    makeItem({ accountId: "bilibili-1", platform: "bilibili", likes: 100, heatScore: 300 }),
    makeItem({ accountId: "douyin-2", platform: "douyin", likes: 20, heatScore: 400 })
  ];

  const visible = getVisibleHotlistItems({
    items,
    selectedAccountId: "platform:douyin",
    selectedPlatform: "douyin",
    sortMode: "likes"
  });

  assert.deepEqual(visible.map(({ item, displayRank }) => [item.account.id, displayRank]), [
    ["douyin-2", 1],
    ["douyin-1", 2]
  ]);
  assert.deepEqual(items.map((item) => item.account.id), ["douyin-1", "bilibili-1", "douyin-2"]);
});

test("本地刷新日志会丢弃损坏记录并限制保留数量", () => {
  const validLogs = Array.from({ length: 8 }, (_, index) => ({
    id: `log-${index}`,
    at: "2026-08-17T10:00:00.000Z",
    automatic: index % 2 === 0,
    status: "success",
    text: `日志 ${index}`
  }));
  const parsed = parseStoredRefreshLogs(JSON.stringify([...validLogs, { id: "broken" }]));

  assert.equal(parsed.length, 6);
  assert.equal(parsed[0]?.id, "log-0");
  assert.deepEqual(parseStoredRefreshLogs("not-json"), []);
});

test("刷新任务结算把部分失败转成可展示日志与手动提示", () => {
  const result: DouyinHotlistRefreshJobResult = {
    automatic: false,
    refresh: {
      requested: 2,
      completed: 1,
      unchanged: 0,
      failed: 1,
      limit: 10,
      accounts: [
        {
          accountId: "ok",
          name: "账号 A",
          status: "completed",
          changedCount: 3,
          observedCount: 5
        },
        {
          accountId: "failed",
          name: "账号 B",
          status: "failed",
          error: "抓取失败"
        }
      ]
    },
    summary: {
      windowKey: "3d",
      windowLabel: "近 3 天",
      windowDays: 3,
      fromDate: "2026-08-14",
      toDate: "2026-08-17",
      accountCount: 2,
      staleAccountIds: [],
      totalVideoCount: 8,
      recentVideoCount: 8
    }
  };
  const settlement = getRefreshJobSettlement(makeJob({ status: "completed", result }));

  assert.equal(settlement.reload, true);
  assert.equal(settlement.log.status, "warning");
  assert.match(settlement.log.text, /已处理 2\/2 个账号/);
  assert.deepEqual(settlement.log.details, ["账号 B：失败，抓取失败"]);
  assert.match(settlement.message || "", /1 个有更新/);
});

test("自动刷新中断不会生成页面提示，但会留下跳过日志", () => {
  const settlement = getRefreshJobSettlement(makeJob({ status: "interrupted", title: "自动刷新视频热榜" }));

  assert.equal(settlement.automatic, true);
  assert.equal(settlement.reload, false);
  assert.equal(settlement.message, undefined);
  assert.equal(settlement.log.status, "skipped");
  assert.match(settlement.log.text, /服务重启中断/);
});

test("飙升标记区分猛涨、上升和普通内容", () => {
  assert.equal(getSurgeClass(undefined), "");
  assert.equal(getSurgeClass(makeSurge("猛涨")), "is-surging surge-rapid");
  assert.equal(getSurgeClass(makeSurge("上升")), "is-surging surge-rising");
});

function makeItem({
  accountId,
  heatScore,
  likes,
  platform
}: {
  accountId: string;
  heatScore: number;
  likes: number;
  platform: Platform;
}): DouyinHotlistItem {
  return {
    rank: 1,
    account: { id: accountId, platform, name: accountId, uid: accountId },
    video: {
      id: `${accountId}-video`,
      platform,
      title: accountId,
      url: `https://example.com/${accountId}`,
      stats: { views: 0, likes, comments: 0, favorites: 0, shares: 0 },
      hotScore: heatScore
    },
    heatScore,
    tags: [],
    signal: ""
  };
}

function makeJob(input: { status: JobRecord["status"]; title?: string; result?: DouyinHotlistRefreshJobResult }): JobRecord {
  return {
    id: "job-1",
    kind: "hotlist-refresh",
    title: input.title || "手动刷新视频热榜",
    status: input.status,
    progress: 100,
    message: "",
    createdAt: "2026-08-17T10:00:00.000Z",
    updatedAt: "2026-08-17T10:00:00.000Z",
    result: input.result
  } as JobRecord;
}

function makeSurge(label: string): NonNullable<DouyinHotlistItem["surge"]> {
  return {
    label,
    reason: "互动速度提升",
    heatDelta: 100,
    heatPerHour: 50,
    intervalHours: 2
  };
}
