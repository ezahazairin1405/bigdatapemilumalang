import { json } from "../utils.js";

// OpenRouter tidak selalu mengizinkan dipanggil langsung dari browser (CORS)
// -- diteruskan lewat server kita. Key API tetap datang dari browser tiap
// request (dikirim user), TIDAK disimpan di sini.
export async function proxyOpenAiCompatible(request, baseUrl) {
  const body = await request.json().catch(() => ({}));
  const { apiKey, model, prompt, json: jsonMode } = body;
  if (!apiKey || !model || !prompt) {
    return json({ error: "apiKey, model, dan prompt wajib diisi." }, 400);
  }

  const upstreamBody = { model, messages: [{ role: "user", content: prompt }] };
  if (jsonMode) upstreamBody.response_format = { type: "json_object" };

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(upstreamBody),
  });

  const text = await res.text();
  return new Response(text, { status: res.status, headers: { "content-type": "application/json" } });
}

// Cloudflare Workers AI -- TIDAK perlu API key sama sekali, dipanggil lewat
// binding env.AI yang otomatis terhubung ke akun Cloudflare yang deploy
// proyek ini. Wajib lewat server (binding cuma bisa diakses dari Worker,
// tidak bisa dari browser).
export async function proxyWorkersAi(request, env) {
  const body = await request.json().catch(() => ({}));
  const { model, prompt } = body;
  if (!model || !prompt) {
    return json({ error: "model dan prompt wajib diisi." }, 400);
  }

  try {
    const result = await env.AI.run(model, {
      messages: [{ role: "user", content: prompt }],
    });
    return json({ text: result.response || "" });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}
