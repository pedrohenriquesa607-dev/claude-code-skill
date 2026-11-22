# Decisões

O registro de decisões fica em **`memory/decisions.csv`** (fonte única).
Este arquivo existe só como ponteiro — não registre decisões aqui.

Colunas: `id, data, decisao, raciocinio, resultado_esperado, data_revisao, status`

- `data_revisao` = `data` + 30 dias.
- `status`: vazio (aguardando) → `REVIEW DUE` (marcado pela verificação diária)
  → `REVIEWED` (depois que o usuário revisar; acrescente o desfecho ao raciocínio
  ou como nova decisão).

Comandos:
- Registrar: `scripts/add_decision.sh "decisão" "raciocínio" "resultado esperado" [AAAA-MM-DD]`
- Marcar vencidas: `scripts/check_reviews.sh` (roda diariamente)
- Ver pendentes: `./review.sh`
