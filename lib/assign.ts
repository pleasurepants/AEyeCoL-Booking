import { supabase } from "./supabase";
import {
  sendConfirmationEmail,
  sendNoSpotsEmail,
  sendNoSpotsFinalEmail,
  sendMovedToPreferredEmail,
} from "./email";

async function confirmedCount(sessionId: string): Promise<number> {
  const { count } = await supabase
    .from("bookings")
    .select("*", { count: "exact", head: true })
    .eq("session_id", sessionId)
    .eq("status", "confirmed");
  return count ?? 0;
}

async function deleteAllPendingForEmail(email: string): Promise<void> {
  await supabase
    .from("bookings")
    .delete()
    .eq("email", email)
    .eq("status", "pending");
}

/**
 * Immediate assignment after a new submission.
 * Checks preferences in order (1→2→3). First session with room →
 * confirm that booking, send confirmation email.
 * Other pending bookings are KEPT — they enable chain-move logic later.
 * If all full → keep all as pending, send "all full" email.
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
 * Chain backfill after a spot opens in a session.
 *
 * 1. CHAIN PHASE: Find anyone confirmed elsewhere who has a pending booking
 *    for this session with a better preference (lower preference_order).
 *    Move the earliest one here, which frees a spot in their old session →
 *    recursively backfill that session.
 *
 * 2. FILL PHASE: Fill remaining spots from pure pending bookings
 *    (people not confirmed anywhere).
 */
export async function backfillSession(
  sessionId: string,
  baseUrl: string,
  visited: Set<string> = new Set()
): Promise<void> {
  if (visited.has(sessionId)) return;
  visited.add(sessionId);

  const { data: session } = await supabase
    .from("sessions")
    .select("*")
    .eq("id", sessionId)
    .single();
  if (!session) return;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const count = await confirmedCount(sessionId);
    if (count >= session.max_participants) break;

    const { data: candidates } = await supabase
      .from("bookings")
      .select("*")
      .eq("session_id", sessionId)
      .eq("status", "pending")
      .order("preference_order", { ascending: true })
      .order("created_at", { ascending: true });

    if (!candidates?.length) break;

    let filled = false;

    for (const candidate of candidates) {
      const { data: theirConfirmed } = await supabase
        .from("bookings")
        .select("*, sessions(*)")
        .eq("email", candidate.email)
        .eq("status", "confirmed")
        .maybeSingle();

      if (theirConfirmed) {
        if (
          candidate.preference_order != null &&
          theirConfirmed.preference_order != null &&
          candidate.preference_order < theirConfirmed.preference_order
        ) {
          const oldSessionId = theirConfirmed.session_id;
          const oldSessionInfo = theirConfirmed.sessions;

          await supabase
            .from("bookings")
            .update({ status: "confirmed" })
            .eq("id", candidate.id);

          await supabase
            .from("bookings")
            .delete()
            .eq("id", theirConfirmed.id);

          await deleteAllPendingForEmail(candidate.email);

          await sendMovedToPreferredEmail(
            candidate.email,
            candidate.full_name,
            candidate.id,
            oldSessionInfo,
            session,
            baseUrl
          );

          await backfillSession(oldSessionId, baseUrl, visited);

          filled = true;
          break;
        }
        // They prefer their current confirmed session or equal — skip
        continue;
      }

      // Not confirmed anywhere → regular fill
      await supabase
        .from("bookings")
        .update({ status: "confirmed" })
        .eq("id", candidate.id);

      await deleteAllPendingForEmail(candidate.email);

      await sendConfirmationEmail(
        candidate.email,
        candidate.full_name,
        candidate.id,
        session,
        baseUrl
      );

      filled = true;
      break;
    }

    if (!filled) break;
  }
}

/**
 * Batch assignment for all upcoming sessions.
 * Uses backfillSession (with chain logic) for each session, then
 * notifies participants whose ALL preferences are now full.
 */
export async function runBatchAssignment(
  baseUrl: string
): Promise<{ confirmed: number; notified_no_spots: number }> {
  const { count: beforeCount } = await supabase
    .from("bookings")
    .select("*", { count: "exact", head: true })
    .eq("status", "confirmed");

  const { data: sessions } = await supabase
    .from("sessions")
    .select("*")
    .eq("status", "upcoming")
    .order("date", { ascending: true });

  if (sessions?.length) {
    const visited = new Set<string>();
    for (const session of sessions) {
      await backfillSession(session.id, baseUrl, visited);
    }
  }

  const { count: afterCount } = await supabase
    .from("bookings")
    .select("*", { count: "exact", head: true })
    .eq("status", "confirmed");

  const totalConfirmed = (afterCount ?? 0) - (beforeCount ?? 0);

  // Notify participants whose ALL preference sessions are full
  let totalNotified = 0;
  const { data: allPending } = await supabase
    .from("bookings")
    .select("id, email, full_name, session_id")
    .eq("status", "pending");

  if (allPending?.length) {
    const emailsSeen = new Set<string>();

    for (const booking of allPending) {
      if (emailsSeen.has(booking.email)) continue;

      const { data: personPending } = await supabase
        .from("bookings")
        .select("session_id, sessions(max_participants)")
        .eq("email", booking.email)
        .eq("status", "pending");

      let allFull = true;
      for (const pb of personPending ?? []) {
        const c = await confirmedCount(pb.session_id);
        const max = (
          pb as unknown as { sessions: { max_participants: number } }
        ).sessions.max_participants;
        if (c < max) {
          allFull = false;
          break;
        }
      }

      if (allFull) {
        await sendNoSpotsFinalEmail(booking.email, booking.full_name, baseUrl);

        await supabase
          .from("bookings")
          .delete()
          .eq("email", booking.email)
          .eq("status", "pending");

        emailsSeen.add(booking.email);
        totalNotified++;
      }
    }
  }

  return { confirmed: totalConfirmed, notified_no_spots: totalNotified };
}
