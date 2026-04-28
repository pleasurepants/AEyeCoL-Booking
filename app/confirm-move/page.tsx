"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

export default function ConfirmMovePage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center bg-gray-50"><p className="text-gray-400">Loading…</p></div>}>
      <ConfirmMoveContent />
    </Suspense>
  );
}

function ConfirmMoveContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [status, setStatus] = useState<"loading" | "success" | "already" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setStatus("error");
      setErrorMsg("Invalid confirmation link.");
      return;
    }

    fetch("/api/confirm-move", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ booking_id: token }),
    })
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (!res.ok) {
          setErrorMsg(body?.error ?? "Something went wrong.");
          setStatus("error");
        } else if (body?.already) {
          setStatus("already");
        } else {
          setStatus("success");
        }
      })
      .catch(() => {
        setErrorMsg("Network error. Please try again.");
        setStatus("error");
      });
  }, [token]);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-4">
          <div>
            <h1 className="text-lg font-bold text-gray-900">Session Confirmation</h1>
            <p className="text-xs text-gray-500">AEyeCoL Lab</p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-12">
        {status === "loading" && (
          <div className="py-20 text-center text-gray-400">Confirming…</div>
        )}

        {status === "success" && (
          <div className="rounded-xl border border-green-200 bg-green-50 p-8 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-green-100">
              <svg className="h-7 w-7 text-green-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
            </div>
            <h2 className="mb-2 text-xl font-semibold text-green-900">Confirmed!</h2>
            <p className="text-green-700">Thank you — the research team has been notified that you confirm the session change.</p>
          </div>
        )}

        {status === "already" && (
          <div className="rounded-xl border border-blue-200 bg-blue-50 p-8 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-blue-100">
              <svg className="h-7 w-7 text-blue-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
              </svg>
            </div>
            <h2 className="mb-2 text-xl font-semibold text-blue-900">Already Confirmed</h2>
            <p className="text-blue-700">You have already confirmed this session change.</p>
          </div>
        )}

        {status === "error" && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-8 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-red-100">
              <svg className="h-7 w-7 text-red-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
              </svg>
            </div>
            <p className="text-sm text-red-700">{errorMsg ?? "Something went wrong."}</p>
          </div>
        )}
      </main>
    </div>
  );
}
