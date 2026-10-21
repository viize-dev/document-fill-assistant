// โหมดในเครื่อง: PDF ที่มีข้อความในไฟล์ -> pdf.js -> ตัวแยกฟิลด์แบบกฎ ไม่ใช้ AI ไม่ส่งข้อมูลออกนอกเครื่อง
import { PARSERS } from './parsers/index.js';
import { assessTextQuality, loadPdfLines, setPdfWasmUrl } from './pdftext.js';
import { ocrPages } from './ocr.js';

// ใน extension ใช้ pdf.js ที่ vendor ไว้ (ดู scripts/vendor-pdfjs.sh); ใน Node (eval) ให้ส่ง pdfjs เข้ามา
async function extensionPdfjs() {
  const pdfjs = await import('../vendor/pdfjs/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('lib/vendor/pdfjs/pdf.worker.min.mjs');
  setPdfWasmUrl(chrome.runtime.getURL('lib/vendor/pdfjs/wasm/'));
  return pdfjs;
}

// รูปแบบเลขที่หนังสือราชการ เช่น ศธ 0599/2518, มท 0808.2/ว 4567, นร 0105.4/1951
const DOC_NO_SHAPE = /^[\u0E01-\u0E2EA-Za-z.]{1,12}\s?\d{1,4}(\.\d+)?\s?\/\s?(\u0E27\s?)?\d{1,6}$/;

// ocr: undefined = ใช้ OCR ของ extension (โหลดเมื่อจำเป็น), false = ปิด OCR, object = deps ของ OCR (ใช้ใน Node/ทดสอบ)
export async function extractLocal({ data, profile, pdfjs, ocr, onProgress }) {
  const parser = PARSERS[profile.localParser];
  if (!parser) throw new Error(`ระบบปลายทาง "${profile.name}" ยังไม่มีตัวแยกฟิลด์แบบกฎ (ใช้โหมด AI แทน)`);
  const lib = pdfjs || (await extensionPdfjs());
  let lines;
  let ocrInfo = null;
  try {
    // pdf.js ย้ายความเป็นเจ้าของของข้อมูลไปให้ worker (ใช้ซ้ำไม่ได้) จึงส่งสำเนาไป เก็บต้นฉบับไว้ให้ OCR
    ({ lines } = await loadPdfLines(lib, data.slice()));
  } catch (e) {
    if (e.code !== 'NO_TEXT_LAYER' || ocr === false) throw e;
    // ภาพสแกน: อ่านด้วย OCR ในเครื่อง
    const deps = ocr || (await import('./ocr-browser.js')).browserOcrDeps();
    // หน้าที่ใช้ได้ = เจอบรรทัด เรื่อง/เรียน (หน้าแรกบางฉบับเป็นแผนที่หรือภาพแนบ)
    ocrInfo = await ocrPages({ data, pdfjs: lib, deps, onProgress, accept: (ls) => !!(parser(ls).fields.subject || parser(ls).fields.to) });
    lines = ocrInfo.lines;
    if (lines.reduce((n, l) => n + l.text.length, 0) < 30) {
      throw new Error('อ่านตัวอักษรจากภาพนี้ไม่ได้ (ภาพจางหรือไม่ชัดเกินไป) ลองสแกนใหม่ให้เข้มขึ้น หรือใช้โหมด AI');
    }
  }
  const result = parser(lines);
  result.warnings = ['สรุปเรื่องในโหมดในเครื่องเป็นเพียงข้อความต้นฉบับท่อนแรก ไม่ใช่การสรุปด้วย AI กรุณาแก้ไขหรือใช้โหมด AI'];
  if (ocrInfo) {
    // OCR ผิดได้โดยที่กฎมองไม่เห็น: ลดความมั่นใจทุกช่องเพื่อให้ผู้ใช้ตรวจ
    result.warnings.unshift('อ่านจากภาพสแกนด้วย OCR ในเครื่อง ความแม่นยำจำกัด (โดยเฉพาะเลขที่ วันที่ ตราประทับ ลายมือ) กรุณาตรวจทุกช่อง หรือใช้โหมด AI');
    for (const k of Object.keys(result.field_confidence)) result.field_confidence[k] = Math.min(result.field_confidence[k], 0.5);
    result.doc_type_confidence = Math.min(result.doc_type_confidence, 0.5);
    // เลขที่หนังสือจาก OCR มักเพี้ยน (ตัวเลขไทย/ตราประทับ): ถ้าไม่เข้ารูปแบบเลขที่หนังสือ เว้นว่างดีกว่าแสดงขยะ
    if (result.fields.doc_no && !DOC_NO_SHAPE.test(result.fields.doc_no)) {
      result.fields.doc_no = '';
      result.field_confidence.doc_no = 0;
    }
    result.ocr = { confidence: ocrInfo.confidence, enhanced: ocrInfo.enhanced, pageNo: ocrInfo.pageNo, tried: ocrInfo.tried };
    if (ocrInfo.pageNo > 1) result.warnings.unshift(`หน้าแรกของไฟล์ไม่ใช่ตัวหนังสือ จึงอ่านข้อมูลจากหน้า ${ocrInfo.pageNo}`);
    return result;
  }
  const quality = assessTextQuality(lines);
  if (quality.degraded) {
    // ข้อความในไฟล์ไม่ครบ ค่าที่ได้อาจผิดโดยที่กฎมองไม่เห็น: ลดความมั่นใจทุกช่องเพื่อให้ผู้ใช้ตรวจ
    result.warnings.push('ข้อความในไฟล์นี้ไม่ครบ (ไฟล์ไม่เก็บวรรณยุกต์) ค่าที่อ่านได้อาจผิด กรุณาตรวจทุกช่อง หรือใช้โหมด AI');
    for (const k of Object.keys(result.field_confidence)) result.field_confidence[k] = Math.min(result.field_confidence[k], 0.3);
    result.doc_type_confidence = Math.min(result.doc_type_confidence, 0.3);
  }
  return result;
}
