// Autentikasi sederhana: 1 akun admin, sesi lewat cookie httpOnly.
// Format password_hash: "saltHex:hashHex" (PBKDF2-SHA256, sama seperti pola
// di proyek AWASI MUTARLIH), supaya konsisten dan bisa memakai skrip seed
// yang mirip kalau perlu.

const ITERATIONS = 100_000;
const SESSION_COOKIE = "ai_pemilu_session";
const SESSION_TTL_HOURS = 12;

function bufToHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function hexToBuf(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

async function pbkdf2(password, saltBytes) {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: saltBytes, iterations: ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    256
  );
  return bufToHex(bits);
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt);
  return `${bufToHex(salt)}:${hash}`;
}

export async function verifyPassword(password, stored) {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const computed = await pbkdf2(password, hexToBuf(saltHex));
  return computed === hashHex;
}

export async function createSession(env, userId) {
  const token = bufToHex(crypto.getRandomValues(new Uint8Array(32)));
  const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 3600 * 1000).toISOString();
  await env.DB.prepare(
    "INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)"
  ).bind(token, userId, expiresAt).run();
  return { token, expiresAt };
}

export function sessionCookieHeader(token, expiresAt) {
  const expires = new Date(expiresAt).toUTCString();
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Expires=${expires}`;
}

export function clearSessionCookieHeader() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

function getCookie(request, name) {
  const header = request.headers.get("Cookie") || "";
  const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? match[1] : null;
}

export async function getSessionUser(request, env) {
  const token = getCookie(request, SESSION_COOKIE);
  if (!token) return null;

  const row = await env.DB.prepare(
    `SELECT s.token, s.user_id, s.expires_at, u.username, u.role
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = ?`
  ).bind(token).first();

  if (!row) return null;
  if (new Date(row.expires_at) < new Date()) {
    await env.DB.prepare("DELETE FROM sessions WHERE token = ?").bind(token).run();
    return null;
  }
  return { id: row.user_id, username: row.username, role: row.role, token: row.token };
}

export async function requireAuth(request, env) {
  const user = await getSessionUser(request, env);
  if (!user) {
    return { user: null, response: new Response(JSON.stringify({ error: "Belum login." }), {
      status: 401,
      headers: { "content-type": "application/json" },
    }) };
  }
  return { user, response: null };
}

// Dipakai untuk rute yang cuma boleh diakses admin (upload, kelola tema/dokumen).
export function requireAdmin(user) {
  if (user.role !== "admin") {
    return new Response(JSON.stringify({ error: "Hanya admin yang boleh melakukan ini." }), {
      status: 403,
      headers: { "content-type": "application/json" },
    });
  }
  return null;
}
