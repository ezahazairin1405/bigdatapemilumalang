// Tab Infografis: TIDAK memanggil AI sama sekali. Semua angka di sini dihitung
// langsung dari data tps_votes yang sudah tersimpan (hasil ekstraksi AI saat
// upload di Tab Input Data) -- murni agregasi/matematika biasa di browser.

function normalizePartyEntry(raw) {
  if (raw == null) return null;
  if (typeof raw === "number") return { total: raw, caleg: {} };
  return { total: raw.total || 0, caleg: raw.caleg || {} };
}

function computePartyTotals(rows) {
  const totals = {};
  rows.forEach((row) => {
    Object.entries(row.party_votes || {}).forEach(([party, raw]) => {
      const entry = normalizePartyEntry(raw);
      if (!entry) return;
      totals[party] = (totals[party] || 0) + entry.total;
    });
  });
  return Object.entries(totals)
    .map(([name, total]) => ({ name, total }))
    .sort((a, b) => b.total - a.total);
}

function computeCalegTotals(rows, party) {
  const totals = {};
  rows.forEach((row) => {
    const entry = normalizePartyEntry((row.party_votes || {})[party]);
    if (!entry) return;
    Object.entries(entry.caleg).forEach(([caleg, v]) => {
      totals[caleg] = (totals[caleg] || 0) + v;
    });
  });
  return Object.entries(totals)
    .map(([name, total]) => ({ name, total }))
    .sort((a, b) => b.total - a.total);
}

function valueForParty(party) {
  return (row) => {
    const entry = normalizePartyEntry((row.party_votes || {})[party]);
    return entry ? entry.total : 0;
  };
}

function valueForCaleg(party, caleg) {
  return (row) => {
    const entry = normalizePartyEntry((row.party_votes || {})[party]);
    return entry ? entry.caleg[caleg] || 0 : 0;
  };
}

// Susun pohon kecamatan -> kelurahan -> TPS. Level kelurahan/TPS otomatis
// kosong kalau memang tidak ada di data (dokumen cuma rekap sampai kecamatan).
function buildRegionTree(rows, valueFn) {
  const tree = {};
  rows.forEach((row) => {
    const v = valueFn(row);
    if (!v) return;
    const kec = row.kecamatan || "(kecamatan tidak diketahui)";
    if (!tree[kec]) tree[kec] = { total: 0, kelurahan: {} };
    tree[kec].total += v;

    if (row.kelurahan) {
      const kel = row.kelurahan;
      if (!tree[kec].kelurahan[kel]) tree[kec].kelurahan[kel] = { total: 0, tps: {} };
      tree[kec].kelurahan[kel].total += v;

      if (row.tps_no) {
        tree[kec].kelurahan[kel].tps[row.tps_no] = (tree[kec].kelurahan[kel].tps[row.tps_no] || 0) + v;
      }
    }
  });
  return tree;
}

// ================= State & alur tampilan =================
let igRows = [];
let igView = { level: "summary" };

function setupInfografisDashboard() {
  const select = document.getElementById("infografisThemeSelect");
  const empty = document.getElementById("infografisEmpty");
  const body = document.getElementById("infografisBody");

  select.addEventListener("change", async () => {
    const themeId = select.value;
    if (!themeId) { empty.style.display = "block"; body.style.display = "none"; return; }
    igRows = await api.listTpsVotes(themeId);
    empty.style.display = "none";
    body.style.display = "block";
    igGoTo({ level: "summary" });
  });
}

function igGoTo(view) {
  igView = view;
  igRenderBreadcrumb();
  igRender();
}

function igRenderBreadcrumb() {
  const el = document.getElementById("infografisBreadcrumb");
  const segs = [];
  if (igView.level === "summary") {
    segs.push(`<span class="current">Ringkasan</span>`);
  } else {
    segs.push(`<button data-lvl="summary">Ringkasan</button>`);
    segs.push(`<span class="sep">/</span>`);
    if (igView.level === "party") {
      segs.push(`<span class="current">${escapeHtml(igView.party)}</span>`);
    } else {
      segs.push(`<button data-lvl="party">${escapeHtml(igView.party)}</button>`);
      segs.push(`<span class="sep">/</span>`);
      segs.push(`<span class="current">${escapeHtml(igView.caleg)}</span>`);
    }
  }
  el.innerHTML = segs.join(" ");
  el.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.dataset.lvl === "summary") igGoTo({ level: "summary" });
      else igGoTo({ level: "party", party: igView.party });
    });
  });
}

function igRender() {
  const container = document.getElementById("infografisContent");
  if (!igRows.length) {
    container.innerHTML = `<div class="empty-hint">Belum ada data suara TPS di tema ini. Bagian ini otomatis terisi kalau dokumen yang diunggah berisi tabel hasil suara per partai/caleg.</div>`;
    return;
  }
  if (igView.level === "summary") igRenderSummary(container);
  else if (igView.level === "party") igRenderParty(container, igView.party);
  else igRenderCaleg(container, igView.party, igView.caleg);
}

function igRenderSummary(container) {
  const totals = computePartyTotals(igRows);
  const grand = totals.reduce((s, p) => s + p.total, 0) || 1;

  container.innerHTML = `<div class="ig-section-title">Ringkasan per Partai</div><div class="ig-party-list" id="igPartyList"></div>`;
  const list = document.getElementById("igPartyList");

  totals.forEach((p, i) => {
    const pct = ((p.total / grand) * 100).toFixed(1);
    const card = document.createElement("button");
    card.className = "ig-party-card";
    card.innerHTML = `
      <span class="rank">#${i + 1}</span>
      <span class="name">${escapeHtml(p.name)}</span>
      <span class="ig-bar-track"><span class="ig-bar-fill" style="width:${pct}%;"></span></span>
      <span class="pct">${pct}%</span>
      <span class="votes">${p.total.toLocaleString("id-ID")}</span>
    `;
    card.addEventListener("click", () => igGoTo({ level: "party", party: p.name }));
    list.appendChild(card);
  });
}

function igRenderParty(container, party) {
  const totals = computePartyTotals(igRows);
  const partyTotal = totals.find((p) => p.name === party)?.total || 0;
  const calegTotals = computeCalegTotals(igRows, party);
  const tree = buildRegionTree(igRows, valueForParty(party));

  container.innerHTML = `
    <div class="metric-row">
      <div class="metric-card"><div class="value">${partyTotal.toLocaleString("id-ID")}</div><div class="label">Total suara ${escapeHtml(party)}</div></div>
      <div class="metric-card"><div class="value">${Object.keys(tree).length}</div><div class="label">Kecamatan tercatat</div></div>
      <div class="metric-card"><div class="value">${calegTotals.length}</div><div class="label">Caleg tercatat</div></div>
    </div>
    ${calegTotals.length ? `<div class="ig-section-title">Profil Caleg</div><div class="ig-caleg-list" id="igCalegList"></div>` : ""}
    <div class="ig-section-title">Sebaran Wilayah</div>
    <div class="ig-tree" id="igRegionTree"></div>
  `;

  if (calegTotals.length) {
    const list = document.getElementById("igCalegList");
    calegTotals.forEach((c, i) => {
      const row = document.createElement("button");
      row.className = "ig-caleg-row";
      row.innerHTML = `<span class="rank">#${i + 1}</span><span class="name">${escapeHtml(c.name)}</span><span class="votes">${c.total.toLocaleString("id-ID")}</span>`;
      row.addEventListener("click", () => igGoTo({ level: "caleg", party, caleg: c.name }));
      list.appendChild(row);
    });
  }

  igRenderRegionTree(document.getElementById("igRegionTree"), tree);
}

function igRenderCaleg(container, party, caleg) {
  const calegTotals = computeCalegTotals(igRows, party);
  const calegTotal = calegTotals.find((c) => c.name === caleg)?.total || 0;
  const tree = buildRegionTree(igRows, valueForCaleg(party, caleg));

  container.innerHTML = `
    <div class="metric-row">
      <div class="metric-card"><div class="value">${calegTotal.toLocaleString("id-ID")}</div><div class="label">Total suara ${escapeHtml(caleg)}</div></div>
      <div class="metric-card"><div class="value">${escapeHtml(party)}</div><div class="label">Partai</div></div>
      <div class="metric-card"><div class="value">${Object.keys(tree).length}</div><div class="label">Kecamatan tercatat</div></div>
    </div>
    <div class="ig-section-title">Sebaran Wilayah</div>
    <div class="ig-tree" id="igRegionTree"></div>
  `;
  igRenderRegionTree(document.getElementById("igRegionTree"), tree);
}

function igRenderRegionTree(container, tree) {
  container.innerHTML = "";
  const kecEntries = Object.entries(tree).sort((a, b) => b[1].total - a[1].total);
  if (!kecEntries.length) {
    container.innerHTML = `<div class="empty-hint">Belum ada rincian wilayah untuk ini.</div>`;
    return;
  }

  kecEntries.forEach(([kecName, kecData]) => {
    const hasKelurahan = Object.keys(kecData.kelurahan).length > 0;
    const node = document.createElement("div");
    node.className = "ig-tree-node";

    const header = document.createElement("button");
    header.className = "ig-tree-header";
    header.innerHTML = `<span class="chevron">${hasKelurahan ? "▸" : "•"}</span><span class="name">${escapeHtml(kecName)}</span><span class="votes">${kecData.total.toLocaleString("id-ID")}</span>`;

    const bodyEl = document.createElement("div");
    bodyEl.className = "ig-tree-body";

    if (hasKelurahan) {
      const kelEntries = Object.entries(kecData.kelurahan).sort((a, b) => b[1].total - a[1].total);
      kelEntries.forEach(([kelName, kelData]) => {
        const hasTps = Object.keys(kelData.tps).length > 0;
        if (!hasTps) {
          const leaf = document.createElement("div");
          leaf.className = "ig-leaf";
          leaf.innerHTML = `<span>${escapeHtml(kelName)}</span><span>${kelData.total.toLocaleString("id-ID")}</span>`;
          bodyEl.appendChild(leaf);
          return;
        }
        const subNode = document.createElement("div");
        subNode.className = "ig-tree-node";
        subNode.style.marginBottom = "4px";
        const subHeader = document.createElement("button");
        subHeader.className = "ig-tree-header";
        subHeader.innerHTML = `<span class="chevron">▸</span><span class="name">${escapeHtml(kelName)}</span><span class="votes">${kelData.total.toLocaleString("id-ID")}</span>`;
        const subBody = document.createElement("div");
        subBody.className = "ig-tree-body";
        Object.entries(kelData.tps)
          .sort((a, b) => b[1] - a[1])
          .forEach(([tpsNo, v]) => {
            const leaf = document.createElement("div");
            leaf.className = "ig-leaf";
            leaf.innerHTML = `<span>TPS ${escapeHtml(tpsNo)}</span><span>${v.toLocaleString("id-ID")}</span>`;
            subBody.appendChild(leaf);
          });
        subHeader.addEventListener("click", () => {
          const open = subBody.style.display === "block";
          subBody.style.display = open ? "none" : "block";
          subHeader.querySelector(".chevron").textContent = open ? "▸" : "▾";
        });
        subNode.appendChild(subHeader);
        subNode.appendChild(subBody);
        bodyEl.appendChild(subNode);
      });
    }

    header.addEventListener("click", () => {
      if (!hasKelurahan) return;
      const open = bodyEl.style.display === "block";
      bodyEl.style.display = open ? "none" : "block";
      header.querySelector(".chevron").textContent = open ? "▸" : "▾";
    });

    node.appendChild(header);
    node.appendChild(bodyEl);
    container.appendChild(node);
  });
}
