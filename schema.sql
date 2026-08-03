-- Skema database AI PEMILU (v2 -- teks lengkap disimpan di D1, tanpa R2,
-- ada peran akun admin/user).
-- Jalankan: npx wrangler d1 execute ai-pemilu-db --file=./schema.sql --remote

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  -- format "saltHex:hashHex", PBKDF2-SHA256
  password_hash TEXT NOT NULL,
  -- 'admin' bisa upload & kelola tema; 'user' cuma tanya-jawab & infografis
  role TEXT NOT NULL DEFAULT 'user',
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

-- full_text: teks lengkap hasil ekstraksi PDF (pdf.js di browser, atau
-- transkrip Gemini kalau PDF hasil scan tanpa lapisan teks) -- TIDAK
-- diringkas/dipotong, dipakai utuh saat tanya-jawab/infografis.
CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  theme_id INTEGER NOT NULL REFERENCES themes(id),
  original_name TEXT NOT NULL,
  -- menunggu | diproses | selesai | gagal
  status TEXT NOT NULL DEFAULT 'menunggu',
  full_text TEXT,
  error_message TEXT,
  uploaded_at TEXT DEFAULT (datetime('now'))
);

-- Data suara per TPS (diekstrak dari full_text oleh Gemini, atau tempel Excel),
-- dipakai Tab Infografis.
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
