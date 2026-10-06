import path from 'node:path';
import nextEnv from '@next/env';
import { buildCommentSystemPrompt, buildCommentBatchPrompt, generateCommentBatch } from '../../src/lib/engagement.ts';
import { buildEngagementCommentResearch, groupCommentVoiceReferences } from '../../src/lib/engagement-research.ts';
import { readAiSettings } from '../../src/lib/storage/ai-settings.ts';
import { readJsonFile, writeJsonFile, writeTextFileAtomic } from '../../src/lib/storage/fs.ts';

nextEnv.loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
const base = path.resolve('outputs/kpl-fresh-prompt-ab-20261002');
const settings = await readAiSettings();
const source = (await readJsonFile('outputs/comment-review-ab-20261002/inputs.json')).cases.find(x => x.id === 'kpl').source;
process.env.STYLE_LIBRARY_DIR = path.join(base, 'isolated-library');
await writeJsonFile(path.join(process.env.STYLE_LIBRARY_DIR, 'settings/ai-models.json'), settings);
const saved = await readJsonFile(path.join(base, 'materials.json'));
const started = Date.now();
const research = saved?.research || await buildEngagementCommentResearch({ fullText: source.content, topic: source.title,
  summary: '', subjects: [], keyFacts: [], discussionAngles: [], skepticalAngles: [], anchorTerms: []
}, { platform: 'douyin', onProgress: message => console.log(message) });
const materials = saved || { schemaVersion: 1, collectedAt: new Date().toISOString(), collectionMs: Date.now() - started, source, research };
await writeJsonFile(path.join(base, 'materials.json'), materials);
const samples = research.referenceSamples;
if (!samples?.length) throw new Error('本轮没有可用参考，停止测试');
const sources = research.collectionSources || [];
const link = (platform, id) => platform === 'douyin' ? 'https://www.douyin.com/video/' + id : 'https://www.bilibili.com/video/' + id;
await writeTextFileAtomic(path.join(base, '抓取来源与原评.md'), '# KPL 本轮重新抓取\n\n采集时间：' + materials.collectedAt + '\n\n检索词：' + research.usedQueries.join(' / ') + '\n\n' + sources.map(row => '## ' + row.source + '\n\n' + (row.error ? '采集说明：' + row.error + '\n\n' : '') + row.videos.map(v => '- [' + v.title + '](' + link(row.source, v.id) + ')：总评论 ' + v.commentCount + ' 条；实际采集 ' + row.comments.filter(c => c.videoId === v.id).length + ' 条').join('\n')).join('\n\n') + '\n\n## 本轮全部抓取原评\n\n' + JSON.stringify(groupCommentVoiceReferences(research.capturedSamples || []), null, 2) + '\n\n## 两组共同使用的参考原评\n\n' + JSON.stringify(groupCommentVoiceReferences(samples), null, 2));
console.log(JSON.stringify({ captured: research.capturedSamples?.length, references: samples.length, collectionMs: materials.collectionMs, sources: sources.map(s => ({ platform: s.source, videos: s.videos.map(v => ({ id: v.id, count: v.commentCount })), error: s.error })) }));
const simple = '根据正文和抓取的评论给我100条评论，可重复使用原评';
const variants = [
  { id: 'A', title: '现有提示词', messages: [{ role: 'system', content: buildCommentSystemPrompt('douyin') }, { role: 'user', content: buildCommentBatchPrompt({ source, relatedResearch: research, platform: 'douyin', requestedCount: 100, usedComments: [] }) }] },
  { id: 'B', title: '极简提示词', messages: [{ role: 'user', content: simple + '\n\n标题：\n' + source.title + '\n\n正文：\n' + source.content + '\n\n抓取的评论：\n' + JSON.stringify(groupCommentVoiceReferences(samples)) + '\n\n只输出包含100个字符串的JSON数组。' }] }
];
for (const variant of variants) {
  await writeJsonFile(path.join(base, variant.id + '-prompt.json'), { schemaVersion: 1, messages: variant.messages });
  await writeTextFileAtomic(path.join(base, variant.id + '-完整提示词.txt'), variant.messages.map(m => '[' + m.role + ']\n' + m.content).join('\n\n'));
  if (await readJsonFile(path.join(base, variant.id + '-result.json'))) continue;
  const at = Date.now();
  console.log('开始 ' + variant.id + ' ' + variant.title);
  try {
    const result = await generateCommentBatch(variant.messages, 100, undefined, console.log, 'kpl-fresh-' + variant.id);
    const comments = result.batchParsed;
    const data = { schemaVersion: 1, title: variant.title, requestedCount: 100, actualCount: comments.length, elapsedMs: Date.now() - at, model: result.result.model, attempts: result.attempts, comments,
      uniqueCount: new Set(comments).size, exactReferenceReuse: comments.filter(c => samples.some(s => s.text.trim() === c.trim())).length };
    await writeJsonFile(path.join(base, variant.id + '-result.json'), data);
    await writeTextFileAtomic(path.join(base, variant.id + '-' + variant.title + '-100条.md'), '# ' + variant.title + '\n\n模型：' + data.model + '；耗时：' + (data.elapsedMs / 1000).toFixed(1) + ' 秒；实际 ' + comments.length + ' 条。未经审核、筛选或人工改写。\n\n' + comments.map((c, i) => (i + 1) + '. ' + c).join('\n\n'));
    console.log(JSON.stringify({ ...data, comments: undefined }));
  } catch (error) { await writeJsonFile(path.join(base, variant.id + '-error.json'), { error: String(error), elapsedMs: Date.now() - at }); console.error(variant.id + ' 失败：' + String(error)); }
}
