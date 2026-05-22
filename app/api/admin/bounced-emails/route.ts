import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { supabaseAdmin } from "@/lib/supabase-admin";
import {
  sendConfirmationEmail,
  sendBackfillConfirmationEmail,
  sendMovedToPreferredEmail,
  sendStartingSoonEmail,
  sendNoSpotsFinalEmail,
  sendNoSpotsEmail,
  sendSessionMovedEmail,
  sendCancellationConfirmationEmail,
  sendSessionCancelledByAdminEmail,
  sendSubscribedEmail,
  sendNewSessionAvailableEmail,
  sendDayBeforeReminderEmail,
  sendThreeHoursReminderEmail,
  AlternativeInfo,
} from "@/lib/email";

function checkAuth(req: NextRequest): boolean {
  const pw = req.headers.get("x-admin-password");
  return !!process.env.ADMIN_PASSWORD && pw === process.env.ADMIN_PASSWORD;
}

export async function GET(req: NextRequest) {
  if (!checkAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const resend = new Resend(process.env.RESEND_API_KEY);
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data: logs } = await supabaseAdmin
    .from("email_logs")
    .select("*")
    .gte("sent_at", since)
    .order("sent_at", { ascending: false });

  if (!logs?.length) {
    return NextResponse.json({ bounced: [] });
  }

  const bounced: unknown[] = [];

  for (const log of logs) {
    try {
      const { data: emailData } = await resend.emails.get(log.resend_email_id);
      if (emailData?.last_event === "bounced") {
        bounced.push({ ...log, resend_last_event: emailData.last_event });
      }
    } catch {
      // skip — ID may be expired or not found
    }
  }

  return NextResponse.json({ bounced });
}

export async function POST(req: NextRequest) {
  if (!checkAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { log_id } = await req.json();
  if (!log_id) {
    return NextResponse.json({ error: "Missing log_id" }, { status: 400 });
  }

  const { data: log } = await supabaseAdmin
    .from("email_logs")
    .select("*")
    .eq("id", log_id)
    .single();

  if (!log) {
    return NextResponse.json({ error: "Log entry not found" }, { status: 404 });
  }

  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "";

  try {
    await resendByType(log, baseUrl);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("Resend failed:", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

type EmailLog = {
  id: string;
  email_type: string;
  booking_id: string | null;
  to_email: string;
  to_name: string;
  extra: Record<string, unknown> | null;
};

async function resendByType(log: EmailLog, baseUrl: string): Promise<void> {
  const { email_type, booking_id, to_email, to_name, extra } = log;

  switch (email_type) {
    case "confirmation":
    case "backfill_confirmation": {
      if (!booking_id) throw new Error("Missing booking_id for confirmation resend");
      const { data: booking } = await supabaseAdmin
        .from("bookings")
        .select("id, full_name, sessions(date, start_time, end_time, location, room)")
        .eq("id", booking_id)
        .single();
      if (!booking) throw new Error("Booking not found");
      const session = (booking as unknown as { sessions: { date: string; start_time: string; end_time: string; location: string; room: string | null } }).sessions;
      const { data: alts } = await supabaseAdmin
        .from("bookings")
        .select("preference_order, sessions(date, start_time, end_time, location, room)")
        .eq("email", to_email)
        .eq("status", "pending")
        .neq("id", booking_id)
        .order("preference_order", { ascending: true });
      const alternatives: AlternativeInfo[] = (alts ?? []).map((a: unknown) => {
        const row = a as { preference_order: number | null; sessions: { date: string; start_time: string; end_time: string; location: string; room: string | null } | null };
        if (!row.sessions) return null;
        return { preference_order: row.preference_order, ...row.sessions } as AlternativeInfo;
      }).filter((x): x is AlternativeInfo => x !== null);

      if (email_type === "backfill_confirmation") {
        await sendBackfillConfirmationEmail(to_email, to_name, booking_id, session, baseUrl, alternatives);
      } else {
        await sendConfirmationEmail(to_email, to_name, booking_id, session, baseUrl, alternatives);
      }
      break;
    }

    case "moved_to_preferred": {
      if (!booking_id) throw new Error("Missing booking_id for moved_to_preferred resend");
      const oldSessionId = (extra?.old_session_id as string) ?? null;
      if (!oldSessionId) throw new Error("Missing extra.old_session_id");
      const { data: booking } = await supabaseAdmin
        .from("bookings")
        .select("sessions(date, start_time, end_time, location, room)")
        .eq("id", booking_id)
        .single();
      if (!booking) throw new Error("Booking not found");
      const newSession = (booking as unknown as { sessions: { date: string; start_time: string; end_time: string; location: string; room: string | null } }).sessions;
      const { data: oldSession } = await supabaseAdmin
        .from("sessions")
        .select("date, start_time, end_time, location, room")
        .eq("id", oldSessionId)
        .single();
      if (!oldSession) throw new Error("Old session not found");
      await sendMovedToPreferredEmail(to_email, to_name, booking_id, oldSession, newSession, baseUrl);
      break;
    }

    case "starting_soon": {
      if (!booking_id) throw new Error("Missing booking_id for starting_soon resend");
      const { data: booking } = await supabaseAdmin
        .from("bookings")
        .select("sessions(date, start_time, end_time, location, room)")
        .eq("id", booking_id)
        .single();
      if (!booking) throw new Error("Booking not found");
      const session = (booking as unknown as { sessions: { date: string; start_time: string; end_time: string; location: string; room: string | null } }).sessions;
      await sendStartingSoonEmail(to_email, to_name, session);
      break;
    }

    case "reminder_24h": {
      if (!booking_id) throw new Error("Missing booking_id for reminder_24h resend");
      const { data: booking } = await supabaseAdmin
        .from("bookings")
        .select("session_id, sessions(date, start_time, end_time, location, room)")
        .eq("id", booking_id)
        .single();
      if (!booking) throw new Error("Booking not found");
      const session = (booking as unknown as { sessions: { date: string; start_time: string; end_time: string; location: string; room: string | null } }).sessions;
      const sessionId = (booking as unknown as { session_id: string }).session_id;
      const { count } = await supabaseAdmin
        .from("bookings")
        .select("*", { count: "exact", head: true })
        .eq("session_id", sessionId)
        .eq("status", "confirmed");
      await sendDayBeforeReminderEmail(to_email, to_name, booking_id, session, baseUrl, (count ?? 0) >= 3);
      break;
    }

    case "reminder_3h": {
      if (!booking_id) throw new Error("Missing booking_id for reminder_3h resend");
      const { data: booking } = await supabaseAdmin
        .from("bookings")
        .select("session_id, sessions(date, start_time, end_time, location, room)")
        .eq("id", booking_id)
        .single();
      if (!booking) throw new Error("Booking not found");
      const session = (booking as unknown as { sessions: { date: string; start_time: string; end_time: string; location: string; room: string | null } }).sessions;
      const sessionId = (booking as unknown as { session_id: string }).session_id;
      const { count } = await supabaseAdmin
        .from("bookings")
        .select("*", { count: "exact", head: true })
        .eq("session_id", sessionId)
        .eq("status", "confirmed");
      await sendThreeHoursReminderEmail(to_email, to_name, session, (count ?? 0) >= 3);
      break;
    }

    case "no_spots":
      await sendNoSpotsEmail(to_email, to_name, baseUrl);
      break;

    case "no_spots_final":
      await sendNoSpotsFinalEmail(to_email, to_name, baseUrl);
      break;

    case "moved": {
      if (!booking_id) throw new Error("Missing booking_id for moved resend");
      const oldSessionId = (extra?.old_session_id as string) ?? null;
      const newSessionId = (extra?.new_session_id as string) ?? null;
      if (!oldSessionId || !newSessionId) throw new Error("Missing extra session IDs");
      const { data: oldSession } = await supabaseAdmin
        .from("sessions")
        .select("date, start_time, end_time, location, room")
        .eq("id", oldSessionId)
        .single();
      const { data: newSession } = await supabaseAdmin
        .from("sessions")
        .select("date, start_time, end_time, location, room")
        .eq("id", newSessionId)
        .single();
      if (!oldSession || !newSession) throw new Error("Session(s) not found");
      await sendSessionMovedEmail(to_email, to_name, booking_id, oldSession, newSession, baseUrl);
      break;
    }

    case "cancellation_confirmation": {
      const session = extra?.session as { date: string; start_time: string; end_time: string; location: string; room: string | null } | null;
      if (!session) throw new Error("Missing extra.session for cancellation_confirmation");
      await sendCancellationConfirmationEmail(to_email, to_name, session, baseUrl);
      break;
    }

    case "cancelled_by_admin": {
      const cancelledSession = extra?.cancelled_session as { date: string; start_time: string; end_time: string; location: string; room: string | null } | null;
      const movedToSession = (extra?.moved_to_session as { date: string; start_time: string; end_time: string; location: string; room: string | null } | null) ?? null;
      const newBookingId = (extra?.booking_id as string | null) ?? null;
      if (!cancelledSession) throw new Error("Missing extra.cancelled_session");
      await sendSessionCancelledByAdminEmail({
        email: to_email,
        fullName: to_name,
        cancelledSession,
        movedToSession,
        bookingId: newBookingId,
        baseUrl,
      });
      break;
    }

    case "subscribed": {
      const unsubscribeToken = (extra?.unsubscribe_token as string) ?? null;
      if (!unsubscribeToken) throw new Error("Missing extra.unsubscribe_token");
      await sendSubscribedEmail(to_email, to_name, unsubscribeToken, baseUrl);
      break;
    }

    case "new_session_available": {
      const session = extra?.session as { date: string; start_time: string; end_time: string; location: string; room: string | null } | null;
      const unsubscribeToken = (extra?.unsubscribe_token as string) ?? null;
      if (!session || !unsubscribeToken) throw new Error("Missing extra fields for new_session_available");
      await sendNewSessionAvailableEmail({ email: to_email, fullName: to_name, session, unsubscribeToken, baseUrl });
      break;
    }

    default:
      throw new Error(`Unknown email_type: ${email_type}`);
  }
}
