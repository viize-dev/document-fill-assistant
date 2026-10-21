// ทดสอบการตรวจจับช่อง: ใช้ jsdom จาก eval/ (ถ้ายังไม่ได้ติดตั้งจะข้าม: cd eval && npm install)
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { PROFILES } from '../profiles/index.js';
import { matchSnapshot, classifyPage, formSignature, normText, mapOptions } from '../lib/discovery/match.js';
import { saveLearned, loadAll, pickLearned, forgetLearned } from '../lib/discovery/learned.js';
import { buildFillPayload, valueForField } from '../lib/discovery/apply.js';
import { buildRows } from '../lib/mapping.js';

let JSDOM;
try {
  JSDOM = createRequire(new URL('../eval/package.json', import.meta.url))('jsdom').JSDOM;
} catch {
  /* ไม่มี jsdom */
}
const skip = JSDOM ? false : 'ต้องติดตั้ง jsdom ใน eval/ (cd eval && npm install)';

const demo = PROFILES.find((p) => p.id === 'saraban-demo');

let scanner;
async function load(html) {
  const dom = new JSDOM(`<!doctype html><body>${html}</body>`, { url: 'https://sys.example/form', pretendToBeVisual: true });
  const { window } = dom;
  // jsdom ไม่คำนวณ layout: ถือว่าทุกองค์ประกอบมีขนาด (display:none ยังถูกตรวจจาก style)
  window.Element.prototype.getBoundingClientRect = () => ({ width: 120, height: 24, top: 0, left: 0, right: 120, bottom: 24 });
  globalThis.document = window.document;
  globalThis.location = window.location;
  globalThis.window = window;
  if (!scanner) {
    await import('../lib/discovery/scan.js');
    scanner = globalThis.__docFillScan;
  }
  return { window, scan: (known) => scanner.scan(known) };
}

const keyMap = (res) => Object.fromEntries(res.entries.map((e) => [e.key, e.field.id || e.field.name]));
const levelOf = (res, key) => res.entries.find((e) => e.key === key)?.level;

const TABLE = `
<table>
 <tr><td>เลขที่หนังสือ *</td><td><input id="a1" name="x1" type="text"></td></tr>
 <tr><td>ลงวันที่</td><td><input id="a2" name="x2" class="datepicker"></td></tr>
 <tr><td>ส่วนราชการเจ้าของเรื่อง</td><td><input id="a3" name="x3"></td></tr>
 <tr><td>เรียน</td><td><input id="a4" name="x4"></td></tr>
 <tr><td>ชื่อเรื่อง</td><td><textarea id="a5" name="x5"></textarea></td></tr>
 <tr><td>รายละเอียด</td><td><textarea id="a6" name="x6"></textarea></td></tr>
 <tr><td>อ้างถึง</td><td><input id="a7" name="x7"></td></tr>
 <tr><td>สิ่งที่ส่งมาด้วย</td><td><input id="a8" name="x8"></td></tr>
 <tr><td>ชั้นความเร็ว</td><td><select id="a9" name="x9"><option value="1">ปกติ</option><option value="2">ด่วน</option><option value="3">ด่วนมาก</option><option value="4">ด่วนที่สุด</option></select></td></tr>
 <tr><td>ชั้นความลับ</td><td><select id="a10" name="x10"><option value="1">ปกติ</option><option value="2">ลับ</option><option value="3">ลับมาก</option><option value="4">ลับที่สุด</option></select></td></tr>
 <tr><td>เลขทะเบียนรับ</td><td><input id="reg" name="reg"></td></tr>
 <tr><td>วันที่รับ</td><td><input id="recv" name="recv"></td></tr>
</table>`;

test('ตารางป้ายไทยคนละคำกับ profile: จับคู่ถูกทุกช่อง และเลขรับ/วันที่รับไม่ถูกจับผิด', { skip }, async () => {
  const { scan } = await load(TABLE);
  const res = matchSnapshot(scan(), demo);
  assert.deepEqual(keyMap(res), { doc_no: 'a1', doc_date: 'a2', from: 'a3', to: 'a4', subject: 'a5', detail: 'a6', ref: 'a7', attachments: 'a8', speed: 'a9', secret: 'a10' });
  for (const k of Object.keys(keyMap(res))) assert.equal(levelOf(res, k), 'high', k);
  assert.deepEqual(res.unmatched.map((f) => f.id).sort(), ['recv', 'reg']);
});

test('ตัวเลือก select: map รหัสกลาง -> ค่าของหน้า (ค่าภายในต่างจากรหัสของเรา)', { skip }, async () => {
  const { scan } = await load(TABLE);
  const res = matchSnapshot(scan(), demo);
  const speed = res.entries.find((e) => e.key === 'speed');
  assert.deepEqual(speed.optionMap, { normal: '1', urgent: '2', very_urgent: '3', most_urgent: '4' });
  const secret = res.entries.find((e) => e.key === 'secret');
  assert.equal(secret.optionMap.most_secret, '4');
});

test('ป้ายอยู่ในคอลัมน์พี่น้อง (bootstrap) และ placeholder อย่างเดียว', { skip }, async () => {
  const { scan } = await load(`
   <div class="row"><div class="col-2">หัวเรื่อง :</div><div class="col-10"><input id="s"></div></div>
   <div class="row"><label class="col-2" for="n">หนังสือเลขที่</label><div class="col-10"><input id="n"></div></div>
   <div><input id="p" placeholder="ผู้ส่ง"></div>
   <div><input id="q" placeholder="อ้างอิง"></div>`);
  const res = matchSnapshot(scan(), demo);
  assert.equal(res.entries.find((e) => e.key === 'subject').field.id, 's');
  assert.equal(res.entries.find((e) => e.key === 'doc_no').field.id, 'n');
  assert.equal(res.entries.find((e) => e.key === 'from').field.id, 'p');
  assert.equal(res.entries.find((e) => e.key === 'ref').field.id, 'q');
});

test('ไม่มีป้ายแต่ชื่อช่องเป็นอังกฤษ (txtSubject, ctl00_docNo) ได้ระดับกลาง ไม่ใช่สูง', { skip }, async () => {
  const { scan } = await load(`<input id="txtSubject"><input id="ctl00_docNo"><input id="zzz">`);
  const res = matchSnapshot(scan(), demo);
  assert.equal(res.entries.find((e) => e.key === 'subject').field.id, 'txtSubject');
  assert.equal(res.entries.find((e) => e.key === 'doc_no').field.id, 'ctl00_docNo');
  assert.notEqual(levelOf(res, 'subject'), 'high');
  assert.ok(!res.entries.some((e) => e.field.id === 'zzz'));
});

test('ป้ายกำกวม: "รายละเอียดเรื่อง" ไม่ถูกจัดเป็นระดับสูง', { skip }, async () => {
  const { scan } = await load(`<label>รายละเอียดเรื่อง <input id="x"></label>`);
  const res = matchSnapshot(scan(), demo);
  for (const e of res.entries) assert.notEqual(e.level, 'high', e.key);
});

test('select2: select ที่ถูกซ่อนแต่มี .select2-container ที่เห็น ถือว่าใช้ได้', { skip }, async () => {
  const { scan } = await load(`
   <label for="pr">ชั้นความเร็ว</label>
   <select id="pr" class="select2-hidden-accessible" style="display:none"><option>ปกติ</option><option>ด่วน</option><option>ด่วนมาก</option><option>ด่วนที่สุด</option></select>
   <span class="select2-container"></span>`);
  const snap = scan();
  const f = snap.fields.find((x) => x.id === 'pr');
  assert.equal(f.widget, 'select2');
  assert.equal(f.visible, true);
  const res = matchSnapshot(snap, demo);
  assert.equal(res.entries.find((e) => e.key === 'speed').optionMap.urgent, 'ด่วน');
});

test('ช่องอ่อนไหว/ซ่อน/ปิดใช้งาน/อ่านอย่างเดียว ไม่ถูกจับคู่ และไม่เก็บค่า', { skip }, async () => {
  const { scan } = await load(`
   <label>เรื่อง <input id="subj" value="ความลับของผู้ใช้" readonly></label>
   <label>รหัสผ่าน <input id="pw" type="password" value="hunter2"></label>
   <input type="hidden" id="h" value="tok"><input id="otp" name="otp">
   <label>จาก <input id="fr" disabled></label>`);
  const snap = scan();
  const text = JSON.stringify(snap);
  assert.ok(!text.includes('hunter2') && !text.includes('ความลับของผู้ใช้') && !text.includes('"tok"'), 'ต้องไม่มีค่าที่พิมพ์ไว้ใน snapshot');
  assert.ok(!snap.fields.some((f) => ['pw', 'h', 'otp'].includes(f.id)));
  const res = matchSnapshot(snap, demo);
  assert.equal(res.entries.length, 0);
});

test('ช่องใน shadow DOM และ iframe เดียวกันโดเมน ได้ selector แบบ >>> ที่ resolve กลับได้', { skip }, async () => {
  const { window, scan } = await load(`<div id="host"></div><iframe id="fr"></iframe>`);
  const sr = window.document.getElementById('host').attachShadow({ mode: 'open' });
  sr.innerHTML = '<label>เรื่อง <input id="in-shadow"></label>';
  const inner = window.document.getElementById('fr').contentDocument;
  inner.body.innerHTML = '<label>เรียน <input id="in-frame"></label>';
  const snap = scan();
  const a = snap.fields.find((f) => f.id === 'in-shadow');
  const b = snap.fields.find((f) => f.id === 'in-frame');
  assert.ok(a.selector.includes(' >>> ') && b.selector.includes(' >>> '));
  assert.equal(scanner.resolve(a.selector), sr.getElementById('in-shadow'));
  assert.equal(scanner.resolve(b.selector), inner.getElementById('in-frame'));
});

test('profileKeys: ช่องที่ตรงกับ selector ของ profile ถูกจับคู่ด้วยชั้น profile ก่อน (แม้ไม่มีป้าย)', { skip }, async () => {
  const { scan } = await load(`<input data-field="subject" id="q1"><input data-field="from" id="q2">`);
  const snap = scan({ subject: '[data-field="subject"]', from: '[data-field="from"]' });
  const res = matchSnapshot(snap, demo);
  assert.equal(res.entries.find((e) => e.key === 'subject').source, 'profile');
  assert.equal(levelOf(res, 'from'), 'high');
});

test('ลายเซ็นฟอร์ม: ช่องชุดเดิมได้ค่าเดิม เปลี่ยนช่องแล้วเปลี่ยนค่า', { skip }, async () => {
  const a = (await load(TABLE)).scan();
  const a2 = (await load(TABLE)).scan();
  const b = (await load(TABLE.replace('อ้างถึง', 'อ้างอิงถึงหนังสือ'))).scan();
  assert.equal(formSignature(a), formSignature(a2));
  assert.notEqual(formSignature(a), formSignature(b));
});

function memStore() {
  const data = {};
  return { get: async (k) => (k in data ? { [k]: data[k] } : {}), set: async (o) => Object.assign(data, o) };
}

test('ความจำ: ผู้ใช้ยืนยันแล้วบันทึก หน้าเดิมกลับมาจับคู่ถูก; หน้าเปลี่ยนเล็กน้อยแจ้ง changed ระดับกลาง', { skip }, async () => {
  // หน้าที่ป้ายไม่ตรงพจนานุกรม ("ประเด็น") ต้องให้ผู้ใช้ผูกเอง แล้วจำไว้
  const html = `<label>ประเด็น <input id="t1" name="t1"></label><label>เลขที่หนังสือ <input id="t2" name="t2"></label><label>อื่น <input id="t3" name="t3"></label>`;
  const { scan } = await load(html);
  const snap = scan();
  const first = matchSnapshot(snap, demo);
  assert.ok(!first.entries.some((e) => e.key === 'subject'));
  const manual = { key: 'subject', field: snap.fields.find((f) => f.id === 't1'), selector: '#t1', confirmed: true };
  const store = memStore();
  await saveLearned(store, { origin: 'https://sys.example', signature: formSignature(snap), profileId: demo.id, entries: [manual, { ...first.entries[0], confirmed: false }] });
  const all = await loadAll(store);

  // หน้าเดิม
  const l1 = pickLearned(all, 'https://sys.example', formSignature(snap), snap, demo.id);
  assert.equal(l1.changed, false);
  const r1 = matchSnapshot(snap, demo, { learned: l1 });
  assert.equal(r1.entries.find((e) => e.key === 'subject').field.id, 't1');
  assert.equal(levelOf(r1, 'subject'), 'high');

  // หน้าเพิ่มช่องใหม่: signature ต่าง แต่ยังเหลื่อมกันมาก
  const { scan: scan2 } = await load(html + '<label>ใหม่ <input id="t4"></label>');
  const snap2 = scan2();
  const l2 = pickLearned(all, 'https://sys.example', formSignature(snap2), snap2, demo.id);
  assert.equal(l2.changed, true);
  assert.equal(levelOf(matchSnapshot(snap2, demo, { learned: l2 }), 'subject'), 'medium');

  // คนละ profile / คนละ origin ไม่ปนกัน
  assert.equal(pickLearned(all, 'https://sys.example', formSignature(snap), snap, 'other'), null);
  assert.equal(pickLearned(all, 'https://else.example', formSignature(snap), snap, demo.id), null);
  await forgetLearned(store, 'https://sys.example', formSignature(snap));
  assert.equal(pickLearned(await loadAll(store), 'https://sys.example', formSignature(snap), snap, demo.id), null);
});

test('ความจำ: ช่องที่เคยจำหายไป -> เตือน ไม่เดากรอกช่องอื่น', { skip }, async () => {
  const { scan } = await load(`<label>ประเด็น <input id="t1"></label>`);
  const snap = scan();
  const learned = { changed: false, map: { subject: { selector: '#gone', id: 'gone', name: '', label: 'หัวข้อเก่า' } } };
  const res = matchSnapshot(snap, demo, { learned });
  assert.ok(!res.entries.some((e) => e.key === 'subject'));
  assert.ok(res.warnings.some((w) => w.includes('หัวข้อเก่า')));
});

test('buildFillPayload: กรอกเฉพาะที่ยืนยัน, select ใช้ค่าของหน้า, วันที่แบบ <input type=date> เป็น ค.ศ. ISO, ไม่มีตัวเลือกที่ตรงจะไม่กรอก', { skip }, async () => {
  const { scan } = await load(`
   <label>เรื่อง <input id="s"></label>
   <label>ลงวันที่ <input id="d" type="date"></label>
   <label>ชั้นความเร็ว <select id="sp"><option value="n">ปกติ</option><option value="u">ด่วน</option><option value="vu">ด่วนมาก</option><option value="mu">ด่วนที่สุด</option></select></label>
   <label>ชั้นความลับ <select id="se"><option value="a">ใช่</option><option value="b">ไม่ใช่</option></select></label>`);
  const res = matchSnapshot(scan(), demo);
  const rows = buildRows(demo, 'external', { fields: { subject: 'ทดสอบ', doc_date: '05/08/2569', speed: 'very_urgent', secret: 'secret' } });
  const entries = res.entries.map((e) => ({ ...e, confirmed: e.key !== 'subject' }));
  const p = buildFillPayload(entries, demo, rows);
  assert.ok(!('subject' in p.values), 'ที่ยังไม่ยืนยันห้ามกรอก');
  assert.equal(p.values.doc_date, '2026-08-05');
  assert.equal(p.values.speed, 'vu');
  assert.ok(!('secret' in p.values));
  const one = buildFillPayload(entries, demo, rows, { only: 'subject' });
  assert.deepEqual(one.values, { subject: 'ทดสอบ' });
});

test('normText / mapOptions พื้นฐาน', () => {
  assert.equal(normText(' เรื่อง : * '), 'เรื่อง');
  assert.equal(normText('๑๒ A-b'), '12ab');
  const m = mapOptions(demo.fields.speed.options, [{ value: '', text: '-- เลือก --' }, { value: '1', text: 'ด่วนที่สุด' }, { value: '2', text: 'ด่วนมาก' }]);
  assert.deepEqual(m, { very_urgent: '2', most_urgent: '1' }, 'ด่วน ต้องไม่ไปจับ "ด่วนมาก/ด่วนที่สุด"');
});

test('valueForField: ค่าว่างไม่กรอก, ข้อความปกติผ่านตรงๆ', () => {
  assert.equal(valueForField({ field: { inputType: 'text' } }, demo.fields.subject, '  ', demo), null);
  assert.equal(valueForField({ field: { inputType: 'text' } }, demo.fields.subject, 'abc', demo), 'abc');
});

const SEARCH = `
<h2>ค้นหาหนังสือ</h2>
<label>เริ่มเลขทะเบียน <input id="s1"></label><label>ถึงเลขทะเบียน <input id="s2"></label>
<label>เลขที่หนังสือ <input id="s3"></label>
<label>เริ่มวันที่ <input id="s4"></label><label>ถึงวันที่ <input id="s5"></label>
<label>เริ่มเวลา <input id="s6"></label><label>ถึงเวลา <input id="s7"></label>
<label>จาก <input id="s8"></label><label>ถึง <input id="s9"></label>`;

test('แยกหน้าค้นหาออกจากฟอร์มกรอก: หัวเรื่อง "ค้นหา" หรือมีช่องช่วงหลายช่อง ไม่ใช่ฟอร์ม แม้มีช่อง เลขที่หนังสือ/จาก/ถึง', { skip }, async () => {
  const { scan } = await load(SEARCH);
  const snap = scan();
  assert.equal(snap.heading, 'ค้นหาหนังสือ');
  const res = matchSnapshot(snap, demo);
  assert.ok(res.entries.length >= 3, 'ตัวจับคู่เองจะจับได้ (จึงต้องมีตัวแยกหน้า)');
  assert.equal(classifyPage(snap, res).kind, 'search');
  // ไม่มีหัวเรื่อง ก็แยกได้จากช่องช่วง
  const noHead = { ...snap, heading: '' };
  assert.equal(classifyPage(noHead, res).kind, 'search');
});

test('หน้าฟอร์มกรอกหนังสือ: ได้ kind=form; หน้าที่มีช่องไม่พอ: unknown', { skip }, async () => {
  const { scan } = await load(`<h2>ลงรับ/สร้างเอกสาร</h2>${TABLE}`);
  const snap = scan();
  assert.equal(classifyPage(snap, matchSnapshot(snap, demo)).kind, 'form');
  const { scan: s2 } = await load('<h2>ตั้งค่า</h2><label>ชื่อ <input id="n"></label><label>เรื่อง <input id="r"></label>');
  const snap2 = s2();
  assert.equal(classifyPage(snap2, matchSnapshot(snap2, demo)).kind, 'unknown');
});

test('quickSig เปลี่ยนเมื่อสลับหน้าในหน้าเดิม (หัวเรื่อง/ชุดช่อง) แต่ไม่เปลี่ยนเมื่อแค่ค่าในช่องเปลี่ยน', { skip }, async () => {
  const { window } = await load(`<h2>ลงรับ</h2><input id="a"><input id="b">`);
  const a = scanner.quickSig();
  window.document.getElementById('a').value = 'พิมพ์อะไรสักอย่าง';
  assert.equal(scanner.quickSig(), a);
  window.document.querySelector('h2').textContent = 'ค้นหา';
  assert.notEqual(scanner.quickSig(), a);
  window.document.querySelector('h2').textContent = 'ลงรับ';
  window.document.body.insertAdjacentHTML('beforeend', '<input id="c">');
  assert.notEqual(scanner.quickSig(), a);
});
