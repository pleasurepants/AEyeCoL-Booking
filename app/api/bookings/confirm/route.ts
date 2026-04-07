import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";

export async function POST(req: NextRequest) {
  const { email, full_name } = await req.json();

  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.FROM_EMAIL;

  if (!apiKey || !fromEmail) {
    return NextResponse.json(
      { error: "Email service not configured" },
      { status: 500 }
    );
  }

  const resend = new Resend(apiKey);

  const { error } = await resend.emails.send({
    from: fromEmail,
    to: email,
    subject: "Application Received — AEyeCoL Study",
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 520px; margin: 0 auto; color: #1f2937;">
        <h2 style="color: #111827; margin-bottom: 4px;">Application Received</h2>
        <p style="color: #6b7280; margin-top: 0;">Hi ${full_name},</p>

        <p style="color: #374151; line-height: 1.6;">
          Thank you for submitting your session preferences. We have received your application and will review it shortly.
        </p>
        <p style="color: #374151; line-height: 1.6;">
          You will receive another email once your session has been confirmed.
        </p>

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
