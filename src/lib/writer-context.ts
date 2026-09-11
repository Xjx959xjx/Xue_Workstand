import { z } from "zod";
import { shortHash } from "./utils";

export const STYLE_ANALYSIS_VERSION = 4;
export const WRITER_PROMPT_VERSION = "writer-v7-purpose-and-presentation";
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

export function styleAnalysisInstruction() {
  return [
    "完整阅读这一篇原文，分析它实际如何表达，不生成新稿。只输出JSON。",
    "目的和讲述方式分开记录：purposes写文本实际承担的目的，可以同时介绍、评论、引导参与；narrative.forms写吃瓜、趣事、悬念、科普等讲法。吃瓜切入与推广目的可以同时成立，不是互斥分类。",
    "完整读到结尾再判断。不能凭标题、开头或题材排除介绍或推广用途；也不能因提到游戏就认定是推广。是否付费合作无法从文本确认时不要推断。",
    "narrative.beats按原文顺序记录关键段落的作用及原句，允许一篇先聊争议或趣事、再介绍游戏或活动。narrative.bridges记录目的转变时怎样承接，以及借用这种衔接需要哪些真实素材；没有转接就返回空数组，不强造广告段。",
    "bridge的before和after必须是依次出现且互不重叠的连续原句，选紧邻转接处、足以看懂承接的内容；不能拿相隔很远的两句伪装自然衔接。",
    "结构记录开场如何引出具体问题、怎样推进与转折、如何收尾；moves记录具体表达动作及适用条件和不适用情形。",
    "quote必须是原文连续逐字摘录，保留标点，不改字不省略；选足以展示表达动作的段落，不能只有泛泛口头禅。",
    "不要将单篇习惯升级为账号通则，不从文本臆测镜头或配乐，不把转写错字认作口头禅。",
    '结构：{"genre":"文体描述，允许混合","purposes":["实际目的"],"unsuitable":["需要哪些事实而当前任务可能不具备，不能仅凭讲法判定不适用"],"structure":"叙述推进方式","narrative":{"forms":["讲述方式"],"beats":[{"purpose":"这段起什么作用","quote":"20至100字连续原句"}],"bridges":[{"before":"转接前原句","after":"转接后原句","action":"怎样把前面的兴趣带到后面的内容","requires":"本次资料要具备什么才能借用"}]},"moves":[{"quote":"20至180字连续原文","action":"如何表达","when":"适用情形","avoid":"例外或限制"}],"limitations":["本篇不能支持的推断"]}。',
    "按证据选择1至4项moves、1至5段beats、0至2处bridges，不为凑数增加规则；不逐句复述，也不要求每篇都有反转或推广。"
  ].join("\n");
}

export function referenceSelectionInstruction() {
  return "目的和讲法分别匹配：推广可以用吃瓜、趣事或悬念切入，不能仅因genre或开头是争议就排除整篇。结合purposes、narrative.beats及bridges判断具体可借鉴段落、怎样转入游戏或活动。借用衔接前核对requires与本次真实资料；无依据不能编造爆料、玩家反应或亲历。纯争议稿也可借鉴适用的局部表达，但不能把提到同一游戏视为推广依据。";
}

export function validateStyleCardCitations(style: string, evidenceQuotes?: Array<{ sourceId: string; quote: string }>) {
  if (!evidenceQuotes) return;
  const citations = [...style.matchAll(/\[\[([^\]\n]+)\]\]「([^」]+)」/g)];
  if (!citations.length || citations.some(([, id, quote]) => !evidenceQuotes.some(e => e.sourceId === id && e.quote === quote))) {
    throw new Error("风格卡缺少有效原文引用或改写了证据，原卡已保留，请重新归纳。");
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
