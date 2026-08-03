-- Skema database AI PEMILU
-- Jalankan: npx wrangler d1 execute ai-pemilu-db --file=./schema.sql --remote

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  -- format "saltHex:hashHex", PBKDF2-SHA256 -- sama seperti pola di proyek lain
  password_hash TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS themes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  theme_id INTEGER NOT NULL REFERENCES themes(id),
  original_name TEXT NOT NULL,
  -- menunggu | diproses | selesai | gagal
  status TEXT NOT NULL DEFAULT 'menunggu',
  summary TEXT,          -- ringkasan isi PDF hasil Gemini
  extracted_data TEXT,   -- JSON bebas: angka/tabel penting yang diekstrak
  error_message TEXT,
  uploaded_at TEXT DEFAULT (datetime('now'))
);

-- Data suara per TPS (dari PDF C1 atau tempel Excel), dipakai Tab Infografis
CREATE TABLE IF NOT EXISTS tps_votes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER REFERENCES documents(id),
  theme_id INTEGER NOT NULL REFERENCES themes(id),
  provinsi TEXT,
  kabupaten TEXT,
  kecamatan TEXT,
  kelurahan TEXT,
  tps_no TEXT,
  party_votes TEXT NOT NULL, -- JSON: {"Partai A": 120, "Partai B": 80, ...}
  source TEXT DEFAULT 'pdf', -- 'pdf' | 'paste'
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_documents_theme ON documents(theme_id);
CREATE INDEX IF NOT EXISTS idx_tps_theme ON tps_votes(theme_id);
CREATE INDEX IF NOT EXISTS idx_tps_wilayah ON tps_votes(kabupaten, kecamatan, kelurahan);
