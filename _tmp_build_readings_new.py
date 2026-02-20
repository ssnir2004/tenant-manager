import csv
from datetime import datetime, date
from pathlib import Path

base = Path(r"C:\Users\nirc\Copilot github\Tenant Manager")
readings_path = base / "readings.csv"
tenants_path = base / "tenants.csv"
out_path = base / "readings_new.csv"


def parse_date(value):
    value = (value or "").strip()
    if not value:
        return None
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(value, fmt).date()
        except ValueError:
            pass
    return None

# Load tenant periods by apartment
tenants_by_apartment = {}
with tenants_path.open("r", encoding="utf-8-sig", newline="") as f:
    reader = csv.DictReader(f)
    for row in reader:
        apt = (row.get("apartment") or "").strip()
        if not apt:
            continue
        full_name = f"{(row.get('first_name') or '').strip()} {(row.get('last_name') or '').strip()}".strip()
        start = parse_date(row.get("start_date"))
        move_out = parse_date(row.get("move_out_date"))
        end = parse_date(row.get("end_date"))
        effective_end = move_out or end or date(9999, 12, 31)
        entry = {
            "name": full_name,
            "start": start or date(1900, 1, 1),
            "end": effective_end,
        }
        tenants_by_apartment.setdefault(apt, []).append(entry)

for apt, arr in tenants_by_apartment.items():
    arr.sort(key=lambda x: x["start"])


def choose_tenant(apartment, reading_date):
    arr = tenants_by_apartment.get(apartment, [])
    if not arr:
        return None

    exact = [t for t in arr if t["start"] <= reading_date <= t["end"]]
    if exact:
        exact.sort(key=lambda x: x["start"], reverse=True)
        return exact[0]["name"]

    # Before first known contract => earliest known tenant
    if reading_date < arr[0]["start"]:
        return arr[0]["name"]

    # After last known period => latest tenant by start
    if reading_date > max(t["end"] for t in arr):
        return arr[-1]["name"]

    # Gap between contracts => latest tenant started before reading date
    started = [t for t in arr if t["start"] <= reading_date]
    if started:
        started.sort(key=lambda x: x["start"], reverse=True)
        return started[0]["name"]

    return arr[0]["name"]

rows = []
changed = 0
same = 0
with readings_path.open("r", encoding="utf-8-sig", newline="") as f:
    reader = csv.DictReader(f)
    fieldnames = reader.fieldnames
    for row in reader:
        apt = (row.get("apartment") or "").strip()
        r_date = parse_date(row.get("date"))
        old_name = (row.get("tenant") or "").strip()
        new_name = old_name
        if apt and r_date:
            picked = choose_tenant(apt, r_date)
            if picked:
                new_name = picked
        if new_name != old_name:
            changed += 1
        else:
            same += 1
        row["tenant"] = new_name
        rows.append(row)

with out_path.open("w", encoding="utf-8-sig", newline="") as f:
    writer = csv.DictWriter(f, fieldnames=fieldnames)
    writer.writeheader()
    writer.writerows(rows)

print(f"Created: {out_path}")
print(f"Rows: {len(rows)} | Changed tenant name: {changed} | Unchanged: {same}")
