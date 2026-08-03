// Membuat akun admin pertama.
// Pakai: node scripts/seed-admin.mjs <username> <password>
// Lalu jalankan perintah wrangler yang dicetak di akhir (lokal & remote).

const ITERATIONS = 100_000;

function bufToHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    256
  );
  return `${bufToHex(salt)}:${bufToHex(bits)}`;
}

const [, , username, password] = process.argv;
if (!username || !password) {
  console.error("Pakai: node scripts/seed-admin.mjs <username> <password>");
  process.exit(1);
}

const hash = await hashPassword(password);
const sql = `INSERT INTO users (username, password_hash) VALUES ('${username.replace(/'/g, "''")}', '${hash}');`;

console.log("\nSQL berikut sudah otomatis ditulis ke scripts/seed-admin.sql:\n");
console.log(sql);

await import("node:fs/promises").then((fs) => fs.writeFile("scripts/seed-admin.sql", sql + "\n"));

console.log("\nJalankan salah satu (atau keduanya) untuk memasukkan ke database:\n");
console.log("  npx wrangler d1 execute ai-pemilu-db --file=./scripts/seed-admin.sql          # lokal (wrangler dev)");
console.log("  npx wrangler d1 execute ai-pemilu-db --file=./scripts/seed-admin.sql --remote  # production\n");
