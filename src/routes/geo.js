import { json } from "../utils.js";

// Proxy ke layanan resmi Badan Informasi Geospasial (BIG) untuk batas
// wilayah kelurahan/desa, supaya tidak perlu menyimpan file GeoJSON
// raksasa se-Indonesia -- diambil per kecamatan sesuai kebutuhan saja.
//
// [VERIFIKASI] Endpoint dan nama field di bawah ini didasarkan pada layer
// resmi BIG "Administrasi_AR_KelDesa_10K" (geoservices.big.go.id). Field
// seperti WADMKK/WADMKC/WADMKD adalah konvensi umum data RBI BIG untuk
// nama kabupaten/kecamatan/kelurahan, tapi SEBAIKNYA dicek ulang langsung
// ke endpoint ini sebelum dipakai produksi (buka URL di bawah di browser,
// cek daftar field aslinya):
//   https://geoservices.big.go.id/rbi/rest/services/BATASWILAYAH/Administrasi_AR_KelDesa_10K/MapServer/0?f=pjson

const BIG_BASE =
  "https://geoservices.big.go.id/rbi/rest/services/BATASWILAYAH/Administrasi_AR_KelDesa_10K/MapServer/0/query";

export async function getKelurahanBoundaries(request) {
  const url = new URL(request.url);
  const kabupaten = url.searchParams.get("kabupaten");
  const kecamatan = url.searchParams.get("kecamatan");

  if (!kabupaten && !kecamatan) {
    return json({ error: "Isi minimal parameter kabupaten atau kecamatan." }, 400);
  }

  const clauses = [];
  if (kabupaten) clauses.push(`UPPER(WADMKK)=UPPER('${kabupaten.replace(/'/g, "''")}')`);
  if (kecamatan) clauses.push(`UPPER(WADMKC)=UPPER('${kecamatan.replace(/'/g, "''")}')`);

  const params = new URLSearchParams({
    where: clauses.join(" AND "),
    outFields: "*",
    f: "geojson",
    outSR: "4326",
  });

  const res = await fetch(`${BIG_BASE}?${params.toString()}`);
  if (!res.ok) {
    return json({ error: `Gagal mengambil data dari BIG (status ${res.status}).` }, 502);
  }
  const geojson = await res.json();
  return json(geojson);
}
