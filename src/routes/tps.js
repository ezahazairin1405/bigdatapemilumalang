import { json } from "../utils.js";

// body: { theme_id, document_id?, source: 'pdf'|'paste', rows: [
//   { provinsi, kabupaten, kecamatan, kelurahan, tps_no, party_votes: {A:120,B:80} }
// ] }
export async function saveTpsVotes(request, env) {
  const body = await request.json().catch(() => ({}));
  const { theme_id, document_id, source, rows } = body;

  if (!theme_id || !Array.isArray(rows) || !rows.length) {
    return json({ error: "theme_id dan rows wajib diisi." }, 400);
  }

  const stmt = env.DB.prepare(
    `INSERT INTO tps_votes
     (document_id, theme_id, provinsi, kabupaten, kecamatan, kelurahan, tps_no, party_votes, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const batch = rows.map((r) =>
    stmt.bind(
      document_id || null,
      theme_id,
      r.provinsi || null,
      r.kabupaten || null,
      r.kecamatan || null,
      r.kelurahan || null,
      r.tps_no || null,
      JSON.stringify(r.party_votes || {}),
      source || "pdf"
    )
  );

  await env.DB.batch(batch);
  return json({ inserted: rows.length }, 201);
}

export async function listTpsVotes(request, env) {
  const url = new URL(request.url);
  const themeId = url.searchParams.get("theme_id");
  if (!themeId) return json({ error: "theme_id wajib diisi." }, 400);

  const { results } = await env.DB.prepare(
    `SELECT id, document_id, provinsi, kabupaten, kecamatan, kelurahan, tps_no,
            party_votes, source, created_at
     FROM tps_votes WHERE theme_id = ?
     ORDER BY kabupaten, kecamatan, kelurahan, tps_no`
  ).bind(themeId).all();

  const rows = results.map((r) => ({ ...r, party_votes: JSON.parse(r.party_votes || "{}") }));
  return json({ rows });
}
