import { supabase } from "./supabase";
import { sendConfirmationEmail, sendNoSpotsEmail } from "./email";

async function confirmedCount(sessionId: string): Promise<number> {
  const { count } = await supabase
    .from("bookings")
    .select("*", { count: "exact", head: true })
    .eq("session_id", sessionId)
    .eq("status", "confirmed");
  return count ?? 0;
}

async function deleteOtherBookings(
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
 * Try to assign a set of bookings from one submission.
 * Checks sessions in preference order; confirms the first with availability.
 * Deletes the other preference bookings for this person.
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
 * After a confirmed booking is cancelled, try to fill the freed spot.
 * Finds the earliest pending booking that listed this session as any preference.
 * Confirms it, deletes their other pending bookings, sends confirmation email.
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

  await deleteOtherBookings(booking.id, booking.email);

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
 * Batch assignment for all sessions with available spots on a given date.
 * Returns { confirmed, notified } counts.
 */
export async function runBatchAssignment(
  targetDate: string,
  baseUrl: string
): Promise<{ confirmed: number; notified: number }> {
  const { data: sessions } = await supabase
    .from("sessions")
    .select("*")
    .gte("date", targetDate)
    .order("date", { ascending: true });

  if (!sessions?.length) return { confirmed: 0, notified: 0 };

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
      .order("created_at", { ascending: true });

    if (!pending?.length) continue;

    for (const booking of pending) {
      if (available <= 0) break;

      // Skip if this person already has a confirmed booking
      const { count: alreadyConfirmed } = await supabase
        .from("bookings")
        .select("*", { count: "exact", head: true })
        .eq("email", booking.email)
        .eq("status", "confirmed");

      if ((alreadyConfirmed ?? 0) > 0) continue;

      // Re-check this booking still exists and is pending (could have been
      // deleted when a prior iteration confirmed another booking for same email)
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

      await deleteOtherBookings(booking.id, booking.email);

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

      // Get all pending bookings for this person
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
        await sendNoSpotsEmail(booking.email, booking.full_name);
        emailsSeen.add(booking.email);
        totalNotified++;
      }
    }
  }

  return { confirmed: totalConfirmed, notified: totalNotified };
}
