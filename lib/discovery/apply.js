// แปลงค่าจากแถวผลลัพธ์ -> ค่าที่ช่องที่ตรวจพบรับได้ (ใช้เมื่อกรอกผ่านการจับคู่อัตโนมัติ)
import { parseDate } from '../mapping.js';

const pad = (n) => String(n).padStart(2, '0');

// entry = รายการจับคู่ (field, optionMap), def = ฟิลด์ใน profile, value = ค่าในแถว
// คืน null ถ้าแปลงไม่ได้ (ไม่ควรกรอก)
export function valueForField(entry, def, value, profile) {
  const v = String(value ?? '').trim();
  if (!v) return null;
  if (def.kind === 'select') return entry.optionMap?.[v] ?? null;
  if (def.kind === 'date' && entry.field.inputType === 'date') {
    const d = parseDate(v, profile.dateFormat);
    return d ? `${d.y}-${pad(d.m)}-${pad(d.d)}` : null; // <input type=date> รับเฉพาะ yyyy-mm-dd (ค.ศ.)
  }
  return v;
}

// รายการจับคู่ที่เลือกกรอก -> { selectors, values } สำหรับข้อความ FILL
export function buildFillPayload(entries, profile, rows, { only = null } = {}) {
  const selectors = {};
  const values = {};
  const skipped = [];
  for (const e of entries) {
    if (only ? e.key !== only : !e.confirmed) continue;
    const row = rows.find((r) => r.key === e.key);
    const def = profile.fields[e.key];
    if (!row || !def || def.fill === false) continue;
    const v = valueForField(e, def, row.value, profile);
    if (v === null) {
      if (String(row.value ?? '').trim()) skipped.push({ key: e.key, reason: def.kind === 'select' ? `ช่องนี้ไม่มีตัวเลือกที่ตรงกับ "${row.value}"` : 'แปลงค่าไม่ได้' });
      continue;
    }
    selectors[e.key] = e.selector;
    values[e.key] = v;
  }
  return { selectors, values, skipped };
}
