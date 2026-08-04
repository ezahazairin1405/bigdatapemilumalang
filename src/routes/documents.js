import { json } from "../utils.js";

// Batas ini yang bikin 1 tema tetap muat dikirim utuh ke AI tanpa kena limit
// ukuran konteks (27 dokumen sempat kena batas ~1 juta token -- 15 dokumen
// dipilih sebagai margin aman).
export const MAX_DOCS_PER_THEME = 15;

async function countActiveDocs(env, themeId) {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS c FROM documents WHERE theme_id = ? AND status != 'gagal'"
  ).bind(themeId).first();
  return row?.c || 0;
}

export async function listDocuments(request, env) {
  const url = new URL(request.url);
  const themeId = url.searchParams.get("theme_id");

  let query = `SELECT id, theme_id, original_name, status, full_text,
                      error_message, uploaded_at
               FROM documents`;
  const binds = [];
  if (themeId) {
    query += " WHERE theme_id = ?";
    binds.push(themeId);
  }
  query += " ORDER BY uploaded_at DESC";

  const { results } = await env.DB.prepare(query).bind(...binds).all();
  return json({ documents: results });
}

// Insert dulu (status 'menunggu'), tidak ada lagi pengecekan/hapus otomatis
// untuk nama file yang sama -- duplikat dibiarkan ada, dihapus manual lewat
// tombol hapus kalau memang mau. Tapi DIBATASI maksimal MAX_DOCS_PER_THEME
// dokumen aktif per tema, supaya tema tetap muat dikirim utuh ke AI.
export async function createDocument(request, env) {
  const body = await request.json().catch(() => ({}));
  const { theme_id, original_name } = body;
  if (!theme_id || !original_name) {
    return json({ error: "theme_id dan original_name wajib diisi." }, 400);
  }

  const count = await countActiveDocs(env, theme_id);
  if (count >= MAX_DOCS_PER_THEME) {
    return json({
      error: `Tema ini sudah mencapai batas maksimal ${MAX_DOCS_PER_THEME} dokumen. ` +
        `Buat tema baru, atau pindahkan beberapa dokumen ke tema lain dulu.`,
    }, 400);
  }

  const result = await env.DB.prepare(
    `INSERT INTO documents (theme_id, original_name, status)
     VALUES (?, ?, 'menunggu')`
  ).bind(theme_id, original_name).run();

  return json({ id: result.meta.last_row_id }, 201);
}

export async function updateDocument(request, env, id) {
  const body = await request.json().catch(() => ({}));
  const fields = [];
  const binds = [];

  for (const key of ["status", "full_text", "error_message"]) {
    if (key in body) {
      fields.push(`${key} = ?`);
      binds.push(body[key]);
    }
  }
  if (!fields.length) return json({ error: "Tidak ada field untuk diupdate." }, 400);

  binds.push(id);
  await env.DB.prepare(
    `UPDATE documents SET ${fields.join(", ")} WHERE id = ?`
  ).bind(...binds).run();

  return json({ success: true });
}

// Pindahkan 1 dokumen ke tema lain -- dipakai untuk merapikan tema yang
// sudah kepenuhan (dekat/kena batas MAX_DOCS_PER_THEME) tanpa perlu hapus +
// unggah ulang dari nol.
export async function moveDocument(env, id, newThemeId) {
  if (!newThemeId) return json({ error: "Tema tujuan wajib diisi." }, 400);

  const count = await countActiveDocs(env, newThemeId);
  if (count >= MAX_DOCS_PER_THEME) {
    return json({ error: `Tema tujuan sudah penuh (maksimal ${MAX_DOCS_PER_THEME} dokumen).` }, 400);
  }

  await env.DB.prepare("UPDATE documents SET theme_id = ? WHERE id = ?").bind(newThemeId, id).run();
  return json({ success: true });
}

// Dipanggil HANYA lewat tombol hapus manual di UI -- tidak ada lagi
// penghapusan otomatis oleh sistem (baik karena gagal maupun duplikat nama).
export async function deleteDocument(env, id) {
  await env.DB.prepare("DELETE FROM tps_votes WHERE document_id = ?").bind(id).run();
  await env.DB.prepare("DELETE FROM documents WHERE id = ?").bind(id).run();
  return json({ success: true });
}
