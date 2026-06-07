import { createReadStream } from "fs";
import { promises as fs } from "fs";
import { Readable } from "stream";
import { z } from "zod";
import { apiError, parseJsonBody } from "@/lib/api-route";
import { createUrlPreprocessor } from "@/lib/link-input";
import { prepareLinkSourceDownload, type LinkSourceDownloadAsset } from "@/lib/transcription";

export const runtime = "nodejs";

const schema = z.object({
  url: z.preprocess(createUrlPreprocessor({ kind: "video" }), z.string().url()),
  kind: z.enum(["video", "cover", "audio"])
});

export async function POST(request: Request) {
  try {
    const input = await parseJsonBody(request, schema);
    const asset = await prepareLinkSourceDownload(input);

    if (asset.remoteUrl) {
      return await proxyRemoteAsset(asset);
    }

    if (asset.filePath) {
      return streamLocalAsset(asset);
    }

    throw new Error("没有生成可下载文件。");
  } catch (error) {
    return apiError(error, {
      fallbackMessage: "下载失败"
    });
  }
}

async function proxyRemoteAsset(asset: LinkSourceDownloadAsset) {
  if (!asset.remoteUrl) throw new Error("缺少远程文件地址。");
  const response = await fetch(asset.remoteUrl, {
    headers: asset.requestHeaders,
    redirect: "follow"
  });
  if (!response.ok) {
    throw new Error(`远程文件下载失败：HTTP ${response.status}`);
  }

  const headers = buildDownloadHeaders(asset, response.headers);
  if (!response.body) {
    return new Response(new Uint8Array(await response.arrayBuffer()), { headers });
  }

  return new Response(response.body, { headers });
}

function streamLocalAsset(asset: LinkSourceDownloadAsset) {
  if (!asset.filePath) throw new Error("缺少本地文件路径。");
  const fileStream = createReadStream(asset.filePath);
  const cleanup = () => {
    void cleanupDownloadAsset(asset.cleanupTargets || [asset.filePath || ""]);
  };
  fileStream.once("close", cleanup);
  fileStream.once("error", cleanup);

  return new Response(Readable.toWeb(fileStream) as ReadableStream, {
    headers: buildDownloadHeaders(asset)
  });
}

function buildDownloadHeaders(asset: LinkSourceDownloadAsset, upstreamHeaders?: Headers) {
  const headers = new Headers({
    "Content-Type": upstreamHeaders?.get("content-type") || asset.contentType,
    "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(asset.fileName)}`,
    "Cache-Control": "no-store"
  });
  const contentLength = upstreamHeaders?.get("content-length");
  if (contentLength) headers.set("Content-Length", contentLength);
  return headers;
}

async function cleanupDownloadAsset(targets: string[]) {
  await Promise.all(
    [...new Set(targets.filter(Boolean))].map((target) =>
      fs.rm(target, { recursive: true, force: true }).catch(() => undefined)
    )
  );
}
