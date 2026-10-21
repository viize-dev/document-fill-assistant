// โหลด profile (JSON) ที่ส่งออกจาก extension: ./profiles/*.json (สร้างด้วย scripts/export-profiles.mjs ที่รากของ repo)
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export function loadProfiles(dir = './profiles') {
  const out = {};
  let files = [];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  } catch {
    return out; // ไม่มีโฟลเดอร์ = ไม่มี profile (ใช้ได้เฉพาะโหมด prompt จากไคลเอนต์ถ้าเปิดไว้)
  }
  for (const f of files) {
    const p = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    if (!p.id || !p.docTypes || !p.fields) throw new Error(`profile ${f} ไม่ถูกต้อง`);
    out[p.id] = p;
  }
  return out;
}
