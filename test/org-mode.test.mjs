// รัน: node --test "test/*.test.mjs"
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

const storage = { managed: {} };
globalThis.chrome = { storage: { managed: { get: async () => storage.managed } } };

const { DEPLOY, orgBackendUrl } = await import('../lib/deploy.js');
const { extractFromPdf } = await import('../lib/providers/index.js');
const { buildPrompt } = await import('../lib/prompt.js');
const { default: profile } = await import('../profiles/saraban.js');

test('โหมดองค์กร: URL จากนโยบายทับค่าตอน build, ตัด / ท้าย, ว่างเมื่อไม่ได้ตั้ง', async () => {
  assert.equal(await orgBackendUrl(), '');
  DEPLOY.backendUrl = 'https://build.example.go.th/';
  assert.equal(await orgBackendUrl(), 'https://build.example.go.th');
  storage.managed = { backendUrl: 'https://policy.example.go.th///' };
  assert.equal(await orgBackendUrl(), 'https://policy.example.go.th');
  chrome.storage.managed.get = async () => { throw new Error('ไม่มีนโยบาย'); };
  assert.equal(await orgBackendUrl(), 'https://build.example.go.th');
  DEPLOY.backendUrl = '';
});

test('เรียกผ่าน backend: ส่ง profile_id ไม่ส่ง prompt, ไม่ต้องเลือกโมเดล, ใช้ session เป็น Bearer', async () => {
  let sent;
  globalThis.fetch = async (url, init) => {
    sent = { url, init, body: JSON.parse(init.body) };
    return new Response(JSON.stringify({ text: '{"doc_type":"other","fields":{"subject":"x"},"summary":"สรุป"}' }), { status: 200 });
  };
  const out = await extractFromPdf({ provider: 'backend', apiKey: 'SESSION', base64: 'JVBERi0=', profile, baseUrl: 'https://org.example' });
  assert.equal(sent.url, 'https://org.example/v1/extract');
  assert.equal(sent.init.headers.Authorization, 'Bearer SESSION');
  assert.equal(sent.body.profile_id, 'saraban-demo');
  assert.ok(!('prompt' in sent.body), 'ต้องไม่ส่ง prompt จากไคลเอนต์');
  assert.equal(out.summary, 'สรุป');
});

test('เรียกผ่าน backend โดยยังไม่ login -> ข้อความให้ login', async () => {
  await assert.rejects(() => extractFromPdf({ provider: 'backend', apiKey: '', base64: 'x', profile, baseUrl: 'https://org.example' }), /เข้าสู่ระบบ/);
});

test('เซสชันถูกเพิกถอน (401) -> ข้อความให้เข้าสู่ระบบใหม่', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'เซสชันถูกเพิกถอน' }), { status: 401 });
  await assert.rejects(() => extractFromPdf({ provider: 'backend', apiKey: 'S', base64: 'x', profile, baseUrl: 'https://org.example' }), /เซสชันหมดอายุ/);
});

test('prompt ฝั่ง extension และ backend ต้องเหมือนกัน (ถ้ามี backend อยู่ข้างๆ)', async (t) => {
  const backendDir = new URL('../backend/', import.meta.url);
  if (!existsSync(new URL('src/prompt.js', backendDir))) return t.skip('ไม่พบ backend/');
  const { buildPrompt: serverPrompt } = await import(new URL('src/prompt.js', backendDir));
  const { default: exported } = await import('node:fs').then((fs) => ({ default: JSON.parse(fs.readFileSync(new URL('profiles/saraban-demo.json', backendDir), 'utf8')) }));
  for (const opts of [{ summary: true }, { summary: false }]) {
    assert.equal(serverPrompt(exported, opts), buildPrompt(profile, opts), `ไม่ตรงกัน (${JSON.stringify(opts)}) — รัน scripts/export-profiles.mjs และคัดลอก lib/prompt.js ไป backend/src/prompt.js ใหม่`);
  }
});
