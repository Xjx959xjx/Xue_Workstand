type RemoteCapabilityOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
};

function capabilityUrl() {
  return process.env.SITES_EXTERNAL_CAPABILITY_URL?.trim() || "";
}

function capabilityToken() {
  return process.env.SITES_EXTERNAL_CAPABILITY_TOKEN?.trim() || "";
}

export function hasRemoteCapabilityBridge() {
  return Boolean(capabilityUrl() && capabilityToken());
}

export async function callRemoteCapability<T>(
  operation: string,
  payload: unknown,
  options: RemoteCapabilityOptions = {}
): Promise<T> {
  const url = capabilityUrl();
  if (!url) {
    throw new Error(`Sites 云端未配置远程能力服务，无法执行「${operation}」。请设置 SITES_EXTERNAL_CAPABILITY_URL。`);
  }
  const token = capabilityToken();
  if (!token) {
    throw new Error(`Sites 云端未配置远程能力令牌，无法执行「${operation}」。请设置 SITES_EXTERNAL_CAPABILITY_TOKEN。`);
  }
  assertSecureCapabilityUrl(url);

  const controller = new AbortController();
  const timeoutMs = Math.max(1000, options.timeoutMs || 120_000);
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const forwardAbort = () => controller.abort();
  options.signal?.addEventListener("abort", forwardAbort, { once: true });

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ operation, payload }),
      signal: controller.signal
    });
    const text = await response.text();
    let body: unknown = {};
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(`远程能力服务返回了无法解析的响应（${response.status}）。`);
    }
    if (!response.ok) {
      const message = body && typeof body === "object" && "error" in body && typeof body.error === "string"
        ? body.error
        : `HTTP ${response.status}`;
      throw new Error(`远程能力「${operation}」调用失败：${message}`);
    }
    return body as T;
  } catch (error) {
    if (options.signal?.aborted) throw error;
    if (controller.signal.aborted) throw new Error(`远程能力「${operation}」调用超时（${Math.round(timeoutMs / 1000)} 秒）。`);
    throw error;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", forwardAbort);
  }
}

function assertSecureCapabilityUrl(value: string) {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("SITES_EXTERNAL_CAPABILITY_URL 不是有效 URL。");
  }
  const localHost = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]";
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && localHost)) {
    throw new Error("SITES_EXTERNAL_CAPABILITY_URL 必须使用 HTTPS；只有 localhost 调试允许 HTTP。");
  }
}
