// Painel de Tarefas — Cloudflare Worker + D1.
// A página é pública, mas toda a API exige "Authorization: Bearer <ACCESS_TOKEN>"
// (secret do Worker). O agente de hora em hora usa a API do D1 diretamente.
import HTML from "../../tasks/web/index.html";
import ICON_192 from "../static/icon-192.png";
import ICON_512 from "../static/icon-512.png";
import APPLE_ICON from "../static/apple-touch-icon.png";

const MANIFEST = JSON.stringify({
  name: "Painel de Tarefas",
  short_name: "Tarefas",
  description: "Suas tarefas, feitas pelo agente de hora em hora.",
  lang: "pt-BR",
  start_url: "/",
  scope: "/",
  display: "standalone",
  orientation: "portrait",
  background_color: "#f6f5f2",
  theme_color: "#2f5bd3",
  icons: [
    { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  ],
});

// Service worker: guarda só a página e os ícones para abrir rápido; as tarefas
// (/api) sempre vêm da internet, nunca do cache.
const SW = `const C = "painel-v1";
self.addEventListener("install", e => { e.waitUntil(caches.open(C).then(c => c.addAll(["/", "/icon-192.png", "/icon-512.png"]))); self.skipWaiting(); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== C).map(k => caches.delete(k))))); self.clients.claim(); });
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin || u.pathname.startsWith("/api/")) return;
  e.respondWith(fetch(e.request).then(r => { const copy = r.clone(); caches.open(C).then(c => c.put(e.request, copy)); return r; })
    .catch(() => caches.match(e.request).then(r => r || caches.match("/"))));
});`;

const STATIC = {
  "/manifest.webmanifest": [MANIFEST, "application/manifest+json"],
  "/sw.js": [SW, "text/javascript"],
  "/icon-192.png": [ICON_192, "image/png"],
  "/icon-512.png": [ICON_512, "image/png"],
  "/apple-touch-icon.png": [APPLE_ICON, "image/png"],
  "/favicon.ico": [ICON_192, "image/png"],
};

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

// ---- Arquivos anexados às tarefas (guardados no D1) ----
const MAX_FILE = 1_900_000; // limite de uma linha do D1 é ~2 MB
const MIME = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif",
  txt: "text/plain; charset=utf-8", md: "text/markdown; charset=utf-8", csv: "text/csv; charset=utf-8", html: "text/plain; charset=utf-8",
  json: "application/json", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation", zip: "application/zip" };
const FILE_COLS = "id, task_id, name, mime, size, created_at";

function cleanName(n) {
  const base = String(n || "arquivo").split(/[\\/]/).pop().replace(/[\u0000-\u001f"<>|?*:]/g, "").trim().slice(0, 120);
  return base || "arquivo";
}
function mimeFor(name) {
  const ext = name.toLowerCase().split(".").pop();
  return MIME[ext] || "application/octet-stream";
}
const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function sign(env, msg) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("files:" + (env.ACCESS_TOKEN || "")), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg)));
}

// Link assinado (5 min) para abrir o arquivo direto no navegador/visualizador do celular.
async function download(env, url, fid) {
  const exp = Number(url.searchParams.get("exp") || 0), sig = url.searchParams.get("sig") || "";
  if (!env.ACCESS_TOKEN || !exp || exp < Date.now() / 1000 || sig !== (await sign(env, `${fid}.${exp}`)))
    return new Response("Link expirado. Abra o arquivo de novo pelo painel.", { status: 403, headers: { "content-type": "text/plain; charset=utf-8" } });
  const row = await env.DB.prepare("SELECT name, mime, data FROM files WHERE id = ?").bind(fid).first();
  if (!row) return new Response("Arquivo não encontrado.", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  const bytes = row.data instanceof ArrayBuffer ? new Uint8Array(row.data) : new Uint8Array(row.data);
  const disp = url.searchParams.get("dl") ? "attachment" : "inline";
  const headers = {
    "content-type": row.mime,
    "content-disposition": `${disp}; filename*=UTF-8''${encodeURIComponent(row.name)}`,
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
  };
  // PDF abre no visualizador do navegador (que não funciona em modo sandbox); o resto fica isolado.
  if (row.mime !== "application/pdf") headers["content-security-policy"] = "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'";
  return new Response(bytes, { headers });
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
    const { results: files } = await env.DB.prepare(`SELECT ${FILE_COLS} FROM files ORDER BY id`).all();
    const byTask = {};
    for (const f of files) (byTask[f.task_id] ||= []).push(f);
    for (const t of results) t.files = byTask[t.id] || [];
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
    await env.DB.prepare("DELETE FROM files WHERE task_id = ?").bind(id).run();
    await log(env, actor, `excluída #${id} ${row.title}`);
    return json({ ok: true });
  }
  const filesMatch = path.match(/^\/api\/tasks\/(\d+)\/files$/);
  if (filesMatch && m === "POST") {
    const tid = Number(filesMatch[1]);
    if (!(await env.DB.prepare("SELECT id FROM tasks WHERE id = ?").bind(tid).first())) return json({ error: "tarefa não encontrada" }, 404);
    const name = cleanName(url.searchParams.get("name"));
    const buf = await req.arrayBuffer();
    if (!buf.byteLength) throw new BadRequest("arquivo vazio");
    if (buf.byteLength > MAX_FILE) return json({ error: `arquivo grande demais (máximo ${(MAX_FILE / 1e6).toFixed(1)} MB)` }, 413);
    const row = await env.DB.prepare(`INSERT INTO files (task_id, name, mime, size, data, created_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING ${FILE_COLS}`)
      .bind(tid, name, mimeFor(name), buf.byteLength, buf, now()).first();
    await log(env, actor, `arquivo anexado à #${tid}: ${name} (${Math.round(buf.byteLength / 1024)} KB)`);
    return json(row, 201);
  }
  const fileMatch = path.match(/^\/api\/files\/(\d+)(\/link)?$/);
  if (fileMatch && fileMatch[2] && m === "POST") {
    const fid = Number(fileMatch[1]);
    if (!(await env.DB.prepare("SELECT id FROM files WHERE id = ?").bind(fid).first())) return json({ error: "arquivo não encontrado" }, 404);
    const exp = Math.floor(Date.now() / 1000) + 300;
    return json({ url: `/api/files/${fid}/download?exp=${exp}&sig=${await sign(env, `${fid}.${exp}`)}` });
  }
  if (fileMatch && !fileMatch[2] && m === "DELETE") {
    const fid = Number(fileMatch[1]);
    const row = await env.DB.prepare("DELETE FROM files WHERE id = ? RETURNING task_id, name").bind(fid).first();
    if (!row) return json({ error: "arquivo não encontrado" }, 404);
    await log(env, actor, `arquivo removido da #${row.task_id}: ${row.name}`);
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
          "content-security-policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; worker-src 'self'; manifest-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'",
          "x-content-type-options": "nosniff",
          "referrer-policy": "no-referrer",
        },
      });
    }
    if (url.pathname in STATIC) {
      const [body, type] = STATIC[url.pathname];
      return new Response(body, { headers: { "content-type": type, "cache-control": url.pathname === "/sw.js" ? "no-cache" : "public, max-age=86400" } });
    }
    const dl = url.pathname.match(/^\/api\/files\/(\d+)\/download$/);
    if (dl && req.method === "GET") return download(env, url, Number(dl[1]));
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
