import { NextResponse } from "next/server";
import { z } from "zod";

type ApiResponseOptions = {
  fallbackMessage: string;
  status?: number;
  formatError?: (error: unknown, fallbackMessage: string) => string;
};

export async function apiJson<T>(
  run: () => Promise<T> | T,
  options: ApiResponseOptions
) {
  try {
    return NextResponse.json(await run());
  } catch (error) {
    return apiError(error, options);
  }
}

export function apiError(error: unknown, options: ApiResponseOptions) {
  return NextResponse.json(
    { error: options.formatError?.(error, options.fallbackMessage) ?? formatApiError(error, options.fallbackMessage) },
    { status: error instanceof z.ZodError ? 400 : options.status ?? 400 }
  );
}

export async function parseJsonBody<TSchema extends z.ZodTypeAny>(
  request: Request,
  schema: TSchema
): Promise<z.infer<TSchema>> {
  return schema.parse(await request.json());
}

export function formatApiError(error: unknown, fallbackMessage: string) {
  if (error instanceof z.ZodError) {
    return formatZodError(error) || fallbackMessage;
  }
  return error instanceof Error && error.message.trim() ? error.message : fallbackMessage;
}

function formatZodError(error: z.ZodError) {
  const issue = error.issues[0];
  if (!issue) return "";

  const path = issue.path.join(".");
  if (issue.code === "invalid_string" && issue.validation === "url") {
    return "链接格式不正确，请粘贴完整的 http(s) 地址。";
  }
  if (path.endsWith("url") || path.endsWith("mediaUrl") || path.endsWith("videoUrl")) {
    return "链接格式不正确，请粘贴完整的 http(s) 地址。";
  }
  if (issue.code === "invalid_type") {
    return "请求参数不完整或格式不正确。";
  }
  if (issue.message && !/^(Invalid|Required)\b/i.test(issue.message)) {
    return issue.message;
  }
  return "请求参数不完整或格式不正确。";
}
