#!/bin/sh
# คัดลอก pdf.js (ตัว build สำหรับเบราว์เซอร์) จาก eval/node_modules เข้า lib/vendor/pdfjs
# extension โหลดสคริปต์จากภายนอกไม่ได้ (MV3) จึงต้องเก็บไฟล์ไว้ในแพ็กเกจ
# อัปเดตเวอร์ชัน: cd eval && npm install pdfjs-dist@latest && cd .. && sh scripts/vendor-pdfjs.sh && (cd eval && npm audit)
set -e
cd "$(dirname "$0")/.."
SRC=eval/node_modules/pdfjs-dist
[ -d "$SRC/build" ] || { echo "ยังไม่ได้ติดตั้ง: cd eval && npm install"; exit 1; }
mkdir -p lib/vendor/pdfjs
cp "$SRC/build/pdf.min.mjs" "$SRC/build/pdf.worker.min.mjs" "$SRC/LICENSE" lib/vendor/pdfjs/
# ตัวถอดรหัสภาพ (JBIG2 / JPEG2000 / สี) ของ pdf.js: ภาพสแกนส่วนใหญ่ใช้ JBIG2 ถ้าขาดจะอ่านภาพไม่ได้ (ไม่เอา quickjs ที่ใช้รันสคริปต์ใน PDF)
mkdir -p lib/vendor/pdfjs/wasm
cp "$SRC"/wasm/*.wasm "$SRC"/wasm/*_fallback.js "$SRC"/wasm/LICENSE* lib/vendor/pdfjs/wasm/
rm -f lib/vendor/pdfjs/wasm/quickjs-eval.*
echo "pdf.js $(grep '"version"' $SRC/package.json | head -1 | tr -d ' ,') -> lib/vendor/pdfjs"
