import { NextResponse } from "next/server";

async function setupSchedules() {
  const qstashToken = process.env.QSTASH_TOKEN;
  if (!qstashToken) {
    return NextResponse.json({ error: "QSTASH_TOKEN not configured" }, { status: 500 });
  }

  let baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "";
  if (!baseUrl) {
    return NextResponse.json({ error: "NEXT_PUBLIC_SITE_URL not configured" }, { status: 500 });
  }
  if (!baseUrl.startsWith("http://") && !baseUrl.startsWith("https://")) {
    baseUrl = `https://${baseUrl}`;
  }
  baseUrl = baseUrl.replace(/\/+$/, "");

  const qstashUrl = process.env.QSTASH_URL || "https://qstash.upstash.io";
  const results: { name: string; ok: boolean; error?: string }[] = [];

  const schedules = [
    { name: "day-before", cron: "0 * * * *", path: "/api/reminders/day-before" },
    { name: "three-hours", cron: "0 * * * *", path: "/api/reminders/three-hours" },
  ];

  for (const s of schedules) {
    try {
      const destination = `${baseUrl}${s.path}`;
      const res = await fetch(`${qstashUrl}/v2/schedules/${destination}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${qstashToken}`,
          "Upstash-Cron": s.cron,
        },
      });
      if (!res.ok) {
        const text = await res.text();
        results.push({ name: s.name, ok: false, error: text });
      } else {
        results.push({ name: s.name, ok: true });
      }
    } catch (e) {
      results.push({ name: s.name, ok: false, error: String(e) });
    }
  }

  const allOk = results.every((r) => r.ok);
  return NextResponse.json({ ok: allOk, baseUrl, schedules: results }, { status: allOk ? 200 : 500 });
}

export async function GET() {
  return setupSchedules();
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (body?.password && body.password !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return setupSchedules();
}
