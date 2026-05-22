# Bounced Email Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Log every automated outbound email with its Resend ID, then let the admin view bounced emails from the last 24 h and manually resend them using `mingcong.ding@tum.de` as the sender.

**Architecture:** A new `email_logs` Supabase table stores the Resend email ID, type, and enough context to reconstruct each email. A new API route queries Resend for bounce status on refresh and handles resend logic. The admin page gains a collapsible "Bounced Emails" section.

**Tech Stack:** Next.js 15 App Router, Supabase (supabase-admin client), Resend SDK, TypeScript, Tailwind CSS.

**Spec:** `docs/superpowers/specs/2026-05-22-bounced-email-tracker-design.md`

---

## File Map

| File | Action | Purpose |
|---|---|---|
| Supabase Dashboard | SQL | Create `email_logs` table |
| `lib/email-log.ts` | Create | `logEmail()` helper — writes to `email_logs` |
| `lib/email.ts` | Modify | All `send*` functions return `Promise<string \| null>`, accept `fromOverride?`, add `sendDayBeforeReminderEmail` + `sendThreeHoursReminderEmail` |
| `lib/assign.ts` | Modify | Log all email sends |
| `lib/cleanup.ts` | Modify | Log all email sends |
| `app/api/bookings/route.ts` | Modify | Log `sendNoSpotsEmail` |
| `app/api/admin/bookings/route.ts` | Modify | Log `sendConfirmationEmail`, `sendSessionMovedEmail`, `sendCancellationConfirmationEmail` |
| `app/api/bookings/cancel/route.ts` | Modify | Log `sendCancellationConfirmationEmail` |
| `app/api/subscribers/route.ts` | Modify | Log `sendSubscribedEmail` |
| `app/api/admin/sessions/route.ts` | Modify | Log `sendSessionCancelledByAdminEmail`, `sendNewSessionAvailableEmail` |
| `app/api/reminders/day-before/route.ts` | Modify | Use `sendDayBeforeReminderEmail` from lib + log |
| `app/api/reminders/three-hours/route.ts` | Modify | Use `sendThreeHoursReminderEmail` from lib + log |
| `app/api/admin/bounced-emails/route.ts` | Create | GET (list bounced in last 24 h) + POST (resend) |
| `app/admin/page.tsx` | Modify | Add Bounced Emails section, capture password in state |

---

## Task 1: Create `email_logs` table

**Files:**
- Supabase Dashboard → SQL Editor

- [ ] **Step 1: Run migration SQL**

In Supabase Dashboard → SQL Editor, run:

```sql
create table email_logs (
  id              uuid primary key default gen_random_uuid(),
  resend_email_id text not null,
  email_type      text not null,
  booking_id      uuid references bookings(id) on delete set null,
  to_email        text not null,
  to_name         text not null default '',
  extra           jsonb,
  sent_at         timestamptz not null default now()
);

create index email_logs_sent_at_idx on email_logs(sent_at desc);
create index email_logs_booking_id_idx on email_logs(booking_id);
```

- [ ] **Step 2: Verify**

In Supabase Table Editor, confirm `email_logs` exists with all columns.

---

## Task 2: Create `lib/email-log.ts`

**Files:**
- Create: `lib/email-log.ts`

- [ ] **Step 1: Create the file**

```typescript
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
```

- [ ] **Step 2: Commit**

```bash
git add lib/email-log.ts
git commit -m "feat: add email_logs table and logEmail helper"
```

---

## Task 3: Modify `lib/email.ts` — return IDs, add `fromOverride`, add reminder functions

**Files:**
- Modify: `lib/email.ts`

Every `send*` function that is tracked needs two changes:
1. Add optional `fromOverride?: string` as last parameter
2. Change return type to `Promise<string | null>` and return the Resend email ID

Also add two new functions (`sendDayBeforeReminderEmail`, `sendThreeHoursReminderEmail`) so reminder routes can use them.

- [ ] **Step 1: Update `getResend` and `from` are already helpers — no change needed. Update the functions listed below.**

For each function below, apply the same pattern:
- Signature: add `fromOverride?: string` as last param
- Inside: change `const sender = from();` to `const sender = fromOverride ?? from();`
- Change `if (!resend || !sender) return;` to `if (!resend || !sender) return null;`
- Capture send result: `const { data } = await resend.emails.send({...});`
- Return: `return data?.id ?? null;`

**Functions to update** (apply pattern to each, only showing signature + return type change for brevity — the HTML bodies are unchanged):

`sendAdminBookingEventEmail` — keep return `void`, no logging needed, no fromOverride needed. Skip this one.

`sendConfirmationEmail`:
```typescript
export async function sendConfirmationEmail(
  email: string,
  fullName: string,
  bookingId: string,
  session: SessionInfo,
  baseUrl: string,
  alternatives?: AlternativeInfo[],
  fromOverride?: string
): Promise<string | null> {
  const resend = getResend();
  const sender = fromOverride ?? from();
  if (!resend || !sender) return null;
  // ... (HTML body unchanged) ...
  const { data } = await resend.emails.send({ from: sender, to: email, subject: `Session Confirmed — ${dateStr}`, html: `...` });
  return data?.id ?? null;
}
```

Apply the same pattern to all of the following (add `fromOverride?: string` last param, return `Promise<string | null>`, capture `data`, return `data?.id ?? null`):
- `sendApplicationReceivedEmail`
- `sendSessionMovedEmail`
- `sendCancellationConfirmationEmail`
- `sendMovedToPreferredEmail`
- `sendBackfillConfirmationEmail`
- `sendStartingSoonEmail`
- `sendSessionCancelledByAdminEmail`
- `sendSubscribedEmail`
- `sendNewSessionAvailableEmail`
- `sendNoSpotsEmail`
- `sendNoSpotsFinalEmail`

`sendCustomEmail` — no fromOverride, keep return `void` (not tracked). Skip.

- [ ] **Step 2: Add `sendDayBeforeReminderEmail` to `lib/email.ts`**

Add this function at the end of `lib/email.ts`. The HTML body is extracted from `app/api/reminders/day-before/route.ts`:

```typescript
const CONFIRMED_NOTICE_DAY_BEFORE = `
  <div style="margin: 16px 0; padding: 14px 16px; background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 10px; color: #065f46; font-size: 14px; line-height: 1.5;">
    <strong>This session is confirmed and will run.</strong> 3 or more participants are registered, so please make sure to attend on time — others are counting on you.
  </div>`;

export async function sendDayBeforeReminderEmail(
  email: string,
  fullName: string,
  bookingId: string,
  session: SessionInfo,
  baseUrl: string,
  isConfirmed: boolean,
  fromOverride?: string
): Promise<string | null> {
  const resend = getResend();
  const sender = fromOverride ?? from();
  if (!resend || !sender) return null;

  const cancelUrl = `${baseUrl}/cancel?token=${bookingId}`;
  const dateStr = fmtDate(session.date);

  const { data } = await resend.emails.send({
    from: sender,
    to: email,
    subject: `Reminder: Your study session is in 24 hours`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 520px; margin: 0 auto; color: #1f2937;">
        <h2 style="color: #111827; margin-bottom: 4px;">Session Reminder</h2>
        <p style="color: #6b7280; margin-top: 0;">Hi ${fullName}, this is a friendly reminder that your study session starts in <strong>24 hours</strong>.</p>
        ${isConfirmed ? CONFIRMED_NOTICE_DAY_BEFORE : ""}
        <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
          <tr><td style="padding: 8px 0; color: #6b7280; width: 100px;">Date</td><td style="padding: 8px 0; color: #111827; font-weight: 500;">${dateStr}</td></tr>
          <tr><td style="padding: 8px 0; color: #6b7280;">Time</td><td style="padding: 8px 0; color: #111827; font-weight: 500;">${fmtTime(session.start_time)} – ${fmtTime(session.end_time)}</td></tr>
          <tr><td style="padding: 8px 0; color: #6b7280;">Location</td><td style="padding: 8px 0; color: #111827; font-weight: 500;">${locationStr(session)}</td></tr>
        </table>
        <p style="margin: 24px 0 8px; color: #6b7280; font-size: 14px;">Can no longer make it? Cancel below:</p>
        <a href="${cancelUrl}" style="display: inline-block; background: #dc2626; color: #fff; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 500;">Cancel Booking</a>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 32px 0 16px;" />
        <p style="color: #9ca3af; font-size: 13px; margin: 0;">Best regards,<br /><strong style="color: #6b7280;">AEyeCoL Research Team</strong></p>
      </div>`,
  });
  return data?.id ?? null;
}
```

- [ ] **Step 3: Add `sendThreeHoursReminderEmail` to `lib/email.ts`**

```typescript
const CONFIRMED_NOTICE_THREE_HOURS = `
  <div style="margin: 16px 0; padding: 14px 16px; background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 10px; color: #065f46; font-size: 14px; line-height: 1.5;">
    <strong>This session is confirmed and will run.</strong> 3 or more participants are registered, so please make sure to attend on time — others are counting on you.
  </div>`;

export async function sendThreeHoursReminderEmail(
  email: string,
  fullName: string,
  session: SessionInfo,
  isConfirmed: boolean,
  fromOverride?: string
): Promise<string | null> {
  const resend = getResend();
  const sender = fromOverride ?? from();
  if (!resend || !sender) return null;

  const dateStr = fmtDate(session.date);

  const { data } = await resend.emails.send({
    from: sender,
    to: email,
    subject: `Your study session starts in 3 hours`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 520px; margin: 0 auto; color: #1f2937;">
        <h2 style="color: #111827; margin-bottom: 4px;">Starting Soon!</h2>
        <p style="color: #6b7280; margin-top: 0;">Hi ${fullName}, your study session starts in approximately <strong>3 hours</strong>.</p>
        ${isConfirmed ? CONFIRMED_NOTICE_THREE_HOURS : ""}
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
  return data?.id ?? null;
}
```

- [ ] **Step 4: Commit**

```bash
git add lib/email.ts
git commit -m "feat: email functions return Resend ID, accept fromOverride, add reminder helpers"
```

---

## Task 4: Instrument `lib/assign.ts`

**Files:**
- Modify: `lib/assign.ts`

- [ ] **Step 1: Add import**

At the top of `lib/assign.ts`, add:
```typescript
import { logEmail } from "./email-log";
```

- [ ] **Step 2: Log `sendMovedToPreferredEmail` (CASE B, around line 184)**

Replace:
```typescript
        if (oldSession) {
          await sendMovedToPreferredEmail(
            email,
            booking.full_name,
            booking.id,
            oldSession,
            booking.sessions,
            baseUrl
          );
        }
```
With:
```typescript
        if (oldSession) {
          const emailId = await sendMovedToPreferredEmail(
            email,
            booking.full_name,
            booking.id,
            oldSession,
            booking.sessions,
            baseUrl
          );
          if (emailId) await logEmail(emailId, {
            emailType: "moved_to_preferred",
            bookingId: booking.id,
            toEmail: email,
            toName: booking.full_name,
            extra: { old_session_id: vacatedSessionId },
          });
        }
```

- [ ] **Step 3: Log `sendConfirmationEmail` (CASE A, around line 242)**

Replace:
```typescript
      if (isBackfill) {
        await sendBackfillConfirmationEmail(
          email, booking.full_name, booking.id, booking.sessions, baseUrl, alternatives
        );
      } else {
        await sendConfirmationEmail(
          email, booking.full_name, booking.id, booking.sessions, baseUrl, alternatives
        );
      }
```
With:
```typescript
      if (isBackfill) {
        const emailId = await sendBackfillConfirmationEmail(
          email, booking.full_name, booking.id, booking.sessions, baseUrl, alternatives
        );
        if (emailId) await logEmail(emailId, {
          emailType: "backfill_confirmation",
          bookingId: booking.id,
          toEmail: email,
          toName: booking.full_name,
        });
      } else {
        const emailId = await sendConfirmationEmail(
          email, booking.full_name, booking.id, booking.sessions, baseUrl, alternatives
        );
        if (emailId) await logEmail(emailId, {
          emailType: "confirmation",
          bookingId: booking.id,
          toEmail: email,
          toName: booking.full_name,
        });
      }
```

- [ ] **Step 4: Log `sendStartingSoonEmail` (two call sites — CASE A and CASE B)**

In `tryConfirm`, `sendStartingSoonEmail` is called in two `try` blocks. Update both:

CASE B (around line 204):
```typescript
      try {
        if (startsWithinThreeHours(booking.sessions)) {
          const emailId = await sendStartingSoonEmail(email, booking.full_name, booking.sessions);
          if (emailId) await logEmail(emailId, {
            emailType: "starting_soon",
            bookingId: booking.id,
            toEmail: email,
            toName: booking.full_name,
          });
        }
      } catch { /* don't break main flow */ }
```

CASE A (around line 257):
```typescript
      try {
        if (startsWithinThreeHours(booking.sessions)) {
          const emailId = await sendStartingSoonEmail(email, booking.full_name, booking.sessions);
          if (emailId) await logEmail(emailId, {
            emailType: "starting_soon",
            bookingId: booking.id,
            toEmail: email,
            toName: booking.full_name,
          });
        }
      } catch { /* don't break main flow */ }
```

- [ ] **Step 5: Log `sendNoSpotsFinalEmail` in `runNightlyAssignment` (around line 398)**

Replace:
```typescript
        await sendNoSpotsFinalEmail(email, personInfo.full_name, baseUrl);
```
With:
```typescript
        const emailId = await sendNoSpotsFinalEmail(email, personInfo.full_name, baseUrl);
        if (emailId) await logEmail(emailId, {
          emailType: "no_spots_final",
          toEmail: email,
          toName: personInfo.full_name,
        });
```

- [ ] **Step 6: Commit**

```bash
git add lib/assign.ts
git commit -m "feat: log emails sent from assign.ts"
```

---

## Task 5: Instrument `lib/cleanup.ts`

**Files:**
- Modify: `lib/cleanup.ts`

- [ ] **Step 1: Add import**

```typescript
import { logEmail } from "./email-log";
```

- [ ] **Step 2: Log `sendSessionMovedEmail` (around line 147)**

Replace:
```typescript
      try {
        await sendSessionMovedEmail(
          booking.email,
          booking.full_name,
          booking.id,
          { date: cancelledSession.date, start_time: cancelledSession.start_time, end_time: cancelledSession.end_time, location: cancelledSession.location, room: cancelledSession.room },
          { date: target.date, start_time: target.start_time, end_time: target.end_time, location: target.location, room: target.room },
          baseUrl
        );
      } catch { /* don't block on email errors */ }
```
With:
```typescript
      try {
        const emailId = await sendSessionMovedEmail(
          booking.email,
          booking.full_name,
          booking.id,
          { date: cancelledSession.date, start_time: cancelledSession.start_time, end_time: cancelledSession.end_time, location: cancelledSession.location, room: cancelledSession.room },
          { date: target.date, start_time: target.start_time, end_time: target.end_time, location: target.location, room: target.room },
          baseUrl
        );
        if (emailId) await logEmail(emailId, {
          emailType: "moved",
          bookingId: booking.id,
          toEmail: booking.email,
          toName: booking.full_name,
          extra: { old_session_id: cancelledSession.id, new_session_id: target.id },
        });
      } catch { /* don't block on email errors */ }
```

- [ ] **Step 3: Log `sendSessionCancelledByAdminEmail` — confirmed booking dropped (around line 175)**

Replace:
```typescript
      try {
        await sendSessionCancelledByAdminEmail({
          email: booking.email,
          fullName: booking.full_name,
          cancelledSession: { ... },
          movedToSession: null,
          bookingId: null,
          baseUrl,
        });
      } catch { /* don't block on email errors */ }
```
With:
```typescript
      try {
        const emailId = await sendSessionCancelledByAdminEmail({
          email: booking.email,
          fullName: booking.full_name,
          cancelledSession: {
            date: cancelledSession.date,
            start_time: cancelledSession.start_time,
            end_time: cancelledSession.end_time,
            location: cancelledSession.location,
            room: cancelledSession.room,
          },
          movedToSession: null,
          bookingId: null,
          baseUrl,
        });
        if (emailId) await logEmail(emailId, {
          emailType: "cancelled_by_admin",
          toEmail: booking.email,
          toName: booking.full_name,
          extra: {
            cancelled_session: {
              date: cancelledSession.date,
              start_time: cancelledSession.start_time,
              end_time: cancelledSession.end_time,
              location: cancelledSession.location,
              room: cancelledSession.room,
            },
            moved_to_session: null,
            booking_id: null,
          },
        });
      } catch { /* don't block on email errors */ }
```

- [ ] **Step 4: Log `sendSessionCancelledByAdminEmail` for pending bookings dropped (around line 224)**

Same pattern — the call is inside a `try` block. Apply the same logging with `extra.cancelled_session`, `extra.moved_to_session: null`, `extra.booking_id: null`.

```typescript
      try {
        const emailId = await sendSessionCancelledByAdminEmail({
          email: b.email,
          fullName: b.full_name,
          cancelledSession: {
            date: cancelledSession.date,
            start_time: cancelledSession.start_time,
            end_time: cancelledSession.end_time,
            location: cancelledSession.location,
            room: cancelledSession.room,
          },
          movedToSession: null,
          bookingId: null,
          baseUrl,
        });
        if (emailId) await logEmail(emailId, {
          emailType: "cancelled_by_admin",
          toEmail: b.email,
          toName: b.full_name,
          extra: {
            cancelled_session: {
              date: cancelledSession.date,
              start_time: cancelledSession.start_time,
              end_time: cancelledSession.end_time,
              location: cancelledSession.location,
              room: cancelledSession.room,
            },
            moved_to_session: null,
            booking_id: null,
          },
        });
      } catch { /* don't block on email errors */ }
```

- [ ] **Step 5: Commit**

```bash
git add lib/cleanup.ts
git commit -m "feat: log emails sent from cleanup.ts"
```

---

## Task 6: Instrument `app/api/bookings/route.ts`

**Files:**
- Modify: `app/api/bookings/route.ts`

- [ ] **Step 1: Add import**

```typescript
import { logEmail } from "@/lib/email-log";
```

- [ ] **Step 2: Log `sendNoSpotsEmail` (around line 91)**

Replace:
```typescript
    await sendNoSpotsEmail(email, full_name, baseUrl);
    return NextResponse.json({ ok: true, confirmed: false });
```
With:
```typescript
    const emailId = await sendNoSpotsEmail(email, full_name, baseUrl);
    if (emailId) await logEmail(emailId, {
      emailType: "no_spots",
      toEmail: email,
      toName: full_name,
    });
    return NextResponse.json({ ok: true, confirmed: false });
```

- [ ] **Step 3: Commit**

```bash
git add app/api/bookings/route.ts
git commit -m "feat: log no_spots email from bookings route"
```

---

## Task 7: Instrument `app/api/admin/bookings/route.ts`

**Files:**
- Modify: `app/api/admin/bookings/route.ts`

- [ ] **Step 1: Add import**

```typescript
import { logEmail } from "@/lib/email-log";
```

- [ ] **Step 2: Log `sendCancellationConfirmationEmail` in delete action (around line 59)**

Replace:
```typescript
      try {
        await sendCancellationConfirmationEmail(
          booking.email,
          booking.full_name,
          booking.sessions,
          baseUrl
        );
      } catch { /* don't block delete if email fails */ }
```
With:
```typescript
      try {
        const emailId = await sendCancellationConfirmationEmail(
          booking.email,
          booking.full_name,
          booking.sessions,
          baseUrl
        );
        if (emailId) await logEmail(emailId, {
          emailType: "cancellation_confirmation",
          toEmail: booking.email,
          toName: booking.full_name,
          extra: { session: booking.sessions },
        });
      } catch { /* don't block delete if email fails */ }
```

- [ ] **Step 3: Log `sendConfirmationEmail` in confirm action (around line 107)**

Replace:
```typescript
    await sendConfirmationEmail(
      booking.email,
      booking.full_name,
      booking.id,
      booking.sessions,
      baseUrl
    );
```
With:
```typescript
    const confirmEmailId = await sendConfirmationEmail(
      booking.email,
      booking.full_name,
      booking.id,
      booking.sessions,
      baseUrl
    );
    if (confirmEmailId) await logEmail(confirmEmailId, {
      emailType: "confirmation",
      bookingId: booking.id,
      toEmail: booking.email,
      toName: booking.full_name,
    });
```

- [ ] **Step 4: Log `sendSessionMovedEmail` in move action (around line 172)**

Replace:
```typescript
    await sendSessionMovedEmail(
      booking.email,
      booking.full_name,
      booking.id,
      booking.sessions,
      targetSession,
      baseUrl
    );
```
With:
```typescript
    const moveEmailId = await sendSessionMovedEmail(
      booking.email,
      booking.full_name,
      booking.id,
      booking.sessions,
      targetSession,
      baseUrl
    );
    if (moveEmailId) await logEmail(moveEmailId, {
      emailType: "moved",
      bookingId: booking.id,
      toEmail: booking.email,
      toName: booking.full_name,
      extra: { old_session_id: oldSessionId, new_session_id: target_session_id },
    });
```

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/bookings/route.ts
git commit -m "feat: log emails sent from admin bookings route"
```

---

## Task 8: Instrument `app/api/bookings/cancel/route.ts`

**Files:**
- Modify: `app/api/bookings/cancel/route.ts`

- [ ] **Step 1: Add import**

```typescript
import { logEmail } from "@/lib/email-log";
```

- [ ] **Step 2: Log `sendCancellationConfirmationEmail` (around line 62)**

Replace:
```typescript
  await sendCancellationConfirmationEmail(
    booking.email,
    booking.full_name,
    sessionInfo,
    baseUrl
  );
```
With:
```typescript
  const cancelEmailId = await sendCancellationConfirmationEmail(
    booking.email,
    booking.full_name,
    sessionInfo,
    baseUrl
  );
  if (cancelEmailId) await logEmail(cancelEmailId, {
    emailType: "cancellation_confirmation",
    toEmail: booking.email,
    toName: booking.full_name,
    extra: { session: sessionInfo },
  });
```

- [ ] **Step 3: Commit**

```bash
git add app/api/bookings/cancel/route.ts
git commit -m "feat: log cancellation email from cancel route"
```

---

## Task 9: Instrument `app/api/subscribers/route.ts`

**Files:**
- Modify: `app/api/subscribers/route.ts`

- [ ] **Step 1: Add import**

```typescript
import { logEmail } from "@/lib/email-log";
```

- [ ] **Step 2: Log `sendSubscribedEmail` (around line 53)**

Replace:
```typescript
  try {
    await sendSubscribedEmail(email, fullName, unsubscribeToken, getBaseUrl(req));
  } catch { /* don't block subscribe if email fails */ }
```
With:
```typescript
  try {
    const emailId = await sendSubscribedEmail(email, fullName, unsubscribeToken, getBaseUrl(req));
    if (emailId) await logEmail(emailId, {
      emailType: "subscribed",
      toEmail: email,
      toName: fullName,
      extra: { unsubscribe_token: unsubscribeToken, base_url: getBaseUrl(req) },
    });
  } catch { /* don't block subscribe if email fails */ }
```

- [ ] **Step 3: Commit**

```bash
git add app/api/subscribers/route.ts
git commit -m "feat: log subscribed email"
```

---

## Task 10: Instrument `app/api/admin/sessions/route.ts`

**Files:**
- Modify: `app/api/admin/sessions/route.ts`

- [ ] **Step 1: Add import**

```typescript
import { logEmail } from "@/lib/email-log";
```

- [ ] **Step 2: Log `sendNewSessionAvailableEmail` in `notifySubscribersOfNewSession` (around line 83)**

Replace:
```typescript
    for (const s of subs) {
      try {
        await sendNewSessionAvailableEmail({
          email: s.email,
          fullName: s.full_name,
          session,
          unsubscribeToken: s.unsubscribe_token,
          baseUrl,
        });
      } catch { /* one failed email shouldn't stop the others */ }
    }
```
With:
```typescript
    for (const s of subs) {
      try {
        const emailId = await sendNewSessionAvailableEmail({
          email: s.email,
          fullName: s.full_name,
          session,
          unsubscribeToken: s.unsubscribe_token,
          baseUrl,
        });
        if (emailId) await logEmail(emailId, {
          emailType: "new_session_available",
          toEmail: s.email,
          toName: s.full_name ?? "",
          extra: { session, unsubscribe_token: s.unsubscribe_token },
        });
      } catch { /* one failed email shouldn't stop the others */ }
    }
```

- [ ] **Step 3: Log `sendSessionCancelledByAdminEmail` in `cancelSessionAndPromote` — confirmed bookings (around line 193)**

Replace:
```typescript
    try {
      await sendSessionCancelledByAdminEmail({
        email: b.email,
        fullName: b.full_name,
        cancelledSession,
        movedToSession,
        bookingId: newBookingId,
        baseUrl,
      });
    } catch { /* don't block if email fails */ }
```
With:
```typescript
    try {
      const emailId = await sendSessionCancelledByAdminEmail({
        email: b.email,
        fullName: b.full_name,
        cancelledSession,
        movedToSession,
        bookingId: newBookingId,
        baseUrl,
      });
      if (emailId) await logEmail(emailId, {
        emailType: "cancelled_by_admin",
        toEmail: b.email,
        toName: b.full_name,
        extra: {
          cancelled_session: cancelledSession,
          moved_to_session: movedToSession ?? null,
          booking_id: newBookingId,
        },
      });
    } catch { /* don't block if email fails */ }
```

- [ ] **Step 4: Log `sendSessionCancelledByAdminEmail` for pending-only participants (around line 222)**

Replace:
```typescript
    try {
      await sendSessionCancelledByAdminEmail({
        email: b.email,
        fullName: b.full_name,
        cancelledSession,
        movedToSession: null,
        bookingId: null,
        baseUrl,
      });
    } catch { /* don't block if email fails */ }
```
With:
```typescript
    try {
      const emailId = await sendSessionCancelledByAdminEmail({
        email: b.email,
        fullName: b.full_name,
        cancelledSession,
        movedToSession: null,
        bookingId: null,
        baseUrl,
      });
      if (emailId) await logEmail(emailId, {
        emailType: "cancelled_by_admin",
        toEmail: b.email,
        toName: b.full_name,
        extra: {
          cancelled_session: cancelledSession,
          moved_to_session: null,
          booking_id: null,
        },
      });
    } catch { /* don't block if email fails */ }
```

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/sessions/route.ts
git commit -m "feat: log emails sent from admin sessions route"
```

---

## Task 11: Refactor reminder routes to use `lib/email.ts` + log

**Files:**
- Modify: `app/api/reminders/day-before/route.ts`
- Modify: `app/api/reminders/three-hours/route.ts`

### Day-before reminder

- [ ] **Step 1: Replace `app/api/reminders/day-before/route.ts` content**

The route no longer builds HTML inline — it delegates to `sendDayBeforeReminderEmail`. The Resend SDK import is removed (email.ts handles it). Replace the entire file:

```typescript
import { NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { localNow, localTodayStr, localTomorrowStr } from "@/lib/timezone";
import { sendDayBeforeReminderEmail } from "@/lib/email";
import { logEmail } from "@/lib/email-log";

export async function GET() {
  return handleReminder();
}

export async function POST() {
  return handleReminder();
}

async function handleReminder() {
  const now = localNow();
  const todayStr = localTodayStr();
  const tomorrowStr = localTomorrowStr();

  const loMs = 23 * 60 * 60 * 1000 + 30 * 60 * 1000;
  const hiMs = 24 * 60 * 60 * 1000 + 30 * 60 * 1000;
  const loTime = new Date(now.getTime() + loMs);
  const hiTime = new Date(now.getTime() + hiMs);
  const pad = (d: Date) => d.toISOString().split("T")[1].substring(0, 8);

  const candidates: { date: string; loT: string; hiT: string }[] = [];

  if (loTime.toISOString().split("T")[0] === hiTime.toISOString().split("T")[0]) {
    const dateStr = loTime.getDate() === now.getDate() ? todayStr : tomorrowStr;
    candidates.push({ date: dateStr, loT: pad(loTime), hiT: pad(hiTime) });
  } else {
    candidates.push({ date: todayStr, loT: pad(loTime), hiT: "23:59:59" });
    candidates.push({ date: tomorrowStr, loT: "00:00:00", hiT: pad(hiTime) });
  }

  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "";
  let sent = 0;

  for (const c of candidates) {
    const { data: sessions } = await supabase
      .from("sessions")
      .select("id, date, start_time, end_time, location, room")
      .eq("date", c.date)
      .eq("status", "upcoming")
      .gte("start_time", c.loT)
      .lte("start_time", c.hiT);

    if (!sessions?.length) continue;

    for (const session of sessions) {
      const { data: bookings } = await supabase
        .from("bookings")
        .select("id, email, full_name")
        .eq("session_id", session.id)
        .eq("status", "confirmed");

      if (!bookings?.length) continue;
      const isConfirmed = bookings.length >= 3;

      for (const b of bookings) {
        try {
          const emailId = await sendDayBeforeReminderEmail(
            b.email,
            b.full_name,
            b.id,
            session,
            baseUrl,
            isConfirmed
          );
          if (emailId) await logEmail(emailId, {
            emailType: "reminder_24h",
            bookingId: b.id,
            toEmail: b.email,
            toName: b.full_name,
          });
          sent++;
        } catch { /* skip failed email */ }
      }
    }
  }

  return NextResponse.json({ ok: true, sent, checked_at: now.toISOString() });
}
```

### Three-hours reminder

- [ ] **Step 2: Replace `app/api/reminders/three-hours/route.ts` content**

```typescript
import { NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { localNow, localTodayStr } from "@/lib/timezone";
import { sendThreeHoursReminderEmail } from "@/lib/email";
import { logEmail } from "@/lib/email-log";

export async function GET() {
  return handleReminder();
}

export async function POST() {
  return handleReminder();
}

async function handleReminder() {
  const now = localNow();
  const todayStr = localTodayStr();

  const lo = new Date(now.getTime() + 2 * 60 * 60 * 1000 + 45 * 60 * 1000);
  const hi = new Date(now.getTime() + 3 * 60 * 60 * 1000 + 15 * 60 * 1000);
  const pad = (d: Date) => d.toISOString().split("T")[1].substring(0, 8);
  const loTime = pad(lo);
  const hiTime = pad(hi);

  const { data: sessions } = await supabase
    .from("sessions")
    .select("id, date, start_time, end_time, location, room")
    .eq("date", todayStr)
    .eq("status", "upcoming")
    .gte("start_time", loTime)
    .lte("start_time", hiTime);

  if (!sessions?.length) {
    return NextResponse.json({ ok: true, sent: 0, message: "No sessions starting in ~3 hours" });
  }

  let sent = 0;

  for (const session of sessions) {
    const { data: bookings } = await supabase
      .from("bookings")
      .select("id, email, full_name")
      .eq("session_id", session.id)
      .eq("status", "confirmed");

    if (!bookings?.length) continue;
    const isConfirmed = bookings.length >= 3;

    for (const b of bookings) {
      try {
        const emailId = await sendThreeHoursReminderEmail(
          b.email,
          b.full_name,
          session,
          isConfirmed
        );
        if (emailId) await logEmail(emailId, {
          emailType: "reminder_3h",
          bookingId: b.id,
          toEmail: b.email,
          toName: b.full_name,
        });
        sent++;
      } catch { /* skip failed email */ }
    }
  }

  return NextResponse.json({ ok: true, sent });
}
```

- [ ] **Step 3: Commit**

```bash
git add app/api/reminders/day-before/route.ts app/api/reminders/three-hours/route.ts
git commit -m "feat: refactor reminder routes to use shared email helpers + log"
```

---

## Task 12: Create `app/api/admin/bounced-emails/route.ts`

**Files:**
- Create: `app/api/admin/bounced-emails/route.ts`

This route has two handlers:
- `GET` — queries `email_logs` for last 24 h, checks each via Resend, returns bounced ones
- `POST` — resends a specific log entry using `fromOverride`

- [ ] **Step 1: Create the route file**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { supabaseAdmin } from "@/lib/supabase-admin";
import {
  sendConfirmationEmail,
  sendBackfillConfirmationEmail,
  sendMovedToPreferredEmail,
  sendStartingSoonEmail,
  sendNoSpotsFinalEmail,
  sendNoSpotsEmail,
  sendSessionMovedEmail,
  sendCancellationConfirmationEmail,
  sendSessionCancelledByAdminEmail,
  sendSubscribedEmail,
  sendNewSessionAvailableEmail,
  sendDayBeforeReminderEmail,
  sendThreeHoursReminderEmail,
  AlternativeInfo,
} from "@/lib/email";

function checkAuth(req: NextRequest): boolean {
  const pw = req.headers.get("x-admin-password");
  return !!process.env.ADMIN_PASSWORD && pw === process.env.ADMIN_PASSWORD;
}

export async function GET(req: NextRequest) {
  if (!checkAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const resend = new Resend(process.env.RESEND_API_KEY);
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data: logs } = await supabaseAdmin
    .from("email_logs")
    .select("*")
    .gte("sent_at", since)
    .order("sent_at", { ascending: false });

  if (!logs?.length) {
    return NextResponse.json({ bounced: [] });
  }

  const bounced: unknown[] = [];

  for (const log of logs) {
    try {
      const { data: emailData } = await resend.emails.get(log.resend_email_id);
      if (emailData?.last_event === "bounced") {
        bounced.push({ ...log, resend_last_event: emailData.last_event });
      }
    } catch {
      // skip — ID may be expired or not found
    }
  }

  return NextResponse.json({ bounced });
}

export async function POST(req: NextRequest) {
  if (!checkAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { log_id } = await req.json();
  if (!log_id) {
    return NextResponse.json({ error: "Missing log_id" }, { status: 400 });
  }

  const { data: log } = await supabaseAdmin
    .from("email_logs")
    .select("*")
    .eq("id", log_id)
    .single();

  if (!log) {
    return NextResponse.json({ error: "Log entry not found" }, { status: 404 });
  }

  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "";
  const fromOverride = process.env.RESEND_FROM_OVERRIDE;

  try {
    await resendByType(log, baseUrl, fromOverride);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("Resend failed:", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

type EmailLog = {
  id: string;
  email_type: string;
  booking_id: string | null;
  to_email: string;
  to_name: string;
  extra: Record<string, unknown> | null;
};

async function resendByType(log: EmailLog, baseUrl: string, fromOverride?: string): Promise<void> {
  const { email_type, booking_id, to_email, to_name, extra } = log;

  switch (email_type) {
    case "confirmation":
    case "backfill_confirmation": {
      if (!booking_id) throw new Error("Missing booking_id for confirmation resend");
      const { data: booking } = await supabaseAdmin
        .from("bookings")
        .select("id, full_name, sessions(date, start_time, end_time, location, room)")
        .eq("id", booking_id)
        .single();
      if (!booking) throw new Error("Booking not found");
      const session = (booking as unknown as { sessions: { date: string; start_time: string; end_time: string; location: string; room: string | null } }).sessions;
      let alternatives: AlternativeInfo[] = [];
      if (email_type === "confirmation" || email_type === "backfill_confirmation") {
        const { data: alts } = await supabaseAdmin
          .from("bookings")
          .select("preference_order, sessions(date, start_time, end_time, location, room)")
          .eq("email", to_email)
          .eq("status", "pending")
          .neq("id", booking_id)
          .order("preference_order", { ascending: true });
        alternatives = (alts ?? []).map((a: unknown) => {
          const row = a as { preference_order: number | null; sessions: { date: string; start_time: string; end_time: string; location: string; room: string | null } | null };
          if (!row.sessions) return null;
          return { preference_order: row.preference_order, ...row.sessions } as AlternativeInfo;
        }).filter((x): x is AlternativeInfo => x !== null);
      }
      if (email_type === "backfill_confirmation") {
        await sendBackfillConfirmationEmail(to_email, to_name, booking_id, session, baseUrl, alternatives, fromOverride);
      } else {
        await sendConfirmationEmail(to_email, to_name, booking_id, session, baseUrl, alternatives, fromOverride);
      }
      break;
    }

    case "moved_to_preferred": {
      if (!booking_id) throw new Error("Missing booking_id for moved_to_preferred resend");
      const oldSessionId = (extra?.old_session_id as string) ?? null;
      if (!oldSessionId) throw new Error("Missing extra.old_session_id");
      const { data: booking } = await supabaseAdmin
        .from("bookings")
        .select("sessions(date, start_time, end_time, location, room)")
        .eq("id", booking_id)
        .single();
      if (!booking) throw new Error("Booking not found");
      const newSession = (booking as unknown as { sessions: { date: string; start_time: string; end_time: string; location: string; room: string | null } }).sessions;
      const { data: oldSession } = await supabaseAdmin
        .from("sessions")
        .select("date, start_time, end_time, location, room")
        .eq("id", oldSessionId)
        .single();
      if (!oldSession) throw new Error("Old session not found");
      await sendMovedToPreferredEmail(to_email, to_name, booking_id, oldSession, newSession, baseUrl, fromOverride);
      break;
    }

    case "starting_soon": {
      if (!booking_id) throw new Error("Missing booking_id for starting_soon resend");
      const { data: booking } = await supabaseAdmin
        .from("bookings")
        .select("sessions(date, start_time, end_time, location, room)")
        .eq("id", booking_id)
        .single();
      if (!booking) throw new Error("Booking not found");
      const session = (booking as unknown as { sessions: { date: string; start_time: string; end_time: string; location: string; room: string | null } }).sessions;
      await sendStartingSoonEmail(to_email, to_name, session, fromOverride);
      break;
    }

    case "reminder_24h": {
      if (!booking_id) throw new Error("Missing booking_id for reminder_24h resend");
      const { data: booking } = await supabaseAdmin
        .from("bookings")
        .select("session_id, sessions(date, start_time, end_time, location, room)")
        .eq("id", booking_id)
        .single();
      if (!booking) throw new Error("Booking not found");
      const session = (booking as unknown as { sessions: { date: string; start_time: string; end_time: string; location: string; room: string | null } }).sessions;
      const sessionId = (booking as unknown as { session_id: string }).session_id;
      const { count } = await supabaseAdmin
        .from("bookings")
        .select("*", { count: "exact", head: true })
        .eq("session_id", sessionId)
        .eq("status", "confirmed");
      await sendDayBeforeReminderEmail(to_email, to_name, booking_id, session, baseUrl, (count ?? 0) >= 3, fromOverride);
      break;
    }

    case "reminder_3h": {
      if (!booking_id) throw new Error("Missing booking_id for reminder_3h resend");
      const { data: booking } = await supabaseAdmin
        .from("bookings")
        .select("session_id, sessions(date, start_time, end_time, location, room)")
        .eq("id", booking_id)
        .single();
      if (!booking) throw new Error("Booking not found");
      const session = (booking as unknown as { sessions: { date: string; start_time: string; end_time: string; location: string; room: string | null } }).sessions;
      const sessionId = (booking as unknown as { session_id: string }).session_id;
      const { count } = await supabaseAdmin
        .from("bookings")
        .select("*", { count: "exact", head: true })
        .eq("session_id", sessionId)
        .eq("status", "confirmed");
      await sendThreeHoursReminderEmail(to_email, to_name, session, (count ?? 0) >= 3, fromOverride);
      break;
    }

    case "no_spots":
      await sendNoSpotsEmail(to_email, to_name, baseUrl, fromOverride);
      break;

    case "no_spots_final":
      await sendNoSpotsFinalEmail(to_email, to_name, baseUrl, fromOverride);
      break;

    case "moved": {
      if (!booking_id) throw new Error("Missing booking_id for moved resend");
      const oldSessionId = (extra?.old_session_id as string) ?? null;
      const newSessionId = (extra?.new_session_id as string) ?? null;
      if (!oldSessionId || !newSessionId) throw new Error("Missing extra session IDs");
      const { data: oldSession } = await supabaseAdmin
        .from("sessions")
        .select("date, start_time, end_time, location, room")
        .eq("id", oldSessionId)
        .single();
      const { data: newSession } = await supabaseAdmin
        .from("sessions")
        .select("date, start_time, end_time, location, room")
        .eq("id", newSessionId)
        .single();
      if (!oldSession || !newSession) throw new Error("Session(s) not found");
      await sendSessionMovedEmail(to_email, to_name, booking_id, oldSession, newSession, baseUrl, fromOverride);
      break;
    }

    case "cancellation_confirmation": {
      const session = extra?.session as { date: string; start_time: string; end_time: string; location: string; room: string | null } | null;
      if (!session) throw new Error("Missing extra.session for cancellation_confirmation");
      await sendCancellationConfirmationEmail(to_email, to_name, session, baseUrl, fromOverride);
      break;
    }

    case "cancelled_by_admin": {
      const cancelledSession = extra?.cancelled_session as { date: string; start_time: string; end_time: string; location: string; room: string | null } | null;
      const movedToSession = (extra?.moved_to_session as { date: string; start_time: string; end_time: string; location: string; room: string | null } | null) ?? null;
      const newBookingId = (extra?.booking_id as string | null) ?? null;
      if (!cancelledSession) throw new Error("Missing extra.cancelled_session");
      await sendSessionCancelledByAdminEmail({
        email: to_email,
        fullName: to_name,
        cancelledSession,
        movedToSession,
        bookingId: newBookingId,
        baseUrl,
        fromOverride,
      });
      break;
    }

    case "subscribed": {
      const unsubscribeToken = (extra?.unsubscribe_token as string) ?? null;
      const storedBaseUrl = (extra?.base_url as string) ?? baseUrl;
      if (!unsubscribeToken) throw new Error("Missing extra.unsubscribe_token");
      await sendSubscribedEmail(to_email, to_name, unsubscribeToken, storedBaseUrl, fromOverride);
      break;
    }

    case "new_session_available": {
      const session = extra?.session as { date: string; start_time: string; end_time: string; location: string; room: string | null } | null;
      const unsubscribeToken = (extra?.unsubscribe_token as string) ?? null;
      if (!session || !unsubscribeToken) throw new Error("Missing extra fields for new_session_available");
      await sendNewSessionAvailableEmail({ email: to_email, fullName: to_name, session, unsubscribeToken, baseUrl, fromOverride });
      break;
    }

    default:
      throw new Error(`Unknown email_type: ${email_type}`);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/admin/bounced-emails/route.ts
git commit -m "feat: add bounced-emails API route (GET list + POST resend)"
```

---

## Task 13: Add Bounced Emails section to `app/admin/page.tsx`

**Files:**
- Modify: `app/admin/page.tsx`

- [ ] **Step 1: Capture admin password in state**

In the state declarations (around line 156), add:
```typescript
const [adminPassword, setAdminPassword] = useState("");
```

In the `checkAuth` function (around line 190), after `const pw = prompt(...)`:
```typescript
      if (res.ok) { setAuthed(true); setAdminPassword(pw); }
```

- [ ] **Step 2: Add bounced emails state**

After the existing state declarations, add:
```typescript
// Bounced emails
interface BouncedEmailLog {
  id: string;
  email_type: string;
  to_email: string;
  to_name: string;
  sent_at: string;
  booking_id: string | null;
}
const [bouncedEmails, setBouncedEmails] = useState<BouncedEmailLog[]>([]);
const [bouncedLoading, setBouncedLoading] = useState(false);
const [bouncedChecked, setBouncedChecked] = useState(false);
const [resendingId, setResendingId] = useState<string | null>(null);
const [resendResults, setResendResults] = useState<Record<string, "ok" | "error">>({});
```

- [ ] **Step 3: Add handler functions**

After `handleSendEmail`, add:

```typescript
async function handleCheckBounced() {
  setBouncedLoading(true);
  setBouncedChecked(false);
  try {
    const res = await fetch("/api/admin/bounced-emails", {
      headers: { "x-admin-password": adminPassword },
    });
    const body = await res.json();
    setBouncedEmails(body.bounced ?? []);
    setBouncedChecked(true);
    setResendResults({});
  } catch {
    setError("Failed to fetch bounced emails.");
  }
  setBouncedLoading(false);
}

async function handleResend(logId: string) {
  setResendingId(logId);
  try {
    const res = await fetch("/api/admin/bounced-emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-password": adminPassword },
      body: JSON.stringify({ log_id: logId }),
    });
    const body = await res.json();
    setResendResults((prev) => ({ ...prev, [logId]: res.ok && body.ok ? "ok" : "error" }));
    if (!res.ok) setError("Resend failed: " + (body?.error ?? "Unknown"));
  } catch {
    setResendResults((prev) => ({ ...prev, [logId]: "error" }));
  }
  setResendingId(null);
}
```

- [ ] **Step 4: Add UI section**

Add this section just before the closing `</main>` tag (after the sessions list):

```tsx
        {/* Bounced Emails Section */}
        <div className="mt-10">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-gray-900">Bounced Emails</h2>
              <p className="text-xs text-gray-500">Automated emails that bounced in the last 24 hours. Resent emails use mingcong.ding@tum.de as sender.</p>
            </div>
            <button
              onClick={handleCheckBounced}
              disabled={bouncedLoading}
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              {bouncedLoading ? "Checking…" : "Refresh"}
            </button>
          </div>

          {bouncedChecked && (
            bouncedEmails.length === 0 ? (
              <div className="rounded-xl border border-dashed border-gray-300 py-8 text-center text-sm text-gray-400">
                No bounced emails in the last 24 hours
              </div>
            ) : (
              <div className="rounded-xl border border-gray-200 bg-white overflow-x-auto shadow-sm">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 text-xs text-gray-500">
                      <th className="px-4 py-2.5 font-medium">Recipient</th>
                      <th className="px-4 py-2.5 font-medium">Type</th>
                      <th className="px-4 py-2.5 font-medium">Sent At</th>
                      <th className="px-4 py-2.5 font-medium">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bouncedEmails.map((log) => {
                      const result = resendResults[log.id];
                      return (
                        <tr key={log.id} className="border-b border-gray-50 last:border-0">
                          <td className="px-4 py-2.5">
                            <div className="font-medium text-gray-900">{log.to_name || "—"}</div>
                            <div className="text-xs text-gray-500">{log.to_email}</div>
                          </td>
                          <td className="whitespace-nowrap px-4 py-2.5">
                            <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                              {log.email_type}
                            </span>
                          </td>
                          <td className="whitespace-nowrap px-4 py-2.5 text-xs text-gray-500">
                            {formatDateTime(log.sent_at)}
                          </td>
                          <td className="whitespace-nowrap px-4 py-2.5">
                            {result === "ok" ? (
                              <span className="text-xs font-medium text-green-600">Sent</span>
                            ) : result === "error" ? (
                              <span className="text-xs font-medium text-red-600">Failed</span>
                            ) : (
                              <button
                                onClick={() => handleResend(log.id)}
                                disabled={resendingId === log.id}
                                className="rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                              >
                                {resendingId === log.id ? "Sending…" : "Resend"}
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )
          )}
        </div>
```

- [ ] **Step 5: Commit**

```bash
git add app/admin/page.tsx
git commit -m "feat: add bounced emails section to admin page"
```

---

## Task 14: Set environment variable and verify end-to-end

**Files:**
- `.env.local`

- [ ] **Step 1: Add env var**

In `.env.local`, add:
```
RESEND_FROM_OVERRIDE=mingcong.ding@tum.de
```

**Important:** `mingcong.ding@tum.de` must first be verified in the Resend Dashboard → Domains → Add Single Sender. Check the TUM inbox for the verification email and click the link.

- [ ] **Step 2: Run the dev server**

```bash
npm run dev
```

Expected: no TypeScript errors, server starts on localhost:3000.

- [ ] **Step 3: Check for TypeScript errors**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Manual smoke test**

1. Open `/admin`, enter password
2. Scroll to bottom → "Bounced Emails" section visible with "Refresh" button
3. Click Refresh → shows "No bounced emails in the last 24 hours" (or a table if any exist)
4. To test resend: use a known bounced email log_id from the Supabase `email_logs` table, or trigger a test send to a known-bad address and wait for bounce event

- [ ] **Step 5: Final commit**

```bash
git add .env.local
git commit -m "feat: complete bounced email tracker feature"
```

> Note: `.env.local` should be in `.gitignore`. If not, do NOT commit it — instead document the variable in a `.env.example` file.
