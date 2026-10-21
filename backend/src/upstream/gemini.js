import { failFrom } from './index.js';

export async function extract({ apiKey, model, prompt, base64, fetchImpl = fetch, signal }) {
  const res = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{ parts: [{ inline_data: { mime_type: 'application/pdf', data: base64 } }, { text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 8000 },
    }),
  });
  if (!res.ok) throw await failFrom(res);
  const data = await res.json();
  return {
    text: (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join(''),
    usage: { input: data.usageMetadata?.promptTokenCount || 0, output: data.usageMetadata?.candidatesTokenCount || 0 },
  };
}
