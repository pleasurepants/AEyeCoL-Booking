import { NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { localNow, localTodayStr } from "@/lib/timezone";
import { sendThreeHoursReminderEmail } from "@/lib/email";
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

  const lo = new Date(now.getTime() + 2 * 60 * 60 * 1000 + 45 * 60 * 1000);
  const hi = new Date(now.getTime() + 3 * 60 * 60 * 1000 + 15 * 60 * 1000);
  const pad = (d: Date) => d.toISOString().split("T")[1].substring(0, 8);
  const loTime = pad(lo);
  const hiTime = pad(hi);

  const { data: sessions } = await supabase
    .from("sessions")
    .select("id, date, start_time, end_time, location, room")
    .eq("date", todayStr)
    .eq("status", "upcoming")
    .gte("start_time", loTime)
    .lte("start_time", hiTime);

  if (!sessions?.length) {
    return NextResponse.json({ ok: true, sent: 0, message: "No sessions starting in ~3 hours" });
  }

  let sent = 0;

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
        const emailId = await sendThreeHoursReminderEmail(
          b.email,
          b.full_name,
          session,
          isConfirmed
        );
        if (emailId) await logEmail(emailId, {
          emailType: "reminder_3h",
          bookingId: b.id,
          toEmail: b.email,
          toName: b.full_name,
        });
        sent++;
      } catch { /* skip failed email */ }
    }
  }

  return NextResponse.json({ ok: true, sent });
}
