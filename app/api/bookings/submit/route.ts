import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { tryAssignSubmission } from "@/lib/assign";
import { sendApplicationReceivedEmail } from "@/lib/email";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { full_name, email, phone, comments, sessions } = body as {
    full_name: string;
    email: string;
    phone: string | null;
    comments: string | null;
    sessions: { session_id: string; preference_order: number }[];
  };

  if (!full_name || !email || !sessions?.length) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const rows = sessions.map((s) => ({
    session_id: s.session_id,
    preference_order: s.preference_order,
    full_name,
    email,
    phone: phone || null,
    comments: comments || null,
    status: "pending",
  }));

  const { data: inserted, error: insertError } = await supabase
    .from("bookings")
    .insert(rows)
    .select("id, preference_order")
    .order("preference_order", { ascending: true });

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  const bookingIds = (inserted ?? []).map((b) => b.id);

  const baseUrl =
    req.headers.get("x-forwarded-proto") && req.headers.get("host")
      ? `${req.headers.get("x-forwarded-proto")}://${req.headers.get("host")}`
      : req.nextUrl.origin;

  const confirmedId = await tryAssignSubmission(bookingIds, baseUrl);

  if (!confirmedId) {
    await sendApplicationReceivedEmail(email, full_name);
  }

  return NextResponse.json({
    ok: true,
    confirmed: !!confirmedId,
    confirmed_booking_id: confirmedId,
  });
}
