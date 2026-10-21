import { apiFail } from '../prompt.js';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';
const headers = (apiKey) => ({ 'content-type': 'application/json', 'x-goog-api-key': apiKey });

export async function extract({ base64, apiKey, model, prompt, signal }) {
  const res = await fetch(`${BASE}/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    signal,
    headers: headers(apiKey),
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { inline_data: { mime_type: 'application/pdf', data: base64 } },
            { text: prompt },
          ],
        },
      ],
      generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 8000 },
    }),
  });
  if (!res.ok) throw await apiFail(res);
  const data = await res.json();
  return (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
}

export async function listModels(apiKey) {
  const res = await fetch(`${BASE}/models?pageSize=100`, { headers: headers(apiKey) });
  if (!res.ok) throw await apiFail(res);
  const data = await res.json();
  return (data.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent') && /gemini/i.test(m.name))
    .map((m) => ({ id: m.name.replace(/^models\//, ''), label: m.displayName || m.name }));
}
