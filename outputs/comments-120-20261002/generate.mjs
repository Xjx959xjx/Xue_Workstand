import path from 'node:path';
import { promises as fs } from 'node:fs';
import nextEnv from '@next/env';
import { generateCommentBatch, buildCommentSystemPrompt } from '../../src/lib/engagement.ts';
import { writeJsonFile, writeTextFileAtomic } from '../../src/lib/storage/fs.ts';
nextEnv.loadEnvConfig(process.cwd(), true, {info(){},error(){}});
const saved=await fs.readFile('outputs/comment-direct-output-20261002/疯狂水世界-实际生成输入.md','utf8');
const blocks=[...saved.matchAll(/```text\n([\s\S]*?)\n```/g)];
if(blocks.length!==2) throw new Error('已保存生成材料格式不匹配');
const prompt=blocks[1][1].replace('创作 100 条新评论','创作 120 条新评论').replace('包含 100 个字符串','包含 120 个字符串');
const base=path.resolve('outputs/comments-120-20261002');
const comments=[]; const started=Date.now();
for(let i=0;i<3 && comments.length<120;i++) {
 const count=120-comments.length;
 const user=i===0?prompt:prompt+'\n本轮只补齐 '+count+' 条，不要重复已经生成的评论：'+JSON.stringify(comments);
 const r=await generateCommentBatch([{role:'system',content:buildCommentSystemPrompt('douyin')},{role:'user',content:user}],count,undefined,console.log,'urgent-water-120-20261002');
 comments.push(...r.batchParsed);
 await writeJsonFile(path.join(base,'result.json'),{schemaVersion:1,sourceUrl:'https://v.douyin.com/pbxDvaijhcs/',aiReview:false,localFilter:false,comments,elapsedMs:Date.now()-started});
 console.log('已生成 '+comments.length+' 条');
}
if(comments.length!==120) throw new Error('条数不足，已保存现有结果');
const numbered=comments.map((t,i)=>(i+1)+'. '+t).join('\n\n');
await writeTextFileAtomic(path.join(base,'疯狂水世界-120条评论.md'),'# 疯狂水世界｜120 条评论\n\n'+numbered+'\n');
await writeTextFileAtomic(path.join(base,'疯狂水世界-120条评论.txt'),comments.map((t,i)=>(i+1)+'. '+t).join('\n')+'\n');
console.log('文档已保存，用时 '+Math.round((Date.now()-started)/1000)+' 秒');
