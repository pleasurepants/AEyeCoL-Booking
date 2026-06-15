// One-time backfill: mark the confirmed participants who already received a
// voucher (compensation_r1 folder, round 1) as compensation = 'done'.
//
// The 18 targets below were matched from the compensation_r1/{S1..S7} filenames
// against confirmed bookings and confirmed by the admin on 2026-06-15. Each is
// pinned by email + session date so the write is unambiguous (two participants
// have duplicate bookings across sessions).
//
// Usage:
//   node scripts/compensation_backfill.mjs           # dry run: resolve & print, no writes
//   node scripts/compensation_backfill.mjs --apply    # set compensation = 'done'
//
// Requires the compensation column to allow 'done' (run the 3-state migration
// first). Reads SUPABASE creds from .env.local.

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");

/* email + session date for each of the 18 round-1 voucher recipients */
const TARGETS = [
  { email: "ekinnurcekic@gmail.com", date: "2026-04-30" }, // S1 Ekin
  { email: "hbasrisahin1@gmail.com", date: "2026-04-30" }, // S1 Hasan Basri Sahin
  { email: "leonardo.sayahian@gmail.com", date: "2026-04-30" }, // S1 Leonardo (Sayahian)
  { email: "divya.solanki@tum.de", date: "2026-04-30" }, // S2 Divya Solanki
  { email: "harsh.parikh@tum.de", date: "2026-04-30" }, // S2 Harsh
  { email: "tuana.durmayuksel@gmail.com", date: "2026-04-30" }, // S2 Tuana Durmayuksel
  { email: "go24daq@tum.de", date: "2026-04-30" }, // S3 Chenxi Yang (04-30 booking)
  { email: "sihan.liu@tum.de", date: "2026-04-30" }, // S3 Sihan Liu
  { email: "go35ruc@mytum.de", date: "2026-05-04" }, // S4 Leonardo Dall'Armi
  { email: "wanqiang.yang@tum.de", date: "2026-05-04" }, // S4 Wanqiang Yang
  { email: "go57wub@mytum.de", date: "2026-05-08" }, // S5 I-Chun Ting
  { email: "lauren.pray@tum.de", date: "2026-05-08" }, // S5 Lauren Pray
  { email: "merve.tan@tum.de", date: "2026-05-08" }, // S5 Merve Tan (05-08 booking)
  { email: "elifezgiaksulu@gmail.com", date: "2026-05-11" }, // S6 E Aks (Elif Aksulu)
  { email: "josef.pachmayr@tum.de", date: "2026-05-11" }, // S6 Josef Pachmayr
  { email: "veronica.hartl@tum.de", date: "2026-05-11" }, // S6 Vroni Ha (Veronica Hartl)
  { email: "ge38bag@mytum.de", date: "2026-05-13" }, // S7 David Furtner
  { email: "flx.blum@tum.de", date: "2026-05-13" }, // S7 Felix Blum
];

/* ── load env ── */
const txt = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
for (const line of txt.split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function main() {
  const { data: bookings, error } = await supabase
    .from("bookings")
    .select("id, full_name, email, status, compensation, session_id, sessions(date)")
    .eq("status", "confirmed");
  if (error) {
    console.error("DB error:", error.message);
    process.exit(1);
  }

  const resolved = [];
  const problems = [];
  for (const t of TARGETS) {
    const hits = bookings.filter(
      (b) =>
        b.email.trim().toLowerCase() === t.email &&
        (b.sessions?.date ?? "") === t.date
    );
    if (hits.length === 1) resolved.push(hits[0]);
    else problems.push({ t, count: hits.length });
  }

  console.log("=== RESOLVED (will be set to 'done') ===");
  for (const b of resolved) {
    const flag = b.compensation === "done" ? " [already done]" : "";
    console.log(`  ${b.full_name} <${b.email}>  ${b.sessions?.date}${flag}`);
  }
  if (problems.length) {
    console.log("\n=== PROBLEMS (0 or >1 match — NOT applied) ===");
    for (const p of problems)
      console.log(`  ${p.t.email} @ ${p.t.date}  -> ${p.count} matches`);
  }
  console.log(`\n${resolved.length}/${TARGETS.length} resolved, ${problems.length} problems.`);

  if (!APPLY) {
    console.log("\nDry run. Re-run with --apply to write.");
    return;
  }
  if (problems.length) {
    console.error("\nRefusing to apply: resolve the problems above first.");
    process.exit(1);
  }

  console.log("\nApplying...");
  let updated = 0;
  for (const b of resolved) {
    if (b.compensation === "done") continue;
    const { error: upErr } = await supabase
      .from("bookings")
      .update({ compensation: "done" })
      .eq("id", b.id);
    if (upErr) console.error(`  FAILED ${b.full_name}: ${upErr.message}`);
    else updated++;
  }
  console.log(`Done. ${updated} rows updated.`);
}

main();
