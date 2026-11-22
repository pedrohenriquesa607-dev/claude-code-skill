#!/usr/bin/env bash
# Publica o painel na Cloudflare. Precisa de um API Token (modelo "Edit Cloudflare
# Workers" + Account → D1 → Edit) em CLOUDFLARE_API_TOKEN, ou injetado pelo proxy.
# Na primeira vez, gera o código de acesso do painel e o imprime UMA vez.
set -euo pipefail
cd "$(dirname "$0")"
export CLOUDFLARE_API_TOKEN="${CLOUDFLARE_API_TOKEN:-proxy-injected}"
npx --yes wrangler@4.166.0 d1 execute painel-tarefas --remote --file schema.sql
npx --yes wrangler@4.166.0 deploy
if ! npx --yes wrangler@4.166.0 secret list 2>/dev/null | grep -q ACCESS_TOKEN; then
  CODE=$(python3 -c "import secrets;print(secrets.token_urlsafe(18))")
  printf '%s' "$CODE" | npx --yes wrangler@4.166.0 secret put ACCESS_TOKEN
  echo; echo "Código de acesso do painel (guarde, não será mostrado de novo): $CODE"
fi
