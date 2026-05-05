import { NextRequest, NextResponse } from "next/server";
import { cancelUndersubscribedSessions } from "@/lib/cleanup";

function getBaseUrl(req: NextRequest) {
  return req.headers.get("x-forwarded-proto") && req.headers.get("host")
    ? `${req.headers.get("x-forwarded-proto")}://${req.headers.get("host")}`
    : req.nextUrl.origin;
}

async function run(req: NextRequest) {
  const baseUrl = getBaseUrl(req);
  const result = await cancelUndersubscribedSessions(baseUrl);
  return NextResponse.json({ ok: true, ...result });
}

export async function GET(req: NextRequest) {
  return run(req);
}

export async function POST(req: NextRequest) {
  return run(req);
}
