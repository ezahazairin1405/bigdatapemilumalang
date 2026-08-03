// Ekstraksi teks PDF dilakukan di browser pakai pdf.js (library resmi Mozilla),
// BUKAN diketik ulang oleh Gemini -- supaya angka di tabel akurat 100% (persis
// dari lapisan teks PDF-nya), bukan hasil "baca lalu tulis ulang" AI yang rawan
// salah ketik untuk dokumen berisi banyak angka.
// Gemini cuma dipakai untuk: (1) fallback transkrip kalau PDF ternyata hasil
// scan/gambar (tidak ada lapisan teks), (2) ekstrak tabel suara TPS dari teks
// yang sudah didapat, (3) menjawab pertanyaan di Tab 2/3.
//
// [VERIFIKASI] Nama model di bawah ini sebaiknya dicek ulang terhadap model
// Gemini yang aktif saat ini.
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
    if (i > 0) await sleep(1200 * i);

    try {
      const res = await fetch(GEMINI_ENDPOINT(GEMINI_MODEL, key), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.status === 429 || res.status === 403 || res.status === 500 || res.status === 503) {
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
    const match = text.match(/[\{\[][\s\S]*[\}\]]/);
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

// --- Ekstraksi teks PDF pakai pdf.js, dengan rekonstruksi baris berdasarkan
// posisi (Y lalu X) supaya tabel tidak berantakan urutan kata/angkanya. ---
async function extractPdfTextViaPdfJs(file) {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  let fullText = "";

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();

    const items = content.items.map((it) => ({
      text: it.str,
      x: it.transform[4],
      y: it.transform[5],
    }));

    const lineTolerance = 2;
    const lines = [];
    items.forEach((it) => {
      let line = lines.find((l) => Math.abs(l.y - it.y) < lineTolerance);
      if (!line) { line = { y: it.y, items: [] }; lines.push(line); }
      line.items.push(it);
    });
    lines.sort((a, b) => b.y - a.y);

    const pageText = lines
      .map((l) => l.items.sort((a, b) => a.x - b.x).map((it) => it.text).join(" "))
      .join("\n");

    fullText += `\n--- Halaman ${pageNum} ---\n${pageText}`;
  }

  return fullText.trim();
}

// Fallback KHUSUS untuk PDF hasil scan/gambar (tidak ada lapisan teks sama
// sekali) -- baru di sini Gemini dipakai untuk transkrip, karena memang tidak
// ada cara lain membaca teksnya.
async function geminiTranscribePdf(file) {
  const base64 = await fileToBase64(file);
  const prompt = `Dokumen ini kemungkinan hasil scan (tidak ada lapisan teks yang bisa diekstrak langsung).
Transkrip SELURUH isi dokumen ini apa adanya, termasuk semua angka di tabel, judul, dan catatan kaki.
Jangan meringkas, jangan menghilangkan bagian apa pun, pertahankan urutan tabel/kolom semirip
mungkin dengan aslinya. Balas HANYA teks transkripnya saja, tanpa komentar tambahan.`;

  return callGemini(
    [
      { inline_data: { mime_type: "application/pdf", data: base64 } },
      { text: prompt },
    ],
    { json: false }
  );
}

// --- Ekstraksi Excel (.xlsx/.xls) pakai SheetJS -- datanya sudah rapi per
// sel/baris, jadi ini malah LEBIH andal daripada PDF untuk tabel suara TPS.
async function extractExcelText(file) {
  const buf = await file.arrayBuffer();
  const workbook = XLSX.read(buf, { type: "array" });
  let fullText = "";
  workbook.SheetNames.forEach((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
    fullText += `\n--- Sheet: ${sheetName} ---\n${csv}`;
  });
  return fullText.trim();
}

// --- Ekstraksi Word (.docx) pakai Mammoth.js -- HANYA format .docx modern,
// file .doc lama (format Word 97-2003) tidak didukung.
async function extractWordText(file) {
  const buf = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer: buf });
  return (result.value || "").trim();
}

// Fungsi utama dipanggil dari Tab 1: ekstrak teks LENGKAP (bukan ringkasan),
// bercabang sesuai jenis file.
async function extractDocumentText(file) {
  const name = file.name.toLowerCase();

  if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
    return await extractExcelText(file);
  }
  if (name.endsWith(".docx")) {
    return await extractWordText(file);
  }
  if (name.endsWith(".doc")) {
    throw new Error('Format ".doc" (Word lama) tidak didukung -- simpan ulang sebagai ".docx" dulu.');
  }

  // Default: PDF.
  let fullText = "";
  try {
    fullText = await extractPdfTextViaPdfJs(file);
  } catch {
    fullText = "";
  }

  const isSparse = !fullText || fullText.replace(/\s/g, "").length < 200;
  if (isSparse) {
    fullText = await geminiTranscribePdf(file);
  }
  return fullText;
}

// Opsional: kalau teks dokumen mengandung tabel suara per TPS, ekstrak jadi
// data terstruktur untuk Tab Infografis. Gagal/tidak relevan -> array kosong,
// tidak menggagalkan keseluruhan proses upload.
async function geminiExtractTpsVotes(fullText, themeNameValue) {
  const prompt = `Tema: ${themeNameValue}

Berikut isi teks lengkap sebuah dokumen pemilu:
"""
${fullText.slice(0, 150000)}
"""

Kalau dokumen ini berisi tabel hasil suara per TPS dan/atau per partai, ekstrak jadi JSON array
dengan struktur persis:
[{"provinsi":"","kabupaten":"","kecamatan":"","kelurahan":"","tps_no":"","party_votes":{"Partai A": 0}}]
Kalau TIDAK ada data semacam itu di dokumen ini, balas array kosong: []
Balas HANYA JSON array tersebut, tanpa markdown apa pun.`;

  try {
    const result = await callGemini([{ text: prompt }], { json: true });
    return Array.isArray(result) ? result : [];
  } catch {
    return [];
  }
}

// --- Tab 2: tanya-jawab, SEMUA dokumen di tema dikirim utuh (bukan ringkasan,
// bukan pilih-pilih relevansi) ---
async function geminiAsk(themeNameValue, documents, question) {
  const context = documents
    .filter((d) => d.full_text)
    .map((d) => `=== Dokumen: ${d.original_name} ===\n${d.full_text}`)
    .join("\n\n");

  const prompt = `Tema: ${themeNameValue}

Berikut seluruh isi dokumen yang tersedia di tema ini (teks lengkap, bukan ringkasan):

${context || "(belum ada dokumen dengan isi yang berhasil diekstrak)"}

Pertanyaan: ${question}

Jawab dalam bahasa Indonesia berdasarkan isi dokumen di atas secara rinci dan akurat, termasuk
angka-angka spesifik kalau ditanya. Kalau informasi tidak ditemukan di dokumen manapun di atas,
katakan terus terang bagian mana yang tidak tersedia.`;

  return callGemini([{ text: prompt }], { json: false });
}

// --- Tab 3: analisis infografis (data aktual + estimasi AI, untuk chart & peta) ---
async function geminiInfografis(themeNameValue, documents, tpsRows, question) {
  const context = documents
    .filter((d) => d.full_text)
    .map((d) => `=== Dokumen: ${d.original_name} ===\n${d.full_text}`)
    .join("\n\n");

  const tpsSample = JSON.stringify(tpsRows);

  const prompt = `Tema: ${themeNameValue}

Seluruh isi dokumen di tema ini (teks lengkap):
${context || "(tidak ada)"}

Data suara per TPS yang tersedia (JSON):
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
