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

async function deleteOtherPendingBookings(
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
 * confirm, delete other pref bookings, send confirmation email.
 * If all full → keep as pending, send "all full, will notify" email.
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
        await supabase.from("bookings").delete().in("id", otherIds);
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
 * After any booking is deleted, try to fill the spot on that session.
 * Finds the earliest pending booking for this session, confirms it,
 * deletes their other pending bookings, sends confirmation email.
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
    .order("preference_order", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(1);

  if (!pending?.length) return null;

  const booking = pending[0];

  await supabase
    .from("bookings")
    .update({ status: "confirmed" })
    .eq("id", booking.id);

  await deleteOtherPendingBookings(booking.id, booking.email);

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
 * Batch assignment for all upcoming sessions with available spots.
 * - Fills sessions by confirming pending bookings (preference_order ASC, created_at ASC)
 * - Notifies participants whose ALL preferences are now full, then deletes their bookings
 * Returns { confirmed, notified_no_spots }.
 */
export async function runBatchAssignment(
  baseUrl: string
): Promise<{ confirmed: number; notified_no_spots: number }> {
  const { data: sessions } = await supabase
    .from("sessions")
    .select("*")
    .eq("status", "upcoming")
    .order("date", { ascending: true });

  if (!sessions?.length) return { confirmed: 0, notified_no_spots: 0 };

  let totalConfirmed = 0;

  for (const session of sessions) {
    const count = await confirmedCount(session.id);
    let available = session.max_participants - count;
    if (available <= 0) continue;

    const { data: pending } = await supabase
      .from("bookings")
      .select("*")
      .eq("session_id", session.id)
      .eq("status", "pending")
      .order("preference_order", { ascending: true })
      .order("created_at", { ascending: true });

    if (!pending?.length) continue;

    for (const booking of pending) {
      if (available <= 0) break;

      const { count: alreadyConfirmed } = await supabase
        .from("bookings")
        .select("*", { count: "exact", head: true })
        .eq("email", booking.email)
        .eq("status", "confirmed");

      if ((alreadyConfirmed ?? 0) > 0) continue;

      const { data: stillExists } = await supabase
        .from("bookings")
        .select("id")
        .eq("id", booking.id)
        .eq("status", "pending")
        .single();

      if (!stillExists) continue;

      await supabase
        .from("bookings")
        .update({ status: "confirmed" })
        .eq("id", booking.id);

      await deleteOtherPendingBookings(booking.id, booking.email);

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

        // Delete all their pending bookings
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
