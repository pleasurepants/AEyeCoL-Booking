"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

interface Session {
  id: string;
  date: string;
  start_time: string;
  end_time: string;
  location: string;
  room: string | null;
  max_participants: number;
  notes: string | null;
  confirmed_count: number;
  glasses_count: number;
}

type Glasses = "none" | "contacts" | "glasses";

interface PersonalInfo {
  full_name: string;
  email: string;
  phone: string;
  comments: string;
  glasses: Glasses;
}

interface ConfirmedSessionInfo {
  date: string;
  start_time: string;
  end_time: string;
  location: string;
  room: string | null;
}

type Step = "info" | "first" | "backups" | "submitted";

const emptyInfo: PersonalInfo = {
  full_name: "",
  email: "",
  phone: "",
  comments: "",
  glasses: "none",
};

function formatDate(dateStr: string) {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  });
}

function formatTime(timeStr: string) {
  const [h, m] = timeStr.split(":");
  return `${h}:${m}`;
}

function isFullFor(session: Session, glasses: Glasses) {
  if (session.confirmed_count >= session.max_participants) return true;
  if (glasses === "glasses" && session.glasses_count >= 1) return true;
  return false;
}

export default function Home() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [step, setStep] = useState<Step>("info");
  const [info, setInfo] = useState<PersonalInfo>(emptyInfo);
  const [firstChoice, setFirstChoice] = useState<Session | null>(null);
  const [backup1, setBackup1] = useState<Session | null>(null);
  const [backup2, setBackup2] = useState<Session | null>(null);
  const [confirmedSession, setConfirmedSession] = useState<ConfirmedSessionInfo | null>(null);
  const [wasConfirmed, setWasConfirmed] = useState(false);

  const fetchSessions = useCallback(async () => {
    const today = new Date().toISOString().split("T")[0];
    const twoWeeksLater = new Date();
    twoWeeksLater.setDate(twoWeeksLater.getDate() + 14);
    const endDate = twoWeeksLater.toISOString().split("T")[0];

    const { data: sessionData, error: fetchError } = await supabase
      .from("sessions")
      .select("id, date, start_time, end_time, location, room, max_participants, notes, status")
      .gte("date", today)
      .lte("date", endDate)
      .neq("status", "cancelled")
      .order("date", { ascending: true })
      .order("start_time", { ascending: true });

    if (fetchError) {
      console.error("Session fetch error:", fetchError);
      setError("Failed to load sessions: " + fetchError.message);
      setLoading(false);
      return;
    }

    const { data: countData } = await supabase
      .from("bookings")
      .select("session_id")
      .eq("status", "confirmed");

    const counts: Record<string, number> = {};
    for (const row of countData ?? []) {
      counts[row.session_id] = (counts[row.session_id] ?? 0) + 1;
    }

    const { data: glassesData } = await supabase
      .from("bookings")
      .select("session_id")
      .eq("status", "confirmed")
      .eq("glasses", "glasses");

    const glassesCounts: Record<string, number> = {};
    for (const row of glassesData ?? []) {
      glassesCounts[row.session_id] = (glassesCounts[row.session_id] ?? 0) + 1;
    }

    const now = new Date();
    const windowEnd = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
    const withCounts = (sessionData ?? [])
      .filter((s) => {
        const sessionEnd = new Date(`${s.date}T${s.end_time}`);
        return sessionEnd > now && sessionEnd <= windowEnd;
      })
      .map((s) => ({
        ...s,
        confirmed_count: counts[s.id] ?? 0,
        glasses_count: glassesCounts[s.id] ?? 0,
      }));

    setSessions(withCounts);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  function handleInfoSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStep("first");
  }

  function handleFirstChoice(session: Session) {
    setFirstChoice(session);
    setBackup1(null);
    setBackup2(null);
    setStep("backups");
  }

  function toggleBackup(session: Session) {
    if (backup1?.id === session.id) {
      setBackup1(backup2);
      setBackup2(null);
      return;
    }
    if (backup2?.id === session.id) {
      setBackup2(null);
      return;
    }
    if (!backup1) {
      setBackup1(session);
    } else if (!backup2) {
      setBackup2(session);
    }
  }

  function backupLabel(session: Session): string | null {
    if (backup1?.id === session.id) return "Backup 1";
    if (backup2?.id === session.id) return "Backup 2";
    return null;
  }

  async function handleSubmit() {
    if (!firstChoice) return;

    setSubmitting(true);
    setError(null);

    const sessionChoices = [
      { session_id: firstChoice.id, preference_order: 1 },
      ...(backup1 ? [{ session_id: backup1.id, preference_order: 2 }] : []),
      ...(backup2 ? [{ session_id: backup2.id, preference_order: 3 }] : []),
    ];

    try {
      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          full_name: info.full_name,
          email: info.email,
          phone: info.phone || null,
          comments: info.comments || null,
          glasses: info.glasses,
          sessions: sessionChoices,
        }),
      });

      const body = await res.json().catch(() => null);

      if (!res.ok) {
        if (res.status === 409) {
          setError(body?.error ?? "You have already registered with this email.");
        } else {
          setError("Failed to submit: " + (body?.error ?? "Unknown error"));
        }
        setSubmitting(false);
        return;
      }

      setWasConfirmed(!!body?.confirmed);
      if (body?.session) {
        setConfirmedSession(body.session);
      }
    } catch {
      setError("Failed to submit. Please try again.");
      setSubmitting(false);
      return;
    }

    setSubmitting(false);
    setStep("submitted");
  }

  const inputClass =
    "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";

  if (step === "submitted") {
    const isBackupConfirm =
      wasConfirmed &&
      confirmedSession &&
      firstChoice &&
      (confirmedSession.date !== firstChoice.date ||
        confirmedSession.start_time !== firstChoice.start_time);

    return (
      <div className="min-h-screen bg-gray-50">
        <Header />
        <main className="mx-auto max-w-2xl px-4 py-12">
          {wasConfirmed && !isBackupConfirm ? (
            /* ── Green: confirmed into first choice ── */
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-8 text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100">
                <svg className="h-7 w-7 text-emerald-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
              </div>
              <h2 className="mb-2 text-xl font-semibold text-emerald-900">Session Confirmed</h2>
              <p className="text-emerald-700">
                You have been confirmed for the following session:
              </p>

              {confirmedSession && (
                <div className="mx-auto mt-6 max-w-xs rounded-lg border border-emerald-200 bg-white p-4 text-left">
                  <div className="text-sm font-semibold text-gray-900">{formatDate(confirmedSession.date)}</div>
                  <div className="mt-1 text-sm text-gray-600">
                    {formatTime(confirmedSession.start_time)} – {formatTime(confirmedSession.end_time)}
                  </div>
                  <div className="mt-1 text-sm text-gray-600">
                    {confirmedSession.location}
                    {confirmedSession.room && `, ${confirmedSession.room}`}
                  </div>
                </div>
              )}

              <div className="mx-auto mt-6 max-w-sm text-left text-sm text-emerald-800 space-y-2">
                <p>• You will receive a reminder email <strong>24 hours</strong> and <strong>3 hours</strong> before your session.</p>
                <p>• If you need to cancel, use the link in your confirmation email.</p>
                <p className="text-emerald-600">• Emails are sent from <strong>booking@aeyecol.com</strong>. If you don&apos;t see it, please check your spam/junk folder.</p>
              </div>
            </div>
          ) : wasConfirmed && isBackupConfirm ? (
            /* ── Blue: first choice full, confirmed into backup ── */
            <div className="rounded-xl border border-blue-200 bg-blue-50 p-8 text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-blue-100">
                <svg className="h-7 w-7 text-blue-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
              </div>
              <h2 className="mb-2 text-xl font-semibold text-blue-900">Confirmed — Backup Session</h2>
              <p className="text-blue-700">
                Your first choice was full. You have been confirmed for the following backup session:
              </p>

              {confirmedSession && (
                <div className="mx-auto mt-6 max-w-xs rounded-lg border border-blue-200 bg-white p-4 text-left">
                  <div className="text-sm font-semibold text-gray-900">{formatDate(confirmedSession.date)}</div>
                  <div className="mt-1 text-sm text-gray-600">
                    {formatTime(confirmedSession.start_time)} – {formatTime(confirmedSession.end_time)}
                  </div>
                  <div className="mt-1 text-sm text-gray-600">
                    {confirmedSession.location}
                    {confirmedSession.room && `, ${confirmedSession.room}`}
                  </div>
                </div>
              )}

              <div className="mx-auto mt-6 max-w-sm text-left text-sm text-blue-800 space-y-2">
                <p>• If a spot opens up in your first choice, you will be <strong>automatically upgraded</strong> and notified by email.</p>
                <p>• You will receive a reminder email <strong>24 hours</strong> and <strong>3 hours</strong> before your session.</p>
                <p>• If you need to cancel, use the link in your confirmation email.</p>
                <p className="text-blue-600">• Emails are sent from <strong>booking@aeyecol.com</strong>. If you don&apos;t see it, please check your spam/junk folder.</p>
              </div>
            </div>
          ) : (
            /* ── Amber: waitlist ── */
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-8 text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-amber-100">
                <svg className="h-7 w-7 text-amber-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                </svg>
              </div>
              <h2 className="mb-2 text-xl font-semibold text-amber-900">On the Waitlist</h2>
              <p className="text-amber-700">
                Your selected sessions are currently full. You have been placed on the waitlist.
              </p>

              {firstChoice && (
                <div className="mx-auto mt-6 max-w-xs rounded-lg border border-amber-200 bg-white p-4 text-left">
                  <div className="mb-1 text-xs font-medium text-amber-600">Your selections</div>
                  <div className="text-sm text-gray-900">{formatDate(firstChoice.date)} — {formatTime(firstChoice.start_time)}</div>
                  {backup1 && (
                    <div className="mt-1 text-sm text-gray-500">Backup: {formatDate(backup1.date)} — {formatTime(backup1.start_time)}</div>
                  )}
                  {backup2 && (
                    <div className="mt-1 text-sm text-gray-500">Backup: {formatDate(backup2.date)} — {formatTime(backup2.start_time)}</div>
                  )}
                </div>
              )}

              <div className="mx-auto mt-6 max-w-sm text-left text-sm text-amber-800 space-y-2">
                <p>• If a spot opens up in any of your preferred sessions, you will be <strong>automatically confirmed</strong> and notified by email.</p>
                <p>• No action is needed from you — just keep an eye on your inbox.</p>
                <p className="text-amber-600">• Emails are sent from <strong>booking@aeyecol.com</strong>. If you don&apos;t see it, please check your spam/junk folder.</p>
              </div>

              <div className="mx-auto mt-6 max-w-sm rounded-lg border border-amber-200 bg-white px-4 py-3 text-left text-sm text-amber-900">
                <p className="mb-2">
                  Want to hear about <strong>brand-new sessions</strong> as they open (not just spots in your current picks)?
                </p>
                <Link
                  href={`/subscribe?email=${encodeURIComponent(info.email)}&full_name=${encodeURIComponent(info.full_name)}`}
                  className="inline-block rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700"
                >
                  Notify me about new sessions
                </Link>
              </div>
            </div>
          )}
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <main className="mx-auto max-w-3xl px-4 py-10">
        {error && (
          <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="mb-8 flex items-center gap-2 text-xs font-medium text-gray-400">
          <span className={step === "info" ? "text-blue-600" : "text-gray-600"}>
            1. Your Info
          </span>
          <span>→</span>
          <span className={step === "first" ? "text-blue-600" : step === "backups" ? "text-gray-600" : ""}>
            2. First Choice
          </span>
          <span>→</span>
          <span className={step === "backups" ? "text-blue-600" : ""}>
            3. Backups
          </span>
        </div>

        {step === "info" && (
          <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="mb-1 text-lg font-semibold text-gray-900">Your Information</h2>
            <p className="mb-5 text-sm text-gray-500">
              Please fill in your details before selecting a session.
            </p>
            <form onSubmit={handleInfoSubmit} className="space-y-4">
              <div>
                <label htmlFor="full_name" className="mb-1 block text-sm font-medium text-gray-700">
                  Full Name <span className="text-red-400">*</span>
                </label>
                <input id="full_name" type="text" required value={info.full_name}
                  onChange={(e) => setInfo({ ...info, full_name: e.target.value })}
                  className={inputClass} placeholder="Enter your full name" />
              </div>
              <div>
                <label htmlFor="email" className="mb-1 block text-sm font-medium text-gray-700">
                  Email <span className="text-red-400">*</span>
                </label>
                <input id="email" type="email" required value={info.email}
                  onChange={(e) => setInfo({ ...info, email: e.target.value })}
                  className={inputClass} placeholder="example@university.edu" />
              </div>
              <div>
                <label htmlFor="phone" className="mb-1 block text-sm font-medium text-gray-700">
                  Phone <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <input id="phone" type="tel" value={info.phone}
                  onChange={(e) => setInfo({ ...info, phone: e.target.value })}
                  className={inputClass} placeholder="Enter your phone number" />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700">
                  Vision / Glasses <span className="text-red-400">*</span>
                </label>
                <div className="flex flex-col gap-2">
                  {([
                    ["none", "No glasses"],
                    ["contacts", "Contact lenses"],
                    ["glasses", "Glasses"],
                  ] as const).map(([value, label]) => (
                    <label key={value} className="flex items-center gap-2.5 cursor-pointer">
                      <input
                        type="radio"
                        name="glasses"
                        value={value}
                        checked={info.glasses === value}
                        onChange={() => setInfo({ ...info, glasses: value })}
                        className="h-4 w-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                      />
                      <span className="text-sm text-gray-700">{label}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <label htmlFor="comments" className="mb-1 block text-sm font-medium text-gray-700">
                  Comments <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <textarea id="comments" rows={3} value={info.comments}
                  onChange={(e) => setInfo({ ...info, comments: e.target.value })}
                  className={inputClass} placeholder="Any special requirements or notes" />
              </div>
              <button type="submit"
                className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-700">
                Continue
              </button>
            </form>
          </div>
        )}

        {step === "first" && (
          <>
            <div className="mb-1 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">Select Your First Choice</h2>
              <button onClick={() => setStep("info")} className="text-sm text-blue-600 hover:underline">← Back</button>
            </div>
            <p className="mb-5 text-sm text-gray-500">
              Choose the session you would most like to attend. Sessions marked &quot;Full&quot; can still be selected — you&apos;ll be placed on the waitlist and automatically confirmed if a spot opens up.
            </p>

            {loading ? (
              <div className="py-20 text-center text-gray-400">Loading…</div>
            ) : sessions.length === 0 ? (
              <div className="rounded-xl border border-dashed border-gray-300 py-20 text-center text-gray-400">
                <p>No sessions available right now.</p>
                <Link
                  href={`/subscribe?email=${encodeURIComponent(info.email)}&full_name=${encodeURIComponent(info.full_name)}`}
                  className="mt-4 inline-block rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                >
                  Notify me when new sessions open
                </Link>
              </div>
            ) : (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  {sessions.map((s) => (
                    <SessionCard
                      key={s.id}
                      session={s}
                      glasses={info.glasses}
                      onClick={() => handleFirstChoice(s)}
                    />
                  ))}
                </div>
                <SubscribeHint email={info.email} fullName={info.full_name} />
              </>
            )}
          </>
        )}

        {step === "backups" && firstChoice && (
          <>
            <div className="mb-1 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">Select Backup Sessions</h2>
              <button
                onClick={() => { setFirstChoice(null); setBackup1(null); setBackup2(null); setStep("first"); }}
                className="text-sm text-blue-600 hover:underline">← Back</button>
            </div>
            <p className="mb-5 text-sm text-gray-500">
              Optionally choose up to 2 backup sessions in case your first choice is full. Full sessions can also be selected as backups — you&apos;ll join the waitlist. You can also skip and submit now.
            </p>

            <div className="mb-5 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
              <div className="text-xs font-medium text-blue-600">First Choice</div>
              <div className="text-sm font-semibold text-gray-900">{formatDate(firstChoice.date)}</div>
              <div className="text-sm text-gray-500">
                {formatTime(firstChoice.start_time)} – {formatTime(firstChoice.end_time)} · {firstChoice.location}
                {firstChoice.room && `, ${firstChoice.room}`}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {sessions
                .filter((s) => s.id !== firstChoice.id)
                .map((s) => {
                  const label = backupLabel(s);
                  return (
                    <SessionCard
                      key={s.id}
                      session={s}
                      glasses={info.glasses}
                      onClick={() => toggleBackup(s)}
                      selected={!!label}
                      badge={label}
                    />
                  );
                })}
            </div>

            <div className="mt-6 flex gap-3">
              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-50">
                {submitting ? "Submitting…" : "Submit Registration"}
              </button>
              {!backup1 && (
                <span className="self-center text-xs text-gray-400">
                  No backups selected — that&apos;s okay!
                </span>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function SessionCard({
  session,
  glasses,
  onClick,
  selected,
  badge,
}: {
  session: Session;
  glasses: Glasses;
  onClick: () => void;
  selected?: boolean;
  badge?: string | null;
}) {
  const full = isFullFor(session, glasses);
  const spots = session.max_participants - session.confirmed_count;

  return (
    <button
      onClick={onClick}
      className={`rounded-xl border p-5 text-left transition ${
        selected
          ? "border-blue-500 bg-blue-50 ring-2 ring-blue-200"
          : "border-gray-200 bg-white hover:border-gray-300 hover:shadow-sm"
      }`}
    >
      <div className="mb-1 text-sm font-semibold text-gray-900">
        {formatDate(session.date)}
      </div>
      <div className="text-sm text-gray-500">
        {formatTime(session.start_time)} – {formatTime(session.end_time)} · {session.location}
        {session.room && `, ${session.room}`}
      </div>
      <div className="mt-2 flex items-center gap-2">
        {full ? (
          <span className="inline-block rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-700">
            Full — Waitlist Available
          </span>
        ) : session.confirmed_count === 0 ? (
          <span className="inline-block rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
            {spots} spot{spots !== 1 ? "s" : ""} remaining
          </span>
        ) : (
          <span className="inline-block rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700">
            {spots} spot{spots !== 1 ? "s" : ""} remaining
          </span>
        )}
        {badge && (
          <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-700">
            {badge}
          </span>
        )}
      </div>
      {session.notes && (
        <p className="mt-2 text-xs leading-relaxed text-gray-400">{session.notes}</p>
      )}
    </button>
  );
}

function SubscribeHint({ email, fullName }: { email: string; fullName: string }) {
  return (
    <div className="mt-6 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-center text-sm text-blue-800">
      Don&apos;t see a time that works?{" "}
      <Link
        href={`/subscribe?email=${encodeURIComponent(email)}&full_name=${encodeURIComponent(fullName)}`}
        className="font-medium text-blue-700 underline hover:text-blue-900"
      >
        Get an email when new sessions open
      </Link>
      .
    </div>
  );
}

function Header() {
  return (
    <header className="border-b border-gray-200 bg-white">
      <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
        <div>
          <h1 className="text-lg font-bold text-gray-900">Study Booking System</h1>
          <p className="text-xs text-gray-500">AEyeCoL Lab</p>
        </div>
      </div>
    </header>
  );
}
