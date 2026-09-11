type RemoteCapabilityOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
};

export const REMOTE_CAPABILITY_OPERATIONS = [
  "opencli",
  "material-analysis",
  "transcribe-video",
  "transcribe-link",
  "link-media",
  "link-download",
  "feishu-publish",
  "feishu-doc-read",
  "wecom-doc"
] as const;

export type RemoteCapabilityOperation = typeof REMOTE_CAPABILITY_OPERATIONS[number];

export type RemoteCapabilityProbe = {
  ok: boolean;
  configured: boolean;
  operations: string[];
  missingOperations: string[];
  message: string;
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

export async function probeRemoteCapabilityBridge(options: {
  signal?: AbortSignal;
  timeoutMs?: number;
  requiredOperations?: readonly RemoteCapabilityOperation[];
} = {}): Promise<RemoteCapabilityProbe> {
  const url = capabilityUrl();
  const token = capabilityToken();
  const requiredOperations = [...(options.requiredOperations || REMOTE_CAPABILITY_OPERATIONS)];
  if (!url || !token) {
    return {
      ok: false,
      configured: false,
      operations: [],
      missingOperations: requiredOperations,
      message: !url
        ? "未配置 SITES_EXTERNAL_CAPABILITY_URL"
        : "未配置 SITES_EXTERNAL_CAPABILITY_TOKEN"
    };
  }

  try {
    assertSecureCapabilityUrl(url);
  } catch (error) {
    return {
      ok: false,
      configured: true,
      operations: [],
      missingOperations: requiredOperations,
      message: error instanceof Error ? error.message : "远程能力服务地址无效"
    };
  }

  const controller = new AbortController();
  const timeoutMs = Math.max(1000, Math.min(options.timeoutMs || 5000, 30_000));
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const forwardAbort = () => controller.abort();
  options.signal?.addEventListener("abort", forwardAbort, { once: true });

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token}`
      },
      signal: controller.signal
    });
    const text = await response.text();
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      return failedProbe(requiredOperations, describeNonJsonCapabilityResponse(response.status, text));
    }
    if (!response.ok) {
      const detail = readErrorMessage(body) || `HTTP ${response.status}`;
      return failedProbe(requiredOperations, `远程能力服务探测失败：${detail}`);
    }

    const record = body && typeof body === "object" ? body as Record<string, unknown> : {};
    const operations = Array.isArray(record.operations)
      ? [...new Set(record.operations.filter((value): value is string => typeof value === "string"))]
      : [];
    if (record.ok !== true || !operations.length) {
      return failedProbe(requiredOperations, "远程能力服务健康响应无效，缺少 ok 或 operations。");
    }
    const missingOperations = requiredOperations.filter((operation) => !operations.includes(operation));
    return {
      ok: missingOperations.length === 0,
      configured: true,
      operations,
      missingOperations,
      message: missingOperations.length
        ? `远程能力服务缺少操作：${missingOperations.join("、")}`
        : `远程能力服务可用（${operations.length} 项操作）`
    };
  } catch (error) {
    if (options.signal?.aborted) {
      return failedProbe(requiredOperations, "远程能力服务探测已取消。");
    }
    return failedProbe(
      requiredOperations,
      timedOut
        ? `远程能力服务探测超时（${Math.round(timeoutMs / 1000)} 秒）`
        : `远程能力服务不可达：${error instanceof Error ? error.message : "网络请求失败"}`
    );
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", forwardAbort);
  }
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
      throw new Error(describeNonJsonCapabilityResponse(response.status, text));
    }
    if (!response.ok) {
      const message = readErrorMessage(body) || `HTTP ${response.status}`;
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

function failedProbe(requiredOperations: readonly string[], message: string): RemoteCapabilityProbe {
  return {
    ok: false,
    configured: true,
    operations: [],
    missingOperations: [...requiredOperations],
    message
  };
}

function readErrorMessage(value: unknown) {
  return value && typeof value === "object" && "error" in value && typeof value.error === "string"
    ? value.error
    : "";
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

function describeNonJsonCapabilityResponse(status: number, text: string) {
  // 仅提取基础设施错误编号，避免把上游 HTML、令牌或请求详情带回客户端。
  const code = text.match(/(?:error\s*(?:code)?|code)\s*[:=]?\s*(1\d{3})\b/i)?.[1];
  const suffix = code ? `，上游错误 ${code}` : "";
  const hint = status === 530 ? "。请检查云端到能力服务的 DNS 解析、公网入口和端口连通性。" : "。";
  return `远程能力服务返回非 JSON 响应（HTTP ${status}${suffix}）${hint}`;
}
