// ส่งออก profile เป็น JSON ให้ backend (doc-fill-backend) ใช้สร้าง prompt ฝั่งเซิร์ฟเวอร์
// ใช้: node scripts/export-profiles.mjs ../doc-fill-backend/profiles
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROFILES } from '../profiles/index.js';

const dir = process.argv[2];
if (!dir) {
  console.error('ใช้: node scripts/export-profiles.mjs <โฟลเดอร์ปลายทาง>');
  process.exit(1);
}
mkdirSync(dir, { recursive: true });
for (const p of PROFILES) {
  // เก็บเฉพาะส่วนที่ใช้สร้าง prompt/ตรวจผล (ไม่ส่ง selector ของหน้าเว็บ)
  const out = {
    id: p.id,
    name: p.name,
    documentKind: p.documentKind,
    docTypes: Object.fromEntries(Object.entries(p.docTypes).map(([k, t]) => [k, { label: t.label, ask: t.ask, fields: t.fields }])),
    fields: Object.fromEntries(Object.entries(p.fields).map(([k, f]) => [k, { label: f.label, kind: f.kind, ask: f.ask, options: f.options, fromSummary: f.fromSummary }])),
  };
  writeFileSync(join(dir, `${p.id}.json`), `${JSON.stringify(out, null, 2)}\n`);
  console.log(`เขียน ${join(dir, `${p.id}.json`)}`);
}
