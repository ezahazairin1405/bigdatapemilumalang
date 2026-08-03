// ================= Sesi & navigasi dasar =================
let currentUser = null;
let themesCache = [];

(async function init() {
  const session = await api.session();
  if (!session.authenticated) {
    window.location.href = "/login.html";
    return;
  }
  currentUser = session.username;
  document.getElementById("userChip").textContent = currentUser;

  document.getElementById("logoutBtn").addEventListener("click", async () => {
    await api.logout();
    window.location.href = "/login.html";
  });

  setupTabs();
  setupKeyModal();
  await refreshThemes();
  setupTab1();
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

// ================= Modal Gemini API key =================
function setupKeyModal() {
  const overlay = document.getElementById("keyModalOverlay");
  const openBtn = document.getElementById("geminiKeyBtn");
  const closeBtn = document.getElementById("closeKeyModal");
  const addBtn = document.getElementById("addKeyBtn");
  const input = document.getElementById("newKeyInput");

  function renderKeys() {
    const list = document.getElementById("keyList");
    const keys = geminiKeys.list();
    list.innerHTML = "";
    if (!keys.length) {
      list.innerHTML = `<div style="color:var(--text-muted);font-size:0.8rem;">Belum ada key.</div>`;
      return;
    }
    keys.forEach((k) => {
      const row = document.createElement("div");
      row.style.cssText = "display:flex;align-items:center;gap:8px;background:var(--panel-2);border:1px solid var(--border);border-radius:6px;padding:6px 10px;";
      const masked = k.length > 8 ? `${k.slice(0, 4)}••••${k.slice(-4)}` : "••••";
      row.innerHTML = `<span style="flex:1;font-size:0.78rem;">${masked}</span>`;
      const del = document.createElement("button");
      del.textContent = "Hapus";
      del.className = "btn btn-danger";
      del.style.cssText = "padding:3px 8px;font-size:0.7rem;";
      del.addEventListener("click", () => { geminiKeys.remove(k); renderKeys(); });
      row.appendChild(del);
      list.appendChild(row);
    });
  }

  openBtn.addEventListener("click", () => { renderKeys(); overlay.style.display = "flex"; });
  closeBtn.addEventListener("click", () => { overlay.style.display = "none"; });
  addBtn.addEventListener("click", () => {
    const val = input.value.trim();
    if (val) { geminiKeys.add(val); input.value = ""; renderKeys(); }
  });
}

// ================= Tema (dipakai bersama semua tab) =================
async function refreshThemes() {
  themesCache = await api.listThemes();
  const options = themesCache
    .map((t) => `<option value="${t.id}">${escapeHtml(t.name)} (${t.document_count})</option>`)
    .join("");

  for (const id of ["themeSelect", "elaborasiThemeSelect", "infografisThemeSelect"]) {
    const el = document.getElementById(id);
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

// ================= TAB 1: Input Data =================
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
    if (!themeId) { alert("Pilih atau buat tema dulu sebelum mengunggah PDF."); return; }
    const pdfs = files.filter((f) => f.type === "application/pdf");
    if (!pdfs.length) { alert("Hanya file PDF yang didukung."); return; }
    pdfs.forEach((file) => enqueueFile(file, themeId));
  }

  let queueBusy = false;
  const queue = [];

  function enqueueFile(file, themeId) {
    const row = document.createElement("div");
    row.className = "queue-item";
    row.innerHTML = `<span class="name">${escapeHtml(file.name)}</span><span class="status-pill status-menunggu">menunggu</span>`;
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
    }
    queueBusy = false;
    await renderThemeGroups();
  }

  async function processOne({ file, themeId, row }) {
    setStatus(row, "diproses");
    const created = await api.createDocument(themeId, file.name);
    if (created.error) { setStatus(row, "gagal", "gagal simpan"); return; }
    const docId = created.id;

    try {
      const result = await geminiClassifyPdf(file, themeName(themeId));
      await api.updateDocument(docId, {
        status: "selesai",
        summary: result.summary || "",
        extracted_data: result.extracted_data || {},
      });
      if (Array.isArray(result.tps_votes) && result.tps_votes.length) {
        await api.saveTpsVotes(themeId, docId, "pdf", result.tps_votes);
      }
      setStatus(row, "selesai");
    } catch (err) {
      await api.updateDocument(docId, { status: "gagal", error_message: err.message });
      setStatus(row, "gagal", "gagal");
    }
  }

  renderThemeGroups();
  themeSelect.addEventListener("change", renderThemeGroups);
}

async function renderThemeGroups() {
  const container = document.getElementById("themeGroups");
  container.innerHTML = "";
  for (const theme of themesCache) {
    const docs = await api.listDocuments(theme.id);
    if (!docs.length) continue;
    const group = document.createElement("div");
    group.className = "theme-group";
    group.innerHTML = `<h3>${escapeHtml(theme.name)} <span class="mono" style="color:var(--text-muted);font-size:0.75rem;">(${docs.length} dokumen)</span></h3>`;
    docs.forEach((d) => {
      const card = document.createElement("div");
      card.className = "doc-card";
      card.innerHTML = `
        <div class="fname">${escapeHtml(d.original_name)} — <span class="status-pill status-${d.status}">${d.status}</span></div>
        ${d.summary ? `<div class="summary">${escapeHtml(d.summary)}</div>` : ""}
      `;
      group.appendChild(card);
    });
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
    const loading = addMsg(messages, "bot", "Menganalisis dokumen…");

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
    resultEl.innerHTML = `<div class="empty-hint">Menganalisis…</div>`;

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

  // --- metrik ---
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

  // --- chart ---
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

  // --- peta choropleth kelurahan ---
  renderMap(result.map_points || []);
}

async function renderMap(points) {
  const container = document.getElementById("mapContainer");
  if (!points.length) { container.style.display = "none"; return; }
  container.style.display = "block";

  if (!leafletMap) {
    leafletMap = L.map("mapContainer").setView([-2.5, 118], 5); // pusat Indonesia
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap",
    }).addTo(leafletMap);
  }
  if (leafletLayer) { leafletMap.removeLayer(leafletLayer); }

  // Ambil boundary per pasangan kabupaten+kecamatan unik yang muncul di hasil analisis.
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
    // [VERIFIKASI] nama field kelurahan pada data BIG -- lihat catatan di src/routes/geo.js
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
