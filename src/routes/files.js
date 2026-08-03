// File PDF asli disimpan di R2 (bukan di D1 -- D1 cuma cocok data terstruktur),
// supaya bisa dibaca ulang utuh oleh Gemini saat pertanyaan butuh angka rinci
// yang tidak tercakup di ringkasan singkat.

function r2Key(documentId) {
  return `documents/${documentId}.pdf`;
}

export async function putDocumentFile(request, env, documentId) {
  const body = await request.arrayBuffer();
  if (!body.byteLength) {
    return new Response(JSON.stringify({ error: "File kosong." }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }
  await env.PDF_BUCKET.put(r2Key(documentId), body, {
    httpMetadata: { contentType: "application/pdf" },
  });
  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

export async function getDocumentFile(env, documentId) {
  const obj = await env.PDF_BUCKET.get(r2Key(documentId));
  if (!obj) {
    return new Response(JSON.stringify({ error: "File tidak ditemukan di R2." }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }
  return new Response(obj.body, {
    status: 200,
    headers: { "content-type": "application/pdf" },
  });
}

export async function deleteDocumentFile(env, documentId) {
  await env.PDF_BUCKET.delete(r2Key(documentId));
}
