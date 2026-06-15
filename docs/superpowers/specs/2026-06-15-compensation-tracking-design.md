# Compensation Tracking — Design

**Date:** 2026-06-15
**Status:** Approved (DB migration already applied in production)

## Problem

Admins need to track whether each confirmed study participant has been sent
their compensation coupon. This is an admin-only flag with two states:
`done` / `not_done` (default `not_done`). It must NOT appear on the public
booking form, and only admins can change it.

## Data model

New column on the `bookings` table:

```sql
alter table bookings
  add column compensation text not null default 'not_done'
  check (compensation in ('done', 'not_done'));
```

- Default `not_done`; existing rows backfilled to `not_done` automatically.
- Constrained to the two valid values at the DB level.
- **Applied in production via Supabase SQL Editor on 2026-06-15.** (Follows the
  same manual-migration pattern used for the `email_logs` table.)

## Admin UI (`app/admin/page.tsx`)

- Add `compensation: string | null` to the `Booking` interface.
- Insert a **"Compensation"** column header immediately after **Status**
  (before **Actions**).
- Cell rendering by booking status:
  - **confirmed** → editable dropdown (Done / Not done), styled like the
    existing `glasses` dropdown. Green pill for `done`, grey for `not_done`.
    `onChange` → `handleBookingAction("set-compensation", b.id, { compensation })`.
  - **non-confirmed** (pending/other) → a dim `—` placeholder, no control.
- Not included in CSV export (out of scope unless requested later).
- Public booking form is untouched, so compensation never surfaces there.

## API (`app/api/admin/bookings/route.ts`)

New `set-compensation` action, mirroring `set-glasses`:

- Validates `compensation ∈ {done, not_done}` → 400 on invalid.
- `update({ compensation }).eq("id", booking_id)`.
- No emails, no backfill side-effects.

## One-time backfill

The folder `…/07_Studydoc/compensation_r1/{S1..S7}` contains one file per
participant who already received a coupon (18 files total, named after the
participant). These should be set to `compensation = 'done'`.

Approach:

1. A throwaway script using the service-role key reads all **confirmed**
   bookings.
2. Fuzzy-matches each of the 18 filenames against booking `full_name`.
3. Prints a match table (folder name → matched full_name / email / session
   date). Ambiguous or unmatched names (e.g. `Leonardo` vs `Leonardo Dall'Armi`)
   are flagged for manual resolution.
4. **After user approval of the matches**, applies `compensation = 'done'`
   updates. No writes happen before approval.

## Out of scope

- CSV export of the compensation field.
- Any participant-facing display.
- Automated coupon sending.
