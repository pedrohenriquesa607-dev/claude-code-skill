// Painel de Tarefas — Cloudflare Worker + D1.
// A página é pública, mas toda a API exige "Authorization: Bearer <ACCESS_TOKEN>"
// (secret do Worker). O agente de hora em hora usa a API do D1 diretamente.
import HTML from "../../tasks/web/index.html";

const PRIORITIES = { urgente: 4, alta: 3, media: 2, baixa: 1 };
const STATUSES = ["pendente", "em_andamento", "concluida", "bloqueada"];
const ORDER = "CASE priority WHEN 'urgente' THEN 4 WHEN 'alta' THEN 3 WHEN 'media' THEN 2 ELSE 1 END DESC, created_at, id";

const now = () => new Date().toISOString().replace(/\.\d+Z$/, "+00:00");
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

class BadRequest extends Error {}

function clean(f, partial) {
  const out = {};
  if ("title" in f || !partial) {
    const t = String(f.title ?? "").trim();
    if (!t) throw new BadRequest("título obrigatório");
    out.title = t.slice(0, 200);
  }
  if ("description" in f || !partial) out.description = String(f.description ?? "").trim().slice(0, 5000);
  if ("priority" in f || !partial) {
    const p = f.priority ?? "media";
    if (!(p in PRIORITIES)) throw new BadRequest(`prioridade inválida: ${p}`);
    out.priority = p;
  }
  if ("status" in f) {
    if (!STATUSES.includes(f.status)) throw new BadRequest(`status inválido: ${f.status}`);
    out.status = f.status;
  }
  if ("result" in f) out.result = String(f.result).trim().slice(0, 20000);
  return out;
}

async function log(env, actor, msg) {
  await env.DB.prepare("INSERT INTO log (ts, actor, msg) VALUES (?, ?, ?)").bind(now(), actor, msg).run();
}

async function authorized(req, env) {
  // Tolerante a "Bearer Bearer x" e espaços sobrando (valor colado com prefixo).
  const got = (req.headers.get("authorization") || "").trim().replace(/^(Bearer\s+)+/i, "").trim();
  const want = env.ACCESS_TOKEN || "";
  if (!want || got.length !== want.length) return false;
  const a = new TextEncoder().encode(got), b = new TextEncoder().encode(want);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function api(req, env, url) {
  if (!(await authorized(req, env))) return json({ error: "não autorizado" }, 401);
  const path = url.pathname, m = req.method;
  const idMatch = path.match(/^\/api\/tasks\/(\d+)$/);
  const actor = req.headers.get("x-actor") === "agente" ? "agente" : "web";

  if (path === "/api/config" && m === "GET") return json({ mode: "cloud" });

  if (path === "/api/tasks" && m === "GET") {
    const { results } = await env.DB.prepare(`SELECT * FROM tasks ORDER BY ${ORDER}`).all();
    return json(results);
  }
  if (path === "/api/tasks" && m === "POST") {
    const f = clean(await req.json(), false), t = now();
    const row = await env.DB.prepare(
      "INSERT INTO tasks (title, description, priority, status, result, created_at, updated_at) VALUES (?, ?, ?, 'pendente', '', ?, ?) RETURNING *"
    ).bind(f.title, f.description, f.priority, t, t).first();
    await log(env, actor, `criada #${row.id} [${row.priority}] ${row.title}`);
    return json(row, 201);
  }
  if (idMatch && m === "PUT") {
    const id = Number(idMatch[1]);
    const before = await env.DB.prepare("SELECT * FROM tasks WHERE id = ?").bind(id).first();
    if (!before) return json({ error: "tarefa não encontrada" }, 404);
    const ch = clean(await req.json(), true);
    if ("status" in ch) ch.completed_at = ch.status === "concluida" ? (before.status === "concluida" ? before.completed_at : now()) : null;
    ch.updated_at = now();
    const keys = Object.keys(ch);
    const row = await env.DB.prepare(`UPDATE tasks SET ${keys.map(k => `${k} = ?`).join(", ")} WHERE id = ? RETURNING *`)
      .bind(...keys.map(k => ch[k]), id).first();
    const diff = ["title", "priority", "status"].filter(k => k in ch && before[k] !== ch[k]).map(k => `${k}: '${before[k]}' -> '${ch[k]}'`);
    const extra = ["description", "result"].filter(k => k in ch && before[k] !== ch[k]);
    await log(env, actor, `editada #${id}` + (diff.length ? ` (${diff.join(", ")})` : "") + (extra.length ? ` [${extra.join(", ")} alterado]` : ""));
    return json(row);
  }
  if (idMatch && m === "DELETE") {
    const id = Number(idMatch[1]);
    const row = await env.DB.prepare("DELETE FROM tasks WHERE id = ? RETURNING title").bind(id).first();
    if (!row) return json({ error: "tarefa não encontrada" }, 404);
    await log(env, actor, `excluída #${id} ${row.title}`);
    return json({ ok: true });
  }
  if (path === "/api/log" && m === "POST") {
    const msg = String((await req.json()).msg ?? "").trim().slice(0, 2000);
    if (!msg) throw new BadRequest("mensagem vazia");
    await log(env, actor, msg);
    return json({ ok: true }, 201);
  }
  if (path === "/api/log" && m === "GET") {
    const { results } = await env.DB.prepare("SELECT ts, actor, msg FROM log ORDER BY id DESC LIMIT 100").all();
    return json(results.map(r => `${r.ts} [${r.actor}] ${r.msg}`));
  }
  return json({ error: "não encontrado" }, 404);
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(HTML, {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "content-security-policy": "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-ancestors 'none'",
          "x-content-type-options": "nosniff",
          "referrer-policy": "no-referrer",
        },
      });
    }
    if (url.pathname.startsWith("/api/")) {
      try {
        return await api(req, env, url);
      } catch (e) {
        if (e instanceof BadRequest || e instanceof SyntaxError) return json({ error: e.message }, 400);
        return json({ error: "erro interno" }, 500);
      }
    }
    return json({ error: "não encontrado" }, 404);
  },
};
