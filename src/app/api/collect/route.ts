import { NextResponse } from "next/server";
import { z } from "zod";
import { collectVideos, resolveAccountUid } from "@/lib/opencli";
import { findAccountByName, getAccountSummary, saveVideos, upsertAccount } from "@/lib/storage";
import { platforms, Video } from "@/lib/types";
import { nowIso } from "@/lib/utils";

export const runtime = "nodejs";

const schema = z.object({
  platform: z.enum(platforms),
  name: z.string().min(1),
  uidOrUrl: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  order: z.enum(["pubdate", "click", "stow"]).default("click"),
  fromDate: z.string().optional(),
  toDate: z.string().optional()
});

export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());
    const existing = !input.uidOrUrl ? await findAccountByName(input.platform, input.name) : null;
    const uid = existing?.uid || (await resolveAccountUid(input.platform, input.name, input.uidOrUrl));
    const account = await upsertAccount({
      platform: input.platform,
      name: input.name,
      uid,
      sourceUrl: input.uidOrUrl || input.name
    });

    const result = await collectVideos({
      platform: input.platform,
      account,
      limit: input.limit,
      order: input.order
    });

    const updatedAccount = await upsertAccount({
      platform: input.platform,
      name: input.name,
      uid,
      sourceUrl: input.uidOrUrl || input.name,
      lastCollectedAt: nowIso()
    });

    const filteredVideos = filterVideosByDate(result.videos, input.fromDate, input.toDate);
    const videos = await saveVideos(updatedAccount, filteredVideos);

    return NextResponse.json({
      account: await getAccountSummary(updatedAccount),
      videos,
      command: result.command,
      rawCount: result.rawCount,
      filteredCount: filteredVideos.length
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "采集失败" },
      { status: 400 }
    );
  }
}

function filterVideosByDate(videos: Video[], fromDate?: string, toDate?: string) {
  const from = parseBoundaryDate(fromDate, "start");
  const to = parseBoundaryDate(toDate, "end");
  if (!from && !to) return videos;

  return videos.filter((video) => {
    const publishedAt = parsePublishedAt(video.publishedAt);
    if (!publishedAt) return false;
    if (from && publishedAt < from) return false;
    if (to && publishedAt > to) return false;
    return true;
  });
}

function parseBoundaryDate(value: string | undefined, boundary: "start" | "end") {
  if (!value) return null;
  const date = new Date(`${value}T${boundary === "start" ? "00:00:00" : "23:59:59"}`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parsePublishedAt(value: string | undefined) {
  if (!value) return null;
  const normalized = value.trim();
  if (!normalized) return null;

  const dateOnly = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (dateOnly) {
    const [, year, month, day] = dateOnly;
    return new Date(Number(year), Number(month) - 1, Number(day));
  }

  const numeric = Number(normalized);
  if (Number.isFinite(numeric) && numeric > 0) {
    return new Date(numeric > 10_000_000_000 ? numeric : numeric * 1000);
  }

  const date = new Date(normalized.replace(" ", "T"));
  return Number.isNaN(date.getTime()) ? null : date;
}
