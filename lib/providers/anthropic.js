import { apiFail } from '../prompt.js';

const BASE = 'https://api.anthropic.com/v1';
const headers = (apiKey) => ({
  'content-type': 'application/json',
  'x-api-key': apiKey,
  'anthropic-version': '2023-06-01',
  'anthropic-dangerous-direct-browser-access': 'true',
});

export async function extract({ base64, apiKey, model, prompt, signal }) {
  const res = await fetch(`${BASE}/messages`, {
    method: 'POST',
    signal,
    headers: headers(apiKey),
    body: JSON.stringify({
      model,
      max_tokens: 2000,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
            { type: 'text', text: prompt },
          ],
        },
      ],
    }),
  });
  if (!res.ok) throw await apiFail(res);
  const data = await res.json();
  return (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
}

export async function listModels(apiKey) {
  const res = await fetch(`${BASE}/models?limit=100`, { headers: headers(apiKey) });
  if (!res.ok) throw await apiFail(res);
  const data = await res.json();
  return (data.data || []).map((m) => ({ id: m.id, label: m.display_name || m.id }));
}
