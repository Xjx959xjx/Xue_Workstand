import { z } from "zod";
import { apiJson, parseJsonBody } from "@/lib/api-route";
import {
  addDouyinHotlistAccount,
  getDouyinHotlist,
  refreshDouyinHotlist,
  removeDouyinHotlistAccount
} from "@/lib/douyin-hotlist";

export const runtime = "nodejs";

const getSchema = z.object({
  windowDays: z.coerce.number().int().min(1).max(14).optional(),
  window: z.string().optional()
});

const postSchema = z.object({
  action: z.enum(["addAccount", "removeAccount", "refresh"]),
  query: z.string().optional(),
  accountId: z.string().optional(),
  accountIds: z.array(z.string()).optional(),
  limit: z.coerce.number().int().min(1).max(120).optional(),
  windowDays: z.coerce.number().int().min(1).max(14).optional(),
  window: z.string().optional()
});

export async function GET(request: Request) {
  return apiJson(async () => {
    const { searchParams } = new URL(request.url);
    const input = getSchema.parse({
      windowDays: searchParams.get("windowDays") || undefined,
      window: searchParams.get("window") || undefined
    });
    return getDouyinHotlist({
      windowDays: input.windowDays,
      windowKey: input.window
    });
  }, {
    fallbackMessage: "读取抖音热榜失败"
  });
}

export async function POST(request: Request) {
  return apiJson(async () => {
    const input = await parseJsonBody(request, postSchema);

    if (input.action === "addAccount") {
      return addDouyinHotlistAccount({
        query: z.string().min(1, "请输入抖音账号名、主页链接或 sec_uid。").parse(input.query),
        signal: request.signal
      });
    }

    if (input.action === "removeAccount") {
      return removeDouyinHotlistAccount(
        z.string().min(1, "缺少要移除的账号。").parse(input.accountId)
      );
    }

    return refreshDouyinHotlist({
      accountIds: input.accountIds,
      limit: input.limit,
      windowDays: input.windowDays,
      windowKey: input.window,
      signal: request.signal
    });
  }, {
    fallbackMessage: "更新抖音热榜失败"
  });
}
