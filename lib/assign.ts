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
 * CORE assignment function.
 * Gets all pending bookings for this email, ordered by preference_order ASC.
 * First session with room → confirm that booking, DELETE every other booking
 * for this email (pending or otherwise), send confirmation email.
 * If no session has room → leave as pending (optionally send "all full" email).
 * Returns the confirmed booking's session_id, or null.
 */
export async function assignByEmail(
  email: string,
  baseUrl: string,
  options: { sendNoSpotsEmail?: boolean } = {}
): Promise<string | null> {
  const { sendNoSpotsEmail: shouldSendNoSpots = true } = options;

  const { data: pending } = await supabase
    .from("bookings")
    .select("*, sessions(*)")
    .eq("email", email)
    .eq("status", "pending")
    .order("preference_order", { ascending: true });

  if (!pending?.length) return null;

  for (const booking of pending) {
    const count = await confirmedCount(booking.session_id);
    if (count < booking.sessions.max_participants) {
      await supabase
        .from("bookings")
        .update({ status: "confirmed" })
        .eq("id", booking.id);

      await supabase
        .from("bookings")
        .delete()
        .eq("email", email)
        .neq("id", booking.id);

      await sendConfirmationEmail(
        email,
        booking.full_name,
        booking.id,
        booking.sessions,
        baseUrl
      );

      return booking.session_id;
    }
  }

  if (shouldSendNoSpots) {
    await sendNoSpotsEmail(pending[0].email, pending[0].full_name);
  }
  return null;
}

/**
 * Backfill after a spot opens in a session.
 * Finds pending candidates for the session (ordered by created_at).
 * For each, runs assignByEmail which tries THEIR preferences in order.
 * If they land in this session, the slot is filled.
 * If they land elsewhere (higher preference), try the next candidate.
 * Chain: if assignByEmail confirms someone, their other bookings are deleted,
 * which doesn't free confirmed slots — so chain is naturally bounded.
 * Max 10 total iterations as safety.
 */
export async function backfillSession(
  freedSessionId: string,
  baseUrl: string
): Promise<void> {
  let iterations = 0;
  const MAX = 10;

  const { data: session } = await supabase
    .from("sessions")
    .select("*")
    .eq("id", freedSessionId)
    .single();
  if (!session) return;

  const triedEmails = new Set<string>();

  while (iterations < MAX) {
    iterations++;

    const count = await confirmedCount(freedSessionId);
    if (count >= session.max_participants) break;

    const { data: candidates } = await supabase
      .from("bookings")
      .select("id, email")
      .eq("session_id", freedSessionId)
      .eq("status", "pending")
      .order("created_at", { ascending: true });

    if (!candidates?.length) break;

    const candidate = candidates.find((c) => !triedEmails.has(c.email));
    if (!candidate) break;

    triedEmails.add(candidate.email);

    const { count: alreadyConfirmed } = await supabase
      .from("bookings")
      .select("*", { count: "exact", head: true })
      .eq("email", candidate.email)
      .eq("status", "confirmed");

    if ((alreadyConfirmed ?? 0) > 0) {
      await supabase.from("bookings").delete().eq("id", candidate.id);
      continue;
    }

    await assignByEmail(candidate.email, baseUrl, { sendNoSpotsEmail: false });
  }
}

/**
 * Cleanup: find any email with multiple confirmed bookings.
 * Keep only the one with the lowest preference_order (then earliest created_at).
 * Delete the rest. Returns count of duplicates removed.
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
 * 1) Cleanup duplicate confirmations
 * 2) Backfill every upcoming session
 * 3) Notify people whose ALL preferences are full, then delete their pending
 */
export async function runBatchAssignment(
  baseUrl: string
): Promise<{
  confirmed: number;
  notified_no_spots: number;
  duplicates_removed: number;
}> {
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

  return {
    confirmed: totalConfirmed,
    notified_no_spots: totalNotified,
    duplicates_removed: duplicatesRemoved,
  };
}
