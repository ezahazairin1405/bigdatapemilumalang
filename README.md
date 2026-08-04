# AI PEMILU

Basis pengetahuan pemilu berdiri sendiri: upload PDF terus-menerus (dikelompokkan
per tema yang ditentukan sendiri oleh admin), lalu tanya-jawab bebas dengan AI
(Elaborasi Data) dan dashboard data suara murni tanpa AI (Infografis) per
tema — cakupan pemilu se-Indonesia.

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
- **Bisa pasang key dari 3 provider AI**: Gemini, OpenRouter, dan **Cloudflare
  Workers AI** (menu "Kelola AI Key"). Workers AI **tidak butuh API key sama
  sekali** -- otomatis pakai akun Cloudflare yang deploy proyek ini, langsung
  siap pakai tanpa setup apa pun. OpenRouter sendiri adalah gerbang ke
  ratusan model dari banyak provider (OpenAI, Anthropic, Google, Meta, dll)
  lewat 1 key, termasuk model gratis. **Alurnya 2 langkah**: (1) pilih 1
  "Provider AI aktif" di sidebar -- tanya-jawab/infografis selalu lewat
  provider itu, tidak otomatis lompat ke provider lain; (2) khusus Gemini &
  OpenRouter (yang butuh key), tiap key punya kuota pemakaian sendiri
  (default 20x, bisa diubah di modal) -- begitu satu key mencapai kuota atau
  kena limit sungguhan dari API, otomatis pindah ke key berikutnya DI
  PROVIDER YANG SAMA. Kalau semua key di provider aktif sudah penuh, muncul
  pesan error yang jelas -- tinggal reset pemakaian key-nya (tombol "Reset"
  di modal) atau ganti provider aktif di sidebar. Pengecualian: transkrip PDF
  hasil scan tetap selalu pakai Gemini (satu-satunya yang mendukung baca PDF
  di alur ini), apa pun provider aktifnya.

## Catatan penting soal 3 provider AI

- **Gemini** -- dipanggil langsung dari browser (mengizinkan CORS). Satu-satunya
  yang dipakai untuk fallback transkrip PDF hasil scan.
- **OpenRouter** -- tidak mengizinkan dipanggil langsung dari browser (kena
  CORS), jadi diteruskan lewat proxy di Worker kita sendiri
  (`src/routes/aiproxy.js`, endpoint `/api/proxy/openrouter`). Key API tetap
  dikirim dari browser Anda tiap pertanyaan (tidak disimpan permanen di
  server) -- Worker cuma meneruskan permintaannya supaya tidak diblokir CORS,
  bukan menyimpan key-nya.
- **Cloudflare Workers AI** -- dipanggil lewat *binding* `env.AI` (bukan API
  key), jadi WAJIB lewat proxy Worker (`/api/proxy/workersai`) -- binding ini
  cuma bisa diakses dari kode Worker, tidak bisa dari browser sama sekali.
  Perlu binding `"ai": {"binding": "AI"}` di `wrangler.jsonc` (sudah
  ditambahkan) -- tidak perlu langkah setup lain, aktif begitu di-deploy.
  Model defaultnya (`@cf/zai-org/glm-4.7-flash`) punya jendela konteks 131 ribu
  token -- lebih kecil dari Gemini/OpenRouter, jadi provider ini paling cocok
  untuk tema yang belum terlalu banyak dokumennya. Cloudflare merilis model
  baru & mempensiunkan yang lama tiap minggu -- cek daftar model teks
  terbaru di developers.cloudflare.com/workers-ai/models kalau model ini
  ternyata sudah tidak aktif.
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

Tidak ada langkah setup tambahan untuk Cloudflare Workers AI -- binding
`"ai"` di `wrangler.jsonc` sudah cukup, langsung aktif begitu di-deploy
(tersedia di plan Workers Free maupun Paid).

Buka URL-nya → login → klik **"Kelola AI Key"** di sidebar. Cloudflare Workers
AI sudah langsung siap pakai tanpa isi apa pun; kalau mau pakai Gemini atau
OpenRouter, tiap orang isi key masing-masing di situ (disimpan di browser
masing-masing).

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
public/app.html             halaman utama (3 tab, Tab Input Data disembunyikan untuk non-admin)
public/api.js                panggilan ke backend Worker kita sendiri
public/gemini.js             ekstraksi teks (pdf.js), AI untuk Tab Elaborasi Data
public/infografis.js          dashboard Tab Infografis -- TANPA AI, murni agregasi data
public/app.js                  logika UI ketiga tab + peran
```

## Konsekuensi yang perlu diketahui

- **Maksimal 15 dokumen per tema** -- ini batas keras (bukan sekadar saran).
  Ditambahkan setelah 1 tema berisi 27 dokumen ternyata gabungan teksnya
  (~1 juta token) sampai kepentok batas jendela konteks maksimal yang
  tersedia gratis di provider mana pun (Gemini maupun OpenRouter). 15 dipilih
  sebagai margin aman berdasarkan rata-rata ukuran dokumen di percobaan itu.
  Kalau tema sudah penuh (badge "PENUH" muncul di header foldernya), upload
  baru akan ditolak dengan pesan jelas -- buat tema baru, atau pindahkan
  beberapa dokumen ke tema lain dulu (lihat poin berikut).
- **Fitur pindah dokumen antar-tema** -- tiap dokumen di Tab Input Data
  sekarang punya dropdown "Pindah ke tema…" di sampingnya, supaya tema yang
  sudah kepenuhan bisa direstrukturisasi jadi beberapa tema lebih kecil tanpa
  perlu hapus dan unggah ulang dari nol (teks yang sudah diekstrak ikut
  pindah, tidak diekstrak ulang).
- **Waktu tunggu jawaban makin lama seiring tema makin banyak dokumennya** --
  karena semua dokumen selalu dikirim utuh tiap kali bertanya (sengaja, sesuai
  keputusan), bukan cuma yang relevan. Kalau nanti dirasa terlalu lambat untuk
  tema tertentu, opsi menambah langkah "pilih dokumen relevan" bisa
  dipertimbangkan lagi belakangan.
- **Ekstraksi tabel lewat pdf.js** cukup baik untuk PDF berbasis teks biasa,
  tapi tabel dengan tata letak sangat kompleks (banyak kolom bertumpuk) kadang
  urutannya masih bisa sedikit meleset -- kalau nanti ditemukan kasus begitu,
  ceritakan contohnya supaya logika rekonstruksi barisnya bisa disempurnakan.
- **Ekstraksi data suara TPS** (dipakai Tab Infografis) lewat 1 panggilan AI
  per dokumen saat upload -- sekarang termasuk rincian **per caleg**, bukan
  cuma total partai (`party_votes` per baris sekarang berbentuk
  `{"Partai A": {"total": 0, "caleg": {"Nama Caleg": 0}}}`, bukan cuma angka
  polos lagi). Kalau dokumennya tidak berisi tabel suara, otomatis dilewati
  (tidak menggagalkan upload). Kalau tidak ada rincian caleg di dokumen
  (cuma total partai), field `caleg` dibiarkan kosong -- Tab Infografis tetap
  jalan, cuma bagian "Profil Caleg"-nya tidak muncul untuk partai itu.
- **Dokumen yang diunggah SEBELUM perubahan ini** cuma punya total partai
  (format lama, angka polos) -- masih terbaca normal di Tab Infografis (total
  partai & wilayah tetap tampil), tapi tidak ada data caleg-nya sampai
  dokumen itu diunggah ulang.
- **Kedalaman drill-down (kecamatan/kelurahan/TPS) mengikuti data dokumennya
  apa adanya** -- kalau dokumen cuma rekap sampai level kecamatan, drill-down
  di Infografis otomatis berhenti di situ (tidak dipaksakan/dikarang sampai
  level kelurahan/TPS).

## Tab Infografis -- murni olah data, TANPA AI

Beda dari Tab Elaborasi Data, Tab Infografis (`public/infografis.js`) sama
sekali **tidak memanggil AI** -- semua angka (total per partai, per caleg, per
kecamatan/kelurahan/TPS) dihitung langsung dari data `tps_votes` yang sudah
tersimpan, murni agregasi JavaScript biasa di browser. Alurnya: Ringkasan
(daftar semua partai, diurutkan dari suara terbanyak) → klik partai → detail
partai (total, profil caleg, sebaran wilayah bisa di-klik untuk expand
kecamatan → kelurahan → TPS) → klik caleg → detail caleg (breakdown wilayah
yang sama, khusus suara caleg itu). Karena tidak ada panggilan AI, tab ini
tidak kena limit/kuota provider AI sama sekali dan hasilnya selalu 100%
sesuai data yang tersimpan (tidak ada risiko salah hitung dari AI).

Tampilan lain yang ada di dashboard referensi (Basis Wilayah top/bottom,
perbandingan vs partai lain, Split Ticket) belum dibangun di versi ini --
menyusul belakangan sesuai kebutuhan & data yang tersedia.

## Hal yang perlu diverifikasi

- **Nama model Gemini** (`public/gemini.js`, `GEMINI_MODEL`) -- cek masih
  berlaku terhadap model yang aktif saat ini.
- **Field GeoJSON dari BIG** (`src/routes/geo.js`) -- nama field seperti
  `WADMKK`/`WADMKC`/`WADMKD` sebaiknya dicek ulang ke endpoint resminya.
