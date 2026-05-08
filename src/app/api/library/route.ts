import { NextResponse } from "next/server";
import { getLibrary } from "@/lib/storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(await getLibrary());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "读取风格库失败" },
      { status: 500 }
    );
  }
}
