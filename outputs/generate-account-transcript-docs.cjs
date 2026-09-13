const fs = require("node:fs");
const path = require("node:path");
const {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun
} = require("docx");

const root = process.cwd();
const outputDir = path.join(root, "outputs");

const accounts = [
  { folder: "呼叫网管", label: "呼叫网管", file: "呼叫网管-全部转写文案.docx" },
  { folder: "最翁说游", label: "最游话说", file: "最游话说-全部转写文案.docx" }
];

const font = { ascii: "STHeiti", hAnsi: "STHeiti", eastAsia: "STHeiti", cs: "STHeiti" };

function readVideos(accountFolder) {
  const videosDir = path.join(root, "style-library", "douyin", accountFolder, "videos");
  const transcriptsDir = path.join(root, "style-library", "douyin", accountFolder, "transcripts");
  return fs.readdirSync(videosDir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => {
      const id = file.slice(0, -5);
      const video = JSON.parse(fs.readFileSync(path.join(videosDir, file), "utf8"));
      const transcriptPath = path.join(transcriptsDir, `${id}.txt`);
      return {
        id,
        video,
        transcript: fs.existsSync(transcriptPath) ? fs.readFileSync(transcriptPath, "utf8").trim() : ""
      };
    })
    .filter((item) => item.transcript)
    .sort((a, b) => {
      const score = (b.video.hotScore || 0) - (a.video.hotScore || 0);
      if (score) return score;
      return String(b.video.publishedAt || "").localeCompare(String(a.video.publishedAt || ""));
    });
}

function formatTranscript(text) {
  return text
    .replace(/\r\n/g, "\n")
    .split(/\n+|(?<=[。！？!?])\s*/g)
    .map((line) => line.trim())
    .filter(Boolean);
}

function dateLabel(value) {
  if (!value) return "未记录";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
}

function buildDocument(label, items) {
  const children = [
    new Paragraph({ spacing: { after: 100 }, children: [new TextRun({ text: `${label}｜全部转写文案`, bold: true, size: 36, font })] }),
    new Paragraph({ spacing: { after: 80 }, children: [new TextRun({ text: `共 ${items.length} 篇，按账号库热度排序`, color: "475467", size: 22, font })] }),
    new Paragraph({ spacing: { after: 260 }, children: [new TextRun({ text: "说明：以下内容来自本地账号库已保存的自动转写，正文仅做分段排版，未改写原文。", color: "667085", size: 20, font })] })
  ];

  items.forEach((item, index) => {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        pageBreakBefore: index > 0,
        spacing: { before: index > 0 ? 160 : 0, after: 120 },
        children: [new TextRun({ text: `${index + 1}. ${item.video.title || item.id}`, bold: true, font })]
      }),
      new Paragraph({ spacing: { after: 180 }, children: [new TextRun({ text: `视频 ID：${item.id}　发布时间：${dateLabel(item.video.publishedAt)}`, color: "667085", size: 20, font })] })
    );

    for (const line of formatTranscript(item.transcript)) {
      children.push(new Paragraph({
        alignment: AlignmentType.LEFT,
        spacing: { after: 100, line: 320 },
        children: [new TextRun({ text: line, size: 23, font })]
      }));
    }
  });

  return new Document({
    creator: "账号风格库",
    title: `${label}｜全部转写文案`,
    description: `${label} 账号的全部已保存转写文案`,
    styles: {
      default: { document: { run: { font, size: 23 }, paragraph: { spacing: { line: 320, after: 100 } } } },
      paragraphStyles: [{
        id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { font, size: 29, bold: true, color: "111827" },
        paragraph: { spacing: { before: 260, after: 140 }, outlineLevel: 0 }
      }]
    },
    sections: [{
      properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 } } },
      children
    }]
  });
}

(async () => {
  for (const account of accounts) {
    const items = readVideos(account.folder);
    if (!items.length) throw new Error(`${account.label} 没有可用转写`);
    const buffer = await Packer.toBuffer(buildDocument(account.label, items));
    const output = path.join(outputDir, account.file);
    fs.writeFileSync(output, buffer);
    console.log(`${output}\t${items.length}篇`);
  }
})();
