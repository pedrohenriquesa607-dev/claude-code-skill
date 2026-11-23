#!/usr/bin/env python3
"""CLI usada pelo agente de hora em hora (e por você, se quiser).

Se tasks/remote.json existir, fala com o painel publicado na Cloudflare
(a senha é injetada pelo proxy do ambiente; defina TASKS_LOCAL=1 para usar
os arquivos locais). Senão, usa tasks/tasks.json e tasks/tasks.log.

  tasks_cli.py list                     tarefas ordenadas por prioridade
  tasks_cli.py next                     JSON da próxima a trabalhar (em andamento primeiro)
  tasks_cli.py add "<título>" [prioridade] [descrição]
  tasks_cli.py start <id>               status -> em_andamento
  tasks_cli.py complete <id> "<o que foi feito>"
  tasks_cli.py block <id> "<motivo>"    status -> bloqueada
  tasks_cli.py log "<mensagem>"
  tasks_cli.py attach <id> <arquivo>    anexa um arquivo (PDF, imagem…) à tarefa no painel (máx. 1,9 MB)
  tasks_cli.py comment <id> "<texto>"   responde ao usuário na conversa da tarefa
  tasks_cli.py history [dias]           atividade dos últimos N dias (padrão 7)
  tasks_cli.py wait-now [minutos]       plantão: espera até aparecer tarefa "fazer agora"
                                        (sai 0) ou até passar N minutos (padrão 50; sai 3)
  tasks_cli.py export                   copia tarefas e log do painel para tasks.json / tasks.log
"""
import json, os, sys, pathlib, urllib.request, urllib.error, urllib.parse
HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import store

A = "agente"
REMOTE = HERE / "remote.json"


class Remote:
    def __init__(self, url):
        self.url = url.rstrip("/")

    def call(self, method, path, body=None):
        req = urllib.request.Request(
            self.url + path, method=method,
            data=json.dumps(body).encode() if body is not None else None,
            headers={"Content-Type": "application/json", "X-Actor": A,
                     "User-Agent": "painel-tarefas-agente/1.0",
                     # valor real injetado pelo proxy do ambiente
                     "Authorization": "Bearer " + os.environ.get("TASKS_TOKEN", "proxy-injected")})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read() or b"null")
        except urllib.error.HTTPError as e:
            sys.exit(f"erro {e.code} em {method} {path}: {e.read().decode(errors='replace')[:300]}")

    def list_tasks(self): return self.call("GET", "/api/tasks")
    def add(self, f): return self.call("POST", "/api/tasks", f)
    def update(self, i, f): return self.call("PUT", f"/api/tasks/{i}", f)
    def log(self, msg): self.call("POST", "/api/log", {"msg": msg})
    def log_lines(self, days=0): return self.call("GET", "/api/log" + (f"?days={days}" if days else ""))
    def comment(self, i, text): return self.call("POST", f"/api/tasks/{i}/comments", {"text": text})

    def attach(self, i, path):
        p = pathlib.Path(path)
        data = p.read_bytes()
        req = urllib.request.Request(
            f"{self.url}/api/tasks/{i}/files?name={urllib.parse.quote(p.name)}", method="POST", data=data,
            headers={"Content-Type": "application/octet-stream", "X-Actor": A, "User-Agent": "painel-tarefas-agente/1.0",
                     "Authorization": "Bearer " + os.environ.get("TASKS_TOKEN", "proxy-injected")})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            sys.exit(f"erro {e.code} ao anexar {p.name}: {e.read().decode(errors='replace')[:300]}")


class Local:
    list_tasks = staticmethod(store.list_tasks)
    def add(self, f): return store.add(f, actor="cli")
    def update(self, i, f): return store.update(i, f, actor=A)
    def log(self, msg): store.log(A, msg)


def backend():
    if REMOTE.exists() and os.environ.get("TASKS_LOCAL") != "1":
        return Remote(json.loads(REMOTE.read_text())["url"])
    return Local()


def main(a):
    if not a:
        sys.exit(__doc__)
    b, c = backend(), a[0]
    if c == "list":
        for t in b.list_tasks():
            extra = "".join([" ⚡agora" if t.get("run_now") else "", f" prazo:{t['due_date']}" if t.get("due_date") else "",
                             f" #{t['tags'].replace(',', ' #')}" if t.get("tags") else "", f" 💬{len(t['comments'])}" if t.get("comments") else ""])
            print(f"#{t['id']:<3} {t['priority']:<8} {t['status']:<13} {t['title']}{extra}")
    elif c == "next":
        ts = b.list_tasks()  # já vem na ordem de trabalho do painel
        t = next((x for x in ts if x["status"] == "pendente" and x.get("run_now")), None) or \
            next((x for x in ts if x["status"] == "em_andamento"), None) or \
            next((x for x in ts if x["status"] == "pendente"), None)
        print(json.dumps(t, ensure_ascii=False, indent=2) if t else "")
    elif c == "add":
        t = b.add({"title": a[1], "priority": a[2] if len(a) > 2 else "media",
                   "description": a[3] if len(a) > 3 else ""})
        print(f"#{t['id']} criada")
    elif c == "start":
        b.update(int(a[1]), {"status": "em_andamento", "run_now": 0} if isinstance(b, Remote) else {"status": "em_andamento"})
    elif c == "comment":
        if not isinstance(b, Remote):
            sys.exit("comment só funciona com o painel publicado")
        b.comment(int(a[1]), a[2])
    elif c == "history":
        if not isinstance(b, Remote):
            sys.exit("history só funciona com o painel publicado")
        print("\n".join(reversed(b.log_lines(int(a[1]) if len(a) > 1 else 7))))
    elif c == "wait-now":
        import time
        until = time.time() + 60 * (float(a[1]) if len(a) > 1 else 50)
        while True:
            ts = b.list_tasks()
            hit = [x for x in ts if x["status"] == "pendente" and x.get("run_now")]
            if hit:
                print(f"fazer agora: #{hit[0]['id']} {hit[0]['title']}")
                sys.exit(0)
            if time.time() >= until:
                print("plantão encerrado sem pedidos")
                sys.exit(3)
            time.sleep(max(1, min(60, until - time.time())))
    elif c == "complete":
        b.update(int(a[1]), {"status": "concluida", "result": a[2]})
        b.log(f"concluída #{a[1]}: {a[2][:300]}")
    elif c == "block":
        b.update(int(a[1]), {"status": "bloqueada", "result": a[2]})
        b.log(f"bloqueada #{a[1]}: {a[2][:300]}")
    elif c == "log":
        b.log(" ".join(a[1:]))
    elif c == "attach":
        if not isinstance(b, Remote):
            sys.exit("attach só funciona com o painel publicado")
        f = b.attach(int(a[1]), a[2])
        print(f"anexado: {f['name']} ({f['size']} bytes) na tarefa #{a[1]}")
    elif c == "export":
        if not isinstance(b, Remote):
            sys.exit("export só faz sentido com o painel remoto")
        ts = b.list_tasks()
        store.save({"next_id": max((t["id"] for t in ts), default=0) + 1, "tasks": ts})
        store.LOG.write_text("\n".join(reversed(b.log_lines())) + "\n", encoding="utf-8")
        print(f"{len(ts)} tarefas exportadas")
    else:
        sys.exit(f"comando desconhecido: {c}")


if __name__ == "__main__":
    main(sys.argv[1:])
