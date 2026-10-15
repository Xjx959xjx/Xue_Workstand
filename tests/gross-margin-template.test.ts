import assert from "node:assert/strict";
import test from "node:test";
import { renderGrossMarginReviewTemplate, validateGrossMarginReviewTemplate } from "../src/lib/gross-margin-template";

test("日期字段按北京时间取当天日期，跨日自动更新且不使用传入旧值", (context) => {
  context.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-13T16:00:00.000Z") });
  assert.equal(validateGrossMarginReviewTemplate("申请日期：{{date}}"), "申请日期：{{date}}");
  assert.equal(renderGrossMarginReviewTemplate("申请日期：{{date}}\n日期：{{ date }}", { date: "旧日期" }),
    "申请日期：2026年10月14日\n日期：2026年10月14日");
  context.mock.timers.setTime(new Date("2026-10-14T16:00:00.000Z").getTime());
  assert.equal(renderGrossMarginReviewTemplate("申请日期：{{date}}", {}), "申请日期：2026年10月15日");
  context.mock.timers.setTime(new Date("2026-01-01T00:00:00.000Z").getTime());
  assert.equal(renderGrossMarginReviewTemplate("{{date}}", {}), "2026年1月1日");
});

test("未使用日期字段的已有模板保持原样", () => {
  assert.equal(renderGrossMarginReviewTemplate("申请日期：\n账号：{{accountName}}", { accountName: "测试账号" }),
    "申请日期：\n账号：测试账号");
});
