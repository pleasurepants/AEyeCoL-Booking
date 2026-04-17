"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

function UnsubscribeInner() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [status, setStatus] = useState<"loading" | "done" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    async function run() {
      if (!token) {
        setErrorMsg("Missing unsubscribe token.");
        setStatus("error");
        return;
      }
      try {
        const res = await fetch(`/api/subscribers?token=${encodeURIComponent(token)}`, {
          method: "DELETE",
        });
        const body = await res.json().catch(() => null);
        if (!res.ok) {
          setErrorMsg(body?.error ?? "Failed to unsubscribe.");
          setStatus("error");
          return;
        }
        setStatus("done");
      } catch {
        setErrorMsg("Network error. Please try again.");
        setStatus("error");
      }
    }
    void run();
  }, [token]);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-4">
          <div>
            <h1 className="text-lg font-bold text-gray-900">Unsubscribe</h1>
            <p className="text-xs text-gray-500">AEyeCoL Lab</p>
          </div>
          <Link href="/" className="text-sm text-blue-600 hover:underline">Back to Booking</Link>
        </div>
      </header>

      <main className="mx-auto max-w-md px-4 py-12">
        {status === "loading" && (
          <div className="py-20 text-center text-gray-400">Unsubscribing…</div>
        )}
        {status === "done" && (
          <div className="rounded-xl border border-gray-200 bg-white p-6 text-center shadow-sm">
            <h2 className="mb-2 text-lg font-semibold text-gray-900">You&apos;ve been unsubscribed</h2>
            <p className="text-sm text-gray-500">
              You will no longer receive new-session notifications. Changed your mind? You can always resubscribe from the booking page.
            </p>
          </div>
        )}
        {status === "error" && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center">
            <h2 className="mb-2 text-lg font-semibold text-red-900">Something went wrong</h2>
            <p className="text-sm text-red-700">{errorMsg}</p>
          </div>
        )}
      </main>
    </div>
  );
}

export default function UnsubscribePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-50" />}>
      <UnsubscribeInner />
    </Suspense>
  );
}
