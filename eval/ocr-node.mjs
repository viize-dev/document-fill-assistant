// deps ของ OCR สำหรับ Node (ใช้ใน eval และสคริปต์ตรวจเอกสาร): canvas จาก @napi-rs/canvas + tesseract.js ในเครื่อง
// ใช้ไฟล์ภาษาไทยชุดเดียวกับที่ vendor ให้ extension (lib/vendor/ocr)
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export async function nodeOcrDeps() {
  // ตัวถอดรหัส JBIG2 ของ pdf.js ใน Node (ไม่ตั้ง = ภาพสแกนแบบ JBIG2 อ่านไม่ได้)
  (await import('../lib/local/pdftext.js')).setPdfWasmUrl(`${join(ROOT, 'eval/node_modules/pdfjs-dist/wasm')}/`);
  const { createCanvas } = await import('./node_modules/@napi-rs/canvas/index.js');
  const { createWorker } = await import('./node_modules/tesseract.js/src/index.js');
  return {
    createCanvas,
    canvasToImage: (canvas) => canvas.toBuffer('image/png'),
    createWorker: () => createWorker('tha', 1, { langPath: join(ROOT, 'lib/vendor/ocr'), gzip: false, cacheMethod: 'none' }),
  };
}
