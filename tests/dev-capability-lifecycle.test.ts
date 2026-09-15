import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, writeFile, chmod, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

async function unusedPort() {
  const server = http.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

test("开发进程向网关转发并在退出时释放端口，令牌不进入日志", { timeout: 20000, skip: process.platform === "win32" }, async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), "dev-bridge-test-"));
  const appPort = await unusedPort();
  const bridgePort = await unusedPort();
  const token = "synthetic-test-token-01234567890123456789";
  const npm = path.join(fixture, "npm");
  await writeFile(npm, `#!/usr/bin/env node
const http=require('node:http');
const server=http.createServer((req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({ok:req.headers.authorization==='Bearer '+process.env.SITES_CAPABILITY_BRIDGE_TOKEN,publicUrl:process.env.SITES_CAPABILITY_BRIDGE_PUBLIC_URL}));});
server.listen(Number(process.env.PORT),'127.0.0.1');
process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
`);
  await chmod(npm, 0o700);
  const child = spawn(process.execPath, [path.resolve("scripts/dev-server.mjs"), "serve"], {
    cwd: fixture, detached: true, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PATH: `${fixture}${path.delimiter}${process.env.PATH}`, PORT: String(appPort), SITES_CAPABILITY_GATEWAY_PORT: String(bridgePort), SITES_CAPABILITY_BRIDGE_TOKEN: token, SITES_CAPABILITY_BRIDGE_PUBLIC_URL: "https://bridge.example.test/api/capability-bridge" }
  });
  let logs = "";
  child.stdout.on("data", chunk => { logs += chunk; });
  child.stderr.on("data", chunk => { logs += chunk; });
  const exit = once(child, "exit");
  const origin = `http://127.0.0.1:${bridgePort}`;
  try {
    let ready = false;
    for (let i=0; i<50; i++) {
      try { const r = await fetch(`${origin}/api/capability-bridge`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(300) }); if (r.ok) { assert.equal((await r.json() as { ok?: boolean }).ok, true); ready=true; break; } }
      catch { /* 启动期间短暂拒绝连接；达到重试上限即失败。 */ }
      await new Promise(resolve => setTimeout(resolve,100));
    }
    assert.equal(ready, true, logs);
    assert.equal((await fetch(`${origin}/api/health`)).status,404);
    process.kill(-child.pid!,"SIGTERM");
    await exit;
    await assert.rejects(fetch(`${origin}/api/capability-bridge`, { signal: AbortSignal.timeout(300) }));
    assert.equal(logs.includes(token),false);
  } finally {
    if(child.exitCode===null && child.signalCode===null) process.kill(-child.pid!,"SIGKILL");
    await rm(fixture,{recursive:true,force:true});
  }
});
