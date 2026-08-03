# AI PEMILU

Basis pengetahuan pemilu berdiri sendiri: upload PDF terus-menerus (dikelompokkan
per tema yang ditentukan sendiri oleh admin), lalu tanya-jawab (Elaborasi Data)
dan analisis peta/grafik (Infografis) per tema — cakupan pemilu se-Indonesia.

**Versi ini (v2)** — perubahan besar dari draf pertama:
- Isi PDF diekstrak **teks lengkapnya** (bukan diringkas) pakai pdf.js di
  browser (akurat 100% untuk PDF berbasis teks, karena diambil langsung dari
  lapisan teksnya, bukan "dibaca ulang" oleh AI). Gemini cuma dipakai sebagai
  cadangan kalau PDF-nya hasil scan/gambar (tidak ada lapisan teks).
- Teks lengkap disimpan di **Cloudflare D1 saja** (tidak perlu R2 lagi).
- Saat tanya-jawab/infografis, **semua dokumen di tema itu dikirim utuh**
  langsung dari database ke Gemini — tidak ada langkah "pilih dokumen
  relevan", tidak ada upload-ulang ke Gemini Files API.
- **2 peran akun**: admin (upload & kelola tema) dan user biasa (cuma
  tanya-jawab & infografis) — semua tetap wajib login.
- **Hapus dokumen manual** lewat tombol ✕ di tiap baris — tidak ada lagi
  penghapusan otomatis (baik karena gagal maupun nama file sama).
- Gemini API key tetap diisi sendiri per-browser oleh masing-masing orang
  (disimpan di localStorage), bukan disimpan di server.

## 1. Install & login

```bash
cd ai-pemilu
npm install
npx wrangler login
```

## 2. Database D1

```bash
npx wrangler d1 create ai-pemilu-db
```
Salin `database_id` yang muncul, tempel ke `wrangler.jsonc`.

## 3. Jalankan skema

**Kalau baru mulai dari nol:**
```bash
npx wrangler d1 execute ai-pemilu-db --file=./schema.sql --remote
```

**Kalau melanjutkan dari database yang sudah ada isinya (versi sebelumnya):**
```bash
npx wrangler d1 execute ai-pemilu-db --file=./scripts/migrate-v2.sql --remote
```
Ini menambah kolom `role` (akun lama otomatis jadi admin) dan `full_text` tanpa
menghapus data yang sudah ada. **Tidak perlu bikin R2 bucket lagi** — kalau
sebelumnya sempat dibuat, boleh dibiarkan saja atau dihapus manual dari
dashboard, tidak dipakai oleh kode versi ini.

## 4. Buat akun

```bash
# Admin (bisa upload & kelola tema)
node scripts/seed-admin.mjs admin "password_admin" admin
npx wrangler d1 execute ai-pemilu-db --file=./scripts/seed-admin.sql --remote

# Akun biasa (cuma tanya-jawab & infografis) -- ulangi untuk tiap orang
node scripts/seed-admin.mjs budi "password_budi" user
npx wrangler d1 execute ai-pemilu-db --file=./scripts/seed-admin.sql --remote
```

## 5. Deploy

```bash
npx wrangler deploy
```

Buka URL-nya → login → klik **"Kelola Gemini API Key"** di sidebar (tiap orang
isi key Gemini miliknya sendiri, disimpan di browser masing-masing).

## Struktur proyek

```
wrangler.jsonc          konfigurasi Worker + binding D1
schema.sql               skema database (dari nol)
scripts/migrate-v2.sql    migrasi untuk database yang sudah ada
scripts/seed-admin.mjs    bikin akun (admin/user)
src/index.js              router utama + login/logout/sesi + otorisasi peran
src/auth.js               hash password, sesi cookie, cek peran
src/routes/               handler API: themes, documents, tps, geo (proxy BIG)
public/login.html          halaman login
public/app.html             halaman utama (3 tab, Tab 1 disembunyikan untuk non-admin)
public/api.js                panggilan ke backend Worker kita sendiri
public/gemini.js             ekstraksi teks (pdf.js), tanya-jawab, infografis
public/app.js                 logika UI ketiga tab + peran
```

## Konsekuensi yang perlu diketahui

- **Waktu tunggu jawaban makin lama seiring tema makin banyak dokumennya** --
  karena semua dokumen selalu dikirim utuh tiap kali bertanya (sengaja, sesuai
  keputusan), bukan cuma yang relevan. Kalau nanti dirasa terlalu lambat untuk
  tema tertentu, opsi menambah langkah "pilih dokumen relevan" bisa
  dipertimbangkan lagi belakangan.
- **Ekstraksi tabel lewat pdf.js** cukup baik untuk PDF berbasis teks biasa,
  tapi tabel dengan tata letak sangat kompleks (banyak kolom bertumpuk) kadang
  urutannya masih bisa sedikit meleset -- kalau nanti ditemukan kasus begitu,
  ceritakan contohnya supaya logika rekonstruksi barisnya bisa disempurnakan.
- **Ekstraksi data suara TPS** (untuk Tab Infografis) masih lewat 1 panggilan
  Gemini per dokumen saat upload -- kalau dokumennya tidak berisi tabel suara,
  otomatis dilewati (tidak menggagalkan upload).

## Hal yang perlu diverifikasi

- **Nama model Gemini** (`public/gemini.js`, `GEMINI_MODEL`) -- cek masih
  berlaku terhadap model yang aktif saat ini.
- **Field GeoJSON dari BIG** (`src/routes/geo.js`) -- nama field seperti
  `WADMKK`/`WADMKC`/`WADMKD` sebaiknya dicek ulang ke endpoint resminya.
