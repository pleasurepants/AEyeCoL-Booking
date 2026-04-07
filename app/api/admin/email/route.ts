import { NextRequest, NextResponse } from "next/server";
import { sendCustomEmail } from "@/lib/email";

export async function POST(req: NextRequest) {
  const { to, name, subject, message } = await req.json();

  if (!to || !subject || !message) {
    return NextResponse.json({ error: "Missing to, subject, or message" }, { status: 400 });
  }

  await sendCustomEmail(to, name || "", subject, message);
  return NextResponse.json({ ok: true });
}
