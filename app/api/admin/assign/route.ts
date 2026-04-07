import { NextRequest, NextResponse } from "next/server";
import { runBatchAssignment } from "@/lib/assign";

function getBaseUrl(req: NextRequest) {
  return req.headers.get("x-forwarded-proto") && req.headers.get("host")
    ? `${req.headers.get("x-forwarded-proto")}://${req.headers.get("host")}`
    : req.nextUrl.origin;
}

function getTodayStr() {
  return new Date().toISOString().split("T")[0];
}

export async function POST(req: NextRequest) {
  const baseUrl = getBaseUrl(req);
  const targetDate = req.nextUrl.searchParams.get("date") ?? getTodayStr();
  const result = await runBatchAssignment(targetDate, baseUrl);

  return NextResponse.json({
    ok: true,
    confirmed_count: result.confirmed,
    notified_count: result.notified,
    date: targetDate,
  });
}

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const baseUrl = getBaseUrl(req);
  const targetDate = getTodayStr();
  const result = await runBatchAssignment(targetDate, baseUrl);

  return NextResponse.json({
    ok: true,
    confirmed_count: result.confirmed,
    notified_count: result.notified,
    date: targetDate,
  });
}
