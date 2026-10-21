// รายการโมเดลของแต่ละค่าย (ใช้ทดสอบ key ของ admin และให้เลือกโมเดล) คืน [{ id, label }]
import { UpstreamError } from './index.js';

async function getJson(url, headers, fetchImpl) {
  let res;
  try {
    res = await fetchImpl(url, { headers });
  } catch {
    throw new UpstreamError('เชื่อมต่อผู้ให้บริการ AI ไม่ได้', 502);
  }
  if (res.status === 401 || res.status === 403) throw new UpstreamError('ผู้ให้บริการ AI ไม่ยอมรับ key นี้', 400);
  if (!res.ok) throw new UpstreamError(`ผู้ให้บริการ AI ตอบกลับผิดพลาด (${res.status})`, 502);
  return res.json();
}

export async function listModels(provider, apiKey, fetchImpl = fetch) {
  if (provider === 'anthropic') {
    const j = await getJson('https://api.anthropic.com/v1/models?limit=100', { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }, fetchImpl);
    return (j.data || []).map((m) => ({ id: m.id, label: m.display_name || m.id }));
  }
  if (provider === 'openai') {
    const j = await getJson('https://api.openai.com/v1/models', { authorization: `Bearer ${apiKey}` }, fetchImpl);
    return (j.data || []).filter((m) => /^(gpt|o\d|chatgpt)/.test(m.id)).map((m) => ({ id: m.id, label: m.id }));
  }
  if (provider === 'gemini') {
    const j = await getJson('https://generativelanguage.googleapis.com/v1beta/models?pageSize=100', { 'x-goog-api-key': apiKey }, fetchImpl);
    return (j.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map((m) => ({ id: String(m.name).replace(/^models\//, ''), label: m.displayName || m.name }));
  }
  throw new UpstreamError(`ไม่รู้จัก provider ${provider}`, 400);
}
