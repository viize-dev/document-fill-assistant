// Saraban กรมชลประทาน (https://saraban.rid.go.th/saraban/index.html) หน้า "ลงรับ/สร้างเอกสาร"
// selector ได้จากการสำรวจหน้าจริง 2026-10-21 (อ่านโครงสร้างและกรอกค่าสมมติโดยไม่บันทึก) — ถ้าระบบอัปเดตหน้าต้องตรวจใหม่
// ไม่แตะช่อง "ประเภทเอกสาร" (selwtype): ยังไม่ได้ทดสอบว่าเปลี่ยนแล้วฟอร์มโหลดใหม่หรือไม่
import base from './saraban.js';

const id = (name) => `#${name}`;
const { doc_type: _unused, ...baseFields } = base.fields;

const withSelector = (key, selector, extra = {}) => ({ ...baseFields[key], selector, ...extra });

const docTypes = Object.fromEntries(
  Object.entries(base.docTypes).map(([k, t]) => {
    const { formValue: _fv, ...rest } = t; // ไม่ตั้งประเภทเอกสารในฟอร์ม
    return [k, rest];
  }),
);

export default {
  ...base,
  id: 'saraban-rid',
  name: 'Saraban กรมชลประทาน (saraban.rid.go.th)',
  urlPatterns: ['https://saraban.rid.go.th/*'],
  detect: ['#txtwid', '#txtwsubject'],
  // หน้า "ค้นหาหนังสือ" ใช้ id txtwid/txtfrom/txtto/txtwsubject ชุดเดียวกัน (สำรวจ 2026-10-21) ต้องไม่ถูกนับเป็นฟอร์มกรอก:
  // ฟอร์มกรอกมี ลงวันที่ (txtwdate) + ประเภทเอกสาร (selwtype) ส่วนหน้าค้นหามีช่วงวันที่ txtfdate
  detectAll: ['#txtwdate', '#selwtype'],
  detectNot: ['#txtfdate'],
  fields: {
    ...baseFields,
    doc_no: withSelector('doc_no', id('txtwid')),
    doc_date: withSelector('doc_date', id('txtwdate')),
    from: withSelector('from', id('txtfrom')),
    to: withSelector('to', id('txtto')),
    subject: withSelector('subject', id('txtwsubject')),
    detail: withSelector('detail', id('txtwdsc')),
    ref: withSelector('ref', id('txtref')),
    attachments: withSelector('attachments', id('txtattach')),
    // ตัวเลือกในระบบจริงเป็นข้อความไทย (ปกติ/ด่วน/ด่วนมาก/ด่วนที่สุด, ปกติ/ลับ/ลับมาก/ลับที่สุด) ส่งเป็นข้อความ
    speed: withSelector('speed', id('selpriority'), { fillBy: 'label' }),
    secret: withSelector('secret', id('selseclev'), { fillBy: 'label' }),
  },
  docTypes,
  readOnly: {
    reg_no: id('txtregno'),
    recv_date: 'input.today',
    recv_time: 'input.time',
  },
  cover: { ...base.cover, unit: '' }, // ชื่อหน่วยที่หัวใบปะหน้า: ผู้ใช้ตั้งเองในส่วนตั้งค่า (ตัวอย่าง: "ส่วนบริหารทั่วไป (สลก.รับเอกสารจากภายนอก)")
};
