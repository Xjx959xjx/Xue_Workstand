import { NextResponse } from "next/server";
import { z } from "zod";
import { cancelJob, getJob } from "@/lib/jobs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await params;
    return NextResponse.json({ job: await getJob(jobId) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "读取任务失败" },
      { status: 404 }
    );
  }
}

const patchSchema = z.object({
  action: z.literal("cancel")
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const input = patchSchema.parse(await request.json());
    const { jobId } = await params;
    if (input.action !== "cancel") {
      throw new Error("不支持的任务操作");
    }
    return NextResponse.json({ job: await cancelJob(jobId) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "停止任务失败" },
      { status: 400 }
    );
  }
}
