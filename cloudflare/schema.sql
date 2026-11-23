-- Estrutura completa (instalação nova). Para atualizar o banco existente, use migrations/.
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  priority TEXT NOT NULL CHECK (priority IN ('urgente','alta','media','baixa')),
  status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','em_andamento','concluida','bloqueada')),
  result TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  due_date TEXT,
  tags TEXT NOT NULL DEFAULT '',
  run_now INTEGER NOT NULL DEFAULT 0,
  recurring_id INTEGER
);
CREATE TABLE IF NOT EXISTS log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, actor TEXT NOT NULL, msg TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY AUTOINCREMENT, task_id INTEGER NOT NULL, name TEXT NOT NULL, mime TEXT NOT NULL,
  size INTEGER NOT NULL, data BLOB NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS files_task ON files(task_id);
