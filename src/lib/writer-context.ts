import { z } from "zod";
import { shortHash } from "./utils";

export { STYLE_ANALYSIS_VERSION, WRITER_PROMPT_VERSION, styleAnalysisInstruction } from "./writer-prompts";
export const WRITER_REFERENCE_BUDGET = 14_000;
const text = z.string().trim().min(1);
const evidence = z.object({ quote: text, action: text, when: text, avoid: z.string() });
const narrativeSchema = z.object({
  forms: z.array(text).min(1),
  beats: z.array(z.object({ purpose: text, quote: text })).min(1),
  bridges: z.array(z.object({
    before: text, after: text, action: text, requires: text
  }))
});

export const styleEvidenceSchema = z.object({
  genre: text,
  purposes: z.array(text).min(1),
  unsuitable: z.array(text),
  structure: text,
  // Older stored analyses remain readable; newly generated analyses must include this field.
  narrative: narrativeSchema.optional(),
  moves: z.array(evidence).min(1),
  limitations: z.array(text)
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
  selected: z.array(z.object({ id: text, reason: text })),
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

export function validateStyleCardCitations(
  style: string,
  evidenceQuotes?: StyleCardEvidence[]
) {
  if (!style.trim()) throw new Error("风格卡内容为空，原卡已保留，请重新归纳。");
  const invalidCitation = () => new Error("风格卡原文引用无效或改写了证据，原卡已保留，请重新归纳。");
  const marker = /\[\[([^\]\n]+)\]\]/g;
  let match: RegExpExecArray | null;
  while ((match = marker.exec(style))) {
    const sourceId = match[1];
    const quotes = (evidenceQuotes || []).filter(item => item.sourceId === sourceId).map(item => item.quote);
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
    marker.lastIndex = verifiedEnd + 1;
  }
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
