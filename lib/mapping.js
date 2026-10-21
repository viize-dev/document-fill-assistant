// ส่วนกลางที่ไม่ผูกกับระบบใด: แปลงค่า, สร้างแถวให้ตรวจ, แปลงเป็นค่าที่กรอกฟอร์ม
// ทุกฟังก์ชันรับ profile (ดู profiles/saraban.js) เป็นพารามิเตอร์

const THAI_DIGITS = '๐๑๒๓๔๕๖๗๘๙';
export const toArabic = (s) => String(s ?? '').replace(/[๐-๙]/g, (d) => THAI_DIGITS.indexOf(d));

const MONTHS = [
  ['มกราคม', 'ม.ค.'], ['กุมภาพันธ์', 'ก.พ.'], ['มีนาคม', 'มี.ค.'], ['เมษายน', 'เม.ย.'],
  ['พฤษภาคม', 'พ.ค.'], ['มิถุนายน', 'มิ.ย.'], ['กรกฎาคม', 'ก.ค.'], ['สิงหาคม', 'ส.ค.'],
  ['กันยายน', 'ก.ย.'], ['ตุลาคม', 'ต.ค.'], ['พฤศจิกายน', 'พ.ย.'], ['ธันวาคม', 'ธ.ค.'],
];
const EN_MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const pad = (n) => String(n).padStart(2, '0');
const DEFAULT_FORMAT = { era: 'BE', pattern: 'dd/mm/yyyy' };

function monthIndex(name) {
  const t = name.toLowerCase().replace(/\./g, '');
  const th = MONTHS.findIndex(([full, abbr]) => name === full || name === abbr || t === abbr.replace(/\./g, ''));
  if (th >= 0) return th;
  return EN_MONTHS.findIndex((m) => t.startsWith(m));
}

// -> { d, m, y } โดย y เป็น ค.ศ. หรือ null
export function parseDate(input, fmt = DEFAULT_FORMAT) {
  const s = toArabic(input).trim();
  if (!s) return null;
  let d, m, y;
  let match = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match) [, y, m, d] = match;
  else if ((match = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})$/))) [, d, m, y] = match;
  else if ((match = s.match(/^(\d{1,2})\s*([^\d\s]+)\s*(\d{2,4})$/))) {
    const idx = monthIndex(match[2]);
    if (idx < 0) return null;
    [, d, , y] = match;
    m = idx + 1;
  } else return null;
  d = Number(d);
  m = Number(m);
  y = Number(y);
  if (y < 100) y += fmt.era === 'BE' ? 2500 : 2000;
  if (y >= 2400) y -= 543; // ปีที่ดูเป็น พ.ศ.
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return { d, m, y };
}

// "19 กรกฎาคม 2569" (ปีตาม era ของ profile)
export function formatThaiLongDate({ d, m, y }, fmt = DEFAULT_FORMAT) {
  return `${d} ${MONTHS[m - 1][0]} ${fmt.era === 'BE' ? y + 543 : y}`;
}

export function formatDate({ d, m, y }, fmt = DEFAULT_FORMAT) {
  const year = fmt.era === 'BE' ? y + 543 : y;
  return fmt.pattern.replace('dd', pad(d)).replace('mm', pad(m)).replace('yyyy', String(year));
}

// คืน '' ถ้าแปลงไม่ได้
export function normalizeDate(input, fmt = DEFAULT_FORMAT) {
  const p = parseDate(input, fmt);
  return p ? formatDate(p, fmt) : '';
}

// ค่าจากโมเดล -> ค่าที่ฟอร์มรับได้ ตามนิยามฟิลด์ใน profile
export function normalizeValue(profile, key, raw) {
  const def = profile.fields[key];
  const v = raw == null ? '' : String(raw).trim();
  if (!def) return v;
  if (def.kind === 'date') return normalizeDate(v, profile.dateFormat) || v;
  if (def.kind === 'select') {
    const hit = def.options.find(([code, label]) => v === code || v === label);
    return hit ? hit[0] : (def.fallback ?? def.options[0][0]);
  }
  if (def.digits === 'arabic') return toArabic(v);
  return v;
}

// ตัดข้อความไทยที่ขอบเขตคำ (Intl.Segmenter) ไม่เกิน max ตัวอักษร ต่อท้าย … ถ้าถูกตัด
export function truncateThai(text, max) {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!max || s.length <= max) return s;
  let out = '';
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    for (const { segment } of new Intl.Segmenter('th', { granularity: 'word' }).segment(s)) {
      if ((out + segment).length > max - 1) break;
      out += segment;
    }
  } else out = s.slice(0, max - 1);
  return `${out.trimEnd()}…`;
}

export function docTypeKey(profile, key) {
  return profile.docTypes[key] ? key : profile.fallbackDocType;
}

// ผลจากโมเดล -> รายการแสดงให้ผู้ใช้ตรวจ [{key,label,kind,options,value,confidence}]
export function buildRows(profile, docType, extracted) {
  const type = profile.docTypes[docTypeKey(profile, docType)];
  const fields = extracted?.fields || {};
  const conf = extracted?.field_confidence || {};
  return type.fields.map((key) => {
    const def = profile.fields[key];
    const raw = def.fromSummary ? fields[key] || extracted?.summary || '' : fields[key];
    return {
      key,
      label: def.label,
      kind: def.kind,
      options: def.options,
      value: normalizeValue(profile, key, raw),
      confidence: typeof conf[key] === 'number' ? conf[key] : null,
    };
  });
}

// แถว -> ค่าที่ส่งให้ content script กรอก (รวมช่อง "ประเภทเอกสาร" ถ้า profile มี)
export function rowsToFormValues(profile, docType, rows) {
  const out = {};
  const type = profile.docTypes[docTypeKey(profile, docType)];
  if (profile.fields.doc_type && type.formValue) out.doc_type = type.formValue;
  rows.forEach((r) => {
    const def = profile.fields[r.key];
    if (r.value === '' || def?.fill === false) return;
    // fillBy: 'label' = ส่งข้อความของตัวเลือก (เช่น "ด่วน") แทนรหัส สำหรับระบบที่ตัวเลือกต่างจากรหัสของเรา
    out[r.key] = def?.fillBy === 'label' ? def.options?.find(([code]) => code === r.value)?.[1] ?? r.value : r.value;
  });
  return out;
}

// selector ทั้งหมดที่ content script ต้องรู้ { key: selector }
export function fieldSelectors(profile) {
  return Object.fromEntries(Object.entries(profile.fields).filter(([, f]) => f.selector).map(([k, f]) => [k, f.selector]));
}
