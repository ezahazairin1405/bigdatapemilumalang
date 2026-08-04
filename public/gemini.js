// Ekstraksi teks dokumen (PDF/Excel/Word) dilakukan di browser lewat library
// masing-masing (pdf.js/SheetJS/Mammoth), BUKAN diketik ulang oleh AI --
// supaya angka di tabel akurat, bukan hasil "baca lalu tulis ulang" yang
// rawan salah ketik.
//
// AI (Gemini/OpenRouter/Cloudflare Workers AI) dipakai untuk: (1) fallback
// transkrip kalau PDF hasil scan/gambar, (2) ekstrak tabel suara TPS dari
// teks, (3) menjawab pertanyaan di Tab Infografis & Analisa.
//
// Cara pakainya: pilih 1 PROVIDER AKTIF (lewat sidebar). Gemini & OpenRouter
// butuh API key (bisa lebih dari 1, tiap key dianggap "penuh" setelah
// dipakai sejumlah KUOTA -- default 20x, bisa diubah di menu "Kelola AI Key"
// -- otomatis pindah ke key berikutnya kalau sudah penuh/kena limit).
// **Cloudflare Workers AI TIDAK butuh key sama sekali** -- otomatis pakai
// akun Cloudflare yang deploy proyek ini, jalan langsung tanpa setup apa pun.
// Kalau semua key di provider aktif penuh, perlu direset manual atau pindah
// provider aktif -- tidak otomatis lompat ke provider lain.
// Pengecualian: transkrip PDF hasil scan cuma didukung Gemini, jadi untuk itu
// selalu dipakai Gemini apa pun provider aktifnya.
//
// [VERIFIKASI] Nama model tiap provider di bawah sebaiknya dicek ulang
// terhadap model yang aktif saat ini. Untuk OpenRouter dipakai alias
// "openrouter/free" (router otomatis milik OpenRouter, selalu memilihkan
// model gratis yang tersedia). Untuk Workers AI dipakai
// "@cf/zai-org/glm-4.7-flash" (131K token konteks) -- Cloudflare merilis
// model baru & mempensiunkan yang lama tiap minggu, cek daftar terbaru di
// developers.cloudflare.com/workers-ai/models kalau model ini sudah tidak ada.
const PROVIDERS = [
  { id: "gemini", label: "Gemini", model: "gemini-flash-latest", supportsPdf: true },
  { id: "openrouter", label: "OpenRouter", model: "openrouter/free", supportsPdf: false },
  { id: "workersai", label: "Cloudflare Workers AI", model: "@cf/zai-org/glm-4.7-flash", supportsPdf: false, noKeyNeeded: true },
];

const DEFAULT_QUOTA = 20;

const providerKeys = {
  storageKey(providerId) {
    return `ai_pemilu_keys_${providerId}`;
  },
  quotaStorageKey(providerId) {
    return `ai_pemilu_quota_${providerId}`;
  },
  // Setiap entri: { key: "...", used: 0 }. Data lama (array of string) otomatis
  // dimigrasikan ke bentuk ini saat dibaca.
  list(providerId) {
    try {
      const raw = JSON.parse(localStorage.getItem(providerKeys.storageKey(providerId)) || "[]");
      return raw.map((item) => (typeof item === "string" ? { key: item, used: 0 } : item));
    } catch {
      return [];
    }
  },
  save(providerId, keys) {
    localStorage.setItem(providerKeys.storageKey(providerId), JSON.stringify(keys));
  },
  add(providerId, key) {
    const keys = providerKeys.list(providerId);
    if (!keys.some((k) => k.key === key)) keys.push({ key, used: 0 });
    providerKeys.save(providerId, keys);
  },
  getQuota(providerId) {
    const v = parseInt(localStorage.getItem(providerKeys.quotaStorageKey(providerId)), 10);
    return Number.isFinite(v) && v > 0 ? v : DEFAULT_QUOTA;
  },
  setQuota(providerId, quota) {
    localStorage.setItem(providerKeys.quotaStorageKey(providerId), String(quota));
  },
  incrementUsage(providerId, key) {
    const keys = providerKeys.list(providerId);
    const found = keys.find((k) => k.key === key);
    if (found) found.used += 1;
    providerKeys.save(providerId, keys);
  },
  markFull(providerId, key) {
    const quota = providerKeys.getQuota(providerId);
    const keys = providerKeys.list(providerId);
    const found = keys.find((k) => k.key === key);
    if (found) found.used = quota;
    providerKeys.save(providerId, keys);
  },
  resetUsage(providerId, key) {
    const keys = providerKeys.list(providerId);
    const found = keys.find((k) => k.key === key);
    if (found) found.used = 0;
    providerKeys.save(providerId, keys);
  },
  remove(providerId, key) {
    providerKeys.save(providerId, providerKeys.list(providerId).filter((k) => k.key !== key));
  },
};

// Provider yang sedang aktif dipakai (dipilih manual, bukan otomatis lintas provider).
const activeProvider = {
  storageKey: "ai_pemilu_active_provider",
  get() {
    const v = localStorage.getItem(activeProvider.storageKey);
    return PROVIDERS.some((p) => p.id === v) ? v : PROVIDERS[0].id;
  },
  set(providerId) {
    localStorage.setItem(activeProvider.storageKey, providerId);
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
  const bodyText = await res.text();
  if (!res.ok) return { ok: false, status: res.status, detail: bodyText.slice(0, 400) };
  const data = JSON.parse(bodyText);
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
  return { ok: true, text };
}

// OpenRouter tidak selalu mengizinkan dipanggil langsung dari browser (CORS)
// -- diteruskan lewat proxy di Worker kita sendiri. Key API tetap dikirim
// dari browser tiap request, TIDAK disimpan di server.
async function callOpenRouterRaw(key, model, textPrompt, json) {
  const res = await fetch("/api/proxy/openrouter", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ apiKey: key, model, prompt: textPrompt, json }),
  });
  const bodyText = await res.text();
  if (!res.ok) return { ok: false, status: res.status, detail: bodyText.slice(0, 400) };
  const data = JSON.parse(bodyText);
  const text = data.choices?.[0]?.message?.content || "";
  return { ok: true, text };
}

// Cloudflare Workers AI -- TIDAK butuh API key, dipanggil lewat proxy Worker
// yang meneruskan ke binding env.AI (otomatis pakai akun Cloudflare Anda).
async function callWorkersAiRaw(model, textPrompt) {
  const res = await fetch("/api/proxy/workersai", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, prompt: textPrompt }),
  });
  const bodyText = await res.text();
  if (!res.ok) return { ok: false, status: res.status, detail: bodyText.slice(0, 400) };
  const data = JSON.parse(bodyText);
  return { ok: true, text: data.text || "" };
}

// ---------- Pemanggil terpadu: coba semua key yang terpasang di provider aktif ----------
async function callAI(textPrompt, { json = false, base64Pdf = null } = {}) {
  // Transkrip PDF hasil scan cuma didukung Gemini -- untuk kasus ini selalu
  // pakai Gemini apa pun provider aktifnya. Selain itu, cuma provider aktif
  // yang dicoba (tidak lompat ke provider lain secara otomatis).
  const candidateProviders = base64Pdf
    ? PROVIDERS.filter((p) => p.supportsPdf)
    : [PROVIDERS.find((p) => p.id === activeProvider.get())];

  let lastError;
  let triedAnyKey = false;

  for (const provider of candidateProviders) {
    // Provider tanpa key (Workers AI) -- langsung dipanggil sekali, tidak ada
    // daftar key/kuota untuk diputar.
    if (provider.noKeyNeeded) {
      triedAnyKey = true;
      try {
        const result = await callWorkersAiRaw(provider.model, textPrompt);
        if (!result.ok) {
          lastError = new Error(
            `${provider.label} error ${result.status}${result.detail ? ": " + result.detail : ""}`
          );
          continue;
        }
        return json ? safeParseJson(result.text) : result.text;
      } catch (err) {
        lastError = err;
      }
      continue;
    }

    const quota = providerKeys.getQuota(provider.id);
    const usableKeys = providerKeys.list(provider.id).filter((k) => k.used < quota);

    if (!usableKeys.length) {
      lastError = new Error(
        `Semua key ${provider.label} sudah mencapai kuota pemakaian (${quota}x). ` +
        `Reset lewat menu "Kelola AI Key", atau ganti provider aktif.`
      );
      continue;
    }

    for (let i = 0; i < usableKeys.length; i++) {
      const keyObj = usableKeys[i];
      triedAnyKey = true;
      if (i > 0) await sleep(1000);

      try {
        let result;
        if (provider.id === "gemini") {
          result = await callGeminiRaw(keyObj.key, provider.model, textPrompt, base64Pdf, json);
        } else {
          result = await callOpenRouterRaw(keyObj.key, provider.model, textPrompt, json);
        }

        if (!result.ok) {
          if ([429, 403, 500, 503, 529].includes(result.status)) {
            // Kena limit sungguhan dari API -- tandai key ini penuh (walau
            // penghitung lokalnya belum sampai kuota) supaya lompat ke key
            // berikutnya di provider yang sama.
            providerKeys.markFull(provider.id, keyObj.key);
            lastError = new Error(`${provider.label} (key #${i + 1}) gagal, status ${result.status}.`);
            continue;
          }
          throw new Error(
            `${provider.label} error ${result.status}${result.detail ? ": " + result.detail : ""}`
          );
        }

        providerKeys.incrementUsage(provider.id, keyObj.key);
        return json ? safeParseJson(result.text) : result.text;
      } catch (err) {
        lastError = err;
      }
    }
  }

  if (!triedAnyKey && !lastError) {
    throw new Error("Belum ada AI key yang terpasang. Tambahkan lewat menu 'Kelola AI Key'.");
  }
  throw lastError || new Error("Semua key di provider aktif gagal dipakai.");
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

// --- Infografis & Analisa: tanya bebas ATAU analitis, SEMUA dokumen di tema dikirim utuh ---
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

Pertanyaan: ${question}

Susun jawaban sebagai JSON dengan struktur PERSIS:
{
  "narrative": "jawaban lengkap dalam bahasa Indonesia -- boleh cuma penjelasan teks biasa kalau pertanyaannya bersifat umum/faktual, atau disertai analisis kalau pertanyaannya analitis",
  "metrics": [ {"label": "...", "value": "...", "type": "data"} ],
  "chart": {
    "type": "bar",
    "labels": ["..."],
    "datasets": [ {"label": "...", "data": [0], "type": "data"} ]
  },
  "map_points": [ {"kelurahan": "...", "kecamatan": "...", "kabupaten": "...", "score": 0, "type": "estimasi"} ]
}
ATURAN PENTING:
- Kalau pertanyaannya cuma butuh jawaban teks biasa (bukan data angka/wilayah), cukup isi
  "narrative" dengan lengkap dan kembalikan "metrics": [], "chart": {"labels": [], "datasets": []},
  "map_points": [] -- jangan dipaksakan bikin chart/peta kalau memang tidak relevan.
- Field "type" WAJIB diisi "data" kalau angka itu benar-benar ada di dokumen/data TPS,
  atau "estimasi" kalau itu hasil penalaran/prediksi Anda sendiri (termasuk yang berbasis pola survei).
- Boleh campur "data" dan "estimasi" dalam satu chart/metrics, tapi tiap entri harus jelas jenisnya.
- "map_points.score" adalah angka 0-100 (semakin tinggi = semakin kuat/berpotensi), dipakai untuk mewarnai peta choropleth per kelurahan.
- Balas HANYA JSON, tanpa markdown.`;

  return callAI(prompt, { json: true });
}
