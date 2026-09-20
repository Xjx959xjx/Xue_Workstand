import { shortHash } from "./utils";
import { WRITER_REFERENCE_BUDGET, type StyleEvidence, type WriterContextSnapshot } from "./writer-context";

export type FastReference = { id: string; title: string; transcript: string; analysis?: StyleEvidence };
type Range = { start: number; end: number };

// These are local, explainable hints, not a semantic model or a claim of suitability.
const purposes = [
  /推广|推介|植入|商单|带货|引导参与|宣传|安利/,
  /讲解|解释|科普|介绍|教学|教程|攻略/,
  /杂谈|评论|议论|观点|讨论|吐槽/,
  /测评|评测|体验|试玩/,
];
const forms = [
  /悬念|吊胃口|设问|疑问|信息差/,
  /趣事|吃瓜|故事|叙事|事件|经历/,
  /转折|转场|承接|衔接|过渡|引入|切入/,
  /对比|比较|对照|反差/,
  /幽默|调侃|吐槽|反讽|自嘲/,
  /因果|解释|拆解|分析/,
];
function terms(value: string) {
  const normalized = value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  return new Set(Array.from({ length: Math.max(0, normalized.length - 1) }, (_, i) => normalized.slice(i, i + 2)));
}
function overlap(a: Set<string>, b: Set<string>) {
  return [...a].filter(term => b.has(term)).length / Math.sqrt(Math.max(1, a.size * b.size));
}
function matches(patterns: RegExp[], request: string, description: string) {
  const wanted = patterns.filter(pattern => pattern.test(request));
  return wanted.length ? wanted.filter(pattern => pattern.test(description)).length / wanted.length : 0;
}
function family(description: string) {
  const game = /游戏|手游|端游|网游|玩法|玩家|电竞/.test(description);
  const chat = /杂谈|吃瓜|趣事|社会|生活|闲聊/.test(description);
  return game && chat ? "混合" : game ? "游戏" : chat ? "杂谈" : "未分类";
}
function mergeRanges(ranges: Range[]) {
  const merged: Range[] = [];
  for (const range of [...ranges].sort((a, b) => a.start - b.start)) {
    const last = merged.at(-1);
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else merged.push({ ...range });
  }
  return merged;
}

function excerpt(candidate: FastReference, budget: number, request: string) {
  const raw = candidate.transcript.trim();
  if (raw.length <= budget) return raw;
  const header = "〔非全文：按原文顺序摘录；省略处不代表自然衔接，仅借鉴表达，不作为本次事实〕\n";
  const gap = "\n〔中间原文省略〕\n";
  const render = (ranges: Range[]) => header + mergeRanges(ranges).map(range => raw.slice(range.start, range.end)).join(gap);
  const ranges: Range[] = [];
  const add = (proposed: Range[]) => {
    if (render([...ranges, ...proposed]).length <= budget) ranges.push(...proposed);
  };
  const around = (quote: string, from = 0): Range | undefined => {
    const start = raw.indexOf(quote, from);
    if (start < 0) return;
    return { start: Math.max(0, start - 160), end: Math.min(raw.length, start + quote.length + 160) };
  };
  // Keep the opening and ending, but reserve most space for the middle.
  const edge = Math.min(350, Math.floor((budget - header.length - gap.length) / 4));
  add([{ start: 0, end: edge }, { start: raw.length - edge, end: raw.length }]);
  const analysis = candidate.analysis;
  const anchors: { ranges: Range[]; priority: number }[] = [];
  for (const bridge of analysis?.narrative?.bridges || []) {
    const before = around(bridge.before);
    const after = around(bridge.after, raw.indexOf(bridge.before) + bridge.before.length);
    // A bridge is admitted as a pair; never silently omit one side of the turn.
    if (before && after) anchors.push({ ranges: [before, after], priority: 3 + matches(forms, request, bridge.action) });
  }
  for (const beat of analysis?.narrative?.beats || []) {
    const range = around(beat.quote);
    if (range) anchors.push({ ranges: [range], priority: 2 + matches(forms, request, beat.purpose) });
  }
  for (const move of analysis?.moves || []) {
    const range = around(move.quote);
    if (range) anchors.push({ ranges: [range], priority: 1 + matches(forms, request, move.action) });
  }
  for (const anchor of anchors.sort((a, b) => b.priority - a.priority)) add(anchor.ranges);
  // Sparse/legacy evidence still gets middle coverage. These are explicitly excerpts,
  // not invented or model-verified rhetorical turning points.
  const width = Math.max(200, Math.min(900, Math.floor(budget / 6)));
  for (const fraction of [0.5, 0.25, 0.75, 0.125, 0.375, 0.625, 0.875]) {
    const start = Math.max(0, Math.floor(raw.length * fraction - width / 2));
    add([{ start, end: Math.min(raw.length, start + width) }]);
  }
  return render(ranges);
}

// All sources are considered. Purpose and narrative evidence outrank topic overlap;
// a mixed library keeps both game and chat references unless the request narrows it.
export function selectFastReferences(candidates: FastReference[], task: string): WriterContextSnapshot["samples"] {
  const instruction = task.split("\n\n原始资料：")[0];
  const requestedFamily = family(instruction);
  const balanced = requestedFamily === "混合" || requestedFamily === "未分类";
  const query = terms(task);
  const instructionTerms = terms(instruction);
  const noPromotion = /(?:不要|不用|不做|不写|无需|禁止|不含|不带).{0,5}(?:推广|广告|植入|商单)/.test(instruction);
  const purposeRequest = noPromotion ? instruction.replace(/(?:不要|不用|不做|不写|无需|禁止|不含|不带).{0,5}(?:推广|广告|植入|商单)/g, "") : instruction;
  const unique = new Map<string, FastReference>();
  for (const candidate of candidates.filter(c => c.transcript.trim())) {
    const key = shortHash(candidate.transcript.replace(/\s/g, ""));
    if (!unique.has(key) || (!unique.get(key)?.analysis && candidate.analysis)) unique.set(key, candidate);
  }
  const remaining = [...unique.values()].map(candidate => {
    const evidence = candidate.analysis;
    const purpose = evidence?.purposes.join(" ") || candidate.title;
    const narrative = evidence ? [evidence.genre, evidence.structure, ...(evidence.narrative?.forms || []),
      ...(evidence.narrative?.beats.map(beat => beat.purpose) || []),
      ...(evidence.narrative?.bridges.map(bridge => bridge.action) || []),
      ...evidence.moves.map(move => move.action)].join(" ") : candidate.title;
    const category = family(evidence ? [evidence.genre, ...evidence.purposes, ...(evidence.narrative?.forms || [])].join(" ") : candidate.title);
    const purposeMatch = matches(purposes, purposeRequest, purpose);
    const formMatch = matches(forms, instruction, narrative);
    const score = 3 * purposeMatch + 2 * formMatch + overlap(instructionTerms, terms(purpose + " " + narrative))
      + 0.5 * overlap(query, terms(candidate.title + " " + candidate.transcript))
      + (!balanced && (category === requestedFamily || category === "混合") ? 1 : 0)
      - (noPromotion && purposes[0].test(purpose) ? 4 : 0);
    return { candidate, category, score, purposeMatch, formMatch };
  });
  const selected: (typeof remaining[number] & { budget: number })[] = [];
  const counts = new Map<string, number>();
  let available = WRITER_REFERENCE_BUDGET;
  while (remaining.length && available >= 200) {
    // Balance the two families when both are present; do not treat a missing category
    // as evidence, or force every finished draft to be half game and half chat.
    const diversity = (category: string) => balanced && (category === "游戏" || category === "杂谈")
      ? 2 / (1 + (counts.get(category) || 0)) : 0;
    remaining.sort((a, b) => (b.score + diversity(b.category)) - (a.score + diversity(a.category)) || a.candidate.id.localeCompare(b.candidate.id));
    const next = remaining.shift()!;
    const length = next.candidate.transcript.trim().length;
    if (available < Math.min(length, 1200)) break;
    const budget = Math.min(length, available);
    selected.push({ ...next, budget });
    counts.set(next.category, (counts.get(next.category) || 0) + 1);
    available -= budget;
  }
  return selected.map(({ candidate, category, budget, purposeMatch, formMatch }) => {
    const text = excerpt(candidate, budget, instruction);
    const basis = candidate.analysis
      ? `依据已核验分析：${category}；${purposeMatch ? "用途匹配" : "用途未命中"}（${candidate.analysis.purposes.join("、")}），${formMatch ? "讲法匹配" : "讲法仅供对照"}（${candidate.analysis.narrative?.forms.join("、") || candidate.analysis.genre}）`
      : `缺少有效逐篇分析：按标题与正文作本地匹配，${category}仅为标题线索`;
    const scope = text === candidate.transcript.trim() ? "保留全文" : candidate.analysis ? "非全文，优先保留转场两侧与叙事节点，再补中段" : "非全文，保留首尾及分布于中段的片段，未确认转场位置";
    const conditions = candidate.analysis?.narrative?.bridges
      .filter(bridge => text.includes(bridge.before) && text.includes(bridge.after))
      .map(bridge => `${bridge.action}：${bridge.requires}`).join("；");
    return { id: candidate.id, title: candidate.title, text, hash: shortHash(text),
      reason: `${basis}；${scope}。${conditions ? `转场适用条件：${conditions}。` : ""}仅学习适用表达；转场须核对本次事实，不沿用范文事实。` };
  });
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
