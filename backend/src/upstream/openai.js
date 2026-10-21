import { failFrom } from './index.js';

export async function extract({ apiKey, model, prompt, base64, fetchImpl = fetch, signal }) {
  const res = await fetchImpl('https://api.openai.com/v1/responses', {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      max_output_tokens: 8000,
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_file', filename: 'document.pdf', file_data: `data:application/pdf;base64,${base64}` },
            { type: 'input_text', text: prompt },
          ],
        },
      ],
    }),
  });
  if (!res.ok) throw await failFrom(res);
  const data = await res.json();
  return {
    text: (data.output || []).flatMap((o) => o.content || []).filter((c) => c.type === 'output_text').map((c) => c.text).join(''),
    usage: { input: data.usage?.input_tokens || 0, output: data.usage?.output_tokens || 0 },
  };
}
