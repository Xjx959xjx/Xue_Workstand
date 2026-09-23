import path from 'node:path';
import os from 'node:os';
import { readFile, mkdtemp, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import nextEnv from '@next/env';

// Run manually with tsx. Snapshot one saved transcript; never write production caches.
nextEnv.loadEnvConfig(process.cwd(), true, { info() {}, error() { throw new Error('环境配置读取失败'); } });
const sourceRoot = path.resolve(process.env.STYLE_LIBRARY_DIR || 'style-library');
const videoId = '7143933814799142174';
const accountDir = path.join(sourceRoot, 'douyin', '最翁说游');
const sourcePath = path.join(accountDir, 'transcripts', `${videoId}.txt`);
const snapshotDir = process.env.STYLE_TRIAL_INPUT_DIR;
const snapshot = snapshotDir ? JSON.parse(await readFile(path.join(snapshotDir, 'input.json'), 'utf8')) : null;
const transcript = await readFile(snapshotDir ? path.join(snapshotDir, 'input.txt') : sourcePath, 'utf8');
const sourceMtime = snapshot?.sourceMtime || (await stat(sourcePath)).mtime.toISOString();
const video = JSON.parse(await readFile(path.join(accountDir, 'videos', `${videoId}.json`), 'utf8'));
process.env.STYLE_LIBRARY_DIR = await mkdtemp(path.join(os.tmpdir(), 'style-model-compare-'));
process.env.SITES_STORAGE_MODE = 'local';
process.env.SITES_RUNTIME = 'local';
process.env.CHAT_FALLBACK_ENABLED = '0';
for (let index = 2; index <= 5; index++) process.env[`CHAT_FALLBACK_${index}_ENABLED`] = '0';
const { chatCompleteStrict } = await import('../src/lib/ai.ts');
const { styleAnalysisInstruction, parseStyleEvidence } = await import('../src/lib/writer-context.ts');
const { classifyModelFailure } = await import('../src/lib/model-runtime.ts');
const { writeJsonFile, writeTextFileAtomic } = await import('../src/lib/storage/fs.ts');
const destination = path.resolve('outputs/style-sample-model-comparison', new Date().toISOString().replace(/[:.]/g, '-'));
const messages = snapshot?.messages || [
  { role: 'system', content: styleAnalysisInstruction() },
  { role: 'user', content: [`样本来源 ID：${video.id}`, '平台：douyin', `标题：${video.title}`, `播放:${video.stats.views} 点赞:${video.stats.likes} 评论:${video.stats.comments} 收藏:${video.stats.favorites} 分享:${video.stats.shares ?? 0}`, `完整转写（${transcript.length} 字）：`, `<source_text>\n${transcript}\n</source_text>`].join('\n') }
];
await writeTextFileAtomic(path.join(destination, 'input.txt'), transcript);
await writeJsonFile(path.join(destination, 'input.json'), { schemaVersion: 1, videoId, title: video.title, sourceMtime, sha256: createHash('sha256').update(transcript).digest('hex'), messages });
const requestedCases = process.env.STYLE_TRIAL_CASES?.split(',');
const cases = [{ id: 'astra-medium', model: 'gpt-6-astra', effort: 'medium' }, { id: '5.5-high', model: 'gpt-5.5', effort: 'high' }, { id: '5.5-medium', model: 'gpt-5.5', effort: 'medium' }].filter(c => !requestedCases || requestedCases.includes(c.id));
const sequential = process.env.STYLE_TRIAL_SEQUENTIAL === '1';
console.log('隔离输出目录：'+destination);
const runCase = async test => {
  const started = performance.now();
  const record = { schemaVersion: 1, ...test, status: 'running', attempts: [] };
  const signal = AbortSignal.timeout(300_000);
  let nextMessages = messages;
  console.log(`${test.id} 开始`);
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const requestStarted = performance.now();
      const result = await chatCompleteStrict(nextMessages, test.effort, { model: test.model, signal, retryTransientFailure: false });
      const item = { requestMs: Math.round(performance.now() - requestStarted), text: result.text, model: result.model, effort: result.reasoningEffort, wireApi: result.wireApi };
      record.attempts.push(item);
      if (!result.ok || result.fallback || !result.text?.trim()) throw new Error('模型没有返回可用分析');
      try { record.evidence = parseStyleEvidence(result.text, transcript, video.title); record.status = 'completed'; break; }
      catch (error) {
        item.validationError = error instanceof Error ? error.message : String(error);
        if (attempt === 1) { record.status = 'validation-failed'; break; }
        console.log(`${test.id} 首次原句校验失败，按正式链路纠正一次`);
        nextMessages = [...messages, { role: 'assistant', content: result.text }, { role: 'user', content: `上次分析未通过校验：${item.validationError}\n请对照上方完整原文修正分析，重新输出完整JSON。所有quote、before、after必须连续逐字摘录，保留原文标点和换行；不纠正转写字词，不拼接片段。beats保持原文顺序，bridge两端依次出现且不重叠。只修正无效结构和证据，不改变分析任务。` }];
      }
      await writeJsonFile(path.join(destination, `${test.id}.json`), record);
    }
  } catch (error) { record.status = 'failed'; record.error = classifyModelFailure(error).userMessage; }
  record.totalMs = Math.round(performance.now() - started);
  await writeJsonFile(path.join(destination, `${test.id}.json`), record);
  const readable = [`# ${test.model} / ${test.effort}`, '', `状态：${record.status}；总耗时：${(record.totalMs / 1000).toFixed(1)}秒；请求次数：${record.attempts.length}`, ''];
  if (record.error) readable.push(record.error, '');
  if (record.evidence) {
    const e = record.evidence;
    readable.push('## 内容类型与结构', '', e.genre, '', e.structure, '', '## 表达用途', '', ...e.purposes.map(s=>`- ${s}`), '', '## 叙事推进', '');
    for (const beat of e.narrative?.beats || []) readable.push(`### ${beat.purpose}`, '', beat.quote, '');
    readable.push('## 表达手法', '');
    for (const move of e.moves) readable.push(`### ${move.action}`, '', `原句：${move.quote}`, '', `适用：${move.when}`, '', `避免：${move.avoid}`, '');
    readable.push('## 边界', '', ...[...e.unsuitable,...e.limitations].map(s=>`- ${s}`), '');
  }
  for (const [i,a] of record.attempts.entries()) readable.push(`## 第${i+1}次原始输出（${(a.requestMs/1000).toFixed(1)}秒）`, '', a.validationError ? `校验失败：${a.validationError}` : '原句校验通过', '', '```json', a.text, '```', '');
  await writeTextFileAtomic(path.join(destination, `${test.id}.md`), readable.join('\n'));
  console.log(`${test.id} ${record.status} ${(record.totalMs/1000).toFixed(1)}秒`);
  return record;
};
const results = [];
if (sequential) { for (const test of cases) results.push(await runCase(test)); }
else results.push(...await Promise.all(cases.map(runCase)));
await writeJsonFile(path.join(destination, 'results.json'), { schemaVersion: 1, method: `同一保存稿快照、正式样本提示词与校验器；${sequential ? '顺序' : '并发'}执行；不切备用节点；仅证据校验失败时纠正一次；未生成最终风格卡。`, results });
const report = ['# 样本分析模型对照', '', `样本：${video.title}；${transcript.length}字；源稿保存时间：${sourceMtime}。`, '', `${sequential ? '顺序' : '并发'}执行，使用相同输入和正式分析提示词。耗时含可能的一次证据纠正；单篇单轮不能代表普遍性能，且共享服务可能受其他任务影响。`, '', '| 模型 | 档位 | 总耗时 | 请求次数 | 结果 |', '| --- | --- | --- | --- | --- |', ...results.map(r=>`| ${r.model} | ${r.effort} | ${(r.totalMs/1000).toFixed(1)}秒 | ${r.attempts.length} | ${r.status} |`), '', ...cases.map(c=>`- [${c.model} / ${c.effort}](${path.join(destination,c.id+'.md')})`), '', '原始JSON、完整提示词及输入稿均保存在此目录。未修改正式转写、风格卡、样本缓存或AI配置。'];
await writeTextFileAtomic(path.join(destination, 'report.md'), report.join('\n'));
console.log('报告：'+path.join(destination,'report.md'));
