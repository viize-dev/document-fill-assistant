// รัน: node --test "test/*.test.mjs"  (จำลอง chrome/fetch ไม่เรียก Microsoft จริง)
import test from 'node:test';
import assert from 'node:assert/strict';

const store = {};
let launched = null;
globalThis.chrome = {
  identity: {
    getRedirectURL: () => 'https://abc.chromiumapp.org/',
    launchWebAuthFlow: async ({ url }) => {
      launched = new URL(url);
      return launchResult(launched);
    },
  },
  storage: {
    local: {
      get: async (k) => ({ [k]: store[k] }),
      set: async (o) => Object.assign(store, o),
      remove: async (k) => delete store[k],
    },
  },
};
let launchResult = (u) => `https://abc.chromiumapp.org/?code=CODE1&state=${u.searchParams.get('state')}`;

const { SOURCE_CONFIG } = await import('../lib/sources/config.js');
const { msmail, msdrive } = await import('../lib/sources/microsoft.js');

let calls = [];
let handler;
globalThis.fetch = async (url, init) => (calls.push({ url: String(url), init }), handler(String(url), init));
const json = (b, status = 200) => new Response(JSON.stringify(b), { status });
const reset = () => {
  for (const k of Object.keys(store)) delete store[k];
  calls = [];
};

test('ยังไม่ตั้ง client id -> CONFIG ภาษาไทย ไม่ยิงเครือข่าย', async () => {
  reset();
  SOURCE_CONFIG.microsoftClientId = '';
  await assert.rejects(() => msmail.connect(), { code: 'CONFIG' });
  assert.equal(calls.length, 0);
});

test('login: PKCE S256 + state, แลก code เป็น token และเก็บ refresh token', async () => {
  reset();
  SOURCE_CONFIG.microsoftClientId = 'cid-123';
  handler = () => json({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600 });
  await msmail.connect();
  assert.equal(launched.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(launched.searchParams.get('client_id'), 'cid-123');
  assert.match(launched.searchParams.get('scope'), /Mail\.Read/);
  assert.ok(!/Send|ReadWrite/.test(launched.searchParams.get('scope')), 'ต้องไม่ขอสิทธิ์เขียน/ส่ง');
  const body = new URLSearchParams(calls[0].init.body);
  assert.equal(body.get('code'), 'CODE1');
  assert.ok(body.get('code_verifier').length >= 43);
  assert.equal(store.msAuth.refresh, 'RT');
});

test('login: state ไม่ตรง -> ปฏิเสธ', async () => {
  reset();
  launchResult = () => 'https://abc.chromiumapp.org/?code=X&state=WRONG';
  await assert.rejects(() => msmail.connect(), { code: 'CONFIG' });
  launchResult = (u) => `https://abc.chromiumapp.org/?code=CODE1&state=${u.searchParams.get('state')}`;
});

test('องค์กรต้องให้ admin อนุมัติ -> ข้อความเฉพาะ', async () => {
  reset();
  launchResult = () => 'https://abc.chromiumapp.org/?error=access_denied&error_description=AADSTS90094%3A+admin+consent+required';
  await assert.rejects(() => msmail.connect(), (e) => e.code === 'PERMISSION' && /ผู้ดูแล/.test(e.message));
  launchResult = (u) => `https://abc.chromiumapp.org/?code=CODE1&state=${u.searchParams.get('state')}`;
});

test('token หมดอายุ -> ต่ออายุด้วย refresh token แล้วเรียก Graph ต่อ', async () => {
  reset();
  store.msAuth = { access: 'OLD', refresh: 'RT', expiresAt: Date.now() - 1000 };
  handler = (url) => (url.includes('/token') ? json({ access_token: 'NEW', expires_in: 3600 }) : json({ value: [], '@odata.nextLink': '' }));
  await msdrive.list({});
  assert.equal(store.msAuth.access, 'NEW');
  assert.equal(store.msAuth.refresh, 'RT', 'ต้องคง refresh token เดิมถ้าเซิร์ฟเวอร์ไม่ส่งตัวใหม่');
  assert.equal(calls.at(-1).init.headers.Authorization, 'Bearer NEW');
});

test('refresh ไม่สำเร็จ -> ล้าง token และบอกให้เชื่อมต่อใหม่ (AUTH)', async () => {
  reset();
  store.msAuth = { access: 'OLD', refresh: 'BAD', expiresAt: 0 };
  handler = () => json({ error: 'invalid_grant', error_description: 'expired' }, 400);
  await assert.rejects(() => msmail.list({}), { code: 'AUTH' });
  assert.equal(store.msAuth, undefined);
});

test('Outlook: กรองเฉพาะ PDF ที่ไม่ใช่ inline, ส่งตัวกรองวันที่/คำค้น, คืน nextLink', async () => {
  reset();
  store.msAuth = { access: 'AT', refresh: 'RT', expiresAt: Date.now() + 1e6 };
  handler = () =>
    json({
      value: [
        {
          id: 'm1', subject: 'หนังสือ', receivedDateTime: '2026-10-01T00:00:00Z', from: { emailAddress: { address: 'a@x.go.th' } },
          attachments: [
            { id: 'a1', name: 'doc.PDF', contentType: 'application/octet-stream', size: 100, isInline: false },
            { id: 'a2', name: 'logo.png', contentType: 'image/png', size: 5, isInline: true },
            { id: 'a3', name: 'sig.pdf', contentType: 'application/pdf', size: 5, isInline: true },
            { id: 'a4', name: 'x.docx', contentType: 'application/msword', size: 5, isInline: false },
          ],
        },
      ],
      '@odata.nextLink': 'https://graph.microsoft.com/v1.0/me/messages?$skiptoken=T',
    });
  const r = await msmail.list({ query: 'abc "x"', days: 7 });
  assert.deepEqual(r.items.map((i) => i.name), ['doc.PDF']);
  assert.match(r.nextCursor, /skiptoken/);
  const u = decodeURIComponent(calls[0].url);
  assert.match(u, /hasattachments:true/);
  assert.match(u, /received>=\d{4}-\d{2}-\d{2}/);
  assert.ok(!u.includes('"x"'), 'ตัดเครื่องหมายคำพูดในคำค้น ไม่ให้ทะลุ query');
});

test('ไม่ส่ง token ไปที่อยู่นอก Graph (cursor ปลอม)', async () => {
  reset();
  store.msAuth = { access: 'AT', refresh: 'RT', expiresAt: Date.now() + 1e6 };
  handler = () => json({});
  await assert.rejects(() => msmail.list({ cursor: 'https://evil.example/steal' }), { code: 'CONFIG' });
  assert.equal(calls.length, 0);
});

test('OneDrive: เฉพาะ PDF, กรองวันที่ฝั่งเรา, 403 -> PERMISSION', async () => {
  reset();
  store.msAuth = { access: 'AT', refresh: 'RT', expiresAt: Date.now() + 1e6 };
  const recent = new Date().toISOString();
  handler = () =>
    json({
      value: [
        { id: 'f1', name: 'a.pdf', file: { mimeType: 'application/pdf' }, size: 10, lastModifiedDateTime: recent },
        { id: 'f2', name: 'old.pdf', file: {}, size: 10, lastModifiedDateTime: '2020-01-01T00:00:00Z' },
        { id: 'd1', name: 'folder.pdf', folder: {}, lastModifiedDateTime: recent },
      ],
    });
  const r = await msdrive.list({ days: 30 });
  assert.deepEqual(r.items.map((i) => i.id), ['f1']);
  handler = () => json({}, 403);
  await assert.rejects(() => msdrive.list({}), { code: 'PERMISSION' });
});

test('ยกเลิกการเชื่อมต่อ ลบ token ในเครื่อง', async () => {
  store.msAuth = { access: 'x' };
  await msmail.disconnect();
  assert.equal(store.msAuth, undefined);
});
