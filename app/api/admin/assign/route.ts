import { NextRequest, NextResponse } from "next/server";
import { runNightlyAssignment } from "@/lib/assign";

function getBaseUrl(req: NextRequest) {
  return req.headers.get("x-forwarded-proto") && req.headers.get("host")
    ? `${req.headers.get("x-forwarded-proto")}://${req.headers.get("host")}`
    : req.nextUrl.origin;
}

export async function POST(req: NextRequest) {
  const baseUrl = getBaseUrl(req);
  const result = await runNightlyAssignment(baseUrl);

  return NextResponse.json({
    ok: true,
    confirmed: result.confirmed,
    no_spots: result.no_spots,
  });
}

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const baseUrl = getBaseUrl(req);
  const result = await runNightlyAssignment(baseUrl);

  return NextResponse.json({
    ok: true,
    confirmed: result.confirmed,
    no_spots: result.no_spots,
  });
}
