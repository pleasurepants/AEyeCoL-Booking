import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendSubscribedEmail } from "@/lib/email";

function getBaseUrl(req: NextRequest) {
  return req.headers.get("x-forwarded-proto") && req.headers.get("host")
    ? `${req.headers.get("x-forwarded-proto")}://${req.headers.get("host")}`
    : req.nextUrl.origin;
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const fullName = typeof body?.full_name === "string" ? body.full_name.trim() : "";

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Invalid email address." }, { status: 400 });
  }

  // Upsert so repeat submissions are idempotent and keep the original token.
  const { data: existing } = await supabaseAdmin
    .from("subscribers")
    .select("id, unsubscribe_token")
    .eq("email", email)
    .maybeSingle();

  let unsubscribeToken: string;

  if (existing) {
    unsubscribeToken = existing.unsubscribe_token;
    if (fullName) {
      await supabaseAdmin
        .from("subscribers")
        .update({ full_name: fullName })
        .eq("id", existing.id);
    }
  } else {
    const { data: inserted, error } = await supabaseAdmin
      .from("subscribers")
      .insert({ email, full_name: fullName || null })
      .select("unsubscribe_token")
      .single();
    if (error || !inserted) {
      return NextResponse.json(
        { error: error?.message ?? "Failed to subscribe." },
        { status: 500 }
      );
    }
    unsubscribeToken = inserted.unsubscribe_token;
  }

  try {
    await sendSubscribedEmail(email, fullName, unsubscribeToken, getBaseUrl(req));
  } catch { /* don't block subscribe if email fails */ }

  return NextResponse.json({ ok: true, already: !!existing });
}

export async function DELETE(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) {
    return NextResponse.json({ error: "Missing token." }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("subscribers")
    .delete()
    .eq("unsubscribe_token", token)
    .select("email")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Subscription not found." }, { status: 404 });
  }

  return NextResponse.json({ ok: true, email: data.email });
}
