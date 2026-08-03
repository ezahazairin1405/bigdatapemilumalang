# AI PEMILU

Web app berdiri sendiri: upload PDF terus-menerus (dikelompokkan per tema yang Anda
tentukan sendiri), tanya-jawab per tema (Elaborasi Data), dan analisis peta/grafik
per tema (Infografis) — cakupan pemilu se-Indonesia, bukan cuma Bawaslu Kabupaten Malang.
Login 1 akun admin. Gemini API key diinput & dirotasi dari browser, semua panggilan
Gemini terjadi client-side (sama seperti pola di web pengolahan data).

## 1. Install dependency

```bash
cd ai-pemilu
npm install
npx wrangler login
```

## 2. Buat database D1

```bash
npx wrangler d1 create ai-pemilu-db
```

Salin `database_id` yang muncul, tempel ke `wrangler.jsonc` (ganti
`"GANTI_DENGAN_DATABASE_ID"`).

## 3. Jalankan skema

```bash
npx wrangler d1 execute ai-pemilu-db --file=./schema.sql --remote
# untuk pengembangan lokal juga jalankan tanpa --remote:
npx wrangler d1 execute ai-pemilu-db --file=./schema.sql
```

## 4. Buat akun admin

```bash
node scripts/seed-admin.mjs admin "password_anda"
npx wrangler d1 execute ai-pemilu-db --file=./scripts/seed-admin.sql --remote
npx wrangler d1 execute ai-pemilu-db --file=./scripts/seed-admin.sql   # lokal juga kalau perlu
```

## 5. Deploy

```bash
npx wrangler deploy
```

Buka URL yang diberikan Wrangler → login → mulai pakai. Klik **"Kelola Gemini API
Key"** di sidebar untuk menempelkan satu atau beberapa Gemini API key (disimpan di
browser, dirotasi otomatis kalau satu key kena limit).

## Struktur proyek

```
wrangler.jsonc       konfigurasi Worker + binding D1
schema.sql            skema database
scripts/seed-admin.mjs  bikin akun admin pertama
src/index.js           router utama + login/logout/sesi
src/auth.js            hash password & sesi cookie
src/routes/            handler API: themes, documents, tps, geo (proxy BIG)
public/login.html       halaman login
public/app.html         halaman utama (3 tab)
public/api.js           panggilan ke backend Worker kita sendiri
public/gemini.js        panggilan langsung ke Gemini API + rotasi key
public/app.js           logika UI ketiga tab
```

## Hal-hal yang perlu diverifikasi/disesuaikan sebelum dipakai serius

Beberapa bagian ditandai `[VERIFIKASI]` langsung di kodenya, ringkasannya:

1. **Nama model Gemini** (`public/gemini.js`, `GEMINI_MODEL`) — dicek dulu apakah
   `gemini-2.5-flash` masih model yang aktif/paling sesuai saat Anda membangun ini;
   penamaan model Gemini berubah dari waktu ke waktu.
2. **Field GeoJSON dari BIG** (`src/routes/geo.js`, `getKelurahanBoundaries`) — nama
   field seperti `WADMKK`/`WADMKC`/`WADMKD` adalah konvensi umum data RBI BIG, tapi
   sebaiknya dicek langsung ke endpoint layanannya sebelum dipakai produksi:
   `https://geoservices.big.go.id/rbi/rest/services/BATASWILAYAH/Administrasi_AR_KelDesa_10K/MapServer/0?f=pjson`
3. **Prompt Gemini** di `public/gemini.js` (klasifikasi, tanya-jawab, infografis)
   adalah titik awal yang wajar tapi ada baiknya disesuaikan setelah dicoba dengan
   PDF/contoh pertanyaan asli Anda — terutama bagian ekstraksi tabel suara TPS,
   karena format formulir C1 bisa bervariasi.
4. **Label "Data dokumen" vs "Estimasi AI"** sudah diterapkan konsisten di Tab
   Elaborasi Data (badge di jawaban) dan Tab Infografis (metrik, chart, peta) —
   tapi keakuratan pelabelan itu sepenuhnya bergantung pada Gemini mengikuti aturan
   di prompt, jadi ada baiknya sesekali diperiksa manual.

## Batasan yang disengaja untuk versi pertama ini

- Tab Elaborasi Data mengirim *seluruh* ringkasan dokumen di tema itu sebagai
  konteks ke Gemini setiap kali bertanya — cukup baik untuk tema dengan puluhan
  dokumen, tapi kalau satu tema nanti berisi ratusan dokumen, ringkasannya bisa
  kepanjangan untuk satu prompt dan perlu strategi ringkas tambahan (misal
  ringkasan-dari-ringkasan per tema).
- Peta di Tab Infografis mencocokkan nama kelurahan dari hasil Gemini dengan nama
  kelurahan dari data BIG secara harfiah (huruf besar/kecil diabaikan, tapi typo/
  beda ejaan tidak). Kalau nanti sering meleset, perlu langkah pencocokan yang lebih
  toleran (fuzzy matching).
