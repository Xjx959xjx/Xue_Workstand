const { AlignmentType, Document, HeadingLevel, LevelFormat, Packer, Paragraph, TextRun } = require("docx");
const fs = require("node:fs");
const path = require("node:path");

const title = "脑子记不住事，试试把琐事烂尾项目丢给 AI";
const sourceUrl = "https://www.bilibili.com/video/BV14fYt6GE3g/";

const comments = [
  "嘴答应了脑子没答应，这句话就是我上班的真实写照",
  "我不是记性差，我是根本不记得自己把东西记哪了。。",
  "工作群一个、收藏一个、备忘录一个、日历再来一个，最后找东西还是靠聊天记录搜关键词",
  "最真实的是当时答应得特别利索，过两天人家来问，我连这段对话都感觉是第一次听说",
  "能记得提醒爸妈体检这个确实有用，有些事情不难但忘一次真的会后悔",
  "所以它只是提醒你约号，还是能直接查到哪家医院什么时候有号？这两个差别挺大的",
  "我妈的体检日期我记不住，我游戏活动哪天结束倒是记得清清楚楚[笑哭]",
  "这条比上一条更能让我看懂它是干嘛的，琐事提醒只是基础，把烂尾项目重新捞出来才是重点",
  "40条装机收藏看完以后成功从不知道买什么变成每一个都不敢买",
  "装机方案放半年，显卡价格都换一轮了，之前收集的资料可能还得重新收集哈哈哈哈",
  "5000预算发评论区，人可以走了，过会儿能收到五十套互相打架的配置",
  "其实很多项目卡住真不是资料不够，就是不想承担选错的后果，所以一直搜一直看",
  "收藏在某种意义上就是我对这件事已经做过了",
  "我不是在拖延，我只是在异步处理，只是这个进程挂起了半年",
  "研究各种提高效率的方法，是我最喜欢的一种浪费时间的方式",
  "有时候把下一步缩小成‘先定显卡’确实管用，大任务看着就累，小决定还能做",
  "不过先定显卡CPU真的合理吗，装机区的大佬应该马上就到了",
  "要是AI研究三天最后跟我说再等等下一代显卡，那就彻底学会我了",
  "每日简报一天一份还行，千万别早中晚各来一份，不然我会把通知一起关了",
  "想知道它怎么判断什么事情重要，万一我随口说想买鱼缸，它天天催我养鱼怎么办",
  "要充值开VIP吗？有广告吗？免费版能记多少东西",
  "up能不能把产品名字和入口放简介里，字幕识别出来的名字看不懂",
  "微信收藏和群聊能直接接吗，不能的话我还是得手动搬过去吧",
  "父母体检、工作需求这些信息都挺私人的，数据存在哪里最好讲一下",
  "可以把所有记忆导出来不？用久了最怕被一个软件绑住",
  "第二大脑最怕最后也长满杂物，然后还得再建一个第三大脑来整理它",
  "我用过好多笔记软件，最后发现最好用的功能还是搜索，只要我还记得关键词",
  "不是什么信息都值得永久保存，过期的配置和已经取消的项目它会自动清理吗",
  "感觉真正有用的不是帮忙存资料，是隔几天还能把当时为什么卡住说清楚",
  "这个适合项目多的人，我目前最大的烂尾项目是整理我的烂尾项目",
  "以前是我催AI干活，现在怎么变成AI催我了",
  "能不能设置只提醒重要的事？我不想每天早上收到一份电子责备",
  "视频有点像广告，不过‘东西记了但不知道记在哪’和‘资料越多越不敢决定’确实说中了",
  "收藏了，等我把收藏夹里前面那几个效率工具看完就来试[doge]",
  "建议过一个月再拍一期，看看它帮你推进了多少项目，以及又新增了多少烂尾项目"
];

const danmaku = [
  "有", "每天都有", "脑子被工作掏空了", "这描述像我", "上周的我和这周的我不认识",
  "答应得可快了", "没问题！", "然后就没然后了", "记住了（并没有）", "周一谁啊",
  "我嘴替我接的活", "脑子没参会", "这句太真实", "哈哈哈哈哈哈",
  "信息太散了", "工作群先来一个", "微信收藏是坟场", "备忘录也有", "手机电脑还不互通",
  "全记了", "等于没记", "到底放哪了", "搜索半小时", "翻到开始怀疑自己",
  "我甚至记得我记过", "就是找不到", "脑容量告急", "那就外包",
  "外接硬盘来了", "脑子还能扩容吗", "硬盘得自己翻啊", "这个会自己捞",
  "检索才是重点", "第一次作业", "爸妈体检", "这个得记", "确实容易忘",
  "约号要提前", "三甲真的难约", "早报来了", "第一行就提醒", "这句话它当真了",
  "这个提醒有用", "我妈记得我体检", "我记不得我妈的", "别突然煽情",
  "随口说的也记？", "那我得谨慎发言", "黑历史也会记住吗", "琐事这块可以", "重点来了",
  "烂尾项目！", "我的收藏夹开始发抖", "半年算什么", "装机拖半年哈哈", "五千预算",
  "评论区装机佬来了", "40条收藏", "越看越不会买", "资料收集100%", "行动进度0%",
  "保存即完成", "收藏即学会", "再等等党", "下一代马上出了", "显卡永远等下一代",
  "不是缺资料", "是不敢选", "说中了。。。", "选择困难症", "把现状全丢进去",
  "然后又忘了它", "AI也被搁置了", "几天后自己捞回来", "morning brief", "每天一份还能接受",
  "别一天八份", "项目复活", "干巴巴提醒没用", "它知道卡在哪？", "显卡还是CPU",
  "装机区要吵起来了", "先定显卡吧", "不 先定用途", "大佬正在输入", "被戳中了",
  "半年没动", "资料越多越难选", "决策才是瓶颈", "40条链接没白看",
  "也可能已经过时了", "一团乱麻", "缩成一个动作", "先做一步", "别给我完整计划",
  "完整计划看着就累", "原来就干两件事", "琐事存好", "项目捞回", "专属简报",
  "接上半年前的上下文", "这个比较难", "聪明提醒器", "越用越懂？", "先看一个月",
  "收费吗", "有广告不", "隐私怎么处理", "先收藏了", "等会再看"
];

if (comments.length !== 35 || danmaku.length !== 110) {
  throw new Error(`数量错误：评论 ${comments.length}，弹幕 ${danmaku.length}`);
}

const font = { ascii: "Arial Unicode MS", hAnsi: "Arial Unicode MS", eastAsia: "Arial Unicode MS", cs: "Arial Unicode MS" };

function numberingLevel(reference) {
  return {
    reference,
    levels: [{
      level: 0,
      format: LevelFormat.DECIMAL,
      text: "%1.",
      alignment: AlignmentType.LEFT,
      style: { paragraph: { indent: { left: 560, hanging: 360 } } }
    }]
  };
}

function numberedSection(heading, items, reference) {
  const compact = reference === "danmaku";
  return [
    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: `${heading}（${items.length}）`, bold: true, font })] }),
    ...items.map((item) => new Paragraph({
      numbering: { reference, level: 0 },
      spacing: { line: compact ? 285 : 320, after: compact ? 55 : 90 },
      children: [new TextRun({ text: item, font, size: 22 })]
    }))
  ];
}

const doc = new Document({
  creator: "账号风格库",
  title: `${title}｜35条评论｜110条弹幕`,
  description: "B站视频评论与弹幕文案",
  styles: {
    default: { document: { run: { font, size: 22 }, paragraph: { spacing: { line: 320, after: 100 } } } },
    paragraphStyles: [{
      id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
      run: { font, size: 28, bold: true, color: "111827" },
      paragraph: { spacing: { before: 260, after: 140 }, outlineLevel: 0 }
    }]
  },
  numbering: { config: [numberingLevel("comments"), numberingLevel("danmaku")] },
  sections: [{
    properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 } } },
    children: [
      new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: title, bold: true, size: 34, font })] }),
      new Paragraph({ spacing: { after: 80 }, children: [new TextRun({ text: "35条评论｜110条弹幕", color: "475467", font })] }),
      new Paragraph({ spacing: { after: 260 }, children: [new TextRun({ text: sourceUrl, color: "2563EB", font })] }),
      ...numberedSection("评论", comments, "comments"),
      ...numberedSection("弹幕", danmaku, "danmaku")
    ]
  }]
});

const output = path.join(__dirname, "李野王SG+35条评论+110条弹幕.docx");
Packer.toBuffer(doc).then((buffer) => {
  fs.writeFileSync(output, buffer);
  console.log(output);
});
