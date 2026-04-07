"use client";

import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";

interface Booking {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  comments: string | null;
  created_at: string;
}

interface Session {
  id: string;
  date: string;
  start_time: string;
  end_time: string;
  location: string;
  max_participants: number;
  notes: string | null;
  bookings: Booking[];
}

interface SessionForm {
  date: string;
  start_time: string;
  end_time: string;
  location: string;
  max_participants: number;
  notes: string;
}

const emptySessionForm: SessionForm = {
  date: "",
  start_time: "",
  end_time: "",
  location: "",
  max_participants: 10,
  notes: "",
};

function formatDate(dateStr: string) {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  });
}

function formatTime(timeStr: string) {
  const [h, m] = timeStr.split(":");
  return `${h}:${m}`;
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function AdminPage() {
  const [authed, setAuthed] = useState(false);
  const [authChecking, setAuthChecking] = useState(true);

  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<SessionForm>(emptySessionForm);
  const [submitting, setSubmitting] = useState(false);

  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    async function checkAuth() {
      const pw = prompt("Enter admin password:");
      if (!pw) {
        setAuthChecking(false);
        return;
      }
      try {
        const res = await fetch("/api/admin/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password: pw }),
        });
        if (res.ok) {
          setAuthed(true);
        }
      } catch {
        /* verification failed */
      }
      setAuthChecking(false);
    }
    checkAuth();
  }, []);

  const fetchSessions = useCallback(async () => {
    const { data, error: fetchError } = await supabase
      .from("sessions")
      .select("*, bookings(*)")
      .order("date", { ascending: false })
      .order("start_time", { ascending: false });

    if (fetchError) {
      setError("Failed to load session data.");
      setLoading(false);
      return;
    }
    setSessions(data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (authed) fetchSessions();
  }, [authed, fetchSessions]);

  async function handleAddSession(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const res = await fetch("/api/admin/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: form.date,
        start_time: form.start_time,
        end_time: form.end_time,
        location: form.location,
        max_participants: form.max_participants,
        notes: form.notes || null,
      }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError("Failed to add session: " + (body?.error ?? "Unknown error"));
      setSubmitting(false);
      return;
    }

    setForm(emptySessionForm);
    setShowForm(false);
    setSubmitting(false);
    fetchSessions();
  }

  async function handleDelete(id: string) {
    setError(null);

    const res = await fetch(`/api/admin/sessions?id=${id}`, {
      method: "DELETE",
    });

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError("Failed to delete: " + (body?.error ?? "Unknown error"));
      setDeletingId(null);
      return;
    }

    setDeletingId(null);
    fetchSessions();
  }

  if (authChecking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <p className="text-gray-400">Verifying…</p>
      </div>
    );
  }

  if (!authed) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="text-center">
          <p className="mb-4 text-gray-500">Unauthorized access</p>
          <button
            onClick={() => window.location.reload()}
            className="rounded-lg bg-gray-800 px-4 py-2 text-sm text-white transition hover:bg-gray-700"
          >
            Re-enter Password
          </button>
        </div>
      </div>
    );
  }

  const inputClass =
    "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-4">
          <div>
            <h1 className="text-lg font-bold text-gray-900">Admin Dashboard</h1>
            <p className="text-xs text-gray-500">AEyeCoL Lab</p>
          </div>
          <a href="/" className="text-sm text-blue-600 hover:underline">
            Back to Booking
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-8">
        {error && (
          <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-800">
            All Sessions ({sessions.length})
          </h2>
          <button
            onClick={() => setShowForm(!showForm)}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700"
          >
            {showForm ? "Cancel" : "Add Session"}
          </button>
        </div>

        {showForm && (
          <form
            onSubmit={handleAddSession}
            className="mb-8 rounded-xl border border-gray-200 bg-white p-6 shadow-sm"
          >
            <h3 className="mb-4 text-base font-semibold text-gray-800">
              New Session
            </h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Date <span className="text-red-400">*</span>
                </label>
                <input
                  type="date"
                  required
                  value={form.date}
                  onChange={(e) => setForm({ ...form, date: e.target.value })}
                  className={inputClass}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Location <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={form.location}
                  onChange={(e) =>
                    setForm({ ...form, location: e.target.value })
                  }
                  className={inputClass}
                  placeholder="e.g. Science Building A301"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Start Time <span className="text-red-400">*</span>
                </label>
                <input
                  type="time"
                  required
                  value={form.start_time}
                  onChange={(e) =>
                    setForm({ ...form, start_time: e.target.value })
                  }
                  className={inputClass}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  End Time <span className="text-red-400">*</span>
                </label>
                <input
                  type="time"
                  required
                  value={form.end_time}
                  onChange={(e) =>
                    setForm({ ...form, end_time: e.target.value })
                  }
                  className={inputClass}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Max Participants <span className="text-red-400">*</span>
                </label>
                <input
                  type="number"
                  required
                  min={1}
                  value={form.max_participants}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      max_participants: parseInt(e.target.value) || 1,
                    })
                  }
                  className={inputClass}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Notes <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <input
                  type="text"
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  className={inputClass}
                  placeholder="Any additional information"
                />
              </div>
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="mt-5 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
            >
              {submitting ? "Submitting…" : "Add Session"}
            </button>
          </form>
        )}

        {loading ? (
          <div className="py-20 text-center text-gray-400">Loading…</div>
        ) : sessions.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-300 py-20 text-center text-gray-400">
            No sessions yet
          </div>
        ) : (
          <div className="space-y-4">
            {sessions.map((session) => (
              <div
                key={session.id}
                className="rounded-xl border border-gray-200 bg-white shadow-sm"
              >
                <div className="flex items-start justify-between border-b border-gray-100 px-5 py-4">
                  <div>
                    <div className="text-sm font-semibold text-gray-900">
                      {formatDate(session.date)}
                    </div>
                    <div className="mt-0.5 text-sm text-gray-500">
                      {formatTime(session.start_time)} –{" "}
                      {formatTime(session.end_time)} · {session.location}
                    </div>
                    {session.notes && (
                      <p className="mt-1 text-xs text-gray-400">
                        {session.notes}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">
                      {session.bookings.length} / {session.max_participants} booked
                    </span>
                    {deletingId === session.id ? (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-red-600">Are you sure?</span>
                        <button
                          onClick={() => handleDelete(session.id)}
                          className="rounded bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-700"
                        >
                          Delete
                        </button>
                        <button
                          onClick={() => setDeletingId(null)}
                          className="rounded bg-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-300"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setDeletingId(session.id)}
                        className="rounded px-2 py-1 text-xs text-red-500 transition hover:bg-red-50"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>

                {session.bookings.length === 0 ? (
                  <div className="px-5 py-4 text-center text-xs text-gray-400">
                    No bookings yet
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="border-b border-gray-100 text-xs text-gray-500">
                          <th className="px-5 py-2.5 font-medium">Name</th>
                          <th className="px-5 py-2.5 font-medium">Email</th>
                          <th className="px-5 py-2.5 font-medium">Phone</th>
                          <th className="px-5 py-2.5 font-medium">Comments</th>
                          <th className="px-5 py-2.5 font-medium">Booked At</th>
                        </tr>
                      </thead>
                      <tbody>
                        {session.bookings.map((b) => (
                          <tr
                            key={b.id}
                            className="border-b border-gray-50 last:border-0"
                          >
                            <td className="whitespace-nowrap px-5 py-2.5 font-medium text-gray-900">
                              {b.full_name}
                            </td>
                            <td className="whitespace-nowrap px-5 py-2.5 text-gray-600">
                              {b.email}
                            </td>
                            <td className="whitespace-nowrap px-5 py-2.5 text-gray-600">
                              {b.phone || "—"}
                            </td>
                            <td className="max-w-[200px] truncate px-5 py-2.5 text-gray-500">
                              {b.comments || "—"}
                            </td>
                            <td className="whitespace-nowrap px-5 py-2.5 text-gray-400">
                              {formatDateTime(b.created_at)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
