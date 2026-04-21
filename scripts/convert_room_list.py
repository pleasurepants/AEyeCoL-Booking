"""Convert Room_List.csv (German calendar export) to a CSV importable into
Supabase `sessions` table.

Usage:
    python scripts/convert_room_list.py Room_List.csv sessions_import.csv
"""

from __future__ import annotations

import csv
import io
import re
import sys
from datetime import datetime, timedelta
from pathlib import Path

HEADER_OUT = [
    "date",
    "start_time",
    "end_time",
    "location",
    "room",
    "max_participants",
    "notes",
    "supervisors",
]

LOCATION = "Marsstraße 20"
MAX_PARTICIPANTS = 4
STRIDE_MIN = 90
RECORD_MIN = 70
NOON = 12 * 60


def read_lines(path: Path) -> list[str]:
    raw = path.read_bytes()
    for enc in ("utf-8", "cp1252", "latin-1"):
        try:
            return raw.decode(enc).splitlines()
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace").splitlines()


def parse_line(line: str) -> list[str] | None:
    s = line.strip()
    if not s:
        return None
    if s.endswith(","):
        s = s[:-1]
    if len(s) >= 2 and s.startswith('"') and s.endswith('"'):
        s = s[1:-1]
    s = s.replace('""', '"')
    reader = csv.reader(io.StringIO(s), delimiter=";", quotechar='"')
    row = next(reader, None)
    if not row:
        return None
    return row


HEADER_FIELDS = [
    "WOCHENTAG", "DATUM", "VON", "BIS", "DAUER_IN_MINUTEN", "LV_NUMMER",
    "TITEL", "LV_ART", "LV_GRUPPE", "ORT", "LERNEINHEIT", "UNTERRICHTSEINHEIT",
    "EREIGNIS_TYP", "TERMIN_TYP", "VORTRAGENDER_KONTAKTPERSON", "ANMERKUNG",
    "INTERNE_BEMERKUNG",
]


def normalize_row(row: list[str]) -> dict[str, str] | None:
    # ORT sometimes contains a literal ", " that splits it into two fields.
    # Expected len == len(HEADER_FIELDS). If we have one extra, merge 9+10.
    if len(row) == len(HEADER_FIELDS) + 1:
        row = row[:9] + [f"{row[9]},{row[10]}"] + row[11:]
    if len(row) < len(HEADER_FIELDS):
        return None
    return {k: row[i].strip() for i, k in enumerate(HEADER_FIELDS)}


def to_iso_date(datum: str) -> str | None:
    try:
        return datetime.strptime(datum, "%d.%m.%Y").date().isoformat()
    except ValueError:
        return None


def hm_to_min(hm: str) -> int | None:
    m = re.match(r"^(\d{1,2}):(\d{2})$", hm.strip())
    if not m:
        return None
    h, mm = int(m.group(1)), int(m.group(2))
    return h * 60 + mm


def min_to_hms(total: int) -> str:
    h, m = divmod(total, 60)
    return f"{h:02d}:{m:02d}:00"


def extract_room(ort: str) -> str | None:
    m = re.search(r"\b(\d{3})\b", ort)
    return f"Room {m.group(1)}" if m else None


def should_keep(titel: str, vortragender: str) -> bool:
    return "aeyecol" in titel.lower() and "mingcong" in vortragender.lower()


def generate_slots(start_min: int, end_min: int) -> list[tuple[int, int]]:
    """Return list of (slot_start, slot_end_recorded) in minutes.

    Rule chosen by the row's ORIGINAL start_min:
    - morning (S < 12:00): strict, require slot_start + 90 <= end
    - afternoon (S >= 12:00): lenient, require slot_start < end
    Recorded end = slot_start + RECORD_MIN.
    """
    slots: list[tuple[int, int]] = []
    strict = start_min < NOON
    t = start_min
    while True:
        if strict:
            if t + STRIDE_MIN > end_min:
                break
        else:
            if t >= end_min:
                break
        slots.append((t, t + RECORD_MIN))
        t += STRIDE_MIN
    return slots


def convert(in_path: Path, out_path: Path) -> None:
    lines = read_lines(in_path)
    if not lines:
        raise SystemExit("Empty input file")

    out_rows: list[list[str]] = []
    kept = 0
    skipped = 0

    # Skip header row (line 1)
    for raw in lines[1:]:
        parsed = parse_line(raw)
        if not parsed:
            continue
        rec = normalize_row(parsed)
        if not rec:
            skipped += 1
            continue
        if not should_keep(rec["TITEL"], rec["VORTRAGENDER_KONTAKTPERSON"]):
            skipped += 1
            continue

        iso_date = to_iso_date(rec["DATUM"])
        s_min = hm_to_min(rec["VON"])
        e_min = hm_to_min(rec["BIS"])
        room = extract_room(rec["ORT"])

        if iso_date is None or s_min is None or e_min is None or room is None:
            print(f"WARN: cannot parse row, skipping: {rec}", file=sys.stderr)
            skipped += 1
            continue

        for slot_start, slot_end in generate_slots(s_min, e_min):
            out_rows.append([
                iso_date,
                min_to_hms(slot_start),
                min_to_hms(slot_end),
                LOCATION,
                room,
                str(MAX_PARTICIPANTS),
                "",
                "{}",
            ])
        kept += 1

    with out_path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(HEADER_OUT)
        writer.writerows(out_rows)

    print(f"Kept {kept} source rows, skipped {skipped}, wrote {len(out_rows)} slots to {out_path}")


def main() -> None:
    if len(sys.argv) != 3:
        print(__doc__, file=sys.stderr)
        raise SystemExit(2)
    convert(Path(sys.argv[1]), Path(sys.argv[2]))


if __name__ == "__main__":
    main()
