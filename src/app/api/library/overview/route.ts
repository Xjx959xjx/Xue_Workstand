import { NextResponse } from "next/server";
import { getLibraryOverview } from "@/lib/storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(await getLibraryOverview());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "读取风格库概览失败" },
      { status: 500 }
    );
  }
}
