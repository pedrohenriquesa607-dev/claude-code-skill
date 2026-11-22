#!/usr/bin/env bash
# Registra uma decisão em memory/decisions.csv.
# Uso: scripts/add_decision.sh "decisão" "raciocínio" "resultado esperado" [AAAA-MM-DD]
# A data padrão é hoje; a data de revisão é sempre data + 30 dias.
set -euo pipefail
if [ $# -lt 3 ]; then
  echo "Uso: $0 \"decisão\" \"raciocínio\" \"resultado esperado\" [AAAA-MM-DD]" >&2
  exit 1
fi
CSV="$(cd "$(dirname "$0")/.." && pwd)/memory/decisions.csv"
python3 - "$CSV" "$@" <<'PY'
import csv, sys, datetime, os
path, decisao, raciocinio, resultado = sys.argv[1:5]
data = datetime.date.fromisoformat(sys.argv[5]) if len(sys.argv) > 5 else datetime.date.today()
header = ["id","data","decisao","raciocinio","resultado_esperado","data_revisao","status"]
rows = []
if os.path.exists(path):
    with open(path, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
next_id = max((int(r["id"]) for r in rows), default=0) + 1
row = {"id": next_id, "data": data.isoformat(), "decisao": decisao,
       "raciocinio": raciocinio, "resultado_esperado": resultado,
       "data_revisao": (data + datetime.timedelta(days=30)).isoformat(), "status": ""}
new = not os.path.exists(path)
with open(path, "a", newline="", encoding="utf-8") as f:
    w = csv.DictWriter(f, fieldnames=header)
    if new:
        w.writeheader()
    w.writerow(row)
print(f"Decisão #{next_id} registrada. Revisão em {row['data_revisao']}.")
PY
