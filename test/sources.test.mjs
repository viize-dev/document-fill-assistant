// รัน: node --test "test/*.test.mjs"  (จำลอง chrome และ fetch ไม่เรียก Google จริง)
import test from 'node:test';
import assert from 'node:assert/strict';

const store = {};
let removed = [];
globalThis.chrome = {
  runtime: { lastError: null },
  identity: {
    getAuthToken: (_o, cb) => cb('tok-1'),
    removeCachedAuthToken: ({ token }, cb) => (removed.push(token), cb()),
  },
  storage: {
    local: {
      get: async (k) => ({ [k]: store[k] }),
      set: async (o) => Object.assign(store, o),
      remove: async (k) => delete store[k],
    },
  },
};

const { gmail, drive } = await import('../lib/sources/google.js');
const { checkPdf, SourceError, MAX_BYTES } = await import('../lib/sources/guard.js');
const { markDone, doneSet } = await import('../lib/sources/history.js');

let calls = [];
const respond = (fn) => (globalThis.fetch = async (url, init) => (calls.push(url), fn(String(url), init)));
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });

test('Gmail: แบ่งหน้า, ค้นหาไฟล์แนบซ้อนหลายชั้น, ส่ง query/วันที่/pageToken', async () => {
  calls = [];
  const msg = (id, name) => ({
    id,
    internalDate: '1700000000000',
    payload: {
      headers: [{ name: 'From', value: 'a@x.go.th' }, { name: 'Subject', value: 'หนังสือ' }],
      parts: [{ parts: [{ filename: name, body: { attachmentId: `att-${id}`, size: 1234 } }] }, { filename: 'x.docx', body: { attachmentId: 'n' } }],
    },
  });
  respond((url) => {
    if (url.includes('/messages?')) return json({ messages: [{ id: 'm1' }, { id: 'm2' }], nextPageToken: 'NEXT' });
    if (url.includes('/messages/m1')) return json(msg('m1', 'a.pdf'));
    if (url.includes('/messages/m2')) return json(msg('m2', 'B.PDF'));
    throw new Error(url);
  });
  const r = await gmail.list({ query: 'from:abc', days: 30, cursor: 'CUR' });
  assert.deepEqual(r.items.map((i) => i.name), ['a.pdf', 'B.PDF']);
  assert.equal(r.nextCursor, 'NEXT');
  assert.equal(r.items[0].size, 1234);
  const listUrl = decodeURIComponent(calls[0]);
  assert.match(listUrl, /newer_than:30d/);
  assert.match(listUrl, /from:abc/);
  assert.match(listUrl, /pageToken=CUR/);
});

test('Gmail: ดาวน์โหลดไฟล์แนบ (base64url) ได้ไบต์ถูกต้อง', async () => {
  const bytes = Buffer.from('%PDF-1.4 hello');
  respond(() => json({ data: bytes.toString('base64url') }));
  const blob = await gmail.download({ messageId: 'm', attachmentId: 'a' });
  assert.equal(Buffer.from(await blob.arrayBuffer()).toString(), '%PDF-1.4 hello');
});

test('ข้อผิดพลาด HTTP -> SourceError ภาษาไทยพร้อม code', async () => {
  for (const [status, code] of [[401, 'AUTH'], [403, 'PERMISSION'], [404, 'NOT_FOUND'], [500, 'SERVER']]) {
    respond(() => json({}, status));
    await assert.rejects(() => drive.list({}), (e) => e instanceof SourceError && e.code === code && /[ก-๙]/.test(e.message));
  }
});

test('401 ทิ้ง token ที่แคชไว้ เพื่อขอใหม่ครั้งหน้า', async () => {
  removed = [];
  respond(() => json({}, 401));
  await assert.rejects(() => drive.list({}));
  assert.deepEqual(removed, ['tok-1']);
});

test('429 ลองซ้ำหนึ่งครั้ง แล้วสำเร็จ', async () => {
  let n = 0;
  respond(() => (++n === 1 ? json({}, 429) : json({ files: [], nextPageToken: '' })));
  const r = await drive.list({});
  assert.equal(n, 2);
  assert.deepEqual(r.items, []);
});

test('Drive: ตัดอักขระอันตรายในคำค้น, กรองวันที่, แบ่งหน้า', async () => {
  calls = [];
  respond(() => json({ files: [{ id: 'f1', name: 'ก.pdf', modifiedTime: '2026-10-01T00:00:00Z', size: '2048' }], nextPageToken: 'P2' }));
  const r = await drive.list({ query: "x' or name contains 'y", days: 7, cursor: 'P1' });
  const u = decodeURIComponent(calls[0]);
  assert.ok(!u.includes("x' or"), 'ต้องไม่ให้เครื่องหมาย \' ทะลุเข้า query');
  assert.match(u, /modifiedTime > '/);
  assert.match(u, /pageToken=P1/);
  assert.equal(r.items[0].size, 2048);
  assert.equal(r.nextCursor, 'P2');
});

test('checkPdf: รับ PDF, ปฏิเสธไฟล์อื่นและไฟล์ใหญ่เกิน', async () => {
  await checkPdf(new Blob(['%PDF-1.7\n...']));
  await checkPdf(new Blob(['junk\n%PDF-1.4 x'])); // มี header ภายใน 1024 ไบต์แรก
  await assert.rejects(() => checkPdf(new Blob(['<html>not pdf</html>'])), { code: 'BAD_FILE' });
  await assert.rejects(() => checkPdf(new Blob([new Uint8Array(MAX_BYTES + 1)])), { code: 'BAD_FILE' });
});

test('history: จำรายการ, ไม่ซ้ำ, จำกัด 500', async () => {
  await markDone({ source: 'gmail', id: 'a' });
  await markDone({ source: 'gmail', id: 'a' });
  assert.equal((await doneSet()).size, 1);
  for (let i = 0; i < 520; i++) await markDone({ source: 'drive', id: String(i) });
  const s = await doneSet();
  assert.equal(s.size, 500);
  assert.ok(s.has('drive:519') && !s.has('gmail:a'));
});
