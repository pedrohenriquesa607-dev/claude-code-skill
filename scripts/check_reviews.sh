#!/usr/bin/env bash
# Marca com "REVIEW DUE" toda decisão cuja data de revisão chegou (<= hoje)
# e que ainda não está marcada nem revisada. Feito para rodar 1x por dia.
# Uso: scripts/check_reviews.sh [AAAA-MM-DD]   (data de referência; padrão: hoje)
set -euo pipefail
CSV="$(cd "$(dirname "$0")/.." && pwd)/memory/decisions.csv"
python3 - "$CSV" "${1:-}" <<'PY'
import csv, sys, datetime
path, ref = sys.argv[1], sys.argv[2]
today = datetime.date.fromisoformat(ref) if ref else datetime.date.today()
with open(path, newline="", encoding="utf-8") as f:
    reader = csv.DictReader(f)
    header, rows = reader.fieldnames, list(reader)
marked = []
for r in rows:
    if not r["status"].strip() and datetime.date.fromisoformat(r["data_revisao"]) <= today:
        r["status"] = "REVIEW DUE"
        marked.append(r["id"])
if marked:
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=header)
        w.writeheader()
        w.writerows(rows)
print(f"{today}: {len(marked)} decisão(ões) marcada(s) como REVIEW DUE" + (f" (ids: {', '.join(marked)})" if marked else ""))
PY
