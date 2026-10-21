// ส่วนต่อของ OCR ฝั่ง extension: ใช้ไฟล์ที่ vendor ไว้ใน lib/vendor/ocr (ดู scripts/vendor-ocr.sh) ไม่โหลดจากอินเทอร์เน็ต
export function browserOcrDeps() {
  return {
    createCanvas: (w, h) => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      return c;
    },
    canvasToImage: (canvas) => canvas,
    async createWorker(onProgress) {
      // ไฟล์ ESM ของ tesseract.js ส่งออกเฉพาะ default (ทั้งออบเจ็กต์ Tesseract)
      const { default: Tesseract } = await import('../vendor/ocr/tesseract.esm.min.js');
      const base = chrome.runtime.getURL('lib/vendor/ocr/');
      return Tesseract.createWorker('tha', 1, {
        workerPath: `${base}worker.min.js`,
        corePath: `${base}tesseract-core-simd-lstm.wasm.js`,
        langPath: base.replace(/\/$/, ''),
        gzip: false,
        workerBlobURL: false, // เปิด worker จากไฟล์ใน extension โดยตรง (CSP ของ extension ไม่ให้ใช้ blob:)
        cacheMethod: 'none',
        logger: (m) => m.status === 'recognizing text' && onProgress?.(`กำลังอ่านตัวอักษรจากภาพ (OCR) ${Math.round(m.progress * 100)}%`),
      });
    },
  };
}
