import path from 'node:path';
import { promises as fs } from 'node:fs';
import nextEnv from '@next/env';
import { z } from 'zod';
import { generateCommentBatch, reviewGeneratedCommentBatch, buildCommentSystemPrompt, buildCommentBatchPrompt, formatCommentSource, selectCommentSamples } from '../../src/lib/engagement.ts';
import { selectCommentVoiceReferences } from '../../src/lib/engagement-research.ts';
import { buildEngagementTransportGuard, sanitizeEngagementGenerationText } from '../../src/lib/engagement-transport.ts';
import { commentPipelineCheckpointSchema, engagementModelCallSchema } from '../../src/lib/storage/schemas.ts';
import { readAiSettings } from '../../src/lib/storage/ai-settings.ts';
import { readJsonFile, writeJsonFile, writeTextFileAtomic } from '../../src/lib/storage/fs.ts';

// 复用正式模型调用与整组审核，只把测试结果写入独立目录。
nextEnv.loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
const originalLibrary = path.resolve(process.env.STYLE_LIBRARY_DIR || 'style-library');
const output = path.resolve('outputs/comment-review-ab-20261002');
const settings = await readAiSettings();
const auditDir = path.join(originalLibrary, 'engagement/.cache/model-calls');
const auditFiles = await fs.readdir(auditDir);
const audits = await Promise.all(auditFiles.map(async (file) => ({ file, data: engagementModelCallSchema.parse(await readJsonFile(path.join(auditDir, file))) })));
const inputCases = [
  { id: 'kpl', checkpoint: 'f9a3712d21', count: 150 },
  { id: 'iqoo', checkpoint: '2c59307a1c', count: 150 }
];
const inputs = await Promise.all(inputCases.map(async (row) => {
  const state = commentPipelineCheckpointSchema.parse(await readJsonFile(path.join(originalLibrary, 'engagement/.cache/pipeline', row.checkpoint + '.json')));
  const call = audits.filter((a) => a.data.scope === row.checkpoint && a.data.policy === 'comment_generate' && a.data.status === 'completed').sort((a, b) => a.data.startedAt.localeCompare(b.data.startedAt))[0];
  if (!call) throw new Error('缺少原始生成提示词：' + row.id);
  const body = call.data.messages[1].content;
  const material = body.split('\n\n真实评论参考（只学习表达，来自其他视频）：')[0];
  const [titlePart, ...contentParts] = material.split('\n\n完整正文：\n');
  if (!contentParts.length) throw new Error('原始材料格式不匹配：' + row.id);
  const source = { id: row.id, title: titlePart.replace(/^视频标题（含话题标签）：/, ''), content: sanitizeEngagementGenerationText(contentParts.join('\n\n完整正文：\n')) };
  return { ...row, source, research: state.research, originalGenerationCall: call.file };
}));
process.env.STYLE_LIBRARY_DIR = path.join(output, 'isolated-library');
await writeJsonFile(path.join(process.env.STYLE_LIBRARY_DIR, 'settings/ai-models.json'), settings);
await writeJsonFile(path.join(output, 'inputs.json'), { schemaVersion: 1, preparedAt: new Date().toISOString(), cases: inputs });

const resultSchema = z.object({ schemaVersion: z.literal(1), id: z.string(), phase: z.string(), requestedCount: z.number().int(), candidates: z.array(z.string()), localCandidates: z.array(z.string()), noReview: z.array(z.string()), withReview: z.array(z.string()), firstReview: z.array(z.object({ id: z.number().int(), keep: z.boolean(), reason: z.string().optional() })).optional(), timings: z.record(z.number()), supplements: z.array(z.object({ branch: z.enum(['noReview', 'withReview']), requested: z.number().int(), candidates: z.array(z.string()), selected: z.array(z.string()), decisions: z.array(z.object({ id: z.number().int(), keep: z.boolean(), reason: z.string().optional() })).optional() })) });
for (const input of inputs) {
  const target = path.join(output, input.id + '.json');
  const prior = await readJsonFile(target);
  const result = prior ? resultSchema.parse(prior) : { schemaVersion: 1, id: input.id, phase: 'prepared', requestedCount: input.count, candidates: [], localCandidates: [], noReview: [], withReview: [], timings: {}, supplements: [] };
  if (result.phase === 'completed') { console.log(input.id + ': 已完成，跳过'); continue; }
  const save = () => writeJsonFile(target, resultSchema.parse(result));
  const guard = buildEngagementTransportGuard([input.source.title, input.source.content]);
  const references = selectCommentVoiceReferences(input.research);
  const generate = async (count, kept, reasons = []) => {
    const prompt = buildCommentBatchPrompt({ source: input.source, relatedResearch: input.research, platform: 'douyin', requestedCount: count, usedComments: kept }) + (reasons.length ? '\n仅补缺口；上轮具体拒绝原因，避免再次出现同一问题：' + JSON.stringify(reasons.slice(-30)) : '');
    return generateCommentBatch([{ role: 'system', content: buildCommentSystemPrompt('douyin') }, { role: 'user', content: prompt }], count, undefined, (message) => console.log(input.id + ': ' + message), 'review-ab-' + input.id);
  };
  if (!result.candidates.length) {
    console.log(input.id + ': 开始共同生成 ' + input.count + ' 条');
    const started = Date.now();
    const generation = await generate(input.count, []);
    result.timings.generationMs = Date.now() - started;
    result.candidates = generation.batchParsed;
    result.localCandidates = selectCommentSamples(result.candidates, guard, input.count, references).items;
    result.noReview = [...result.localCandidates]; result.phase = 'generated';
    await save();
    console.log(input.id + ': 共同生成完成，基础过滤后 ' + result.localCandidates.length + ' 条');
  }
  if (!result.firstReview) {
    console.log(input.id + ': 开始整组 AI 审核');
    const started = Date.now();
    const review = await reviewGeneratedCommentBatch(result.localCandidates, formatCommentSource(input.source), [], undefined, (message) => console.log(input.id + ': ' + message), 'review-ab-' + input.id);
    result.timings.reviewMs = Date.now() - started;
    result.firstReview = review.decisions;
    result.withReview = review.decisions.filter((d) => d.keep).map((d) => result.localCandidates[d.id]); result.phase = 'reviewed';
    await save();
    console.log(input.id + ': AI 审核完成，保留 ' + result.withReview.length + ' 条');
  }
  for (const branch of ['noReview', 'withReview']) {
    const missing = input.count - result[branch].length;
    if (missing <= 0 || result.supplements.some((s) => s.branch === branch)) continue;
    console.log(input.id + ': ' + branch + ' 补缺口 ' + missing + ' 条（最多一轮）');
    const reasons = branch === 'withReview' ? result.firstReview.filter((d) => !d.keep).map((d) => ({ text: result.localCandidates[d.id], reason: d.reason })) : [];
    const started = Date.now();
    const generation = await generate(missing, result[branch], reasons);
    result.timings[branch + 'SupplementGenerationMs'] = Date.now() - started;
    const selected = selectCommentSamples(generation.batchParsed, guard, missing, [...references, ...result[branch]]).items;
    const supplement = { branch, requested: missing, candidates: generation.batchParsed, selected };
    // 原始补量候选先落盘，审核失败也能检查已生成材料。
    await writeJsonFile(path.join(output, input.id + '-' + branch + '-supplement-candidates.json'), { schemaVersion: 1, ...supplement });
    if (branch === 'withReview' && selected.length) {
      const reviewStarted = Date.now();
      const review = await reviewGeneratedCommentBatch(selected, formatCommentSource(input.source), result[branch], undefined, (message) => console.log(input.id + ': ' + message), 'review-ab-' + input.id);
      result.timings.withReviewSupplementReviewMs = Date.now() - reviewStarted;
      supplement.decisions = review.decisions;
      result[branch].push(...review.decisions.filter((d) => d.keep).map((d) => selected[d.id]));
    } else result[branch].push(...selected);
    result.supplements.push(supplement); await save();
  }
  result.phase = 'completed'; await save();
  for (const branch of ['noReview', 'withReview']) await writeTextFileAtomic(path.join(output, input.id + '-' + branch + '.txt'), result[branch].map((text, index) => (index + 1) + '. ' + text).join('\n') + '\n');
  console.log(JSON.stringify({ id: input.id, noReview: result.noReview.length, withReview: result.withReview.length, rejected: result.firstReview.filter((d) => !d.keep).length, timings: result.timings }));
}
