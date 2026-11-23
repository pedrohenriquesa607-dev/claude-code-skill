// Painel de Tarefas — Cloudflare Worker + D1.
// A página é pública, mas toda a API exige "Authorization: Bearer <ACCESS_TOKEN>"
// (secret do Worker). Exceções: links assinados de arquivo e páginas compartilhadas (/s/...).
import HTML from "../../tasks/web/index.html";
import ICON_192 from "../static/icon-192.png";
import ICON_512 from "../static/icon-512.png";
import APPLE_ICON from "../static/apple-touch-icon.png";
import MOON from "../static/moon.jpg"; // fotos: NASA Goddard (domínio público)
import EARTH from "../static/earth.jpg";
import { md } from "./md.js";
import { newVapidKeys, sendPush } from "./push.js";
import { nextRun, describe } from "./recur.js";

const MANIFEST = JSON.stringify({
  id: "/?app=nexcode",
  name: "NexCode",
  short_name: "NexCode",
  description: "Suas tarefas, feitas pelo NexCode Agente de hora em hora.",
  lang: "pt-BR",
  start_url: "/",
  scope: "/",
  display: "standalone",
  orientation: "portrait",
  background_color: "#03060c",
  theme_color: "#03060c",
  icons: [
    { src: "/nexcode-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "/nexcode-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    { src: "/nexcode-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  ],
});

// Service worker: guarda só a página e os ícones para abrir rápido (as tarefas, em
// /api, sempre vêm da internet) e mostra os avisos (push) no celular.
const SW = `const C = "nexcode-v6";
self.addEventListener("install", e => { e.waitUntil(caches.open(C).then(c => c.addAll(["/", "/md.js", "/moon.jpg", "/earth.jpg", "/nexcode-192.png", "/nexcode-512.png"]))); self.skipWaiting(); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== C).map(k => caches.delete(k))))); self.clients.claim(); });
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin || u.pathname.startsWith("/api/") || u.pathname.startsWith("/s/")) return;
  e.respondWith(fetch(e.request).then(r => { const copy = r.clone(); caches.open(C).then(c => c.put(e.request, copy)); return r; })
    .catch(() => caches.match(e.request).then(r => r || caches.match("/"))));
});
self.addEventListener("push", e => {
  let d = {}; try { d = e.data.json(); } catch (_) { d = { title: "Painel de Tarefas", body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "Painel de Tarefas", {
    body: d.body || "", icon: "/nexcode-192.png", badge: "/nexcode-192.png", tag: d.tag || undefined, data: { url: d.url || "/" } }));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = new URL(e.notification.data && e.notification.data.url || "/", location.origin).href;
  e.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    for (const c of list) if (c.url.startsWith(location.origin)) { c.navigate(url).catch(() => {}); return c.focus(); }
    return clients.openWindow(url);
  }));
});`;

// O empacotador pode inserir chamadas a __name() no corpo da função; definimos um no navegador.
const MD_JS = `var __name = __name || function (f) { return f; };\nwindow.md = ${md.toString()};`;

const STATIC = {
  "/manifest.webmanifest": [MANIFEST, "application/manifest+json"],
  "/nexcode.webmanifest": [MANIFEST, "application/manifest+json"],
  "/nexcode-192.png": [ICON_192, "image/png"],
  "/nexcode-512.png": [ICON_512, "image/png"],
  "/nexcode-180.png": [APPLE_ICON, "image/png"],
  "/sw.js": [SW, "text/javascript"],
  "/md.js": [MD_JS, "text/javascript"],
  "/icon-192.png": [ICON_192, "image/png"],
  "/icon-512.png": [ICON_512, "image/png"],
  "/apple-touch-icon.png": [APPLE_ICON, "image/png"],
  "/favicon.ico": [ICON_192, "image/png"],
  "/moon.jpg": [MOON, "image/jpeg"],
  "/earth.jpg": [EARTH, "image/jpeg"],
};

const PRIORITIES = { urgente: 4, alta: 3, media: 2, baixa: 1 };
const STATUSES = ["pendente", "em_andamento", "concluida", "bloqueada"];
const P_ORDER = "CASE priority WHEN 'urgente' THEN 4 WHEN 'alta' THEN 3 WHEN 'media' THEN 2 ELSE 1 END";
// Ordem de trabalho: "fazer agora" > vence até amanhã > prioridade > prazo > mais antiga
const ORDER = `run_now DESC,
  CASE WHEN due_date IS NOT NULL AND due_date <= ?1 THEN 0 ELSE 1 END,
  ${P_ORDER} DESC, CASE WHEN due_date IS NULL THEN 1 ELSE 0 END, due_date, created_at, id`;

const now = () => new Date().toISOString().replace(/\.\d+Z$/, "+00:00");
// Data local de Brasília (UTC-3) daqui a `days` dias, AAAA-MM-DD
const localDate = (days = 0) => new Date(Date.now() - 3 * 3600e3 + days * 864e5).toISOString().slice(0, 10);
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

class BadRequest extends Error {}

function cleanTags(v) {
  const list = (Array.isArray(v) ? v : String(v ?? "").split(","))
    .map(t => String(t).trim().replace(/^#/, "").slice(0, 30)).filter(Boolean);
  return [...new Set(list.map(t => t.toLowerCase()))].slice(0, 8).join(",");
}

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
  if ("due_date" in f || !partial) {
    const d = String(f.due_date ?? "").trim();
    if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new BadRequest("prazo inválido (use AAAA-MM-DD)");
    out.due_date = d || null;
  }
  if ("tags" in f || !partial) out.tags = cleanTags(f.tags);
  if ("run_now" in f) out.run_now = f.run_now ? 1 : 0;
  return out;
}

async function log(env, actor, msg) {
  await env.DB.prepare("INSERT INTO log (ts, actor, msg) VALUES (?, ?, ?)").bind(now(), actor, msg).run();
}

// ---------- Configurações guardadas no banco ----------
async function getSetting(env, key) {
  const r = await env.DB.prepare("SELECT value FROM settings WHERE key = ?").bind(key).first();
  return r ? JSON.parse(r.value) : null;
}
async function setSetting(env, key, value) {
  await env.DB.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(key, JSON.stringify(value)).run();
}

// ---------- Avisos no celular (Web Push) ----------
async function vapidKeys(env) {
  let v = await getSetting(env, "vapid");
  if (!v) { v = await newVapidKeys(); await setSetting(env, "vapid", v); }
  return v;
}
async function notify(env, origin, data) {
  const { results } = await env.DB.prepare("SELECT * FROM push_subs").all();
  if (!results.length) return { sent: 0, failed: 0 };
  const vapid = await vapidKeys(env);
  let sent = 0, failed = 0;
  for (const s of results) {
    try {
      const st = await sendPush(s, data, vapid, origin);
      if (st === 404 || st === 410) { await env.DB.prepare("DELETE FROM push_subs WHERE id = ?").bind(s.id).run(); failed++; }
      else if (st >= 200 && st < 300) sent++;
      else failed++;
    } catch (_) { failed++; }
  }
  return { sent, failed };
}

// ---------- Arquivos anexados às tarefas (guardados no D1) ----------
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

function fileResponse(row, attachment) {
  const headers = {
    "content-type": row.mime,
    "content-disposition": `${attachment ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(row.name)}`,
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
    "x-robots-tag": "noindex",
  };
  // PDF abre no visualizador do navegador (que não funciona em modo sandbox); o resto fica isolado.
  if (row.mime !== "application/pdf") headers["content-security-policy"] = "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'";
  return new Response(new Uint8Array(row.data), { headers });
}

// Link assinado (5 min) para abrir o arquivo direto no navegador/visualizador do celular.
async function download(env, url, fid) {
  const exp = Number(url.searchParams.get("exp") || 0), sig = url.searchParams.get("sig") || "";
  if (!env.ACCESS_TOKEN || !exp || exp < Date.now() / 1000 || sig !== (await sign(env, `${fid}.${exp}`)))
    return new Response("Link expirado. Abra o arquivo de novo pelo painel.", { status: 403, headers: { "content-type": "text/plain; charset=utf-8" } });
  const row = await env.DB.prepare("SELECT name, mime, data FROM files WHERE id = ?").bind(fid).first();
  if (!row) return new Response("Arquivo não encontrado.", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  return fileResponse(row, url.searchParams.get("dl"));
}

// ---------- Página pública de compartilhamento ----------
const SHARE_CSS = `:root{--bg:#f6f5f2;--surface:#fff;--fg:#1d1c1a;--muted:#6b6760;--line:#e2dfd8;--accent:#2f5bd3}
@media (prefers-color-scheme:dark){:root{--bg:#141414;--surface:#1d1d1c;--fg:#ecebe8;--muted:#a19d95;--line:#33322f;--accent:#7d9cf0;color-scheme:dark}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.wrap{max-width:820px;margin:0 auto;padding:32px max(16px,env(safe-area-inset-left)) 56px}
h1{font-size:26px;line-height:1.25;margin:0 0 6px}.meta{color:var(--muted);font-size:14px;margin-bottom:24px}
.card{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:18px 20px}
.files{display:flex;flex-wrap:wrap;gap:10px;margin:0 0 20px}.files a{display:inline-flex;gap:8px;align-items:center;padding:10px 14px;border:1px solid var(--line);border-radius:10px;background:var(--surface);color:var(--fg);text-decoration:none;font-weight:600}
.files a:hover{border-color:var(--accent);color:var(--accent)}.files small{color:var(--muted);font-weight:400}.ft{font-size:11px;padding:1px 6px;border-radius:4px;background:var(--bg);color:var(--accent)}
.md h2,.md h3,.md h4{line-height:1.3;margin:22px 0 8px}.md h2{font-size:21px}.md h3{font-size:18px}.md p{margin:0 0 12px}
.md-table{overflow-x:auto;margin:0 0 14px}.md table{border-collapse:collapse;width:100%;font-size:14px}.md th,.md td{border:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}.md th{background:var(--bg)}
.md blockquote{margin:0 0 12px;padding:8px 14px;border-left:4px solid var(--accent);background:var(--bg)}.md a{color:var(--accent);word-break:break-all}
.md code{background:var(--bg);padding:0 4px;border-radius:4px}.md pre{overflow-x:auto;background:var(--bg);padding:10px;border-radius:8px}`;

async function sharePage(env, token, fid) {
  const sh = await env.DB.prepare("SELECT task_id FROM shares WHERE token = ?").bind(token).first();
  const notFound = () => new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Link indisponível</title><style>${SHARE_CSS}</style><div class="wrap"><h1>Link indisponível</h1><p class="meta">Este link foi desativado ou não existe.</p></div>`,
    { status: 404, headers: { "content-type": "text/html; charset=utf-8", "x-robots-tag": "noindex" } });
  if (!sh) return notFound();
  if (fid) {
    const row = await env.DB.prepare("SELECT name, mime, data FROM files WHERE id = ? AND task_id = ?").bind(fid, sh.task_id).first();
    return row ? fileResponse(row, false) : notFound();
  }
  const t = await env.DB.prepare("SELECT title, result, updated_at FROM tasks WHERE id = ?").bind(sh.task_id).first();
  if (!t) return notFound();
  const { results: files } = await env.DB.prepare(`SELECT ${FILE_COLS} FROM files WHERE task_id = ? ORDER BY id`).bind(sh.task_id).all();
  const size = n => n < 1048576 ? Math.max(1, Math.round(n / 1024)) + " KB" : (n / 1048576).toFixed(1) + " MB";
  const when = new Date(t.updated_at).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const html = `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(t.title)}</title><style>${SHARE_CSS}</style>
<div class="wrap"><h1>${esc(t.title)}</h1><div class="meta">Atualizado em ${when}</div>
${files.length ? `<div class="files">${files.map(f => `<a href="/s/${token}/f/${f.id}" target="_blank" rel="noopener"><b class="ft">${f.mime === "application/pdf" ? "PDF" : f.mime.startsWith("image/") ? "IMG" : "ARQ"}</b> ${esc(f.name)} <small>${size(f.size)}</small></a>`).join("")}</div>` : ""}
${t.result ? `<div class="card md">${md(t.result)}</div>` : ""}</div></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "x-robots-tag": "noindex",
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; frame-ancestors 'none'", "referrer-policy": "no-referrer" } });
}

// ---------- Tarefas que se repetem ----------
const WEEKLY_SUMMARY = {
  title: "Resumo da semana",
  description: "Monte o resumo da semana: o que foi concluído, o que ficou pendente ou bloqueado, e 3 sugestões práticas para a próxima semana. " +
    "Veja a atividade dos últimos 7 dias com `python3 tasks/tasks_cli.py history 7` e a lista com `python3 tasks/tasks_cli.py list`. " +
    "Entregue em PDF anexado a esta tarefa e escreva um resumo curto no resultado.",
  priority: "alta", tags: "relatório", freq: "semanal", dow: 5, dom: null, hour: 20,
};

function cleanRule(f) {
  const r = clean({ title: f.title, description: f.description, priority: f.priority, tags: f.tags }, false);
  const freq = f.freq;
  if (!["diaria", "semanal", "mensal"].includes(freq)) throw new BadRequest("repetição inválida");
  const hour = Number(f.hour ?? 8);
  if (!(hour >= 0 && hour <= 23)) throw new BadRequest("hora inválida");
  const dow = freq === "semanal" ? Number(f.dow) : null;
  if (freq === "semanal" && !(dow >= 0 && dow <= 6)) throw new BadRequest("dia da semana inválido");
  const dom = freq === "mensal" ? Number(f.dom) : null;
  if (freq === "mensal" && !(dom >= 1 && dom <= 28)) throw new BadRequest("dia do mês inválido (1 a 28)");
  return { title: r.title, description: r.description, priority: r.priority, tags: r.tags, freq, dow, dom, hour: Math.floor(hour) };
}

async function insertRule(env, r) {
  return env.DB.prepare(`INSERT INTO recurring (title, description, priority, tags, freq, dow, dom, hour, next_run, active, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?) RETURNING *`)
    .bind(r.title, r.description, r.priority, r.tags, r.freq, r.dow, r.dom, r.hour, nextRun(r), now()).first();
}

async function createFromRule(env, rule) {
  const t = now();
  const row = await env.DB.prepare(`INSERT INTO tasks (title, description, priority, status, result, created_at, updated_at, tags, recurring_id)
    VALUES (?, ?, ?, 'pendente', '', ?, ?, ?, ?) RETURNING *`)
    .bind(rule.title, rule.description, rule.priority, t, t, rule.tags, rule.id).first();
  await log(env, "repetição", `criada #${row.id} [${row.priority}] ${row.title} (${describe(rule)})`);
  return row;
}

async function runRecurring(env) {
  if (!(await getSetting(env, "seeded_weekly"))) {
    await insertRule(env, WEEKLY_SUMMARY);
    await setSetting(env, "seeded_weekly", true);
  }
  const { results } = await env.DB.prepare("SELECT * FROM recurring WHERE active = 1 AND next_run <= ?").bind(now()).all();
  for (const rule of results) {
    await createFromRule(env, rule);
    await env.DB.prepare("UPDATE recurring SET next_run = ? WHERE id = ?").bind(nextRun(rule, new Date()), rule.id).run();
  }
  return results.length;
}

// ---------- Autenticação ----------
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

async function getTask(env, id) {
  return env.DB.prepare("SELECT * FROM tasks WHERE id = ?").bind(id).first();
}

// ---------- API ----------
async function api(req, env, url, ctx) {
  if (!(await authorized(req, env))) return json({ error: "não autorizado" }, 401);
  const path = url.pathname, m = req.method;
  const actor = req.headers.get("x-actor") === "agente" ? "agente" : "web";
  const id = (re => { const x = path.match(re); return x ? Number(x[1]) : null; });
  const later = p => ctx.waitUntil(p.catch(() => {}));
  const pushTask = (t, title, body) => later(notify(env, url.origin, { title, body, url: `/#tarefa-${t.id}`, tag: `tarefa-${t.id}` }));

  if (path === "/api/config" && m === "GET") return json({ mode: "cloud", today: localDate() });

  // --- Tarefas ---
  if (path === "/api/tasks" && m === "GET") {
    const { results } = await env.DB.prepare(`SELECT * FROM tasks ORDER BY ${ORDER}`).bind(localDate(1)).all();
    const group = async sql => { const { results: rs } = await env.DB.prepare(sql).all(); const by = {}; for (const r of rs) (by[r.task_id] ||= []).push(r); return by; };
    const files = await group(`SELECT ${FILE_COLS} FROM files ORDER BY id`);
    const comments = await group("SELECT id, task_id, author, text, created_at FROM comments ORDER BY id");
    const { results: shares } = await env.DB.prepare("SELECT token, task_id FROM shares").all();
    const share = Object.fromEntries(shares.map(s => [s.task_id, `${url.origin}/s/${s.token}`]));
    for (const t of results) { t.files = files[t.id] || []; t.comments = comments[t.id] || []; t.share_url = share[t.id] || null; }
    return json(results);
  }
  if (path === "/api/tasks" && m === "POST") {
    const f = clean(await req.json(), false), t = now();
    const row = await env.DB.prepare(
      "INSERT INTO tasks (title, description, priority, status, result, created_at, updated_at, due_date, tags) VALUES (?, ?, ?, 'pendente', '', ?, ?, ?, ?) RETURNING *"
    ).bind(f.title, f.description, f.priority, t, t, f.due_date, f.tags).first();
    await log(env, actor, `criada #${row.id} [${row.priority}] ${row.title}` + (row.due_date ? ` (prazo ${row.due_date})` : ""));
    return json(row, 201);
  }
  let tid = id(/^\/api\/tasks\/(\d+)$/);
  if (tid && m === "PUT") {
    const before = await getTask(env, tid);
    if (!before) return json({ error: "tarefa não encontrada" }, 404);
    const ch = clean(await req.json(), true);
    if ("status" in ch) ch.completed_at = ch.status === "concluida" ? (before.status === "concluida" ? before.completed_at : now()) : null;
    if (ch.status === "concluida" || ch.status === "bloqueada") ch.run_now = 0;
    ch.updated_at = now();
    const keys = Object.keys(ch);
    const row = await env.DB.prepare(`UPDATE tasks SET ${keys.map(k => `${k} = ?`).join(", ")} WHERE id = ? RETURNING *`)
      .bind(...keys.map(k => ch[k]), tid).first();
    const diff = ["title", "priority", "status", "due_date", "tags"].filter(k => k in ch && (before[k] ?? "") !== (ch[k] ?? "")).map(k => `${k}: '${before[k] ?? ""}' -> '${ch[k] ?? ""}'`);
    const extra = ["description", "result"].filter(k => k in ch && before[k] !== ch[k]);
    if (diff.length || extra.length) await log(env, actor, `editada #${tid}` + (diff.length ? ` (${diff.join(", ")})` : "") + (extra.length ? ` [${extra.join(", ")} alterado]` : ""));
    if (actor === "agente" && ch.status && ch.status !== before.status) {
      if (ch.status === "concluida") pushTask(row, "Tarefa concluída", row.title);
      if (ch.status === "bloqueada") pushTask(row, "O NexCode Agente precisa de você", row.title);
    }
    return json(row);
  }
  if (tid && m === "DELETE") {
    const row = await env.DB.prepare("DELETE FROM tasks WHERE id = ? RETURNING title").bind(tid).first();
    if (!row) return json({ error: "tarefa não encontrada" }, 404);
    await env.DB.batch(["files", "comments", "shares"].map(tb => env.DB.prepare(`DELETE FROM ${tb} WHERE task_id = ?`).bind(tid)));
    await log(env, actor, `excluída #${tid} ${row.title}`);
    return json({ ok: true });
  }

  // --- Fazer agora ---
  tid = id(/^\/api\/tasks\/(\d+)\/run-now$/);
  if (tid && m === "POST") {
    const t = await getTask(env, tid);
    if (!t) return json({ error: "tarefa não encontrada" }, 404);
    const status = t.status === "em_andamento" ? t.status : "pendente";
    const row = await env.DB.prepare("UPDATE tasks SET run_now = 1, status = ?, completed_at = NULL, updated_at = ? WHERE id = ? RETURNING *")
      .bind(status, now(), tid).first();
    await log(env, actor, `fazer agora #${tid} ${t.title}`);
    return json(row);
  }

  // --- Comentários (conversa com o agente) ---
  tid = id(/^\/api\/tasks\/(\d+)\/comments$/);
  if (tid && m === "POST") {
    const t = await getTask(env, tid);
    if (!t) return json({ error: "tarefa não encontrada" }, 404);
    const text = String((await req.json()).text ?? "").trim().slice(0, 4000);
    if (!text) throw new BadRequest("mensagem vazia");
    const author = actor === "agente" ? "agente" : "voce";
    const c = await env.DB.prepare("INSERT INTO comments (task_id, author, text, created_at) VALUES (?, ?, ?, ?) RETURNING *")
      .bind(tid, author, text, now()).first();
    await log(env, actor, `comentário na #${tid}: ${text.slice(0, 120)}`);
    let task = t;
    if (author === "voce" && (t.status === "concluida" || t.status === "bloqueada")) {
      task = await env.DB.prepare("UPDATE tasks SET status = 'pendente', completed_at = NULL, updated_at = ? WHERE id = ? RETURNING *").bind(now(), tid).first();
      await log(env, actor, `reaberta #${tid} pelo comentário`);
    }
    if (author === "agente") pushTask(t, "O NexCode Agente respondeu", `${t.title}: ${text.slice(0, 100)}`);
    return json({ comment: c, task }, 201);
  }

  // --- Compartilhar com cliente ---
  tid = id(/^\/api\/tasks\/(\d+)\/share$/);
  if (tid && m === "POST") {
    if (!(await getTask(env, tid))) return json({ error: "tarefa não encontrada" }, 404);
    let s = await env.DB.prepare("SELECT token FROM shares WHERE task_id = ?").bind(tid).first();
    if (!s) {
      s = { token: b64url(crypto.getRandomValues(new Uint8Array(16))) };
      await env.DB.prepare("INSERT INTO shares (token, task_id, created_at) VALUES (?, ?, ?)").bind(s.token, tid, now()).run();
      await log(env, actor, `link de compartilhamento criado para a #${tid}`);
    }
    return json({ url: `${url.origin}/s/${s.token}` });
  }
  if (tid && m === "DELETE") {
    await env.DB.prepare("DELETE FROM shares WHERE task_id = ?").bind(tid).run();
    await log(env, actor, `link de compartilhamento desativado na #${tid}`);
    return json({ ok: true });
  }

  // --- Arquivos ---
  tid = id(/^\/api\/tasks\/(\d+)\/files$/);
  if (tid && m === "POST") {
    if (!(await getTask(env, tid))) return json({ error: "tarefa não encontrada" }, 404);
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
    const row = await env.DB.prepare("DELETE FROM files WHERE id = ? RETURNING task_id, name").bind(Number(fileMatch[1])).first();
    if (!row) return json({ error: "arquivo não encontrado" }, 404);
    await log(env, actor, `arquivo removido da #${row.task_id}: ${row.name}`);
    return json({ ok: true });
  }

  // --- Sites dos clientes (servidos pelo Worker nexcode a partir do D1) ---
  const siteFile = path.match(/^\/api\/sites\/([a-z0-9][a-z0-9-]{0,60})\/files$/);
  if (siteFile && m === "PUT") {
    const slug = siteFile[1];
    const fp = String(url.searchParams.get("path") || "").replace(/^\/+/, "");
    if (!fp || fp.includes("..") || !/^[A-Za-z0-9._\/-]{1,200}$/.test(fp)) throw new BadRequest("caminho inválido");
    const buf = await req.arrayBuffer();
    if (!buf.byteLength) throw new BadRequest("arquivo vazio");
    if (buf.byteLength > MAX_FILE) return json({ error: "arquivo grande demais (máximo 1,9 MB)" }, 413);
    const ext = fp.toLowerCase().split(".").pop();
    const mime = { html: "text/html; charset=utf-8", css: "text/css; charset=utf-8", js: "text/javascript; charset=utf-8", svg: "image/svg+xml",
      ico: "image/x-icon", woff2: "font/woff2", mp4: "video/mp4" }[ext] || mimeFor(fp);
    await env.DB.prepare(`INSERT INTO site_files (slug, path, mime, size, data, updated_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(slug, path) DO UPDATE SET mime = excluded.mime, size = excluded.size, data = excluded.data, updated_at = excluded.updated_at`)
      .bind(slug, fp, mime, buf.byteLength, buf, now()).run();
    return json({ ok: true, slug, path: fp, size: buf.byteLength }, 201);
  }
  const siteOne = path.match(/^\/api\/sites\/([a-z0-9][a-z0-9-]{0,60})$/);
  if (siteOne && m === "DELETE") {
    await env.DB.prepare("DELETE FROM site_files WHERE slug = ?").bind(siteOne[1]).run();
    await log(env, actor, `site removido: ${siteOne[1]}`);
    return json({ ok: true });
  }
  if (path === "/api/sites" && m === "GET") {
    const { results } = await env.DB.prepare("SELECT slug, COUNT(*) AS files, SUM(size) AS bytes, MAX(updated_at) AS updated_at FROM site_files GROUP BY slug ORDER BY updated_at DESC").all();
    return json(results);
  }
  if (siteOne && m === "POST") { // registra a publicação no histórico
    await log(env, actor, `site publicado: ${siteOne[1]}`);
    return json({ ok: true });
  }

  // --- Repetições ---
  if (path === "/api/recurring" && m === "GET") {
    await runRecurring(env); // garante o resumo semanal e cria o que já venceu
    const { results } = await env.DB.prepare("SELECT * FROM recurring WHERE active = 1 ORDER BY next_run").all();
    return json(results.map(r => ({ ...r, when: describe(r) })));
  }
  if (path === "/api/recurring" && m === "POST") {
    const row = await insertRule(env, cleanRule(await req.json()));
    await log(env, actor, `repetição criada: ${row.title} (${describe(row)})`);
    return json({ ...row, when: describe(row) }, 201);
  }
  const rid = id(/^\/api\/recurring\/(\d+)$/);
  if (rid && m === "DELETE") {
    const row = await env.DB.prepare("DELETE FROM recurring WHERE id = ? RETURNING title").bind(rid).first();
    if (!row) return json({ error: "repetição não encontrada" }, 404);
    await log(env, actor, `repetição removida: ${row.title}`);
    return json({ ok: true });
  }
  const rnow = id(/^\/api\/recurring\/(\d+)\/run$/);
  if (rnow && m === "POST") {
    const rule = await env.DB.prepare("SELECT * FROM recurring WHERE id = ?").bind(rnow).first();
    if (!rule) return json({ error: "repetição não encontrada" }, 404);
    return json(await createFromRule(env, rule), 201);
  }

  // --- Avisos no celular ---
  if (path === "/api/push/key" && m === "GET") return json({ key: (await vapidKeys(env)).pub });
  if (path === "/api/push/subscribe" && m === "POST") {
    const b = await req.json();
    const endpoint = String(b.endpoint || ""), p256dh = String(b.keys?.p256dh || ""), auth = String(b.keys?.auth || "");
    if (!/^https:\/\//.test(endpoint) || !p256dh || !auth) throw new BadRequest("inscrição inválida");
    await env.DB.prepare(`INSERT INTO push_subs (endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth`).bind(endpoint, p256dh, auth, now()).run();
    await log(env, actor, "avisos ativados num aparelho");
    return json({ ok: true }, 201);
  }
  if (path === "/api/push/unsubscribe" && m === "POST") {
    await env.DB.prepare("DELETE FROM push_subs WHERE endpoint = ?").bind(String((await req.json()).endpoint || "")).run();
    return json({ ok: true });
  }
  if (path === "/api/push/test" && m === "POST") {
    return json(await notify(env, url.origin, { title: "Avisos funcionando", body: "Você vai ser avisado quando o NexCode Agente terminar ou precisar de você.", url: "/" }));
  }

  // --- Histórico ---
  if (path === "/api/log" && m === "POST") {
    const msg = String((await req.json()).msg ?? "").trim().slice(0, 2000);
    if (!msg) throw new BadRequest("mensagem vazia");
    await log(env, actor, msg);
    return json({ ok: true }, 201);
  }
  if (path === "/api/log" && m === "GET") {
    const days = Number(url.searchParams.get("days") || 0);
    const { results } = days > 0
      ? await env.DB.prepare("SELECT ts, actor, msg FROM log WHERE ts >= ? ORDER BY id DESC LIMIT 3000")
          .bind(new Date(Date.now() - days * 864e5).toISOString().replace(/\.\d+Z$/, "+00:00")).all()
      : await env.DB.prepare("SELECT ts, actor, msg FROM log ORDER BY id DESC LIMIT 100").all();
    return json(results.map(r => `${r.ts} [${r.actor === "agente" ? "NexCode Agente" : r.actor}] ${r.msg}`));
  }
  return json({ error: "não encontrado" }, 404);
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(HTML, {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "content-security-policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; worker-src 'self'; manifest-src 'self'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; frame-ancestors 'none'",
          "x-content-type-options": "nosniff",
          "referrer-policy": "no-referrer",
        },
      });
    }
    if (url.pathname in STATIC) {
      const [body, type] = STATIC[url.pathname];
      const fresh = url.pathname === "/sw.js" || url.pathname === "/md.js" || url.pathname.endsWith(".webmanifest");
      return new Response(body, { headers: { "content-type": type, "cache-control": fresh ? "no-cache" : "public, max-age=86400" } });
    }
    const share = url.pathname.match(/^\/s\/([A-Za-z0-9_-]{10,40})(?:\/f\/(\d+))?\/?$/);
    if (share && req.method === "GET") return sharePage(env, share[1], share[2] ? Number(share[2]) : null);
    const dl = url.pathname.match(/^\/api\/files\/(\d+)\/download$/);
    if (dl && req.method === "GET") return download(env, url, Number(dl[1]));
    if (url.pathname.startsWith("/api/")) {
      try {
        return await api(req, env, url, ctx);
      } catch (e) {
        if (e instanceof BadRequest || e instanceof SyntaxError) return json({ error: e.message }, 400);
        return json({ error: "erro interno" }, 500);
      }
    }
    return json({ error: "não encontrado" }, 404);
  },
  // Cron da Cloudflare (a cada 10 min): cria as tarefas que se repetem.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runRecurring(env));
  },
};
