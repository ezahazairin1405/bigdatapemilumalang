// ================= Sesi & navigasi dasar =================
let currentUser = null;
let currentRole = null;
let themesCache = [];

(async function init() {
  const session = await api.session();
  if (!session.authenticated) {
    window.location.href = "/login.html";
    return;
  }
  currentUser = session.username;
  currentRole = session.role;
  document.getElementById("userChip").textContent = `${currentUser} (${currentRole})`;

  // Tab Input Data cuma untuk admin.
  if (currentRole !== "admin") {
    const inputTabBtn = document.querySelector('.tab-btn[data-tab="input"]');
    if (inputTabBtn) inputTabBtn.remove();
    document.getElementById("tab-input")?.remove();
    // Kalau tab aktif defaultnya input, pindah ke Elaborasi.
    document.querySelector('.tab-btn[data-tab="elaborasi"]')?.classList.add("active");
    document.getElementById("tab-elaborasi")?.classList.add("active");
  }

  document.getElementById("logoutBtn").addEventListener("click", async () => {
    await api.logout();
    window.location.href = "/login.html";
  });

  setupTabs();
  setupKeyModal();
  setupProviderSelect();
  await refreshThemes();
  if (currentRole === "admin") setupTab1();
  setupTab2();
  setupTab3();
})();

function setupTabs() {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");
    });
  });
}

// ================= Provider AI aktif =================
function setupProviderSelect() {
  const select = document.getElementById("activeProviderSelect");
  select.innerHTML = PROVIDERS.map(
    (p) => `<option value="${p.id}">${p.label}</option>`
  ).join("");
  select.value = activeProvider.get();
  select.addEventListener("change", () => activeProvider.set(select.value));
}

// ================= Modal Gemini API key =================
function setupKeyModal() {
  const overlay = document.getElementById("keyModalOverlay");
  const openBtn = document.getElementById("geminiKeyBtn");
  const closeBtn = document.getElementById("closeKeyModal");
  const container = document.getElementById("providerKeySections");

  const providerHints = {
    gemini: "Model: " + PROVIDERS.find((p) => p.id === "gemini").model + " · aistudio.google.com",
    openrouter: "Model: " + PROVIDERS.find((p) => p.id === "openrouter").model + " · openrouter.ai/keys (teks saja, tidak baca PDF scan)",
  };

  function renderAll() {
    container.innerHTML = "";
    PROVIDERS.forEach((provider) => {
      const section = document.createElement("div");
      section.className = "provider-section";
      section.innerHTML = `
        <h3>${provider.label}</h3>
        <p class="phint">${providerHints[provider.id] || ""}</p>
        <div class="quota-row">
          Kuota per key:
          <input type="number" class="pkey-quota" min="1" value="${providerKeys.getQuota(provider.id)}" />
          kali pakai sebelum otomatis pindah ke key berikutnya
        </div>
        <div style="display:flex;gap:8px;margin-bottom:8px;">
          <input type="text" class="pkey-input" placeholder="Tempel ${provider.label} API key…" style="flex:1;" />
          <button class="btn btn-primary pkey-add">Tambah</button>
        </div>
        <div class="pkey-list mono"></div>
      `;

      const input = section.querySelector(".pkey-input");
      const addBtn = section.querySelector(".pkey-add");
      const list = section.querySelector(".pkey-list");
      const quotaInput = section.querySelector(".pkey-quota");

      function renderKeys() {
        const quota = providerKeys.getQuota(provider.id);
        const keys = providerKeys.list(provider.id);
        list.innerHTML = "";
        if (!keys.length) {
          list.innerHTML = `<div style="color:var(--text-muted);font-size:0.78rem;">Belum ada key.</div>`;
          return;
        }
        keys.forEach((k) => {
          const row = document.createElement("div");
          row.className = "provider-key-row";
          const masked = k.key.length > 8 ? `${k.key.slice(0, 4)}••••${k.key.slice(-4)}` : "••••";
          const full = k.used >= quota;
          row.innerHTML = `
            <span>${masked}</span>
            <span class="usage-badge ${full ? "usage-full" : "usage-ok"}">${k.used}/${quota}${full ? " · penuh" : ""}</span>
          `;
          const resetBtn = document.createElement("button");
          resetBtn.textContent = "Reset";
          resetBtn.className = "btn btn-ghost";
          resetBtn.style.cssText = "padding:3px 8px;font-size:0.7rem;";
          resetBtn.addEventListener("click", () => { providerKeys.resetUsage(provider.id, k.key); renderKeys(); });
          const del = document.createElement("button");
          del.textContent = "Hapus";
          del.className = "btn btn-danger";
          del.style.cssText = "padding:3px 8px;font-size:0.7rem;";
          del.addEventListener("click", () => { providerKeys.remove(provider.id, k.key); renderKeys(); });
          row.appendChild(resetBtn);
          row.appendChild(del);
          list.appendChild(row);
        });
      }

      quotaInput.addEventListener("change", () => {
        const val = parseInt(quotaInput.value, 10);
        if (val > 0) { providerKeys.setQuota(provider.id, val); renderKeys(); }
      });

      addBtn.addEventListener("click", () => {
        const val = input.value.trim();
        if (val) { providerKeys.add(provider.id, val); input.value = ""; renderKeys(); }
      });

      renderKeys();
      container.appendChild(section);
    });
  }

  openBtn.addEventListener("click", () => { renderAll(); overlay.style.display = "flex"; });
  closeBtn.addEventListener("click", () => { overlay.style.display = "none"; });
}

// ================= Tema (dipakai bersama semua tab) =================
async function refreshThemes() {
  themesCache = await api.listThemes();
  const options = themesCache
    .map((t) => `<option value="${t.id}">${escapeHtml(t.name)} (${t.document_count}/15${t.document_count >= 15 ? " · PENUH" : ""})</option>`)
    .join("");

  for (const id of ["themeSelect", "elaborasiThemeSelect", "infografisThemeSelect"]) {
    const el = document.getElementById(id);
    if (!el) continue;
    const current = el.value;
    el.innerHTML = `<option value="">— Pilih tema —</option>` + options;
    if (current) el.value = current;
  }
}

function escapeHtml(s) {
  return (s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function themeName(id) {
  const t = themesCache.find((t) => String(t.id) === String(id));
  return t ? t.name : "(tema tidak dikenal)";
}

// ================= TAB 1: Input Data (khusus admin) =================
function setupTab1() {
  const dropzone = document.getElementById("dropzone");
  const fileInput = document.getElementById("fileInput");
  const themeSelect = document.getElementById("themeSelect");
  const queueList = document.getElementById("queueList");

  document.getElementById("createThemeBtn").addEventListener("click", async () => {
    const input = document.getElementById("newThemeInput");
    const name = input.value.trim();
    if (!name) return;
    const res = await api.createTheme(name);
    if (res.error) { alert(res.error); return; }
    input.value = "";
    await refreshThemes();
    themeSelect.value = res.theme.id;
    await renderThemeGroups();
  });

  dropzone.addEventListener("click", () => fileInput.click());
  dropzone.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") fileInput.click(); });
  ["dragover", "dragenter"].forEach((ev) => dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.add("drag"); }));
  ["dragleave", "drop"].forEach((ev) => dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.remove("drag"); }));
  dropzone.addEventListener("drop", (e) => handleFiles([...e.dataTransfer.files]));
  fileInput.addEventListener("change", () => handleFiles([...fileInput.files]));

  function handleFiles(files) {
    const themeId = themeSelect.value;
    if (!themeId) { alert("Pilih atau buat tema dulu sebelum mengunggah dokumen."); return; }
    const allowed = /\.(pdf|xlsx|xls|docx)$/i;
    const validFiles = files.filter((f) => allowed.test(f.name));
    if (!validFiles.length) {
      alert("Hanya file PDF, Excel (.xlsx/.xls), atau Word (.docx) yang didukung.");
      return;
    }
    validFiles.forEach((file) => enqueueFile(file, themeId));
  }

  let queueBusy = false;
  const queue = [];

  function enqueueFile(file, themeId) {
    const row = document.createElement("div");
    row.className = "queue-item";
    row.innerHTML = `
      <span class="name">${escapeHtml(file.name)}</span>
      <span class="status-pill status-menunggu">menunggu</span>
      <button class="row-delete" title="Hapus dari antrian">✕</button>
    `;
    row.querySelector(".row-delete").addEventListener("click", () => row.remove());
    queueList.prepend(row);
    queue.push({ file, themeId, row });
    processQueue();
  }

  function setStatus(row, status, text) {
    const pill = row.querySelector(".status-pill");
    pill.className = `status-pill status-${status}`;
    pill.textContent = text || status;
  }

  async function processQueue() {
    if (queueBusy) return;
    queueBusy = true;
    while (queue.length) {
      const item = queue.shift();
      await processOne(item);
      if (queue.length) await new Promise((r) => setTimeout(r, 1500));
    }
    queueBusy = false;
    await refreshThemes();
    await renderThemeGroups();
  }

  async function processOne({ file, themeId, row }) {
    setStatus(row, "diproses");
    const created = await api.createDocument(themeId, file.name);
    if (created.error) { setStatus(row, "gagal", created.error.slice(0, 60)); return; }
    const docId = created.id;

    try {
      const fullText = await extractDocumentText(file);
      await api.updateDocument(docId, { status: "selesai", full_text: fullText });

      // Ekstrak data suara TPS kalau ada -- tidak menggagalkan upload kalau kosong.
      const tpsRows = await geminiExtractTpsVotes(fullText, themeName(themeId));
      if (tpsRows.length) {
        await api.saveTpsVotes(themeId, docId, "pdf", tpsRows);
      }
      setStatus(row, "selesai");
    } catch (err) {
      // TIDAK dihapus otomatis lagi -- tetap tercatat status gagal, dihapus
      // manual lewat tombol ✕ kalau memang mau, bisa juga diunggah ulang.
      await api.updateDocument(docId, { status: "gagal", error_message: err.message });
      setStatus(row, "gagal", "gagal — " + err.message.slice(0, 40));
    }
  }

  renderThemeGroups();
  themeSelect.addEventListener("change", renderThemeGroups);
}

async function renderThemeGroups() {
  const container = document.getElementById("themeGroups");
  if (!container) return;
  container.innerHTML = "";
  for (const theme of themesCache) {
    const group = document.createElement("div");
    group.className = "theme-group";

    const header = document.createElement("button");
    header.className = "theme-group-header";
    header.innerHTML = `
      <span class="chevron">▸</span>
      <span class="tname">${escapeHtml(theme.name)}</span>
      <span class="mono count">${theme.document_count}/15 dokumen</span>${theme.document_count >= 15 ? '<span class="usage-badge usage-full" style="margin-left:6px;">PENUH</span>' : ""}
    `;

    const body = document.createElement("div");
    body.className = "theme-group-body";
    body.style.display = "none";

    let loaded = false;
    async function loadDocs() {
      body.innerHTML = `<div class="empty-hint">Memuat…</div>`;
      const docs = await api.listDocuments(theme.id);
      body.innerHTML = "";
      const otherThemes = themesCache.filter((t) => t.id !== theme.id);
      const moveOptions = otherThemes
        .map((t) => `<option value="${t.id}">${escapeHtml(t.name)} (${t.document_count}/15)</option>`)
        .join("");

      docs.forEach((d) => {
        const card = document.createElement("div");
        card.className = "doc-card";
        card.innerHTML = `
          <div class="doc-card-row">
            <div class="fname">${escapeHtml(d.original_name)} — <span class="status-pill status-${d.status}">${d.status}</span></div>
            <select class="move-select" style="font-size:0.72rem;padding:3px 6px;">
              <option value="">Pindah ke tema…</option>
              ${moveOptions}
            </select>
            <button class="row-delete" title="Hapus dokumen ini">✕</button>
          </div>
          ${d.error_message ? `<div class="summary" style="color:var(--danger);">${escapeHtml(d.error_message)}</div>` : ""}
          ${d.full_text ? `<div class="summary">${escapeHtml(d.full_text.slice(0, 220))}${d.full_text.length > 220 ? "…" : ""}</div>` : ""}
        `;
        card.querySelector(".move-select").addEventListener("change", async (e) => {
          const newThemeId = e.target.value;
          if (!newThemeId) return;
          const res = await api.moveDocument(d.id, newThemeId);
          if (res.error) { alert(res.error); e.target.value = ""; return; }
          await refreshThemes();
          await renderThemeGroups();
        });
        card.querySelector(".row-delete").addEventListener("click", async () => {
          if (!confirm(`Hapus "${d.original_name}" secara permanen?`)) return;
          await api.deleteDocument(d.id);
          await refreshThemes();
          await renderThemeGroups();
        });
        body.appendChild(card);
      });
      loaded = true;
    }

    header.addEventListener("click", async () => {
      const isOpen = body.style.display !== "none";
      if (isOpen) {
        body.style.display = "none";
        header.querySelector(".chevron").textContent = "▸";
        return;
      }
      header.querySelector(".chevron").textContent = "▾";
      body.style.display = "block";
      if (!loaded) await loadDocs();
    });

    group.appendChild(header);
    group.appendChild(body);
    container.appendChild(group);
  }
}

// ================= TAB 2: Elaborasi Data =================
function setupTab2() {
  const select = document.getElementById("elaborasiThemeSelect");
  const empty = document.getElementById("elaborasiEmpty");
  const chatBox = document.getElementById("elaborasiChat");
  const messages = document.getElementById("elaborasiMessages");
  const form = document.getElementById("elaborasiForm");
  let activeThemeId = null;
  let activeDocs = [];

  select.addEventListener("change", async () => {
    activeThemeId = select.value;
    if (!activeThemeId) { empty.style.display = "block"; chatBox.style.display = "none"; return; }
    activeDocs = await api.listDocuments(activeThemeId);
    empty.style.display = "none";
    chatBox.style.display = "block";
    messages.innerHTML = `<div class="msg bot">Siap menjawab soal tema "${escapeHtml(themeName(activeThemeId))}" (${activeDocs.length} dokumen).</div>`;
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = document.getElementById("elaborasiInput");
    const question = input.value.trim();
    if (!question || !activeThemeId) return;
    addMsg(messages, "user", escapeHtml(question));
    input.value = "";
    const loading = addMsg(messages, "bot", "Membaca seluruh dokumen di tema ini…");

    try {
      const answer = await geminiAsk(themeName(activeThemeId), activeDocs, question);
      loading.innerHTML = escapeHtml(answer).replace(/\n/g, "<br>");
    } catch (err) {
      loading.textContent = "Gagal: " + err.message;
    }
  });
}

function addMsg(container, role, html) {
  const div = document.createElement("div");
  div.className = "msg " + role;
  div.innerHTML = html;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  return div;
}

// ================= TAB 3: Infografis =================
let leafletMap = null;
let leafletLayer = null;
let currentChart = null;

function setupTab3() {
  const select = document.getElementById("infografisThemeSelect");
  const empty = document.getElementById("infografisEmpty");
  const body = document.getElementById("infografisBody");
  const form = document.getElementById("infografisForm");
  let activeThemeId = null;
  let activeDocs = [];
  let activeTps = [];

  select.addEventListener("change", async () => {
    activeThemeId = select.value;
    if (!activeThemeId) { empty.style.display = "block"; body.style.display = "none"; return; }
    [activeDocs, activeTps] = await Promise.all([
      api.listDocuments(activeThemeId),
      api.listTpsVotes(activeThemeId),
    ]);
    empty.style.display = "none";
    body.style.display = "block";
    document.getElementById("infografisResult").innerHTML = "";
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = document.getElementById("infografisInput");
    const question = input.value.trim();
    if (!question || !activeThemeId) return;

    const resultEl = document.getElementById("infografisResult");
    resultEl.innerHTML = `<div class="empty-hint">Membaca seluruh dokumen & menganalisis…</div>`;

    try {
      const result = await geminiInfografis(themeName(activeThemeId), activeDocs, activeTps, question);
      renderInfografis(result);
    } catch (err) {
      resultEl.innerHTML = `<div class="empty-hint" style="color:var(--danger);">Gagal: ${escapeHtml(err.message)}</div>`;
    }
  });
}

function renderInfografis(result) {
  const resultEl = document.getElementById("infografisResult");
  resultEl.innerHTML = `
    <p style="line-height:1.6;">${escapeHtml(result.narrative || "")}</p>
    <div class="metric-row" id="metricRow"></div>
    <div id="mapContainer"></div>
    <div id="chartContainer"><canvas id="infografisChart" height="90"></canvas></div>
  `;

  const metricRow = document.getElementById("metricRow");
  (result.metrics || []).forEach((m) => {
    const card = document.createElement("div");
    card.className = "metric-card";
    const badge = m.type === "estimasi"
      ? `<span class="badge badge-ai"><span class="badge-dot"></span>Estimasi AI</span>`
      : `<span class="badge badge-data"><span class="badge-dot"></span>Data dokumen</span>`;
    card.innerHTML = `<div class="value">${escapeHtml(String(m.value))}</div><div class="label">${escapeHtml(m.label)}</div>${badge}`;
    metricRow.appendChild(card);
  });

  const chartData = result.chart;
  if (chartData && chartData.labels && chartData.labels.length) {
    const ctx = document.getElementById("infografisChart");
    if (currentChart) currentChart.destroy();
    currentChart = new Chart(ctx, {
      type: chartData.type || "bar",
      data: {
        labels: chartData.labels,
        datasets: (chartData.datasets || []).map((ds) => ({
          label: ds.label + (ds.type === "estimasi" ? " (estimasi AI)" : " (data)"),
          data: ds.data,
          backgroundColor: ds.type === "estimasi" ? "#E8A23D" : "#33D6C0",
        })),
      },
      options: {
        plugins: { legend: { labels: { color: "#EDEFF7" } } },
        scales: {
          x: { ticks: { color: "#8890B0" }, grid: { color: "#2E3760" } },
          y: { ticks: { color: "#8890B0" }, grid: { color: "#2E3760" } },
        },
      },
    });
  } else {
    document.getElementById("chartContainer").style.display = "none";
  }

  renderMap(result.map_points || []);
}

async function renderMap(points) {
  const container = document.getElementById("mapContainer");
  if (!points.length) { container.style.display = "none"; return; }
  container.style.display = "block";

  if (!leafletMap) {
    leafletMap = L.map("mapContainer").setView([-2.5, 118], 5);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap",
    }).addTo(leafletMap);
  }
  if (leafletLayer) { leafletMap.removeLayer(leafletLayer); }

  const pairs = [...new Map(points.map((p) => [`${p.kabupaten}|${p.kecamatan}`, p])).values()];
  const allFeatures = [];

  for (const p of pairs) {
    if (!p.kabupaten && !p.kecamatan) continue;
    try {
      const geo = await api.kelurahanBoundaries({ kabupaten: p.kabupaten, kecamatan: p.kecamatan });
      if (geo.features) allFeatures.push(...geo.features);
    } catch {
      // lewati kalau layanan BIG gagal untuk wilayah ini
    }
  }

  function scoreFor(feature) {
    const nameFromBig = (feature.properties?.WADMKD || feature.properties?.NAMOBJ || "").toLowerCase().trim();
    const match = points.find((p) => (p.kelurahan || "").toLowerCase().trim() === nameFromBig);
    return match || null;
  }

  leafletLayer = L.geoJSON({ type: "FeatureCollection", features: allFeatures }, {
    style: (feature) => {
      const match = scoreFor(feature);
      const score = match ? match.score : 0;
      return {
        fillColor: score >= 66 ? "#E8A23D" : score >= 33 ? "#33D6C0" : "#2E3760",
        fillOpacity: 0.55,
        color: "#1B2140",
        weight: 1,
      };
    },
    onEachFeature: (feature, layer) => {
      const match = scoreFor(feature);
      if (match) {
        const badge = match.type === "estimasi" ? "Estimasi AI" : "Data dokumen";
        layer.bindPopup(`<b>${escapeHtml(match.kelurahan || "")}</b><br>Skor: ${match.score} · ${badge}`);
      }
    },
  }).addTo(leafletMap);

  if (allFeatures.length) {
    leafletMap.fitBounds(leafletLayer.getBounds(), { maxZoom: 12 });
  }
}
