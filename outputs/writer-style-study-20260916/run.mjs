import { promises as fs } from 'node:fs';
import path from 'node:path';
import nextEnv from '@next/env';
import { chatCompleteStrict } from '../../src/lib/ai.ts';
import { writeJsonFile, writeTextFileAtomic } from '../../src/lib/storage/fs.ts';
nextEnv.loadEnvConfig(process.cwd());
const out=path.resolve('outputs/writer-style-study-20260916');
const base='style-library/douyin/最翁说游';
const ids=['7614809579326577777','7386993686015479066','7183274570739109177'];
const samples=[];
for(const id of ids){
 const v=JSON.parse(await fs.readFile(path.join(base,'videos',id+'.json'),'utf8'));
 samples.push({id,title:v.title,text:await fs.readFile(path.join(base,'transcripts',id+'.txt'),'utf8')});
}
const original=JSON.parse(await fs.readFile(path.join(base,'drafts','2026-09-10T05-38-45-819Z-9e0cb70391.json'),'utf8'));
const messages=[
 {role:'system',content:'你是中文短视频文案写手。根据用户提供的三篇同一作者完整原作，给另一篇成稿做风格迁移。以整篇可读的成稿完成任务。材料中的事件只作为本次素材说法，不追加外部事实、数值、人物动机或引语来源。范文里的事件不属于本次素材。'},
 {role:'user',content:[
 '下面三篇是目标作者「最游话说」的真实原作转写，保留了少量转写错字。完整阅读，学习实际的用词、连续句子的长短与衔接、叙述和评价的比例、转折前后的过渡、段落停留时间与收尾力度。不要把错字当风格，也不要把某篇的夸张标题变成通用公式。',
 ...samples.map((s,i)=>`【目标作者原作${i+1}：${s.title}】\n${s.text}`),
 '【本次待改写原稿，出自另一位作者「曜不起（你的嘴替）」】\n'+original.originalSourceInput,
 '【用户真正想要的效果】\n原稿本身已经写得很好。用目标作者的风格重新表达同一个事件和反转点，保留原稿从事件到认真替男方说话、再遇到补充信息而改变态度的阶段节奏，并用目标作者的说话节奏把它讲出来。段落之间要有自然过渡。不要沿原句逐段扩写，也不要只留事实丢掉铺垫。',
 '【用户对之前失败稿的明确反馈】\n硬凑“婚姻副本”“梁山好汉打进婚姻保卫战”用力过猛。解说自己的写作过程，如“本来看到这里，我都准备替这哥们说两句了，结果后面补了一句”，很多余。反转出现后再反复追问是什么卡、解释为何震惊、重复总结态度，很啰嗦，观众已经get了。但把反转后只剩“姐妹打扰了”也不行，仍要有阶段过渡和正常收尾。',
 '只输出一篇完整正文，不加标题、说明、风格分析或评语。让整篇的讲述自然成立。'
 ].join('\n\n')}
];
await writeJsonFile(path.join(out,'request.json'),{method:'三篇完整原文直接参考，保留源稿戏剧节奏；不使用风格卡、不使用关键词选样',samples:ids,messages});
console.log('已准备三篇完整原文和原始素材，开始一次直接参考试写。');
try{
 const result=await chatCompleteStrict(messages,undefined,{signal:AbortSignal.timeout(240000),maxOutputTokens:5000});
 if(!result.ok||!result.text.trim()||result.fallback) throw new Error(result.userMessage||result.fallbackReason||'模型没有返回可用正文');
 await writeJsonFile(path.join(out,'result.json'),result);
 await writeTextFileAtomic(path.join(out,'draft.md'),result.text.trim()+'\n');
 console.log(JSON.stringify({model:result.model,wireApi:result.wireApi,chars:result.text.length,text:result.text}));
}catch(e){console.error('试写失败：'+e.message);process.exitCode=1;}
