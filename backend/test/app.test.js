import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadConfig } from '../src/config.js';
import { UpstreamError } from '../src/upstream/index.js';
import { ENV, PDF_B64, login, makeApp, post, rawConfig } from './helpers.js';

const extractBody = (over = {}) => ({ pdf_base64: PDF_B64, profile_id: 'saraban-demo', ...over });

test('/config เปิดสาธารณะ ไม่มีความลับ', async () => {
  const { app } = makeApp();
  const res = await app.request('/config');
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.ok(!text.includes('sk-test-secret-key'));
  assert.ok(!text.includes('x'.repeat(40)));
  const j = JSON.parse(text);
  assert.equal(j.oidc[0].id, 'google');
  assert.equal(j.defaultModel, 'm-default');
});

test('ไม่มี token -> 401 ทุก endpoint ที่ป้องกัน', async () => {
  const { app } = makeApp();
  for (const [m, p] of [['GET', '/me'], ['POST', '/v1/extract']]) {
    assert.equal((await app.request(p, { method: m })).status, 401, p);
  }
  assert.equal((await app.request('/me', { headers: { authorization: 'Bearer junk' } })).status, 401);
});

test('login -> /me แสดงโควต้า', async () => {
  const { app } = makeApp();
  const { res, body } = await login(app);
  assert.equal(res.status, 200);
  assert.equal(body.user.isAdmin, false);
  const me = await (await app.request('/me', { headers: { authorization: `Bearer ${body.token}` } })).json();
  assert.equal(me.email, 'somchai@example.go.th');
  assert.deepEqual(me.usage, { month: '2026-10', requests: 0, limit: 3 });
});

test('login: บัญชีนอกโดเมน -> 403, nonce ผิด -> 401', async () => {
  const { app } = makeApp();
  assert.equal((await login(app, { email: 'x@evil.com' })).res.status, 403);
  assert.equal((await login(app, {}, 'bad')).res.status, 401);
});

test('/v1/extract สำเร็จ: ส่ง key ฝั่งเซิร์ฟเวอร์ไปค่ายต้นทาง และบันทึกการใช้งาน', async () => {
  const { app, calls, db } = makeApp();
  const { body: { token } } = await login(app);
  const res = await post(app, '/v1/extract', token, extractBody());
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.equal(j.text, '{"doc_type":"other"}');
  assert.equal(j.model, 'm-default');
  assert.equal(calls[0].apiKey, 'sk-test-secret-key');
  assert.ok(!JSON.stringify(j).includes('sk-test-secret-key'));
  const [row] = db.usageSummary('2026-10');
  assert.deepEqual([row.email, row.requests, row.input_tokens, row.output_tokens], ['somchai@example.go.th', 1, 1200, 80]);
});

test('/v1/extract: เลือกโมเดลที่อนุญาตได้ โมเดลนอกรายการถูกปฏิเสธ', async () => {
  const { app, calls } = makeApp();
  const { body: { token } } = await login(app);
  assert.equal((await post(app, '/v1/extract', token, extractBody({ model: 'm-big' }))).status, 200);
  assert.equal(calls[0].model, 'm-big');
  assert.equal((await post(app, '/v1/extract', token, extractBody({ model: 'gpt-expensive' }))).status, 400);
  assert.equal(calls.length, 1);
});

test('/v1/extract: ตรวจข้อมูลขาเข้า (ไม่ใช่ PDF / ใหญ่ / profile ไม่รู้จัก / ไม่ครบ)', async () => {
  const { app, calls } = makeApp();
  const { body: { token } } = await login(app);
  const notPdf = Buffer.from('hello world, not pdf').toString('base64');
  assert.equal((await post(app, '/v1/extract', token, extractBody({ pdf_base64: notPdf }))).status, 400);
  assert.equal((await post(app, '/v1/extract', token, extractBody({ pdf_base64: PDF_B64.padEnd(2000, 'A') }))).status, 413);
  assert.equal((await post(app, '/v1/extract', token, extractBody({ profile_id: 'ไม่มีจริง' }))).status, 400);
  assert.equal((await post(app, '/v1/extract', token, { pdf_base64: PDF_B64 })).status, 400); // ไม่ระบุ profile_id
  assert.equal((await post(app, '/v1/extract', token, extractBody({ pdf_base64: '%PDF-not-base64!!' }))).status, 400);
  assert.equal(calls.length, 0, 'ไม่ควรเรียกค่ายต้นทางเลย');
});

test('โควต้ารายเดือน: ครบแล้วถูกปฏิเสธ 429 และเดือนใหม่เริ่มนับใหม่', async () => {
  const { app, calls, state } = makeApp({ rawOver: { limits: { ...rawConfig().limits, requestsPerMinutePerUser: 100 } } });
  const { body: { token } } = await login(app);
  for (let i = 0; i < 3; i++) assert.equal((await post(app, '/v1/extract', token, extractBody())).status, 200);
  const over = await post(app, '/v1/extract', token, extractBody());
  assert.equal(over.status, 429);
  assert.match((await over.json()).error, /โควต้า/);
  assert.equal(calls.length, 3);
  state.now += 20 * 24 * 3600 * 1000; // ข้ามไปพฤศจิกายน (token อายุ 8 ชม. จึงต้อง login ใหม่)
  const { body: { token: t2 } } = await login(app, { exp: Math.floor(state.now / 1000) + 3600 });
  assert.equal((await post(app, '/v1/extract', t2, extractBody())).status, 200);
});

test('rate limit ต่อนาที', async () => {
  const { app } = makeApp({ rawOver: { limits: { ...rawConfig().limits, monthlyRequestsPerUser: 100, requestsPerMinutePerUser: 2 } } });
  const { body: { token } } = await login(app);
  assert.equal((await post(app, '/v1/extract', token, extractBody())).status, 200);
  assert.equal((await post(app, '/v1/extract', token, extractBody())).status, 200);
  assert.equal((await post(app, '/v1/extract', token, extractBody())).status, 429);
});

test('ค่ายต้นทางล้มเหลว: ตอบ 502 โดยไม่เปิดเผยรายละเอียด แต่ยังนับโควต้า', async () => {
  const upstream = async () => { throw new UpstreamError('ผู้ให้บริการ AI ตอบกลับผิดพลาด (500)', 500, 'internal: key sk-test-secret-key org-xyz'); };
  const { app, db } = makeApp({ upstream });
  const { body: { token } } = await login(app);
  const res = await post(app, '/v1/extract', token, extractBody());
  assert.equal(res.status, 502);
  const text = await res.text();
  assert.ok(!text.includes('sk-test-secret-key') && !text.includes('org-xyz'));
  assert.equal(db.requestsThisMonth('somchai@example.go.th', '2026-10'), 1);
});

test('/auth/dev ไม่มีเมื่อ devAuth ปิด และมีเมื่อเปิด', async () => {
  const { app } = makeApp();
  assert.equal((await app.request('/auth/dev', { method: 'POST', body: '{}' })).status, 404);
  const dev = makeApp({ rawOver: { devAuth: true } });
  const res = await dev.app.request('/auth/dev', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'me@x.io' }) });
  assert.equal(res.status, 200);
});

test('CORS: อนุญาตเฉพาะ origin ที่ตั้งไว้', async () => {
  const { app } = makeApp();
  const ok = await app.request('/config', { headers: { origin: 'chrome-extension://abc' } });
  assert.equal(ok.headers.get('access-control-allow-origin'), 'chrome-extension://abc');
  const bad = await app.request('/config', { headers: { origin: 'https://evil.example' } });
  assert.equal(bad.headers.get('access-control-allow-origin'), null);
  const pre = await app.request('/v1/extract', { method: 'OPTIONS', headers: { origin: 'chrome-extension://abc' } });
  assert.equal(pre.status, 204);
});

test('config: ล้มตั้งแต่เริ่มเมื่อตั้งค่าไม่ปลอดภัย', () => {
  const bad = (raw, env = ENV) => assert.throws(() => loadConfig({ raw, env }), /config ไม่ถูกต้อง/);
  bad(rawConfig(), { ...ENV, JWT_SECRET: 'short' });
  bad(rawConfig({ adminEmails: ['a@x.io', 'b@x.io'] })); // admin ต้องมีคนเดียว
  bad(rawConfig(), { ...ENV, MASTER_KEY: 'short' });
  bad(rawConfig(), { ...ENV, GOOGLE_SECRET: '' }); // adminLogin ไม่มี client secret
  bad(rawConfig({ publicUrl: 'http://evil.example' })); // adminLogin ต้อง https
  loadConfig({ raw: rawConfig(), env: { ...ENV, ANTHROPIC_API_KEY: undefined } }); // ไม่มี API key ใน env ได้ (admin ตั้งทีหลัง)
  bad(rawConfig({ oidc: [{ ...rawConfig().oidc[0], allowedDomains: [], allowedEmails: [] }] })); // ใครก็ login ได้
  bad(rawConfig({ upstream: { ...rawConfig().upstream, defaultModel: 'ไม่มี' } }));
  bad(rawConfig({ devAuth: true }), { ...ENV, NODE_ENV: 'production' });
  bad(rawConfig({ oidc: [] }));
});
