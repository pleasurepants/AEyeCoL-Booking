import { NextResponse } from "next/server";
import { localNow, localTodayStr } from "@/lib/timezone";

export async function GET() {
  const tz = process.env.TIMEZONE || "(not set, using UTC)";
  const now = localNow();
  const utcNow = new Date();

  const testSession = { date: localTodayStr(), start_time: "15:30:00" };
  const start = new Date(`${testSession.date}T${testSession.start_time}`);
  const diffMs = start.getTime() - now.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);

  return NextResponse.json({
    TIMEZONE_env: tz,
    utc_now: utcNow.toISOString(),
    local_now: now.toISOString(),
    local_today: localTodayStr(),
    test_session: testSession,
    test_start_parsed: start.toISOString(),
    diff_hours: diffHours.toFixed(2),
    within_3h: diffMs > 0 && diffMs <= 3 * 60 * 60 * 1000,
  });
}
