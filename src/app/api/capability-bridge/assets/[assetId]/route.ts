import { createReadStream } from "fs";
import { Readable } from "stream";
import {
  cleanupCapabilityBridgeAsset,
  formatCapabilityBridgeError,
  takeCapabilityBridgeAsset
} from "@/lib/capability-bridge";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ assetId: string }> }
) {
  try {
    const { assetId } = await params;
    const asset = await takeCapabilityBridgeAsset(assetId, request.headers.get("authorization"));
    const fileStream = createReadStream(asset.filePath);
    const cleanup = () => {
      void cleanupCapabilityBridgeAsset(asset);
    };
    fileStream.once("close", cleanup);
    fileStream.once("error", cleanup);

    return new Response(Readable.toWeb(fileStream) as ReadableStream, {
      headers: {
        "content-type": asset.contentType,
        "content-length": String(asset.byteLength),
        "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(asset.fileName)}`,
        "cache-control": "private, no-store, max-age=0",
        "x-content-type-options": "nosniff"
      }
    });
  } catch (error) {
    const formatted = formatCapabilityBridgeError(error);
    return Response.json({ error: formatted.error }, {
      status: formatted.status,
      headers: { "cache-control": "no-store" }
    });
  }
}
