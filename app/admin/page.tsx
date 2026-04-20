"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { supabase } from "@/lib/supabase";

/* ─── types ─── */

interface Booking {
  id: string;
  session_id: string;
  full_name: string;
  email: string;
  phone: string | null;
  comments: string | null;
  glasses: string | null;
  preference_order: number | null;
  status: string | null;
  created_at: string;
}

interface Session {
  id: string;
  date: string;
  start_time: string;
  end_time: string;
  location: string;
  room: string | null;
  max_participants: number;
  notes: string | null;
  status: string;
  supervisors: string[];
  bookings: Booking[];
}

interface SessionForm {
  date: string;
  start_time: string;
  end_time: string;
  location: string;
  room: string;
  max_participants: number;
  notes: string;
  supervisors: string[];
}

interface PreferenceEntry {
  session_id: string;
  preference_order: number | null;
  status: string | null;
  date: string;
  start_time: string;
}

/* ─── helpers ─── */

function getDefaultSessionForm(): SessionForm {
  const now = new Date();
  const mins = now.getMinutes();
  const roundedMins = mins < 15 ? 0 : mins < 45 ? 30 : 60;
  const start = new Date(now);
  start.setMinutes(roundedMins, 0, 0);
  if (roundedMins === 60) start.setHours(start.getHours());
  const end = new Date(start.getTime() + 90 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  const toTimeStr = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return { date: "", start_time: toTimeStr(start), end_time: toTimeStr(end), location: "Marsstraße 20", room: "", max_participants: 4, notes: "", supervisors: ["", ""] };
}

const SUPERVISOR_PRESETS = ["Karyna", "Franka", "Mingcong", "Babette"] as const;
const SUPERVISOR_MAX = 4;

function sanitizeSupervisors(arr: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of arr) {
    const v = raw.trim();
    if (!v) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

function SupervisorInputs({
  value,
  onChange,
  idPrefix,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  idPrefix: string;
}) {
  const rows = value.length < 2 ? [...value, ...Array(2 - value.length).fill("")] : value;
  const setAt = (i: number, v: string) => {
    const next = [...rows];
    next[i] = v;
    onChange(next);
  };
  const removeAt = (i: number) => {
    const next = rows.filter((_, idx) => idx !== i);
    onChange(next.length < 2 ? [...next, ...Array(2 - next.length).fill("")] : next);
  };
  const addRow = () => {
    if (rows.length >= SUPERVISOR_MAX) return;
    onChange([...rows, ""]);
  };
  const listId = `${idPrefix}-supervisor-presets`;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <datalist id={listId}>
        {SUPERVISOR_PRESETS.map((n) => <option key={n} value={n} />)}
      </datalist>
      {rows.map((v, i) => (
        <div key={i} className="flex items-center gap-1">
          <input
            type="text"
            list={listId}
            value={v}
            onChange={(e) => setAt(i, e.target.value)}
            placeholder={i === 0 ? "Supervisor 1" : i === 1 ? "Supervisor 2" : `Supervisor ${i + 1}`}
            className="w-36 rounded-lg border border-gray-300 px-2 py-1 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          {i >= 2 && (
            <button type="button" onClick={() => removeAt(i)} className="rounded px-1.5 py-0.5 text-xs text-gray-400 hover:bg-gray-100 hover:text-red-500" aria-label="Remove supervisor">✕</button>
          )}
        </div>
      ))}
      {rows.length < SUPERVISOR_MAX && (
        <button type="button" onClick={addRow} className="rounded-lg border border-dashed border-gray-300 px-2 py-1 text-xs font-medium text-gray-500 hover:border-blue-400 hover:text-blue-600">+</button>
      )}
    </div>
  );
}

function formatDate(dateStr: string) {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", weekday: "short" });
}
function shortDate(dateStr: string) {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
function formatTime(t: string) { const [h, m] = t.split(":"); return `${h}:${m}`; }
function formatDateTime(iso: string) { return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); }

const SESSION_STATUSES = ["upcoming", "completed", "cancelled"] as const;
const statusStyles: Record<string, string> = {
  upcoming: "bg-blue-100 text-blue-700",
  completed: "bg-gray-100 text-gray-600",
  cancelled: "bg-red-100 text-red-700",
};

/* ─── main component ─── */

export default function AdminPage() {
  const [authed, setAuthed] = useState(false);
  const [authChecking, setAuthChecking] = useState(true);

  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<SessionForm>(getDefaultSessionForm);
  const [submitting, setSubmitting] = useState(false);

  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);
  const [supervisorEditId, setSupervisorEditId] = useState<string | null>(null);
  const [supervisorDraft, setSupervisorDraft] = useState<string[]>(["", ""]);
  const [deletingBookingId, setDeletingBookingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [includePast, setIncludePast] = useState(false);

  // Email modal
  const [emailTarget, setEmailTarget] = useState<Booking | null>(null);
  const [emailSubject, setEmailSubject] = useState("");
  const [emailMessage, setEmailMessage] = useState("");
  const [sendingEmail, setSendingEmail] = useState(false);

  // Preference map: email → PreferenceEntry[]
  const [prefMap, setPrefMap] = useState<Record<string, PreferenceEntry[]>>({});

  // Busy states for per-booking actions
  const [busyBooking, setBusyBooking] = useState<string | null>(null);

  /* ─── auth ─── */
  useEffect(() => {
    async function checkAuth() {
      const pw = prompt("Enter admin password:");
      if (!pw) { setAuthChecking(false); return; }
      try {
        const res = await fetch("/api/admin/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: pw }) });
        if (res.ok) setAuthed(true);
      } catch { /* fail */ }
      setAuthChecking(false);
    }
    checkAuth();
  }, []);

  /* ─── data fetch ─── */
  const fetchSessions = useCallback(async () => {
    const { data, error: fetchError } = await supabase
      .from("sessions")
      .select("*, bookings(*)")
      .order("date", { ascending: false })
      .order("start_time", { ascending: false });

    if (fetchError) { setError("Failed to load session data."); setLoading(false); return; }
    setSessions((data ?? []).map((s) => ({ ...s, status: s.status ?? "upcoming", supervisors: s.supervisors ?? [] })));

    // Build preference map from all bookings
    const { data: allBookings } = await supabase
      .from("bookings")
      .select("email, session_id, preference_order, status, sessions(date, start_time)")
      .order("preference_order", { ascending: true });

    const map: Record<string, PreferenceEntry[]> = {};
    for (const b of allBookings ?? []) {
      const sess = (b as unknown as { sessions: { date: string; start_time: string } }).sessions;
      const entry: PreferenceEntry = {
        session_id: b.session_id,
        preference_order: b.preference_order,
        status: b.status,
        date: sess.date,
        start_time: sess.start_time,
      };
      if (!map[b.email]) map[b.email] = [];
      map[b.email].push(entry);
    }
    setPrefMap(map);
    setLoading(false);
  }, []);

  useEffect(() => { if (authed) fetchSessions(); }, [authed, fetchSessions]);

  /* ─── filtered sessions based on search + past toggle ─── */
  const filteredSessions = useMemo(() => {
    const now = new Date();
    let result = sessions;

    if (!includePast) {
      result = result.filter((s) => {
        const sessionStart = new Date(`${s.date}T${s.start_time}`);
        return sessionStart > now;
      });
    }

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.map((s) => ({
        ...s,
        bookings: s.bookings.filter(
          (b) => b.full_name.toLowerCase().includes(q) || b.email.toLowerCase().includes(q)
        ),
      })).filter((s) => s.bookings.length > 0);
    }

    return result;
  }, [sessions, search, includePast]);

  /* ─── handlers ─── */

  async function handleAddSession(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true); setError(null);
    const res = await fetch("/api/admin/sessions", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: form.date, start_time: form.start_time, end_time: form.end_time, location: form.location, room: form.room || null, max_participants: form.max_participants, notes: form.notes || null, supervisors: sanitizeSupervisors(form.supervisors) }),
    });
    if (!res.ok) { const b = await res.json().catch(() => null); setError("Failed to add session: " + (b?.error ?? "Unknown")); }
    else { setForm(getDefaultSessionForm()); setShowForm(false); fetchSessions(); }
    setSubmitting(false);
  }

  async function handleDeleteSession(id: string) {
    setError(null);
    const res = await fetch(`/api/admin/sessions?id=${id}`, { method: "DELETE" });
    if (!res.ok) { const b = await res.json().catch(() => null); setError("Failed to delete: " + (b?.error ?? "Unknown")); }
    setDeletingSessionId(null);
    fetchSessions();
  }

  async function handleSessionSupervisors(id: string, supervisors: string[]) {
    setError(null);
    const res = await fetch("/api/admin/sessions", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, supervisors: sanitizeSupervisors(supervisors) }),
    });
    if (!res.ok) { const b = await res.json().catch(() => null); setError("Supervisor update failed: " + (b?.error ?? "Unknown")); return false; }
    fetchSessions();
    return true;
  }

  async function handleSessionStatus(id: string, status: string) {
    setError(null);
    const res = await fetch("/api/admin/sessions", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status }),
    });
    if (!res.ok) { const b = await res.json().catch(() => null); setError("Status update failed: " + (b?.error ?? "Unknown")); }
    else { fetchSessions(); }
  }

  async function handleBookingAction(action: string, bookingId: string, extra?: Record<string, string>) {
    setBusyBooking(bookingId); setError(null);
    const res = await fetch("/api/admin/bookings", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, booking_id: bookingId, ...extra }),
    });
    if (!res.ok) { const b = await res.json().catch(() => null); setError(`Action '${action}' failed: ` + (b?.error ?? "Unknown")); }
    setBusyBooking(null);
    setDeletingBookingId(null);
    fetchSessions();
  }

  async function handleSendEmail() {
    if (!emailTarget || !emailSubject || !emailMessage) return;
    setSendingEmail(true); setError(null);
    const res = await fetch("/api/admin/email", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: emailTarget.email, name: emailTarget.full_name, subject: emailSubject, message: emailMessage }),
    });
    if (!res.ok) { const b = await res.json().catch(() => null); setError("Email failed: " + (b?.error ?? "Unknown")); }
    else { setSuccess(`Email sent to ${emailTarget.email}`); }
    setSendingEmail(false);
    setEmailTarget(null); setEmailSubject(""); setEmailMessage("");
  }

  /* ─── CSV export ─── */
  function handleExportCSV() {
    const rows: string[][] = [["Name", "Email", "Phone", "Glasses", "Session Date", "Start Time", "End Time", "Location", "Room", "Status", "Comments", "Booked At"]];
    for (const s of sessions) {
      for (const b of s.bookings) {
        if (b.status !== "confirmed") continue;
        rows.push([
          b.full_name, b.email, b.phone || "", b.glasses || "none", s.date,
          formatTime(s.start_time), formatTime(s.end_time),
          s.location, s.room || "", b.status || "", b.comments || "", b.created_at,
        ]);
      }
    }
    const csv = rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `confirmed-bookings-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /* ─── preference display ─── */
  function prefSummary(email: string, currentSessionId: string): string {
    const prefs = prefMap[email];
    if (!prefs || prefs.length <= 1) return "";
    return prefs
      .filter((p) => p.session_id !== currentSessionId)
      .map((p) => {
        const ord = p.preference_order === 1 ? "1st" : p.preference_order === 2 ? "2nd" : p.preference_order === 3 ? "3rd" : "?";
        return `${ord}: ${shortDate(p.date)} ${formatTime(p.start_time)}`;
      })
      .join(", ");
  }

  /* ─── render gates ─── */

  if (authChecking) return <div className="flex min-h-screen items-center justify-center bg-gray-50"><p className="text-gray-400">Verifying…</p></div>;

  if (!authed) return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="text-center">
        <p className="mb-4 text-gray-500">Unauthorized access</p>
        <button onClick={() => window.location.reload()} className="rounded-lg bg-gray-800 px-4 py-2 text-sm text-white hover:bg-gray-700">Re-enter Password</button>
      </div>
    </div>
  );

  const inputClass = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
          <div>
            <h1 className="text-lg font-bold text-gray-900">Admin Dashboard</h1>
            <p className="text-xs text-gray-500">AEyeCoL Lab</p>
          </div>
          <a href="/" className="text-sm text-blue-600 hover:underline">Back to Booking</a>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8">
        {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
        {success && <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">{success}</div>}

        {/* Top bar: search + actions */}
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <input
            type="text"
            placeholder="Search by name or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 min-w-[200px] rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <button
            onClick={() => setIncludePast(!includePast)}
            className={`rounded-lg border px-4 py-2 text-sm font-medium transition ${
              includePast
                ? "border-blue-300 bg-blue-50 text-blue-700"
                : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
            }`}
          >
            Past Sessions: {includePast ? "Shown" : "Hidden"}
          </button>
          <button onClick={handleExportCSV} className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Export CSV</button>
          <button onClick={() => setShowForm(!showForm)} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
            {showForm ? "Cancel" : "Add Session"}
          </button>
        </div>

        {/* Add session form */}
        {showForm && (
          <form onSubmit={handleAddSession} className="mb-8 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <h3 className="mb-4 text-base font-semibold text-gray-800">New Session</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Date <span className="text-red-400">*</span></label>
                <input type="date" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className={inputClass} />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Location <span className="text-red-400">*</span></label>
                <input type="text" required value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} className={inputClass} placeholder="e.g. Marsstraße 20" />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Room <span className="text-gray-400 font-normal">(optional)</span></label>
                <input type="text" value={form.room} onChange={(e) => setForm({ ...form, room: e.target.value })} className={inputClass} placeholder="e.g. Room 301" />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Start Time <span className="text-red-400">*</span></label>
                <input type="time" required value={form.start_time}
                  onChange={(e) => {
                    const st = e.target.value;
                    const [h, m] = st.split(":").map(Number);
                    const endDate = new Date(2000, 0, 1, h, m + 90);
                    const pad = (n: number) => String(n).padStart(2, "0");
                    const et = `${pad(endDate.getHours())}:${pad(endDate.getMinutes())}`;
                    setForm({ ...form, start_time: st, end_time: et });
                  }}
                  className={inputClass} />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">End Time <span className="text-red-400">*</span></label>
                <input type="time" required value={form.end_time} onChange={(e) => setForm({ ...form, end_time: e.target.value })} className={inputClass} />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Max Participants <span className="text-red-400">*</span></label>
                <input type="number" required min={1} value={form.max_participants} onChange={(e) => setForm({ ...form, max_participants: parseInt(e.target.value) || 1 })} className={inputClass} />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Notes <span className="text-gray-400 font-normal">(optional)</span></label>
                <input type="text" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className={inputClass} placeholder="Any additional information" />
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1 block text-sm font-medium text-gray-700">Supervisors <span className="text-gray-400 font-normal">(optional, can edit later)</span></label>
                <SupervisorInputs
                  idPrefix="new-session"
                  value={form.supervisors}
                  onChange={(next) => setForm({ ...form, supervisors: next })}
                />
              </div>
            </div>
            <button type="submit" disabled={submitting} className="mt-5 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
              {submitting ? "Submitting…" : "Add Session"}
            </button>
          </form>
        )}

        {/* Sessions list */}
        {loading ? (
          <div className="py-20 text-center text-gray-400">Loading…</div>
        ) : filteredSessions.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-300 py-20 text-center text-gray-400">
            {search ? "No matching bookings" : "No sessions yet"}
          </div>
        ) : (
          <div className="space-y-4">
            {filteredSessions.map((session) => {
              const confirmedCount = session.bookings.filter((b) => b.status === "confirmed").length;
              const isCompleted = session.status === "completed";
              const isCancelled = session.status === "cancelled";

              return (
                <div key={session.id} className={`rounded-xl border shadow-sm ${isCancelled ? "border-red-200 bg-red-50/30" : isCompleted ? "border-gray-200 bg-gray-50" : "border-gray-200 bg-white"}`}>
                  {/* Session header */}
                  <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-100 px-5 py-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <div className="text-sm font-semibold text-gray-900">{formatDate(session.date)}</div>
                        {supervisorEditId === session.id ? (
                          <div className="flex flex-wrap items-center gap-2">
                            <SupervisorInputs
                              idPrefix={`edit-${session.id}`}
                              value={supervisorDraft}
                              onChange={setSupervisorDraft}
                            />
                            <button
                              onClick={async () => {
                                const ok = await handleSessionSupervisors(session.id, supervisorDraft);
                                if (ok) setSupervisorEditId(null);
                              }}
                              className="rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700"
                            >Save</button>
                            <button
                              onClick={() => setSupervisorEditId(null)}
                              className="rounded bg-gray-200 px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-300"
                            >Cancel</button>
                          </div>
                        ) : session.supervisors && session.supervisors.length > 0 ? (
                          <div className="flex flex-wrap items-center gap-1">
                            {session.supervisors.map((s, i) => (
                              <span key={i} className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700">{s}</span>
                            ))}
                            <button
                              onClick={() => { setSupervisorDraft(session.supervisors.length < 2 ? [...session.supervisors, ...Array(2 - session.supervisors.length).fill("")] : [...session.supervisors]); setSupervisorEditId(session.id); }}
                              className="rounded px-1.5 py-0.5 text-xs text-gray-400 hover:bg-gray-100 hover:text-blue-600"
                            >Edit</button>
                          </div>
                        ) : (
                          <button
                            onClick={() => { setSupervisorDraft(["", ""]); setSupervisorEditId(session.id); }}
                            className="rounded-full border border-dashed border-gray-300 px-2 py-0.5 text-xs font-medium text-gray-400 hover:border-blue-400 hover:text-blue-600"
                          >+ Add supervisors</button>
                        )}
                      </div>
                      <div className="mt-0.5 text-sm text-gray-500">
                        {formatTime(session.start_time)} – {formatTime(session.end_time)} · {session.location}
                        {session.room && `, ${session.room}`}
                      </div>
                      {session.notes && <p className="mt-1 text-xs text-gray-400">{session.notes}</p>}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">
                        {confirmedCount} / {session.max_participants} confirmed
                      </span>
                      <select
                        value={session.status}
                        onChange={(e) => handleSessionStatus(session.id, e.target.value)}
                        className={`rounded-full px-2.5 py-0.5 text-xs font-medium border-0 cursor-pointer ${statusStyles[session.status] || "bg-gray-100 text-gray-600"}`}
                      >
                        {SESSION_STATUSES.map((s) => (
                          <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
                        ))}
                      </select>
                      {deletingSessionId === session.id ? (
                        <div className="flex items-center gap-1">
                          <button onClick={() => handleDeleteSession(session.id)} className="rounded bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-700">Yes, Remove</button>
                          <button onClick={() => setDeletingSessionId(null)} className="rounded bg-gray-200 px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-300">Keep</button>
                        </div>
                      ) : (
                        <button onClick={() => setDeletingSessionId(session.id)} className="rounded px-2 py-1 text-xs text-red-500 hover:bg-red-50">Remove</button>
                      )}
                    </div>
                  </div>

                  {/* Bookings table */}
                  {session.bookings.length === 0 ? (
                    <div className="px-5 py-4 text-center text-xs text-gray-400">No bookings</div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-sm">
                        <thead>
                          <tr className="border-b border-gray-100 text-xs text-gray-500">
                            <th className="px-4 py-2.5 font-medium">Name</th>
                            <th className="px-4 py-2.5 font-medium">Status</th>
                            <th className="px-4 py-2.5 font-medium">Actions</th>
                            <th className="px-4 py-2.5 font-medium">Glasses</th>
                            <th className="px-4 py-2.5 font-medium">Email</th>
                            <th className="px-4 py-2.5 font-medium">Phone</th>
                            <th className="px-4 py-2.5 font-medium">Pref</th>
                            <th className="px-4 py-2.5 font-medium">Other Prefs</th>
                            <th className="px-4 py-2.5 font-medium">Comments</th>
                            <th className="px-4 py-2.5 font-medium">Booked At</th>
                          </tr>
                        </thead>
                        <tbody>
                          {session.bookings.map((b) => {
                            const isBusy = busyBooking === b.id;
                            const otherPrefs = prefSummary(b.email, session.id);
                            return (
                              <tr key={b.id} className="border-b border-gray-50 last:border-0">
                                <td className="whitespace-nowrap px-4 py-2.5 font-medium text-gray-900">{b.full_name}</td>
                                <td className="whitespace-nowrap px-4 py-2.5">
                                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                                    b.status === "confirmed" ? "bg-green-100 text-green-700"
                                    : b.status === "pending" ? "bg-amber-100 text-amber-700"
                                    : "bg-gray-100 text-gray-600"
                                  }`}>{b.status || "—"}</span>
                                </td>
                                <td className="whitespace-nowrap px-4 py-2.5">
                                  <div className="flex items-center gap-1">
                                    {b.status === "pending" && (
                                      <button disabled={isBusy} onClick={() => handleBookingAction("confirm", b.id)}
                                        className="rounded bg-green-600 px-2 py-1 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50">Confirm</button>
                                    )}
                                    {b.status === "confirmed" && (
                                      <button disabled={isBusy} onClick={() => handleBookingAction("set-pending", b.id)}
                                        className="rounded bg-amber-500 px-2 py-1 text-xs font-medium text-white hover:bg-amber-600 disabled:opacity-50">Unconfirm</button>
                                    )}
                                    <select
                                      disabled={isBusy}
                                      value=""
                                      onChange={(e) => { if (e.target.value) handleBookingAction("move", b.id, { target_session_id: e.target.value }); }}
                                      className="rounded border border-gray-200 bg-white px-1 py-1 text-xs text-gray-600 disabled:opacity-50"
                                    >
                                      <option value="">Move to…</option>
                                      {sessions.filter((s) => s.id !== session.id && s.status !== "cancelled").map((s) => (
                                        <option key={s.id} value={s.id}>{shortDate(s.date)} {formatTime(s.start_time)}</option>
                                      ))}
                                    </select>
                                    <button onClick={() => { setEmailTarget(b); setEmailSubject(""); setEmailMessage(""); }}
                                      className="rounded bg-gray-100 px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-200">Email</button>
                                    {deletingBookingId === b.id ? (
                                      <div className="flex items-center gap-1">
                                        <button onClick={() => handleBookingAction("delete", b.id)} disabled={isBusy}
                                          className="rounded bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50">Yes</button>
                                        <button onClick={() => setDeletingBookingId(null)}
                                          className="rounded bg-gray-200 px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-300">No</button>
                                      </div>
                                    ) : (
                                      <button onClick={() => setDeletingBookingId(b.id)}
                                        className="rounded px-2 py-1 text-xs text-red-500 hover:bg-red-50">Remove</button>
                                    )}
                                  </div>
                                </td>
                                <td className="whitespace-nowrap px-4 py-2.5">
                                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                                    b.glasses === "glasses" ? "bg-purple-100 text-purple-700"
                                    : b.glasses === "contacts" ? "bg-sky-100 text-sky-700"
                                    : "bg-gray-100 text-gray-600"
                                  }`}>
                                    {b.glasses === "glasses" ? "Glasses" : b.glasses === "contacts" ? "Contacts" : "None"}
                                  </span>
                                </td>
                                <td className="whitespace-nowrap px-4 py-2.5 text-gray-600">{b.email}</td>
                                <td className="whitespace-nowrap px-4 py-2.5 text-gray-600">{b.phone || "—"}</td>
                                <td className="whitespace-nowrap px-4 py-2.5">
                                  {b.preference_order === 1 ? <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">1st</span>
                                    : b.preference_order === 2 ? <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">2nd</span>
                                    : b.preference_order === 3 ? <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">3rd</span>
                                    : "—"}
                                </td>
                                <td className="max-w-[180px] truncate px-4 py-2.5 text-xs text-gray-400" title={otherPrefs || undefined}>
                                  {otherPrefs || "—"}
                                </td>
                                <td className="max-w-[150px] truncate px-4 py-2.5 text-gray-500" title={b.comments || undefined}>{b.comments || "—"}</td>
                                <td className="whitespace-nowrap px-4 py-2.5 text-gray-400">{formatDateTime(b.created_at)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* Email modal */}
      {emailTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setEmailTarget(null)}>
          <div className="mx-4 w-full max-w-lg rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-1 text-base font-semibold text-gray-900">Send Email</h3>
            <p className="mb-4 text-sm text-gray-500">To: {emailTarget.full_name} &lt;{emailTarget.email}&gt;</p>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Subject</label>
                <input type="text" value={emailSubject} onChange={(e) => setEmailSubject(e.target.value)} className={inputClass} placeholder="Email subject" />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Message</label>
                <textarea rows={5} value={emailMessage} onChange={(e) => setEmailMessage(e.target.value)} className={inputClass} placeholder="Write your message here…" />
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setEmailTarget(null)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
              <button onClick={handleSendEmail} disabled={sendingEmail || !emailSubject || !emailMessage}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                {sendingEmail ? "Sending…" : "Send Email"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
