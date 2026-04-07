import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { supabase } from "@/lib/supabase";
import { tryConfirm } from "@/lib/assign";

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
    return NextResponse.json(
      { error: "Missing required fields" },
      { status: 400 }
    );
  }

  const { count: confirmedExisting } = await supabase
    .from("bookings")
    .select("*", { count: "exact", head: true })
    .eq("email", email)
    .eq("status", "confirmed");

  if ((confirmedExisting ?? 0) > 0) {
    return NextResponse.json(
      { error: "You already have a confirmed booking" },
      { status: 409 }
    );
  }

  const { count: pendingExisting } = await supabase
    .from("bookings")
    .select("*", { count: "exact", head: true })
    .eq("email", email)
    .eq("status", "pending");

  if ((pendingExisting ?? 0) > 0) {
    return NextResponse.json(
      { error: "You already have a pending application" },
      { status: 409 }
    );
  }

  const submissionId = randomUUID();

  const rows = sessions.map((s) => ({
    session_id: s.session_id,
    preference_order: s.preference_order,
    full_name,
    email,
    phone: phone || null,
    comments: comments || null,
    status: "pending",
    submission_id: submissionId,
  }));

  const { error: insertError } = await supabase.from("bookings").insert(rows);

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  const baseUrl =
    req.headers.get("x-forwarded-proto") && req.headers.get("host")
      ? `${req.headers.get("x-forwarded-proto")}://${req.headers.get("host")}`
      : req.nextUrl.origin;

  const confirmedId = await tryConfirm(email, baseUrl);

  return NextResponse.json({ ok: true, confirmed: !!confirmedId });
}
