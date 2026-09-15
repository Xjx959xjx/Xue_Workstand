const requestHeaders = ["accept", "content-type", "range", "if-range", "if-none-match", "if-modified-since"];
const responseHeaders = ["content-type", "content-disposition", "content-range", "accept-ranges", "etag", "last-modified", "retry-after"];

export function usesLocalWorkspace() {
  return (process.env.SITES_STORAGE_MODE === "cloud" || process.env.SITES_RUNTIME === "cloud") &&
    process.env.SITES_WORKSPACE_SOURCE === "local";
}

export function workspaceApiPath(pathname: string) {
  if (!pathname.startsWith("/api/")) throw new Error("资料桥仅支持工作台 API。");
  const segments = pathname.slice(5).split("/").map(segment => decodeURIComponent(segment));
  if (segments.some(segment => !segment || segment === "." || segment === ".." || /[\\/%\u0000?#]/.test(segment)) || segments[0] === "capability-bridge") {
    throw new Error("资料桥路径不合法，或请求形成循环。");
  }
  return `/api/${segments.map(encodeURIComponent).join("/")}`;
}

export async function relayWorkspaceRequest(request: Request, target: string, token?: string) {
  const headers = new Headers();
  for (const name of requestHeaders) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  if (token) headers.set("authorization", `Bearer ${token}`);
  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  const init: RequestInit & { duplex?: "half" } = {
    method: request.method, headers, signal: request.signal, redirect: "manual",
    ...(hasBody && request.body ? { body: request.body, duplex: "half" } : {})
  };
  const response = await fetch(target, init);
  // 不跟随跳转，不向其他地址传播桥接凭证；保留业务错误、二进制与 NDJSON 流。
  if (response.status >= 300 && response.status < 400 && response.status !== 304) {
    await response.body?.cancel();
    return Response.json({ error: "本机资料接口返回了跳转，请检查本机运行模式。" }, { status: 502 });
  }
  const forwarded = new Headers({ "cache-control": "no-store", "x-workspace-source": "local" });
  for (const name of responseHeaders) {
    const value = response.headers.get(name);
    if (value) forwarded.set(name, value);
  }
  return new Response(response.body, { status: response.status, headers: forwarded });
}

export async function proxyToLocalWorkspace(request: Request) {
  try {
    const source = new URL(request.url);
    const apiPath = workspaceApiPath(source.pathname);
    const bridgeUrl = process.env.SITES_EXTERNAL_CAPABILITY_URL?.trim();
    const token = process.env.SITES_EXTERNAL_CAPABILITY_TOKEN?.trim();
    if (!bridgeUrl || !token) throw new Error("未配置本机资料桥地址或令牌。");
    const bridge = new URL(bridgeUrl);
    if (bridge.protocol !== "https:") throw new Error("本机资料桥必须使用 HTTPS。");
    bridge.pathname = `${bridge.pathname.replace(/\/$/, "")}/workspace/${apiPath.slice(5)}`;
    bridge.search = source.search;
    return await relayWorkspaceRequest(request, bridge.href, token);
  } catch {
    return Response.json({ error: "无法连接本机资料库，请保持 Mac 在线并通过 dev:daemon 启动工作台与桥接。" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
