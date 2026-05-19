import { NextResponse } from "next/server";
import { z } from "zod";
import { getGrossMarginLibrary, saveGrossMarginPriceTable } from "@/lib/storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const platformSchema = z.enum(["douyin", "bilibili"]);
const serviceSchema = z.enum(["play", "like", "douPlus", "coin", "comment", "share", "favorite", "danmaku", "blueLink"]);
const amountSchema = z.coerce.number().finite().min(0, "金额不能小于 0").max(100_000_000, "金额过大，请检查输入");
const minimumQuantitySchema = z.coerce.number().finite().gt(0, "起量必须大于 0").max(100_000_000, "起量过大，请检查输入");

const mutationSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("savePriceTable"),
    platform: platformSchema,
    items: z.array(
      z.object({
        id: z.string().min(1, "单价项缺少 ID"),
        service: serviceSchema,
        name: z.string().trim().min(1, "请填写单价项名称").max(40, "单价项名称太长"),
        unitPrice: amountSchema,
        quantityUnit: z.string().trim().min(1, "请填写数量单位").max(12, "数量单位太长"),
        minimumQuantity: minimumQuantitySchema.optional(),
        note: z.string().trim().max(120, "备注太长").optional()
      })
    )
  })
]);

export async function GET() {
  try {
    return NextResponse.json(await getGrossMarginLibrary());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "读取毛利单价表失败" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const input = mutationSchema.parse(await request.json());
    const table = await saveGrossMarginPriceTable(input);
    return NextResponse.json({ table, library: await getGrossMarginLibrary() });
  } catch (error) {
    return NextResponse.json(
      { error: formatGrossMarginError(error) },
      { status: 400 }
    );
  }
}

function formatGrossMarginError(error: unknown) {
  if (error instanceof z.ZodError) {
    return error.issues[0]?.message || "毛利单价表参数不完整或格式不正确。";
  }

  return error instanceof Error ? error.message : "保存毛利单价表失败";
}
