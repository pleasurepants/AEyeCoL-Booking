import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { backfillSession } from "@/lib/assign";

export async function POST(req: NextRequest) {
  const { booking_id } = await req.json();

  if (!booking_id) {
    return NextResponse.json({ error: "Missing booking_id" }, { status: 400 });
  }

  // Fetch booking to know which session to backfill
  const { data: booking, error: fetchError } = await supabase
    .from("bookings")
    .select("id, session_id, status")
    .eq("id", booking_id)
    .single();

  if (fetchError || !booking) {
    return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  }

  const wasConfirmed = booking.status === "confirmed";
  const sessionId = booking.session_id;

  // Delete the booking
  const { error: deleteError } = await supabase
    .from("bookings")
    .delete()
    .eq("id", booking_id);

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  // If the cancelled booking was confirmed, try to backfill
  if (wasConfirmed) {
    const baseUrl =
      req.headers.get("x-forwarded-proto") && req.headers.get("host")
        ? `${req.headers.get("x-forwarded-proto")}://${req.headers.get("host")}`
        : req.nextUrl.origin;

    await backfillSession(sessionId, baseUrl);
  }

  return NextResponse.json({ ok: true });
}
