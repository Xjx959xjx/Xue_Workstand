import assert from "node:assert/strict";
import test from "node:test";
import { parseBilibiliCommentPage, signBilibiliCommentUrl } from "../src/lib/opencli-bilibili-comments";

test("扩展 B站评论页只在首批读置顶，允许正常结束的空评论区", () => {
  const pinned = { rpid_str: "1", content: { message: "置顶评论" } };
  const reply = { rpid_str: "2", content: { message: "普通评论" } };
  const payload = { code: 0, data: { cursor: { next: 1, is_end: false }, top_replies: [pinned], replies: [reply] } };
  assert.deepEqual(parseBilibiliCommentPage(payload, true).rows, [pinned, reply]);
  assert.deepEqual(parseBilibiliCommentPage(payload, false).rows, [reply]);
  assert.deepEqual(parseBilibiliCommentPage({ code: 0, data: { cursor: { is_end: true }, replies: null } }, false), { rows: [], next: 0, end: true });
  assert.deepEqual(parseBilibiliCommentPage({ code: 0, data: { cursor: { is_end: true }, replies: [], top: { upper: null } } }, true), { rows: [], next: 0, end: true });
  assert.match(signBilibiliCommentUrl("123", "a".repeat(32), "b".repeat(32), 0), /mode=3/);
});

test("B站采集拒绝访问限制、错误结构与无效游标，不伪造成功", () => {
  for (const code of [-101, -352, 403, 412, 429]) {
    assert.throws(() => parseBilibiliCommentPage({ code }, true), new RegExp(String(code)));
  }
  for (const next of [undefined, -1, 0.5, "1"]) {
    assert.throws(() => parseBilibiliCommentPage({ code: 0, data: { cursor: { next, is_end: false }, replies: [] } }, true), /分页/);
  }
  assert.throws(() => parseBilibiliCommentPage("登录页面", true), /字段异常/);
  assert.throws(() => parseBilibiliCommentPage({ code: 0, data: { cursor: { next: 1, is_end: false }, replies: [] } }, false), /空页但仍有后续/);
  assert.throws(() => signBilibiliCommentUrl("bad-id", "a".repeat(32), "b".repeat(32), 0), /签名参数/);
});
