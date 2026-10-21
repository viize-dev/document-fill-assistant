// ตัวจับคู่ช่องในหน้า ↔ ฟิลด์กลางของ profile (F2): ชั้น profile → จำไว้ → กฎ+พจนานุกรม
// ผลลัพธ์ทุกรายการมีระดับความมั่นใจ ช่องที่กำกวมไม่ถูกจัดเป็น high (จะไม่กรอกเองจนกว่าผู้ใช้ยืนยัน)
import { SYNONYMS } from './synonyms.js';
import { toArabic } from '../mapping.js';

export const LEVELS = { HIGH: 'high', MEDIUM: 'medium', LOW: 'low' };
const MIN_SCORE = 0.4;
const AMBIGUITY_GAP = 0.15;

export const normText = (s) =>
  toArabic(s)
    .toLowerCase()
    .replace(/[\s​-‍﻿.,:;*()[\]{}'"`/\\|_\-–—#?!]/g, '');

// ตัดคำนำหน้าชื่อช่องที่พบบ่อย (txtSubject, ctl00_f_subject) ให้เหลือแก่นชื่อ
const NAME_PREFIX = /^(?:ctl\d+|txt|tb|inp|input|edt|ed|sel|ddl|cbo|fld|field|frm|form|f)+w?/;
function nameCore(s) {
  const t = normText(s);
  const stripped = t.replace(NAME_PREFIX, '');
  return stripped || t;
}

// ข้อความที่ต้องไม่มีคำ exclude (เทียบแบบไม่สนช่องว่าง)
const hasExclude = (text, list) => (list || []).some((x) => text.includes(normText(x)));

function textScore(raw, syn, key) {
  const t = normText(raw);
  if (!t) return { score: 0 };
  const excl = hasExclude(t, syn.exclude);
  let best = { score: 0, term: '' };
  const consider = (term, base, exact) => {
    const n = normText(term);
    if (!n) return;
    if (t === n) {
      if (base > best.score) best = { score: base, term };
    } else if (!exact && n.length >= 3 && t.includes(n) && !excl) {
      const coverage = n.length / t.length;
      const s = Math.min(0.9, 0.6 + 0.3 * coverage) * (base < 1 ? 0.8 : 1);
      if (s > best.score) best = { score: s, term };
    }
  };
  (syn.th || []).forEach((w) => consider(w, 1, false));
  (syn.weak || []).forEach((w) => consider(w, 0.7, true));
  (syn.en || []).forEach((w) => consider(w, 1, false));
  void key;
  return best;
}

function nameScore(raw, syn) {
  const core = nameCore(raw);
  if (!core) return { score: 0 };
  let best = { score: 0, term: '' };
  [...(syn.en || []), ...(syn.weak || []).filter((w) => /^[a-z]+$/.test(w))].forEach((w) => {
    const n = normText(w);
    if (core === n) best = best.score >= 0.7 ? best : { score: 0.7, term: w };
    else if (n.length >= 4 && core.includes(n) && best.score < 0.55) best = { score: 0.55, term: w };
  });
  return best;
}

// หาตัวเลือกในหน้าที่ตรงกับตัวเลือกกลาง (code, label): คืน { code: ค่าที่ใช้กรอก }
export function mapOptions(canonical, pageOptions) {
  const map = {};
  (canonical || []).forEach(([code, label]) => {
    const nl = normText(label);
    const hit =
      pageOptions.find((o) => normText(o.text) === nl) ||
      pageOptions.find((o) => o.value === code) ||
      pageOptions.find((o) => nl.length >= 3 && normText(o.text).includes(nl) && !(canonical || []).some(([, l]) => l !== label && normText(l).length > nl.length && normText(o.text).includes(normText(l)))) ||
      null;
    if (hit) map[code] = hit.value !== '' ? hit.value : hit.text;
  });
  return map;
}

// ฟิลด์ใน profile ที่ควรจับคู่ได้: กรอกลงหน้าได้ (fill !== false), ไม่ใช่ช่องภายใน
export function matchableKeys(profile) {
  return Object.entries(profile.fields)
    .filter(([key, f]) => f.fill !== false && !f.internal && key !== 'doc_type')
    .map(([key]) => key);
}

const synOf = (profile, key) => {
  const base = SYNONYMS[key] || {};
  const alias = profile.fields[key]?.aliases || [];
  const own = [profile.fields[key]?.label].filter(Boolean);
  return { ...base, th: [...(base.th || []), ...alias, ...own] };
};

function scorePair(field, key, profile) {
  const def = profile.fields[key];
  const syn = synOf(profile, key);
  const evidence = [];
  let best = 0;
  const bump = (s, why) => {
    if (s > 0) evidence.push([s, why]);
    if (s > best) best = s;
  };
  // ป้ายชื่อหลายแหล่ง (แหล่งแรกน้ำหนักเต็ม)
  (field.labels?.length ? field.labels : field.label ? [field.label] : []).forEach((l, i) => {
    const r = textScore(l, syn, key);
    bump(r.score * (i === 0 ? 1 : 0.9), `ป้าย "${l}"`);
  });
  (field.hints || []).forEach((h) => {
    const r = textScore(h, syn, key);
    bump(r.score * 0.9, `คำใบ้ "${h}"`);
  });
  [field.name, field.id].filter(Boolean).forEach((n) => {
    const r = nameScore(n, syn);
    bump(r.score, `ชื่อช่อง ${n}`);
  });
  // เห็นตรงกันหลายแหล่งเพิ่มความมั่นใจ
  const strong = evidence.filter(([s]) => s >= 0.55);
  if (strong.length >= 2) best = Math.min(1, best + 0.1);

  let optionMap = null;
  let note = '';
  if (def.kind === 'select') {
    if (field.kind !== 'select') best *= 0.4;
    else {
      optionMap = mapOptions(def.options, field.options);
      const total = def.options.length;
      const hit = Object.keys(optionMap).length;
      const distinct = def.options.filter(([code, label]) => optionMap[code] && !def.options.some(([c2, l2]) => c2 !== code && normText(l2) === normText(label))).length;
      if (hit === 0) {
        best *= 0.4;
        note = 'ไม่มีตัวเลือกที่ตรงกัน';
      } else if (hit >= 3 && hit / total >= 0.75 && distinct >= 2) {
        if (best < 0.75) {
          best = 0.75;
          evidence.push([0.75, `ตัวเลือกตรงกัน ${hit}/${total}`]);
        }
      } else if (hit < total) note = `ตัวเลือกตรง ${hit}/${total}`;
    }
  } else {
    if (field.kind === 'select') best *= 0.5;
    if (field.kind === 'checkbox' || field.kind === 'radio' || field.kind === 'editable') best = 0;
    if (def.kind === 'date') {
      if (field.kind === 'textarea') best *= 0.5;
      else if (field.dateLike) best = Math.min(1, best + 0.05);
    }
    if (field.maxlength && field.maxlength < 12 && (key === 'subject' || key === 'detail')) best *= 0.7;
  }
  const top = evidence.sort((a, b) => b[0] - a[0])[0];
  return { score: Math.round(best * 100) / 100, reason: top ? top[1] : '', note, optionMap };
}

export function fieldIdent(f) {
  return `${f.id || ''}|${f.name || ''}|${normText(f.label)}|${f.kind}`;
}

// กรอกได้จริงหรือไม่: มองเห็น ไม่ปิดใช้งาน ไม่อ่านอย่างเดียว
export const usable = (f) => f.visible && !f.disabled && !f.readonly;

// snapshot + profile (+ ที่จำไว้) -> { entries, unmatched, missing, warnings }
// learned = { map: { key: {selector,id,name,label} }, changed: boolean } | null
export function matchSnapshot(snapshot, profile, { learned = null } = {}) {
  const fields = snapshot.fields.filter(usable);
  const keys = matchableKeys(profile);
  const taken = new Map(); // key -> entry
  const used = new Set(); // field.i
  const entries = [];
  const warnings = [];

  const commit = (field, key, score, level, reason, extra = {}) => {
    const def = profile.fields[key];
    const optionMap = def.kind === 'select' ? extra.optionMap || mapOptions(def.options, field.options) : null;
    const entry = { key, field, selector: field.selector, score, level, reason, optionMap, note: extra.note || '', source: extra.source || 'rule', ambiguous: !!extra.ambiguous };
    taken.set(key, entry);
    used.add(field.i);
    entries.push(entry);
  };

  // L1: ช่องที่ตรงกับ selector ใน profile
  fields.forEach((f) => {
    const key = (f.profileKeys || []).find((k) => keys.includes(k) && !taken.has(k));
    if (key) commit(f, key, 1, LEVELS.HIGH, 'ตรงกับโปรไฟล์', { source: 'profile' });
  });

  // ที่จำไว้ (ผู้ใช้เคยยืนยัน): ตรวจตัวตนของช่องจาก selector/id/name
  if (learned?.map) {
    Object.entries(learned.map).forEach(([key, m]) => {
      if (!keys.includes(key) || taken.has(key)) return;
      const f = fields.find(
        (x) => !used.has(x.i) && (x.selector === m.selector || (m.id && x.id === m.id) || (m.name && x.name === m.name && normText(x.label) === normText(m.label))),
      );
      if (f) commit(f, key, 0.95, learned.changed ? LEVELS.MEDIUM : LEVELS.HIGH, learned.changed ? 'จำไว้ (หน้าเปลี่ยนไป ตรวจอีกครั้ง)' : 'ตรงกับที่จำไว้', { source: 'learned' });
      else warnings.push(`ไม่พบช่อง "${m.label || m.id || m.name || m.selector}" ที่เคยบันทึกไว้สำหรับ ${profile.fields[key]?.label || key}`);
    });
  }

  // L2: กฎ + พจนานุกรม สำหรับที่เหลือ
  const open = keys.filter((k) => !taken.has(k));
  const pairs = [];
  fields.filter((f) => !used.has(f.i)).forEach((f) => open.forEach((k) => {
    const r = scorePair(f, k, profile);
    if (r.score >= MIN_SCORE) pairs.push({ f, k, ...r });
  }));
  pairs.sort((a, b) => b.score - a.score);
  const rival = (p) => {
    const other = pairs.filter((q) => q !== p && ((q.f === p.f && q.k !== p.k) || (q.k === p.k && q.f !== p.f)));
    return other.length ? Math.max(...other.map((q) => q.score)) : 0;
  };
  for (const p of pairs) {
    if (taken.has(p.k) || used.has(p.f.i)) continue;
    const alt = rival(p);
    const ambiguous = alt >= 0.5 && alt >= p.score - AMBIGUITY_GAP;
    const level = p.score >= 0.85 && !ambiguous ? LEVELS.HIGH : p.score >= 0.6 ? LEVELS.MEDIUM : LEVELS.LOW;
    commit(p.f, p.k, p.score, level, p.reason, { ambiguous, note: p.note, optionMap: p.optionMap });
  }

  const unmatched = snapshot.fields.filter((f) => !used.has(f.i));
  const missing = keys.filter((k) => !taken.has(k));
  if (snapshot.crossOriginFrames) warnings.push(`มี iframe ข้ามโดเมน ${snapshot.crossOriginFrames} ตัวที่อ่านไม่ได้`);
  return { entries, unmatched, missing, warnings };
}

// ลายเซ็นของฟอร์ม: ใช้ดูว่าเป็น "หน้าเดิม" ไหม (FNV-1a 32 บิตของชุดตัวตนช่องที่เรียงแล้ว)
export function formSignature(snapshot) {
  const idents = snapshot.fields
    .filter((f) => f.visible && !f.disabled && !['checkbox', 'radio'].includes(f.kind))
    .map((f) => fieldIdent(f))
    .sort();
  let h = 0x811c9dc5;
  for (const ch of idents.join('\n')) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

// หน้านี้เป็นฟอร์มกรอกหนังสือ (ปลายทางของการกรอก) หรือไม่: กันไม่ให้ไปกรอกลงหน้าค้นหา/รายงานที่มีช่อง "เลขที่หนังสือ/จาก/ถึง" เหมือนกัน
// คืน { kind: 'form' | 'search' | 'unknown', reason }
const NOT_FORM_HEADING = /ค้นหา|สืบค้น|search|รายงาน|สถิติ|พิมพ์|ติดตาม/i;
const RANGE_LABEL = /^(เริ่ม|ตั้งแต่|ถึง(?=วันที่|เลข|เวลา|ปี)|ถึงวันที่|from\s|to\s)/i;
export function classifyPage(snapshot, result) {
  const heading = snapshot.heading || '';
  if (NOT_FORM_HEADING.test(heading)) return { kind: 'search', reason: `หัวเรื่องหน้า "${heading}"` };
  const ranges = snapshot.fields.filter((f) => f.visible && RANGE_LABEL.test(f.label || '')).length;
  if (ranges >= 3) return { kind: 'search', reason: `มีช่องช่วง (เริ่ม…/ถึง…) ${ranges} ช่อง เหมือนหน้าค้นหา` };
  const core = ['subject', 'from', 'to', 'doc_no', 'doc_date'].filter((k) => result.entries.some((e) => e.key === k));
  if (core.includes('subject') && core.length >= 3) return { kind: 'form', reason: `พบช่องหลัก ${core.length}/5` };
  return { kind: 'unknown', reason: core.length ? `พบช่องหลักเพียง ${core.length}/5 (ต้องมีเรื่อง + อีกอย่างน้อย 2)` : 'ไม่พบช่องของฟอร์มกรอกหนังสือ' };
}
