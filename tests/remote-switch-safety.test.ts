import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../scripts/remote-server.mjs", import.meta.url), "utf8");
const ast = ts.createSourceFile("remote-server.mjs", source, ts.ScriptTarget.Latest, true);
const functions = ast.statements.filter(node => ts.isFunctionDeclaration(node) && ["assertNoActiveJobs", "fetchJson"].includes(node.name?.text || ""))
  .map(node => node.getText(ast)).join("\n");

// Evaluate the real guard without invoking launchctl, deployment or a live workbench.
function guard(response: unknown, portOpen = false) {
  return vm.runInNewContext(functions + "\nassertNoActiveJobs", {
    fetch: async () => { if (response instanceof Error) throw response; return response; },
    isTcpPortOpen: async () => portOpen,
    AbortController, setTimeout, clearTimeout,
    describeError: (error: Error) => error.message
  }) as () => Promise<void>;
}

test("切换仅在确认服务未监听时允许冷启动，运行中不可读的服务保持阻断", async () => {
  for (const [refused, portOpen, allowed] of [[true, false, true], [true, true, false], [false, false, false]] as const) {
    const run = guard(Object.assign(new Error("连接失败"), { cause: { code: refused ? "ECONNREFUSED" : "ETIMEDOUT" } }), portOpen);
    if (allowed) await run();
    else await assert.rejects(run(), /无法确认任务状态/);
  }
});

test("任务读取、恢复、结构异常和运行任务阻断切换，完整终态列表允许切换", async () => {
  const healthy = { jobs: [], readErrors: [], recoveryErrors: {} };
  for (const data of [
    { ...healthy, readErrors: ["记录损坏"] },
    { ...healthy, recoveryErrors: { job: "恢复失败" } },
    { jobs: [] }, null,
    { ...healthy, recoveryErrors: [] },
    { ...healthy, jobs: [null] },
    { ...healthy, jobs: [{ status: "unknown" }] },
    { ...healthy, jobs: [{ status: "running" }] },
    { ...healthy, jobs: [{ status: "queued" }] }
  ]) {
    await assert.rejects(guard(Response.json(data))(), /已停止切换|运行或排队任务/);
  }
  await guard(Response.json({ ...healthy, jobs: ["completed", "failed", "cancelled", "interrupted"].map(status => ({ status })) }))();
});
