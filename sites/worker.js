// NexCode: serve a página inicial/404 dos arquivos estáticos e cada site de cliente
// a partir do banco D1 (tabela site_files), sem depender do GitHub.
// Formulários (ex.: inscrição): POST /<site>/_form grava em site_form_entries;
// GET /<site>/_inscritos?k=<token> mostra a lista ao organizador (&csv=1 baixa planilha).
export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length === 2 && /^[a-z0-9][a-z0-9-]{0,60}$/.test(parts[0])) {
      if (parts[1] === "_form" && req.method === "POST") return submitForm(env, req, parts[0]);
      if (parts[1] === "_inscritos" && req.method === "GET") return listEntries(env, url, parts[0]);
    }
    if (!parts.length || req.method !== "GET" && req.method !== "HEAD") return env.ASSETS.fetch(req);
    const slug = parts[0].toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{0,60}$/.test(slug)) return notFound(env, req);
    if (parts.length === 1 && !url.pathname.endsWith("/")) return Response.redirect(`${url.origin}/${slug}/${url.search}`, 301);
    let fp = parts.slice(1).map(decodeURIComponent).join("/");
    if (!fp || url.pathname.endsWith("/")) fp = (fp ? fp + "/" : "") + "index.html";
    let row = await env.DB.prepare("SELECT mime, data, updated_at FROM site_files WHERE slug = ? AND path = ?").bind(slug, fp).first();
    if (!row && !fp.includes(".")) row = await env.DB.prepare("SELECT mime, data, updated_at FROM site_files WHERE slug = ? AND path = ?").bind(slug, fp + "/index.html").first();
    if (!row) return notFound(env, req);
    return new Response(req.method === "HEAD" ? null : new Uint8Array(row.data), { headers: {
      "content-type": row.mime,
      "cache-control": row.mime.startsWith("text/html") ? "public, max-age=60" : "public, max-age=3600",
      "x-content-type-options": "nosniff",
    } });
  },
};

async function notFound(env, req) {
  const r = await env.ASSETS.fetch(new Request(new URL("/404.html", req.url)));
  return new Response(r.body, { status: 404, headers: r.headers });
}

const jsonRes = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});

function cpfOk(v) {
  const d = v.replace(/\D/g, "");
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  for (const n of [9, 10]) {
    let s = 0;
    for (let i = 0; i < n; i++) s += +d[i] * (n + 1 - i);
    if ((s * 10) % 11 % 10 !== +d[n]) return false;
  }
  return true;
}

async function submitForm(env, req, slug) {
  const cfg = await env.DB.prepare("SELECT fields, unique_field, closes_at FROM site_forms WHERE slug = ?").bind(slug).first();
  if (!cfg) return jsonRes({ error: "Formulário não encontrado." }, 404);
  if (cfg.closes_at && Date.now() > Date.parse(cfg.closes_at)) return jsonRes({ error: "As inscrições estão encerradas." }, 403);
  const raw = await req.text();
  if (raw.length > 4000) return jsonRes({ error: "Dados grandes demais." }, 413);
  let body;
  try { body = JSON.parse(raw); } catch { return jsonRes({ error: "Envio inválido." }, 400); }
  if (body && body.website) return jsonRes({ ok: true, id: 0 }); // armadilha para robôs
  const data = {};
  for (const f of JSON.parse(cfg.fields)) {
    let v = String((body && body[f.name]) ?? "").trim().slice(0, 200);
    if (f.type === "cpf" || f.type === "phone") v = v.replace(/\D/g, "");
    if (f.required && !v) return jsonRes({ error: `Preencha: ${f.label}.` }, 400);
    if (v && f.type === "cpf" && !cpfOk(v)) return jsonRes({ error: "CPF inválido. Confira os números." }, 400);
    if (v && f.type === "phone" && (v.length < 10 || v.length > 13)) return jsonRes({ error: "WhatsApp inválido. Use DDD + número." }, 400);
    if (v && f.options && !f.options.includes(v)) return jsonRes({ error: `Escolha uma opção em: ${f.label}.` }, 400);
    data[f.name] = v;
  }
  const uniq = cfg.unique_field ? data[cfg.unique_field] || null : null;
  try {
    const r = await env.DB.prepare("INSERT INTO site_form_entries (slug, data, uniq, created_at) VALUES (?, ?, ?, ?)")
      .bind(slug, JSON.stringify(data), uniq, new Date().toISOString()).run();
    const seq = await env.DB.prepare("SELECT COUNT(*) AS n FROM site_form_entries WHERE slug = ? AND id <= ?").bind(slug, r.meta.last_row_id).first();
    return jsonRes({ ok: true, id: seq.n });
  } catch (e) {
    if (String(e).includes("UNIQUE")) {
      return jsonRes({ error: "Este CPF já está inscrito. Se ainda não pagou, use o Pix abaixo e mande o comprovante.", duplicate: true }, 409);
    }
    throw e;
  }
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function fmt(f, v) {
  if (!v) return "";
  if (f.type === "cpf" && v.length === 11) return `${v.slice(0, 3)}.${v.slice(3, 6)}.${v.slice(6, 9)}-${v.slice(9)}`;
  if (f.type === "phone" && v.length === 11) return `(${v.slice(0, 2)}) ${v.slice(2, 7)}-${v.slice(7)}`;
  return v;
}

const dataBR = (iso) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Fortaleza", dateStyle: "short", timeStyle: "short" });

async function listEntries(env, url, slug) {
  const cfg = await env.DB.prepare("SELECT fields, admin_token, title FROM site_forms WHERE slug = ?").bind(slug).first();
  const k = url.searchParams.get("k") || "";
  if (!cfg || !k || k !== cfg.admin_token) return new Response("Link inválido.", { status: 403, headers: { "content-type": "text/plain; charset=utf-8" } });
  const fields = JSON.parse(cfg.fields);
  const { results } = await env.DB.prepare("SELECT id, data, created_at FROM site_form_entries WHERE slug = ? ORDER BY id").bind(slug).all();
  const rows = results.map((r, i) => ({ id: i + 1, at: r.created_at, d: JSON.parse(r.data) }));
  const noStore = { "cache-control": "no-store", "x-robots-tag": "noindex" };
  if (url.searchParams.get("csv")) {
    const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
    const lines = [["Nº", "Data", ...fields.map((f) => f.label)].map(q).join(";")];
    for (const r of rows) lines.push([r.id, dataBR(r.at), ...fields.map((f) => fmt(f, r.d[f.name]))].map(q).join(";"));
    return new Response("﻿" + lines.join("\r\n"), { headers: { ...noStore,
      "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="inscritos-${slug}.csv"` } });
  }
  const counts = {};
  for (const f of fields.filter((f) => f.options)) {
    counts[f.label] = Object.fromEntries(f.options.map((o) => [o, rows.filter((r) => r.d[f.name] === o).length]));
  }
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Inscritos - ${esc(cfg.title)}</title>
<style>body{margin:0;font:15px/1.45 system-ui,sans-serif;background:#0b0b0c;color:#f2f2f2}main{max-width:1000px;margin:0 auto;padding:24px 16px 48px}h1{font-size:28px;margin:0 0 4px}p{color:#a8a8ad;margin:0 0 16px}
.top{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:18px 0}.n{font-size:40px;font-weight:800;color:#ff6a1a}a.b{background:#ff6a1a;color:#111;font-weight:700;text-decoration:none;padding:12px 16px;border-radius:10px}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:18px}.chip{border:1px solid #2a2a2e;border-radius:999px;padding:6px 12px;color:#ccc}
.wrap{overflow-x:auto;border:1px solid #2a2a2e;border-radius:12px}table{border-collapse:collapse;width:100%;min-width:560px}th,td{padding:10px 12px;text-align:left;border-bottom:1px solid #222}th{color:#a8a8ad;font-weight:600;background:#141416}tr:last-child td{border-bottom:0}</style></head>
<body><main><h1>Inscritos.</h1><p>${esc(cfg.title)} - lista atualizada na hora.</p>
<div class="top"><span class="n">${rows.length}</span><span>inscrições</span><span style="flex:1"></span><a class="b" href="?k=${encodeURIComponent(k)}&csv=1">Baixar planilha</a></div>
${Object.entries(counts).map(([l, c]) => `<div class="chips"><span class="chip">${esc(l)}</span>${Object.entries(c).map(([o, n]) => `<span class="chip">${esc(o)}: ${n}</span>`).join("")}</div>`).join("")}
<div class="wrap"><table><thead><tr><th>Nº</th><th>Data</th>${fields.map((f) => `<th>${esc(f.label)}</th>`).join("")}</tr></thead><tbody>
${rows.length ? rows.map((r) => `<tr><td>${r.id}</td><td>${esc(dataBR(r.at))}</td>${fields.map((f) => `<td>${esc(fmt(f, r.d[f.name]))}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${fields.length + 2}">Nenhuma inscrição ainda.</td></tr>`}
</tbody></table></div></main></body></html>`;
  return new Response(html, { headers: { ...noStore, "content-type": "text/html; charset=utf-8" } });
}
