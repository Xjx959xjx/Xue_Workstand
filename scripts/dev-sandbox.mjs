import { spawn } from "node:child_process";
import path from "node:path";

// 显式覆盖 .env，隔离资料与桥接凭证；不启动公网能力网关。
const env = {
  ...process.env,
  WORKSPACE_DEV_SANDBOX: "1",
  STYLE_LIBRARY_DIR: path.resolve(".dev-sandbox/library"),
  SITES_STORAGE_MODE: "",
  SITES_RUNTIME: "",
  SITES_WORKSPACE_SOURCE: "",
  SITES_EXTERNAL_CAPABILITY_URL: "",
  SITES_EXTERNAL_CAPABILITY_TOKEN: "",
  SITES_CAPABILITY_BRIDGE_TOKEN: "",
  SITES_CAPABILITY_BRIDGE_PUBLIC_URL: "",
  APP_MODE: "workspace",
  PORT: "3002"
};
console.log("隔离开发：http://127.0.0.1:3002；资料保存在 .dev-sandbox/library，不读写正式资料库。模型调用仍可能消耗已配置的额度。");
const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--turbopack", "--hostname", "127.0.0.1", "--port", "3002"], { env, stdio: "inherit" });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("error", error => { console.error(`隔离开发启动失败：${error.message}`); process.exitCode = 1; });
child.on("exit", code => { process.exitCode = code ?? 1; });
