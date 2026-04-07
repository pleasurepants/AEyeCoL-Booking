"use client";

import { Suspense, useEffect, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

interface BookingDetails {
  id: string;
  full_name: string;
  email: string;
  sessions: {
    date: string;
    start_time: string;
    end_time: string;
    location: string;
    room: string | null;
    notes: string | null;
  };
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

export default function CancelPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center bg-gray-50"><p className="text-gray-400">Loading…</p></div>}>
      <CancelContent />
    </Suspense>
  );
}

function CancelContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [booking, setBooking] = useState<BookingDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchBooking = useCallback(async () => {
    if (!token) {
      setError("Invalid cancellation link.");
      setLoading(false);
      return;
    }

    const { data, error: fetchError } = await supabase
      .from("bookings")
      .select("id, full_name, email, sessions(date, start_time, end_time, location, room, notes)")
      .eq("id", token)
      .single();

    if (fetchError || !data) {
      setError("Booking not found. It may have already been cancelled.");
      setLoading(false);
      return;
    }

    setBooking(data as unknown as BookingDetails);
    setLoading(false);
  }, [token]);

  useEffect(() => {
    fetchBooking();
  }, [fetchBooking]);

  async function handleCancel() {
    if (!token) return;

    setCancelling(true);
    setError(null);

    try {
      const res = await fetch("/api/bookings/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ booking_id: token }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError("Failed to cancel booking: " + (body?.error ?? "Unknown error"));
        setCancelling(false);
        return;
      }
    } catch {
      setError("Failed to cancel booking. Please try again.");
      setCancelling(false);
      return;
    }

    setCancelling(false);
    setCancelled(true);
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-4">
          <div>
            <h1 className="text-lg font-bold text-gray-900">Cancel Booking</h1>
            <p className="text-xs text-gray-500">AEyeCoL Lab</p>
          </div>
          <a href="/" className="text-sm text-blue-600 hover:underline">
            Back to Booking
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-12">
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-8 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-red-100">
              <svg className="h-7 w-7 text-red-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
              </svg>
            </div>
            <p className="text-sm text-red-700">{error}</p>
            <a
              href="/"
              className="mt-4 inline-block rounded-lg bg-gray-800 px-4 py-2 text-sm text-white transition hover:bg-gray-700"
            >
              Go to Booking Page
            </a>
          </div>
        )}

        {loading && !error && (
          <div className="py-20 text-center text-gray-400">Loading…</div>
        )}

        {cancelled && (
          <div className="rounded-xl border border-green-200 bg-green-50 p-8 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-green-100">
              <svg className="h-7 w-7 text-green-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
            </div>
            <h2 className="mb-2 text-xl font-semibold text-green-900">Booking Cancelled</h2>
            <p className="mb-6 text-green-700">Your booking has been successfully cancelled.</p>
            <a
              href="/"
              className="inline-block rounded-lg bg-green-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-green-700"
            >
              Book Another Session
            </a>
          </div>
        )}

        {booking && !cancelled && !error && (
          <div className="rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
            <h2 className="mb-2 text-lg font-semibold text-gray-900">
              Cancel your booking?
            </h2>
            <p className="mb-6 text-sm text-gray-500">
              You are about to cancel the following booking. This action cannot be undone.
            </p>

            <div className="mb-6 rounded-lg bg-gray-50 p-5 text-sm text-gray-700">
              <dl className="space-y-2">
                <div className="flex justify-between">
                  <dt className="font-medium text-gray-500">Name</dt>
                  <dd>{booking.full_name}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="font-medium text-gray-500">Email</dt>
                  <dd>{booking.email}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="font-medium text-gray-500">Date</dt>
                  <dd>{formatDate(booking.sessions.date)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="font-medium text-gray-500">Time</dt>
                  <dd>
                    {formatTime(booking.sessions.start_time)} –{" "}
                    {formatTime(booking.sessions.end_time)}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="font-medium text-gray-500">Location</dt>
                  <dd>
                    {booking.sessions.location}
                    {booking.sessions.room && `, ${booking.sessions.room}`}
                  </dd>
                </div>
              </dl>
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleCancel}
                disabled={cancelling}
                className="rounded-lg bg-red-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-red-700 disabled:opacity-50"
              >
                {cancelling ? "Cancelling…" : "Cancel Booking"}
              </button>
              <a
                href="/"
                className="rounded-lg border border-gray-300 px-5 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
              >
                Keep Booking
              </a>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
