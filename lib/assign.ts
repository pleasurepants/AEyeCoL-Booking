import { supabase } from "./supabase";
import { sendConfirmationEmail, sendNoSpotsFinalEmail } from "./email";

async function confirmedCount(sessionId: string): Promise<number> {
  const { count } = await supabase
    .from("bookings")
    .select("*", { count: "exact", head: true })
    .eq("session_id", sessionId)
    .eq("status", "confirmed");
  return count ?? 0;
}

/**
 * CORE function — call whenever something changes.
 * 1. Find all pending bookings for this email, ordered by preference_order ASC
 * 2. For each: count confirmed for that session. If < max → confirm, delete
 *    all OTHER bookings for this email, send confirmation email, STOP.
 * 3. If no preference had space → do nothing, leave all pending.
 * Returns the confirmed booking id, or null.
 */
export async function tryConfirm(
  email: string,
  baseUrl: string
): Promise<string | null> {
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

      return booking.id;
    }
  }

  return null;
}

/**
 * Backfill a freed session after a cancellation.
 * Find all PENDING bookings for this session, unique emails, ordered by created_at.
 * For each email: check if session still has space → if yes, tryConfirm(email).
 * tryConfirm may confirm them into THIS session or a higher preference.
 * Stop when session is full.
 */
export async function backfillSession(
  sessionId: string,
  baseUrl: string
): Promise<void> {
  const { data: session } = await supabase
    .from("sessions")
    .select("max_participants")
    .eq("id", sessionId)
    .single();
  if (!session) return;

  const { data: candidates } = await supabase
    .from("bookings")
    .select("email")
    .eq("session_id", sessionId)
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  if (!candidates?.length) return;

  const seen = new Set<string>();
  const emails: string[] = [];
  for (const c of candidates) {
    if (!seen.has(c.email)) {
      seen.add(c.email);
      emails.push(c.email);
    }
  }

  for (const email of emails) {
    const count = await confirmedCount(sessionId);
    if (count >= session.max_participants) break;
    await tryConfirm(email, baseUrl);
  }
}

/**
 * Nightly assignment.
 * 1. Find all emails with at least one pending booking → tryConfirm each
 * 2. Find emails that STILL have pending but ALL their sessions are full
 *    → send "no spots" email, delete their pending bookings
 * 3. Return { confirmed, no_spots }
 */
export async function runNightlyAssignment(
  baseUrl: string
): Promise<{ confirmed: number; no_spots: number }> {
  const { count: beforeCount } = await supabase
    .from("bookings")
    .select("*", { count: "exact", head: true })
    .eq("status", "confirmed");

  const { data: allPending } = await supabase
    .from("bookings")
    .select("email")
    .eq("status", "pending");

  if (allPending?.length) {
    const seen = new Set<string>();
    for (const b of allPending) {
      if (seen.has(b.email)) continue;
      seen.add(b.email);
      await tryConfirm(b.email, baseUrl);
    }
  }

  const { count: afterCount } = await supabase
    .from("bookings")
    .select("*", { count: "exact", head: true })
    .eq("status", "confirmed");

  const confirmed = (afterCount ?? 0) - (beforeCount ?? 0);

  let noSpots = 0;
  const { data: remainingPending } = await supabase
    .from("bookings")
    .select("email, full_name, session_id, sessions(max_participants)")
    .eq("status", "pending");

  if (remainingPending?.length) {
    const emailMap = new Map<
      string,
      { full_name: string; sessions: { session_id: string; max: number }[] }
    >();

    for (const b of remainingPending) {
      const max = (
        b as unknown as { sessions: { max_participants: number } }
      ).sessions.max_participants;
      if (!emailMap.has(b.email)) {
        emailMap.set(b.email, { full_name: b.full_name, sessions: [] });
      }
      emailMap.get(b.email)!.sessions.push({ session_id: b.session_id, max });
    }

    for (const [email, info] of emailMap) {
      let allFull = true;
      for (const s of info.sessions) {
        const c = await confirmedCount(s.session_id);
        if (c < s.max) {
          allFull = false;
          break;
        }
      }

      if (allFull) {
        await sendNoSpotsFinalEmail(email, info.full_name, baseUrl);
        await supabase
          .from("bookings")
          .delete()
          .eq("email", email)
          .eq("status", "pending");
        noSpots++;
      }
    }
  }

  return { confirmed, no_spots: noSpots };
}
