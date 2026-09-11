import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import nextEnv from "@next/env";
import { segmentSimulationSource, parseDiscussionSimulation, buildDiscussionSimulationMessages } from "../src/lib/discussion-simulation.ts";

// Real, small, labelled internal simulation. No production library or publishing.
nextEnv.loadEnvConfig(process.cwd(), true, { info() {}, error() { throw new Error("环境配置读取失败，请检查本地环境文件。"); } });
const trialModel = process.env.CHAT_MODEL || "gpt-6-astra";
const trialReasoningEffort = "low";
const trialWireApi = process.env.DISCUSSION_TRIAL_WIRE_API || process.env.CHAT_WIRE_API || "auto";
if (!["responses", "chat_completions", "auto"].includes(trialWireApi)) throw new Error("测试接口必须是 responses、chat_completions 或 auto。");
process.env.CHAT_MODEL = trialModel;
process.env.CHAT_REASONING_EFFORT = trialReasoningEffort;
process.env.CHAT_WIRE_API = trialWireApi;
process.env.CHAT_FALLBACK_ENABLED = "0";
for (let index = 2; index <= 5; index++) process.env[`CHAT_FALLBACK_${index}_ENABLED`] = "0";
process.env.STYLE_LIBRARY_DIR = await mkdtemp(path.join(os.tmpdir(), "discussion-model-trial-"));
process.env.SITES_STORAGE_MODE = "local";
process.env.SITES_RUNTIME = "local";
const { streamResponseText, getChatRuntimeConfig } = await import("../src/lib/ai.ts");
const { classifyModelFailure } = await import("../src/lib/model-runtime.ts");
const { writeJsonFile, writeTextFileAtomic } = await import("../src/lib/storage/fs.ts");
if (!getChatRuntimeConfig().configured) throw new Error("未发现已配置的真实模型，本次测试停止；没有使用假输出。");

const fixtures = [
  { id: "tech", title: "数码：耳机测试条件", source: "本次演示的是一款假想耳机。文案标称单次续航8小时，支持主动降噪，售价299元。8小时的测试条件为关闭降噪、音量50%。开启降噪后的续航没有公布。素材没有说明防水等级、快充时长，也没有用户实测数据。" },
  { id: "game", title: "游戏：合作地图规则", source: "以下是虚构游戏的内部测试公告。新合作地图允许2至4人组队，地图完成后获得外观奖励，不影响角色属性。公告没有说明是否可以自动匹配队友，也没有说明中途退出后如何处理进度。测试将持续7天，正式上线日期尚未确定。" },
  { id: "story", title: "剧情：不能把猜测写成结论", source: "这是一个虚构短片的剧情梗概。女主在屋内听到门铃，打开门时没有看到人，门口放着一个没有署名的信封。她没有打开信封，而是把它收进抽屉。最后一个镜头停在抽屉上。前文未交代寄件人，也没有展示信封内容。" }
];
const outputDir = path.join(process.cwd(), "outputs", "discussion-model-trial", new Date().toISOString().replace(/[:.]/g, "-"));
const report = {
  schemaVersion: 1, engineVersion: "simulation-trial-v2", purpose: "内部模拟", requestedModel: trialModel, reasoningEffort: trialReasoningEffort, requestedWireApi: trialWireApi,
  method: "原文编号 + 单次流式模型调用 + 程序校验；未接入正式页面、任务中心或旧生成引擎",
  execution: "三组顺序执行，每组单次调用、120秒上限，不自动重试、补齐或切换模型。保留失败阶段、耗时及未完成输出。", cases: []
};
const cancel = new AbortController();
const stop = () => cancel.abort();
process.once("SIGINT", stop);
process.once("SIGTERM", stop);

async function persist() {
  await writeJsonFile(path.join(outputDir, "results.json"), report);
  const md = ["# 真实模型测试：内部讨论预演 v2", "", report.method, "", report.execution, "", `请求模型：${trialModel}；推理强度：${trialReasoningEffort}。素材均为虚构测试数据。程序检查不能代替内容质量评审。`, ""];
  for (const result of report.cases) {
    md.push(`## ${result.title}`, "", `状态：${result.status}；墙钟：${result.wallMs}ms；首次文本：${result.firstTextMs === null ? "未收到" : result.firstTextMs + "ms"}；请求：${result.requestMs ?? "未完成"}ms`, "", "### 输入素材", "", result.source, "");
    if (result.failure) md.push(`失败阶段：${result.failure.stage}；分类：${result.failure.kind}；原因：${result.failure.message}`, "");
    md.push("### 原始输出（失败时可能不完整）", "", "```json", result.raw, "```", "");
    if (result.output) {
      md.push("### 模拟讨论", "");
      for (const node of result.output.comments) md.push(`- ${node.id} / ${node.parentId ? "回复 " + node.parentId : "主评论"}：${node.text}`);
      md.push("", "### 程序检查", "", "原文编号存在、引句由程序还原；2条主评论+2条回复=4条；父节点与主题一致；保留模拟标识。", "");
    }
  }
  await writeTextFileAtomic(path.join(outputDir, "results.md"), md.join("\n"));
}

try {
  for (const fixture of fixtures) {
    if (cancel.signal.aborted) break;
    const started = performance.now();
    const record = { ...fixture, status: "running", firstTextMs: null, wallMs: 0, raw: "", stage: "source" };
    report.cases.push(record);
    // Persist before the request so interruptions do not erase the test case.
    await persist();
    console.log(`${fixture.title}：开始单次流式请求 ${trialModel} / ${trialReasoningEffort}`);
    let requestStarted;
    try {
      record.segments = segmentSimulationSource(fixture.source);
      record.stage = "model";
      requestStarted = performance.now();
      const result = await streamResponseText({
        messages: buildDiscussionSimulationMessages(record.segments), reasoningEffort: trialReasoningEffort,
        signal: AbortSignal.any([cancel.signal, AbortSignal.timeout(120_000)]), maxOutputTokens: 1400,
        onDelta(delta) {
          if (!delta) return;
          if (record.firstTextMs === null) {
            record.firstTextMs = Math.round(performance.now() - requestStarted);
            console.log(`${fixture.title}：首次文本 ${record.firstTextMs}ms`);
          }
          record.raw += delta;
        }
      });
      record.requestMs = Math.round(performance.now() - requestStarted);
      record.model = result.model;
      record.wireApi = result.wireApi;
      record.reasoningEffort = result.reasoningEffort;
      if (result.fallback || !result.text?.trim()) throw new Error("模型返回空内容或回退结果，本轮未通过。");
      record.raw = result.text;
      record.stage = "validation";
      await persist();
      record.output = parseDiscussionSimulation(record.raw, record.segments);
      record.status = "completed";
      record.stage = "done";
    } catch (error) {
      if (requestStarted !== undefined && record.requestMs === undefined) record.requestMs = Math.round(performance.now() - requestStarted);
      const classified = classifyModelFailure(error);
      record.status = cancel.signal.aborted ? "canceled" : "failed";
      record.failure = {
        stage: record.stage, kind: record.stage === "validation" ? "validation" : classified.kind,
        // Persist only classified errors, not upstream bodies or credentials.
        message: record.stage === "validation" && error instanceof Error ? error.message : cancel.signal.aborted ? "用户取消测试" : classified.userMessage
      };
      process.exitCode = cancel.signal.aborted ? 130 : 1;
      console.log(`${fixture.title}：${record.failure.message}`);
    }
    record.wallMs = Math.round(performance.now() - started);
    await persist();
    console.log(`${fixture.title}：${record.status}，墙钟 ${record.wallMs}ms`);
  }
} finally {
  process.removeListener("SIGINT", stop);
  process.removeListener("SIGTERM", stop);
}
console.log(`真实模型测试报告：${path.join(outputDir, "results.md")}`);
