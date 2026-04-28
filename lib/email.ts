import { Resend } from "resend";

interface SessionInfo {
  date: string;
  start_time: string;
  end_time: string;
  location: string;
  room: string | null;
}

export interface AlternativeInfo {
  preference_order: number | null;
  date: string;
  start_time: string;
  end_time: string;
  location: string;
  room: string | null;
}

function ordinal(n: number | null | undefined): string {
  if (n === 1) return "1st";
  if (n === 2) return "2nd";
  if (n === 3) return "3rd";
  return "?";
}

function renderAlternatives(alternatives: AlternativeInfo[] | undefined): string {
  if (!alternatives || alternatives.length === 0) return "";
  const rows = alternatives
    .map(
      (a) =>
        `<tr><td style="padding: 4px 10px 4px 0; color: #6b7280; vertical-align: top; white-space: nowrap;">${ordinal(a.preference_order)} choice</td><td style="padding: 4px 0; color: #374151;">${fmtDate(a.date)} · ${fmtTime(a.start_time)} – ${fmtTime(a.end_time)} · ${locationStr(a)}</td></tr>`
    )
    .join("");
  return `
    <div style="margin-top: 24px; padding: 14px 16px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 10px;">
      <div style="font-size: 13px; font-weight: 600; color: #111827; margin-bottom: 6px;">Your other preference${alternatives.length > 1 ? "s" : ""} (kept on the waitlist)</div>
      <div style="font-size: 13px; color: #6b7280; margin-bottom: 8px;">If a spot opens up in a higher-ranked choice, we'll upgrade you automatically and send a new email.</div>
      <table style="width: 100%; border-collapse: collapse; font-size: 13px;">${rows}</table>
    </div>`;
}

function getResend(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  return key ? new Resend(key) : null;
}

function from(): string | null {
  return process.env.FROM_EMAIL || null;
}

function fmtDate(d: string) {
  return new Date(d + "T00:00:00").toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  });
}

function fmtTime(t: string) {
  const [h, m] = t.split(":");
  return `${h}:${m}`;
}

function locationStr(s: SessionInfo) {
  return s.room ? `${s.location}, ${s.room}` : s.location;
}

const DEFAULT_ADMIN_NOTIFICATION_EMAIL = "hctlpupil@gmail.com";

export async function sendAdminBookingEventEmail(params: {
  eventType: "confirmed" | "cancelled";
  participantEmail: string;
  participantName: string;
  session: SessionInfo;
}) {
  const resend = getResend();
  const sender = from();
  const adminEmail =
    process.env.ADMIN_NOTIFICATION_EMAIL || DEFAULT_ADMIN_NOTIFICATION_EMAIL;
  if (!resend || !sender || !adminEmail) return;

  const eventLabel = params.eventType === "confirmed" ? "CONFIRMED" : "CANCELLED";
  const dateLabel = fmtDate(params.session.date);
  const timeLabel = `${fmtTime(params.session.start_time)} – ${fmtTime(params.session.end_time)}`;

  await resend.emails.send({
    from: sender,
    to: adminEmail,
    subject: `[Booking ${eventLabel}] ${params.participantName} · ${dateLabel} ${timeLabel}`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 620px; margin: 0 auto; color: #1f2937;">
        <h2 style="color: #111827; margin-bottom: 8px;">Booking ${eventLabel}</h2>
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
          <tr><td style="padding: 8px 0; color: #6b7280; width: 180px;">Participant</td><td style="padding: 8px 0; color: #111827; font-weight: 500;">${params.participantName}</td></tr>
          <tr><td style="padding: 8px 0; color: #6b7280;">Email</td><td style="padding: 8px 0; color: #111827; font-weight: 500;">${params.participantEmail}</td></tr>
          <tr><td style="padding: 8px 0; color: #6b7280;">Date</td><td style="padding: 8px 0; color: #111827; font-weight: 500;">${dateLabel}</td></tr>
          <tr><td style="padding: 8px 0; color: #6b7280;">Time</td><td style="padding: 8px 0; color: #111827; font-weight: 500;">${timeLabel}</td></tr>
          <tr><td style="padding: 8px 0; color: #6b7280;">Location</td><td style="padding: 8px 0; color: #111827; font-weight: 500;">${locationStr(params.session)}</td></tr>
        </table>
      </div>`,
  });
}

export async function sendConfirmationEmail(
  email: string,
  fullName: string,
  bookingId: string,
  session: SessionInfo,
  baseUrl: string,
  alternatives?: AlternativeInfo[]
) {
  const resend = getResend();
  const sender = from();
  if (!resend || !sender) return;

  const cancelUrl = `${baseUrl}/cancel?token=${bookingId}`;
  const dateStr = fmtDate(session.date);

  await resend.emails.send({
    from: sender,
    to: email,
    subject: `Session Confirmed — ${dateStr}`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 520px; margin: 0 auto; color: #1f2937;">
        <h2 style="color: #111827; margin-bottom: 4px;">Your Session is Confirmed</h2>
        <p style="color: #6b7280; margin-top: 0;">Hi ${fullName}, you have been assigned to the following session:</p>
        <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
          <tr><td style="padding: 8px 0; color: #6b7280; width: 100px;">Date</td><td style="padding: 8px 0; color: #111827; font-weight: 500;">${dateStr}</td></tr>
          <tr><td style="padding: 8px 0; color: #6b7280;">Time</td><td style="padding: 8px 0; color: #111827; font-weight: 500;">${fmtTime(session.start_time)} – ${fmtTime(session.end_time)}</td></tr>
          <tr><td style="padding: 8px 0; color: #6b7280;">Location</td><td style="padding: 8px 0; color: #111827; font-weight: 500;">${locationStr(session)}</td></tr>
        </table>
        ${renderAlternatives(alternatives)}
        <p style="margin: 24px 0 8px; color: #6b7280; font-size: 14px;">Need to cancel? Click below:</p>
        <a href="${cancelUrl}" style="display: inline-block; background: #dc2626; color: #fff; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 500;">Cancel Booking</a>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 32px 0 16px;" />
        <p style="color: #9ca3af; font-size: 13px; margin: 0;">Best regards,<br /><strong style="color: #6b7280;">AEyeCoL Research Team</strong></p>
      </div>`,
  });
}

export async function sendApplicationReceivedEmail(
  email: string,
  fullName: string
) {
  const resend = getResend();
  const sender = from();
  if (!resend || !sender) return;

  await resend.emails.send({
    from: sender,
    to: email,
    subject: "Application Received — AEyeCoL Study",
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 520px; margin: 0 auto; color: #1f2937;">
        <h2 style="color: #111827; margin-bottom: 4px;">Application Received</h2>
        <p style="color: #6b7280; margin-top: 0;">Hi ${fullName},</p>
        <p style="color: #374151; line-height: 1.6;">Thank you for submitting your session preferences. We have received your application and will review it shortly.</p>
        <p style="color: #374151; line-height: 1.6;">You will receive another email once your session has been confirmed.</p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 32px 0 16px;" />
        <p style="color: #9ca3af; font-size: 13px; margin: 0;">Best regards,<br /><strong style="color: #6b7280;">AEyeCoL Research Team</strong></p>
      </div>`,
  });
}

export async function sendSessionMovedEmail(
  email: string,
  fullName: string,
  bookingId: string,
  oldSession: SessionInfo,
  newSession: SessionInfo,
  baseUrl: string
) {
  const resend = getResend();
  const sender = from();
  if (!resend || !sender) return;

  const cancelUrl = `${baseUrl}/cancel?token=${bookingId}`;
  const confirmUrl = `${baseUrl}/confirm-move?token=${bookingId}`;

  await resend.emails.send({
    from: sender,
    to: email,
    subject: `Session Changed — ${fmtDate(newSession.date)}`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 520px; margin: 0 auto; color: #1f2937;">
        <h2 style="color: #111827; margin-bottom: 4px;">Your Session Has Been Changed</h2>
        <p style="color: #6b7280; margin-top: 0;">Hi ${fullName}, your session has been moved by the research team.</p>
        <p style="color: #6b7280; font-size: 14px; margin: 16px 0 4px;"><strong style="color: #111827;">Previous Session:</strong></p>
        <table style="width: 100%; border-collapse: collapse;">
          <tr><td style="padding: 4px 0; color: #9ca3af; width: 80px; text-decoration: line-through;">${fmtDate(oldSession.date)}</td></tr>
          <tr><td style="padding: 4px 0; color: #9ca3af; text-decoration: line-through;">${fmtTime(oldSession.start_time)} – ${fmtTime(oldSession.end_time)} · ${locationStr(oldSession)}</td></tr>
        </table>
        <p style="color: #6b7280; font-size: 14px; margin: 16px 0 4px;"><strong style="color: #111827;">New Session:</strong></p>
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
          <tr><td style="padding: 8px 0; color: #6b7280; width: 100px;">Date</td><td style="padding: 8px 0; color: #111827; font-weight: 500;">${fmtDate(newSession.date)}</td></tr>
          <tr><td style="padding: 8px 0; color: #6b7280;">Time</td><td style="padding: 8px 0; color: #111827; font-weight: 500;">${fmtTime(newSession.start_time)} – ${fmtTime(newSession.end_time)}</td></tr>
          <tr><td style="padding: 8px 0; color: #6b7280;">Location</td><td style="padding: 8px 0; color: #111827; font-weight: 500;">${locationStr(newSession)}</td></tr>
        </table>
        <p style="margin: 24px 0 10px; color: #6b7280; font-size: 14px;">Please let us know if this works for you:</p>
        <a href="${confirmUrl}" style="display: inline-block; background: #16a34a; color: #fff; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 500; margin-right: 8px;">Confirm</a>
        <a href="${cancelUrl}" style="display: inline-block; background: #dc2626; color: #fff; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 500;">Cancel Booking</a>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 32px 0 16px;" />
        <p style="color: #9ca3af; font-size: 13px; margin: 0;">Best regards,<br /><strong style="color: #6b7280;">AEyeCoL Research Team</strong></p>
      </div>`,
  });
}

export async function sendCustomEmail(
  email: string,
  fullName: string,
  subject: string,
  message: string
) {
  const resend = getResend();
  const sender = from();
  if (!resend || !sender) return;

  const greeting = fullName ? `Hi ${fullName},` : "Hello,";

  await resend.emails.send({
    from: sender,
    to: email,
    subject,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 520px; margin: 0 auto; color: #1f2937;">
        <p style="color: #6b7280; margin-top: 0;">${greeting}</p>
        <div style="color: #374151; line-height: 1.6; white-space: pre-wrap;">${message}</div>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 32px 0 16px;" />
        <p style="color: #9ca3af; font-size: 13px; margin: 0;">Best regards,<br /><strong style="color: #6b7280;">AEyeCoL Research Team</strong></p>
      </div>`,
  });
}

export async function sendCancellationConfirmationEmail(
  email: string,
  fullName: string,
  session: SessionInfo,
  baseUrl?: string
) {
  const resend = getResend();
  const sender = from();
  if (!resend || !sender) return;

  const bookAgainButton = baseUrl
    ? `
        <p style="margin: 24px 0 8px; color: #6b7280; font-size: 14px;">Want to book another session?</p>
        <a href="${baseUrl}" style="display: inline-block; background: #2563eb; color: #fff; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 500;">Book a New Session</a>`
    : `<p style="color: #374151; line-height: 1.6;">If this was a mistake, please visit our booking page to submit a new application.</p>`;

  await resend.emails.send({
    from: sender,
    to: email,
    subject: `Booking Cancelled — ${fmtDate(session.date)}`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 520px; margin: 0 auto; color: #1f2937;">
        <h2 style="color: #111827; margin-bottom: 4px;">Booking Cancelled</h2>
        <p style="color: #6b7280; margin-top: 0;">Hi ${fullName},</p>
        <p style="color: #374151; line-height: 1.6;">Your booking for the following session has been cancelled:</p>
        <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
          <tr><td style="padding: 8px 0; color: #6b7280; width: 100px;">Date</td><td style="padding: 8px 0; color: #111827; font-weight: 500;">${fmtDate(session.date)}</td></tr>
          <tr><td style="padding: 8px 0; color: #6b7280;">Time</td><td style="padding: 8px 0; color: #111827; font-weight: 500;">${fmtTime(session.start_time)} – ${fmtTime(session.end_time)}</td></tr>
          <tr><td style="padding: 8px 0; color: #6b7280;">Location</td><td style="padding: 8px 0; color: #111827; font-weight: 500;">${locationStr(session)}</td></tr>
        </table>
        ${bookAgainButton}
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 32px 0 16px;" />
        <p style="color: #9ca3af; font-size: 13px; margin: 0;">Best regards,<br /><strong style="color: #6b7280;">AEyeCoL Research Team</strong></p>
      </div>`,
  });
}

export async function sendMovedToPreferredEmail(
  email: string,
  fullName: string,
  bookingId: string,
  oldSession: SessionInfo,
  newSession: SessionInfo,
  baseUrl: string
) {
  const resend = getResend();
  const sender = from();
  if (!resend || !sender) return;

  const cancelUrl = `${baseUrl}/cancel?token=${bookingId}`;

  await resend.emails.send({
    from: sender,
    to: email,
    subject: `Good News — Moved to Your Preferred Session`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 520px; margin: 0 auto; color: #1f2937;">
        <h2 style="color: #111827; margin-bottom: 4px;">Good News!</h2>
        <p style="color: #6b7280; margin-top: 0;">Hi ${fullName}, a spot has opened in your higher-preference session. You have been automatically moved to this time slot.</p>
        <p style="color: #6b7280; font-size: 14px; margin: 16px 0 4px;"><strong style="color: #111827;">Previous Session:</strong></p>
        <table style="width: 100%; border-collapse: collapse;">
          <tr><td style="padding: 4px 0; color: #9ca3af; text-decoration: line-through;">${fmtDate(oldSession.date)} · ${fmtTime(oldSession.start_time)} – ${fmtTime(oldSession.end_time)} · ${locationStr(oldSession)}</td></tr>
        </table>
        <p style="color: #6b7280; font-size: 14px; margin: 16px 0 4px;"><strong style="color: #111827;">New Session:</strong></p>
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
          <tr><td style="padding: 8px 0; color: #6b7280; width: 100px;">Date</td><td style="padding: 8px 0; color: #111827; font-weight: 500;">${fmtDate(newSession.date)}</td></tr>
          <tr><td style="padding: 8px 0; color: #6b7280;">Time</td><td style="padding: 8px 0; color: #111827; font-weight: 500;">${fmtTime(newSession.start_time)} – ${fmtTime(newSession.end_time)}</td></tr>
          <tr><td style="padding: 8px 0; color: #6b7280;">Location</td><td style="padding: 8px 0; color: #111827; font-weight: 500;">${locationStr(newSession)}</td></tr>
        </table>
        <div style="margin: 20px 0; padding: 12px 14px; background: #fff7ed; border: 1px solid #fed7aa; border-radius: 10px; color: #9a3412; font-size: 13px; line-height: 1.5;">
          <strong>Please review the new time.</strong> If this new slot does not work for you, cancel using the button below — your previous slot cannot be restored automatically, so please act promptly and, if needed, submit a fresh booking.
        </div>
        <p style="margin: 24px 0 8px; color: #6b7280; font-size: 14px;">Need to cancel? Click below:</p>
        <a href="${cancelUrl}" style="display: inline-block; background: #dc2626; color: #fff; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 500;">Cancel Booking</a>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 32px 0 16px;" />
        <p style="color: #9ca3af; font-size: 13px; margin: 0;">Best regards,<br /><strong style="color: #6b7280;">AEyeCoL Research Team</strong></p>
      </div>`,
  });
}

export async function sendBackfillConfirmationEmail(
  email: string,
  fullName: string,
  bookingId: string,
  session: SessionInfo,
  baseUrl: string,
  alternatives?: AlternativeInfo[]
) {
  const resend = getResend();
  const sender = from();
  if (!resend || !sender) return;

  const cancelUrl = `${baseUrl}/cancel?token=${bookingId}`;
  const dateStr = fmtDate(session.date);

  await resend.emails.send({
    from: sender,
    to: email,
    subject: `Good News — A Spot Has Opened Up!`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 520px; margin: 0 auto; color: #1f2937;">
        <h2 style="color: #111827; margin-bottom: 4px;">A Spot Opened Up!</h2>
        <p style="color: #6b7280; margin-top: 0;">Hi ${fullName}, great news! A spot has become available and you have been <strong>automatically confirmed</strong> for the following session:</p>
        <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
          <tr><td style="padding: 8px 0; color: #6b7280; width: 100px;">Date</td><td style="padding: 8px 0; color: #111827; font-weight: 500;">${dateStr}</td></tr>
          <tr><td style="padding: 8px 0; color: #6b7280;">Time</td><td style="padding: 8px 0; color: #111827; font-weight: 500;">${fmtTime(session.start_time)} – ${fmtTime(session.end_time)}</td></tr>
          <tr><td style="padding: 8px 0; color: #6b7280;">Location</td><td style="padding: 8px 0; color: #111827; font-weight: 500;">${locationStr(session)}</td></tr>
        </table>
        ${renderAlternatives(alternatives)}
        <p style="margin: 24px 0 8px; color: #6b7280; font-size: 14px;">Need to cancel? Click below:</p>
        <a href="${cancelUrl}" style="display: inline-block; background: #dc2626; color: #fff; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 500;">Cancel Booking</a>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 32px 0 16px;" />
        <p style="color: #9ca3af; font-size: 13px; margin: 0;">Best regards,<br /><strong style="color: #6b7280;">AEyeCoL Research Team</strong></p>
      </div>`,
  });
}

export async function sendStartingSoonEmail(
  email: string,
  fullName: string,
  session: SessionInfo
) {
  const resend = getResend();
  const sender = from();
  if (!resend || !sender) return;

  const dateStr = fmtDate(session.date);

  await resend.emails.send({
    from: sender,
    to: email,
    subject: `Your study session starts soon!`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 520px; margin: 0 auto; color: #1f2937;">
        <h2 style="color: #111827; margin-bottom: 4px;">Starting Soon!</h2>
        <p style="color: #6b7280; margin-top: 0;">Hi ${fullName}, your study session is starting very soon. Please make sure you are ready!</p>
        <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
          <tr><td style="padding: 8px 0; color: #6b7280; width: 100px;">Date</td><td style="padding: 8px 0; color: #111827; font-weight: 500;">${dateStr}</td></tr>
          <tr><td style="padding: 8px 0; color: #6b7280;">Time</td><td style="padding: 8px 0; color: #111827; font-weight: 500;">${fmtTime(session.start_time)} – ${fmtTime(session.end_time)}</td></tr>
          <tr><td style="padding: 8px 0; color: #6b7280;">Location</td><td style="padding: 8px 0; color: #111827; font-weight: 500;">${locationStr(session)}</td></tr>
        </table>
        <p style="color: #374151; line-height: 1.6;">Please make sure to arrive on time. We look forward to seeing you!</p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 32px 0 16px;" />
        <p style="color: #9ca3af; font-size: 13px; margin: 0;">Best regards,<br /><strong style="color: #6b7280;">AEyeCoL Research Team</strong></p>
      </div>`,
  });
}

export async function sendSessionCancelledByAdminEmail(params: {
  email: string;
  fullName: string;
  cancelledSession: SessionInfo;
  movedToSession?: SessionInfo | null;
  bookingId?: string | null;
  baseUrl: string;
}) {
  const resend = getResend();
  const sender = from();
  if (!resend || !sender) return;

  const { email, fullName, cancelledSession, movedToSession, bookingId, baseUrl } = params;
  const dateStr = fmtDate(cancelledSession.date);

  const movedBlock = movedToSession
    ? `
        <div style="margin: 20px 0; padding: 14px 16px; background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 10px;">
          <div style="font-size: 14px; font-weight: 600; color: #065f46; margin-bottom: 6px;">You have been moved to your backup session</div>
          <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
            <tr><td style="padding: 4px 10px 4px 0; color: #065f46; white-space: nowrap;">Date</td><td style="padding: 4px 0; color: #064e3b; font-weight: 500;">${fmtDate(movedToSession.date)}</td></tr>
            <tr><td style="padding: 4px 10px 4px 0; color: #065f46; white-space: nowrap;">Time</td><td style="padding: 4px 0; color: #064e3b; font-weight: 500;">${fmtTime(movedToSession.start_time)} – ${fmtTime(movedToSession.end_time)}</td></tr>
            <tr><td style="padding: 4px 10px 4px 0; color: #065f46; white-space: nowrap;">Location</td><td style="padding: 4px 0; color: #064e3b; font-weight: 500;">${locationStr(movedToSession)}</td></tr>
          </table>
          ${bookingId ? `<p style="margin: 12px 0 0; font-size: 13px; color: #065f46;">If this backup time does not work, you can <a href="${baseUrl}/cancel?token=${bookingId}" style="color: #047857; text-decoration: underline;">cancel this booking</a> and submit a new one.</p>` : ""}
        </div>`
    : `
        <div style="margin: 20px 0; padding: 14px 16px; background: #fef3c7; border: 1px solid #fcd34d; border-radius: 10px;">
          <div style="font-size: 14px; font-weight: 600; color: #92400e; margin-bottom: 6px;">No backup session available</div>
          <p style="margin: 0; font-size: 13px; color: #92400e;">We could not automatically place you in one of your backup choices (none were provided, or they were full). Please submit a new booking using the button below.</p>
        </div>`;

  await resend.emails.send({
    from: sender,
    to: email,
    subject: `Session Cancelled — ${dateStr}`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 520px; margin: 0 auto; color: #1f2937;">
        <h2 style="color: #dc2626; margin-bottom: 4px;">Session Cancelled</h2>
        <p style="color: #6b7280; margin-top: 0;">Hi ${fullName}, we're sorry to inform you that the following session has been <strong>cancelled</strong> by the research team.</p>
        <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
          <tr><td style="padding: 8px 0; color: #6b7280; width: 100px;">Date</td><td style="padding: 8px 0; color: #111827; font-weight: 500; text-decoration: line-through;">${dateStr}</td></tr>
          <tr><td style="padding: 8px 0; color: #6b7280;">Time</td><td style="padding: 8px 0; color: #111827; font-weight: 500; text-decoration: line-through;">${fmtTime(cancelledSession.start_time)} – ${fmtTime(cancelledSession.end_time)}</td></tr>
          <tr><td style="padding: 8px 0; color: #6b7280;">Location</td><td style="padding: 8px 0; color: #111827; font-weight: 500; text-decoration: line-through;">${locationStr(cancelledSession)}</td></tr>
        </table>
        ${movedBlock}
        <p style="margin: 24px 0 8px; color: #6b7280; font-size: 14px;">Looking for another time?</p>
        <a href="${baseUrl}" style="display: inline-block; background: #2563eb; color: #fff; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 500;">Book a New Session</a>
        <p style="color: #374151; line-height: 1.6; margin-top: 24px;">We apologize for the inconvenience.</p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 32px 0 16px;" />
        <p style="color: #9ca3af; font-size: 13px; margin: 0;">Best regards,<br /><strong style="color: #6b7280;">AEyeCoL Research Team</strong></p>
      </div>`,
  });
}

export async function sendSubscribedEmail(
  email: string,
  fullName: string,
  unsubscribeToken: string,
  baseUrl: string
) {
  const resend = getResend();
  const sender = from();
  if (!resend || !sender) return;

  const greeting = fullName ? `Hi ${fullName},` : "Hello,";
  const unsubscribeUrl = `${baseUrl}/unsubscribe?token=${unsubscribeToken}`;

  await resend.emails.send({
    from: sender,
    to: email,
    subject: "You're on the notification list — AEyeCoL Study",
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 520px; margin: 0 auto; color: #1f2937;">
        <h2 style="color: #111827; margin-bottom: 4px;">You're Subscribed</h2>
        <p style="color: #6b7280; margin-top: 0;">${greeting}</p>
        <p style="color: #374151; line-height: 1.6;">We'll email you as soon as a new study session is added. No further action is needed on your part.</p>
        <p style="color: #9ca3af; font-size: 13px; margin-top: 24px;">Changed your mind? <a href="${unsubscribeUrl}" style="color: #2563eb; text-decoration: underline;">Unsubscribe here</a>.</p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 32px 0 16px;" />
        <p style="color: #9ca3af; font-size: 13px; margin: 0;">Best regards,<br /><strong style="color: #6b7280;">AEyeCoL Research Team</strong></p>
      </div>`,
  });
}

export async function sendNewSessionAvailableEmail(params: {
  email: string;
  fullName: string | null;
  session: SessionInfo;
  unsubscribeToken: string;
  baseUrl: string;
}) {
  const resend = getResend();
  const sender = from();
  if (!resend || !sender) return;

  const { email, fullName, session, unsubscribeToken, baseUrl } = params;
  const greeting = fullName ? `Hi ${fullName},` : "Hello,";
  const unsubscribeUrl = `${baseUrl}/unsubscribe?token=${unsubscribeToken}`;
  const dateStr = fmtDate(session.date);

  await resend.emails.send({
    from: sender,
    to: email,
    subject: `New Study Session Available — ${dateStr}`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 520px; margin: 0 auto; color: #1f2937;">
        <h2 style="color: #111827; margin-bottom: 4px;">A New Session Is Open</h2>
        <p style="color: #6b7280; margin-top: 0;">${greeting}</p>
        <p style="color: #374151; line-height: 1.6;">Good news — a new study session has just been added. Spots fill quickly, so book soon:</p>
        <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
          <tr><td style="padding: 8px 0; color: #6b7280; width: 100px;">Date</td><td style="padding: 8px 0; color: #111827; font-weight: 500;">${dateStr}</td></tr>
          <tr><td style="padding: 8px 0; color: #6b7280;">Time</td><td style="padding: 8px 0; color: #111827; font-weight: 500;">${fmtTime(session.start_time)} – ${fmtTime(session.end_time)}</td></tr>
          <tr><td style="padding: 8px 0; color: #6b7280;">Location</td><td style="padding: 8px 0; color: #111827; font-weight: 500;">${locationStr(session)}</td></tr>
        </table>
        <a href="${baseUrl}" style="display: inline-block; background: #2563eb; color: #fff; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 500;">Book This Session</a>
        <p style="color: #9ca3af; font-size: 13px; margin-top: 24px;">Don't want these notifications? <a href="${unsubscribeUrl}" style="color: #2563eb; text-decoration: underline;">Unsubscribe here</a>.</p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 32px 0 16px;" />
        <p style="color: #9ca3af; font-size: 13px; margin: 0;">Best regards,<br /><strong style="color: #6b7280;">AEyeCoL Research Team</strong></p>
      </div>`,
  });
}

export async function sendNoSpotsEmail(
  email: string,
  fullName: string,
  baseUrl?: string
) {
  const resend = getResend();
  const sender = from();
  if (!resend || !sender) return;

  const subscribeBlock = baseUrl
    ? `
        <p style="color: #374151; line-height: 1.6; margin-top: 16px;">Want to hear first when new sessions are added? Subscribe below — one click, unsubscribe any time.</p>
        <a href="${baseUrl}/subscribe?email=${encodeURIComponent(email)}&full_name=${encodeURIComponent(fullName)}" style="display: inline-block; background: #2563eb; color: #fff; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 500; margin-top: 4px;">Notify Me About New Sessions</a>`
    : "";

  await resend.emails.send({
    from: sender,
    to: email,
    subject: "Session Availability Update — AEyeCoL Study",
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 520px; margin: 0 auto; color: #1f2937;">
        <h2 style="color: #111827; margin-bottom: 4px;">Availability Update</h2>
        <p style="color: #6b7280; margin-top: 0;">Hi ${fullName},</p>
        <p style="color: #374151; line-height: 1.6;">Thank you for your application. All your selected sessions are currently full. We will notify you if a spot becomes available.</p>
        ${subscribeBlock}
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 32px 0 16px;" />
        <p style="color: #9ca3af; font-size: 13px; margin: 0;">Best regards,<br /><strong style="color: #6b7280;">AEyeCoL Research Team</strong></p>
      </div>`,
  });
}

export async function sendNoSpotsFinalEmail(
  email: string,
  fullName: string,
  baseUrl: string
) {
  const resend = getResend();
  const sender = from();
  if (!resend || !sender) return;

  await resend.emails.send({
    from: sender,
    to: email,
    subject: "Session Availability Update — AEyeCoL Study",
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 520px; margin: 0 auto; color: #1f2937;">
        <h2 style="color: #111827; margin-bottom: 4px;">Availability Update</h2>
        <p style="color: #6b7280; margin-top: 0;">Hi ${fullName},</p>
        <p style="color: #374151; line-height: 1.6;">Unfortunately, all sessions you selected are now full. Please visit <a href="${baseUrl}" style="color: #2563eb; text-decoration: underline;">${baseUrl}</a> to submit a new application.</p>
        <p style="color: #374151; line-height: 1.6; margin-top: 16px;">Want to hear first when new sessions are added? Subscribe below — one click, unsubscribe any time.</p>
        <a href="${baseUrl}/subscribe?email=${encodeURIComponent(email)}&full_name=${encodeURIComponent(fullName)}" style="display: inline-block; background: #2563eb; color: #fff; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 500; margin-top: 4px;">Notify Me About New Sessions</a>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 32px 0 16px;" />
        <p style="color: #9ca3af; font-size: 13px; margin: 0;">Best regards,<br /><strong style="color: #6b7280;">AEyeCoL Research Team</strong></p>
      </div>`,
  });
}
