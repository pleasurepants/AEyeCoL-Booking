import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

const CONFIRM_NOTE = "Confirmed to be moved here";

export async function POST(req: NextRequest) {
  const { booking_id } = await req.json();
  if (!booking_id) {
    return NextResponse.json({ error: "Missing booking_id" }, { status: 400 });
  }

  const { data: booking, error } = await supabaseAdmin
    .from("bookings")
    .select("id, comments")
    .eq("id", booking_id)
    .single();

  if (error || !booking) {
    return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  }

  if (booking.comments?.includes(CONFIRM_NOTE)) {
    return NextResponse.json({ ok: true, already: true });
  }

  const newComments = booking.comments
    ? `${booking.comments}\n${CONFIRM_NOTE}`
    : CONFIRM_NOTE;

  const { error: updateError } = await supabaseAdmin
    .from("bookings")
    .update({ comments: newComments })
    .eq("id", booking_id);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
