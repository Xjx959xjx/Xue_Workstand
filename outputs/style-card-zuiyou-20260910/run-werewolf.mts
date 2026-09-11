import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import nextEnv from '@next/env';
nextEnv.loadEnvConfig(process.cwd(), true, { info() {}, error() { throw new Error('环境配置读取失败'); } });
const realRoot = path.resolve(process.env.STYLE_LIBRARY_DIR || 'style-library');
const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'zuiyou-writer-'));
const output = path.resolve('outputs/style-card-zuiyou-20260910');
const relative = 'douyin/最翁说游';
await fs.mkdir(path.join(temporaryRoot, relative), {recursive:true});
for (const name of ['account.json','videos','transcripts','style-samples']) {
  const source = path.join(realRoot,relative,name);
  try { await fs.access(source); } catch (error) {
    if (name === 'style-samples' && (error as NodeJS.ErrnoException).code === 'ENOENT') continue;
    throw error;
  }
  await fs.cp(source,path.join(temporaryRoot,relative,name),{recursive:true});
}
process.env.STYLE_LIBRARY_DIR=temporaryRoot;
const {writeTextFileAtomic,writeJsonFile}=await import('../../src/lib/storage/fs.ts');
const {saveStyle}=await import('../../src/lib/storage.ts');
await saveStyle('douyin','douyin:最翁说游',await fs.readFile(path.join(output,'最游话说-新风格卡.md'),'utf8'));
const source=`老年人玩狼人杀可能玩不明白，但是你讲赢了能拿两鸡蛋。
他甚至能给你现场编出一部甄嬛传。
刷到一主播用鸡蛋做诱饵，叫来9个奶奶玩狼人杀，每个人都玩得不亦乐乎啊，尤其是这个3号炸雷奶奶。
二号也是个大傻子。
你别听他忽悠，昨天那局生的把水仙都给呼住了。
相信我的，就是5号要是狼也等一会，先把2号投掉。
我是平民。
拿来吧你！
我不抢麦我都急眼了。
哎，那个预言家查7号好人，他是不是狼现身了？
查预言家查完，他就目标指向7号去了，一会不投2号投谁去啊？
二号是狼。
三号炸雷奶奶在百合奶奶发言时发言，扣两枚鸡蛋。
不愧是炸雷奶奶啊，就算是扣鸡蛋也要抢麦怼回去，那这下不得不信了，可结果。
天黑请闭眼，狼人请睁眼`;
const input={kind:'write-copy' as const,title:'最游话说新卡｜奶奶狼人杀',inputSummary:'新风格卡，用户提供狼人杀素材',href:'/writer',input:{action:'create' as const,targetType:'account' as const,platform:'douyin' as const,accountId:'douyin:最翁说游',styleRefs:[{targetType:'account' as const,platform:'douyin' as const,accountId:'douyin:最翁说游'}],mode:'rewrite' as const,prompt:'用所选最游话说风格卡，将素材写成一篇口播文案。素材没有揭晓最终狼人身份，不补造身份和后续结果。',sourceText:source,originalSourceInput:source,save:true,useWebResearch:false}};
await writeJsonFile(path.join(output,'狼人杀-请求.json'),input);
const {createJob,getJob}=await import('../../src/lib/jobs.ts');
const job=await createJob(input);
let last='';
while(true){
 const current=await getJob(job.id);
 const state=`${current.status} ${current.stage} ${current.message}`;
 if(state!==last){console.log(state);last=state;}
 if(['completed','failed','cancelled','interrupted'].includes(current.status)){
   await writeJsonFile(path.join(output,'狼人杀-任务结果.json'),current);
   if(current.status!=='completed') throw new Error(current.error||current.message||'生成失败');
   console.log('RESULT_READY');break;
 }
 await new Promise(resolve=>setTimeout(resolve,2000));
}
await writeJsonFile(path.join(output,'狼人杀-运行记录.json'),{schemaVersion:1,temporaryRoot,realRoot,jobId:job.id,chain:'createJob -> runWriteCopyJob -> prepareWriteCopyBatchContext -> streamResponseTextWithFallback -> completePreparedWriteVariant',createdAt:new Date().toISOString()});
process.exit(0);
