import {
  authenticateBridgeRequest,
  formatCapabilityBridgeError,
  getCapabilityBridgeStatus,
  handleCapabilityBridgePost
} from "@/lib/capability-bridge";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const authorization = request.headers.get("authorization") || "";
    if (!authorization) {
      return Response.json({ ok: false, error: "需要远程能力服务令牌。" }, {
        status: 401,
        headers: { "cache-control": "no-store" }
      });
    }
    authenticateBridgeRequest(request);
    return Response.json({ ok: true, ...getCapabilityBridgeStatus() }, {
      headers: { "cache-control": "no-store" }
    });
  } catch (error) {
    return bridgeErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const result = await handleCapabilityBridgePost(request);
    return Response.json(result, {
      headers: { "cache-control": "no-store" }
    });
  } catch (error) {
    return bridgeErrorResponse(error);
  }
}

function bridgeErrorResponse(error: unknown) {
  const formatted = formatCapabilityBridgeError(error);
  return Response.json({ error: formatted.error }, {
    status: formatted.status,
    headers: { "cache-control": "no-store" }
  });
}
