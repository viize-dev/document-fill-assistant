import * as anthropic from './anthropic.js';
import * as openai from './openai.js';
import * as gemini from './gemini.js';

const ADAPTERS = { anthropic, openai, gemini };

// ทุก adapter คืน { text, usage: { input, output } } หรือโยน UpstreamError
export class UpstreamError extends Error {
  constructor(message, status, detail = '') {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

export async function callUpstream(provider, args) {
  const adapter = ADAPTERS[provider];
  if (!adapter) throw new UpstreamError(`ไม่รู้จัก provider ${provider}`, 500);
  return adapter.extract(args);
}

export async function failFrom(res) {
  const body = await res.text().catch(() => '');
  let detail = '';
  try {
    const j = JSON.parse(body);
    detail = j.error?.message || j.message || '';
  } catch {
    // ไม่ใช่ JSON
  }
  // ไม่ส่งรายละเอียดดิบจากค่ายกลับไปหาผู้ใช้ เพื่อไม่ให้ข้อมูลภายใน (เช่น ชื่อโปรเจกต์/บางส่วนของ key) หลุด
  return new UpstreamError(`ผู้ให้บริการ AI ตอบกลับผิดพลาด (${res.status})`, res.status === 429 ? 429 : 502, detail);
}
