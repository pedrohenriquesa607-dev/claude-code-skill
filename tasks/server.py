#!/usr/bin/env python3
"""Dashboard de tarefas local.  Uso: python3 tasks/server.py [porta]  (padrão 8765)
Abre em http://127.0.0.1:8765 — só aceita conexões da própria máquina."""
import json, sys, subprocess, pathlib
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import store

WEB = store.DIR / "web" / "index.html"
REPO = store.DIR.parent


def git(*args):
    r = subprocess.run(["git", *args], cwd=REPO, capture_output=True, text=True, timeout=60)
    return r.returncode, (r.stdout + r.stderr).strip()


def sync():
    """Puxa as mudanças do agente e envia as suas (só arquivos de tasks/)."""
    out = []
    code, o = git("pull", "--no-edit", "--no-rebase")
    out.append(o)
    if code:
        return False, "\n".join(out)
    git("add", "tasks/tasks.json", "tasks/tasks.log", "tasks/output")
    if git("diff", "--cached", "--quiet")[0]:
        code, o = git("commit", "-m", "tasks: atualização pelo dashboard")
        out.append(o)
        code, o = git("push")
        out.append(o)
        if code:
            return False, "\n".join(out)
    store.log("web", "sincronizado com o GitHub")
    return True, "\n".join(x for x in out if x)


class H(BaseHTTPRequestHandler):
    def _send(self, code, body, ctype="application/json"):
        data = body if isinstance(body, bytes) else json.dumps(body, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype + "; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(n) or b"{}")

    def _id(self):
        try:
            return int(self.path.rstrip("/").rsplit("/", 1)[1])
        except ValueError:
            return None

    def _guard(self):
        # Bloqueia requisições de outros sites (CSRF) — só a própria página pode alterar dados.
        origin = self.headers.get("Origin")
        host = self.headers.get("Host", "")
        if origin and origin.split("://", 1)[-1] != host:
            self._send(403, {"error": "origem não permitida"})
            return False
        return True

    def _run(self, fn):
        if not self._guard():
            return
        try:
            fn()
        except KeyError:
            self._send(404, {"error": "tarefa não encontrada"})
        except (ValueError, json.JSONDecodeError) as e:
            self._send(400, {"error": str(e)})

    def do_GET(self):
        if self.path in ("/", "/index.html"):
            self._send(200, WEB.read_bytes(), "text/html")
        elif self.path == "/api/config":
            self._send(200, {"mode": "local"})
        elif self.path == "/api/tasks":
            self._send(200, store.list_tasks())
        elif self.path == "/api/log":
            lines = store.LOG.read_text(encoding="utf-8").splitlines() if store.LOG.exists() else []
            self._send(200, lines[-100:][::-1])
        else:
            self._send(404, {"error": "não encontrado"})

    def do_POST(self):
        if self.path == "/api/tasks":
            self._run(lambda: self._send(201, store.add(self._body())))
        elif self.path == "/api/sync":
            def s():
                ok, msg = sync()
                self._send(200 if ok else 500, {"ok": ok, "output": msg})
            self._run(s)
        else:
            self._send(404, {"error": "não encontrado"})

    def do_PUT(self):
        if self.path.startswith("/api/tasks/") and self._id():
            self._run(lambda: self._send(200, store.update(self._id(), self._body())))
        else:
            self._send(404, {"error": "não encontrado"})

    def do_DELETE(self):
        if self.path.startswith("/api/tasks/") and self._id():
            self._run(lambda: (store.delete(self._id()), self._send(200, {"ok": True})))
        else:
            self._send(404, {"error": "não encontrado"})

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    print(f"Dashboard em http://127.0.0.1:{port}  (Ctrl+C para sair)")
    ThreadingHTTPServer(("127.0.0.1", port), H).serve_forever()
