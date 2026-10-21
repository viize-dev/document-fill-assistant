// ทะเบียนผู้ให้บริการ: เพิ่มค่ายใหม่ = เพิ่มไฟล์ adapter (extract, listModels) แล้วลงทะเบียนที่นี่
import { buildPrompt, parseJson } from '../prompt.js';
import * as anthropic from './anthropic.js';
import * as openai from './openai.js';
import * as gemini from './gemini.js';
import * as backend from './backend.js';

export const PROVIDERS = {
  backend: {
    id: 'backend',
    label: 'องค์กร (ไม่ต้องมี API key)',
    adapter: backend,
    kind: 'login', // login ด้วยบัญชีองค์กรแทน API key
    models: [],
    defaultModel: '',
  },
  anthropic: {
    id: 'anthropic',
    kind: 'key',
    label: 'Claude (Anthropic)',
    adapter: anthropic,
    keyPlaceholder: 'sk-ant-...',
    defaultModel: 'claude-sonnet-5-5',
    // รายการสำรอง ใช้เมื่อยังไม่ได้โหลดรายการจริงจากบัญชี
    models: [
      { id: 'claude-haiku-5-5', label: 'Haiku 5.5', note: 'เร็ว ประหยัด เหมาะกับเอกสารพิมพ์ชัด' },
      { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', note: 'สมดุล (แนะนำ)' },
      { id: 'claude-opus-5-5', label: 'Opus 5.5', note: 'แม่นยำสูง เหมาะกับสแกนไม่ชัด/ลายมือ' },
      { id: 'claude-fable-5-1', label: 'Fable 5.1', note: 'แม่นยำสูงสุด ช้าและแพงกว่า' },
    ],
    setup: {
      url: 'https://console.anthropic.com/settings/keys',
      steps: [
        'เปิดลิงก์ด้านล่างและสมัคร/เข้าสู่ระบบ Anthropic Console',
        'เติมเครดิตที่เมนู Billing (แพ็กเกจ Claude Pro/Max ใช้กับ extension นี้ไม่ได้ ต้องเป็นบัญชี API)',
        'กด Create Key แล้วคัดลอกคีย์ (ขึ้นต้น sk-ant-)',
        'วางคีย์ในช่องด้านบน แล้วกด "ทดสอบและโหลดรายการโมเดล"',
      ],
    },
  },
  openai: {
    id: 'openai',
    kind: 'key',
    label: 'ChatGPT (OpenAI)',
    adapter: openai,
    keyPlaceholder: 'sk-...',
    defaultModel: '',
    models: [],
    setup: {
      url: 'https://platform.openai.com/api-keys',
      steps: [
        'เปิดลิงก์ด้านล่างและเข้าสู่ระบบ OpenAI Platform (แยกจากบัญชี ChatGPT)',
        'เติมเครดิตที่เมนู Billing (แพ็กเกจ ChatGPT Plus/Pro ยังใช้กับ extension นี้ไม่ได้)',
        'กด Create new secret key แล้วคัดลอกคีย์',
        'วางคีย์ในช่องด้านบน แล้วกด "ทดสอบและโหลดรายการโมเดล"',
      ],
    },
  },
  gemini: {
    id: 'gemini',
    kind: 'key',
    label: 'Gemini (Google)',
    adapter: gemini,
    keyPlaceholder: 'AIza...',
    defaultModel: '',
    models: [],
    setup: {
      url: 'https://aistudio.google.com/apikey',
      steps: [
        'เปิดลิงก์ด้านล่างและเข้าสู่ระบบด้วยบัญชี Google',
        'กด Create API key (มีโควต้าฟรีจำกัด ตรวจเงื่อนไขการใช้ข้อมูลของ Google สำหรับ tier ฟรี)',
        'คัดลอกคีย์',
        'วางคีย์ในช่องด้านบน แล้วกด "ทดสอบและโหลดรายการโมเดล"',
      ],
    },
  },
};

// ในเครื่อง: ไม่ใช้ AI ไม่ส่งข้อมูลออกนอกเครื่อง (pdf.js + กฎ ดู lib/local) ใช้กับ PDF ที่มีข้อความในไฟล์เท่านั้น
PROVIDERS.local = {
  id: 'local',
  kind: 'local',
  label: 'ในเครื่อง (ไม่ใช้ AI ไม่ต้องมี key)',
  models: [],
  defaultModel: '',
};

// ค่าเริ่มต้น = ในเครื่อง: ใช้ได้ทันทีโดยไม่ต้องมี API key และไม่ส่งข้อมูลออกนอกเครื่อง (ต้องการ AI ให้เลือกค่ายและใส่ key ในตั้งค่า)
export const DEFAULT_PROVIDER = 'local';
export const kindOf = (id) => PROVIDERS[id]?.kind;

// เลือกโมเดลเริ่มต้นจากรายการที่มี: ค่าที่บันทึกไว้ > default ของค่าย > ตัวที่ชื่อมี flash/mini/sonnet > ตัวแรก
export function pickModel(providerId, list, saved) {
  if (saved && list.some((m) => m.id === saved)) return saved;
  const p = PROVIDERS[providerId];
  if (list.some((m) => m.id === p.defaultModel)) return p.defaultModel;
  return (list.find((m) => /flash|mini|sonnet/i.test(m.id)) || list[0])?.id || '';
}

export async function extractFromPdf({ provider, apiKey, model, base64, profile, baseUrl, signal }) {
  const p = PROVIDERS[provider];
  if (!p) throw new Error(`ไม่รู้จักผู้ให้บริการ ${provider}`);
  if (p.kind === 'local') throw new Error('โหมดในเครื่องไม่ผ่าน AI (ใช้ extractLocal ใน lib/local)');
  if (!apiKey) {
    throw new Error(
      p.kind === 'login'
        ? 'ยังไม่ได้เข้าสู่ระบบองค์กร (เปิดส่วนตั้งค่าด้านล่าง)'
        : `ยังไม่ได้ใส่ API key ของ ${p.label} (เปิดส่วนตั้งค่าด้านล่าง)`,
    );
  }
  // โหมดองค์กร: backend เลือกโมเดลเองตามที่ admin ตั้ง; โหมด key: ต้องเลือกโมเดล
  if (!model && p.kind !== 'login') throw new Error('ยังไม่ได้เลือกโมเดล (กด "ทดสอบและโหลดรายการโมเดล" ในส่วนตั้งค่า)');
  const text = await p.adapter.extract(
    p.kind === 'login' ? { base64, apiKey, model, baseUrl, profileId: profile.id, signal } : { base64, apiKey, model, baseUrl, prompt: buildPrompt(profile), signal },
  );
  return parseJson(text);
}

export async function listModels(provider, apiKey, extra = {}) {
  const p = PROVIDERS[provider];
  if (p.kind === 'key' && !apiKey) throw new Error('ยังไม่ได้ใส่ API key');
  const live = await p.adapter.listModels(apiKey, extra);
  const notes = Object.fromEntries(p.models.map((m) => [m.id, m]));
  return live.map((m) => ({ ...m, ...(notes[m.id] ? { label: notes[m.id].label, note: notes[m.id].note } : {}) }));
}
