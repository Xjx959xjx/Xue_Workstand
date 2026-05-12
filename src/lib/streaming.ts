export type StreamEvent =
  | { type: "stage"; stage: string; message: string; progress?: number }
  | { type: "delta"; delta: string }
  | { type: "result"; data: unknown }
  | { type: "error"; message: string }
  | { type: "done" };

function encodeEvent(event: StreamEvent) {
  return new TextEncoder().encode(`${JSON.stringify(event)}\n`);
}

export function createNdjsonStream(
  handler: (emit: (event: StreamEvent) => void) => Promise<void>
) {
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: StreamEvent) => {
        controller.enqueue(encodeEvent(event));
      };

      try {
        await handler(emit);
        emit({ type: "done" });
      } catch (error) {
        emit({
          type: "error",
          message: error instanceof Error ? error.message : "请求处理失败"
        });
      } finally {
        controller.close();
      }
    }
  });
}

