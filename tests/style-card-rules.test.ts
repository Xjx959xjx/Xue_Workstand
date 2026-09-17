import assert from "node:assert/strict";
import test from "node:test";
import { validateStyleCardCitations, styleEvidencePassages, type StyleCardEvidence, type StyleEvidence } from "../src/lib/writer-context";

const first = "先交代事情的经过，再解释为什么。";
const second = "把来龙去脉讲完，再说这件事的原因。";
const evidence: StyleCardEvidence[] = [
  { sourceId: "a", quote: first, workHash: "work-a" },
  { sourceId: "b", quote: second, workHash: "work-b" }
];
const rule = (id: string, citations: string) => `### ${id}｜先交代再解释
支持范围：本轮事件叙事样本。
触发条件：资料有经过与原因。
表达动作：交代经过，再补原因。
停止与例外：解释清楚后停止，无原因时不编造。
原文证据：${citations}`;
const cite = (id = "a", quote = first) => `[[${id}]]「${quote}」`;
const card = (stable: string, conditional = "本轮不足以确认") => `# 测试风格卡
## 风格概览
用事件推进叙述。
## 跨样本表达倾向
${stable}
## 场景写法与单篇观察
${conditional}
## 使用边界与证据范围
仅描述本轮样本，尚不能推断所有作品。`;
const validate = (value: string, sources = evidence) => validateStyleCardCitations(value, sources, { requireRules: true });

test("跨样本规则逐条验证不同作品，引用不能放在其他规则里代替", () => {
  const stable = rule("S01", `${cite()}\n${cite("b", second)}`);
  validate(card(stable));
  assert.throws(() => validate(card(rule("S01", `${cite()}\n${cite()}`))), /两个不同作品/);
  assert.throws(() => validate(card(`${stable}\n${rule("S02", cite())}`)), /S02.*两个不同作品/);
  assert.throws(() => validate(card(stable, rule("C01", ""))), /C01.*缺少原文引用/);
  const duplicate = evidence.map(item => ({ ...item, workHash: "same-transcript" }));
  assert.throws(() => validate(card(stable), duplicate), /同文转载/);
});

test("场景规则要有条件和停止边界，单篇观察可保留但不能伪装成稳定规则", () => {
  const conditional = card("本轮不足以确认", rule("C01", cite()));
  validate(conditional);
  validate(conditional.replace("触发条件：资料有经过与原因。", "- **触发条件：** 资料有经过与原因。"));
  assert.throws(() => validate(conditional.replace("触发条件：资料有经过与原因。", "")), /触发条件/);
  assert.throws(() => validate(conditional.replace("停止与例外：解释清楚后停止，无原因时不编造。", "")), /停止与例外/);
  const observed = card("本轮不足以确认", `### O01｜事件后补原因
支持范围：单篇。
观察：先交代经过，再补原因。
尚不能确定：其他场景是否复现。
原文证据：${cite()}`);
  validate(observed);
  assert.throws(() => validate(observed.replace("### O01", "### S01")), /所在章节/);
  assert.throws(() => validate(conditional.replace("### C01", "### 无编号")), /S\/C\/O/);
  assert.throws(() => validate(conditional.replace("### C01", "每篇必须反转。\n### C01")), /未编号规则/);
  assert.throws(() => validate(card("本轮不足以确认", `${rule("C01", cite())}\n${rule("C01", cite())}`)), /重复/);
});

test("引用保留内层引号与换行，源文标题不会被解析成新规则", () => {
  const quoted = "他说「先看经过」。\n### 这是原文里的标题\n然后解释原因。";
  const sources = [{ sourceId: "a", quote: quoted, workHash: "a" }];
  validate(card("本轮不足以确认", rule("C01", cite("a", quoted))), sources);
  for (const bad of [cite("a", "模型改写了经过。"), "[[a]]（未按格式引用）", cite("b", first)]) {
    assert.throws(() => validate(card("本轮不足以确认", rule("C01", bad)), sources), /引用/);
  }
});

test("旧卡可继续读写，新生成卡不得用零散引句或代码围栏绕过规则校验", () => {
  validateStyleCardCitations(cite(), evidence);
  assert.throws(() => validate(cite()), /章节/);
  assert.throws(() => validateStyleCardCitations("任意新卡", undefined, { requireRules: true }), /缺少本轮核验原文/);
  assert.throws(() => validate("```markdown\n" + card("本轮不足以确认", rule("C01", cite())) + "\n```"), /代码围栏/);
});

test("来源目录可用裸 ID，但目录不能替代逐条规则的引句", () => {
  const value = card("本轮不足以确认", rule("C01", cite()));
  validate(`${value}\n本轮来源：[[a]]、[[b]]。`);
  assert.throws(() => validate(`${value}\n本轮来源：[[unknown]]。`), /引用/);
  assert.throws(() => validate(card("本轮不足以确认", `${rule("C01", cite())}\n${rule("C02", "[[a]]")}`)), /C02.*缺少原文引用/);
});

test("相邻证据保留原文换行可一起引用，跨段遗漏和重排仍被拒绝", () => {
  const analysis: StyleEvidence = {
    genre: "叙事", purposes: ["讲述"], unsuitable: [], structure: "交代再解释", limitations: [],
    moves: [first, second].map(quote => ({ quote, action: "解释经过", when: "有经过", avoid: "没有时不编造" }))
  };
  const source = `${first}\n\n${second}`;
  const passages = styleEvidencePassages(analysis, source);
  assert.ok(passages.includes(source));
  const sources = passages.map(quote => ({ sourceId: "a", quote }));
  validateStyleCardCitations(cite("a", source), sources);
  assert.throws(() => validateStyleCardCitations(cite("a", `${first}${second}`), sources), /引用/);
  assert.throws(() => validateStyleCardCitations(cite("a", `${second}\n\n${first}`), sources), /引用/);
  const separated = styleEvidencePassages(analysis, `${first}\n中间不能省略的说明。\n${second}`);
  assert.deepEqual(separated, [first, second]);
  assert.throws(() => validateStyleCardCitations(cite("a", source), separated.map(quote => ({ sourceId: "a", quote }))), /引用/);
  assert.throws(() => styleEvidencePassages(analysis, "不含证据的原文"), /原文定位/);
  const overlap = { ...analysis, moves: [{ ...analysis.moves[0], quote: `${first}\n\n${second.slice(0, 5)}` }, analysis.moves[1]] };
  assert.ok(styleEvidencePassages(overlap, source).includes(source));
});
