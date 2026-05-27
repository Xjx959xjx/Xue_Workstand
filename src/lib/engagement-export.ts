import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { resolveEngagementRecord } from "./storage";

export type EngagementExport = {
  buffer: Buffer;
  fileName: string;
};

export async function createEngagementDocx(recordId: string): Promise<EngagementExport> {
  const record = await resolveEngagementRecord(recordId);
  const comments = record.comments?.items.map((item) => item.text.trim()).filter(Boolean) || [];
  const danmaku = record.danmaku?.items.map((item) => item.text.trim()).filter(Boolean) || [];

  if (!comments.length && !danmaku.length) {
    throw new Error("这条评论池还没有可导出的评论或弹幕。");
  }

  const doc = new Document({
    creator: "账号风格库",
    description: `${record.title} 的评论池导出`,
    title: `${record.title} 评论池`,
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: 1080,
              right: 1080,
              bottom: 1080,
              left: 1080
            }
          }
        },
        children: [
          new Paragraph({
            spacing: { after: 120 },
            children: [
              new TextRun({ text: "账号名：", bold: true, size: 24 }),
              new TextRun({ text: record.title, size: 24 })
            ]
          }),
          new Paragraph({
            spacing: { after: 260 },
            children: [
              new TextRun({ text: "视频链接：", bold: true, size: 24 }),
              new TextRun({ text: record.resolvedUrl || record.sourceUrl || "未记录", size: 24 })
            ]
          }),
          ...buildNumberedSection("评论", comments),
          ...buildNumberedSection("弹幕", danmaku)
        ]
      }
    ]
  });

  return {
    buffer: await Packer.toBuffer(doc),
    fileName: `${safeFileName(record.title)}-评论池.docx`
  };
}

function buildNumberedSection(title: string, items: string[]) {
  return [
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 180, after: 120 },
      children: [new TextRun({ text: title, bold: true, size: 28 })]
    }),
    ...(items.length
      ? items.map(
          (item, index) =>
            new Paragraph({
              spacing: { after: 90, line: 320 },
              children: [
                new TextRun({
                  text: `${index + 1}. ${item}`,
                  size: 22
                })
              ]
            })
        )
      : [
          new Paragraph({
            spacing: { after: 90 },
            children: [new TextRun({ text: "无", color: "667085", size: 22 })]
          })
        ])
  ];
}

function safeFileName(value: string) {
  return value
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "评论池";
}
