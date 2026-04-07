"use client";

import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";

interface Session {
  id: string;
  date: string;
  start_time: string;
  end_time: string;
  location: string;
  max_participants: number;
  notes: string | null;
  bookings: { count: number }[];
}

interface BookingForm {
  full_name: string;
  email: string;
  phone: string;
  comments: string;
}

const emptyForm: BookingForm = {
  full_name: "",
  email: "",
  phone: "",
  comments: "",
};

function spotsRemaining(session: Session) {
  return session.max_participants - (session.bookings[0]?.count ?? 0);
}

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

export default function Home() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSession, setSelectedSession] = useState<Session | null>(null);
  const [form, setForm] = useState<BookingForm>(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [booked, setBooked] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchSessions = useCallback(async () => {
    const today = new Date().toISOString().split("T")[0];
    const { data, error: fetchError } = await supabase
      .from("sessions")
      .select("*, bookings(count)")
      .gte("date", today)
      .order("date", { ascending: true })
      .order("start_time", { ascending: true });

    if (fetchError) {
      console.error("Session fetch error:", fetchError);
      setError("Failed to load sessions: " + fetchError.message);
      setLoading(false);
      return;
    }

    const available = (data ?? []).filter(
      (s: Session) => (s.bookings[0]?.count ?? 0) < s.max_participants
    );
    setSessions(available);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedSession) return;

    setSubmitting(true);
    setError(null);

    const { error: insertError } = await supabase.from("bookings").insert({
      session_id: selectedSession.id,
      full_name: form.full_name,
      email: form.email,
      phone: form.phone || null,
      comments: form.comments || null,
    });

    if (insertError) {
      console.error("Booking insert error:", insertError);
      setError("Failed to submit booking: " + insertError.message);
      setSubmitting(false);
      return;
    }

    setBooked(selectedSession);
    setSelectedSession(null);
    setForm(emptyForm);
    setSubmitting(false);
    fetchSessions();
  }

  if (booked) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Header />
        <main className="mx-auto max-w-2xl px-4 py-12">
          <div className="rounded-xl border border-green-200 bg-green-50 p-8 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-green-100">
              <svg className="h-7 w-7 text-green-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
            </div>
            <h2 className="mb-2 text-xl font-semibold text-green-900">Booking Confirmed!</h2>
            <p className="mb-6 text-green-700">Your booking has been confirmed. Details below:</p>
            <div className="mx-auto max-w-sm rounded-lg bg-white p-5 text-left text-sm text-gray-700 shadow-sm">
              <dl className="space-y-2">
                <div className="flex justify-between">
                  <dt className="font-medium text-gray-500">Date</dt>
                  <dd>{formatDate(booked.date)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="font-medium text-gray-500">Time</dt>
                  <dd>{formatTime(booked.start_time)} – {formatTime(booked.end_time)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="font-medium text-gray-500">Location</dt>
                  <dd>{booked.location}</dd>
                </div>
                {booked.notes && (
                  <div className="flex justify-between">
                    <dt className="font-medium text-gray-500">Notes</dt>
                    <dd>{booked.notes}</dd>
                  </div>
                )}
              </dl>
            </div>
            <button
              onClick={() => setBooked(null)}
              className="mt-6 rounded-lg bg-green-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-green-700"
            >
              Back to Sessions
            </button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <main className="mx-auto max-w-3xl px-4 py-10">
        <h2 className="mb-6 text-lg font-semibold text-gray-800">Available Sessions</h2>

        {error && (
          <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {loading ? (
          <div className="py-20 text-center text-gray-400">Loading…</div>
        ) : sessions.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-300 py-20 text-center text-gray-400">
            No sessions available for booking
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {sessions.map((session) => {
              const spots = spotsRemaining(session);
              const isSelected = selectedSession?.id === session.id;
              return (
                <button
                  key={session.id}
                  onClick={() => {
                    setSelectedSession(isSelected ? null : session);
                    setForm(emptyForm);
                    setError(null);
                  }}
                  className={`rounded-xl border p-5 text-left transition ${
                    isSelected
                      ? "border-blue-500 bg-blue-50 ring-2 ring-blue-200"
                      : "border-gray-200 bg-white hover:border-gray-300 hover:shadow-sm"
                  }`}
                >
                  <div className="mb-1 text-sm font-semibold text-gray-900">
                    {formatDate(session.date)}
                  </div>
                  <div className="mb-3 text-sm text-gray-500">
                    {formatTime(session.start_time)} – {formatTime(session.end_time)} · {session.location}
                  </div>
                  <div className="flex items-center justify-between">
                    <span
                      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        spots <= 2
                          ? "bg-amber-100 text-amber-700"
                          : "bg-emerald-100 text-emerald-700"
                      }`}
                    >
                      {spots} spot{spots !== 1 ? "s" : ""} remaining
                    </span>
                    {isSelected && (
                      <span className="text-xs font-medium text-blue-600">Selected</span>
                    )}
                  </div>
                  {session.notes && (
                    <p className="mt-3 text-xs leading-relaxed text-gray-400">
                      {session.notes}
                    </p>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {selectedSession && (
          <div className="mt-8 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <h3 className="mb-4 text-base font-semibold text-gray-800">Booking Information</h3>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="full_name" className="mb-1 block text-sm font-medium text-gray-700">
                  Full Name <span className="text-red-400">*</span>
                </label>
                <input
                  id="full_name"
                  type="text"
                  required
                  value={form.full_name}
                  onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  placeholder="Enter your full name"
                />
              </div>
              <div>
                <label htmlFor="email" className="mb-1 block text-sm font-medium text-gray-700">
                  Email <span className="text-red-400">*</span>
                </label>
                <input
                  id="email"
                  type="email"
                  required
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  placeholder="example@university.edu"
                />
              </div>
              <div>
                <label htmlFor="phone" className="mb-1 block text-sm font-medium text-gray-700">
                  Phone <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <input
                  id="phone"
                  type="tel"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  placeholder="Enter your phone number"
                />
              </div>
              <div>
                <label htmlFor="comments" className="mb-1 block text-sm font-medium text-gray-700">
                  Comments <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <textarea
                  id="comments"
                  rows={3}
                  value={form.comments}
                  onChange={(e) => setForm({ ...form, comments: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  placeholder="Any special requirements or notes"
                />
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? "Submitting…" : "Confirm Booking"}
              </button>
            </form>
          </div>
        )}
      </main>
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
