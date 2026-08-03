import { json } from "../utils.js";
import { deleteDocumentFile } from "./files.js";

export async function listDocuments(request, env) {
  const url = new URL(request.url);
  const themeId = url.searchParams.get("theme_id");

  let query = `SELECT id, theme_id, original_name, status, summary, extracted_data,
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

export async function createDocument(request, env) {
  const body = await request.json().catch(() => ({}));
  const { theme_id, original_name } = body;
  if (!theme_id || !original_name) {
    return json({ error: "theme_id dan original_name wajib diisi." }, 400);
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

  for (const key of ["status", "summary", "extracted_data", "error_message"]) {
    if (key in body) {
      fields.push(`${key} = ?`);
      binds.push(key === "extracted_data" ? JSON.stringify(body[key]) : body[key]);
    }
  }
  if (!fields.length) return json({ error: "Tidak ada field untuk diupdate." }, 400);

  binds.push(id);
  await env.DB.prepare(
    `UPDATE documents SET ${fields.join(", ")} WHERE id = ?`
  ).bind(...binds).run();

  return json({ success: true });
}

// Dipakai saat klasifikasi PDF gagal -- file gagal tidak perlu tersimpan
// permanen, cukup hilang begitu saja supaya tidak menumpuk di daftar.
export async function deleteDocument(env, id) {
  await env.DB.prepare("DELETE FROM tps_votes WHERE document_id = ?").bind(id).run();
  await env.DB.prepare("DELETE FROM documents WHERE id = ?").bind(id).run();
  await deleteDocumentFile(env, id);
  return json({ success: true });
}
