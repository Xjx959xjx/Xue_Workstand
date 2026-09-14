import { shortHash } from "./utils";
import { WRITER_REFERENCE_BUDGET, type WriterContextSnapshot } from "./writer-context";

export type FastReference = { id: string; title: string; transcript: string; indexText?: string };

function terms(value: string) {
  const normalized = value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  return new Set(Array.from({ length: Math.max(0, normalized.length - 1) }, (_, i) => normalized.slice(i, i + 2)));
}

// Local lexical ranking is a relevance hint, not a claim of semantic equivalence.
// Every source is considered; no model calls or writes occur on the write path.
export function selectFastReferences(candidates: FastReference[], task: string): WriterContextSnapshot["samples"] {
  const query = terms(task);
  const unique = [...new Map(candidates.filter(c => c.transcript.trim()).map(c => [shortHash(c.transcript.replace(/\s/g, "")), c])).values()];
  const indexes = unique.map(c => terms(`${c.title} ${c.indexText || ""} ${c.transcript}`));
  const frequencies = new Map<string, number>();
  for (const index of indexes) for (const term of index) frequencies.set(term, (frequencies.get(term) || 0) + 1);
  const ranked = unique.map((candidate, i) => ({ candidate, score: [...indexes[i]].reduce((sum, term) =>
    sum + (query.has(term) ? Math.log(1 + unique.length / (frequencies.get(term) || 1)) : 0), 0) / Math.sqrt(Math.max(1, indexes[i].size))
  })).sort((a, b) => b.score - a.score || a.candidate.id.localeCompare(b.candidate.id));
  let remaining = WRITER_REFERENCE_BUDGET;
  const result: WriterContextSnapshot["samples"] = [];
  for (const { candidate, score } of ranked) {
    if (remaining < 200) break;
    const budget = Math.min(4000, remaining);
    const raw = candidate.transcript.trim();
    const separator = "\n〔中间原文省略，仅借鉴表达，不作为本次事实〕\n";
    const available = budget - separator.length;
    const content = raw.length <= budget ? raw : raw.slice(0, Math.floor(available * 0.7)) + separator + raw.slice(-Math.ceil(available * 0.3));
    result.push({ id: candidate.id, title: candidate.title, text: content, hash: shortHash(content),
      reason: score > 0 ? "本地关键词匹配参考；仅学习适合本次素材的表达与衔接，不沿用范文事实。" : "未匹配到共同关键词，仅作为句式与节奏示例，不强套场景。" });
    remaining -= content.length;
  }
  return result;
}

// Only extract explicit, mechanically verifiable constraints. The generation
// prompt retains the original instructions for everything else.
export function fastWriterPlan(taskContext: string, samples: WriterContextSnapshot["samples"]): NonNullable<WriterContextSnapshot["plan"]> {
  const instruction = taskContext.split("\n\n原始资料：")[0];
  const range = instruction.match(/(\d{1,5})\s*[—–~～至到-]\s*(\d{1,5})\s*字/);
  const forbiddenTerms = [...instruction.matchAll(/(?:禁用词[：:]?|不要使用|禁止使用|不用)[「“"']?([^\s，。；、」”"'：:]{1,30})/g)]
    .slice(0, 20).map(match => ({ text: match[1], quote: match[0] }));
  return { task: { purpose: "按用户素材直接创作", facts: [], mustKeep: [], creativeFreedom: "以本次原始要求为准，内部构思，不补造事实。", timeContext: "", uncertainties: [], forbiddenTerms,
    length: range && Number(range[1]) <= Number(range[2]) && Number(range[2]) > 0 ? { min: Number(range[1]), max: Number(range[2]), quote: range[0] } : null },
    selected: samples.map(s => ({ id: s.id, reason: s.reason })), applicableStyle: [], notes: ["本地仅提取明确字数与禁用词，完整事实和要求交由正文生成阶段处理。"] };
}
