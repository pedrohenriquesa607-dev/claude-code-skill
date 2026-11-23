-- 2026-11-23: sites dos clientes guardados no D1 (publicados sem depender do GitHub)
CREATE TABLE IF NOT EXISTS site_files (slug TEXT NOT NULL, path TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, data BLOB NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (slug, path));
