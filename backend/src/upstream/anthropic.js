import { failFrom } from './index.js';

export async function extract({ apiKey, model, prompt, base64, fetchImpl = fetch, signal }) {
  const res = await fetchImpl('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
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
  if (!res.ok) throw await failFrom(res);
  const data = await res.json();
  return {
    text: (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join(''),
    usage: { input: data.usage?.input_tokens || 0, output: data.usage?.output_tokens || 0 },
  };
}
