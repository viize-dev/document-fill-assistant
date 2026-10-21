import { formatThaiLongDate, parseDate } from './mapping.js';

// ใบปะหน้า "แบบกลาง": เลย์เอาต์อยู่ใน cover.js/cover.css ส่วนที่แต่ละระบบ/หน่วยปรับได้อยู่ใน profile.cover
// (unit = ชื่อหน่วยที่หัวกระดาษ, options = ตัวเลือกให้ติ๊ก, ป้ายต่างๆ, จำนวนบรรทัดเขียนความเห็น)
export const DEFAULT_COVER = {
  unit: '',
  eNoLabel: 'เลขที่เอกสารในระบบ E', // เลข E ของสารบรรณ (มุมขวาบน) ว่างไว้ถ้าไม่มีในเอกสาร
  receiptLabel: 'รับที่',
  dateLabel: 'วันที่',
  subjectLabel: 'เรื่อง',
  routeLabel: 'เรียน',
  options: [
    // match = คำในประโยคปิดท้ายของเอกสารที่ทำให้ติ๊กตัวเลือกนี้ให้อัตโนมัติ (ผู้ใช้แก้ได้บนใบปะหน้า)
    { id: 'consider', label: 'เพื่อโปรดพิจารณา', match: ['พิจารณา'] },
    { id: 'proceed', label: 'เพื่อโปรดดำเนินการ', match: ['ดำเนินการ'] },
    { id: 'inform', label: 'เพื่อโปรดทราบ', match: ['ทราบ'] },
  ],
  dueLabel: 'วันที่กำหนด',
  noteLabel: 'หมายเหตุ',
  footerLabel: '', // ป้ายใต้กรอบด้านขวา (ถ้าต้องการ)
  lines: 10, // จำนวนบรรทัดเขียนความเห็น/ลายเซ็น
  receiptFrom: ['reg_no'], // ค่าที่อ่านจากหน้าปลายทางมาเป็น "รับที่"
};

// เทียบข้อความไทยแบบไม่สนช่องว่าง/สระ/วรรณยุกต์ (OCR มักทำสิ่งเหล่านี้เพี้ยน)
const loose = (s) => String(s ?? '').replace(/[\s\u0E31\u0E34-\u0E3A\u0E47-\u0E4E\uFFFD]/g, '');

const pad = (n) => String(n).padStart(2, '0');

// ข้อมูลที่ดึงได้ + ค่าที่อ่านจากหน้าปลายทาง -> โมเดลสำหรับ cover.js (ผู้ใช้แก้ไขบนหน้าใบปะหน้าได้ก่อนพิมพ์)
export function buildCover(profile, ctx) {
  const c = { ...DEFAULT_COVER, ...(profile.cover || {}) };
  const { fields = {}, form = {}, unit } = ctx;

  // วันที่รับ: ใช้ค่าจากหน้าปลายทางถ้ามี ไม่มีใช้วันนี้ แสดงเป็นแบบยาว
  const parsed = parseDate(form.recv_date || '', profile.dateFormat);
  const now = new Date();
  const date = formatThaiLongDate(parsed || { d: now.getDate(), m: now.getMonth() + 1, y: now.getFullYear() }, profile.dateFormat);

  // วันที่กำหนดจากเอกสาร: อ่านเป็นวันที่ได้ -> แบบยาว ไม่ได้ก็ใช้ข้อความเดิม
  const dueParsed = parseDate(fields.deadline || '', profile.dateFormat);
  const due = dueParsed ? formatThaiLongDate(dueParsed, profile.dateFormat) : fields.deadline || '';
  // ประโยคปิดท้าย (+ สิ่งที่ขอให้ดำเนินการ) -> ติ๊กตัวเลือกที่ตรงให้ก่อน
  const intent = loose(`${fields.closing || ''} ${ctx.requestedAction || ''}`);

  return {
    unit: unit || c.unit,
    eNoLabel: c.eNoLabel,
    eNo: fields.e_no || '',
    receiptLabel: c.receiptLabel,
    receiptNo: c.receiptFrom.map((k) => form[k]).filter(Boolean).join(' '),
    dateLabel: c.dateLabel,
    date,
    subjectLabel: c.subjectLabel,
    subject: fields.subject || '',
    routeLabel: c.routeLabel,
    route: fields.to || '',
    options: c.options.map((o) => ({ id: o.id, label: o.label, checked: (o.match || []).some((w) => intent.includes(loose(w))) })),
    summary: fields.summary || '', // ไม่จำกัดความยาว (กรอบสรุปขยายตามเนื้อหา)
    dueLabel: c.dueLabel,
    due,
    noteLabel: c.noteLabel,
    note: '',
    footerLabel: c.footerLabel,
    lines: c.lines,
    createdAt: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
  };
}
