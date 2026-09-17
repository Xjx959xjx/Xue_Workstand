import {promises as fs} from 'node:fs';
import nextEnv from '@next/env';
import {chatCompleteStrict} from '../../src/lib/ai.ts';
import {writeJsonFile,writeTextFileAtomic} from '../../src/lib/storage/fs.ts';
nextEnv.loadEnvConfig(process.cwd());
const out='outputs/writer-style-study-20260916';
const ids=['7614809579326577777','7386993686015479066','7183274570739109177'];
const samples=[];
for(const id of ids){const t=await fs.readFile(`style-library/douyin/最翁说游/transcripts/${id}.txt`,'utf8');samples.push(`【目标作者原作 ${id}】\n${t}`)}
const input=`【新稿内容：按以下信息释放顺序讲一个完整故事】
第一阶段：一名妻子觉得丈夫收藏的干脆面水浒英雄卡幼稚、没用，未征求同意把丈夫珍藏的卡卖掉；丈夫因此闹着离婚。先用这个具体冲突让人听下去。
第二阶段：认真站在男方这边。这段必须有足够的停留，观众才会认可接下来的反转。素材还有一个类似例子：一名妻子往丈夫养鱼的鱼缸里倒面粉，鱼全毁了。将两件事联系起来，具体说伴侣小爱好不应被擅自处理，收藏可能承载童年记忆，结婚后仍应尊重各自爱好。它承担积累认同的作用，但文案仍然是目标作者在讲事情，别铺成长篇婚姻金句。
第三阶段：此前的同情建立后，突然出现一句新的补充说法：“可是他对着卡片撸。”来源没有核实出是谁说的，不能捏造妻子或网友身份。保留这句原话。此前不泄露它。
第四阶段：给观众短暂的反应与态度转向，不是直接切一句冷笑话就结束，也不是向观众反复解释。宋江、武松可以成为具体的反应对象。语气从认真维护爱好变为觉得这事邪门、不便再替他辩护。观众一下就能懂，不需要连续追问“什么卡？水浒卡？宋江武松？”或复述前后发生了什么。
第五阶段：用贴着这个事件的一句吐槽或态度收尾，完成“原先替男方说话，听到补充后退让”的效果，不再回头平衡双方责任、不再总结尊重爱好。
【已知边界】没有售价、买家、当事人回应、具体时间地点、亲历、趁老公不在家、妻子倒面粉的具体原因等资料。都不能加。也不要给本来没有的数据造数值。参考原作的其他事件只能提供写法，不能转入此稿。
【目标】用户需要用「最游话说」的用词和连续讲述节奏，重新讲这个事件。下面三篇完整原作是唯一风格参考。学习他们如何用一串动作与细节推进，怎样自然带出评价、转折和结尾，写得像一个人在连贯讲话。不要把梗堆满每句，不要写“婚姻副本”“梁山好汉打进婚姻保卫战”等硬凑的大场面；平铺直叙、碎句化也不是目标。仍需有阶段过渡。只输出完整新稿。`;
const messages=[{role:'system',content:'你是中文短视频文案写手。以提供的同一作者完整原作作为声音参考，为给定的新事件写一篇完整文案。不要输出说明。'}, {role:'user',content:[...samples,input].join('\n\n')}];
await writeJsonFile(out+'/request-beats.json',{method:'目标三篇原作不变；源稿转换成有顺序、段落作用和信息释放时机的叙事说明，不带入源稿句式',messages});
try{const result=await chatCompleteStrict(messages,undefined,{signal:AbortSignal.timeout(240000),maxOutputTokens:5000});if(!result.ok||result.fallback||!result.text.trim())throw new Error(result.userMessage||result.fallbackReason||'模型未返回正文');await writeJsonFile(out+'/result-beats.json',result);await writeTextFileAtomic(out+'/draft-beats.md',result.text.trim()+'\n');console.log(JSON.stringify({model:result.model,text:result.text,chars:result.text.length}));}catch(e){console.error('第二轮试写失败：'+e.message);process.exitCode=1;}
