#!/usr/bin/env python3
"""Estado e log do Inbox Manager.

O repositório é PÚBLICO: aqui só entram IDs opacos do Gmail, categorias,
IDs de rascunho e contagens. Nunca remetente, assunto, corpo ou e-mail.

Uso:
  inbox_state.py last-run                      -> imprime last_run (ou vazio)
  inbox_state.py is-processed <message_id>     -> exit 0 se já processado, 1 se não
  inbox_state.py set-label <CATEGORIA> <label_id>
  inbox_state.py labels                        -> imprime o mapa categoria -> label_id
  inbox_state.py record <message_id> <thread_id> <CATEGORIA> [draft_id]
  inbox_state.py finish-run <n_novos> <n_rascunhos>   -> grava last_run e loga resumo
  inbox_state.py log <INFO|WARN|ERROR> <mensagem>
"""
import json, sys, datetime, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent / "inbox"
STATE, LOG = ROOT / "emails_processed.json", ROOT / "inbox_manager.log"
CATS = ["URGENTE", "PRECISA DE RESPOSTA", "FYI", "LIXO"]

def now():
    return datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat()

def load():
    return json.loads(STATE.read_text(encoding="utf-8"))

def save(s):
    STATE.write_text(json.dumps(s, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

def log(level, msg):
    with LOG.open("a", encoding="utf-8") as f:
        f.write(f"{now()} [{level}] {msg}\n")

def main(a):
    if not a:
        sys.exit(__doc__)
    cmd, s = a[0], load()
    if cmd == "last-run":
        print(s["last_run"] or "")
    elif cmd == "is-processed":
        sys.exit(0 if a[1] in s["processed"] else 1)
    elif cmd == "labels":
        print(json.dumps(s["labels"], ensure_ascii=False))
    elif cmd == "set-label":
        if a[1] not in CATS: sys.exit(f"categoria inválida: {a[1]}")
        s["labels"][a[1]] = a[2]; save(s); log("INFO", f"etiqueta {a[1]} -> {a[2]}")
    elif cmd == "record":
        msg_id, thread_id, cat = a[1], a[2], a[3]
        if cat not in CATS: sys.exit(f"categoria inválida: {cat}")
        draft = a[4] if len(a) > 4 else None
        s["processed"][msg_id] = {"thread_id": thread_id, "category": cat,
                                  "draft_id": draft, "processed_at": now()}
        save(s); log("INFO", f"msg={msg_id} categoria={cat}" + (f" rascunho={draft}" if draft else ""))
    elif cmd == "finish-run":
        s["last_run"] = now(); save(s)
        log("INFO", f"execução concluída: {a[1]} novos, {a[2]} rascunhos")
    elif cmd == "log":
        log(a[1], " ".join(a[2:]))
    else:
        sys.exit(f"comando desconhecido: {cmd}")

if __name__ == "__main__":
    main(sys.argv[1:])
