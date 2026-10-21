// พจนานุกรมคำที่ใช้เป็นป้ายชื่อ/ชื่อช่อง ของฟิลด์กลางแต่ละตัว (ขยายได้โดยไม่แก้ตรรกะ)
// th = ป้ายภาษาไทย, en = ชื่อ attribute (name/id) ภาษาอังกฤษ, weak = คำกว้างที่ให้คะแนนต่ำกว่า, exclude = ถ้าป้ายมีคำนี้ ไม่ใช่ฟิลด์นี้
// profile เพิ่มเองได้ที่ profile.fields[key].aliases = ['คำ', ...]
export const SYNONYMS = {
  doc_no: {
    th: ['เลขที่หนังสือ', 'เลขที่เอกสาร', 'หนังสือเลขที่', 'เลขหนังสือ', 'ที่หนังสือ', 'เลขที่'],
    en: ['docno', 'documentno', 'documentnumber', 'bookno', 'letterno', 'docnumber'],
    exclude: ['ทะเบียน', 'เลขรับ', 'เลขที่รับ', 'ระบบ e', 'ระบบe'],
  },
  doc_date: {
    th: ['ลงวันที่', 'วันที่หนังสือ', 'วันที่เอกสาร', 'วันที่ลงหนังสือ'],
    en: ['docdate', 'documentdate', 'letterdate', 'bookdate'],
    weak: ['วันที่', 'date'],
    exclude: ['รับ', 'ส่ง', 'หมดอายุ', 'แล้วเสร็จ', 'กำหนด', 'สิ้นสุด', 'เริ่ม'],
  },
  from: {
    th: ['ส่วนราชการเจ้าของเรื่อง', 'หน่วยงานเจ้าของเรื่อง', 'หน่วยงานต้นเรื่อง', 'จากหน่วยงาน', 'เจ้าของเรื่อง', 'ผู้ส่ง', 'จาก'],
    en: ['from', 'sender', 'fromorg'],
    weak: ['ส่วนราชการ'],
  },
  to: {
    th: ['ส่งถึง', 'ผู้รับหนังสือ', 'หน่วยงานผู้รับ', 'ผู้รับ', 'เรียน', 'ถึง'],
    en: ['to', 'receiver', 'recipient', 'toorg'],
  },
  subject: {
    th: ['ชื่อเรื่อง', 'หัวข้อเรื่อง', 'หัวเรื่อง', 'ชื่อหนังสือ', 'เรื่อง'],
    en: ['subject', 'topic'],
    weak: ['title'],
  },
  detail: {
    th: ['รายละเอียด', 'สาระสำคัญ', 'เนื้อเรื่อง', 'เนื้อหา', 'สรุปเรื่อง'],
    en: ['detail', 'details', 'description', 'desc', 'dsc', 'content', 'body'],
    weak: ['ข้อความ'],
  },
  ref: {
    th: ['อ้างถึง', 'อ้างอิง'],
    en: ['ref', 'reference', 'refer'],
  },
  attachments: {
    th: ['สิ่งที่ส่งมาด้วย', 'สิ่งที่แนบมาด้วย', 'ส่งมาด้วย', 'เอกสารแนบ', 'สิ่งที่แนบ'],
    en: ['attach', 'attachment', 'attachments', 'enclosure'],
    weak: ['แนบ'],
  },
  speed: {
    th: ['ชั้นความเร็ว', 'ระดับความเร็ว', 'ความเร็ว', 'ความด่วน'],
    en: ['speed', 'priority', 'urgency', 'urgent'],
  },
  secret: {
    th: ['ชั้นความลับ', 'ระดับความลับ', 'ความลับ'],
    en: ['secret', 'seclev', 'seclevel', 'secretlevel', 'security', 'classification'],
  },
};
