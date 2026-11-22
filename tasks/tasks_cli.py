#!/usr/bin/env python3
"""CLI usada pelo agente de hora em hora (e por você, se quiser).

  tasks_cli.py list                     tarefas ordenadas por prioridade
  tasks_cli.py next                     JSON da próxima pendente (vazio se nenhuma)
  tasks_cli.py add "<título>" [prioridade] [descrição]
  tasks_cli.py start <id>               status -> em_andamento
  tasks_cli.py complete <id> "<o que foi feito>"
  tasks_cli.py block <id> "<motivo>"    status -> bloqueada
  tasks_cli.py log "<mensagem>"
"""
import json, sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import store

A = "agente"

def main(a):
    if not a:
        sys.exit(__doc__)
    c = a[0]
    if c == "list":
        for t in store.list_tasks():
            print(f"#{t['id']:<3} {t['priority']:<8} {t['status']:<13} {t['title']}")
    elif c == "next":
        t = store.next_pending()
        print(json.dumps(t, ensure_ascii=False, indent=2) if t else "")
    elif c == "add":
        t = store.add({"title": a[1], "priority": a[2] if len(a) > 2 else "media",
                       "description": a[3] if len(a) > 3 else ""}, actor="cli")
        print(f"#{t['id']} criada")
    elif c == "start":
        store.update(int(a[1]), {"status": "em_andamento"}, actor=A)
    elif c == "complete":
        store.update(int(a[1]), {"status": "concluida", "result": a[2]}, actor=A)
        store.log(A, f"concluída #{a[1]}: {a[2][:300]}")
    elif c == "block":
        store.update(int(a[1]), {"status": "bloqueada", "result": a[2]}, actor=A)
        store.log(A, f"bloqueada #{a[1]}: {a[2][:300]}")
    elif c == "log":
        store.log(A, " ".join(a[1:]))
    else:
        sys.exit(f"comando desconhecido: {c}")

if __name__ == "__main__":
    main(sys.argv[1:])
