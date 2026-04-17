# Testing Guide (English)

This guide walks through the new features from an **end-user's point of view** — no code or database access needed.

You'll need:

- **3 mailboxes** you can read (or one mailbox with `+` aliases, e.g. `you@gmail.com`, `you+a@gmail.com`, `you+b@gmail.com`). Referred to below as **Mailbox A / B / C**.
- The **admin password** (you'll be prompted when opening `/admin`).
- Check your **inbox *and* spam folder** after every step that expects an email.

Work through the tests **in order**, finishing each one before starting the next, to avoid cross-contamination.

---

## Test 1: Subscribe to new-session notifications

**Goal**: `/subscribe` accepts your email and a confirmation mail arrives.

1. Visit `<your domain>/subscribe`.
2. Enter **Mailbox A** and any name, click **Subscribe**.
3. ✅ The page should turn green with the heading "You're subscribed".
4. Open Mailbox A — you should receive a **"You're on the notification list"** email containing an **Unsubscribe here** link.

**Repeat subscription (idempotency)**
1. Subscribe again with the same Mailbox A.
2. ✅ The page should now say "You're already on the list" (the system knows you've subscribed before and doesn't create a duplicate).

---

## Test 2: Unsubscribe works

1. Open the subscription email from Test 1 and click **Unsubscribe here**.
2. ✅ The browser lands on `/unsubscribe` with the message "You've been unsubscribed".
3. Afterwards, re-subscribe Mailbox A for the next test.

---

## Test 3: Admin creates a session → subscribers get notified

1. Make sure Mailbox A is subscribed (Test 1 complete, not unsubscribed).
2. In a new tab, go to `/admin` → enter password → click **Add Session** → fill a future date → submit.
3. ✅ The session appears on the admin page (if not, stop — this is a bug).
4. ✅ In Mailbox A, a **"New Study Session Available — {date}"** email should arrive, containing a blue **Book This Session** button.
5. Clicking the button returns you to the home page.

---

## Test 4: Confirmation email lists other preferences

1. In `/admin`, create two future sessions:
   - **S1** with **Max Participants = 1**
   - **S2** with **Max Participants = 4**
2. From the home page, submit with **Mailbox B**, picking S1 as First Choice, no backup → submit.
3. ✅ Mailbox B gets "Session Confirmed". S1 is now full.
4. From the home page, submit with **Mailbox A**:
   - First Choice = S1 (shows "Full — Waitlist Available")
   - Backup 1 = S2
   - Submit
5. ✅ Mailbox A receives a **"Confirmed — Backup Session"** style confirmation email.
6. ✅ Below the S2 details the email must contain a **grey box** titled "Your other preference (kept on the waitlist)" showing "1st choice: {S1 date} {S1 time}".

**Negative check**: submitting with only one session (no backup) should **not** produce that grey block.

---

## Test 5: Cancellation email includes a Book Again button

1. Submit and get confirmed into any session with Mailbox A.
2. Open the confirmation email in Mailbox A and click the red **Cancel Booking** button.
3. ✅ The browser confirms cancellation.
4. ✅ Mailbox A then receives a **"Booking Cancelled"** email.
5. ✅ At the bottom there is a **blue "Book a New Session" button** linking back to the home page.

---

## Test 6: Renamed admin buttons (visual check)

Open `/admin`, authenticate, and compare:

| Location | Expected label |
|---|---|
| Amber button on a confirmed row | **Unconfirm** |
| Red text button at the end of each row | **Remove** |
| Confirmation pop-up after clicking Remove | **Yes** / **No** |
| Red text button on a session header | **Remove** |
| Confirmation pop-up for session Remove | **Yes, Remove** / **Keep** |

✅ The old labels "Pending", "Delete", "Yes, Delete", "Cancel" must no longer appear.

---

## Test 7: Admin removes a confirmed participant → cancellation email

1. Ensure Mailbox A is confirmed in some session (re-submit if needed).
2. In `/admin`, find that row → click **Remove** → **Yes**.
3. ✅ Mailbox A receives a **"Booking Cancelled"** email (with the Book a New Session button).

**Negative check**:
1. Have Mailbox B submit against a session that's already full — they land on the **waitlist** (status pending, amber tag).
2. The admin removes that pending row.
3. ✅ Mailbox B should **not** receive a cancellation email (no need to bother people who never held a seat).

---

## Test 8: Admin cancels a session → backup promoted automatically

### Scenario A: backup available
1. Create sessions S1 (max 1) and S2 (max 4).
2. Submit **first** with Mailbox A: First = S1, Backup 1 = S2 → A is confirmed in S1, with S2 kept pending as backup.
3. In `/admin`, find **S1** and change its status dropdown from `Upcoming` to **Cancelled**.
4. ✅ Mailbox A receives a **"Session Cancelled"** email containing a **green block** "You have been moved to your backup session" listing S2's date/time.
5. ✅ Refresh `/admin`. Mailbox A should now appear under **S2** with status confirmed.

### Scenario B: no backup
1. Create a fresh session S3.
2. Submit with Mailbox C, choosing only S3 (no backup) → C is confirmed in S3.
3. Cancel S3 from the admin page.
4. ✅ Mailbox C receives a **"Session Cancelled"** email containing an **amber block** "No backup session available" plus a blue **Book a New Session** button at the bottom.

---

## Test 9: Waitlist / full-session users are nudged to subscribe

### 9.1 Home-page hint
1. On the home page, complete the "Your Information" step and land on "Select Your First Choice".
2. ✅ **Below** the session cards there should be a small blue note:
   > Don't see a time that works? **Get an email when new sessions open**.
3. Clicking the link takes you to `/subscribe` with the email pre-filled.

### 9.2 No sessions available
1. As admin, Remove or cancel every future session.
2. Reload the home page and advance to "Select Your First Choice".
3. ✅ You should see a centered line "No sessions available right now." plus a large blue button **Notify me when new sessions open**.

### 9.3 Waitlist follow-up
1. Fill every session (use several mailboxes to grab the seats).
2. With a fresh **Mailbox D**, submit picking a full session as first choice → submit.
3. ✅ The result page should be the yellow "On the Waitlist".
4. ✅ **Below** the yellow box there should be a white card "Want to hear about brand-new sessions?" with an orange button **Notify me about new sessions**.
5. ✅ Mailbox D's "Session Availability Update" email should include a blue **Notify Me About New Sessions** button.

---

## Test 10: Regression check (quick pass on old flows)

Make sure nothing old is broken:

- [ ] A brand-new mailbox can submit a booking and receives "Session Confirmed".
- [ ] Submitting again with an already-confirmed mailbox shows the frontend error "already has a confirmed registration".
- [ ] Clicking Cancel in the confirmation email cancels the booking and sends the cancellation email.
- [ ] The **Other Prefs** column on `/admin` shows other preferences' dates/times.
- [ ] Clicking the **Email** button on any row in `/admin` opens the modal and successfully sends a custom email.

---

## Troubleshooting (how to describe issues)

| Symptom | Most likely cause |
|---|---|
| Subscribe page spins forever or errors out | Server env var may be missing — ask the developer to check the Vercel deployment |
| Subscribed successfully but no email arrived | Check **spam / promotions / other folders** first; if still missing, it's a mail-service issue |
| Admin created a session but subscribers didn't get notified | Confirm you are actually subscribed by visiting `/subscribe` again — the page should say "already on the list" |
| Cancel link says "Session already expired" | Expected — you cannot cancel after a session has ended |
| Two emails arrive almost simultaneously in scenario A | Expected — one says "session cancelled + moved to backup", the other is the new backup confirmation |

---

When testing is done, note any step where the ✅ did **not** happen (which step, what you saw instead) and send that to the developer.
