import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { backfillSession } from "@/lib/assign";
import {
  sendConfirmationEmail,
  sendSessionMovedEmail,
  sendCancellationConfirmationEmail,
} from "@/lib/email";

function getBaseUrl(req: NextRequest) {
  return req.headers.get("x-forwarded-proto") && req.headers.get("host")
    ? `${req.headers.get("x-forwarded-proto")}://${req.headers.get("host")}`
    : req.nextUrl.origin;
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { action, booking_id } = body as {
    action: string;
    booking_id: string;
    target_session_id?: string;
  };

  if (!booking_id || !action) {
    return NextResponse.json(
      { error: "Missing booking_id or action" },
      { status: 400 }
    );
  }

  const { data: booking, error: fetchErr } = await supabase
    .from("bookings")
    .select("*, sessions(*)")
    .eq("id", booking_id)
    .single();

  if (fetchErr || !booking) {
    return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  }

  const baseUrl = getBaseUrl(req);

  if (action === "delete") {
    const wasConfirmed = booking.status === "confirmed";
    const sessionId = booking.session_id;

    const { error: delErr } = await supabase
      .from("bookings")
      .delete()
      .eq("id", booking_id);
    if (delErr)
      return NextResponse.json({ error: delErr.message }, { status: 500 });

    // Only notify if they actually had a confirmed slot. Removing a pending
    // (waitlist) row silently avoids spammy "cancelled" emails to people who
    // never held a confirmed seat.
    if (wasConfirmed) {
      try {
        await sendCancellationConfirmationEmail(
          booking.email,
          booking.full_name,
          booking.sessions,
          baseUrl
        );
      } catch { /* don't block delete if email fails */ }
      await backfillSession(sessionId, baseUrl);
    }
    return NextResponse.json({ ok: true });
  }

  if (action === "confirm") {
    // If this person is already confirmed in another session, delete that
    // and backfill the vacated session
    const { data: existingConfirmed } = await supabase
      .from("bookings")
      .select("id, session_id")
      .eq("email", booking.email)
      .eq("status", "confirmed")
      .neq("id", booking_id);

    const vacatedSessionIds: string[] = [];
    if (existingConfirmed?.length) {
      vacatedSessionIds.push(
        ...existingConfirmed.map((b) => b.session_id)
      );
      await supabase
        .from("bookings")
        .delete()
        .in(
          "id",
          existingConfirmed.map((b) => b.id)
        );
    }

    await supabase
      .from("bookings")
      .update({ status: "confirmed" })
      .eq("id", booking_id);

    // Delete all other bookings for this person (enforce one-confirmed rule)
    await supabase
      .from("bookings")
      .delete()
      .eq("email", booking.email)
      .neq("id", booking_id);

    await sendConfirmationEmail(
      booking.email,
      booking.full_name,
      booking.id,
      booking.sessions,
      baseUrl
    );

    // Backfill any sessions that lost a confirmed person
    for (const sid of vacatedSessionIds) {
      await backfillSession(sid, baseUrl);
    }

    return NextResponse.json({ ok: true });
  }

  if (action === "set-pending") {
    await supabase
      .from("bookings")
      .update({ status: "pending" })
      .eq("id", booking_id);
    return NextResponse.json({ ok: true, freed_session: booking.session_id });
  }

  if (action === "set-glasses") {
    const { glasses } = body as { glasses?: string };
    if (!["none", "contacts", "glasses"].includes(glasses ?? "")) {
      return NextResponse.json({ error: "Invalid glasses value" }, { status: 400 });
    }
    await supabase
      .from("bookings")
      .update({ glasses })
      .eq("id", booking_id);
    return NextResponse.json({ ok: true });
  }

  if (action === "move") {
    const { target_session_id } = body;
    if (!target_session_id) {
      return NextResponse.json(
        { error: "Missing target_session_id" },
        { status: 400 }
      );
    }

    const { data: targetSession } = await supabase
      .from("sessions")
      .select("*")
      .eq("id", target_session_id)
      .single();

    if (!targetSession) {
      return NextResponse.json(
        { error: "Target session not found" },
        { status: 404 }
      );
    }

    const oldSessionId = booking.session_id;

    await supabase
      .from("bookings")
      .update({ session_id: target_session_id })
      .eq("id", booking_id);

    await sendSessionMovedEmail(
      booking.email,
      booking.full_name,
      booking.id,
      booking.sessions,
      targetSession,
      baseUrl
    );

    if (booking.status === "confirmed") {
      await backfillSession(oldSessionId, baseUrl);
    }

    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
