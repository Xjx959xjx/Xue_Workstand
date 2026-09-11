import {runOpenCli} from '../../src/lib/opencli-runtime.ts';
import {writeFile,rename} from 'node:fs/promises';
const ids=['6M2sWFbQxys','6Z9uC3g8Dac','LTx3dUErYHM','1MEj5pEf1N4','9S2w0-7KEUY','iYXLoGWf6A4','yGYOtodvxRg','Tu6BATa1mSQ','t0qghgA9neo','bd9Pi4akfpA','fQJ8cibdSPQ','l2na9OvTblM','cKDTLv_Y824'];
const session='cf-comments-review';
for(const id of ids){try{
await runOpenCli(['browser',session,'open',`https://v.douyin.com/${id}/`],{timeout:30000});
const js=`(async()=>{const id=location.pathname.match(/video\\/(\\d+)/)?.[1];if(!id)throw Error('未解析到视频ID：'+location.href);const u=new URL('https://www-hj.douyin.com/aweme/v1/web/comment/list/');for(const[k,v]of Object.entries({device_platform:'webapp',aid:'6383',aweme_id:id,cursor:'0',count:'50',item_type:'0'}))u.searchParams.set(k,v);const r=await fetch(u,{credentials:'include'});const d=await r.json();return {id,url:location.href,title:document.title,status:d.status_code,total:d.total,comments:d.comments?.map(c=>({text:c.text,likes:c.digg_count}))};})()`;
const result=await runOpenCli(['browser',session,'eval',js],{timeout:30000});
await writeFile(`outputs/cf-source-review/${id}-comments.tmp`,typeof result==='string'?result:JSON.stringify(result));await rename(`outputs/cf-source-review/${id}-comments.tmp`,`outputs/cf-source-review/${id}-comments.json`);
console.log(id+' 已保存评论响应');
}catch(e){console.log(id+' 失败：'+e.message);}}
await runOpenCli(['browser',session,'close'],{timeout:5000});
