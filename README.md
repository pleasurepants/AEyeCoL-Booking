# AEyeCoL Booking System

A website that lets research participants **sign up for study sessions** by themselves, and lets the lab team **manage those sessions** from an admin page. It automatically confirms people into the right session, keeps a waiting list, and sends all the emails (confirmation, reminders, cancellations) for you.

This system was originally built for the **AEyeCoL Lab**. You are welcome to use it as-is, or copy it and run your own version. The last section, ["Making it your own"](#10-making-it-your-own), explains exactly what to change.

> **New to all this?** Don't worry. This guide assumes **no prior experience**. Every step tells you what to click, where to go, and what to type. Read it top to bottom the first time.

---

## Table of contents

1. [What the system does](#1-what-the-system-does)
2. [How it works (the big picture)](#2-how-it-works-the-big-picture)
3. [Words you'll see (mini glossary)](#3-words-youll-see-mini-glossary)
4. [The 4 free accounts you need](#4-the-4-free-accounts-you-need)
5. [Step-by-step: set up each service](#5-step-by-step-set-up-each-service)
6. [The secret settings (environment variables)](#6-the-secret-settings-environment-variables)
7. [Run it on your own computer](#7-run-it-on-your-own-computer)
8. [Put it on the internet (deploy to Vercel)](#8-put-it-on-the-internet-deploy-to-vercel)
9. [Using the admin page](#9-using-the-admin-page)
10. [Making it your own](#10-making-it-your-own)
11. [Common problems & answers](#11-common-problems--answers)

---

## 1. What the system does

**For participants (the public website):**
- See upcoming study sessions for the next 2 weeks.
- Fill in their details (name, email, phone, whether they wear glasses, comments).
- Pick a **first choice** session, plus up to **two backup** sessions.
- Get an email confirming their spot — or, if everything is full, an email saying they're on the waiting list.
- Cancel their booking themselves through a link in the email.
- Subscribe to be notified by email whenever a new session opens.

**For the lab team (the admin page):**
- Create, edit, and cancel sessions.
- See who is confirmed and who is waiting for each session.
- Move people between sessions, confirm or remove people.
- Track whether the consent form was sent and whether the participant was paid (compensation).
- Send custom emails to participants.

**Automatic behavior (happens without anyone clicking):**
- When someone cancels, the next person on the waiting list is automatically moved in.
- A reminder email goes out the day before, and again 3 hours before each session.
- Each night the system tries to confirm waiting people into any free spots.

---

## 2. How it works (the big picture)

This is a website. A website needs a few separate services to work, like a kitchen needs several appliances:

```
   Participant's browser  ──►  The Website (Next.js)  ──►  Database (Supabase)
                                       │
                                       ├──►  Email sender (Resend)
                                       └──►  Reminder scheduler (QStash)

   The whole thing is hosted online by Vercel.
```

- **The Website** is the code in this project. It shows the pages and handles the logic.
- **Supabase** is the database — the filing cabinet where all sessions, bookings, and subscribers are stored.
- **Resend** is the service that actually delivers emails.
- **QStash** (by Upstash) schedules the reminder emails.
- **Vercel** is the company that runs your website on the internet so anyone can visit it.

You will create a free account with each of these four services and connect them together. That's most of the work.

---

## 3. Words you'll see (mini glossary)

| Word | Plain meaning |
|------|---------------|
| **Repository / repo** | A folder of project code, usually stored on GitHub. |
| **Terminal / command line** | A text window where you type commands instead of clicking. On Windows, use **PowerShell**. |
| **Node.js / npm** | The program that runs this website's code on your computer. `npm` is its installer for add-ons. |
| **Environment variable** | A secret setting (like a password or key) stored separately from the code. |
| **API key / token** | A long secret password that lets two services talk to each other. **Never share these publicly.** |
| **Deploy** | To publish your website so it's live on the internet. |
| **Cron job** | A task that runs automatically on a schedule (e.g., "every night at 10 PM"). |

---

## 4. The 4 free accounts you need

Before anything else, you will register for these. All have a free tier that is plenty for a small lab.

| Service | What it's for | Where to register |
|---------|---------------|-------------------|
| **GitHub** | Stores the project code online. | <https://github.com/signup> |
| **Supabase** | The database. | <https://supabase.com> |
| **Resend** | Sends emails. | <https://resend.com> |
| **Upstash (QStash)** | Schedules reminder emails. | <https://upstash.com> |
| **Vercel** | Hosts the live website. | <https://vercel.com/signup> |

> Tip: When you sign up for Vercel, choose **"Continue with GitHub"** so they're linked. This makes deploying much easier later.

**One thing that is not free: a domain name.** A domain is your own web address, like `yourlab.com`. You need one so that emails come from a real address (e.g., `booking@yourlab.com`) instead of being blocked as spam. You **buy** one (typically ~10–15 USD per year) from a registrar such as [Namecheap](https://www.namecheap.com), [Cloudflare](https://www.cloudflare.com/products/registrar/), or [Google Domains/Squarespace](https://domains.squarespace.com). You'll connect it to Resend in [Section 5c](#5c-resend--sending-emails). (For quick testing you can skip this and use Resend's sandbox address, but real participants need a verified domain.)

You also need two free programs installed on your computer:
- **Node.js** (version 20 or newer) — download from <https://nodejs.org> (pick the "LTS" version, click through the installer).
- **Git** — download from <https://git-scm.com/downloads> (click through the installer).

To check they installed correctly, open **PowerShell** and type each of these, pressing Enter after each. You should see a version number, not an error:
```bash
node --version
git --version
```

---

## 5. Step-by-step: set up each service

Do these in order. Keep a blank text file open (e.g., in Notepad) to **paste each key/value as you collect it** — you'll need them all in [Section 6](#6-the-secret-settings-environment-variables).

### 5a. Get the code

1. Open **PowerShell**.
2. Go to the folder where you want the project (for example your Documents):
   ```bash
   cd ~/Documents
   ```
3. Download the project and enter its folder:
   ```bash
   git clone <the-github-link-to-this-project>.git
   cd aeyecol-booking
   ```
4. Install the add-ons the project needs (this can take a minute):
   ```bash
   npm install
   ```

### 5b. Supabase — the database

1. Go to <https://supabase.com>, sign in, and click **New project**.
2. Give it a name (e.g., `booking`), set a database password (save it somewhere), choose a region near you, and click **Create**. Wait ~1 minute.
3. **Create the tables.** In the left sidebar, click **SQL Editor → New query**, paste the entire block below, and click **Run**. This builds the four tables the system needs.

   ```sql
   -- Study sessions the lab offers
   create table sessions (
     id               uuid primary key default gen_random_uuid(),
     date             date        not null,
     start_time       time        not null,
     end_time         time        not null,
     location         text        not null,
     room             text,
     max_participants integer     not null default 1,
     notes            text,
     supervisors      text[]      default '{}',
     status           text        default 'upcoming',   -- 'upcoming' or 'cancelled'
     signed_file      text        default 'none',       -- 'none' or 'sent'
     created_at       timestamptz default now()
   );

   -- One row per person per session they picked
   create table bookings (
     id               uuid primary key default gen_random_uuid(),
     session_id       uuid references sessions(id) on delete cascade,
     preference_order integer     not null,             -- 1 = first choice, 2/3 = backups
     full_name        text        not null,
     email            text        not null,
     phone            text,
     comments         text,
     glasses          text        default 'none',       -- 'none' or 'glasses'
     status           text        default 'pending',    -- 'pending' or 'confirmed'
     compensation     text        default 'none',       -- 'none', 'done', or 'received'
     created_at       timestamptz default now()
   );

   -- People who want to be emailed when new sessions open
   create table subscribers (
     id                 uuid primary key default gen_random_uuid(),
     email              text not null unique,
     full_name          text,
     unsubscribe_token  uuid default gen_random_uuid(),
     created_at         timestamptz default now()
   );

   -- A record of every email sent (for tracking)
   create table email_logs (
     id               uuid primary key default gen_random_uuid(),
     resend_email_id  text,
     email_type       text,
     booking_id       uuid,
     to_email         text,
     to_name          text,
     extra            jsonb,
     created_at       timestamptz default now()
   );
   ```

4. **Copy your keys.** In the left sidebar go to **Settings → API**. You'll collect three things:
   - **Project URL** → save as `NEXT_PUBLIC_SUPABASE_URL`
   - **`anon` `public` key** → save as `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - **`service_role` `secret` key** → save as `SUPABASE_SERVICE_ROLE_KEY`  ← keep this one very secret

### 5c. Resend — sending emails

1. Go to <https://resend.com>, sign in.
2. Click **API Keys → Create API Key**, give it a name, and copy the key. Save it as `RESEND_API_KEY`.
3. Decide the "from" address your emails will come from (e.g., `booking@yourlab.com`). Save it as `FROM_EMAIL`.
4. **Important — you need a domain here.** To send from your own address (like `@yourlab.com`), you must own a domain (see [Section 4](#4-the-4-free-accounts-you-need) for where to buy one). In Resend, go to **Domains → Add Domain**, type your domain, and Resend shows you a list of **DNS records**. Copy those records into your domain registrar's DNS settings (Namecheap, Cloudflare, etc. all have a "DNS" or "Advanced DNS" page for this). Wait a few minutes, then click **Verify** in Resend. Once it's verified, your emails will be delivered properly. (No domain yet? You can test first with Resend's sandbox address, but real participants need a verified domain.)

### 5d. Upstash QStash — scheduling reminders

1. Go to <https://upstash.com>, sign in, and open the **QStash** tab.
2. On the QStash page you'll find these values — copy each one:
   - **QSTASH_URL**
   - **QSTASH_TOKEN**
   - **QSTASH_CURRENT_SIGNING_KEY**
   - **QSTASH_NEXT_SIGNING_KEY**

   Save them under those same names.

> You don't have to configure schedules by hand here — the reminder timings are already defined in the project's [`vercel.json`](vercel.json) file and run automatically once deployed to Vercel.

---

## 6. The secret settings (environment variables)

The website reads all its secret keys from one file. On your computer this file is called **`.env.local`** and it lives in the project's main folder. **This file is private and must never be uploaded to GitHub** (the project already tells Git to ignore it).

Create a file named `.env.local` in the project folder and paste this template, then **replace every `your-...` with the real value you collected above**:

```bash
# --- Supabase (database) ---
NEXT_PUBLIC_SUPABASE_URL=your-supabase-project-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key

# --- Admin page password (you choose this) ---
ADMIN_PASSWORD=choose-a-strong-password

# --- Resend (emails) ---
RESEND_API_KEY=your-resend-api-key
FROM_EMAIL=booking@yourlab.com
ADMIN_NOTIFICATION_EMAIL=team@yourlab.com   # where the lab gets notified of bookings

# --- Upstash QStash (reminders) ---
QSTASH_URL=your-qstash-url
QSTASH_TOKEN=your-qstash-token
QSTASH_CURRENT_SIGNING_KEY=your-qstash-current-signing-key
QSTASH_NEXT_SIGNING_KEY=your-qstash-next-signing-key

# --- General ---
NEXT_PUBLIC_SITE_URL=http://localhost:3000   # your live website address once deployed
TIMEZONE=Europe/Berlin                       # the timezone your sessions are in
```

**What each line means:**

| Variable | What it is | Where it came from |
|----------|------------|--------------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Address of your database | Supabase → Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public database key (safe for the browser) | Supabase → Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Master database key (server only — keep secret) | Supabase → Settings → API |
| `ADMIN_PASSWORD` | The password you type to open the admin page | **You make this up** |
| `RESEND_API_KEY` | Lets the site send email | Resend → API Keys |
| `FROM_EMAIL` | The "from" address participants see | **You choose** (must be a verified Resend domain) |
| `ADMIN_NOTIFICATION_EMAIL` | Where the lab is alerted of new bookings/cancellations | **You choose** |
| `QSTASH_*` (4 keys) | Lets reminders be scheduled | Upstash → QStash |
| `NEXT_PUBLIC_SITE_URL` | Your website's address (used in email links) | `localhost:3000` locally; your real URL once live |
| `TIMEZONE` | Timezone for displaying session times | **You choose** (e.g., `Europe/Berlin`, `America/New_York`) |

---

## 7. Run it on your own computer

This lets you test everything before going live. In the project folder, in PowerShell:

```bash
npm run dev
```

Then open your browser to **<http://localhost:3000>**. You should see the booking page.
- The admin page is at **<http://localhost:3000/admin>** (it will ask for your `ADMIN_PASSWORD`).
- To stop the server, click on the PowerShell window and press **Ctrl + C**.

> First time, the page may be empty because there are no sessions yet. Go to `/admin`, log in, and create one to see it appear.

---

## 8. Put it on the internet (deploy to Vercel)

To let real participants use it, the site must be hosted online. Vercel does this for free.

1. **Upload your code to GitHub** (if it isn't already). In PowerShell, in the project folder:
   ```bash
   git add -A
   git commit -m "My booking site"
   git push
   ```
2. Go to <https://vercel.com>, sign in **with GitHub**, and click **Add New → Project**.
3. Find this project's repository in the list and click **Import**.
4. **Add your secret settings:** before clicking Deploy, open the **Environment Variables** section and add **every line from your `.env.local`** (the name on the left, the value on the right). Do this for all of them.
   - Set `NEXT_PUBLIC_SITE_URL` to your real Vercel address (e.g., `https://your-project.vercel.app`). You may need to deploy once first to learn this address, then update it and redeploy.
5. Click **Deploy** and wait. When it finishes, Vercel gives you a live link — that's your website.

**About the automatic reminders:** the schedule lives in [`vercel.json`](vercel.json):
- Nightly assignment of waiting people: **once a day at 22:00**.
- "Day before" and "3 hours before" reminder checks: **every 30 minutes**.

Vercel runs these automatically. Note that Vercel's free **Hobby** plan limits how often cron jobs may run; if you stay on the free plan you may need to change `*/30 * * * *` to a less frequent schedule. (Editing this file is the only code change most people ever need — see the next section.)

---

## 9. Using the admin page

Go to `your-site-address/admin` and enter your `ADMIN_PASSWORD`. From there you can:
- **Create a session:** set the date, start/end time, location, room, how many people fit (`max_participants`), supervisors, and notes.
- **See bookings:** each session shows who is confirmed and who is waiting.
- **Manage people:** confirm, remove, or move a participant to another session.
- **Track admin tasks:** mark whether the consent form was **sent**, and whether compensation is **done/received**.
- **Email participants:** send a custom message.

**Good to know — the built-in rules:**
- Sessions are shown to participants only if they fall within the **next 14 days**.
- A participant picks **1 first choice + up to 2 backups**. The system confirms the best available one.
- At most **one person who wears glasses** is confirmed per session.
- One email address can only hold **one active booking** at a time.
- When a confirmed person cancels, the **waiting list is automatically processed** to fill the freed spot.

---

## 10. Making it your own

This project belongs to the **AEyeCoL Lab**. If you want to run your **own** copy for a different lab or study, you do **not** need to change the program's code. You only change settings and a few text values:

1. **Use your own accounts.** Create your own Supabase, Resend, QStash, and Vercel accounts (Section 5) and put **your** keys in `.env.local` and in Vercel (Section 6). This alone makes it fully yours — your database, your emails, your website.
2. **Buy and verify your own domain.** Get a domain (Section 4), verify it in Resend (Section 5c), then set `FROM_EMAIL` and `ADMIN_NOTIFICATION_EMAIL` to your lab's addresses. This is the one part that costs money (~10–15 USD/year) and the one most people forget.
3. **Set your timezone and site URL.** Update `TIMEZONE` and `NEXT_PUBLIC_SITE_URL`.
4. **Change the name and wording (optional).** The lab name "AEyeCoL" appears in page text and email templates. To rebrand, search the project for `AEyeCoL` / `aeyecol` and replace it with your lab's name. The main places are the page files under [`app/`](app/) and the email wording in [`lib/email.ts`](lib/email.ts).
5. **Adjust reminder timing (optional).** Edit [`vercel.json`](vercel.json) if you want reminders to run more or less often, or to fit a free hosting plan.

That's it — same system, your lab.

> ⚠️ The keys you collect are like passwords. If you ever paste a real key into a public place by accident, go to that service and **regenerate/rotate** the key immediately.

---

## 11. Common problems & answers

| Problem | Likely cause & fix |
|---------|--------------------|
| `npm run dev` fails immediately | Node.js isn't installed or is too old. Reinstall the LTS version from <https://nodejs.org>. |
| The page loads but shows "Failed to load sessions" | Supabase keys are wrong, or the tables weren't created. Re-check Section 5b and the keys in `.env.local`. |
| No emails arrive | `RESEND_API_KEY` is wrong, or your `FROM_EMAIL` domain isn't verified in Resend (Section 5c). Check the Resend dashboard's logs. |
| Reminders never send | QStash keys are wrong, or (on Vercel's free plan) the cron schedule is too frequent and got disabled. See Section 8. |
| Admin page won't accept my password | The password you type must exactly match `ADMIN_PASSWORD` in your settings (and in Vercel, if live). |
| I changed `.env.local` but nothing changed | Stop the server (Ctrl + C) and run `npm run dev` again. On Vercel, you must **redeploy** after changing variables. |
| Times look wrong | Set `TIMEZONE` to your region (e.g., `America/New_York`). |

**Still stuck?** Email **Mingcong Ding** at <mailto:mingcong.ding@tum.de> with a description of what you did and what went wrong (screenshots help).

---

### Technical note (for developers)

Built with **Next.js 16**, **React 19**, **Supabase**, **Resend**, **Upstash QStash**, and **Tailwind CSS v4**. This is a customized Next.js setup — before editing code, read the bundled guides in `node_modules/next/dist/docs/`, as some APIs differ from standard Next.js. Key logic lives in [`lib/assign.ts`](lib/assign.ts) (booking/waiting-list logic) and [`lib/email.ts`](lib/email.ts) (all email templates).
