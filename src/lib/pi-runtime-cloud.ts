import { callRemoteCapability } from "./remote-capabilities";

export async function piImageConfigured() { return false; }

export async function runPiImage(): Promise<Buffer> {
  throw new Error("订阅生图暂仅支持本机工作台，请在本机打开生图页面，或选择中转来源");
}
import { piResultSchema, piStatusSchema, type PiRequest, type PiOptions, type PiResult, type PiStatus } from "./pi-runtime";

export async function runPiModel(input: PiRequest, options: PiOptions = {}): Promise<PiResult> {
  const result = piResultSchema.parse(await callRemoteCapability("pi-model", input, { signal: options.signal, timeoutMs: 300_000 }));
  options.onDelta?.(result.text);
  return result;
}

export async function getPiStatus(): Promise<PiStatus> {
  return piStatusSchema.parse(await callRemoteCapability("pi-status", {}, { timeoutMs: 5000 }));
}
