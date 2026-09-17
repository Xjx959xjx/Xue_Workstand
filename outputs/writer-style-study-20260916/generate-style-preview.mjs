import nextEnv from '@next/env';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {writeFileAtomic,writeTextFileAtomic,writeJsonFile} from '../../src/lib/storage/fs.ts';
import {normalizeStorageSegment} from '../../src/lib/storage/core.ts';
import {parseStoredRecord} from '../../src/lib/storage/schemas.ts';
nextEnv.loadEnvConfig(process.cwd());
const sourceRoot=path.resolve(process.env.STYLE_LIBRARY_DIR||'style-library');
const slug=normalizeStorageSegment('最翁说游','账号');
const source=path.join(sourceRoot,'douyin',slug);
const out=path.resolve('outputs/writer-style-study-20260916/style-preview-'+Date.now());
const isolated=path.join(out,'library');
const target=path.join(isolated,'douyin',slug);
const hashes={};
async function copy(relative){const from=path.join(source,relative);const b=await fs.readFile(from);hashes[relative]=createHash('sha256').update(b).digest('hex');await writeFileAtomic(path.join(target,relative),b);}
await copy('account.json');
for(const f of ['style.md','style.meta.json']){try{await copy(f)}catch(e){if(e.code!=='ENOENT')throw e;}}
for(const dir of ['videos','transcripts','style-samples']){
 let entries;try{entries=await fs.readdir(path.join(source,dir),{withFileTypes:true})}catch(e){if(e.code!=='ENOENT')throw e;continue;}
 for(const e of entries)if(e.isFile()&&e.name.endsWith(dir==='transcripts'?'.txt':'.json'))await copy(path.join(dir,e.name));
}
process.env.STYLE_LIBRARY_DIR=isolated;
process.env.APP_MODE='workspace';
const {getTopTranscriptSamples}=await import('../../src/lib/storage.ts');
const {createJob,getJob,cancelJob}=await import('../../src/lib/jobs.ts');
const samples=await getTopTranscriptSamples('douyin',slug,'all');
if(!samples.length)throw new Error('没有可用转写，预览未生成');
const account=parseStoredRecord(path.join(target,'account.json'),JSON.parse(await fs.readFile(path.join(target,'account.json'),'utf8')),'account');
await writeJsonFile(path.join(out,'preview-info.json'),{accountId:account.id,accountName:account.name,sampleCount:samples.length,samples:samples.map(s=>({id:s.video.id,title:s.video.title,chars:s.transcript.length})),sourceHashes:hashes});
console.log(JSON.stringify({out,sampleCount:samples.length,totalTranscriptChars:samples.reduce((n,s)=>n+s.transcript.length,0)}));
const job=await createJob({kind:'account-style',title:'最游话说新版风格卡预览',input:{platform:'douyin',accountId:account.id,force:true}});
console.log(JSON.stringify({jobId:job.id}));
const deadline=Date.now()+20*60*1000;
let previous='';
while(true){
 const current=await getJob(job.id);
 if(!current)throw new Error('风格任务记录丢失');
 const stamp=JSON.stringify({status:current.status,stage:current.stage,message:current.message,progress:current.progress});
 if(stamp!==previous){console.log(stamp);previous=stamp;}
 if(['failed','cancelled','interrupted'].includes(current.status))throw new Error(current.error||current.message||'风格生成未完成');
 if(current.status==='completed'){
  const card=await fs.readFile(path.join(target,'style.md'),'utf8');
  await writeTextFileAtomic(path.join(out,'最游话说-新版风格卡.md'),card);
  const changed=[];
  for(const [relative,before] of Object.entries(hashes)){
   try{const after=createHash('sha256').update(await fs.readFile(path.join(source,relative))).digest('hex');if(before!==after)changed.push(relative)}catch(e){if(e.code!=='ENOENT')throw e;changed.push(relative)}
  }
  await writeJsonFile(path.join(out,'verification.json'),{originalFilesChangedDuringRun:changed,cardChars:card.length,sampleCount:samples.length,jobId:job.id});
  console.log(JSON.stringify({completed:true,file:path.join(out,'最游话说-新版风格卡.md'),chars:card.length,originalFilesChangedDuringRun:changed}));break;
 }
 if(Date.now()>deadline){await cancelJob(job.id);throw new Error('预览生成超时，任务已取消，可从隔离目录查看已完成分析');}
 await new Promise(r=>setTimeout(r,2000));
}
