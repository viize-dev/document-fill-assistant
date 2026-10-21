// รัน: node --test "test/*.test.mjs"
import test from 'node:test';
import assert from 'node:assert/strict';
import { PROFILES, matchProfile } from '../profiles/index.js';
import { buildRows, fieldSelectors, rowsToFormValues } from '../lib/mapping.js';

test('เลือก profile อัตโนมัติจาก URL: เว็บจริงกรมชลฯ / เว็บ demo ในเครื่อง / เว็บอื่นไม่ตรง', () => {
  assert.equal(matchProfile('https://saraban.rid.go.th/saraban/index.html#')?.id, 'saraban-rid');
  assert.equal(matchProfile('http://localhost:4310/')?.id, 'saraban-demo');
  assert.equal(matchProfile('https://evil.example/saraban.rid.go.th/'), null);
  assert.equal(matchProfile('http://saraban.rid.go.th/'), null, 'ต้องเป็น https');
});

test('ทุก profile: ฟิลด์ที่กรอกได้มี selector, id ไม่ซ้ำ, ชนิด select มีตัวเลือก', () => {
  for (const p of PROFILES) {
    const sel = fieldSelectors(p);
    for (const [k, f] of Object.entries(p.fields)) {
      if (f.fill === false || f.internal) continue;
      assert.ok(sel[k], `${p.id}.${k} ไม่มี selector`);
      if (f.kind === 'select') assert.ok(f.options?.length, `${p.id}.${k} ไม่มีตัวเลือก`);
    }
    for (const t of Object.values(p.docTypes)) for (const k of t.fields) assert.ok(p.fields[k], `${p.id}: docType อ้างฟิลด์ที่ไม่มี ${k}`);
    assert.equal(new Set(Object.values(sel)).size, Object.keys(sel).length, `${p.id}: selector ซ้ำกัน`);
  }
});

test('saraban-rid: ส่งข้อความไทยของตัวเลือก (fillBy label) และไม่แตะช่องประเภทเอกสาร', () => {
  const p = PROFILES.find((x) => x.id === 'saraban-rid');
  const rows = buildRows(p, 'external', { fields: { doc_no: 'ศธ 1/2', speed: 'very_urgent', secret: 'most_secret' } });
  const out = rowsToFormValues(p, 'external', rows);
  assert.equal(out.speed, 'ด่วนมาก');
  assert.equal(out.secret, 'ลับที่สุด');
  assert.ok(!('doc_type' in out), 'ต้องไม่ตั้งประเภทเอกสาร');
  assert.ok(!('e_no' in out) && !('summary' in out), 'ช่องที่ใช้เฉพาะใบปะหน้าต้องไม่ถูกกรอก');
});

test('saraban-demo ยังส่งรหัสตัวเลือกเหมือนเดิม', () => {
  const p = PROFILES.find((x) => x.id === 'saraban-demo');
  const out = rowsToFormValues(p, 'external', buildRows(p, 'external', { fields: { speed: 'urgent' } }));
  assert.equal(out.speed, 'urgent');
  assert.equal(out.doc_type, 'external');
});

test('saraban-rid: ไม่ตรวจหน้าค้นหาหนังสือ (id ชุดเดียวกัน) เป็นฟอร์มกรอก', () => {
  const p = PROFILES.find((x) => x.id === 'saraban-rid');
  // เลียนแบบ DETECT ของ content.js
  const detect = (ids) => {
    const has = (s) => ids.includes(s.replace('#', ''));
    return p.detect.some(has) && (p.detectAll || []).every(has) && !(p.detectNot || []).some(has);
  };
  assert.equal(detect(['txtwid', 'txtwsubject', 'txtwdate', 'selwtype']), true, 'หน้าลงรับ');
  assert.equal(detect(['txtwid', 'txtwsubject', 'txtfdate', 'txttdate', 'txtfrom', 'txtto']), false, 'หน้าค้นหา');
});
