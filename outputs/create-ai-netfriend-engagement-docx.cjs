const { AlignmentType, Document, HeadingLevel, LevelFormat, Packer, Paragraph, TextRun } = require("docx");
const fs = require("node:fs");
const path = require("node:path");

const title = '我跟AI做了多年的"网友"！终于不用重新介绍自己了？！';
const sourceUrl = "https://www.bilibili.com/video/BV11zY46TE8z/";

const comments = [
  "我现在看到“你精准地抓住了问题的核心”就知道又要开始哄我了",
  "其实我不介意它忘记我叫什么，我介意的是刚说完不要分点，它又给我列了八条。",
  "聊天记录舍不得删不是有感情，是里面有我交代了两个小时的需求。。",
  "想起以前养电子宠物，现在轮到电子宠物催我吃饭运动了",
  "有没有一种可能，我的健身计划没执行，不是因为我忘了[笑哭]",
  "“别给我模板”几个字建议加入快捷短语",
  "我一直觉得用AI最累的部分是解释。自己还没想明白要什么，还得先把它教明白。",
  "这不比天天晒烧了多少token有意思，至少能看见到底拿来干嘛了",
  "先问价格，再决定需不需要被理解",
  "开头还以为又是教我装一堆东西，这个不用自己搭吧？",
  "工具已经够多了，再来一个能不能顺便帮我记住前面那些工具是干什么的。",
  "别记太牢，有些计划是半夜热血上头说的，天亮了不算。",
  "十点提醒我别吃夜宵，我可能本来忘了吃，结果让它提醒回来了",
  "AI到底什么时候能替我去健身，我负责看健身计划也行",
  "有点懂这个点。能记得我随口说过的小要求，比每次给我打一大段鸡血有用。",
  "我怕它把我吐槽领导的话整理进周报里。。。",
  "还是想看失败的情况，比如改了三次时间它能不能分清最后是哪次。",
  "现在有些AI一说话就是“稳稳接住你”，先接住我上条消息行不行",
  "想要助理，但不想多一个领导，这个度挺难拿捏。",
  "这类东西我最关心能不能搬家。用半年记一堆，换个平台又得从认识我开始。",
  "研究怎么提高效率研究了一下午，活还是早上那些活",
  "能不能让它平时少说点，我问的时候再详细说。我真的看不了每次一屏幕的回答。",
  "up这个主动提醒怎么收到的，手机通知吗？离开网页以后还能提醒不",
  "它记住的是我想成为的那个我，实际的我在床上。",
  "感觉这个适合手上好几个项目的人吧，我一天就那点事，感觉暂时用不上。",
  "看前面没什么感觉，提到“不想铺太大”那里懂了。要求不用反复强调确实舒服。",
  "别给我报喜不报忧就行。做不到直接说，最怕它跟我说做好了，我一看啥也没有。",
  "有时候觉得AI挺好用，有时候又觉得我在给它打工，来回横跳",
  "如果我三天都没理它，希望它先别判定我这个人不行[doge]",
  "工作资料不太敢全连进去，个人日程倒是想试试。",
  "看到最后才发现我最需要的是记住我说的“不要”，不是记住我的兴趣爱好。",
  "前期这些信息能从已有的笔记导进去吗，再手填一遍有点劝退。",
  "提醒健身可以，提醒我健身卡花了多少钱就有点越界了",
  "我对AI的要求已经从“帮我干大事”变成“别再把改好的东西改回去”",
  "想看用了一个月后的情况，东西记多了会不会开始张冠李戴。",
  "说标题写得一般这段可以多放点，我想知道一般到什么程度哈哈哈",
  "本来就只是个工具，能少让我干点杂事就行，不一定非得像人。",
  "现在人为了证明自己是人，写东西还得躲着AI常用句式，也是离谱。",
  "比起提醒我今天还有多少事，更希望它告诉我哪些可以不做。",
  "还有个问题，记错的东西能不能自己删？别我都换工作了它还惦记前公司那个项目。"
];

const danmaku = [
  "又要自我介绍了", "每日失忆（1/1）", "你好 昨天刚认识", "开新窗口前先叹气", "这句我也天天说",
  "说人话！！", "别分点了求你", "“我完全理解了”", "然后完全没理解", "哈哈哈哈哈哈",
  "上句话就忘", "新窗口新人生", "这存档怎么不自动保存", "薛定谔的记忆", "我是谁不重要 需求记住",
  "又得重新带新人", "快进到重复三遍", "每次解释比干活还累", "有被点到", "这名字怎么拼啊",
  "先看多少钱", "又有新工具了", "我的收藏夹不缺这个", "缺一个会打开收藏夹的", "贾维斯青春版？",
  "别又要装一下午", "能直接用不", "先蹲个实操", "宣传片我都心动", "用的时候另说。。",
  "这一段慢点", "能连手机日历吗", "权限给到哪一步", "上班的资料不敢乱传", "开始建档",
  "我选先休息", "都不想做怎么办", "别问了 我也不知道", "原来还得先教", "它又不会读心",
  "差生文具越来越多了", "效率工具启动！", "工作进度：0", "折腾工具进度：100%", "又是熟悉的一下午",
  "这个能导入笔记吗", "不想再搬一次了", "周三健身记下了", "周三想起健身", "想去和去了是两回事",
  "计划很美好", "先替我记着吧", "三天不理它哈哈哈", "突击抽查", "还认识我吗",
  "别又让我介绍项目", "选题才是最难的", "搜完发现全有人做了", "卷不动了", "我也天天卡这",
  "周报。。。", "放过周五吧", "文档开着 人已经下班了", "光标闪了半小时", "本周工作：写上周周报",
  "这例子很具体", "比一上来讲大道理强", "别给我上价值就行", "它还记得这句？", "这里有点用",
  "想看完整对话", "是另开窗口问的吗", "要求不用再说一遍了", "先别夸我 问题解决一下", "“你抓住了核心”",
  "这句话已经有声音了", "不是而是过敏了", "稳稳接住.jpg", "先接住我的需求", "人都被逼得不敢正常造句了",
  "十点是夜宵开场", "我现在就饿了", "正在吃的停了一下", "外卖软件表示赞同",
  "本来都忘记吃了", "谢谢提醒，打开外卖", "反向提醒是吧", "它主动发消息？", "关了网页也能收到吗",
  "有点像我妈了", "赛博妈咪", "我买的是助理还是班主任", "懂我就别催我", "已读装死",
  "假装没看见", "我真不是忘了", "单纯不想动", "这计划替我执行一下呗", "AI：最难带的一届",
  "人类插件未响应", "我负责躺 它负责规划", "至少计划瘦了", "健身卡都快忘记长什么样了", "别连我的外卖记录谢谢",
  "可以调提醒频率吗", "有事再找我挺好", "别一天发八次早安", "这比无脑夸强点", "标题到底写成啥了",
  "展开给看看", "网感也不是梗越多越好", "别每句都整金句", "没那么万能就正常了", "记错了咋办",
  "有些黑历史允许忘记", "想看一个月以后", "能导出记忆吗", "价格呢价格呢", "又收藏了一个 先不说用不用",
  "看完了 该干活了"
];

if (comments.length !== 40 || danmaku.length !== 120) {
  throw new Error(`数量错误：评论 ${comments.length}，弹幕 ${danmaku.length}`);
}

const font = { ascii: "Arial Unicode MS", hAnsi: "Arial Unicode MS", eastAsia: "Arial Unicode MS", cs: "Arial Unicode MS" };

function numberedSection(heading, items, reference) {
  return [
    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: `${heading}（${items.length}）`, bold: true, font })] }),
    ...items.map((item) => new Paragraph({
      numbering: { reference, level: 0 },
      spacing: { line: 320, after: 90 },
      children: [new TextRun({ text: item, font, size: 22 })]
    }))
  ];
}

const numberingLevel = (reference) => ({
  reference,
  levels: [{
    level: 0,
    format: LevelFormat.DECIMAL,
    text: "%1.",
    alignment: AlignmentType.LEFT,
    style: { paragraph: { indent: { left: 560, hanging: 360 } } }
  }]
});

const doc = new Document({
  creator: "账号风格库",
  title: `${title}｜40条评论｜120条弹幕`,
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
      new Paragraph({ spacing: { after: 80 }, children: [new TextRun({ text: "40条评论｜120条弹幕", color: "475467", font })] }),
      new Paragraph({ spacing: { after: 260 }, children: [new TextRun({ text: sourceUrl, color: "2563EB", font })] }),
      ...numberedSection("评论", comments, "comments"),
      ...numberedSection("弹幕", danmaku, "danmaku")
    ]
  }]
});

const output = path.join(__dirname, '我跟AI做了多年的网友+40条评论+120条弹幕.docx');
Packer.toBuffer(doc).then((buffer) => {
  fs.writeFileSync(output, buffer);
  console.log(output);
});
