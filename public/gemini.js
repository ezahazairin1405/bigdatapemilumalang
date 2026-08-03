// Ekstraksi teks dokumen (PDF/Excel/Word) dilakukan di browser lewat library
// masing-masing (pdf.js/SheetJS/Mammoth), BUKAN diketik ulang oleh AI --
// supaya angka di tabel akurat, bukan hasil "baca lalu tulis ulang" yang
// rawan salah ketik.
//
// AI (Gemini/Claude/Groq) dipakai untuk: (1) fallback transkrip kalau PDF
// hasil scan/gambar, (2) ekstrak tabel suara TPS dari teks, (3) menjawab
// pertanyaan di Tab 2/3. Ketiga provider bisa dipasang key-nya sendiri-
// sendiri (menu "Kelola AI Key") -- dicoba berurutan Gemini -> Claude -> Groq,
// pindah ke key/provider berikutnya otomatis kalau satu kena limit.
//
// [VERIFIKASI] Nama model tiap provider di bawah ini sebaiknya dicek ulang
// terhadap model yang aktif saat ini (penamaan model berubah dari waktu ke
// waktu untuk ketiga provider).
const PROVIDERS = [
  { id: "gemini", label: "Gemini", model: "gemini-flash-latest", supportsPdf: true },
  { id: "claude", label: "Claude", model: "claude-sonnet-5", supportsPdf: true },
  { id: "groq", label: "Groq", model: "openai/gpt-oss-120b", supportsPdf: false },
  { id: "grok", label: "Grok (xAI)", model: "grok-4.3", supportsPdf: false },
];

const providerKeys = {
  storageKey(providerId) {
    return `ai_pemilu_keys_${providerId}`;
  },
  list(providerId) {
    try {
      return JSON.parse(localStorage.getItem(providerKeys.storageKey(providerId)) || "[]");
    } catch {
      return [];
    }
  },
  save(providerId, keys) {
    localStorage.setItem(providerKeys.storageKey(providerId), JSON.stringify(keys));
  },
  add(providerId, key) {
    const keys = providerKeys.list(providerId);
    if (!keys.includes(key)) keys.push(key);
    providerKeys.save(providerId, keys);
  },
  remove(providerId, key) {
    providerKeys.save(providerId, providerKeys.list(providerId).filter((k) => k !== key));
  },
};

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
    throw new Error("Gagal membaca hasil JSON dari AI.");
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

// ---------- Pemanggil mentah per provider (menyeragamkan hasil jadi {ok, status, text}) ----------

async function callGeminiRaw(key, model, textPrompt, base64Pdf, json) {
  const parts = base64Pdf
    ? [{ inline_data: { mime_type: "application/pdf", data: base64Pdf } }, { text: textPrompt }]
    : [{ text: textPrompt }];
  const body = {
    contents: [{ role: "user", parts }],
    generationConfig: json ? { responseMimeType: "application/json" } : {},
  };
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
  );
  if (!res.ok) return { ok: false, status: res.status };
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
  return { ok: true, text };
}

// Claude API dipanggil langsung dari browser -- perlu header khusus yang
// memang disediakan Anthropic untuk kebutuhan seperti ini (prototyping
// client-side). Sama seperti Gemini, key-nya ada di browser, bukan server.
async function callClaudeRaw(key, model, textPrompt, base64Pdf) {
  const content = [];
  if (base64Pdf) {
    content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: base64Pdf } });
  }
  content.push({ type: "text", text: textPrompt });

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model,
      max_tokens: 8192,
      messages: [{ role: "user", content }],
    }),
  });
  if (!res.ok) return { ok: false, status: res.status };
  const data = await res.json();
  const text = (data.content || []).map((b) => b.text || "").join("");
  return { ok: true, text };
}

// Format kompatibel OpenAI (Groq & Grok/xAI sama-sama pakai ini) -- teks saja,
// tidak dipakai untuk fallback transkrip PDF hasil scan.
async function callOpenAiCompatibleRaw(baseUrl, key, model, textPrompt, json) {
  const body = { model, messages: [{ role: "user", content: textPrompt }] };
  if (json) body.response_format = { type: "json_object" };

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) return { ok: false, status: res.status };
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || "";
  return { ok: true, text };
}

async function callGroqRaw(key, model, textPrompt, json) {
  return callOpenAiCompatibleRaw("https://api.groq.com/openai/v1", key, model, textPrompt, json);
}

async function callGrokRaw(key, model, textPrompt, json) {
  return callOpenAiCompatibleRaw("https://api.x.ai/v1", key, model, textPrompt, json);
}

// ---------- Pemanggil terpadu: coba semua key yang terpasang, lintas provider ----------
// Urutan: Gemini -> Claude -> Groq. Kalau ada PDF yang perlu dibaca (base64Pdf),
// Groq dilewati (tidak mendukung pembacaan PDF di alur ini).
async function callAI(textPrompt, { json = false, base64Pdf = null } = {}) {
  const attempts = [];
  for (const provider of PROVIDERS) {
    if (base64Pdf && !provider.supportsPdf) continue;
    providerKeys.list(provider.id).forEach((key) => attempts.push({ provider, key }));
  }
  if (!attempts.length) {
    throw new Error("Belum ada AI key yang terpasang. Tambahkan lewat menu 'Kelola AI Key'.");
  }

  let lastError;
  for (let i = 0; i < attempts.length; i++) {
    const { provider, key } = attempts[i];
    if (i > 0) await sleep(1000);

    try {
      let result;
      if (provider.id === "gemini") {
        result = await callGeminiRaw(key, provider.model, textPrompt, base64Pdf, json);
      } else if (provider.id === "claude") {
        result = await callClaudeRaw(key, provider.model, textPrompt, base64Pdf);
      } else if (provider.id === "groq") {
        result = await callGroqRaw(key, provider.model, textPrompt, json);
      } else {
        result = await callGrokRaw(key, provider.model, textPrompt, json);
      }

      if (!result.ok) {
        if ([429, 403, 500, 503, 529].includes(result.status)) {
          lastError = new Error(`${provider.label} (key #${i + 1}) gagal, status ${result.status}.`);
          continue;
        }
        throw new Error(`${provider.label} error ${result.status}.`);
      }

      return json ? safeParseJson(result.text) : result.text;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error("Semua AI key gagal dipakai (kemungkinan semua kena limit kuota).");
}

// ---------- Ekstraksi PDF via pdf.js ----------
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

// Fallback KHUSUS untuk PDF hasil scan/gambar (tidak ada lapisan teks).
async function aiTranscribePdf(file) {
  const base64 = await fileToBase64(file);
  const prompt = `Dokumen ini kemungkinan hasil scan (tidak ada lapisan teks yang bisa diekstrak langsung).
Transkrip SELURUH isi dokumen ini apa adanya, termasuk semua angka di tabel, judul, dan catatan kaki.
Jangan meringkas, jangan menghilangkan bagian apa pun, pertahankan urutan tabel/kolom semirip
mungkin dengan aslinya. Balas HANYA teks transkripnya saja, tanpa komentar tambahan.`;

  return callAI(prompt, { json: false, base64Pdf: base64 });
}

// ---------- Ekstraksi Excel (.xlsx/.xls) pakai SheetJS ----------
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

// ---------- Ekstraksi Word (.docx) pakai Mammoth.js ----------
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

  let fullText = "";
  try {
    fullText = await extractPdfTextViaPdfJs(file);
  } catch {
    fullText = "";
  }

  const isSparse = !fullText || fullText.replace(/\s/g, "").length < 200;
  if (isSparse) {
    fullText = await aiTranscribePdf(file);
  }
  return fullText;
}

// Opsional: ekstrak tabel suara TPS dari teks dokumen -> data terstruktur.
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
    const result = await callAI(prompt, { json: true });
    return Array.isArray(result) ? result : [];
  } catch {
    return [];
  }
}

// --- Tab 2: tanya-jawab, SEMUA dokumen di tema dikirim utuh ---
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

  return callAI(prompt, { json: false });
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

  return callAI(prompt, { json: true });
}
