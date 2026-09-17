import nextEnv from '@next/env';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { writeTextFileAtomic, writeJsonFile } from '../../src/lib/storage/fs.ts';

nextEnv.loadEnvConfig(process.cwd());
const resume = process.argv[2];
const preview = path.resolve(resume || 'outputs/style-card-redesign-20260916/live-preview-' + Date.now());
// Only the existing isolated research copy is read; production assets are never opened for writing.
const source = path.resolve('outputs/writer-style-study-20260916/style-preview-1789492396462/library/douyin/最翁说游');
process.env.STYLE_LIBRARY_DIR = path.join(preview, 'library');
process.env.APP_MODE = 'workspace';
const storage = await import('../../src/lib/storage.ts');
const ai = await import('../../src/lib/ai.ts');
const { styleCardInstruction } = await import('../../src/lib/writer-prompts.ts');
const ids = ['7614809579326577777', '7183274570739109177', '7596683369229339377'];
const sourceHashes = {};
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 8 * 60 * 1000);
const report = { preview, sourceIds: ids, checks: [], errors: [], sourceHashes };
console.log(JSON.stringify({ preview, stage: '开始隔离模型试跑', sourceCount: ids.length }));

try {
  const account = await storage.upsertAccount({ platform: 'douyin', name: '最游话说-新提示词预览', uid: 'style-redesign-preview' });
  if (!resume) await storage.saveStyle(account.platform, account.id, '隔离预览：等待新版生成');
  for (const id of ids) {
    const video = JSON.parse(await fs.readFile(path.join(source, 'videos', id + '.json'), 'utf8'));
    const transcript = await fs.readFile(path.join(source, 'transcripts', id + '.txt'), 'utf8');
    sourceHashes[id] = createHash('sha256').update(transcript).digest('hex');
    if (!resume) {
      await storage.saveVideos(account, [{ ...video, accountId: account.id }]);
      await storage.saveTranscript({ platform: account.platform, accountId: account.id, videoId: id, text: transcript, source: 'manual' });
    }
  }
  const prepared = await ai.prepareAccountStyleContext(account.platform, account.id, {
    force: true, signal: controller.signal,
    onAnalysisProgress(progress) { console.log(JSON.stringify({ stage: '逐篇分析', completed: progress.completedCount, total: progress.analysisCount })); }
  });
  const messages = [{ role: 'system', content: styleCardInstruction() }, ...prepared.messages.slice(1)];
  const storedCard = process.argv[3];
  const result = storedCard
    ? { text: await fs.readFile(storedCard, 'utf8'), ok: true, fallback: false, model: 'saved-preview' }
    : await ai.streamStyleResponseTextWithFallback({ messages, signal: controller.signal, onDelta() {} });
  if (!storedCard) await writeTextFileAtomic(path.join(preview, `raw-card-${Date.now()}.md`), result.text);
  const completed = await ai.completePreparedAccountStyle(prepared, result);
  await writeTextFileAtomic(path.join(preview, '风格卡预览.md'), completed.style);
  report.checks.push({ name: storedCard ? '已保存模型预览重新通过规则校验（不修改文本）' : '真实模型生成卡片并通过规则校验', ok: true, model: result.model, chars: completed.style.length, storedCard });
  console.log(JSON.stringify(report.checks.at(-1)));
  const cases = [
    { name: '叙事转向', prompt: '这是虚构的内部写作测试素材。写成一篇短视频文案，只输出正文。按先建立理解、后揭晓原因的顺序，不提前泄露结局，不增加事实。', sourceText: '社区图书室的旧书架连续三天是空的，志愿者以为书被人搬走了，先核对借阅登记，没查到集中借出。后来管理员说明：书架背板松动，书都被转移到储藏室，正在等待维修。书没有遗失。没有居民采访、争吵或其他后续。' },
    { name: '无反转说明', prompt: '这是虚构的内部写作测试素材。写一段自然连贯的口播，允许带轻微评价，保留全部开放信息，不制造争议或反转，只输出正文。', sourceText: '社区图书室从本周起，每周三、周五增加晚间开放时段：18点至20点。读者可以阅读和归还图书，借阅规则不变。没有改造、排队、预约或人员反馈信息。' },
    { name: '产品介绍', prompt: '这是虚构的内部写作测试素材。写一段自然的产品介绍口播，只使用给出的功能，不编造亲测、口碑、价格或推广数据，只输出正文。', sourceText: '“读到哪”是一款阅读记录工具。用户可以手动记录书名、阅读页码，并为每本书填写笔记；首页显示上次记录的页码；支持把自己写的笔记导出为文本。当前不支持自动识别翻页，也没有社交功能。' }
  ];
  for (const item of cases) {
    const draft = await ai.prepareWriteCopyContext({ platform: account.platform, accountId: account.id, mode: 'rewrite', prompt: item.prompt, sourceText: item.sourceText }, { signal: controller.signal });
    const reply = await ai.chatCompleteStrict(draft.messages, ai.WRITE_COPY_REASONING_EFFORT, { signal: controller.signal, maxOutputTokens: ai.WRITE_COPY_MAX_OUTPUT_TOKENS });
    if (!reply.ok || reply.fallback || !reply.text.trim()) throw new Error(reply.userMessage || reply.fallbackReason || '试写没有返回正文');
    await writeTextFileAtomic(path.join(preview, item.name + '.md'), reply.text);
    await writeJsonFile(path.join(preview, item.name + '-input.json'), item);
    report.checks.push({ name: item.name, ok: true, model: reply.model, chars: reply.text.length });
    console.log(JSON.stringify(report.checks.at(-1)));
  }
} catch (error) {
  report.errors.push(error instanceof Error ? error.message : String(error));
  console.error('隔离试跑失败：' + report.errors.at(-1));
  process.exitCode = 1;
} finally {
  clearTimeout(timeout);
  await writeJsonFile(path.join(preview, 'verification.json'), report);
  console.log(JSON.stringify({ preview, passed: report.checks.length, errors: report.errors }));
}
