import fs from "fs";
import os from "os";
import path from "path";
import process from "process";
import { spawn } from "child_process";

const root = process.cwd();
const args = new Set(process.argv.slice(2));
const includeLibrary = args.has("--include-library");
const skipInstall = args.has("--skip-install");
const skipArchive = args.has("--skip-archive");
const packageJson = JSON.parse(await fs.promises.readFile(path.join(root, "package.json"), "utf8"));
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
const releaseName = `${packageJson.name || "account-style-library"}-${packageJson.version || "0.0.0"}-portable-${stamp}`;
const keepWork = args.has("--keep-work");
const workRoot = path.join(os.tmpdir(), `${packageJson.name || "account-style-library"}-package-work-${process.pid}`);
const stagingRoot = path.join(workRoot, "source");
const releaseRoot = path.join(root, "dist", releaseName);
const tgzArchivePath = `${releaseRoot}.tar.gz`;
const zipArchivePath = `${releaseRoot}.zip`;

try {
  await main();
} finally {
  if (!keepWork) await fs.promises.rm(workRoot, { recursive: true, force: true });
}

async function main() {
  console.log("准备发布工作区...");
  await fs.promises.rm(workRoot, { recursive: true, force: true });
  await fs.promises.rm(releaseRoot, { recursive: true, force: true });
  await fs.promises.rm(tgzArchivePath, { force: true });
  await fs.promises.rm(zipArchivePath, { force: true });
  await fs.promises.mkdir(stagingRoot, { recursive: true });

  await copyProjectSources();

  if (!skipInstall) {
    console.log("安装构建依赖...");
    await run("npm", ["ci", "--include=dev"], { cwd: stagingRoot });
  }

  console.log("构建 Next.js standalone 产物...");
  await run("npm", ["run", "build"], {
    cwd: stagingRoot,
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" }
  });

  console.log("组装可交付运行包...");
  await createRuntimePackage();

  if (!skipArchive) {
    console.log("压缩运行包...");
    await run("tar", ["-czf", tgzArchivePath, "-C", path.dirname(releaseRoot), path.basename(releaseRoot)], { cwd: root });
    if (await commandExists("zip")) {
      await run("zip", ["-qry", zipArchivePath, path.basename(releaseRoot)], { cwd: path.dirname(releaseRoot) });
    } else {
      console.log("未检测到 zip 命令，已跳过 Windows 友好的 .zip 压缩包。");
    }
  }

  console.log("");
  console.log("打包完成：");
  console.log(`  目录：${releaseRoot}`);
  if (!skipArchive) {
    console.log(`  macOS/Linux 压缩包：${tgzArchivePath}`);
    if (await exists(zipArchivePath)) console.log(`  Windows 压缩包：${zipArchivePath}`);
  }
  console.log("");
  console.log("交付给别人时，发压缩包即可；Windows 优先发 .zip，解压后运行 start.cmd 或 start.bat。");
  if (keepWork) console.log(`临时构建目录保留在：${workRoot}`);
  if (!includeLibrary) {
    console.log("注意：本次未包含 style-library 数据。若确实要带当前本地数据，重新执行：npm run package:release -- --include-library");
  }
}

async function copyProjectSources() {
  const entries = [
    "src",
    "public",
    "package.json",
    "package-lock.json",
    "next.config.mjs",
    "tsconfig.json",
    "next-env.d.ts"
  ];

  for (const entry of entries) {
    const source = path.join(root, entry);
    if (!(await exists(source))) continue;
    await fs.promises.cp(source, path.join(stagingRoot, entry), { recursive: true });
  }
}

async function createRuntimePackage() {
  const standaloneRoot = path.join(stagingRoot, ".next", "standalone");
  if (!(await exists(path.join(standaloneRoot, "server.js")))) {
    throw new Error("未找到 .next/standalone/server.js，请确认 next.config.mjs 已设置 output: \"standalone\"。");
  }

  await fs.promises.cp(standaloneRoot, releaseRoot, { recursive: true });
  await fs.promises.mkdir(path.join(releaseRoot, ".next"), { recursive: true });
  await fs.promises.cp(path.join(stagingRoot, ".next", "static"), path.join(releaseRoot, ".next", "static"), { recursive: true });

  if (await exists(path.join(stagingRoot, "public"))) {
    await fs.promises.cp(path.join(stagingRoot, "public"), path.join(releaseRoot, "public"), { recursive: true });
  }

  if (includeLibrary && await exists(path.join(root, "style-library"))) {
    await fs.promises.cp(path.join(root, "style-library"), path.join(releaseRoot, "style-library"), { recursive: true });
  } else {
    await fs.promises.mkdir(path.join(releaseRoot, "style-library"), { recursive: true });
    await fs.promises.writeFile(path.join(releaseRoot, "style-library", ".keep"), "", "utf8");
  }

  await fs.promises.mkdir(path.join(releaseRoot, "tools"), { recursive: true });
  await fs.promises.writeFile(path.join(releaseRoot, "tools", "runtime.mjs"), runtimeScript(), "utf8");
  await fs.promises.writeFile(path.join(releaseRoot, ".env.example"), releaseEnvExample(), "utf8");
  await fs.promises.writeFile(path.join(releaseRoot, "README.md"), releaseReadme(), "utf8");
  await fs.promises.writeFile(path.join(releaseRoot, "README-使用说明.md"), releaseReadme(), "utf8");
  await fs.promises.writeFile(path.join(releaseRoot, "VERSION.txt"), versionText(), "utf8");

  for (const [fileName, content] of Object.entries(launcherFiles())) {
    const target = path.join(releaseRoot, fileName);
    await fs.promises.writeFile(target, isWindowsLauncher(fileName) ? toCrLf(content) : content, "utf8");
    if (!fileName.endsWith(".bat")) await fs.promises.chmod(target, 0o755);
  }
}

function launcherFiles() {
  return {
    "start.sh": `#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "未检测到 Node.js。请先运行 ./install-deps.sh，或安装 Node.js 20+。"
  exit 1
fi
node tools/runtime.mjs start --open "$@"
`,
    "stop.sh": `#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "未检测到 Node.js。"
  exit 1
fi
node tools/runtime.mjs stop "$@"
`,
    "status.sh": `#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "未检测到 Node.js。"
  exit 1
fi
node tools/runtime.mjs status "$@"
`,
    "install-deps.sh": `#!/usr/bin/env bash
set -euo pipefail

echo "检查本机运行环境..."

if ! command -v node >/dev/null 2>&1; then
  if command -v brew >/dev/null 2>&1; then
    echo "安装 Node.js..."
    brew install node
  else
    echo "未检测到 Node.js。请先安装 Node.js 20+：https://nodejs.org/"
    echo "macOS 推荐先安装 Homebrew，再执行：brew install node"
    exit 1
  fi
fi

if ! command -v opencli >/dev/null 2>&1; then
  echo "安装 opencli..."
  npm install -g @jackwener/opencli
else
  echo "opencli 已安装：$(command -v opencli)"
fi

if ! command -v ffmpeg >/dev/null 2>&1; then
  if command -v brew >/dev/null 2>&1; then
    echo "安装 ffmpeg..."
    brew install ffmpeg
  else
    echo "未检测到 ffmpeg。需要视频转写时请安装 ffmpeg：https://ffmpeg.org/download.html"
  fi
else
  echo "ffmpeg 已安装：$(command -v ffmpeg)"
fi

echo "依赖检查完成。"
`,
    "start.command": `#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
./start.sh
echo
read -n 1 -s -r -p "服务已在后台运行。按任意键关闭这个窗口..."
echo
`,
    "stop.command": `#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
./stop.sh
echo
read -n 1 -s -r -p "按任意键关闭这个窗口..."
echo
`,
    "status.command": `#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
./status.sh
echo
read -n 1 -s -r -p "按任意键关闭这个窗口..."
echo
`,
    "install-deps.command": `#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
./install-deps.sh
echo
read -n 1 -s -r -p "按任意键关闭这个窗口..."
echo
`,
    "start.bat": windowsRuntimeLauncher("start", "启动", "--open"),
    "start.cmd": windowsRuntimeLauncher("start", "启动", "--open"),
    "stop.bat": windowsRuntimeLauncher("stop", "停止"),
    "stop.cmd": windowsRuntimeLauncher("stop", "停止"),
    "status.bat": windowsRuntimeLauncher("status", "状态"),
    "status.cmd": windowsRuntimeLauncher("status", "状态"),
    "install-deps.bat": windowsInstallDepsLauncher(),
    "install-deps.cmd": windowsInstallDepsLauncher()
  };
}

function windowsRuntimeLauncher(command, label, extraArgs = "") {
  return `@echo off
setlocal EnableExtensions
chcp 65001 >nul
title 账号风格库 - ${label}

cd /d "%~dp0"
if errorlevel 1 (
  echo 无法进入运行目录："%~dp0"
  echo 请先把压缩包完整解压到一个普通文件夹，再运行本脚本。
  pause
  exit /b 1
)

echo 当前目录：%CD%
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo 未检测到 Node.js。
  echo 请先运行 install-deps.cmd，或安装 Node.js 20+：https://nodejs.org/
  echo 如果你刚刚安装过 Node.js，请关闭这个窗口后重新双击本脚本。
  pause
  exit /b 1
)

echo Node 版本：
node -v
echo.

node "%~dp0tools\\runtime.mjs" ${command}${extraArgs ? ` ${extraArgs}` : ""}
set EXIT_CODE=%ERRORLEVEL%
echo.

if not "%EXIT_CODE%"=="0" (
  echo ${label}失败，错误码：%EXIT_CODE%
  echo 如果这里没有明确错误，请查看 .runtime\\server.log。
) else (
  echo ${label}命令执行完成。
  if "${command}"=="start" echo 如果浏览器没有自动打开，请访问：http://localhost:3000/gross-margin
)

pause
exit /b %EXIT_CODE%
`;
}

function windowsInstallDepsLauncher() {
  return `@echo off
setlocal EnableExtensions
chcp 65001 >nul
title 账号风格库 - 安装依赖

cd /d "%~dp0"
if errorlevel 1 (
  echo 无法进入运行目录："%~dp0"
  echo 请先把压缩包完整解压到一个普通文件夹，再运行本脚本。
  pause
  exit /b 1
)

echo 当前目录：%CD%
echo.

where node >nul 2>nul
if errorlevel 1 (
  where winget >nul 2>nul
  if errorlevel 1 (
    echo 未检测到 Node.js，也没有检测到 winget。
    echo 请手动安装 Node.js 20+：https://nodejs.org/
    pause
    exit /b 1
  )
  echo 安装 Node.js LTS...
  winget install OpenJS.NodeJS.LTS
  echo.
  echo 如果 Node.js 刚安装完成，请关闭本窗口后重新运行 install-deps.cmd。
  pause
  exit /b 0
)

echo Node 版本：
node -v
echo.

where npm >nul 2>nul
if errorlevel 1 (
  echo 未检测到 npm。请重新安装 Node.js LTS。
  pause
  exit /b 1
)

where opencli >nul 2>nul
if errorlevel 1 (
  echo 安装 opencli...
  call npm install -g @jackwener/opencli
) else (
  echo opencli 已安装
)
echo.

where ffmpeg >nul 2>nul
if errorlevel 1 (
  where winget >nul 2>nul
  if errorlevel 1 (
    echo 未检测到 ffmpeg。需要视频转写时请手动安装：https://ffmpeg.org/download.html
  ) else (
    echo 安装 ffmpeg...
    winget install Gyan.FFmpeg
  )
) else (
  echo ffmpeg 已安装
)

echo.
echo 依赖检查完成。现在可以运行 start.cmd。
pause
`;
}

function runtimeScript() {
  return `import fs from "fs";
import net from "net";
import path from "path";
import process from "process";
import { spawn } from "child_process";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const stateDir = path.join(root, ".runtime");
const pidFile = path.join(stateDir, "server.pid");
const logFile = path.join(stateDir, "server.log");
const command = process.argv[2] || "start";
const openAfterStart = process.argv.includes("--open");

await main();

async function main() {
  await ensureDefaultEnvFile();
  const fileEnv = readDotEnv(path.join(root, ".env"));
  const env = {
    ...fileEnv,
    ...process.env,
    NODE_ENV: "production",
    PORT: process.env.PORT || fileEnv.PORT || "3000",
    HOSTNAME: process.env.HOSTNAME || fileEnv.HOSTNAME || "127.0.0.1",
    STYLE_LIBRARY_DIR: process.env.STYLE_LIBRARY_DIR || fileEnv.STYLE_LIBRARY_DIR || "./style-library"
  };

  await fs.promises.mkdir(stateDir, { recursive: true });
  await fs.promises.mkdir(path.resolve(root, env.STYLE_LIBRARY_DIR), { recursive: true });

  if (command === "start") return start(env);
  if (command === "stop") return stop();
  if (command === "restart") {
    await stop({ quiet: true });
    return start(env);
  }
  if (command === "status") return status(env);

  console.error("用法：node tools/runtime.mjs <start|stop|restart|status>");
  process.exit(1);
}

async function start(env) {
  const current = readPid();
  const port = Number(env.PORT || 3000);
  const url = buildUrl(port, env.APP_START_PATH || "/gross-margin");

  if (current && isRunning(current)) {
    console.log(\`服务已在运行：pid=\${current}\`);
    console.log(\`地址：\${url}\`);
    if (openAfterStart) openBrowser(url);
    return;
  }

  const listener = await canConnect(port);
  if (listener) {
    console.error(\`端口 \${port} 已被占用。请修改 .env 里的 PORT，或先关闭占用该端口的程序。\`);
    process.exit(1);
  }

  const serverPath = path.join(root, "server.js");
  if (!fs.existsSync(serverPath)) {
    console.error("缺少 server.js，请确认运行的是完整发布包。");
    process.exit(1);
  }

  const logFd = fs.openSync(logFile, "a");
  const child = spawn(process.execPath, [serverPath], {
    cwd: root,
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env
  });
  child.unref();
  fs.writeFileSync(pidFile, \`\${child.pid}\\n\`, "utf8");
  fs.closeSync(logFd);

  const ready = await waitForPort(port, 20000);
  console.log(\`已启动：pid=\${child.pid}\`);
  console.log(\`地址：\${url}\`);
  console.log(\`日志：\${logFile}\`);
  printToolWarnings(env);
  if (ready && openAfterStart) openBrowser(url);
  if (!ready) console.log("服务仍在启动中；如果页面暂时打不开，请稍后再刷新。");
}

async function stop(options = {}) {
  const pid = readPid();
  if (!pid) {
    if (!options.quiet) console.log("没有找到后台服务 pid。");
    return;
  }

  if (!isRunning(pid)) {
    fs.rmSync(pidFile, { force: true });
    if (!options.quiet) console.log(\`后台服务已不在运行，已清理 pid：\${pid}\`);
    return;
  }

  signalProcess(pid, "SIGTERM");
  const stopped = await waitForStop(pid, 5000);
  if (!stopped) signalProcess(pid, "SIGKILL");
  fs.rmSync(pidFile, { force: true });
  if (!options.quiet) console.log(\`已停止后台服务：pid=\${pid}\`);
}

async function status(env) {
  const pid = readPid();
  const port = Number(env.PORT || 3000);
  const info = {
    pid,
    pidRunning: pid ? isRunning(pid) : false,
    port,
    reachable: await canConnect(port),
    url: buildUrl(port, env.APP_START_PATH || "/gross-margin"),
    styleLibrary: path.resolve(root, env.STYLE_LIBRARY_DIR || "./style-library"),
    logFile,
    opencli: resolveExecutable(env.OPENCLI_BIN || "opencli") || null,
    ffmpeg: resolveExecutable(env.FFMPEG_BIN || "ffmpeg") || null
  };
  console.log(JSON.stringify(info, null, 2));
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

function signalProcess(pid, signal) {
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
    if (!isRunning(pid)) return true;
    await delay(200);
  }
  return false;
}

async function waitForPort(port, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await canConnect(port)) return true;
    await delay(250);
  }
  return false;
}

function canConnect(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    socket.setTimeout(800);
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

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readDotEnv(file) {
  if (!fs.existsSync(file)) return {};
  const env = {};
  const lines = fs.readFileSync(file, "utf8").split(/\\r?\\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    env[match[1]] = unquoteEnv(match[2].trim());
  }
  return env;
}

function unquoteEnv(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

async function ensureDefaultEnvFile() {
  const target = path.join(root, ".env");
  if (fs.existsSync(target)) return;
  await fs.promises.writeFile(target, \`${minimalEnv().replace(/`/g, "\\`")}\`, "utf8");
}

function buildUrl(port, startPath) {
  const cleanPath = startPath && startPath.startsWith("/") ? startPath : \`/\${startPath || ""}\`;
  return \`http://localhost:\${port}\${cleanPath}\`;
}

function openBrowser(url) {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, { stdio: "ignore", detached: true });
  child.unref();
}

function printToolWarnings(env) {
  const opencli = resolveExecutable(env.OPENCLI_BIN || "opencli");
  const ffmpeg = resolveExecutable(env.FFMPEG_BIN || "ffmpeg");
  if (!opencli) console.log("提示：未检测到 opencli，采集和监控刷新不可用。可运行 install-deps 脚本安装。");
  if (!ffmpeg) console.log("提示：未检测到 ffmpeg，无字幕视频转写不可用。可运行 install-deps 脚本安装。");
}

function resolveExecutable(command) {
  if (!command) return "";
  if (command.includes("/") || command.includes("\\\\")) {
    const absolute = path.resolve(root, command);
    return fs.existsSync(absolute) ? absolute : fs.existsSync(command) ? command : "";
  }
  const pathList = (process.env.PATH || "").split(path.delimiter);
  const extensions = process.platform === "win32" ? ["", ".exe", ".cmd", ".bat"] : [""];
  for (const dir of pathList) {
    for (const extension of extensions) {
      const target = path.join(dir, \`\${command}\${extension}\`);
      if (fs.existsSync(target)) return target;
    }
  }
  return "";
}
`;
}

function releaseEnvExample() {
  return `${minimalEnv()}

# 可选：火山引擎录音文件识别 2.0，用于无字幕视频转写。
VOLCENGINE_ASR_API_KEY=
VOLCENGINE_ASR_RESOURCE_ID=volc.seedasr.auc
VOLCENGINE_ASR_SUBMIT_URL=https://openspeech.bytedance.com/api/v3/auc/bigmodel/submit
VOLCENGINE_ASR_QUERY_URL=https://openspeech.bytedance.com/api/v3/auc/bigmodel/query
VOLCENGINE_ASR_AUDIO_FORMAT=mp3
VOLCENGINE_ASR_POLL_INTERVAL_MS=1000
VOLCENGINE_ASR_MAX_POLL_ATTEMPTS=120
VOLCENGINE_ASR_REQUEST_TIMEOUT_MS=30000
VOLCENGINE_ASR_RETRY_COUNT=2
DOUYIN_TRANSCRIBE_CONCURRENCY=3

# 可选：文案、风格卡、评论生成等大模型能力。
# 数据维护监控不需要大模型；不填 API Key 也可以使用本地数据维护功能。
# CHAT_API_KEY=
# CHAT_BASE_URL=https://api.openai.com/v1
# CHAT_MODEL=
# CHAT_WIRE_API=auto
# CHAT_REASONING_EFFORT=none
# CHAT_PROXY_URL=

# 可选：封面图生成。
# IMAGE_API_KEY=
# IMAGE_BASE_URL=https://api.openai.com/v1
# IMAGE_MODEL=
# IMAGE_SIZE=2048x1152
# IMAGE_QUALITY=medium
# IMAGE_FORMAT=jpeg
# IMAGE_PROXY_URL=

# 可选：飞书文档发布。
FEISHU_OPENCLI_AS=user
FEISHU_FOLDER_TOKEN=
`;
}

function minimalEnv() {
  return `PORT=3000
APP_START_PATH=/gross-margin
OPENCLI_BIN=opencli
FFMPEG_BIN=ffmpeg
STYLE_LIBRARY_DIR=./style-library
`;
}

function releaseReadme() {
  return `# 账号风格库本地运行包

这是已经构建好的本地网页工具包，解压后可以直接在本机启动。

## 一键启动

macOS：

1. 首次使用先运行 \`install-deps.command\`，安装/检查 Node.js、opencli、ffmpeg。
2. 双击 \`start.command\` 启动，会自动打开 \`http://localhost:3000/gross-margin\`。
3. 停止服务运行 \`stop.command\`，查看状态运行 \`status.command\`。

终端：

\`\`\`bash
./install-deps.sh
./start.sh
./status.sh
./stop.sh
\`\`\`

Windows：

1. 请使用 \`.zip\` 压缩包，并先完整解压，不要在压缩包预览窗口里直接双击。
2. 首次使用运行 \`install-deps.cmd\`。
3. 双击 \`start.cmd\` 启动；如果浏览器没有自动打开，访问 \`http://localhost:3000/gross-margin\`。
4. 用 \`stop.cmd\` 停止服务，\`status.cmd\` 查看状态。

## 数据和配置

- 本地数据默认保存在包内 \`style-library\` 目录。
- 首次启动会自动生成 \`.env\`；需要改端口、模型、火山转写或飞书配置时，编辑 \`.env\`。
- 数据维护 / 数据监控不需要大模型，只需要 opencli 能抓到平台数据。
- 文案生成、风格提炼、评论生成、封面生成等能力才需要配置模型或图片 API Key。

## 常见问题

- 页面打不开：运行 \`status\` 脚本确认服务是否启动；也可以看 \`.runtime/server.log\`。
- 端口被占用：编辑 \`.env\`，把 \`PORT=3000\` 改成其他端口，例如 \`PORT=3010\`。
- B 站/抖音采集失败：先运行 \`opencli doctor\` 或重新执行 \`install-deps\`。
- 视频转写失败：确认已安装 \`ffmpeg\`，并在 \`.env\` 配置火山转写 API Key。
- macOS 无法双击打开：右键脚本，选择“打开”；或者在终端运行 \`./start.sh\`。
- Windows 双击无反应：先右键解压 \`.zip\` 到普通目录，再双击 \`start.cmd\`；窗口会保留错误信息，也可以查看 \`.runtime\\server.log\`。
`;
}

function versionText() {
  return [
    `name=${packageJson.name || ""}`,
    `version=${packageJson.version || ""}`,
    `builtAt=${new Date().toISOString()}`,
    `platform=${process.platform}`,
    `arch=${process.arch}`,
    `node=${process.version}`,
    `includeLibrary=${includeLibrary ? "true" : "false"}`,
    ""
  ].join("\n");
}

function exists(target) {
  return fs.promises.access(target).then(() => true, () => false);
}

function isWindowsLauncher(fileName) {
  return fileName.endsWith(".bat") || fileName.endsWith(".cmd");
}

function toCrLf(content) {
  return content.replace(/\r?\n/g, "\r\n");
}

function commandExists(command) {
  return new Promise((resolve) => {
    const child = spawn(command, ["--version"], {
      cwd: root,
      stdio: "ignore",
      shell: process.platform === "win32"
    });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || root,
      env: options.env || process.env,
      stdio: "inherit",
      shell: process.platform === "win32"
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
    });
  });
}
