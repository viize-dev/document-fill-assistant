#!/usr/bin/env node
// วัดความแม่นยำการอ่านเอกสาร: รัน samples/*.pdf ผ่านผู้ให้บริการ AI แล้วเทียบกับ samples/expected.json
//
//   ANTHROPIC_API_KEY=sk-ant-... node eval/run.mjs
//   PROVIDER=openai OPENAI_API_KEY=... MODEL=<model-id> node eval/run.mjs
//   PROVIDER=gemini GEMINI_API_KEY=... MODEL=<model-id> node eval/run.mjs
//   PROVIDER=local node eval/run.mjs   # โหมดในเครื่อง: pdf.js + ตัวแยกฟิลด์แบบกฎ (ไม่ใช้ AI ไม่ใช้เครือข่าย; ต้อง `cd eval && npm install` ก่อน)
//   node eval/run.mjs --self-test      # ทดสอบตัวให้คะแนน ไม่เรียกเครือข่าย
//
// หมายเหตุ: เอกสารจะถูกส่งไปยังผู้ให้บริการที่เลือก (ตัวอย่างทั้งหมดเป็นข้อมูลสมมติ) และมีค่าใช้จ่ายตามการใช้งานจริง

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRows } from '../lib/mapping.js';
import { extractLocal } from '../lib/local/index.js';
import { PROVIDERS, extractFromPdf, pickModel } from '../lib/providers/index.js';
import { PROFILES } from '../profiles/index.js';
import { loadPdfLines } from '../lib/local/pdftext.js';
import { checkSummary } from './summary.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SAMPLES = join(ROOT, 'samples');
const KEY_ENV = { anthropic: 'ANTHROPIC_API_KEY', openai: 'OPENAI_API_KEY', gemini: 'GEMINI_API_KEY' };
const FIELDS = ['doc_type', 'doc_no', 'e_no', 'doc_date', 'from', 'to', 'subject', 'speed', 'secret'];

const squash = (s) => String(s ?? '').normalize('NFC').replace(/\s+/g, '').toLowerCase();

// 1 = ตรง, 0.5 = ข้อความหนึ่งอยู่ในอีกข้อความ (เช่น ขาด/เกินบางส่วน), 0 = ผิด
export function scoreField(key, expected, actual) {
  const e = squash(expected);
  const a = squash(actual);
  if (e === a) return 1;
  if (['from', 'to', 'subject'].includes(key) && a && (a.includes(e) || e.includes(a))) return 0.5;
  return 0;
}

export function scoreDoc(expected, got) {
  return Object.fromEntries(FIELDS.map((k) => [k, scoreField(k, expected[k], got[k])]));
}

function flatten(profile, extracted) {
  const rows = buildRows(profile, extracted.doc_type, extracted);
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return { doc_type: extracted.doc_type, ...byKey };
}

// ข้อความต้นฉบับของ PDF (ไว้ตรวจว่าตัวเลขในสรุปมีอยู่จริง); ภาพสแกน/ไม่มี pdf.js = ไม่มี (ข้ามการตรวจข้อนี้)
async function sourceTextOf(pdfjs, data) {
  if (!pdfjs) return null;
  try {
    const { lines } = await loadPdfLines(pdfjs, data, { maxPages: 5 });
    return lines.map((l) => l.text).join(' ');
  } catch {
    return null;
  }
}

async function selfTest() {
  const expected = JSON.parse(await readFile(join(SAMPLES, 'expected.json'), 'utf8'));
  let bad = 0;
  const check = (cond, msg) => {
    if (!cond) {
      bad++;
      console.error('✗', msg);
    }
  };
  for (const [name, exp] of Object.entries(expected)) {
    const perfect = Object.values(scoreDoc(exp, exp)).every((v) => v === 1);
    check(perfect, `${name}: เฉลยเทียบกับตัวเองต้องได้เต็ม`);
  }
  const first = Object.values(expected)[0];
  check(scoreField('doc_no', first.doc_no, 'ศธ0599/2518') === 1, 'ไม่นับช่องว่างต่างกัน');
  check(scoreField('doc_no', first.doc_no, 'ศธ 0599/2519') === 0, 'เลขที่ผิดหนึ่งหลักต้องได้ 0');
  check(scoreField('subject', 'ขอเชิญประชุมงบประมาณ', 'ขอเชิญประชุมงบประมาณ ปี 2570') === 0.5, 'ข้อความเกินมาได้ครึ่งคะแนน');
  check(scoreField('doc_date', '12/08/2569', '12/08/2568') === 0, 'วันที่ผิดปีต้องได้ 0');
  check(scoreField('speed', 'most_urgent', 'normal') === 0, 'ชั้นความเร็วผิดต้องได้ 0');
  // ตัวตรวจสรุป
  const S = (o) => checkSummary({ max: 100, ...o });
  check(S({ summary: 'ขอเชิญประชุมวันที่ 26 สิงหาคม 2569', source: 'ในวันที่ ๒๖ สิงหาคม ๒๕๖๙' }).ungrounded.length === 0, 'เลขไทยในต้นฉบับ = เลขอารบิกในสรุป ต้องตรงกัน');
  check(S({ summary: 'ของบ 20,000 บาท', source: 'เป็นเงินทั้งสิ้น ๑๕,๐๐๐ บาท' }).ungrounded[0] === '20000', 'ตัวเลขที่ไม่มีในต้นฉบับต้องถูกจับ');
  check(S({ summary: 'ของบ 15,000 บาท', source: 'เป็นเงิน 15000 บาท' }).ungrounded.length === 0, 'จุลภาคหลักพันต้องไม่ทำให้ตรวจพลาด');
  check(S({ summary: 'x'.repeat(101) }).overMax, 'ยาวเกินกรอบต้องถูกจับ');
  check(S({ summary: 'This is English only text' }).notThai, 'ไม่ใช่ภาษาไทยต้องถูกจับ');
  check(S({ summary: '' }).empty && !S({ summary: '' }).pass, 'สรุปว่างต้องไม่ผ่าน');
  check(S({ summary: 'ขอวิทยากรอบรม', keyPoints: [['วิทยากร'], ['20 กรกฎาคม', '20 ก.ค.']] }).recall.hit === 1, 'ใจความที่ขาดต้องนับขาด');
  check(S({ summary: 'ขอวิทยากร วันที่ 20 ก.ค.', keyPoints: [['วิทยากร'], ['20 กรกฎาคม', '20 ก.ค.']], source: '๒๐ กรกฎาคม' }).pass, 'ครบทุกข้อต้องผ่าน');
  console.log(bad ? `self-test ล้มเหลว ${bad} ข้อ` : 'self-test ผ่าน');
  process.exit(bad ? 1 : 0);
}

async function main() {
  if (process.argv.includes('--self-test')) return selfTest();

  const provider = process.env.PROVIDER || 'anthropic';
  const local = provider === 'local';
  // OCR=1: โหมดในเครื่องอ่านภาพสแกนด้วย OCR (ช้ากว่า ~5 วินาที/ฉบับ); ไม่ตั้ง = ภาพสแกนถือว่าอ่านไม่ได้ เหมือนเดิม
  const ocrDeps = local && process.env.OCR === '1' ? await (await import('./ocr-node.mjs')).nodeOcrDeps() : false;
  let apiKey, model, pdfjs;
  if (local) {
    model = 'pdfjs+rules';
    pdfjs = await import('./node_modules/pdfjs-dist/legacy/build/pdf.mjs').catch(() => {
      throw new Error('ยังไม่ได้ติดตั้ง pdf.js สำหรับ Node: รัน `cd eval && npm install` ก่อน');
    });
  } else {
    pdfjs = await import('./node_modules/pdfjs-dist/legacy/build/pdf.mjs').catch(() => null); // ไม่บังคับ: ใช้ตรวจสรุป
    if (!KEY_ENV[provider]) throw new Error(`PROVIDER ต้องเป็น local | ${Object.keys(KEY_ENV).join(' | ')}`);
    apiKey = process.env[KEY_ENV[provider]];
    if (!apiKey) throw new Error(`ยังไม่ได้ตั้ง ${KEY_ENV[provider]}`);
    model = process.env.MODEL || pickModel(provider, PROVIDERS[provider].models, '');
    if (!model) throw new Error('ต้องระบุ MODEL (ดูรายชื่อโมเดลที่ใช้ได้จากหน้าตั้งค่าของ extension)');
  }

  const profile = PROFILES[0];
  const expected = JSON.parse(await readFile(join(SAMPLES, 'expected.json'), 'utf8'));
  console.log(`provider=${provider}${local ? ' (ไม่ใช้ AI)' : ''} model=${model} เอกสาร ${Object.keys(expected).length} ฉบับ\n`);

  const results = [];
  for (const [name, exp] of Object.entries(expected)) {
    const base64 = (await readFile(join(SAMPLES, `${name}.pdf`))).toString('base64');
    const t0 = Date.now();
    try {
      const extracted = local
        ? await extractLocal({ data: new Uint8Array(Buffer.from(base64, 'base64')), profile, pdfjs, ocr: ocrDeps })
        : await extractFromPdf({ provider, apiKey, model, base64, profile });
      const got = flatten(profile, extracted);
      const score = scoreDoc(exp, got);
      const summaryCheck = checkSummary({
        summary: extracted.summary,
        source: await sourceTextOf(pdfjs, new Uint8Array(Buffer.from(base64, 'base64'))),
        keyPoints: exp.key_points,
      });
      results.push({ name, ms: Date.now() - t0, score, got, expected: exp, warnings: extracted.warnings || [], summary: extracted.summary || '', summaryCheck });
      const wrong = FIELDS.filter((k) => score[k] < 1).map((k) => `${k}${score[k] ? '(บางส่วน)' : ''}`);
      console.log(`${wrong.length ? '✗' : '✓'} ${name}  ${((Date.now() - t0) / 1000).toFixed(1)}s  ${wrong.length ? 'ผิด: ' + wrong.join(', ') : 'ถูกทุกฟิลด์'}`);
      for (const w of extracted.warnings || []) console.log(`    ⚠ ${w}`);
      for (const k of FIELDS.filter((k) => score[k] < 1)) console.log(`    ${k}: เฉลย="${exp[k]}"  ได้="${got[k] ?? ''}"`);
      const c = summaryCheck;
      const issues = [c.empty && 'ว่าง', c.overMax && `ยาวเกิน (${c.length}/${c.max})`, c.notThai && 'ไม่ใช่ภาษาไทย', c.ungrounded?.length && `ตัวเลขไม่มีในเอกสาร: ${c.ungrounded.join(', ')}`, c.recall && c.recall.hit < c.recall.total && `ขาดใจความ: ${c.recall.missed.join(', ')}`].filter(Boolean);
      console.log(`    สรุป ${c.pass ? '✓' : '✗'} (${c.length} ตัวอักษร${c.recall ? `, ใจความ ${c.recall.hit}/${c.recall.total}` : ''})${issues.length ? ' — ' + issues.join('; ') : ''}`);
      if (extracted.summary) console.log(`      "${extracted.summary}"`);
    } catch (e) {
      results.push({ name, error: e.message });
      console.log(`✗ ${name}  ผิดพลาด: ${e.message}`);
    }
  }

  const ok = results.filter((r) => r.score);
  console.log('\nความแม่นยำรายฟิลด์ (เฉลี่ยทุกฉบับ):');
  for (const k of FIELDS) {
    const avg = ok.length ? ok.reduce((s, r) => s + r.score[k], 0) / results.length : 0;
    console.log(`  ${k.padEnd(10)} ${(avg * 100).toFixed(0)}%`);
  }
  const total = ok.reduce((s, r) => s + Object.values(r.score).reduce((a, b) => a + b, 0), 0) / (results.length * FIELDS.length);
  console.log(`รวม ${(total * 100).toFixed(0)}%  (${results.length - ok.length} ฉบับเรียกไม่สำเร็จ นับเป็น 0)`);

  const checked = ok.filter((r) => r.summaryCheck);
  const passed = checked.filter((r) => r.summaryCheck.pass).length;
  console.log(`สรุปเรื่องผ่านการตรวจอัตโนมัติ ${passed}/${checked.length} ฉบับ (ตรวจความยาว/ภาษา/ตัวเลขตรงต้นฉบับ/ใจความ — ไม่ได้แปลว่าสรุปดี ต้องให้เจ้าหน้าที่ตรวจเพิ่ม)`);

  await mkdir(join(ROOT, 'eval', 'results'), { recursive: true });
  const out = join(ROOT, 'eval', 'results', `${provider}-${model.replace(/[^\w.-]/g, '_')}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '')}.json`);
  await writeFile(out, JSON.stringify({ provider, model, total, results }, null, 2));
  console.log(`บันทึกผลที่ ${out}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
