import { supabase } from "./supabase";
import {
  sendConfirmationEmail,
  sendNoSpotsEmail,
} from "./email";

async function confirmedCount(sessionId: string): Promise<number> {
  const { count } = await supabase
    .from("bookings")
    .select("*", { count: "exact", head: true })
    .eq("session_id", sessionId)
    .eq("status", "confirmed");
  return count ?? 0;
}

/**
 * Try to assign a set of bookings from one submission.
 * Checks sessions in preference order; confirms the first with room.
 * Returns the confirmed booking id, or null if all full.
 */
export async function tryAssignSubmission(
  bookingIds: string[],
  baseUrl: string
): Promise<string | null> {
  const { data: bookings } = await supabase
    .from("bookings")
    .select("*, sessions(*)")
    .in("id", bookingIds)
    .eq("status", "pending")
    .order("preference_order", { ascending: true });

  if (!bookings?.length) return null;

  for (const booking of bookings) {
    const count = await confirmedCount(booking.session_id);
    if (count < booking.sessions.max_participants) {
      await supabase
        .from("bookings")
        .update({ status: "confirmed" })
        .eq("id", booking.id);

      const otherIds = bookingIds.filter((id) => id !== booking.id);
      if (otherIds.length) {
        await supabase
          .from("bookings")
          .update({ status: "superseded" })
          .in("id", otherIds);
      }

      await sendConfirmationEmail(
        booking.email,
        booking.full_name,
        booking.id,
        booking.sessions,
        baseUrl
      );

      return booking.id;
    }
  }

  await sendNoSpotsEmail(bookings[0].email, bookings[0].full_name);
  return null;
}

/**
 * After a confirmed booking is cancelled, try to fill the freed spot.
 * Finds the earliest pending booking for that session, confirms it,
 * and supersedes the new confirmee's other pending bookings.
 */
export async function backfillSession(
  sessionId: string,
  baseUrl: string
): Promise<string | null> {
  const { data: session } = await supabase
    .from("sessions")
    .select("*")
    .eq("id", sessionId)
    .single();
  if (!session) return null;

  const count = await confirmedCount(sessionId);
  if (count >= session.max_participants) return null;

  const { data: pending } = await supabase
    .from("bookings")
    .select("*")
    .eq("session_id", sessionId)
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(1);

  if (!pending?.length) return null;

  const booking = pending[0];

  await supabase
    .from("bookings")
    .update({ status: "confirmed" })
    .eq("id", booking.id);

  // Supersede other pending bookings from the same email
  await supabase
    .from("bookings")
    .update({ status: "superseded" })
    .eq("email", booking.email)
    .eq("status", "pending")
    .neq("id", booking.id);

  await sendConfirmationEmail(
    booking.email,
    booking.full_name,
    booking.id,
    session,
    baseUrl
  );

  return booking.id;
}

/**
 * Nightly batch assignment for sessions happening on a given date.
 * Returns the number of bookings confirmed.
 */
export async function runBatchAssignment(
  targetDate: string,
  baseUrl: string
): Promise<number> {
  const { data: sessions } = await supabase
    .from("sessions")
    .select("*")
    .eq("date", targetDate);

  if (!sessions?.length) return 0;

  let totalConfirmed = 0;

  for (const session of sessions) {
    const count = await confirmedCount(session.id);
    let available = session.max_participants - count;
    if (available <= 0) continue;

    // Find pending bookings for this session, earliest first
    const { data: pending } = await supabase
      .from("bookings")
      .select("*")
      .eq("session_id", session.id)
      .eq("status", "pending")
      .order("created_at", { ascending: true });

    if (!pending?.length) continue;

    for (const booking of pending) {
      if (available <= 0) break;

      // Check this person doesn't already have a confirmed booking
      const { count: alreadyConfirmed } = await supabase
        .from("bookings")
        .select("*", { count: "exact", head: true })
        .eq("email", booking.email)
        .eq("status", "confirmed");

      if ((alreadyConfirmed ?? 0) > 0) continue;

      await supabase
        .from("bookings")
        .update({ status: "confirmed" })
        .eq("id", booking.id);

      // Supersede their other pending bookings
      await supabase
        .from("bookings")
        .update({ status: "superseded" })
        .eq("email", booking.email)
        .eq("status", "pending")
        .neq("id", booking.id);

      await sendConfirmationEmail(
        booking.email,
        booking.full_name,
        booking.id,
        session,
        baseUrl
      );

      totalConfirmed++;
      available--;
    }
  }

  // Find remaining pending bookings where ALL their sessions are full
  const { data: stillPending } = await supabase
    .from("bookings")
    .select("*, sessions(*)")
    .eq("status", "pending")
    .in(
      "session_id",
      sessions.map((s) => s.id)
    );

  if (stillPending?.length) {
    const emailsSeen = new Set<string>();

    for (const booking of stillPending) {
      if (emailsSeen.has(booking.email)) continue;

      // Check if this person has any pending booking for a session that still has room
      const { data: allPending } = await supabase
        .from("bookings")
        .select("session_id, sessions(max_participants)")
        .eq("email", booking.email)
        .eq("status", "pending");

      let allFull = true;
      for (const pb of allPending ?? []) {
        const c = await confirmedCount(pb.session_id);
        const max = (pb as unknown as { sessions: { max_participants: number } })
          .sessions.max_participants;
        if (c < max) {
          allFull = false;
          break;
        }
      }

      if (allFull) {
        await sendNoSpotsEmail(booking.email, booking.full_name);
        emailsSeen.add(booking.email);
      }
    }
  }

  return totalConfirmed;
}
