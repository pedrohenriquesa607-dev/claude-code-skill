-- Só para o banco antigo (as colunas já existem em schema.sql novo). Rodar uma vez.
ALTER TABLE tasks ADD COLUMN due_date TEXT;
ALTER TABLE tasks ADD COLUMN tags TEXT NOT NULL DEFAULT '';
ALTER TABLE tasks ADD COLUMN run_now INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tasks ADD COLUMN recurring_id INTEGER;
