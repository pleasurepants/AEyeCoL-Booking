import { NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { localNow, localTodayStr, localTomorrowStr } from "@/lib/timezone";
import { sendDayBeforeReminderEmail } from "@/lib/email";
import { logEmail } from "@/lib/email-log";

export async function GET() {
  return handleReminder();
}

export async function POST() {
  return handleReminder();
}

async function handleReminder() {
  const now = localNow();
  const todayStr = localTodayStr();
  const tomorrowStr = localTomorrowStr();

  const loMs = 23 * 60 * 60 * 1000 + 30 * 60 * 1000;
  const hiMs = 24 * 60 * 60 * 1000 + 30 * 60 * 1000;
  const loTime = new Date(now.getTime() + loMs);
  const hiTime = new Date(now.getTime() + hiMs);
  const pad = (d: Date) => d.toISOString().split("T")[1].substring(0, 8);

  const candidates: { date: string; loT: string; hiT: string }[] = [];

  if (loTime.toISOString().split("T")[0] === hiTime.toISOString().split("T")[0]) {
    const dateStr = loTime.getDate() === now.getDate() ? todayStr : tomorrowStr;
    candidates.push({ date: dateStr, loT: pad(loTime), hiT: pad(hiTime) });
  } else {
    candidates.push({ date: todayStr, loT: pad(loTime), hiT: "23:59:59" });
    candidates.push({ date: tomorrowStr, loT: "00:00:00", hiT: pad(hiTime) });
  }

  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "";
  let sent = 0;

  for (const c of candidates) {
    const { data: sessions } = await supabase
      .from("sessions")
      .select("id, date, start_time, end_time, location, room")
      .eq("date", c.date)
      .eq("status", "upcoming")
      .gte("start_time", c.loT)
      .lte("start_time", c.hiT);

    if (!sessions?.length) continue;

    for (const session of sessions) {
      const { data: bookings } = await supabase
        .from("bookings")
        .select("id, email, full_name")
        .eq("session_id", session.id)
        .eq("status", "confirmed");

      if (!bookings?.length) continue;
      const isConfirmed = bookings.length >= 3;

      for (const b of bookings) {
        try {
          const emailId = await sendDayBeforeReminderEmail(
            b.email,
            b.full_name,
            b.id,
            session,
            baseUrl,
            isConfirmed
          );
          if (emailId) await logEmail(emailId, {
            emailType: "reminder_24h",
            bookingId: b.id,
            toEmail: b.email,
            toName: b.full_name,
          });
          sent++;
        } catch { /* skip failed email */ }
      }
    }
  }

  return NextResponse.json({ ok: true, sent, checked_at: now.toISOString() });
}
