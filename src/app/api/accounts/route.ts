import { NextResponse } from "next/server";
import { z } from "zod";
import { deleteAccounts, findAccountByName, getAccountDetail, getAccountSummary, upsertAccount } from "@/lib/storage";
import { platforms } from "@/lib/types";
import { resolveAccountUid } from "@/lib/opencli";

export const runtime = "nodejs";

const schema = z.object({
  platform: z.enum(platforms),
  name: z.string().min(1),
  uidOrUrl: z.string().optional(),
  sourceUrl: z.string().optional()
});

const deleteSchema = z.object({
  accountIds: z.array(z.string().min(1)).min(1)
});

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const input = z.object({
      platform: z.enum(platforms),
      accountId: z.string().min(1)
    }).parse({
      platform: searchParams.get("platform"),
      accountId: searchParams.get("accountId")
    });
    return NextResponse.json(
      await getAccountDetail(input.platform, input.accountId, {
        includeStyle: parseBooleanFlag(searchParams.get("includeStyle"))
      })
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "读取账号详情失败" },
      { status: 400 }
    );
  }
}

function parseBooleanFlag(value: string | null) {
  return value === "1" || value === "true";
}

export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());
    const existing = !input.uidOrUrl ? await findAccountByName(input.platform, input.name) : null;
    if (existing) return NextResponse.json(await getAccountSummary(existing));

    const uid = await resolveAccountUid(input.platform, input.name, input.uidOrUrl);
    const account = await upsertAccount({
      platform: input.platform,
      name: input.name,
      uid,
      sourceUrl: input.sourceUrl || input.uidOrUrl || input.name
    });

    return NextResponse.json(await getAccountSummary(account));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "保存账号失败" },
      { status: 400 }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const input = deleteSchema.parse(await request.json());
    return NextResponse.json(await deleteAccounts(input.accountIds));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "删除账号失败" },
      { status: 400 }
    );
  }
}
