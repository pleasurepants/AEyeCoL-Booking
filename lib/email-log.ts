import { supabaseAdmin } from "./supabase-admin";

export async function logEmail(
  resendEmailId: string,
  params: {
    emailType: string;
    bookingId?: string | null;
    toEmail: string;
    toName?: string;
    extra?: Record<string, unknown>;
  }
): Promise<void> {
  try {
    await supabaseAdmin.from("email_logs").insert({
      resend_email_id: resendEmailId,
      email_type: params.emailType,
      booking_id: params.bookingId ?? null,
      to_email: params.toEmail,
      to_name: params.toName ?? "",
      extra: params.extra ?? null,
    });
  } catch {
    // non-fatal — never block email sends due to logging failure
  }
}
