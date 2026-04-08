import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { Resend } from "resend";

function fmtDate(d: string) {
  return new Date(d + "T00:00:00").toLocaleDateString("en-US", {
    year: "numeric", month: "long", day: "numeric", weekday: "long",
  });
}
function fmtTime(t: string) { const [h, m] = t.split(":"); return `${h}:${m}`; }

export async function POST(req: NextRequest) {
  const body = await req.json();

  const { data, error } = await supabase.from("sessions").insert({
    date: body.date,
    start_time: body.start_time,
    end_time: body.end_time,
    location: body.location,
    room: body.room ?? null,
    max_participants: body.max_participants,
    notes: body.notes ?? null,
  }).select();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data });
}

export async function PATCH(req: NextRequest) {
  const { id, status } = await req.json();

  if (!id || !status) {
    return NextResponse.json({ error: "Missing id or status" }, { status: 400 });
  }

  // If cancelling, notify all confirmed participants before updating
  if (status === "cancelled") {
    const { data: session } = await supabase
      .from("sessions")
      .select("date, start_time, end_time, location, room")
      .eq("id", id)
      .single();

    const { data: bookings } = await supabase
      .from("bookings")
      .select("email, full_name")
      .eq("session_id", id)
      .eq("status", "confirmed");

    if (session && bookings?.length) {
      const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
      const sender = process.env.FROM_EMAIL;

      if (resend && sender) {
        const dateStr = fmtDate(session.date);
        const loc = session.room ? `${session.location}, ${session.room}` : session.location;

        for (const b of bookings) {
          try {
            await resend.emails.send({
              from: sender,
              to: b.email,
              subject: `Session Cancelled: ${dateStr}`,
              html: `
                <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 520px; margin: 0 auto; color: #1f2937;">
                  <h2 style="color: #dc2626; margin-bottom: 4px;">Session Cancelled</h2>
                  <p style="color: #6b7280; margin-top: 0;">Hi ${b.full_name}, we're sorry to inform you that the following session has been <strong>cancelled</strong>.</p>
                  <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
                    <tr><td style="padding: 8px 0; color: #6b7280; width: 100px;">Date</td><td style="padding: 8px 0; color: #111827; font-weight: 500;">${dateStr}</td></tr>
                    <tr><td style="padding: 8px 0; color: #6b7280;">Time</td><td style="padding: 8px 0; color: #111827; font-weight: 500;">${fmtTime(session.start_time)} – ${fmtTime(session.end_time)}</td></tr>
                    <tr><td style="padding: 8px 0; color: #6b7280;">Location</td><td style="padding: 8px 0; color: #111827; font-weight: 500;">${loc}</td></tr>
                  </table>
                  <p style="color: #374151; line-height: 1.6;">We apologize for the inconvenience. If you have any questions, please don't hesitate to reach out.</p>
                  <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 32px 0 16px;" />
                  <p style="color: #9ca3af; font-size: 13px; margin: 0;">Best regards,<br /><strong style="color: #6b7280;">AEyeCoL Research Team</strong></p>
                </div>`,
            });
          } catch { /* don't block cancellation if email fails */ }
        }
      }
    }
  }

  const { error } = await supabase
    .from("sessions")
    .update({ status })
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Missing session id" }, { status: 400 });
  }

  // Notify confirmed participants before deleting
  const { data: session } = await supabase
    .from("sessions")
    .select("date, start_time, end_time, location, room")
    .eq("id", id)
    .single();

  const { data: bookings } = await supabase
    .from("bookings")
    .select("email, full_name")
    .eq("session_id", id)
    .eq("status", "confirmed");

  if (session && bookings?.length) {
    const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
    const sender = process.env.FROM_EMAIL;

    if (resend && sender) {
      const dateStr = fmtDate(session.date);
      const loc = session.room ? `${session.location}, ${session.room}` : session.location;

      for (const b of bookings) {
        try {
          await resend.emails.send({
            from: sender,
            to: b.email,
            subject: `Session Cancelled: ${dateStr}`,
            html: `
              <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 520px; margin: 0 auto; color: #1f2937;">
                <h2 style="color: #dc2626; margin-bottom: 4px;">Session Cancelled</h2>
                <p style="color: #6b7280; margin-top: 0;">Hi ${b.full_name}, we're sorry to inform you that the following session has been <strong>cancelled</strong>.</p>
                <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
                  <tr><td style="padding: 8px 0; color: #6b7280; width: 100px;">Date</td><td style="padding: 8px 0; color: #111827; font-weight: 500;">${dateStr}</td></tr>
                  <tr><td style="padding: 8px 0; color: #6b7280;">Time</td><td style="padding: 8px 0; color: #111827; font-weight: 500;">${fmtTime(session.start_time)} – ${fmtTime(session.end_time)}</td></tr>
                  <tr><td style="padding: 8px 0; color: #6b7280;">Location</td><td style="padding: 8px 0; color: #111827; font-weight: 500;">${loc}</td></tr>
                </table>
                <p style="color: #374151; line-height: 1.6;">We apologize for the inconvenience. If you have any questions, please don't hesitate to reach out.</p>
                <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 32px 0 16px;" />
                <p style="color: #9ca3af; font-size: 13px; margin: 0;">Best regards,<br /><strong style="color: #6b7280;">AEyeCoL Research Team</strong></p>
              </div>`,
          });
        } catch { /* don't block deletion if email fails */ }
      }
    }
  }

  // Delete all bookings for this session first (foreign key constraint)
  const { error: bookingsError } = await supabase
    .from("bookings")
    .delete()
    .eq("session_id", id);

  if (bookingsError) {
    return NextResponse.json({ error: bookingsError.message }, { status: 500 });
  }

  const { error } = await supabase
    .from("sessions")
    .delete()
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
