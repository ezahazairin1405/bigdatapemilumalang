import { json } from "../utils.js";

// Groq, Grok (xAI), dan Claude tidak selalu mengizinkan dipanggil langsung
// dari browser (CORS) -- jadi diteruskan lewat server kita. Key API tetap
// datang dari browser tiap request (dikirim user), TIDAK disimpan di sini.

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

export async function proxyClaude(request) {
  const body = await request.json().catch(() => ({}));
  const { apiKey, model, prompt, base64Pdf } = body;
  if (!apiKey || !model || !prompt) {
    return json({ error: "apiKey, model, dan prompt wajib diisi." }, 400);
  }

  const content = [];
  if (base64Pdf) {
    content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: base64Pdf } });
  }
  content.push({ type: "text", text: prompt });

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({ model, max_tokens: 8192, messages: [{ role: "user", content }] }),
  });

  const text = await res.text();
  return new Response(text, { status: res.status, headers: { "content-type": "application/json" } });
}
