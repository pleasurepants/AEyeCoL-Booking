import { NextResponse } from "next/server";
import { Resend } from "resend";
import { supabase } from "@/lib/supabase";
import { localNow, localTodayStr, localTomorrowStr } from "@/lib/timezone";

function fmtDate(d: string) {
  return new Date(d + "T00:00:00").toLocaleDateString("en-US", {
    year: "numeric", month: "long", day: "numeric", weekday: "long",
  });
}
function fmtTime(t: string) { const [h, m] = t.split(":"); return `${h}:${m}`; }
function locStr(location: string, room: string | null) {
  return room ? `${location}, ${room}` : location;
}

export async function GET() {
  return handleCheck();
}

export async function POST() {
  return handleCheck();
}

async function handleCheck() {
  const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
  const sender = process.env.FROM_EMAIL;
  if (!resend || !sender) {
    return NextResponse.json({ error: "Email not configured" }, { status: 500 });
  }

  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "";
  let dayBeforeSent = 0;
  let threeHourSent = 0;

  /* ── Day-before reminders: sessions happening tomorrow ── */
  const tomorrowStr = localTomorrowStr();
  const { data: tomorrowSessions } = await supabase
    .from("sessions")
    .select("id, date, start_time, end_time, location, room")
    .eq("date", tomorrowStr)
    .eq("status", "upcoming");

  for (const session of tomorrowSessions ?? []) {
    const { data: bookings } = await supabase
      .from("bookings")
      .select("id, email, full_name")
      .eq("session_id", session.id)
      .eq("status", "confirmed");

    if (!bookings?.length) continue;
    const dateStr = fmtDate(session.date);

    for (const b of bookings) {
      const cancelUrl = `${baseUrl}/cancel?token=${b.id}`;
      try {
        await resend.emails.send({
          from: sender,
          to: b.email,
          subject: `Reminder: Your study session is tomorrow`,
          html: `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 520px; margin: 0 auto; color: #1f2937;">
              <h2 style="color: #111827; margin-bottom: 4px;">Session Reminder</h2>
              <p style="color: #6b7280; margin-top: 0;">Hi ${b.full_name}, this is a friendly reminder that your study session is <strong>tomorrow</strong>.</p>
              <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
                <tr><td style="padding: 8px 0; color: #6b7280; width: 100px;">Date</td><td style="padding: 8px 0; color: #111827; font-weight: 500;">${dateStr}</td></tr>
                <tr><td style="padding: 8px 0; color: #6b7280;">Time</td><td style="padding: 8px 0; color: #111827; font-weight: 500;">${fmtTime(session.start_time)} – ${fmtTime(session.end_time)}</td></tr>
                <tr><td style="padding: 8px 0; color: #6b7280;">Location</td><td style="padding: 8px 0; color: #111827; font-weight: 500;">${locStr(session.location, session.room)}</td></tr>
              </table>
              <p style="margin: 24px 0 8px; color: #6b7280; font-size: 14px;">Can no longer make it? Cancel below:</p>
              <a href="${cancelUrl}" style="display: inline-block; background: #dc2626; color: #fff; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 500;">Cancel Booking</a>
              <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 32px 0 16px;" />
              <p style="color: #9ca3af; font-size: 13px; margin: 0;">Best regards,<br /><strong style="color: #6b7280;">AEyeCoL Research Team</strong></p>
            </div>`,
        });
        dayBeforeSent++;
      } catch { /* skip failed email */ }
    }
  }

  /* ── Three-hours reminders: sessions starting in ~3h ── */
  const now = localNow();
  const todayStr = localTodayStr();

  const lo = new Date(now.getTime() + 2 * 60 * 60 * 1000 + 45 * 60 * 1000);
  const hi = new Date(now.getTime() + 3 * 60 * 60 * 1000 + 15 * 60 * 1000);
  const pad = (d: Date) => d.toISOString().split("T")[1].substring(0, 8);

  const { data: soonSessions } = await supabase
    .from("sessions")
    .select("id, date, start_time, end_time, location, room")
    .eq("date", todayStr)
    .eq("status", "upcoming")
    .gte("start_time", pad(lo))
    .lte("start_time", pad(hi));

  for (const session of soonSessions ?? []) {
    const { data: bookings } = await supabase
      .from("bookings")
      .select("id, email, full_name")
      .eq("session_id", session.id)
      .eq("status", "confirmed");

    if (!bookings?.length) continue;
    const dateStr = fmtDate(session.date);

    for (const b of bookings) {
      try {
        await resend.emails.send({
          from: sender,
          to: b.email,
          subject: `Your study session starts in 3 hours`,
          html: `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 520px; margin: 0 auto; color: #1f2937;">
              <h2 style="color: #111827; margin-bottom: 4px;">Starting Soon!</h2>
              <p style="color: #6b7280; margin-top: 0;">Hi ${b.full_name}, your study session starts in approximately <strong>3 hours</strong>.</p>
              <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
                <tr><td style="padding: 8px 0; color: #6b7280; width: 100px;">Date</td><td style="padding: 8px 0; color: #111827; font-weight: 500;">${dateStr}</td></tr>
                <tr><td style="padding: 8px 0; color: #6b7280;">Time</td><td style="padding: 8px 0; color: #111827; font-weight: 500;">${fmtTime(session.start_time)} – ${fmtTime(session.end_time)}</td></tr>
                <tr><td style="padding: 8px 0; color: #6b7280;">Location</td><td style="padding: 8px 0; color: #111827; font-weight: 500;">${locStr(session.location, session.room)}</td></tr>
              </table>
              <p style="color: #374151; line-height: 1.6;">Please make sure to arrive on time. We look forward to seeing you!</p>
              <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 32px 0 16px;" />
              <p style="color: #9ca3af; font-size: 13px; margin: 0;">Best regards,<br /><strong style="color: #6b7280;">AEyeCoL Research Team</strong></p>
            </div>`,
        });
        threeHourSent++;
      } catch { /* skip failed email */ }
    }
  }

  return NextResponse.json({
    ok: true,
    day_before_sent: dayBeforeSent,
    three_hour_sent: threeHourSent,
    checked_at: now.toISOString(),
    tomorrow: tomorrowStr,
    today: todayStr,
  });
}
