import { z } from "zod";
import { shortHash } from "./utils";

export { STYLE_ANALYSIS_VERSION, WRITER_PROMPT_VERSION, styleAnalysisInstruction } from "./writer-prompts";
export const WRITER_REFERENCE_BUDGET = 14_000;
const text = z.string().trim().min(1);
const evidence = z.object({ quote: text.max(500), action: text.max(400), when: text.max(300), avoid: z.string().max(300) });
const narrativeSchema = z.object({
  forms: z.array(text.max(100)).min(1).max(5),
  beats: z.array(z.object({ purpose: text.max(200), quote: text.max(500) })).min(1).max(6),
  bridges: z.array(z.object({
    before: text.max(500), after: text.max(500), action: text.max(400), requires: text.max(400)
  })).max(3)
});

export const styleEvidenceSchema = z.object({
  genre: text.max(160),
  purposes: z.array(text.max(100)).min(1).max(6),
  unsuitable: z.array(text.max(150)).max(6),
  structure: text.max(700),
  // Older stored analyses remain readable; newly generated analyses must include this field.
  narrative: narrativeSchema.optional(),
  moves: z.array(evidence).min(1).max(8),
  limitations: z.array(text.max(200)).max(6)
});
export type StyleEvidence = z.infer<typeof styleEvidenceSchema>;

const sourcedText = z.object({ text: text.max(1000), quote: text.max(2000) });
export const writerTaskSchema = z.object({
  purpose: text.max(300),
  facts: z.array(sourcedText).max(20),
  mustKeep: z.array(sourcedText).max(20),
  creativeFreedom: text.max(1000),
  timeContext: z.string().max(500),
  uncertainties: z.array(text.max(500)).max(12),
  forbiddenTerms: z.array(sourcedText).max(20),
  length: z.object({ min: z.number().int().min(0), max: z.number().int().positive(), quote: text }).refine(v => v.min <= v.max, "字数上下限无效").nullable()
});
export type WriterTask = z.infer<typeof writerTaskSchema>;

export const writerPlanSchema = z.object({
  task: writerTaskSchema,
  selected: z.array(z.object({ id: text, reason: text.max(500) })),
  applicableStyle: z.array(text.max(700)).max(10),
  notes: z.array(text.max(500)).max(12)
});
export type WriterPlan = z.infer<typeof writerPlanSchema>;

export const writerContextSchema = z.object({
  schemaVersion: z.literal(1),
  promptVersion: text,
  referenceKey: text,
  styleText: z.string(),
  styleHash: text,
  samples: z.array(z.object({ id: text, title: z.string(), text: text, hash: text, reason: z.string() })),
  plan: writerPlanSchema.nullable(),
  notes: z.array(z.string()),
  preparedAt: text,
  preparationModel: z.string().optional(),
  compatibility: z.literal("legacy-current-style").optional()
});
export type WriterContextSnapshot = z.infer<typeof writerContextSchema>;

export type WriterCandidate = { id: string; title: string; transcript: string; analysis: StyleEvidence };

export function parseModelJson(value: string, label: string): unknown {
  try {
    return JSON.parse(value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
  } catch {
    throw new Error(`${label}返回的结构无效，请重试；已有结果未被替换。`);
  }
}

export function parseStyleEvidence(value: string, transcript: string, title: string): StyleEvidence {
  const parsed = styleEvidenceSchema.safeParse(parseModelJson(value, `样本「${title}」分析`));
  if (!parsed.success) throw new Error(`样本「${title}」分析缺少用途或表达证据，请重试。`);
  const narrative = parsed.data.narrative;
  if (!narrative) throw new Error(`样本「${title}」分析缺少讲述方式与段落衔接，请重新分析。`);
  if (styleEvidenceQuotes(parsed.data).some(quote => !transcript.includes(quote))) {
    throw new Error(`样本「${title}」的风格引句无法在原文定位，请重新分析该样本。`);
  }
  let end = 0;
  for (const beat of narrative.beats) {
    const start = transcript.indexOf(beat.quote, end);
    if (start < 0) throw new Error(`样本「${title}」的段落顺序与原文不一致，请重新分析。`);
    end = start + beat.quote.length;
  }
  for (const bridge of narrative.bridges) {
    if (transcript.indexOf(bridge.after, transcript.indexOf(bridge.before) + bridge.before.length) < 0) {
      throw new Error(`样本「${title}」的衔接前后顺序与原文不一致，请重新分析。`);
    }
  }
  return parsed.data;
}

export function styleEvidenceQuotes(analysis: StyleEvidence) {
  return [...new Set([
    ...analysis.moves.map(move => move.quote),
    ...(analysis.narrative?.beats.map(beat => beat.quote) || []),
    ...(analysis.narrative?.bridges.flatMap(bridge => [bridge.before, bridge.after]) || [])
  ])];
}

export function styleEvidencePassages(analysis: StyleEvidence, transcript: string) {
  const quotes = styleEvidenceQuotes(analysis);
  const ranges = quotes.map(quote => {
    const start = transcript.indexOf(quote);
    if (start < 0) throw new Error("风格证据无法在原文定位，原卡已保留，请重新分析。");
    return { start, end: start + quote.length };
  }).sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: typeof ranges = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    // Join only overlap or whitespace between verified quotes, keeping the exact original text.
    // Bound additional passages so a dense set of annotations does not re-insert a whole long transcript.
    if (previous && range.end - previous.start <= 1500 && (range.start <= previous.end || !transcript.slice(previous.end, range.start).trim())) {
      previous.end = Math.max(previous.end, range.end);
    } else merged.push({ ...range });
  }
  return [...new Set([...quotes, ...merged.map(range => transcript.slice(range.start, range.end))])];
}

export function referenceSelectionInstruction() {
  return "目的和讲法分别匹配：推广可以用吃瓜、趣事或悬念切入，不能仅因genre或开头是争议就排除整篇。结合purposes、narrative.beats及bridges判断具体可借鉴段落、怎样转入游戏或活动。借用衔接前核对requires与本次真实资料；无依据不能编造爆料、玩家反应或亲历。纯争议稿也可借鉴适用的局部表达，但不能把提到同一游戏视为推广依据。";
}

export type StyleCardEvidence = { sourceId: string; quote: string; workHash?: string };
type StyleCardCitation = { sourceId: string; start: number; end: number };

export function validateStyleCardCitations(
  style: string,
  evidenceQuotes?: StyleCardEvidence[],
  options: { requireRules?: boolean } = {}
) {
  if (!evidenceQuotes) {
    if (options.requireRules) throw new Error("风格卡缺少本轮核验原文，原卡已保留，请重新归纳。");
    return;
  }
  const invalidCitation = () => new Error("风格卡缺少有效原文引用或改写了证据，原卡已保留，请重新归纳。");
  const citations: StyleCardCitation[] = [];
  const marker = /\[\[([^\]\n]+)\]\]/g;
  let match: RegExpExecArray | null;
  while ((match = marker.exec(style))) {
    const sourceId = match[1];
    const quotes = evidenceQuotes.filter(item => item.sourceId === sourceId).map(item => item.quote);
    if (!quotes.length) throw invalidCitation();
    // A known bare source ID is a bibliography pointer, not supporting evidence for a rule.
    if (style[marker.lastIndex] !== "「") continue;
    const start = marker.lastIndex + 1;
    const maxLength = Math.max(0, ...quotes.map(quote => quote.length));
    let end = style.indexOf("」", start);
    let verifiedEnd = -1;
    // Quotes may themselves contain 「」. Choose the longest verified continuous excerpt.
    while (end >= 0 && end - start <= maxLength) {
      const excerpt = style.slice(start, end);
      if (excerpt.trim() && quotes.some(quote => quote.includes(excerpt))) verifiedEnd = end;
      end = style.indexOf("」", end + 1);
    }
    if (verifiedEnd < 0) throw invalidCitation();
    citations.push({ sourceId: match[1], start: match.index, end: verifiedEnd + 1 });
    marker.lastIndex = verifiedEnd + 1;
  }
  if (!citations.length) throw invalidCitation();
  if (options.requireRules) validateStyleCardRules(style, citations, evidenceQuotes);
}

function validateStyleCardRules(style: string, citations: StyleCardCitation[], evidence: StyleCardEvidence[]) {
  // Mask source text before reading Markdown so a heading inside an original quote is not a rule.
  let markdown = "";
  let cursor = 0;
  for (const citation of citations) {
    markdown += style.slice(cursor, citation.start) + style.slice(citation.start, citation.end).replace(/[^\n\r]/g, " ");
    cursor = citation.end;
  }
  markdown += style.slice(cursor);
  const fail = (reason: string): never => { throw new Error(`风格卡${reason}，原卡已保留，请重新归纳。`); };
  if (/^\s*```/m.test(markdown)) fail("应直接输出 Markdown，不能用代码围栏包裹规则");
  const headings = [...markdown.matchAll(/^(#{1,6})[ \t]+(.+?)[ \t]*\r?$/gm)];
  const sectionNames = ["风格概览", "跨样本表达倾向", "场景写法与单篇观察", "连续表达示例", "使用边界与证据范围"];
  const sections = headings.filter(heading => heading[1] === "##");
  for (const name of sectionNames.filter(name => name !== "连续表达示例")) {
    if (sections.filter(section => section[2] === name).length !== 1) fail(`缺少或重复“${name}”章节`);
  }
  if (sections.some(section => !sectionNames.includes(section[2]))) fail("包含未约定章节，请将规则放入对应的分层章节");
  const ids = new Set<string>();
  for (const [index, section] of sections.entries()) {
    if (section[2] !== "跨样本表达倾向" && section[2] !== "场景写法与单篇观察") continue;
    const start = section.index! + section[0].length;
    const end = sections[index + 1]?.index ?? markdown.length;
    const rules = headings.filter(heading => heading.index! >= start && heading.index! < end);
    if (!rules.length) {
      if (!/^本轮不足以确认[。.]?$/.test(markdown.slice(start, end).trim())) fail(`“${section[2]}”缺少编号规则或证据不足说明`);
      continue;
    }
    if (markdown.slice(start, rules[0].index).trim()) fail("包含未编号规则，请按 S/C/O 分层");
    for (const [ruleIndex, heading] of rules.entries()) {
      const rule = /^([SCO]\d{2,})[｜|：:、.\s-]+\S/.exec(heading[2]);
      if (heading[1] !== "###" || !rule) fail("规则标题须使用三级标题及 S/C/O 编号");
      const id = rule![1];
      if (ids.has(id)) fail(`规则编号 ${id} 重复`);
      ids.add(id);
      if ((id.startsWith("S")) !== (section[2] === "跨样本表达倾向")) fail(`规则 ${id} 所在章节与层级不一致`);
      const ruleEnd = rules[ruleIndex + 1]?.index ?? end;
      const body = markdown.slice(heading.index! + heading[0].length, ruleEnd);
      const lines = body.split(/\r?\n/).map(line => line.replace(/^\s*[-*]\s+/, "").replace(/\*\*/g, "").trim());
      const fields = id.startsWith("O") ? ["支持范围", "观察", "尚不能确定"] : ["支持范围", "触发条件", "表达动作", "停止与例外"];
      for (const field of fields) {
        if (!lines.some(line => new RegExp(`^${field}[:：]\\s*\\S`).test(line))) fail(`规则 ${id} 缺少“${field}”`);
      }
      const references = citations.filter(citation => citation.start >= heading.index! && citation.end <= ruleEnd);
      if (!references.length) fail(`规则 ${id} 缺少原文引用`);
      const works = new Set(references.map(citation => evidence.find(item => item.sourceId === citation.sourceId)?.workHash || citation.sourceId));
      if (id.startsWith("S") && works.size < 2) fail(`规则 ${id} 至少需要两个不同作品的原文引用，同文转载不能重复计数`);
    }
  }
  if (!ids.size) fail("没有可核验的分层规则");
}

export function candidateIndex(candidate: WriterCandidate) {
  return { id: candidate.id, title: candidate.title, chars: candidate.transcript.length, ...candidate.analysis };
}

// Every candidate reaches selection; large libraries are screened in bounded batches.
export function batchCandidates(candidates: WriterCandidate[], budget = 20_000) {
  const batches: WriterCandidate[][] = [];
  let batch: WriterCandidate[] = [];
  let chars = 0;
  for (const candidate of candidates) {
    const size = JSON.stringify(candidateIndex(candidate)).length;
    if (batch.length && chars + size > budget) { batches.push(batch); batch = []; chars = 0; }
    batch.push(candidate); chars += size;
  }
  if (batch.length) batches.push(batch);
  return batches;
}

export function validateWriterPlan(value: unknown, candidates: WriterCandidate[], factsContext: string): WriterPlan {
  const parsed = writerPlanSchema.safeParse(value);
  if (!parsed.success) throw new Error("写作任务解析结构不完整，请重试；已有稿件未被替换。");
  const plan = parsed.data;
  const byId = new Map(candidates.map(c => [c.id, c]));
  if (new Set(plan.selected.map(s => s.id)).size !== plan.selected.length || plan.selected.some(s => !byId.has(s.id))) {
    throw new Error("参考选择包含重复或不属于本风格的样本，请重新生成。");
  }
  const quotes = [...plan.task.facts, ...plan.task.mustKeep, ...plan.task.forbiddenTerms].map(v => v.quote);
  if (plan.task.length) quotes.push(plan.task.length.quote);
  if (quotes.some(quote => !factsContext.includes(quote))) throw new Error("任务要求或事实引句无法在本次资料中定位，请重试。");
  if (!plan.selected.length && !plan.notes.length) throw new Error("没有选出适用参考，模型也未说明原因，请重试。");
  return plan;
}

export function referenceText(candidate: WriterCandidate, budget: number) {
  if (candidate.transcript.length <= budget) return candidate.transcript;
  // Keep a bridge's intervening text together; do not splice its endpoints into a false transition.
  const spans = (candidate.analysis.narrative?.bridges || []).map(bridge => {
    const start = candidate.transcript.indexOf(bridge.before);
    const after = candidate.transcript.indexOf(bridge.after, start + bridge.before.length);
    return { start, end: after < 0 ? -1 : after + bridge.after.length };
  });
  for (const quote of styleEvidenceQuotes(candidate.analysis)) {
    const start = candidate.transcript.indexOf(quote);
    spans.push({ start, end: start + quote.length });
  }
  const prefix = "【原文过长，以下为已核验的连续证据段落，非全文】\n";
  const separator = "\n\n【另一个原文片段】\n";
  const chosen: Array<{ start: number; end: number }> = [];
  let remaining = budget - prefix.length;
  for (const span of spans) {
    if (span.start < 0 || span.end <= span.start || chosen.some(s => span.start < s.end && span.end > s.start)) continue;
    const cost = span.end - span.start + (chosen.length ? separator.length : 0);
    if (cost > remaining) continue;
    chosen.push(span); remaining -= cost;
  }
  chosen.sort((a, b) => a.start - b.start);
  return chosen.length ? prefix + chosen.map(s => candidate.transcript.slice(s.start, s.end)).join(separator) : "";
}

export function snapshotReferences(candidates: WriterCandidate[], plan: WriterPlan) {
  const samples: WriterContextSnapshot["samples"] = [];
  let remaining = WRITER_REFERENCE_BUDGET;
  for (const selection of plan.selected) {
    const candidate = candidates.find(c => c.id === selection.id)!;
    const content = referenceText(candidate, remaining);
    if (!content) continue;
    samples.push({ id: candidate.id, title: candidate.title, text: content, hash: shortHash(content), reason: selection.reason });
    remaining -= content.length;
  }
  return samples;
}

export function checkWriterConstraints(content: string, task?: WriterTask | null) {
  const issues: string[] = [];
  if (!task) return issues;
  if (task.length) {
    const length = [...content.matchAll(/[\p{L}\p{N}]/gu)].length;
    if (length < task.length.min || length > task.length.max) issues.push(`正文${length}字，要求${task.length.min}—${task.length.max}字（不计标点空白）`);
  }
  for (const item of task.forbiddenTerms) if (content.includes(item.text)) issues.push(`出现禁用词「${item.text}」`);
  return issues;
}
