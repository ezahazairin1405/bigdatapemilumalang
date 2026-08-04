# AI PEMILU

Basis pengetahuan pemilu berdiri sendiri: upload PDF terus-menerus (dikelompokkan
per tema yang ditentukan sendiri oleh admin), lalu tanya-jawab (Elaborasi Data)
dan analisis peta/grafik (Infografis) per tema — cakupan pemilu se-Indonesia.

**Versi ini (v2)** — perubahan besar dari draf pertama:
- Isi PDF diekstrak **teks lengkapnya** (bukan diringkas) pakai pdf.js di
  browser (akurat 100% untuk PDF berbasis teks, karena diambil langsung dari
  lapisan teksnya, bukan "dibaca ulang" oleh AI). Gemini cuma dipakai sebagai
  cadangan kalau PDF-nya hasil scan/gambar (tidak ada lapisan teks).
- **Excel (.xlsx/.xls) dan Word (.docx) juga didukung** -- Excel diekstrak
  pakai SheetJS (malah lebih andal dari PDF untuk tabel, karena datanya sudah
  rapi per sel), Word diekstrak pakai Mammoth.js. Format `.doc` lama (Word
  97-2003) tidak didukung, perlu disimpan ulang sebagai `.docx` dulu.
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
- **Bisa pasang key dari 2 provider AI**: Gemini dan OpenRouter (menu "Kelola
  AI Key"). OpenRouter sendiri adalah gerbang ke ratusan model dari banyak
  provider (OpenAI, Anthropic, Google, Meta, dll) lewat 1 key, termasuk model
  gratis (akhiran `:free` di nama modelnya). **Alurnya 2 langkah**: (1) pilih
  1 "Provider AI aktif" di sidebar -- tanya-jawab/infografis selalu lewat
  provider itu, tidak otomatis lompat ke provider lain; (2) di provider aktif
  itu, tiap key punya kuota pemakaian sendiri (default 20x, bisa diubah di
  modal) -- begitu satu key mencapai kuota atau kena limit sungguhan dari API,
  otomatis pindah ke key berikutnya DI PROVIDER YANG SAMA. Kalau semua key di
  provider aktif sudah penuh, muncul pesan error yang jelas -- tinggal reset
  pemakaian key-nya (tombol "Reset" di modal) atau ganti provider aktif di
  sidebar. Pengecualian: transkrip PDF hasil scan tetap selalu pakai Gemini
  (satu-satunya yang mendukung baca PDF di alur ini), apa pun provider
  aktifnya.

## Catatan penting soal 2 provider AI

- **Gemini** -- dipanggil langsung dari browser (mengizinkan CORS). Satu-satunya
  yang dipakai untuk fallback transkrip PDF hasil scan.
- **OpenRouter** -- tidak mengizinkan dipanggil langsung dari browser (kena
  CORS), jadi diteruskan lewat proxy di Worker kita sendiri
  (`src/routes/aiproxy.js`, endpoint `/api/proxy/openrouter`). Key API tetap
  dikirim dari browser Anda tiap pertanyaan (tidak disimpan permanen di
  server) -- Worker cuma meneruskan permintaannya supaya tidak diblokir CORS,
  bukan menyimpan key-nya.
- **Model OpenRouter pakai alias `openrouter/free`** -- ini router otomatis
  milik OpenRouter sendiri, bukan 1 model tertentu, jadi tetap jalan walau
  daftar model gratis mereka sering berganti-ganti (sempat kena masalah ini
  di percobaan pertama pakai nama model spesifik). Kalau suatu saat ingin
  model tertentu yang lebih terjamin kualitasnya, cek openrouter.ai/models
  dan ganti nilai `model` untuk provider `openrouter` di `public/gemini.js`.
- Kalau mau kapasitas yang benar-benar bertambah (bukan cuma "kelihatan" ada
  banyak key), pastikan key Gemini/OpenRouter Anda masing-masing dari **akun
  yang benar-benar berbeda** -- kuota dihitung per akun/project, bukan per key.


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
