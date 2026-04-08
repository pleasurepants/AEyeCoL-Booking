import { supabase } from "./supabase";
import { localNow } from "./timezone";
import {
  sendConfirmationEmail,
  sendBackfillConfirmationEmail,
  sendMovedToPreferredEmail,
  sendStartingSoonEmail,
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

function startsWithinThreeHours(session: { date: string; start_time: string }): boolean {
  const now = localNow();
  const start = new Date(`${session.date}T${session.start_time}`);
  const diffMs = start.getTime() - now.getTime();
  return diffMs > 0 && diffMs <= 3 * 60 * 60 * 1000;
}

export interface TryConfirmResult {
  confirmedId: string | null;
  vacatedSessionId: string | null;
}

/**
 * CORE function — call whenever something changes.
 *
 * CASE A: person is NOT confirmed anywhere
 *   Try pending in preference order. First session with room → confirm.
 *   Delete WORSE pending (higher preference_order). KEEP BETTER pending
 *   so the person can be upgraded later if a better session opens.
 *
 * CASE B: person IS already confirmed
 *   Only try pending that are BETTER than current confirmation.
 *   Delete any STALE pending that are worse than current confirmation.
 *   If a better session has room → upgrade: confirm new, delete old confirmed,
 *   return vacatedSessionId so caller can chain-backfill.
 */
export async function tryConfirm(
  email: string,
  baseUrl: string,
  isBackfill: boolean = false
): Promise<TryConfirmResult> {
  const { data: existing } = await supabase
    .from("bookings")
    .select("id, session_id, preference_order")
    .eq("email", email)
    .eq("status", "confirmed")
    .maybeSingle();

  const { data: pending } = await supabase
    .from("bookings")
    .select("*, sessions(*)")
    .eq("email", email)
    .eq("status", "pending")
    .order("preference_order", { ascending: true });

  if (!pending?.length) return { confirmedId: null, vacatedSessionId: null };

  // --- CASE B: already confirmed ---
  if (existing) {
    // Delete stale pending that are worse-or-equal to current confirmed
    const staleIds = pending
      .filter((p) => p.preference_order >= existing.preference_order)
      .map((p) => p.id);
    if (staleIds.length) {
      await supabase.from("bookings").delete().in("id", staleIds);
    }

    const better = pending.filter(
      (p) => p.preference_order < existing.preference_order
    );
    if (!better.length) return { confirmedId: null, vacatedSessionId: null };

    for (const booking of better) {
      const count = await confirmedCount(booking.session_id);
      if (count < booking.sessions.max_participants) {
        // Upgrade to better session
        await supabase
          .from("bookings")
          .update({ status: "confirmed" })
          .eq("id", booking.id);

        const vacatedSessionId = existing.session_id;
        await supabase.from("bookings").delete().eq("id", existing.id);

        // Delete worse pending among the better set
        const worseIds = better
          .filter(
            (p) =>
              p.id !== booking.id &&
              p.preference_order > booking.preference_order
          )
          .map((p) => p.id);
        if (worseIds.length) {
          await supabase.from("bookings").delete().in("id", worseIds);
        }

        // Fetch old session details for upgrade email
        const { data: oldSession } = await supabase
          .from("sessions")
          .select("date, start_time, end_time, location, room")
          .eq("id", vacatedSessionId)
          .single();

        if (oldSession) {
          await sendMovedToPreferredEmail(
            email,
            booking.full_name,
            booking.id,
            oldSession,
            booking.sessions,
            baseUrl
          );
        }

        if (startsWithinThreeHours(booking.sessions)) {
          await sendStartingSoonEmail(email, booking.full_name, booking.sessions);
        }

        return { confirmedId: booking.id, vacatedSessionId };
      }
    }

    return { confirmedId: null, vacatedSessionId: null };
  }

  // --- CASE A: not confirmed anywhere ---
  for (const booking of pending) {
    const count = await confirmedCount(booking.session_id);
    if (count < booking.sessions.max_participants) {
      await supabase
        .from("bookings")
        .update({ status: "confirmed" })
        .eq("id", booking.id);

      // Delete only WORSE pending, KEEP better pending for future upgrades
      const worseIds = pending
        .filter(
          (p) =>
            p.id !== booking.id &&
            p.preference_order > booking.preference_order
        )
        .map((p) => p.id);
      if (worseIds.length) {
        await supabase.from("bookings").delete().in("id", worseIds);
      }

      if (isBackfill) {
        await sendBackfillConfirmationEmail(
          email, booking.full_name, booking.id, booking.sessions, baseUrl
        );
      } else {
        await sendConfirmationEmail(
          email, booking.full_name, booking.id, booking.sessions, baseUrl
        );
      }

      if (startsWithinThreeHours(booking.sessions)) {
        await sendStartingSoonEmail(email, booking.full_name, booking.sessions);
      }

      return { confirmedId: booking.id, vacatedSessionId: null };
    }
  }

  return { confirmedId: null, vacatedSessionId: null };
}

/**
 * Backfill a freed session. For each pending person (by created_at):
 * - tryConfirm may confirm them into THIS session or upgrade them to a better one
 * - If someone vacated another session → chain-backfill that session
 * - Stop when session is full or no more candidates
 * depth limits chain to 10 levels.
 */
export async function backfillSession(
  sessionId: string,
  baseUrl: string,
  depth: number = 0
): Promise<void> {
  if (depth >= 10) return;

  const { data: session } = await supabase
    .from("sessions")
    .select("max_participants")
    .eq("id", sessionId)
    .single();
  if (!session) return;

  const tried = new Set<string>();

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const count = await confirmedCount(sessionId);
    if (count >= session.max_participants) break;

    const { data: candidates } = await supabase
      .from("bookings")
      .select("email")
      .eq("session_id", sessionId)
      .eq("status", "pending")
      .order("created_at", { ascending: true });

    if (!candidates?.length) break;

    const next = candidates.find((c) => !tried.has(c.email));
    if (!next) break;

    tried.add(next.email);

    const result = await tryConfirm(next.email, baseUrl, true);

    if (result.vacatedSessionId) {
      await backfillSession(result.vacatedSessionId, baseUrl, depth + 1);
    }
  }
}

/**
 * Nightly assignment.
 * 1. For each email with pending → tryConfirm (may upgrade or first-confirm)
 * 2. Chain-backfill any vacated sessions
 * 3. Notify emails whose ALL pending sessions are full → delete their pending
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
      const result = await tryConfirm(b.email, baseUrl, true);
      if (result.vacatedSessionId) {
        await backfillSession(result.vacatedSessionId, baseUrl);
      }
    }
  }

  const { count: afterCount } = await supabase
    .from("bookings")
    .select("*", { count: "exact", head: true })
    .eq("status", "confirmed");

  const confirmed = (afterCount ?? 0) - (beforeCount ?? 0);

  // Notify people whose ALL pending sessions are now full
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
      // Skip if this person is already confirmed somewhere
      const { count: isConfirmed } = await supabase
        .from("bookings")
        .select("*", { count: "exact", head: true })
        .eq("email", email)
        .eq("status", "confirmed");
      if ((isConfirmed ?? 0) > 0) continue;

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
