// NexCode: serve a página inicial/404 dos arquivos estáticos e cada site de cliente
// a partir do banco D1 (tabela site_files), sem depender do GitHub.
export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const parts = url.pathname.split("/").filter(Boolean);
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
