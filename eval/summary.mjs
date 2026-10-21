// ตรวจคุณภาพ "สรุปเรื่อง" (ใบปะหน้า) แบบอัตโนมัติ: สรุปด้วยตัวเลขตรงๆ ไม่ได้ จึงวัดเฉพาะสิ่งที่ตรวจได้แน่นอน
//   1) ไม่ยาวเกินกรอบ  2) เป็นภาษาไทย  3) ตัวเลข/วันที่ในสรุปต้องมีอยู่ในเอกสารต้นฉบับ (กันแต่งเอง)
//   4) ใจความสำคัญครบ (key_points ใน samples/expected.json: แต่ละข้อเป็นรายการคำที่ยอมรับได้ ถ้าเจอคำใดคำหนึ่งนับว่าครบ)
// ผ่านการตรวจเหล่านี้ไม่ได้แปลว่าสรุปดี — ยังต้องให้เจ้าหน้าที่อ่านตัวอย่างจริง (ดู docs/PLAN-admin-backend-summary.md ข้อ C.4)
import { toArabic } from '../lib/mapping.js';

// เทียบแบบไม่สนช่องว่าง/ตัวพิมพ์/จุลภาคในตัวเลข และแปลงเลขไทยเป็นอารบิก
export const norm = (s) => toArabic(String(s ?? '')).normalize('NFC').toLowerCase().replace(/(\d),(?=\d{3})/g, '$1').replace(/\s+/g, '');

export function thaiRatio(s) {
  const letters = String(s).match(/[ก-ฮA-Za-z]/g) || [];
  if (!letters.length) return 0;
  return letters.filter((c) => c >= 'ก' && c <= 'ฮ').length / letters.length;
}

// ตัวเลขตั้งแต่ 2 หลักขึ้นไป (ตัดจุลภาคคั่นหลักพัน) เช่น "15,000" -> "15000"
export function numbersIn(s) {
  return [...toArabic(String(s)).matchAll(/\d[\d,]*\d/g)].map((m) => m[0].replace(/,/g, ''));
}

export function checkSummary({ summary, source, max = Infinity, keyPoints }) {
  const text = String(summary ?? '').trim();
  const out = { length: text.length, max, empty: !text, overMax: text.length > max, thai: Number(thaiRatio(text).toFixed(2)), ungrounded: null, recall: null };
  out.notThai = !!text && out.thai < 0.5;
  if (source != null) {
    const src = norm(source);
    out.ungrounded = numbersIn(text).filter((n) => !src.includes(n));
  }
  if (Array.isArray(keyPoints) && keyPoints.length) {
    const t = norm(text);
    const missed = keyPoints.filter((alts) => !alts.some((a) => t.includes(norm(a))));
    out.recall = { hit: keyPoints.length - missed.length, total: keyPoints.length, missed: missed.map((a) => a[0]) };
  }
  out.pass = !out.empty && !out.overMax && !out.notThai && (out.ungrounded === null || out.ungrounded.length === 0) && (out.recall === null || out.recall.hit === out.recall.total);
  return out;
}
