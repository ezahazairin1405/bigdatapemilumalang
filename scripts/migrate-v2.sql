-- Migrasi dari skema lama ke v2. Jalankan SEKALI di database yang sudah ada
-- isinya (kalau baru mulai dari nol, cukup pakai schema.sql saja, tidak perlu
-- file ini).
--   npx wrangler d1 execute ai-pemilu-db --file=./scripts/migrate-v2.sql --remote

ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user';
-- Akun yang sudah ada (dibuat lewat seed-admin.mjs sebelumnya) dijadikan admin.
UPDATE users SET role = 'admin';

ALTER TABLE documents ADD COLUMN full_text TEXT;
-- Kolom lama (summary, extracted_data) dibiarkan ada tapi tidak dipakai lagi
-- oleh versi baru -- aman diabaikan.
