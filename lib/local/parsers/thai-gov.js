// ตัวแยกฟิลด์แบบกฎสำหรับหนังสือราชการไทย (หนังสือภายนอก / บันทึกข้อความ / หนังสือเวียน)
// รับบรรทัดจาก lib/local/pdftext.js คืนรูปแบบเดียวกับผลจาก AI เพื่อใช้ pipeline ต่อได้ทันที
// ใช้ได้กับเอกสารพิมพ์ที่มีข้อความในไฟล์เท่านั้น: ไม่เข้าใจความหมาย จึงสรุปเรื่องไม่ได้ (detail = ข้อความต้นฉบับท่อนแรก)

import { parseDate, toArabic, truncateThai } from '../../mapping.js';
import { repairThai } from '../pdftext.js';

const SUMMARY_MAX = 400; // เพดานของข้อความต้นฉบับท่อนแรกที่ใช้แทนสรุปในโหมดไม่ใช้ AI (ไม่ใช่เพดานของใบปะหน้า)
const squash = (s) => String(s).replace(/\s+/g, '');
const HAS_DIGIT = /[0-9๐-๙]/;
const LABELS = ['เรื่อง', 'เรียน', 'อ้างถึง', 'สิ่งที่ส่งมาด้วย', 'ส่วนราชการ'];
const END_LABELS = ['ขอแสดงความนับถือ', 'จึงเรียน'];
// ชื่อหน่วยงานที่มักขึ้นต้นด้วยคำเหล่านี้ (ใช้เมื่อชื่ออยู่นอกแถวเดียวกับเลขที่หนังสือ)
const ORG_RE = /^(สำนักงาน|สำนัก|กรม|กระทรวง|กอง|ศาล|มหาวิทยาลัย|วิทยาลัย|โรงเรียน|โรงพยาบาล|จังหวัด|อำเภอ|เทศบาล|องค์การ|องค์กร|สถาบัน|ศูนย์|สภา|คณะ|การ)/;

// ป้ายกำกับเทียบแบบไม่สนสระ/วรรณยุกต์: PDF บางตัวทำวรรณยุกต์หายจากข้อความ แต่พยัญชนะยังอยู่
const MARKS_RE = /[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E\uFFFD]/; // รวม � (glyph ที่ไม่รู้ว่าเป็นสระ/วรรณยุกต์ตัวไหน)
const stripMarks = (s) => [...String(s)].filter((c) => !MARKS_RE.test(c)).join('');
function stripLabelPrefix(text, label) {
  let i = 0;
  for (const w of stripMarks(label)) {
    while (i < text.length && MARKS_RE.test(text[i])) i++;
    if (text[i] !== w) return null;
    i++;
  }
  while (i < text.length && MARKS_RE.test(text[i])) i++;
  return text.slice(i).replace(/^\s+/, '');
}
const matchLabel = (t) => {
  for (const label of LABELS) {
    const rest = stripLabelPrefix(t, label);
    if (rest !== null) return { label, rest };
  }
  return null;
};
const isEnd = (t) => END_LABELS.some((l) => stripLabelPrefix(t, l) !== null);

const STAMPS = [
  ['ด่วนที่สุด', 'speed', 'most_urgent'],
  ['ด่วนมาก', 'speed', 'very_urgent'],
  ['ด่วน', 'speed', 'urgent'],
  ['ลับที่สุด', 'secret', 'most_secret'],
  ['ลับมาก', 'secret', 'very_secret'],
  ['ลับ', 'secret', 'secret'],
];
const RANK = { urgent: 1, very_urgent: 2, most_urgent: 3, secret: 1, very_secret: 2, most_secret: 3 };

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 20;
};

export function parseThaiGov(allLines) {
  const lines = allLines.filter((l) => l.page === undefined || l.page === 1);
  const text = (l) => repairThai(l.segments.join(' '));

  // ตราประทับชั้นความเร็ว/ลับ: ช่วงข้อความที่เป็นคำนั้นคำเดียว (ไม่ใช่คำในเนื้อหา)
  const stamp = {};
  const stampLines = new Set();
  lines.forEach((l, i) => {
    l.segments.forEach((seg) => {
      const hit = STAMPS.find(([w]) => squash(seg) === w);
      if (!hit) return;
      const [, kind, value] = hit;
      if (!stamp[kind] || RANK[value] > RANK[stamp[kind]]) stamp[kind] = value;
      if (l.segments.length === 1) stampLines.add(i);
    });
  });

  const pitch = median(lines.slice(1).map((l, i) => lines[i].y - l.y).filter((d) => d > 8 && d < 40));
  const widths = lines.filter((l) => l.text.length >= 40);
  const left = Math.min(...lines.map((l) => l.x));
  const right = Math.max(...(widths.length ? widths : lines).map((l) => l.right));
  const isLabelLine = (l) => !!matchLabel(text(l)) || isEnd(text(l));

  // บรรทัดต่อเนื่อง: ใกล้กันในแนวตั้ง, บรรทัดก่อนหน้ายาวเกือบเต็มความกว้าง และไม่ใช่ป้ายใหม่
  const isContinuation = (prev, cur, idx) =>
    !stampLines.has(idx) &&
    prev.y - cur.y <= pitch * 1.3 &&
    prev.right >= left + 0.6 * (right - left) &&
    !isLabelLine(cur) &&
    cur.segments.length === 1;

  const labelValue = (label) => {
    const i = lines.findIndex((l) => matchLabel(text(l))?.label === label);
    if (i < 0) return null;
    let value = matchLabel(text(lines[i])).rest;
    let end = i;
    while (end + 1 < lines.length && isContinuation(lines[end], lines[end + 1], end + 1)) {
      end++;
      value += ` ${text(lines[end])}`;
    }
    return { value: repairThai(value), line: i, end };
  };

  // แถวหัวเอกสาร: ช่วงที่ขึ้นต้นด้วย "ที่" และมีตัวเลข (เลขที่หนังสือ)
  let header = null;
  lines.some((l, i) => {
    if (stampLines.has(i)) return false;
    const k = l.segments.findIndex((s) => /^ที่\s*\S/.test(s) && HAS_DIGIT.test(s));
    if (k < 0) return false;
    header = { i, k, line: l };
    return true;
  });

  const isMemo = lines.slice(0, 8).some((l) => stripMarks(squash(text(l))).includes(stripMarks('บันทึกข้อความ')));
  const fields = {};
  const conf = {};
  // optional = ฟิลด์ที่ว่างได้ตามปกติ (ไม่มี = ไม่ใช่ข้อผิดพลาด จึงไม่ติดธงให้ตรวจ)
  const put = (key, value, c, optional = false) => {
    fields[key] = value || '';
    if (value) conf[key] = c;
    else if (!optional) conf[key] = 0;
  };

  // เลขที่หนังสือ
  let docNo = header ? header.line.segments[header.k].replace(/^ที่\s*/, '').trim() : '';
  // "ที่ X วันที่ Y" ติดกันเป็นช่วงเดียว (ไม่มีช่องว่างกว้างคั่น): แยกวันที่ออกจากเลขที่
  let inlineDate = '';
  const inline = docNo.match(/^(.*?)\s+วันที่\s+(.+)$/);
  if (inline) {
    docNo = inline[1].trim();
    inlineDate = inline[2].trim();
  }
  put('doc_no', docNo, 0.9);

  // เลข E ของสารบรรณ: ตราประทับ "เลขที่เอกสารในระบบ E กษ0100/7562" (ถ้ามีเป็นข้อความในไฟล์) ไม่พบ = ว่างไว้
  let eNo = '';
  for (const l of lines) {
    const t = text(l);
    if (!stripMarks(t).includes(stripMarks('เลขที่เอกสารในระบบ'))) continue;
    const m = t.match(/ระบบ\s*E\s*([ก-ฮA-Za-z]{1,8}\s?[0-9๐-๙][0-9๐-๙./-]*)/i);
    if (m) {
      eNo = m[1].replace(/\s+/g, '');
      break;
    }
  }
  put('e_no', eNo, 0.9, true);

  // วันที่: บันทึกข้อความมี "วันที่ ..." ในแถวเดียวกัน, หนังสือภายนอกเป็นบรรทัดวันที่เดี่ยวใต้หัวเอกสาร
  let date = inlineDate;
  let dateConf = 0.9;
  if (header && !date) {
    // "วันที่ <วันที่>" อยู่ในช่วงเดียวกัน หรือป้ายกับค่าถูกแยกเป็นสองช่วง (ช่องว่างกว้าง)
    const segs = header.line.segments;
    const k = segs.findIndex((x) => /^วันที่(\s|$)/.test(x) && !x.includes('เวลา'));
    if (k >= 0) {
      const rest = segs[k].replace(/^วันที่\s*/, '');
      date = rest || (segs[k + 1] && parseDate(squash(segs[k + 1])) ? segs[k + 1] : '');
    }
  }
  if (!date && header) {
    for (let j = header.i + 1; j < Math.min(lines.length, header.i + 8); j++) {
      const t = text(lines[j]);
      if (!t.includes('เวลา') && parseDate(squash(t))) {
        date = t;
        dateConf = 0.8;
        break;
      }
    }
  }
  put('doc_date', date, dateConf);

  // จาก: บันทึกข้อความ = "ส่วนราชการ ..." (ตัดเบอร์โทร), หนังสือภายนอก = หน่วยงานข้างเลขที่
  let from = '';
  if (isMemo) {
    const sr = labelValue('ส่วนราชการ');
    from = sr ? sr.value.replace(/\s*โทร\.?.*$/, '') : '';
  } else if (header) {
    const segs = header.line.segments;
    from = segs.filter((x, k) => k !== header.k && !/^วันที่(\s|$)/.test(x) && !(k > 0 && /^วันที่\s*$/.test(segs[k - 1]))).join(' ');
  }
  let fromConf = 0.85;
  if (!from && header) {
    // ชื่อหน่วยงานไม่ได้อยู่แถวเดียวกับเลขที่ (เช่น กึ่งกลางใต้ตรา): หาบรรทัดเหนือหัวเอกสารที่ขึ้นต้นเหมือนชื่อหน่วยงาน
    const above = lines.slice(0, header.i).find((l, i) => !stampLines.has(i) && ORG_RE.test(text(l)));
    if (above) {
      from = text(above);
      fromConf = 0.6;
    }
  }
  put('from', repairThai(from), fromConf);

  const to = labelValue('เรียน');
  const subject = labelValue('เรื่อง');
  const ref = labelValue('อ้างถึง');
  const attach = labelValue('สิ่งที่ส่งมาด้วย');
  // ใบปะหน้าของระบบสารบรรณมีป้าย "วันที่กำหนด" อยู่บรรทัดเดียวกับ เรียน
  put('to', to?.value?.replace(/\s*วันที่กำหนด\s*$/, ''), 0.9);
  put('subject', subject?.value, 0.9);
  put('ref', ref?.value, 0.9, true);
  put('attachments', attach?.value, 0.9, true);

  // ประโยคปิดท้าย "จึงเรียนมาเพื่อ..." (ไว้ติ๊กตัวเลือกบนใบปะหน้า)
  const ci = lines.findIndex((l) => stripLabelPrefix(text(l), 'จึงเรียน') !== null);
  let closing = '';
  if (ci >= 0) {
    closing = text(lines[ci]);
    for (let j = ci; j + 1 < lines.length && isContinuation(lines[j], lines[j + 1], j + 1); j++) closing += ` ${text(lines[j + 1])}`;
  }
  put('closing', repairThai(closing), 0.8, true);

  // วันที่กำหนด (ช่องในตารางของบันทึกข้อความ): "วันที่กำหนด | วันที่ 7 กรกฎาคม 2569"
  let deadline = '';
  for (const l of lines) {
    const k = l.segments.findIndex((x) => stripLabelPrefix(x, 'วันที่กำหนด') !== null);
    if (k < 0) continue;
    const rest = stripLabelPrefix(l.segments[k], 'วันที่กำหนด') || l.segments[k + 1] || '';
    deadline = repairThai(rest).replace(/^วันที่\s*/, '');
    break;
  }
  put('deadline', deadline, 0.8, true);

  // ตราประทับ: ไม่พบตราประทับ = ปกติ แต่อาจพลาดตราที่ไม่อยู่ในไฟล์ จึงให้ความมั่นใจต่ำกว่า
  fields.speed = stamp.speed || 'normal';
  conf.speed = stamp.speed ? 0.9 : 0.6;
  fields.secret = stamp.secret || 'normal';
  conf.secret = stamp.secret ? 0.9 : 0.6;

  // เนื้อหา: ต่อจากป้ายสุดท้ายถึงบรรทัด "จึงเรียน..." / "ขอแสดงความนับถือ" (ตัดเหลือ 350 ตัวอักษร)
  const lastLabelEnd = Math.max(-1, ...[to, ref, attach, subject].filter(Boolean).map((x) => x.end));
  const body = [];
  for (let j = lastLabelEnd + 1; j < lines.length; j++) {
    if (stampLines.has(j)) continue;
    const t = text(lines[j]);
    if (isEnd(t)) break;
    body.push(t);
  }
  const bodyText = repairThai(body.join(' ')).slice(0, 350);
  put('detail', bodyText, 0.4);
  conf.summary = 0.3;

  const rawNo = docNo;
  let docType = 'other';
  let typeConf = 0.3;
  if (isMemo) {
    docType = 'internal';
    typeConf = 0.9;
  } else if (/\/\s*ว\s*[0-9๐-๙]/.test(rawNo)) {
    docType = 'circular'; // เลขที่ที่มี "/ว" คือหนังสือเวียน
    typeConf = 0.75;
  } else if (docNo) {
    docType = 'external';
    typeConf = 0.7;
  }

  // แปลงเลขไทยเป็นอารบิกทุกฟิลด์ เหมือนที่สั่ง AI ไว้ใน prompt
  for (const k of Object.keys(fields)) fields[k] = toArabic(fields[k]);

  return {
    doc_type: docType,
    doc_type_confidence: typeConf,
    fields,
    field_confidence: conf,
    // ไม่มีความเข้าใจเนื้อหา จึงไม่ใช่สรุปจริง: ใช้ข้อความต้นฉบับท่อนแรก (ตัดที่ขอบเขตคำ) และให้ความมั่นใจต่ำ
    summary: truncateThai(toArabic(bodyText), SUMMARY_MAX),
    requested_action: '',
  };
}
