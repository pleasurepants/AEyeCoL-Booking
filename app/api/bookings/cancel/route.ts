import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { backfillSession } from "@/lib/assign";
import { sendCancellationConfirmationEmail } from "@/lib/email";

export async function POST(req: NextRequest) {
  const { booking_id } = await req.json();

  if (!booking_id) {
    return NextResponse.json(
      { error: "Missing booking_id" },
      { status: 400 }
    );
  }

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

  const sessionId = booking.session_id;
  const wasConfirmed = booking.status === "confirmed";
  const sessionInfo = booking.sessions as unknown as {
    date: string;
    start_time: string;
    end_time: string;
    location: string;
    room: string | null;
  };

  const { error: deleteError } = await supabase
    .from("bookings")
    .delete()
    .eq("id", booking_id);

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  // Delete ALL remaining bookings for this person (clean slate on self-cancel)
  await supabase.from("bookings").delete().eq("email", booking.email);

  if (wasConfirmed) {
    await sendCancellationConfirmationEmail(
      booking.email,
      booking.full_name,
      sessionInfo
    );
  }

  // Backfill the freed spot (chain up to 10 iterations inside backfillSession)
  if (wasConfirmed) {
    const baseUrl =
      req.headers.get("x-forwarded-proto") && req.headers.get("host")
        ? `${req.headers.get("x-forwarded-proto")}://${req.headers.get("host")}`
        : req.nextUrl.origin;

    await backfillSession(sessionId, baseUrl);
  }

  return NextResponse.json({ ok: true });
}
