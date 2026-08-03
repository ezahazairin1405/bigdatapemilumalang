import {
  verifyPassword,
  createSession,
  sessionCookieHeader,
  clearSessionCookieHeader,
  getSessionUser,
  requireAuth,
  requireAdmin,
} from "./auth.js";
import { json } from "./utils.js";
import { listThemes, createTheme } from "./routes/themes.js";
import { listDocuments, createDocument, updateDocument, deleteDocument } from "./routes/documents.js";
import { saveTpsVotes, listTpsVotes } from "./routes/tps.js";
import { getKelurahanBoundaries } from "./routes/geo.js";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;

    try {
      // --- Autentikasi (tidak butuh login) ---
      if (pathname === "/api/login" && request.method === "POST") {
        return await handleLogin(request, env);
      }
      if (pathname === "/api/logout" && request.method === "POST") {
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: {
            "content-type": "application/json",
            "Set-Cookie": clearSessionCookieHeader(),
          },
        });
      }
      if (pathname === "/api/session" && request.method === "GET") {
        const user = await getSessionUser(request, env);
        return json({
          authenticated: !!user,
          username: user?.username || null,
          role: user?.role || null,
        });
      }

      // --- Semua rute /api/* di bawah ini wajib login ---
      if (pathname.startsWith("/api/")) {
        const { user, response } = await requireAuth(request, env);
        if (!user) return response;

        // GET boleh diakses admin maupun user biasa (buat tanya-jawab/infografis).
        if (pathname === "/api/themes" && request.method === "GET") {
          return await listThemes(env);
        }
        if (pathname === "/api/documents" && request.method === "GET") {
          return await listDocuments(request, env);
        }
        if (pathname === "/api/tps-votes" && request.method === "GET") {
          return await listTpsVotes(request, env);
        }
        if (pathname === "/api/geo/kelurahan" && request.method === "GET") {
          return await getKelurahanBoundaries(request);
        }

        // Sisanya (buat/ubah/hapus tema, dokumen, data TPS) khusus admin.
        const adminBlock = requireAdmin(user);
        if (adminBlock) return adminBlock;

        if (pathname === "/api/themes" && request.method === "POST") {
          return await createTheme(request, env);
        }
        if (pathname === "/api/documents" && request.method === "POST") {
          return await createDocument(request, env);
        }
        const docMatch = pathname.match(/^\/api\/documents\/(\d+)$/);
        if (docMatch && request.method === "PATCH") {
          return await updateDocument(request, env, docMatch[1]);
        }
        if (docMatch && request.method === "DELETE") {
          return await deleteDocument(env, docMatch[1]);
        }
        if (pathname === "/api/tps-votes" && request.method === "POST") {
          return await saveTpsVotes(request, env);
        }

        return json({ error: "Rute API tidak ditemukan." }, 404);
      }

      return json({ error: "Tidak ditemukan." }, 404);
    } catch (err) {
      return json({ error: `Kesalahan server: ${err.message}` }, 500);
    }
  },
};

async function handleLogin(request, env) {
  const body = await request.json().catch(() => ({}));
  const { username, password } = body;
  if (!username || !password) {
    return json({ error: "Username dan password wajib diisi." }, 400);
  }

  const user = await env.DB.prepare(
    "SELECT id, username, password_hash, role FROM users WHERE username = ?"
  ).bind(username).first();

  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return json({ error: "Username atau password salah." }, 401);
  }

  const { token, expiresAt } = await createSession(env, user.id);
  return new Response(JSON.stringify({ success: true, username: user.username, role: user.role }), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "Set-Cookie": sessionCookieHeader(token, expiresAt),
    },
  });
}
