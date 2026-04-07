import { supabase } from "./supabase";
import {
  sendConfirmationEmail,
  sendNoSpotsEmail,
  sendNoSpotsFinalEmail,
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
 * Delete ALL other bookings (pending) for this email, except the one being kept.
 * This enforces the rule: one confirmed booking per person, no leftover pending.
 */
async function deleteOtherBookingsForEmail(
  keepId: string,
  email: string
): Promise<void> {
  await supabase
    .from("bookings")
    .delete()
    .eq("email", email)
    .eq("status", "pending")
    .neq("id", keepId);
}

/**
 * Immediate assignment after a new submission.
 * Checks preferences in order (1→2→3). First session with room →
 * confirm that booking, DELETE all other pending bookings, send email.
 * If all full → keep as pending, send "all full" email.
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

      // Immediately delete all other pending bookings for this person
      const otherIds = bookingIds.filter((id) => id !== booking.id);
      if (otherIds.length) {
        await supabase.from("bookings").delete().in("id", otherIds);
      }
      await deleteOtherBookingsForEmail(booking.id, booking.email);

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
 * After a spot opens in a session, fill it from pending bookings.
 * Skips anyone already confirmed elsewhere.
 * On confirm → deletes all their other pending bookings.
 */
export async function backfillSession(
  sessionId: string,
  baseUrl: string
): Promise<void> {
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
      // Skip anyone already confirmed in another session
      const { count: alreadyConfirmed } = await supabase
        .from("bookings")
        .select("*", { count: "exact", head: true })
        .eq("email", candidate.email)
        .eq("status", "confirmed");

      if ((alreadyConfirmed ?? 0) > 0) {
        // They're already confirmed elsewhere — delete this stale pending
        await supabase.from("bookings").delete().eq("id", candidate.id);
        continue;
      }

      // Confirm this candidate
      await supabase
        .from("bookings")
        .update({ status: "confirmed" })
        .eq("id", candidate.id);

      await deleteOtherBookingsForEmail(candidate.id, candidate.email);

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
 * Cleanup: find emails with multiple confirmed bookings.
 * Keep only the one with the lowest preference_order, delete the rest.
 * Returns number of duplicate bookings removed.
 */
export async function cleanupDuplicateConfirmations(): Promise<number> {
  const { data: allConfirmed } = await supabase
    .from("bookings")
    .select("id, email, preference_order, created_at")
    .eq("status", "confirmed")
    .order("preference_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (!allConfirmed?.length) return 0;

  const kept = new Set<string>();
  const toDelete: string[] = [];

  for (const booking of allConfirmed) {
    if (kept.has(booking.email)) {
      toDelete.push(booking.id);
    } else {
      kept.add(booking.email);
    }
  }

  if (toDelete.length > 0) {
    await supabase.from("bookings").delete().in("id", toDelete);
  }

  return toDelete.length;
}

/**
 * Batch assignment for all upcoming sessions.
 * First cleans up duplicates, then fills sessions, then notifies hopeless pending.
 */
export async function runBatchAssignment(
  baseUrl: string
): Promise<{ confirmed: number; notified_no_spots: number; duplicates_removed: number }> {
  const duplicatesRemoved = await cleanupDuplicateConfirmations();

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
    for (const session of sessions) {
      await backfillSession(session.id, baseUrl);
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

  return { confirmed: totalConfirmed, notified_no_spots: totalNotified, duplicates_removed: duplicatesRemoved };
}
