#!/bin/sh
# คัดลอกไฟล์ OCR (tesseract.js) ไว้ใน lib/vendor/ocr เพื่อให้ extension ทำงานในเครื่องโดยไม่โหลดจากอินเทอร์เน็ต
# ต้อง `cd eval && npm install` ก่อน (ดึง tesseract.js และ tesseract.js-core) และต้องต่ออินเทอร์เน็ตตอนดาวน์โหลดโมเดลภาษาไทย
#   - tesseract.js (Apache-2.0) ตัวสั่งงาน + worker
#   - tesseract.js-core (Apache-2.0) ตัวเอนจิน WebAssembly รุ่น SIMD แบบ LSTM (ต้องใช้ Chrome 91+)
#   - tha.traineddata จาก tessdata_fast (Apache-2.0) โมเดลภาษาไทยขนาดเล็ก ~1 MB
set -e
cd "$(dirname "$0")/.."
SRC=eval/node_modules
OUT=lib/vendor/ocr
[ -d "$SRC/tesseract.js" ] || { echo "ยังไม่ได้ติดตั้ง: รัน 'cd eval && npm install' ก่อน"; exit 1; }
mkdir -p "$OUT"
cp "$SRC/tesseract.js/dist/tesseract.esm.min.js" "$OUT/tesseract.esm.min.js"
cp "$SRC/tesseract.js/dist/worker.min.js" "$OUT/worker.min.js"
cp "$SRC/tesseract.js-core/tesseract-core-simd-lstm.wasm.js" "$OUT/tesseract-core-simd-lstm.wasm.js"
cp "$SRC/tesseract.js/LICENSE.md" "$OUT/LICENSE-tesseract.js.md" 2>/dev/null || cp "$SRC/tesseract.js/LICENSE" "$OUT/LICENSE-tesseract.js" 2>/dev/null || true
cp "$SRC/tesseract.js-core/LICENSE" "$OUT/LICENSE-tesseract.js-core" 2>/dev/null || true
curl -fsSL -o "$OUT/tha.traineddata" https://github.com/tesseract-ocr/tessdata_fast/raw/main/tha.traineddata
echo "tesseract.js $(grep '"version"' "$SRC/tesseract.js/package.json" | head -1) / core $(grep '"version"' "$SRC/tesseract.js-core/package.json" | head -1)" > "$OUT/VERSION.txt"
ls -l "$OUT"
