// Semua panggilan Gemini dilakukan langsung dari browser (bukan lewat Worker),
// memakai key yang diinput user sendiri, dengan rotasi otomatis kalau satu
// key kena limit kuota -- pola yang sama seperti web pengolahan data.
//
// Pakai alias resmi Google yang selalu mengarah ke versi Flash stabil
// terbaru (otomatis berpindah tiap Google merilis model baru, dengan
// pemberitahuan 2 minggu sebelum perubahan besar) -- lebih tahan lama
// dibanding menulis nama model versi tertentu yang bisa dipensiunkan.
const GEMINI_MODEL = "gemini-flash-latest";
const GEMINI_ENDPOINT = (model, key) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

const KEY_STORAGE = "ai_pemilu_gemini_keys";

const geminiKeys = {
  list() {
    try {
      return JSON.parse(localStorage.getItem(KEY_STORAGE) || "[]");
    } catch {
      return [];
    }
  },
  save(keys) {
    localStorage.setItem(KEY_STORAGE, JSON.stringify(keys));
  },
  add(key) {
    const keys = geminiKeys.list();
    if (!keys.includes(key)) keys.push(key);
    geminiKeys.save(keys);
  },
  remove(key) {
    geminiKeys.save(geminiKeys.list().filter((k) => k !== key));
  },
};

// Memanggil Gemini generateContent, rotasi ke key berikutnya kalau kena 429 /
// error kuota. `parts` adalah array content parts (teks dan/atau inline PDF).
async function callGemini(parts, { json = false, systemInstruction } = {}) {
  const keys = geminiKeys.list();
  if (!keys.length) {
    throw new Error("Belum ada Gemini API key. Tambahkan lewat menu 'Kelola Gemini API Key'.");
  }

  const body = {
    contents: [{ role: "user", parts }],
    generationConfig: json ? { responseMimeType: "application/json" } : {},
  };
  if (systemInstruction) {
    body.systemInstruction = { parts: [{ text: systemInstruction }] };
  }

  let lastError;
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];

    // Jeda kecil sebelum percobaan ke-2 dst, supaya tidak langsung membombardir
    // API begitu satu key kena limit (mempercepat key lain ikut kena limit juga).
    if (i > 0) await sleep(1200 * i);

    try {
      const res = await fetch(GEMINI_ENDPOINT(GEMINI_MODEL, key), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.status === 429 || res.status === 403 || res.status === 500 || res.status === 503) {
        // Kena limit/kuota/overload sementara -- coba key berikutnya.
        lastError = new Error(`Key #${i + 1} gagal (status ${res.status}).`);
        continue;
      }
      if (res.status === 404) {
        throw new Error(
          `Model "${GEMINI_MODEL}" tidak ditemukan (404). Cek daftar model yang tersedia untuk key ini di ` +
          `https://generativelanguage.googleapis.com/v1beta/models?key=YOUR_KEY, lalu sesuaikan GEMINI_MODEL di gemini.js.`
        );
      }
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Gemini error ${res.status}: ${text.slice(0, 200)}`);
      }

      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
      return json ? safeParseJson(text) : text;
    } catch (err) {
      lastError = err;
      // 404 (nama model salah) akan sama untuk semua key -- tidak perlu diulang.
      if (err.message.includes("tidak ditemukan (404)")) throw err;
    }
  }
  throw lastError || new Error("Semua Gemini API key gagal dipakai (kemungkinan semua kena limit kuota).");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    // Kadang model membungkus JSON dengan ```json ... ``` walau sudah diminta JSON murni.
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]); } catch {}
    }
    throw new Error("Gagal membaca hasil JSON dari Gemini.");
  }
}

async function fileToBase64(file) {
  const buf = await file.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

// --- Tab 1: klasifikasi & ringkasan 1 file PDF, dalam lingkup 1 tema ---
async function geminiClassifyPdf(file, themeName) {
  const base64 = await fileToBase64(file);
  const prompt = `Dokumen ini termasuk dalam tema "${themeName}" (tema sudah ditentukan manusia, JANGAN diubah).
Baca isi PDF ini dan kembalikan JSON dengan struktur persis:
{
  "summary": "ringkasan isi dokumen 3-6 kalimat, bahasa Indonesia",
  "extracted_data": {
    "angka_penting": [ {"label": "...", "nilai": "...", "satuan": "..."} ],
    "catatan": "hal lain yang relevan untuk dianalisis nanti, kalau ada"
  }
}
Kalau dokumen berisi tabel hasil suara per TPS/partai, sertakan juga field "tps_votes" berupa array:
[{"provinsi":"","kabupaten":"","kecamatan":"","kelurahan":"","tps_no":"","party_votes":{"Partai A": 0}}]
Kalau tidak ada data TPS, boleh tidak menyertakan field "tps_votes" sama sekali.
Balas HANYA JSON, tanpa markdown.`;

  return callGemini(
    [
      { inline_data: { mime_type: "application/pdf", data: base64 } },
      { text: prompt },
    ],
    { json: true }
  );
}

// --- Tab 2: tanya-jawab dalam lingkup ringkasan dokumen 1 tema ---
async function geminiAsk(themeName, documentSummaries, question) {
  const context = documentSummaries
    .map((d, i) => `Dokumen ${i + 1} (${d.original_name}): ${d.summary || "(belum diringkas)"}`)
    .join("\n\n");

  const prompt = `Tema: ${themeName}

Konteks dari dokumen-dokumen yang sudah diunggah di tema ini:
${context || "(belum ada dokumen dengan ringkasan)"}

Pertanyaan: ${question}

Jawab berdasarkan konteks di atas dalam bahasa Indonesia. Kalau konteks tidak cukup untuk menjawab, katakan itu terus terang.`;

  return callGemini([{ text: prompt }], { json: false });
}

// --- Tab 3: analisis infografis (data aktual + estimasi AI, untuk chart & peta) ---
async function geminiInfografis(themeName, documentSummaries, tpsRows, question) {
  const context = documentSummaries
    .map((d, i) => `Dokumen ${i + 1} (${d.original_name}): ${d.summary || "(belum diringkas)"}`)
    .join("\n\n");

  const tpsSample = JSON.stringify(tpsRows.slice(0, 200)); // batasi ukuran prompt

  const prompt = `Tema: ${themeName}

Ringkasan dokumen di tema ini:
${context || "(tidak ada)"}

Data suara per TPS yang tersedia (JSON, sebagian bisa terpotong kalau banyak):
${tpsSample || "[]"}

Pertanyaan analitis: ${question}

Susun jawaban sebagai JSON dengan struktur PERSIS:
{
  "narrative": "penjelasan analisis 3-8 kalimat, bahasa Indonesia",
  "metrics": [ {"label": "...", "value": "...", "type": "data"} ],
  "chart": {
    "type": "bar",
    "labels": ["..."],
    "datasets": [ {"label": "...", "data": [0], "type": "data"} ]
  },
  "map_points": [ {"kelurahan": "...", "kecamatan": "...", "kabupaten": "...", "score": 0, "type": "estimasi"} ]
}
ATURAN PENTING:
- Field "type" WAJIB diisi "data" kalau angka itu benar-benar ada di dokumen/data TPS,
  atau "estimasi" kalau itu hasil penalaran/prediksi Anda sendiri (termasuk yang berbasis pola survei).
- Boleh campur "data" dan "estimasi" dalam satu chart/metrics, tapi tiap entri harus jelas jenisnya.
- "map_points.score" adalah angka 0-100 (semakin tinggi = semakin kuat/berpotensi), dipakai untuk mewarnai peta choropleth per kelurahan.
- Kalau tidak relevan menampilkan peta untuk pertanyaan ini, kembalikan "map_points": [].
- Balas HANYA JSON, tanpa markdown.`;

  return callGemini([{ text: prompt }], { json: true });
}
