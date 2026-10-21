// OCR ภาพสแกนในเครื่อง (tesseract.js + โมเดลภาษาไทย) ใช้เมื่อ PDF ไม่มีข้อความในไฟล์ ไม่ส่งข้อมูลออกนอกเครื่อง
// ได้ "บรรทัด" รูปแบบเดียวกับ lib/local/pdftext.js จึงใช้ตัวแยกฟิลด์แบบกฎตัวเดิมต่อได้
// ความแม่นยำจำกัด: ข้อความพิมพ์ชัดอ่านได้ดี แต่เลขที่/วันที่/ตราประทับ/ลายมือมักผิด ผู้ใช้ต้องตรวจเสมอ
// deps ฉีดเข้ามา (ฝั่ง extension ดู ocr-browser.js, ฝั่ง Node ดู eval/ocr-node.mjs) เพื่อทดสอบโดยไม่ต้องมีเบราว์เซอร์

import { pdfDocOptions, repairThai } from './pdftext.js';

const MIN_LINE_CONFIDENCE = 45; // ตัดบรรทัดที่เอนจินไม่มั่นใจ (มักเป็นตราประทับ/ลายเซ็น/รอยเปื้อน) ให้บรรทัดจริงต่อเนื่องกัน
const MIN_LETTER_RATIO = 0.5; // สัดส่วนตัวอักษรจริง (ไทย/อังกฤษ/ตัวเลข) ต่ออักขระที่ไม่ใช่ช่องว่าง
export const OCR_SCALE = 2; // ขยายภาพก่อน OCR (2 ≈ 144 dpi จากหน้า A4 72 pt)

const LETTER = /[ก-๏A-Za-z0-9๐-๙]/g;

// blocks ของ tesseract -> บรรทัดแบบ pdftext (y เป็นพิกัดแบบ PDF: ค่ามากอยู่ด้านบน หน่วย pt)
export function linesFromOcr(blocks, { pageHeightPx, scale = OCR_SCALE, page = 1 } = {}) {
  const out = [];
  for (const b of blocks || []) {
    for (const p of b.paragraphs || []) {
      for (const l of p.lines || []) {
        const raw = String(l.text || '').trim();
        const flat = raw.replace(/\s+/g, '');
        if (!flat || (l.confidence ?? 100) < MIN_LINE_CONFIDENCE) continue;
        if (((flat.match(LETTER) || []).length) / flat.length < MIN_LETTER_RATIO) continue;
        const segments = raw.split(/\s{2,}/).map(repairThai).filter(Boolean);
        if (!segments.length) continue;
        out.push({
          y: (pageHeightPx - l.bbox.y0) / scale,
          x: l.bbox.x0 / scale,
          right: l.bbox.x1 / scale,
          segments,
          text: segments.join('  '),
          page,
        });
      }
    }
  }
  return out.sort((a, b) => b.y - a.y);
}

// ภาพสแกนที่ตัวหนังสือจาง (มืดสุดยังสว่าง) ยืดช่วงความสว่างให้เข้มขึ้นก่อน OCR; ภาพปกติไม่ถูกแตะ
export function autoContrast(imageData) {
  const d = imageData.data;
  const hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4) hist[Math.round(d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11)]++;
  const total = d.length / 4;
  const pct = (q) => {
    let acc = 0;
    for (let v = 0; v < 256; v++) {
      acc += hist[v];
      if (acc >= total * q) return v;
    }
    return 255;
  };
  const lo = pct(0.01);
  const hi = pct(0.5); // ค่ากลาง = สีกระดาษ (พื้นที่ส่วนใหญ่ของหน้าคือพื้นขาว)
  if (lo <= 90 || hi - lo < 20) return false; // ความเข้มพอแล้ว หรือภาพเรียบเกินไป
  for (let i = 0; i < d.length; i += 4) {
    const g = d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11;
    d[i] = d[i + 1] = d[i + 2] = Math.max(0, Math.min(255, ((g - lo) / (hi - lo)) * 255));
  }
  return true;
}

// อ่านหน้าของ PDF ด้วย OCR ทีละหน้าจนกว่า accept(lines) จะยอมรับ (เช่น เจอเรื่อง/เรียน) สูงสุด maxPages หน้า
// เพราะไฟล์สแกนบางฉบับหน้าแรกเป็นแผนที่/ภาพแนบ/ใบปะหน้า ไม่ใช่ตัวหนังสือ
// ไม่มีหน้าที่ถูกยอมรับ = คืนหน้าที่ได้ตัวอักษรมากที่สุด -> { lines (page=1 ให้ตัวแยกฟิลด์), pageNo, confidence, pages, enhanced, tried }
export async function ocrPages({ data, pdfjs, deps, scale = OCR_SCALE, maxPages = 3, accept = () => true, onProgress }) {
  const task = pdfjs.getDocument({ data, ...pdfDocOptions() });
  const doc = await task.promise;
  let worker;
  try {
    const limit = Math.min(doc.numPages, maxPages);
    let best = null;
    for (let pageNo = 1; pageNo <= limit; pageNo++) {
      onProgress?.(limit > 1 ? `กำลังเตรียมภาพหน้า ${pageNo}…` : 'กำลังเตรียมภาพ…');
      const page = await doc.getPage(pageNo);
      const viewport = page.getViewport({ scale });
      const canvas = deps.createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport, canvas }).promise;
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const enhanced = autoContrast(img);
      if (enhanced) ctx.putImageData(img, 0, 0);

      onProgress?.(limit > 1 ? `กำลังอ่านตัวอักษรจากภาพ (OCR) หน้า ${pageNo}…` : 'กำลังอ่านตัวอักษรจากภาพ (OCR)…');
      worker ||= await deps.createWorker(onProgress);
      const { data: result } = await worker.recognize(deps.canvasToImage(canvas), {}, { blocks: true });
      const lines = linesFromOcr(result.blocks, { pageHeightPx: canvas.height, scale });
      const found = { lines, pageNo, confidence: result.confidence, pages: doc.numPages, enhanced, tried: pageNo };
      const chars = lines.reduce((n, l) => n + l.text.length, 0);
      if (!best || chars > best.lines.reduce((n, l) => n + l.text.length, 0)) best = found;
      if (lines.length && accept(lines)) return { ...found, tried: pageNo };
    }
    return { ...best, tried: limit };
  } finally {
    await worker?.terminate();
    await task.destroy();
  }
}
