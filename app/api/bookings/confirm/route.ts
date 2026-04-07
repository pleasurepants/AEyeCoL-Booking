import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";

export async function POST(req: NextRequest) {
  const { booking_id, email, full_name, session } = await req.json();

  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.FROM_EMAIL;

  if (!apiKey || !fromEmail) {
    return NextResponse.json(
      { error: "Email service not configured" },
      { status: 500 }
    );
  }

  const resend = new Resend(apiKey);

  const baseUrl =
    req.headers.get("x-forwarded-proto") && req.headers.get("host")
      ? `${req.headers.get("x-forwarded-proto")}://${req.headers.get("host")}`
      : req.nextUrl.origin;

  const cancelUrl = `${baseUrl}/cancel?token=${booking_id}`;

  const formatTime = (t: string) => {
    const [h, m] = t.split(":");
    return `${h}:${m}`;
  };

  const dateStr = new Date(session.date + "T00:00:00").toLocaleDateString(
    "en-US",
    { year: "numeric", month: "long", day: "numeric", weekday: "long" }
  );

  const { error } = await resend.emails.send({
    from: fromEmail,
    to: email,
    subject: `Booking Confirmation — ${dateStr}`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 520px; margin: 0 auto; color: #1f2937;">
        <h2 style="color: #111827; margin-bottom: 4px;">Booking Confirmed</h2>
        <p style="color: #6b7280; margin-top: 0;">Hi ${full_name}, your session has been booked.</p>

        <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
          <tr>
            <td style="padding: 8px 0; color: #6b7280; width: 100px;">Date</td>
            <td style="padding: 8px 0; color: #111827; font-weight: 500;">${dateStr}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #6b7280;">Time</td>
            <td style="padding: 8px 0; color: #111827; font-weight: 500;">${formatTime(session.start_time)} – ${formatTime(session.end_time)}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #6b7280;">Location</td>
            <td style="padding: 8px 0; color: #111827; font-weight: 500;">${session.location}</td>
          </tr>
          ${session.notes ? `<tr><td style="padding: 8px 0; color: #6b7280;">Notes</td><td style="padding: 8px 0; color: #111827;">${session.notes}</td></tr>` : ""}
        </table>

        <p style="margin: 24px 0 8px; color: #6b7280; font-size: 14px;">
          Need to cancel? Click the link below:
        </p>
        <a href="${cancelUrl}" style="display: inline-block; background: #dc2626; color: #fff; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 500;">
          Cancel Booking
        </a>

        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 32px 0 16px;" />
        <p style="color: #9ca3af; font-size: 13px; margin: 0;">
          Best regards,<br />
          <strong style="color: #6b7280;">AEyeCoL Research Team</strong>
        </p>
      </div>
    `,
  });

  if (error) {
    console.error("Resend error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
