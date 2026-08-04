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
