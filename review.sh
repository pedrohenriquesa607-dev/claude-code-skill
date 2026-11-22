#!/usr/bin/env bash
# Mostra apenas as decisões com a etiqueta "REVIEW DUE" (revisão pendente).
set -euo pipefail
CSV="$(cd "$(dirname "$0")" && pwd)/memory/decisions.csv"
python3 - "$CSV" <<'PY'
import csv, sys
with open(sys.argv[1], newline="", encoding="utf-8") as f:
    due = [r for r in csv.DictReader(f) if r["status"].strip() == "REVIEW DUE"]
if not due:
    print("Nenhuma decisão com revisão pendente.")
    sys.exit(0)
print(f"{len(due)} decisão(ões) com REVIEW DUE:\n")
for r in due:
    print(f"#{r['id']}  [REVIEW DUE]  decidida em {r['data']}, revisão em {r['data_revisao']}")
    print(f"  Decisão:            {r['decisao']}")
    print(f"  Raciocínio:         {r['raciocinio']}")
    print(f"  Resultado esperado: {r['resultado_esperado']}\n")
PY
