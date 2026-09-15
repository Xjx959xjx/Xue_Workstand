import { fetch as undiciFetch, ProxyAgent, FormData } from "undici";

export function imageConfig() {
  return {
    apiKey: process.env.IMAGE_API_KEY || process.env.OPENAI_API_KEY || "",
    baseUrl: (process.env.IMAGE_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, ""),
    model: process.env.IMAGE_MODEL || "gpt-image-2",
    size: process.env.IMAGE_SIZE || "2048x1152",
    quality: process.env.IMAGE_QUALITY || "medium",
    format: normalizeImageFormat(process.env.IMAGE_FORMAT),
    proxyUrl: process.env.IMAGE_PROXY_URL || process.env.CHAT_PROXY_URL || ""
  };
}

function normalizeImageFormat(value?: string): "jpeg" | "png" | "webp" {
  return value === "png" || value === "webp" ? value : "jpeg";
}

export async function callImageApi(input: {
  config: ReturnType<typeof imageConfig>;
  prompt: string;
  referenceFiles: Array<{ name: string; bytes: Buffer; contentType: string }>;
  signal?: AbortSignal;
}) {
  if (!input.config.apiKey) throw new Error("未配置 IMAGE_API_KEY，无法生成图片。");
  const timeout = AbortSignal.timeout(300_000);
  const signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout;
  const dispatcher = input.config.proxyUrl ? new ProxyAgent(input.config.proxyUrl) : undefined;
  try {
    signal.throwIfAborted();
    const params = { model: input.config.model, prompt: input.prompt, size: input.config.size, quality: input.config.quality, output_format: input.config.format, n: 1 };
    const editing = input.referenceFiles.length > 0;
    const form = new FormData();
    if (editing) {
      for (const [key, value] of Object.entries(params)) form.set(key, String(value));
      for (const file of input.referenceFiles) {
        form.append("image[]", new Blob([new Uint8Array(file.bytes)], { type: file.contentType }), file.name);
      }
    }
    const response = await undiciFetch(`${input.config.baseUrl}${editing ? "/images/edits" : "/images/generations"}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${input.config.apiKey}`, ...(!editing ? { "Content-Type": "application/json" } : {}) },
      body: editing ? form : JSON.stringify(params), signal, dispatcher
    });
    if (!response.ok) {
      // Do not persist provider response bodies: relays may echo credentials or request contents.
      await response.body?.cancel();
      if (response.status === 401 || response.status === 403) throw new Error("图片模型鉴权失败，请检查密钥及该模型的使用权限。");
      if (response.status === 429) throw new Error("图片服务限流或额度不足，请检查余额后重试。");
      if (response.status === 400 || response.status === 404 || response.status === 422) throw new Error(`图片服务拒绝请求（${response.status}），请确认模型名、尺寸、质量及参考图接口是否受支持。`);
      throw new Error(`图片服务返回错误（${response.status}），请稍后重试或检查中转服务状态。`);
    }
    const data = await response.json() as { data?: Array<{ b64_json?: string; url?: string }> };
    const first = data.data?.[0];
    if (first?.b64_json) {
      if (first.b64_json.length > 56 * 1024 * 1024) throw new Error("模型返回图片超过 40MB，请降低图片尺寸。");
      return Buffer.from(first.b64_json, "base64");
    }
    if (first?.url) {
      const url = new URL(first.url);
      if (!/^https?:$/.test(url.protocol)) throw new Error("图片服务返回的下载地址无效。");
      const remote = await undiciFetch(url, { signal, dispatcher });
      if (!remote.ok) { await remote.body?.cancel(); throw new Error(`下载生成图片失败（${remote.status}），请检查中转服务。`); }
      const bytes = Buffer.from(await remote.arrayBuffer());
      if (bytes.length > 40 * 1024 * 1024) throw new Error("模型返回图片超过 40MB，请降低图片尺寸。");
      return bytes;
    }
    throw new Error("图片模型没有返回可保存的图片，请检查中转服务响应。");
  } catch (error) {
    if (input.signal?.aborted) throw input.signal.reason;
    if (timeout.aborted) throw new Error("图片生成超过 5 分钟，请检查服务状态后重试。");
    if (error instanceof TypeError || error instanceof SyntaxError) throw new Error("图片服务连接失败或响应无效，请检查服务地址、代理设置和网络。");
    throw error;
  } finally {
    await dispatcher?.close();
  }
}
