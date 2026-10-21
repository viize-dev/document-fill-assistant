// ดึงข้อความจาก PDF ที่มีข้อความอยู่ในไฟล์ (ไม่ใช้ AI, ไม่ออกจากเครื่อง) แล้วจัดเป็นบรรทัด/ช่วง
// รับ pdfjs เป็นพารามิเตอร์: extension ใช้ไฟล์ที่ vendor ไว้, Node (eval) ใช้ legacy build

// ตัวถอดรหัสภาพ JBIG2/JPEG2000/สี (WebAssembly) ของ pdf.js: ภาพสแกนจากเครื่องสแกนเนอร์ส่วนใหญ่ใช้ JBIG2
// ถ้าไม่ตั้ง PDF ที่ใช้ JBIG2 จะแสดงภาพจาง/ว่าง (ดู lib/vendor/pdfjs/wasm, scripts/vendor-pdfjs.sh)
let wasmUrl = null;
export const setPdfWasmUrl = (url) => {
  wasmUrl = url;
};
export const pdfDocOptions = () => ({ isEvalSupported: false, useSystemFonts: false, disableFontFace: true, ...(wasmUrl ? { wasmUrl } : {}) });

const LINE_TOLERANCE = 4; // pt: ตัวอักษรที่ y ต่างกันไม่เกินนี้ถือเป็นบรรทัดเดียวกัน
const SEGMENT_GAP = 36; // pt: ช่องว่างกว้างกว่านี้ถือเป็นคนละช่วง (เช่น เลขที่ซ้าย / หน่วยงานขวา)

const MARK = '\\u0E31\\u0E34-\\u0E3A\\u0E47-\\u0E4E'; // สระบน/ล่าง วรรณยุกต์ ฯลฯ
const SPURIOUS_SPACE = new RegExp(`(?<=[${MARK}])\\s+(?=[\\u0E01-\\u0E4F])`, 'g');

// ซ่อมข้อความไทยจาก PDF:
// - นิคหิต+สระอา -> สระอำ, ตัดอักขระความกว้างศูนย์/nbsp
// - PDF บางตัวแทรกช่องว่างปลอมหลังสระ/วรรณยุกต์ ("สิ งหาคม", "ปี งบประมาณ") ให้ตัดออก
//   ยกเว้นคำว่า "ที่" ที่ยืนเดี่ยว เพราะมักตามด้วยช่องว่างจริง ("ที่ ศธ 0599/...")
export function repairThai(text) {
  // อักขระ NUL = glyph ที่ PDF ไม่มีตัวแปลงเป็น Unicode (มักเป็นสระ/วรรณยุกต์) แสดงเป็น � ให้เห็นว่ามีจุดที่ไม่รู้
  // PDF จากระบบสารบรรณอิเล็กทรอนิกส์มักมีตัวแทนของแม่แบบค้างอยู่ เช่น "{XXXXXXXXXXXXX}" "{BookID}" "{BookDate}" ตัดทิ้ง
  let s = String(text ?? '').replace(/\{[A-Za-z0-9_]{1,30}\}/g, ' ').replace(/\u0000/g, '\uFFFD').normalize('NFC')
    .replace(/ํา/g, 'ำ')
    .replace(/[​-‍﻿]/g, '')
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ');
  const keep = [];
  s = s.replace(/(^|\s)ที่(?=\s)/g, (m, pre) => {
    keep.push(true);
    return `${pre}ที่\u0001`;
  });
  s = s.replace(SPURIOUS_SPACE, '');
  return s.replace(/\u0001\s*/g, ' ').trim();
}

// items ของหนึ่งหน้า -> [{ y, x, right, text, segments: [string] }] เรียงบนลงล่าง
export function itemsToLines(items) {
  const rows = [];
  items
    .map((it, idx) => ({ it, idx }))
    .filter(({ it }) => typeof it.str === 'string')
    .sort((a, b) => b.it.transform[5] - a.it.transform[5])
    .forEach((e) => {
      const y = e.it.transform[5];
      const row = rows.find((r) => Math.abs(r.y - y) <= LINE_TOLERANCE);
      if (row) row.items.push(e);
      else rows.push({ y, items: [e] });
    });

  const lines = [];
  for (const row of rows) {
    row.items.sort((a, b) => a.it.transform[4] - b.it.transform[4] || a.idx - b.idx);
    const segments = [];
    let cur = '';
    let curStart = null;
    let prevEnd = null;
    let right = 0;
    const endSegment = () => {
      const t = repairThai(cur);
      if (t) segments.push({ text: t, x: curStart });
      cur = '';
      curStart = null;
    };
    for (const { it } of row.items) {
      const x = it.transform[4];
      const isSpace = it.str.trim() === '';
      const gap = prevEnd === null ? 0 : x - prevEnd;
      if (isSpace && it.width >= SEGMENT_GAP) {
        endSegment();
        prevEnd = x + it.width;
        continue;
      }
      if (!isSpace && gap >= SEGMENT_GAP) endSegment();
      else if (!isSpace && gap > 1 && cur && !cur.endsWith(' ')) cur += ' ';
      if (!isSpace && curStart === null) curStart = x;
      cur += it.str;
      prevEnd = Math.max(prevEnd ?? 0, x + it.width);
      if (!isSpace) right = Math.max(right, x + it.width);
    }
    endSegment();
    if (!segments.length) continue;
    lines.push({
      y: row.y,
      x: segments[0].x,
      right,
      segments: segments.map((s) => s.text),
      text: segments.map((s) => s.text).join('  '),
    });
  }
  return lines.sort((a, b) => b.y - a.y);
}

// ประเมินว่าข้อความในไฟล์ไทย "ครบ" ไหม: PDF บางตัว (ขึ้นกับฟอนต์/โปรแกรมที่สร้าง) ไม่เก็บวรรณยุกต์ไว้ในข้อความ
// ข้อความไทยปกติมีวรรณยุกต์ ~9-14% ของพยัญชนะ; ไฟล์ที่หายเหลือ ~3% (วัดจากตัวอย่าง 8 ฉบับ — ควรทวนกับไฟล์จริง)
export const MIN_TONE_RATIO = 0.05;
export function assessTextQuality(lines) {
  const t = lines.map((l) => l.text).join(' ');
  const letters = (t.match(/[\u0E01-\u0E2E]/g) || []).length;
  const tones = (t.match(/[\u0E48-\u0E4B]/g) || []).length;
  const unmapped = (t.match(/\uFFFD/g) || []).length;
  const toneRatio = letters ? tones / letters : 0;
  // ข้อความไม่ครบ: มีอักขระที่ไม่รู้จักมาก หรือวรรณยุกต์น้อยผิดปกติ (กรณีไฟล์ตัดทิ้งเงียบๆ)
  const degraded = letters >= 80 && (unmapped / letters > 0.01 || toneRatio < MIN_TONE_RATIO);
  return { letters, unmapped, toneRatio, degraded };
}

export class NoTextLayerError extends Error {
  constructor() {
    super('PDF นี้ไม่มีข้อความอยู่ในไฟล์ (เป็นภาพสแกน) โหมดในเครื่องยังอ่านภาพไม่ได้ ใช้โหมด AI สำหรับไฟล์นี้');
    this.code = 'NO_TEXT_LAYER';
  }
}

// อ่านหน้าแรกเป็นหลัก (ฟิลด์ส่วนหัวอยู่หน้าแรก) คืน { lines, pages, chars }
export async function loadPdfLines(pdfjs, data, { maxPages = 1 } = {}) {
  const task = pdfjs.getDocument({ data, ...pdfDocOptions() });
  const doc = await task.promise;
  try {
    const lines = [];
    const pages = Math.min(doc.numPages, maxPages);
    for (let p = 1; p <= pages; p++) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      lines.push(...itemsToLines(tc.items).map((l) => ({ ...l, page: p })));
    }
    const chars = lines.reduce((n, l) => n + l.text.length, 0);
    if (chars < 30) throw new NoTextLayerError();
    return { lines, pages: doc.numPages, chars };
  } finally {
    await task.destroy();
  }
}
