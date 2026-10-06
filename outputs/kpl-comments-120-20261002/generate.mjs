import path from 'node:path';
import { promises as fs } from 'node:fs';
import nextEnv from '@next/env';
import { generateCommentBatch, buildCommentSystemPrompt, buildCommentBatchPrompt } from '../../src/lib/engagement.ts';
import { writeJsonFile, writeTextFileAtomic } from '../../src/lib/storage/fs.ts';
nextEnv.loadEnvConfig(process.cwd(), true, {info(){},error(){}});
const input=JSON.parse(await fs.readFile('outputs/comment-review-ab-20261002/inputs.json','utf8')).cases.find(x=>x.id==='kpl');
const record=JSON.parse(await fs.readFile('style-library/engagement/run-2205fcbabd.json','utf8'));
if(record.sourceUrl!=='https://v.douyin.com/pqNp4kvCxms/'||record.sourceText.trim()!==input.source.content.trim()) throw new Error('视频材料不匹配，已停止生成');
const base=path.resolve('outputs/kpl-comments-120-20261002');
const comments=[]; const started=Date.now();
for(let i=0;i<3 && comments.length<120;i++) {
 const count=120-comments.length;
 const prompt=buildCommentBatchPrompt({source:input.source,relatedResearch:input.research,platform:'douyin',requestedCount:count,usedComments:comments});
 const r=await generateCommentBatch([{role:'system',content:buildCommentSystemPrompt('douyin')},{role:'user',content:prompt}],count,undefined,console.log,'urgent-kpl-120-20261002');
 comments.push(...r.batchParsed);
 await writeJsonFile(path.join(base,'result.json'),{schemaVersion:1,sourceUrl:record.sourceUrl,aiReview:false,localFilter:false,comments,elapsedMs:Date.now()-started});
 console.log('已生成 '+comments.length+' 条');
}
if(comments.length!==120) throw new Error('条数不足，已保存现有结果');
await writeTextFileAtomic(path.join(base,'KPL开场-120条评论.md'),'# KPL开场｜120 条评论\n\n'+comments.map((t,i)=>(i+1)+'. '+t).join('\n\n')+'\n');
await writeTextFileAtomic(path.join(base,'KPL开场-120条评论.txt'),comments.map((t,i)=>(i+1)+'. '+t).join('\n')+'\n');
console.log('文档已保存，用时 '+Math.round((Date.now()-started)/1000)+' 秒');
