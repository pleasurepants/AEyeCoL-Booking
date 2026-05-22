# Bounced Email Tracker — Design Spec

**Date:** 2026-05-22  
**Status:** Approved

## Overview

Add a "Bounced Emails" section to the admin page that lets the admin view automated emails that bounced in the last 24 hours and manually resend them. Resent emails use `mingcong.ding@tum.de` as the from address (requires that address to be verified as a sender in Resend).

## Architecture

### 1. Supabase Table: `email_logs`

```sql
create table email_logs (
  id            uuid primary key default gen_random_uuid(),
  resend_email_id text not null,
  email_type    text not null,
  booking_id    uuid references bookings(id) on delete set null,
  to_email      text not null,
  to_name       text not null default '',
  extra         jsonb,
  sent_at       timestamptz not null default now()
);
```

`email_type` values:
- `confirmation` — booking confirmed
- `application_received` — application submitted
- `reminder_24h` — 24h before session
- `reminder_3h` — 3h before session
- `cancelled_by_admin` — session cancelled by admin
- `moved` — moved to another session (needs `extra.old_session_id`, `extra.new_session_id`)
- `moved_to_preferred` — auto-upgraded to higher-preference session (needs `extra.old_session_id`)
- `backfill_confirmation` — spot opened up, auto-confirmed
- `starting_soon` — session starting soon (3h reminder variant via lib)
- `no_spots` — all selected sessions full
- `subscribed` — subscribed to notifications
- `new_session_available` — new session notification for subscribers

### 2. Email Logging

**In `lib/email.ts`:** Each `send*` function is modified to:
1. Return `Promise<string | null>` (the Resend email ID) instead of `Promise<void>`
2. The returned ID is used by callers to write to `email_logs` via a new helper

**New helper `lib/email-log.ts`:**
```ts
logEmail(resendEmailId: string, params: {
  emailType: string
  bookingId?: string | null
  toEmail: string
  toName?: string
  extra?: Record<string, unknown>
}): Promise<void>
```
Uses `supabaseAdmin` to insert into `email_logs`.

**Reminder routes** (`reminders/day-before`, `reminders/three-hours`): Currently build HTML inline. Refactor to extract shared functions into `lib/email.ts` (`sendDayBeforeReminderEmail`, `sendThreeHoursReminderEmail`), then log the returned ID with the booking_id.

**Admin-only emails** (`sendAdminBookingEventEmail`, `sendCustomEmail`) are NOT logged — no need to track bounces on those.

### 3. API Routes

**`GET /api/admin/bounced-emails`**
- Reads admin password from header `x-admin-password`
- Queries `email_logs` for `sent_at >= now() - 24h`
- For each record, calls `resend.emails.get(resend_email_id)` to get current status
- Filters where status is `bounced`
- Returns array of bounced records

**`POST /api/admin/bounced-emails/resend`**
- Body: `{ log_id: string, password: string }`
- Fetches the `email_log` record
- Based on `email_type`, fetches current booking + session data from Supabase
- Calls the matching `send*` function with `fromOverride: process.env.RESEND_FROM_OVERRIDE`
- All `send*` functions accept an optional `fromOverride` parameter
- Does NOT write a new log entry (to avoid infinite resend loops)
- Returns `{ ok: true }` or error

### 4. Resend Reconstruction Logic

| email_type | Data source | Notes |
|---|---|---|
| `confirmation` | booking + session via booking_id | cancelUrl from booking.id |
| `application_received` | booking via booking_id | simple email, no session needed |
| `reminder_24h` / `reminder_3h` | booking + session via booking_id | cancelUrl from booking.id |
| `cancelled_by_admin` | extra.old_session_id + extra.new_session_id (nullable) | old session fetched by ID |
| `moved` | extra.old_session_id + extra.new_session_id | both sessions fetched |
| `moved_to_preferred` | extra.old_session_id + booking's current session | |
| `backfill_confirmation` | booking + session via booking_id | |
| `no_spots` | to_email + to_name only | no session data needed |
| `subscribed` | to_email + to_name + subscriber's unsubscribe_token | |
| `new_session_available` | extra.session_id + subscriber's unsubscribe_token | |

### 5. Environment Variable

```
RESEND_FROM_OVERRIDE=mingcong.ding@tum.de
```

Must be verified in the Resend dashboard. If not set, resend falls back to `FROM_EMAIL`.

### 6. Admin UI

New collapsible section in `app/admin/page.tsx` below the session list:

- Header: "Bounced Emails (Last 24h)" + "Refresh" button
- On click: calls `GET /api/admin/bounced-emails`, shows loading state
- Result table columns: Recipient | Type | Sent At | Resend
- Each row: "Resend" button → calls resend API → shows inline success/error
- Shows count badge: "3 bounced" in red if any found, "0 bounced" in gray

## Error Handling

- If `resend.emails.get()` fails for a record (e.g., ID expired), skip that record silently
- If resend fails (e.g., from address not verified), return error message shown inline in the table row
- Logging errors are non-fatal — email sends should not fail because logging failed

## Out of Scope

- Webhook-based real-time bounce detection
- Editing the recipient address before resend
- Tracking resend history
- Bounce tracking for manually-sent custom emails
