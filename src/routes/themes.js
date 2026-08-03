import { json } from "../utils.js";

export async function listThemes(env) {
  const { results } = await env.DB.prepare(
    `SELECT t.id, t.name, t.created_at,
            SUM(CASE WHEN d.status != 'gagal' THEN 1 ELSE 0 END) AS document_count
     FROM themes t
     LEFT JOIN documents d ON d.theme_id = t.id
     GROUP BY t.id
     ORDER BY t.name COLLATE NOCASE ASC`
  ).all();
  return json({ themes: results });
}

export async function createTheme(request, env) {
  const body = await request.json().catch(() => ({}));
  const name = (body.name || "").trim();
  if (!name) return json({ error: "Nama tema tidak boleh kosong." }, 400);

  const existing = await env.DB.prepare(
    "SELECT id, name FROM themes WHERE name = ? COLLATE NOCASE"
  ).bind(name).first();
  if (existing) return json({ theme: existing, existed: true });

  const result = await env.DB.prepare(
    "INSERT INTO themes (name) VALUES (?)"
  ).bind(name).run();

  return json({ theme: { id: result.meta.last_row_id, name }, existed: false }, 201);
}
