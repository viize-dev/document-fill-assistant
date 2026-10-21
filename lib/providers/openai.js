import { apiFail } from '../prompt.js';

const BASE = 'https://api.openai.com/v1';
const headers = (apiKey) => ({ 'content-type': 'application/json', Authorization: `Bearer ${apiKey}` });

export async function extract({ base64, apiKey, model, prompt, signal }) {
  const res = await fetch(`${BASE}/responses`, {
    method: 'POST',
    signal,
    headers: headers(apiKey),
    body: JSON.stringify({
      model,
      // โมเดลแบบ reasoning นับ token การคิดรวมใน output ด้วย จึงเผื่อไว้มาก
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
  if (!res.ok) throw await apiFail(res);
  const data = await res.json();
  return (data.output || [])
    .flatMap((o) => o.content || [])
    .filter((c) => c.type === 'output_text')
    .map((c) => c.text)
    .join('');
}

// เอาเฉพาะโมเดลแชต/อ่านเอกสาร ตัดเสียง ภาพ embedding ฯลฯ ออก
const EXCLUDE = /embed|tts|whisper|transcribe|audio|realtime|image|dall|moderation|search|codex|instruct|davinci|babbage/i;

export async function listModels(apiKey) {
  const res = await fetch(`${BASE}/models`, { headers: headers(apiKey) });
  if (!res.ok) throw await apiFail(res);
  const data = await res.json();
  return (data.data || [])
    .map((m) => m.id)
    .filter((id) => /^(gpt-|o\d)/.test(id) && !EXCLUDE.test(id))
    .sort()
    .reverse()
    .map((id) => ({ id, label: id }));
}
