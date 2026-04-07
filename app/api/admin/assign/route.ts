import { NextRequest, NextResponse } from "next/server";
import { runBatchAssignment } from "@/lib/assign";

export async function POST(req: NextRequest) {
  // Verify cron secret for automated calls, or allow if called from admin UI
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  const isFromCron =
    cronSecret && authHeader === `Bearer ${cronSecret}`;

  // For admin UI calls, no extra auth needed (already behind password prompt)
  // For cron calls, verify the secret
  const isCronCall = req.headers.get("x-vercel-cron") === "true";
  if (isCronCall && !isFromCron) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const baseUrl =
    req.headers.get("x-forwarded-proto") && req.headers.get("host")
      ? `${req.headers.get("x-forwarded-proto")}://${req.headers.get("host")}`
      : req.nextUrl.origin;

  // Default to tomorrow's date
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const targetDate =
    req.nextUrl.searchParams.get("date") ??
    tomorrow.toISOString().split("T")[0];

  const confirmedCount = await runBatchAssignment(targetDate, baseUrl);

  return NextResponse.json({ ok: true, confirmed_count: confirmedCount, date: targetDate });
}

// Vercel cron calls GET by default
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const baseUrl =
    req.headers.get("x-forwarded-proto") && req.headers.get("host")
      ? `${req.headers.get("x-forwarded-proto")}://${req.headers.get("host")}`
      : req.nextUrl.origin;

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const targetDate = tomorrow.toISOString().split("T")[0];

  const confirmedCount = await runBatchAssignment(targetDate, baseUrl);

  return NextResponse.json({ ok: true, confirmed_count: confirmedCount, date: targetDate });
}
