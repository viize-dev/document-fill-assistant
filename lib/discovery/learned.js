// ความจำการจับคู่ (F3): เก็บเฉพาะตัวตนของช่อง ↔ ฟิลด์ ไม่เก็บค่าเอกสาร
// รูปแบบ: { [origin]: { [signature]: { savedAt, profileId, label, map: { key: {selector,id,name,label} } } } }
import { fieldIdent } from './match.js';

const KEY = 'learned';
const MAX_PER_ORIGIN = 20;

export async function loadAll(store) {
  const got = await store.get(KEY);
  return got?.[KEY] || {};
}

// สร้างรายการที่จะบันทึกจากผลจับคู่ (เฉพาะที่ผู้ใช้ยืนยันแล้ว)
export function toLearnedMap(entries) {
  return Object.fromEntries(
    entries
      .filter((e) => e.confirmed)
      .map((e) => [e.key, { selector: e.selector, id: e.field.id || '', name: e.field.name || '', label: e.field.label || '', ident: fieldIdent(e.field) }]),
  );
}

export async function saveLearned(store, { origin, signature, profileId, label = '', entries, now = Date.now() }) {
  const all = await loadAll(store);
  const bucket = { ...(all[origin] || {}) };
  bucket[signature] = { savedAt: now, profileId, label, map: toLearnedMap(entries) };
  const keep = Object.entries(bucket).sort((a, b) => b[1].savedAt - a[1].savedAt).slice(0, MAX_PER_ORIGIN);
  await store.set({ [KEY]: { ...all, [origin]: Object.fromEntries(keep) } });
}

export async function forgetLearned(store, origin, signature) {
  const all = await loadAll(store);
  if (!all[origin]) return;
  const { [signature]: _gone, ...rest } = all[origin];
  await store.set({ [KEY]: { ...all, [origin]: rest } });
}

// หารายการที่จำไว้: ลายเซ็นตรงเป๊ะ = ใช้ได้เลย; ไม่ตรงแต่ช่องเหลื่อมกัน ≥ 50% = ใช้เป็นข้อเสนอ (changed)
export function pickLearned(all, origin, signature, snapshot, profileId) {
  const bucket = all?.[origin];
  if (!bucket) return null;
  const exact = bucket[signature];
  if (exact && exact.profileId === profileId) return { map: exact.map, changed: false, savedAt: exact.savedAt };
  const have = new Set(snapshot.fields.map(fieldIdent));
  let best = null;
  for (const rec of Object.values(bucket)) {
    if (rec.profileId !== profileId) continue;
    const idents = Object.values(rec.map).map((m) => m.ident).filter(Boolean);
    if (!idents.length) continue;
    const overlap = idents.filter((i) => have.has(i)).length / idents.length;
    if (overlap >= 0.5 && (!best || overlap > best.overlap)) best = { overlap, rec };
  }
  return best ? { map: best.rec.map, changed: true, savedAt: best.rec.savedAt } : null;
}
