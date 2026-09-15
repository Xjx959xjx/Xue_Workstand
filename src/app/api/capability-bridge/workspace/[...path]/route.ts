import { authenticateBridgeRequest, formatCapabilityBridgeError } from "@/lib/capability-bridge";
import { relayWorkspaceRequest, workspaceApiPath } from "@/lib/workspace-bridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handle(request: Request) {
  try {
    if (process.env.SITES_STORAGE_MODE === "cloud" || process.env.SITES_RUNTIME === "cloud") {
      return Response.json({ error: "资料桥仅允许在本机运行。" }, { status: 503 });
    }
    authenticateBridgeRequest(request);
    const url = new URL(request.url);
    const prefix = "/api/capability-bridge/workspace/";
    const apiPath = workspaceApiPath(`/api/${url.pathname.slice(prefix.length)}`);
    const port = Number(process.env.PORT || 3000);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("本机服务端口配置无效。");
    return await relayWorkspaceRequest(request, `http://127.0.0.1:${port}${apiPath}${url.search}`);
  } catch (error) {
    const formatted = formatCapabilityBridgeError(error);
    return Response.json({ error: formatted.error }, { status: formatted.status, headers: { "cache-control": "no-store" } });
  }
}

export { handle as GET, handle as HEAD, handle as POST, handle as PUT, handle as PATCH, handle as DELETE, handle as OPTIONS };
