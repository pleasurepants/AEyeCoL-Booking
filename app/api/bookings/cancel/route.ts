import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { backfillSession } from "@/lib/assign";
import { sendAdminBookingEventEmail, sendCancellationConfirmationEmail } from "@/lib/email";
import { logEmail } from "@/lib/email-log";

export async function POST(req: NextRequest) {
  const { booking_id } = await req.json();

  if (!booking_id) {
    return NextResponse.json(
      { error: "Missing booking_id" },
      { status: 400 }
    );
  }

  // 1. Get the booking, store session_id and email
  const { data: booking, error: fetchError } = await supabase
    .from("bookings")
    .select(
      "id, session_id, status, email, full_name, sessions(date, start_time, end_time, location, room)"
    )
    .eq("id", booking_id)
    .single();

  if (fetchError || !booking) {
    return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  }

  const freedSessionId = booking.session_id;
  const wasConfirmed = booking.status === "confirmed";
  const sessionInfo = booking.sessions as unknown as {
    date: string;
    start_time: string;
    end_time: string;
    location: string;
    room: string | null;
  };
  const sessionStart = new Date(`${sessionInfo.date}T${sessionInfo.start_time}`);
  const sessionEnd = new Date(`${sessionInfo.date}T${sessionInfo.end_time}`);
  if (sessionEnd.getTime() <= Date.now()) {
    return NextResponse.json(
      { error: "Session already expired. Cancellation is no longer available." },
      { status: 410 }
    );
  }
  if (sessionStart.getTime() - Date.now() <= 3 * 60 * 60 * 1000) {
    return NextResponse.json(
      { error: "Cancellation is no longer available within 3 hours of the session start time." },
      { status: 403 }
    );
  }

  // 2. Delete this booking + all other bookings for this person (full withdrawal)
  const { error: deleteError } = await supabase
    .from("bookings")
    .delete()
    .eq("email", booking.email);

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  const baseUrl =
    req.headers.get("x-forwarded-proto") && req.headers.get("host")
      ? `${req.headers.get("x-forwarded-proto")}://${req.headers.get("host")}`
      : req.nextUrl.origin;

  // 3. Send cancellation confirmation email
  const cancelEmailId = await sendCancellationConfirmationEmail(
    booking.email,
    booking.full_name,
    sessionInfo,
    baseUrl
  );
  if (cancelEmailId) await logEmail(cancelEmailId, {
    emailType: "cancellation_confirmation",
    toEmail: booking.email,
    toName: booking.full_name,
    extra: { session: sessionInfo },
  });

  try {
    await sendAdminBookingEventEmail({
      eventType: "cancelled",
      participantEmail: booking.email,
      participantName: booking.full_name,
      session: sessionInfo,
    });
  } catch {
    // do not block cancellation if admin notification fails
  }

  // 4. Backfill the freed session
  if (wasConfirmed) {
    await backfillSession(freedSessionId, baseUrl);
  }

  return NextResponse.json({ ok: true });
}
