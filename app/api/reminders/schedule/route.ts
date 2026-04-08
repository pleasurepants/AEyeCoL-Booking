import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const { password } = await req.json();
  if (password !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const qstashToken = process.env.QSTASH_TOKEN;
  if (!qstashToken) {
    return NextResponse.json({ error: "QSTASH_TOKEN not configured" }, { status: 500 });
  }

  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (!baseUrl) {
    return NextResponse.json({ error: "NEXT_PUBLIC_SITE_URL not configured" }, { status: 500 });
  }

  const qstashUrl = process.env.QSTASH_URL || "https://qstash.upstash.io";
  const results: { name: string; ok: boolean; error?: string }[] = [];

  // Schedule 1: day-before reminders — every day at 09:00 UTC
  try {
    const res = await fetch(`${qstashUrl}/v2/schedules`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${qstashToken}`,
        "Content-Type": "application/json",
        "Upstash-Cron": "0 9 * * *",
      },
      body: JSON.stringify({ destination: `${baseUrl}/api/reminders/day-before` }),
    });
    if (!res.ok) {
      const text = await res.text();
      results.push({ name: "day-before", ok: false, error: text });
    } else {
      results.push({ name: "day-before", ok: true });
    }
  } catch (e) {
    results.push({ name: "day-before", ok: false, error: String(e) });
  }

  // Schedule 2: three-hours reminders — every hour at :00
  try {
    const res = await fetch(`${qstashUrl}/v2/schedules`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${qstashToken}`,
        "Content-Type": "application/json",
        "Upstash-Cron": "0 * * * *",
      },
      body: JSON.stringify({ destination: `${baseUrl}/api/reminders/three-hours` }),
    });
    if (!res.ok) {
      const text = await res.text();
      results.push({ name: "three-hours", ok: false, error: text });
    } else {
      results.push({ name: "three-hours", ok: true });
    }
  } catch (e) {
    results.push({ name: "three-hours", ok: false, error: String(e) });
  }

  const allOk = results.every((r) => r.ok);
  return NextResponse.json({ ok: allOk, schedules: results }, { status: allOk ? 200 : 500 });
}
