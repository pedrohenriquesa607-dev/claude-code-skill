"""Armazenamento de tarefas em tasks/tasks.json, com log em tasks/tasks.log.

Usado pelo servidor web (server.py) e pelo agente autônomo (tasks_cli.py).
"""
import json, os, datetime, pathlib, tempfile, threading

DIR = pathlib.Path(__file__).resolve().parent
DATA, LOG = DIR / "tasks.json", DIR / "tasks.log"
PRIORITIES = {"urgente": 4, "alta": 3, "media": 2, "baixa": 1}
STATUSES = ["pendente", "em_andamento", "concluida", "bloqueada"]
_lock = threading.Lock()


def now():
    return datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat()


def log(actor, msg):
    with LOG.open("a", encoding="utf-8") as f:
        f.write(f"{now()} [{actor}] {msg}\n")


def load():
    if not DATA.exists():
        return {"next_id": 1, "tasks": []}
    return json.loads(DATA.read_text(encoding="utf-8"))


def save(d):
    fd, tmp = tempfile.mkstemp(dir=DIR, suffix=".tmp")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False, indent=2)
        f.write("\n")
    os.replace(tmp, DATA)


def _clean(fields, partial):
    out = {}
    if "title" in fields or not partial:
        t = str(fields.get("title", "")).strip()
        if not t:
            raise ValueError("título obrigatório")
        out["title"] = t[:200]
    if "description" in fields or not partial:
        out["description"] = str(fields.get("description", "")).strip()[:5000]
    if "priority" in fields or not partial:
        p = fields.get("priority", "media")
        if p not in PRIORITIES:
            raise ValueError(f"prioridade inválida: {p}")
        out["priority"] = p
    if "status" in fields:
        if fields["status"] not in STATUSES:
            raise ValueError(f"status inválido: {fields['status']}")
        out["status"] = fields["status"]
    for k in ("result", "notes"):
        if k in fields:
            out[k] = str(fields[k]).strip()[:20000]
    return out


def sort_key(t):
    return (-PRIORITIES[t["priority"]], t["created_at"], t["id"])


def list_tasks():
    with _lock:
        return sorted(load()["tasks"], key=sort_key)


def add(fields, actor="web"):
    with _lock:
        d = load()
        t = {"id": d["next_id"], **_clean(fields, False), "status": "pendente",
             "result": "", "created_at": now(), "updated_at": now(), "completed_at": None}
        d["next_id"] += 1
        d["tasks"].append(t)
        save(d)
    log(actor, f"criada #{t['id']} [{t['priority']}] {t['title']}")
    return t


def update(task_id, fields, actor="web"):
    with _lock:
        d = load()
        t = next((x for x in d["tasks"] if x["id"] == task_id), None)
        if t is None:
            raise KeyError(task_id)
        ch = _clean(fields, True)
        before = {k: t.get(k) for k in ch}
        t.update(ch)
        t["updated_at"] = now()
        if ch.get("status") == "concluida" and before.get("status") != "concluida":
            t["completed_at"] = now()
        elif "status" in ch and ch["status"] != "concluida":
            t["completed_at"] = None
        save(d)
    diff = ", ".join(f"{k}: {before[k]!r} -> {ch[k]!r}" for k in ch
                     if before[k] != ch[k] and k not in ("result", "description", "notes"))
    extra = [k for k in ("description", "result", "notes") if k in ch and before[k] != ch[k]]
    log(actor, f"editada #{task_id}" + (f" ({diff})" if diff else "") + (f" [{', '.join(extra)} alterado]" if extra else ""))
    return t


def delete(task_id, actor="web"):
    with _lock:
        d = load()
        t = next((x for x in d["tasks"] if x["id"] == task_id), None)
        if t is None:
            raise KeyError(task_id)
        d["tasks"].remove(t)
        save(d)
    log(actor, f"excluída #{task_id} {t['title']}")


def next_pending():
    return next((t for t in list_tasks() if t["status"] == "pendente"), None)
