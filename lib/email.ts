import { Resend } from "resend";

interface SessionInfo {
  date: string;
  start_time: string;
  end_time: string;
  location: string;
  room: string | null;
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

export async function sendConfirmationEmail(
  email: string,
  fullName: string,
  bookingId: string,
  session: SessionInfo,
  baseUrl: string
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
        <p style="margin: 24px 0 8px; color: #6b7280; font-size: 14px;">Need to cancel? Click below:</p>
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
  session: SessionInfo
) {
  const resend = getResend();
  const sender = from();
  if (!resend || !sender) return;

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
        <p style="color: #374151; line-height: 1.6;">If this was a mistake, please visit our booking page to submit a new application.</p>
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
        <p style="color: #6b7280; margin-top: 0;">Hi ${fullName}, a spot has opened in your preferred session. You have been moved automatically.</p>
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
  baseUrl: string
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

export async function sendNoSpotsEmail(email: string, fullName: string) {
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
        <p style="color: #374151; line-height: 1.6;">Thank you for your application. All your selected sessions are currently full. We will notify you if a spot becomes available.</p>
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
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 32px 0 16px;" />
        <p style="color: #9ca3af; font-size: 13px; margin: 0;">Best regards,<br /><strong style="color: #6b7280;">AEyeCoL Research Team</strong></p>
      </div>`,
  });
}
