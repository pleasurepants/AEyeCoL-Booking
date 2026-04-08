const fmt = (tz: string) =>
  new Intl.DateTimeFormat("en", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

function get(parts: Intl.DateTimeFormatPart[], type: string): string {
  return parts.find((p) => p.type === type)?.value ?? "00";
}

export function localNow(): Date {
  const tz = process.env.TIMEZONE || "UTC";
  const parts = fmt(tz).formatToParts(new Date());
  const y = get(parts, "year");
  const mo = get(parts, "month");
  const d = get(parts, "day");
  const h = get(parts, "hour");
  const mi = get(parts, "minute");
  const s = get(parts, "second");
  return new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}`);
}

export function localTodayStr(): string {
  const tz = process.env.TIMEZONE || "UTC";
  const parts = fmt(tz).formatToParts(new Date());
  return `${get(parts, "year")}-${get(parts, "month")}-${get(parts, "day")}`;
}

export function localTomorrowStr(): string {
  const tz = process.env.TIMEZONE || "UTC";
  const parts = fmt(tz).formatToParts(new Date());
  const today = new Date(
    `${get(parts, "year")}-${get(parts, "month")}-${get(parts, "day")}T00:00:00`
  );
  today.setDate(today.getDate() + 1);
  const y = today.getFullYear();
  const mo = String(today.getMonth() + 1).padStart(2, "0");
  const d = String(today.getDate()).padStart(2, "0");
  return `${y}-${mo}-${d}`;
}
