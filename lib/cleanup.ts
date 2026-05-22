import { supabaseAdmin as supabase } from "./supabase-admin";
import { localNow } from "./timezone";
import {
  sendSessionMovedEmail,
  sendSessionCancelledByAdminEmail,
} from "./email";
import { logEmail } from "./email-log";

const MIN_PARTICIPANTS = 3;

interface SessionRow {
  id: string;
  date: string;
  start_time: string;
  end_time: string;
  location: string;
  room: string | null;
  max_participants: number;
  status: string;
}

interface BookingRow {
  id: string;
  email: string;
  full_name: string;
  status: string;
  session_id: string;
}

function startMs(s: { date: string; start_time: string }): number {
  return new Date(`${s.date}T${s.start_time}`).getTime();
}

function plusDaysStr(base: Date, days: number): string {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${da}`;
}

interface CleanupResult {
  cancelled_sessions: number;
  participants_moved: number;
  participants_dropped: number;
}

/**
 * For each `upcoming` session whose date is exactly 2 days from today: if
 * fewer than 3 confirmed participants are registered, cancel the session and
 * try to move each participant into a session TWO DAYS LATER (e.g. Wed → Fri)
 * that already has 1 or 2 confirmed people (so the move helps that session
 * reach the 3-person minimum). Sessions go up to `max_participants`
 * (typically 4) — the post-move count may not exceed that. Glasses constraint
 * is intentionally NOT enforced here: filling the session is the priority.
 */
export async function cancelUndersubscribedSessions(
  baseUrl: string
): Promise<CleanupResult> {
  const now = localNow();
  const targetDate = plusDaysStr(now, 2);

  const { data: targetSessions } = await supabase
    .from("sessions")
    .select("id, date, start_time, end_time, location, room, max_participants, status")
    .eq("date", targetDate)
    .eq("status", "upcoming");

  if (!targetSessions?.length) {
    return { cancelled_sessions: 0, participants_moved: 0, participants_dropped: 0 };
  }

  let cancelled = 0;
  let moved = 0;
  let dropped = 0;

  for (const session of targetSessions as SessionRow[]) {
    const { data: confirmedBookings } = await supabase
      .from("bookings")
      .select("id, email, full_name, status, session_id")
      .eq("session_id", session.id)
      .eq("status", "confirmed");

    const confirmedCount = confirmedBookings?.length ?? 0;
    if (confirmedCount >= MIN_PARTICIPANTS) continue;

    cancelled++;

    const result = await processCancelledSession(
      session,
      (confirmedBookings ?? []) as BookingRow[],
      baseUrl
    );
    moved += result.moved;
    dropped += result.dropped;

    await supabase
      .from("sessions")
      .update({ status: "cancelled" })
      .eq("id", session.id);
  }

  return {
    cancelled_sessions: cancelled,
    participants_moved: moved,
    participants_dropped: dropped,
  };
}

async function processCancelledSession(
  cancelledSession: SessionRow,
  confirmedBookings: BookingRow[],
  baseUrl: string
): Promise<{ moved: number; dropped: number }> {
  let moved = 0;
  let dropped = 0;

  // Candidate target sessions: upcoming, dated exactly 2 days after the
  // cancelled session (e.g. Wed → Fri), currently with 1 or 2 confirmed
  // participants. Counts are re-evaluated each iteration so earlier moves
  // within this run are reflected.
  const targetDate = plusDaysStr(
    new Date(`${cancelledSession.date}T00:00:00`),
    2
  );

  const { data: laterSessions } = await supabase
    .from("sessions")
    .select("id, date, start_time, end_time, location, room, max_participants, status")
    .eq("status", "upcoming")
    .eq("date", targetDate);

  const candidates = (laterSessions ?? []).sort(
    (a, b) => startMs(a) - startMs(b)
  ) as SessionRow[];

  for (const booking of confirmedBookings) {
    const target = await findTarget(candidates, booking);

    if (target) {
      await supabase
        .from("bookings")
        .update({ session_id: target.id })
        .eq("id", booking.id);

      try {
        const emailId = await sendSessionMovedEmail(
          booking.email,
          booking.full_name,
          booking.id,
          {
            date: cancelledSession.date,
            start_time: cancelledSession.start_time,
            end_time: cancelledSession.end_time,
            location: cancelledSession.location,
            room: cancelledSession.room,
          },
          {
            date: target.date,
            start_time: target.start_time,
            end_time: target.end_time,
            location: target.location,
            room: target.room,
          },
          baseUrl
        );
        if (emailId) await logEmail(emailId, {
          emailType: "moved",
          bookingId: booking.id,
          toEmail: booking.email,
          toName: booking.full_name,
          extra: { old_session_id: cancelledSession.id, new_session_id: target.id },
        });
      } catch { /* don't block on email errors */ }

      moved++;
    } else {
      // No fit — delete the booking and notify with cancellation email.
      await supabase.from("bookings").delete().eq("id", booking.id);

      try {
        const emailId = await sendSessionCancelledByAdminEmail({
          email: booking.email,
          fullName: booking.full_name,
          cancelledSession: {
            date: cancelledSession.date,
            start_time: cancelledSession.start_time,
            end_time: cancelledSession.end_time,
            location: cancelledSession.location,
            room: cancelledSession.room,
          },
          movedToSession: null,
          bookingId: null,
          baseUrl,
        });
        if (emailId) await logEmail(emailId, {
          emailType: "cancelled_by_admin",
          toEmail: booking.email,
          toName: booking.full_name,
          extra: { cancelled_session: cancelledSession, moved_to_session: null, booking_id: null },
        });
      } catch { /* don't block on email errors */ }

      dropped++;
    }
  }

  // Pending rows on the cancelled session are stale — delete them. Notify
  // anyone whose only foothold was this session (mirrors cancelSessionAndPromote
  // behavior in admin/sessions/route.ts).
  const { data: pendingBookings } = await supabase
    .from("bookings")
    .select("id, email, full_name")
    .eq("session_id", cancelledSession.id)
    .eq("status", "pending");

  if (pendingBookings?.length) {
    await supabase
      .from("bookings")
      .delete()
      .eq("session_id", cancelledSession.id)
      .eq("status", "pending");

    const seen = new Set<string>();
    for (const b of pendingBookings) {
      if (seen.has(b.email)) continue;
      seen.add(b.email);

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
          cancelledSession: {
            date: cancelledSession.date,
            start_time: cancelledSession.start_time,
            end_time: cancelledSession.end_time,
            location: cancelledSession.location,
            room: cancelledSession.room,
          },
          movedToSession: null,
          bookingId: null,
          baseUrl,
        });
        if (emailId) await logEmail(emailId, {
          emailType: "cancelled_by_admin",
          toEmail: b.email,
          toName: b.full_name,
          extra: { cancelled_session: cancelledSession, moved_to_session: null, booking_id: null },
        });
      } catch { /* don't block on email errors */ }
    }
  }

  return { moved, dropped };
}

async function findTarget(
  candidates: SessionRow[],
  booking: BookingRow
): Promise<SessionRow | null> {
  for (const c of candidates) {
    const { count: total } = await supabase
      .from("bookings")
      .select("*", { count: "exact", head: true })
      .eq("session_id", c.id)
      .eq("status", "confirmed");

    const current = total ?? 0;

    // Must already have 1 or 2 confirmed participants.
    if (current < 1 || current > 2) continue;
    // Cannot exceed the session's capacity after move.
    if (current + 1 > c.max_participants) continue;
    // Don't move someone into a session they're already booked on.
    const { count: existing } = await supabase
      .from("bookings")
      .select("*", { count: "exact", head: true })
      .eq("session_id", c.id)
      .eq("email", booking.email);
    if ((existing ?? 0) > 0) continue;

    return c;
  }
  return null;
}
