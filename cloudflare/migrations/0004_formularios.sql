-- 2026-11-24: formulários dos sites de clientes (ex.: inscrição de corrida).
-- site_forms guarda a configuração de cada site; o token do organizador só existe no D1.
CREATE TABLE IF NOT EXISTS site_forms (
  slug TEXT PRIMARY KEY,
  fields TEXT NOT NULL,          -- JSON: [{"name":"cpf","label":"CPF","type":"cpf","required":true}, ...]
  unique_field TEXT,             -- campo que não pode repetir (ex.: cpf)
  closes_at TEXT,                -- ISO UTC; depois disso o formulário recusa envios
  admin_token TEXT NOT NULL,     -- link secreto da lista: /<slug>/_inscritos?k=<token>
  title TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS site_form_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL,
  data TEXT NOT NULL,
  uniq TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS site_form_entries_uniq ON site_form_entries (slug, uniq);
CREATE INDEX IF NOT EXISTS site_form_entries_slug ON site_form_entries (slug, id);
