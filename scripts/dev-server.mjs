import fs from "fs";
import net from "net";
import path from "path";
import process from "process";
import { spawn } from "child_process";

const root = process.cwd();
const stateDir = path.join(root, ".dev-server");
const pidFile = path.join(stateDir, "next-dev.pid");
const logFile = path.join(stateDir, "next-dev.log");
const port = Number(process.env.PORT || 3000);

const command = process.argv[2] || "start";

async function main() {
  await fs.promises.mkdir(stateDir, { recursive: true });

  if (command === "start") return start();
  if (command === "stop") return stop();
  if (command === "restart") {
    await stop({ quiet: true });
    return start();
  }
  if (command === "status") return status();

  console.error("用法：node scripts/dev-server.mjs <start|stop|restart|status>");
  process.exit(1);
}

async function start() {
  const current = readPid();
  if (current && isRunning(current)) {
    console.log(`Next dev 已在运行：pid=${current}, http://localhost:${port}`);
    return;
  }

  const listener = await findPortListener(port);
  if (listener) {
    console.error(`端口 ${port} 已被占用：pid=${listener.pid || "unknown"} ${listener.command || ""}`.trim());
    process.exit(1);
  }

  const logFd = fs.openSync(logFile, "a");
  const child = spawn("npm", ["run", "dev"], {
    cwd: root,
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: { ...process.env, PORT: String(port) }
  });

  child.unref();
  fs.writeFileSync(pidFile, `${child.pid}\n`, "utf8");
  fs.closeSync(logFd);

  console.log(`已后台启动 Next dev：pid=${child.pid}`);
  console.log(`地址：http://localhost:${port}`);
  console.log(`日志：${logFile}`);
}

async function stop(options = {}) {
  const pid = readPid();
  if (!pid) {
    if (!options.quiet) console.log("没有找到后台 dev server pid。");
    return;
  }

  if (!isRunning(pid)) {
    fs.rmSync(pidFile, { force: true });
    if (!options.quiet) console.log(`后台 dev server 已不在运行，已清理 pid：${pid}`);
    return;
  }

  signalDevServer(pid, "SIGTERM");
  const stopped = await waitForStop(pid, 5000);
  if (!stopped) signalDevServer(pid, "SIGKILL");
  fs.rmSync(pidFile, { force: true });
  if (!options.quiet) console.log(`已停止后台 dev server：pid=${pid}`);
}

async function status() {
  const pid = readPid();
  const listener = await findPortListener(port);
  const healthy = await canConnect(port);

  console.log(
    JSON.stringify(
      {
        pid,
        pidRunning: pid ? isRunning(pid) : false,
        port,
        portListening: Boolean(listener),
        listener,
        healthy,
        url: `http://localhost:${port}`,
        logFile
      },
      null,
      2
    )
  );
}

function readPid() {
  try {
    const value = Number(fs.readFileSync(pidFile, "utf8").trim());
    return Number.isInteger(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function isRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function signalDevServer(pid, signal) {
  const target = process.platform === "win32" ? pid : -pid;
  try {
    process.kill(target, signal);
    return true;
  } catch {
    try {
      process.kill(pid, signal);
      return true;
    } catch {
      return false;
    }
  }
}

async function waitForStop(pid, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const listener = await findPortListener(port);
    if (!isRunning(pid) && !listener) return true;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
}

function canConnect(targetPort) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port: targetPort });
    socket.setTimeout(1000);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => resolve(false));
  });
}

async function findPortListener(targetPort) {
  if (!(await canConnect(targetPort))) return null;

  const result = await run("lsof", ["-nP", `-iTCP:${targetPort}`, "-sTCP:LISTEN", "-FpPc"]).catch(() => "");
  const lines = result.split("\n").filter(Boolean);
  const info = {};
  for (const line of lines) {
    const prefix = line[0];
    const value = line.slice(1);
    if (prefix === "p") info.pid = Number(value);
    if (prefix === "c") info.command = value;
  }
  return Object.keys(info).length ? info : { port: targetPort };
}

function run(bin, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr || stdout || `${bin} exited with ${code}`));
    });
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
