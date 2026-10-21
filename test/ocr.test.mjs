// รัน: node --test "test/*.test.mjs"   (ต้อง `cd eval && npm install` สำหรับเทสต์ที่ใช้ pdf.js/canvas/tesseract ใน Node)
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { autoContrast, linesFromOcr, ocrPages } from '../lib/local/ocr.js';

const bb = (x0, y0, x1, y1) => ({ x0, y0, x1, y1 });
const line = (text, y0, confidence = 90, x0 = 100, x1 = 900) => ({ text, confidence, bbox: bb(x0, y0, x1, y0 + 30) });
const blocks = (...lines) => [{ paragraphs: [{ lines }] }];

test('linesFromOcr: แปลงพิกัดเป็นแบบ PDF (บนมากกว่า), เรียงบนลงล่าง, แบ่งช่วงด้วยช่องว่างกว้าง, ซ่อมข้อความไทย', () => {
  const out = linesFromOcr(blocks(line('เรียน  ผส.ชป.2', 400), line('ส่วนราชการ  สํานักบริหารโครงการ  โทร. 2231', 100)), { pageHeightPx: 1600, scale: 2 });
  assert.equal(out.length, 2);
  assert.ok(out[0].y > out[1].y, 'บรรทัดบนต้องมี y มากกว่า');
  assert.deepEqual(out[0].segments, ['ส่วนราชการ', 'สำนักบริหารโครงการ', 'โทร. 2231'], 'นิคหิต+สระอา -> สระอำ และแบ่งช่วง');
  assert.equal(out[0].x, 50);
  assert.equal(out[0].right, 450);
  assert.equal(out[0].page, 1);
});

test('linesFromOcr: ตัดบรรทัดที่เอนจินไม่มั่นใจและบรรทัดขยะ (ตราประทับ/รอยเปื้อน)', () => {
  const out = linesFromOcr(blocks(line('เรื่อง ขอความอนุเคราะห์', 100, 90), line('เรื่อง ขอความอนุเคราะห์', 140, 30), line('. , ; : ` \' " - _', 180, 95), line('   ', 220, 95)), { pageHeightPx: 1000 });
  assert.deepEqual(out.map((l) => l.text), ['เรื่อง ขอความอนุเคราะห์']);
});

test('autoContrast: ภาพจางถูกยืดให้เข้มขึ้น, ภาพปกติไม่ถูกแตะ', () => {
  const mk = (ink, paper) => {
    const px = 1000;
    const d = new Uint8ClampedArray(px * 4);
    for (let i = 0; i < px; i++) {
      const v = i < 30 ? ink : paper; // 3% เป็นหมึก
      d.set([v, v, v, 255], i * 4);
    }
    return { data: d };
  };
  const faint = mk(170, 250);
  assert.equal(autoContrast(faint), true);
  assert.ok(faint.data[0] < 20, `หมึกจางต้องเข้มขึ้น (ได้ ${faint.data[0]})`);
  assert.ok(faint.data[4 * 500] > 240, 'พื้นกระดาษต้องยังขาว');
  const normal = mk(30, 250);
  assert.equal(autoContrast(normal), false);
  assert.equal(normal.data[0], 30);
  assert.equal(autoContrast(mk(200, 205)), false, 'ภาพเรียบเกินไปไม่ปรับ');
});

const evalReady = existsSync(new URL('../eval/node_modules/@napi-rs/canvas', import.meta.url)) && existsSync(new URL('../eval/node_modules/pdfjs-dist/legacy/build/pdf.mjs', import.meta.url));

test('extractLocal: PDF ภาพสแกน -> ใช้ OCR, ลดความมั่นใจ, เตือน, ล้างเลขที่ที่เป็นขยะ', { skip: !evalReady && 'ไม่มี eval/node_modules' }, async () => {
  const { extractLocal } = await import('../lib/local/index.js');
  const { createCanvas } = await import('../eval/node_modules/@napi-rs/canvas/index.js');
  const pdfjs = await import('../eval/node_modules/pdfjs-dist/legacy/build/pdf.mjs');
  const { default: profile } = await import('../profiles/saraban.js');
  const fakeBlocks = blocks(
    line('ที่ สมกอตสส์เฉ 7ร717ฏ  วันที่ ธนาคม 255', 130),
    line('เรื่อง ขอความอนุเคราะห์ข้อมูลผู้ป่วยโรคติดต่อรายสัปดาห์', 200),
    line('เรียน นายแพทย์สาธารณสุขจังหวัดสมมติ', 260),
  );
  const progress = [];
  const deps = {
    createCanvas,
    canvasToImage: (c) => c,
    createWorker: async () => ({ recognize: async () => ({ data: { blocks: fakeBlocks, confidence: 80 } }), terminate: async () => {} }),
  };
  const data = new Uint8Array(readFileSync(new URL('../samples/s4-external-scan.pdf', import.meta.url)));
  const r = await extractLocal({ data, profile, pdfjs, ocr: deps, onProgress: (t) => progress.push(t) });
  assert.equal(r.fields.subject, 'ขอความอนุเคราะห์ข้อมูลผู้ป่วยโรคติดต่อรายสัปดาห์');
  assert.equal(r.fields.to, 'นายแพทย์สาธารณสุขจังหวัดสมมติ');
  assert.equal(r.fields.doc_no, '', 'เลขที่หนังสือที่เป็นขยะต้องเว้นว่าง');
  assert.ok(Object.values(r.field_confidence).every((c) => c <= 0.5), 'OCR: ทุกช่องมั่นใจไม่เกิน 50%');
  assert.match(r.warnings[0], /OCR/);
  assert.ok(r.warnings.some((w) => /กรอกเอง/.test(w)), "ต้องเตือนเมื่อเลขที่/วันที่อ่านไม่ได้");
  assert.ok(progress.some((t) => /OCR/.test(t)));
  await assert.rejects(() => extractLocal({ data: new Uint8Array(readFileSync(new URL('../samples/s4-external-scan.pdf', import.meta.url))), profile, pdfjs, ocr: false }), /ภาพสแกน/, 'ปิด OCR = ข้อความเดิม');
});

const tessReady = evalReady && existsSync(new URL('../lib/vendor/ocr/tha.traineddata', import.meta.url)) && existsSync(new URL('../eval/node_modules/tesseract.js', import.meta.url));

test('OCR จริง (tesseract) กับภาพสแกนตัวอย่าง s4: จาก/ถึง/เรื่อง ต้องตรงเฉลย', { skip: !tessReady && 'ไม่มี tesseract/โมเดลภาษาไทย', timeout: 120000 }, async () => {
  const { extractLocal } = await import('../lib/local/index.js');
  const { nodeOcrDeps } = await import('../eval/ocr-node.mjs');
  const pdfjs = await import('../eval/node_modules/pdfjs-dist/legacy/build/pdf.mjs');
  const { default: profile } = await import('../profiles/saraban.js');
  const expected = JSON.parse(readFileSync(new URL('../samples/expected.json', import.meta.url), 'utf8'))['s4-external-scan'];
  const r = await extractLocal({ data: new Uint8Array(readFileSync(new URL('../samples/s4-external-scan.pdf', import.meta.url))), profile, pdfjs, ocr: await nodeOcrDeps() });
  for (const k of ['from', 'to', 'subject']) assert.equal(r.fields[k].replace(/\s+/g, ''), expected[k].replace(/\s+/g, ''), k);
  assert.equal(r.doc_type, 'external');
});

test('ocrPages: หน้าแรกเป็นภาพแนบ (ไม่มีตัวหนังสือ) -> ข้ามไปหน้าถัดไปที่เจอเรื่อง/เรียน', async () => {
  const pdfjs = {
    getDocument: () => ({
      promise: Promise.resolve({
        numPages: 5,
        getPage: async (n) => ({ getViewport: () => ({ width: 100, height: 100 }), render: () => ({ promise: Promise.resolve(), n }) }),
      }),
      destroy: async () => {},
    }),
  };
  let call = 0;
  const pages = [blocks(), blocks(line('เรื่อง ขอความอนุเคราะห์', 100), line('เรียน อธิบดี', 150)), blocks(line('เรื่อง หน้าสามไม่ควรถูกอ่าน', 100))];
  let terminated = 0;
  const deps = {
    createCanvas: () => ({ width: 100, height: 100, getContext: () => ({ getImageData: () => ({ data: new Uint8ClampedArray(400).fill(255) }), putImageData() {} }) }),
    canvasToImage: (c) => c,
    createWorker: async () => ({ recognize: async () => ({ data: { blocks: pages[call++], confidence: 70 } }), terminate: async () => terminated++ }),
  };
  const r = await ocrPages({ data: new Uint8Array(1), pdfjs, deps, accept: (ls) => ls.some((l) => l.text.startsWith('เรื่อง')) });
  assert.equal(r.pageNo, 2);
  assert.equal(call, 2, 'อ่านแค่สองหน้า แล้วหยุดเมื่อเจอ');
  assert.equal(terminated, 1, 'ปิด worker ทุกครั้ง');
  assert.equal(r.lines.length, 2);

  call = 0;
  pages.splice(0, 3, blocks(), blocks(), blocks());
  const none = await ocrPages({ data: new Uint8Array(1), pdfjs, deps, maxPages: 3, accept: () => false });
  assert.equal(none.tried, 3, 'ไม่เจอเลย: ลองครบ maxPages');
}
);

import { fixOcrText, fixOcrLines } from '../lib/local/ocr.js';

test('แก้คำที่ OCR อ่านผิดซ้ำ: น้้า->น้ำ, พื่นที่->พื้นที่, คำเฉพาะงานจาก profile; คำที่ถูกอยู่แล้วไม่ถูกแตะ', () => {
  assert.equal(fixOcrText('การจัดการน้้าของโครงการ'), 'การจัดการน้ำของโครงการ');
  assert.equal(fixOcrText('ลงพื่นที่'), 'ลงพื้นที่');
  assert.equal(fixOcrText('คลองชลประทานฝังขวา', [['ฝังขวา', 'ฝั่งขวา']]), 'คลองชลประทานฝั่งขวา');
  assert.equal(fixOcrText('น้ำท่วม ฝั่งซ้าย พื้นที่'), 'น้ำท่วม ฝั่งซ้าย พื้นที่');
  const [l] = fixOcrLines([{ segments: ['ก้้า', 'x'], text: 'ก้้า  x' }]);
  assert.equal(l.text, 'ก้ำ  x');
});
