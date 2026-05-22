import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { tryConfirm } from "@/lib/assign";
import {
  sendSessionCancelledByAdminEmail,
  sendNewSessionAvailableEmail,
  sendSlotUnlockedEmail,
} from "@/lib/email";
import { logEmail } from "@/lib/email-log";

function sanitizeSupervisors(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    if (typeof raw !== "string") continue;
    const v = raw.trim();
    if (!v) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

function getBaseUrl(req: NextRequest) {
  return req.headers.get("x-forwarded-proto") && req.headers.get("host")
    ? `${req.headers.get("x-forwarded-proto")}://${req.headers.get("host")}`
    : req.nextUrl.origin;
}

export async function POST(req: NextRequest) {
  const body = await req.json();

  const supervisors = sanitizeSupervisors(body.supervisors);

  const { data, error } = await supabase.from("sessions").insert({
    date: body.date,
    start_time: body.start_time,
    end_time: body.end_time,
    location: body.location,
    room: body.room ?? null,
    max_participants: body.max_participants,
    notes: body.notes ?? null,
    supervisors,
  }).select();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const created = Array.isArray(data) ? data[0] : null;
  const baseUrl = getBaseUrl(req);

  // Notify subscribers (best-effort; never block session creation).
  try {
    if (created) await notifySubscribersOfNewSession(created, baseUrl);
  } catch (e) {
    console.error("Failed to notify subscribers:", e);
  }

  // Notify pending users who already have bookings on this date.
  try {
    if (created) await notifyPendingUsersForDate(created, baseUrl);
  } catch (e) {
    console.error("Failed to notify pending users:", e);
  }

  return NextResponse.json({ data });
}

async function notifySubscribersOfNewSession(
  session: {
    date: string;
    start_time: string;
    end_time: string;
    location: string;
    room: string | null;
  },
  baseUrl: string
) {
  const { data: subs } = await supabaseAdmin
    .from("subscribers")
    .select("email, full_name, unsubscribe_token");

  if (!subs?.length) return;

  for (const s of subs) {
    try {
      const emailId = await sendNewSessionAvailableEmail({
        email: s.email,
        fullName: s.full_name,
        session,
        unsubscribeToken: s.unsubscribe_token,
        baseUrl,
      });
      if (emailId) await logEmail(emailId, {
        emailType: "new_session_available",
        toEmail: s.email,
        toName: s.full_name ?? "",
        extra: { session, unsubscribe_token: s.unsubscribe_token },
      });
    } catch { /* one failed email shouldn't stop the others */ }
  }
}

export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { id, status } = body;

  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  const hasStatus = typeof status === "string" && status.length > 0;
  const hasSupervisors = Object.prototype.hasOwnProperty.call(body, "supervisors");

  if (!hasStatus && !hasSupervisors) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  // If cancelling, free all bookings in this session, then try to promote
  // each affected person into one of their remaining (backup) preferences.
  if (hasStatus && status === "cancelled") {
    await cancelSessionAndPromote(id, getBaseUrl(req));
  }

  const update: Record<string, unknown> = {};
  if (hasStatus) update.status = status;
  if (hasSupervisors) update.supervisors = sanitizeSupervisors(body.supervisors);

  const { error } = await supabase
    .from("sessions")
    .update(update)
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

// Shared flow for admin-cancelling or deleting a session: for every confirmed
// participant, delete their booking on the cancelled session, then run
// tryConfirm against their remaining pending preferences. Send a single email
// informing them of the cancellation AND whether they were moved to a backup.
async function cancelSessionAndPromote(sessionId: string, baseUrl: string) {
  const { data: cancelledSession } = await supabase
    .from("sessions")
    .select("date, start_time, end_time, location, room")
    .eq("id", sessionId)
    .single();
  if (!cancelledSession) return;

  const { data: confirmedBookings } = await supabase
    .from("bookings")
    .select("id, email, full_name")
    .eq("session_id", sessionId)
    .eq("status", "confirmed");

  // Collect pending-only emails too, so they get notified the session is gone.
  const { data: pendingBookings } = await supabase
    .from("bookings")
    .select("id, email, full_name")
    .eq("session_id", sessionId)
    .eq("status", "pending");

  // Delete all bookings tied to this session (confirmed + pending on it).
  await supabase.from("bookings").delete().eq("session_id", sessionId);

  const seen = new Set<string>();

  // First, handle confirmed people: try to upgrade each via their remaining
  // pending preferences.
  for (const b of confirmedBookings ?? []) {
    if (seen.has(b.email)) continue;
    seen.add(b.email);

    const result = await tryConfirm(b.email, baseUrl, true);

    let movedToSession: {
      date: string; start_time: string; end_time: string; location: string; room: string | null;
    } | null = null;
    let newBookingId: string | null = null;

    if (result.confirmedId) {
      const { data: newBooking } = await supabase
        .from("bookings")
        .select("id, sessions(date, start_time, end_time, location, room)")
        .eq("id", result.confirmedId)
        .single();
      const s = (newBooking as unknown as {
        sessions: {
          date: string; start_time: string; end_time: string; location: string; room: string | null;
        } | null;
      } | null)?.sessions ?? null;
      movedToSession = s;
      newBookingId = result.confirmedId;
    }

    // tryConfirm already sends its own confirmation email for the new slot,
    // but the participant still needs to be told WHY (session cancelled). Send
    // a dedicated cancellation notice that references the backup placement.
    try {
      const emailId = await sendSessionCancelledByAdminEmail({
        email: b.email,
        fullName: b.full_name,
        cancelledSession,
        movedToSession,
        bookingId: newBookingId,
        baseUrl,
      });
      if (emailId) await logEmail(emailId, {
        emailType: "cancelled_by_admin",
        toEmail: b.email,
        toName: b.full_name,
        extra: {
          cancelled_session: cancelledSession,
          moved_to_session: movedToSession ?? null,
          booking_id: newBookingId,
        },
      });
    } catch { /* don't block if email fails */ }
  }

  // Then, handle people who were only pending on this session (never confirmed
  // anywhere because this session was part of their picks). tryConfirm does
  // nothing useful for them because their row is already deleted; just send a
  // "session cancelled, please book again" notice.
  for (const b of pendingBookings ?? []) {
    if (seen.has(b.email)) continue;
    seen.add(b.email);

    // Do NOT send to people who still have a confirmed booking elsewhere — they
    // don't need a cancellation notice.
    const { count } = await supabase
      .from("bookings")
      .select("*", { count: "exact", head: true })
      .eq("email", b.email)
      .eq("status", "confirmed");
    if ((count ?? 0) > 0) continue;

    try {
      const emailId = await sendSessionCancelledByAdminEmail({
        email: b.email,
        fullName: b.full_name,
        cancelledSession,
        movedToSession: null,
        bookingId: null,
        baseUrl,
      });
      if (emailId) await logEmail(emailId, {
        emailType: "cancelled_by_admin",
        toEmail: b.email,
        toName: b.full_name,
        extra: {
          cancelled_session: cancelledSession,
          moved_to_session: null,
          booking_id: null,
        },
      });
    } catch { /* don't block if email fails */ }
  }
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Missing session id" }, { status: 400 });
  }

  // Notify participants and promote backups (also deletes the bookings rows).
  await cancelSessionAndPromote(id, getBaseUrl(req));

  const { error } = await supabase
    .from("sessions")
    .delete()
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

async function notifyPendingUsersForDate(
  session: { id: string; date: string; start_time: string; end_time: string; location: string; room: string | null },
  baseUrl: string
) {
  // Find all sessions on the same date (excluding the newly created one).
  const { data: sameDaySessions } = await supabaseAdmin
    .from("sessions")
    .select("id")
    .eq("date", session.date)
    .neq("id", session.id);

  if (!sameDaySessions?.length) return;

  const sameDayIds = sameDaySessions.map((s) => s.id);

  // Find unique pending users on those sessions who aren't confirmed anywhere.
  const { data: pendingRows } = await supabaseAdmin
    .from("bookings")
    .select("email, full_name")
    .in("session_id", sameDayIds)
    .eq("status", "pending");

  if (!pendingRows?.length) return;

  const { data: confirmedRows } = await supabaseAdmin
    .from("bookings")
    .select("email")
    .eq("status", "confirmed");
  const confirmedSet = new Set((confirmedRows ?? []).map((b) => b.email));

  const seen = new Set<string>();
  for (const b of pendingRows) {
    if (seen.has(b.email)) continue;
    seen.add(b.email);
    if (confirmedSet.has(b.email)) continue;
    try {
      await sendSlotUnlockedEmail(b.email, b.full_name, session, baseUrl);
    } catch { /* non-fatal */ }
  }
}
