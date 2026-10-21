// Profile = ทุกอย่างที่ผูกกับระบบปลายทางหนึ่งระบบ (selector, ฟิลด์, ประเภทเอกสาร, ใบปะหน้า)
// เพิ่มระบบใหม่ = เพิ่มไฟล์ profile แล้วลงทะเบียนใน profiles/index.js โดยไม่ต้องแก้ core
// ข้อมูลทั้งหมดต้องเป็น JSON-serializable (เผื่อโหลดจาก backend ในอนาคต)

const SPEED = [
  ['normal', 'ปกติ'],
  ['urgent', 'ด่วน'],
  ['very_urgent', 'ด่วนมาก'],
  ['most_urgent', 'ด่วนที่สุด'],
];
const SECRET = [
  ['normal', 'ปกติ'],
  ['secret', 'ลับ'],
  ['very_secret', 'ลับมาก'],
  ['most_secret', 'ลับที่สุด'],
];

const sel = (key) => `[data-field="${key}"]`;

export default {
  id: 'saraban-demo',
  name: 'Saraban (เว็บ demo)',
  // match pattern แบบเดียวกับ manifest; ใช้เลือก profile อัตโนมัติจาก URL
  urlPatterns: ['http://localhost/*', 'http://127.0.0.1/*'],
  // ถ้ามี selector ใดตรงในหน้า ถือว่าเป็นหน้าที่ profile นี้ใช้ได้
  detect: ['form#saraban-form'],
  // คำอธิบายชนิดเอกสารสำหรับ prompt
  documentKind: 'หนังสือราชการภาษาไทย (อาจเป็นภาพสแกน มีลายมือ ตราประทับ)',
  language: 'th',
  // ตัวแยกฟิลด์แบบกฎสำหรับโหมดในเครื่อง (ไม่ใช้ AI) ดู lib/local/parsers
  localParser: 'thai-gov',
  dateFormat: { era: 'BE', pattern: 'dd/mm/yyyy' },

  // ฟิลด์ทั้งหมดที่ระบบนี้มี: selector = ช่องในหน้าเว็บ, ask = คำอธิบายให้ AI (ไม่ใส่ = ไม่ให้ AI ตอบ)
  fields: {
    doc_type: { label: 'ประเภทเอกสาร', kind: 'select', selector: sel('doc_type'), internal: true },
    doc_no: { label: 'เลขที่เอกสาร', kind: 'text', selector: sel('doc_no'), digits: 'arabic', ask: 'เลขที่หนังสือ เช่น ศธ 0100/7143 (ไม่ใช่เลขรับที่ประทับหรือเขียนด้วยลายมือ)' },
    doc_date: { label: 'ลงวันที่', kind: 'date', selector: sel('doc_date'), ask: 'วันที่ของหนังสือ รูปแบบ dd/mm/yyyy ตามปีที่ปรากฏในเอกสาร' },
    // เลข E ของระบบสารบรรณที่ประทับบนเอกสาร ("เลขที่เอกสารในระบบ E กษ0100/7562") ใช้เฉพาะใบปะหน้า ไม่กรอกลงฟอร์ม (fill: false)
    e_no: { label: 'เลขที่เอกสารในระบบ E', kind: 'text', selector: null, fill: false, digits: 'arabic', ask: 'เลขในตราประทับ "เลขที่เอกสารในระบบ E <รหัส>" ใส่เฉพาะรหัสหลังตัว E เช่น กษ0100/7562 (ไม่ใช่เลขที่หนังสือ ที่ ...) ถ้าไม่มีตราประทับนี้ให้เป็นสตริงว่าง' },
    // สรุปเรื่องสำหรับใบปะหน้า: มาจาก summary ระดับบนของผลลัพธ์ (ไม่ให้ AI ตอบซ้ำในฟิลด์)
    summary: { label: 'สรุปเรื่อง (ใบปะหน้า)', kind: 'textarea', selector: null, fill: false, fromSummary: true },
    // ฟิลด์ที่ใช้เฉพาะใบปะหน้า (fill: false): ประโยคปิดท้ายใช้ติ๊กตัวเลือก, วันที่กำหนดในเอกสารใส่ช่อง "วันที่กำหนด"
    closing: { label: 'ประโยคปิดท้าย', kind: 'text', selector: null, fill: false, ask: 'ประโยคปิดท้ายเนื้อหา เช่น "จึงเรียนมาเพื่อโปรดพิจารณาดำเนินการต่อไป" ถ้าไม่มีให้เป็นสตริงว่าง' },
    deadline: { label: 'วันที่กำหนด', kind: 'date', selector: null, fill: false, ask: 'วันที่กำหนดให้ดำเนินการ/ตอบกลับที่ระบุในเอกสาร (เช่น ช่อง "วันที่กำหนด") รูปแบบ dd/mm/yyyy ถ้าไม่มีให้เป็นสตริงว่าง' },
    from: { label: 'จาก', kind: 'text', selector: sel('from'), ask: 'ส่วนราชการ/หน่วยงานเจ้าของเรื่อง' },
    to: { label: 'ถึง', kind: 'text', selector: sel('to'), ask: 'ผู้รับ (บรรทัด เรียน)' },
    subject: { label: 'เรื่อง', kind: 'textarea', selector: sel('subject'), ask: 'เรื่อง' },
    detail: { label: 'รายละเอียด', kind: 'textarea', selector: sel('detail'), ask: 'สรุปเนื้อหาสำคัญ 2-4 ประโยค', fromSummary: true },
    ref: { label: 'อ้างถึง', kind: 'text', selector: sel('ref'), ask: 'อ้างถึง (ถ้าไม่มีให้เป็นสตริงว่าง)' },
    attachments: { label: 'สิ่งที่ส่งมาด้วย', kind: 'text', selector: sel('attachments'), ask: 'สิ่งที่ส่งมาด้วย (ถ้าไม่มีให้เป็นสตริงว่าง)' },
    speed: { label: 'ชั้นความเร็ว', kind: 'select', selector: sel('speed'), options: SPEED, ask: 'ชั้นความเร็วตามตราประทับ (ด่วนที่สุด/ด่วนมาก/ด่วน) ถ้าไม่มีให้ normal' },
    secret: { label: 'ชั้นความลับ', kind: 'select', selector: sel('secret'), options: SECRET, ask: 'ชั้นความลับตามตราประทับ ถ้าไม่มีให้ normal' },
  },

  // ค่าที่อ่านกลับจากหน้า (ใช้ทำใบปะหน้า) ไม่กรอกลงหน้า
  readOnly: {
    reg_no: '#reg_no',
    recv_date: '#recv_date',
    recv_time: '#recv_time',
  },

  // ประเภทเอกสาร: formValue = ค่าที่ตั้งในช่อง doc_type, fields = ฟิลด์ที่ต้องดึง, hint/ask = คำอธิบายให้คนและ AI
  docTypes: {
    external: {
      label: 'หนังสือภายนอก',
      formValue: 'external',
      hint: 'มี ที่ / ส่วนราชการเจ้าของเรื่อง / วันที่ / เรื่อง / เรียน',
      ask: 'หนังสือภายนอก (มีตราครุฑ, "ที่ ...")',
      fields: ['doc_no', 'e_no', 'doc_date', 'from', 'to', 'subject', 'ref', 'attachments', 'speed', 'secret', 'detail', 'summary', 'closing', 'deadline'],
    },
    internal: {
      label: 'บันทึกข้อความ',
      formValue: 'internal',
      hint: 'ส่วนราชการ / ที่ / วันที่ / เรื่อง / เรียน',
      ask: 'บันทึกข้อความ',
      fields: ['doc_no', 'e_no', 'doc_date', 'from', 'to', 'subject', 'ref', 'speed', 'secret', 'detail', 'summary', 'closing', 'deadline'],
    },
    circular: {
      label: 'หนังสือเวียน',
      formValue: 'circular',
      hint: 'หนังสือเวียนถึงหลายหน่วยงาน',
      ask: 'หนังสือเวียน',
      fields: ['doc_no', 'e_no', 'doc_date', 'from', 'to', 'subject', 'ref', 'attachments', 'speed', 'secret', 'detail', 'summary', 'closing', 'deadline'],
    },
    other: {
      label: 'อื่นๆ',
      formValue: 'incoming',
      hint: 'เอกสารที่ไม่เข้าประเภทข้างต้น',
      ask: 'เอกสารอื่นที่ไม่เข้าประเภทข้างต้น',
      fields: ['doc_no', 'e_no', 'doc_date', 'from', 'to', 'subject', 'speed', 'secret', 'detail', 'summary', 'closing', 'deadline'],
    },
  },
  fallbackDocType: 'other',

  // ใบปะหน้า (แบบกลาง ดู lib/cover.js): ตั้งได้เฉพาะชื่อหน่วย/ตัวเลือก/ป้าย ส่วนที่ไม่ระบุใช้ค่ากลาง
  cover: {
    unit: 'ส่วนบริหารทั่วไป (สลก.รับเอกสารจากภายนอก)',
    receiptFrom: ['reg_no'],
  },
};
