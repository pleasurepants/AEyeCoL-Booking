"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

function SubscribeInner() {
  const searchParams = useSearchParams();
  const prefillEmail = searchParams.get("email") ?? "";
  const prefillName = searchParams.get("full_name") ?? "";

  const [email, setEmail] = useState(prefillEmail);
  const [fullName, setFullName] = useState(prefillName);
  const [status, setStatus] = useState<"idle" | "submitting" | "done" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [already, setAlready] = useState(false);

  // Auto-submit when arriving with an email pre-filled from an email link.
  useEffect(() => {
    if (prefillEmail && status === "idle") {
      void submit(prefillEmail, prefillName);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit(emailValue: string, nameValue: string) {
    setStatus("submitting");
    setErrorMsg(null);
    try {
      const res = await fetch("/api/subscribers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: emailValue, full_name: nameValue }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setErrorMsg(body?.error ?? "Failed to subscribe.");
        setStatus("error");
        return;
      }
      setAlready(!!body?.already);
      setStatus("done");
    } catch {
      setErrorMsg("Network error. Please try again.");
      setStatus("error");
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email) return;
    void submit(email, fullName);
  }

  const inputClass =
    "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-4">
          <div>
            <h1 className="text-lg font-bold text-gray-900">Notify Me About New Sessions</h1>
            <p className="text-xs text-gray-500">AEyeCoL Lab</p>
          </div>
          <Link href="/" className="text-sm text-blue-600 hover:underline">Back to Booking</Link>
        </div>
      </header>

      <main className="mx-auto max-w-md px-4 py-12">
        {status === "done" ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-6 text-center">
            <h2 className="mb-2 text-lg font-semibold text-emerald-900">
              {already ? "You're already on the list" : "You're subscribed"}
            </h2>
            <p className="text-sm text-emerald-700">
              {already
                ? "Your email was already on our notification list. No changes needed."
                : "We'll email you whenever a new study session is added."}
            </p>
            <p className="mt-4 text-xs text-emerald-600">
              A confirmation email has been sent. If you don&apos;t see it, please check your spam folder.
            </p>
          </div>
        ) : (
          <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="mb-1 text-base font-semibold text-gray-900">Get notified when new sessions open</h2>
            <p className="mb-5 text-sm text-gray-500">
              Enter your email below. We&apos;ll send one message per new session. You can unsubscribe any time with one click.
            </p>

            {errorMsg && (
              <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {errorMsg}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="sub_email" className="mb-1 block text-sm font-medium text-gray-700">
                  Email <span className="text-red-400">*</span>
                </label>
                <input
                  id="sub_email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={inputClass}
                  placeholder="example@university.edu"
                />
              </div>
              <div>
                <label htmlFor="sub_name" className="mb-1 block text-sm font-medium text-gray-700">
                  Name <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <input
                  id="sub_name"
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className={inputClass}
                  placeholder="Your full name"
                />
              </div>
              <button
                type="submit"
                disabled={status === "submitting"}
                className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
              >
                {status === "submitting" ? "Subscribing…" : "Subscribe"}
              </button>
            </form>
          </div>
        )}
      </main>
    </div>
  );
}

export default function SubscribePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-50" />}>
      <SubscribeInner />
    </Suspense>
  );
}
