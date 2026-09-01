import assert from "node:assert/strict";
import test from "node:test";
import {
  buildEngagementResearchLaneSequence,
  buildLocalEngagementResearchQueries
} from "../src/lib/engagement-research";

test("全网评论调研会从主体与版本锚点生成有界检索词", () => {
  const queries = buildLocalEngagementResearchQueries({
    summary: "流放之路2将在1.0加入决斗者与剑类武器",
    topic: "流放之路2 1.0",
    subjects: ["流放之路2", "决斗者"],
    keyFacts: ["12月18日上线1.0", "加入剑类武器"],
    discussionAngles: ["近战强度", "终局玩法"],
    skepticalAngles: ["平衡调整"],
    anchorTerms: ["1.0", "剑类武器", "旋风斩"]
  });

  assert.ok(queries.length >= 1 && queries.length <= 3);
  assert.match(queries[0], /流放之路2/);
  assert.equal(queries.some((query) => /评论|论坛|评测/.test(query)), false);
});

test("全网评论调研槽位保持25/20/20/15/8/7/5的评论区结构", () => {
  const lanes = buildEngagementResearchLaneSequence(100);
  const counts = Object.fromEntries(
    [...new Set(lanes)].map((lane) => [lane, lanes.filter((value) => value === lane).length])
  );

  assert.deepEqual(counts, {
    direct: 25,
    recent: 20,
    legacy: 20,
    newcomer: 15,
    life: 8,
    platform: 7,
    reply: 5
  });
});
