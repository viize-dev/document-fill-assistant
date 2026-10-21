// โฟลเดอร์ในเครื่อง (File System Access API): ไม่ต้อง login ใช้กับไฟล์ที่เครื่องสแกนหรือระบบอื่นวางไว้
// เก็บ handle ของโฟลเดอร์ใน IndexedDB (เก็บ handle ได้ แต่ต้องขอสิทธิ์อ่านใหม่เมื่อเปิดเบราว์เซอร์ครั้งถัดไป)

import { SourceError } from './guard.js';

const DB = 'dfa-sources';
const STORE = 'handles';
const KEY = 'folder';
const PAGE = 15;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idb(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
  });
}
const getHandle = () => idb('readonly', (s) => s.get(KEY));

// แคชรายการที่เรียงแล้ว เพื่อแบ่งหน้าโดยไม่สแกนโฟลเดอร์ซ้ำ
let cache = null;
const handles = new Map(); // id -> FileSystemFileHandle

export const folder = {
  id: 'folder',
  kind: 'folder',
  label: 'โฟลเดอร์ในเครื่อง',
  permissionNote: 'อ่านเฉพาะไฟล์ PDF ในโฟลเดอร์ที่คุณเลือก ไม่ส่งไฟล์ไปไหนนอกจากขั้นวิเคราะห์',
  searchPlaceholder: 'ค้นหาชื่อไฟล์',

  async status() {
    try {
      const h = await getHandle();
      if (!h) return { connected: false };
      return { connected: true, account: h.name, needsPermission: (await h.queryPermission({ mode: 'read' })) !== 'granted' };
    } catch {
      return { connected: false };
    }
  },

  // ต้องมาจากการคลิกของผู้ใช้
  async connect() {
    try {
      const existing = await getHandle();
      if (existing && (await existing.requestPermission({ mode: 'read' })) === 'granted') return;
      const h = await showDirectoryPicker({ mode: 'read', id: 'dfa-pdf' });
      await idb('readwrite', (s) => s.put(h, KEY));
    } catch (e) {
      if (e.name === 'AbortError') throw new SourceError('ยกเลิกการเลือกโฟลเดอร์', 'CANCELLED');
      throw new SourceError(`เปิดโฟลเดอร์ไม่สำเร็จ: ${e.message}`, 'CONFIG');
    }
    cache = null;
  },

  async disconnect() {
    await idb('readwrite', (s) => s.delete(KEY));
    cache = null;
    handles.clear();
  },

  async list({ query = '', days = 0, cursor = '' } = {}) {
    const h = await getHandle();
    if (!h) throw new SourceError('ยังไม่ได้เลือกโฟลเดอร์', 'AUTH');
    if ((await h.queryPermission({ mode: 'read' })) !== 'granted') throw new SourceError('ต้องอนุญาตให้อ่านโฟลเดอร์อีกครั้ง กด "เชื่อมต่อ"', 'AUTH');
    const offset = Number(cursor) || 0;
    if (!offset || !cache) {
      const all = [];
      handles.clear();
      for await (const [name, entry] of h.entries()) {
        if (entry.kind !== 'file' || !/\.pdf$/i.test(name)) continue;
        const f = await entry.getFile();
        handles.set(name, entry);
        all.push({ id: name, source: 'folder', name, meta: new Date(f.lastModified).toLocaleString('th-TH'), date: f.lastModified, size: f.size });
      }
      cache = all.sort((a, b) => b.date - a.date);
    }
    const q = query.trim().toLowerCase();
    const since = days ? Date.now() - days * 864e5 : 0;
    const hits = cache.filter((i) => (!q || i.name.toLowerCase().includes(q)) && i.date >= since);
    const slice = hits.slice(offset, offset + PAGE);
    return { items: slice, nextCursor: offset + PAGE < hits.length ? String(offset + PAGE) : '' };
  },

  async download(item) {
    const entry = handles.get(item.id) || (await (await getHandle())?.getFileHandle(item.id));
    if (!entry) throw new SourceError('ไม่พบไฟล์ในโฟลเดอร์ (อาจถูกย้ายหรือลบ)', 'NOT_FOUND');
    return entry.getFile();
  },
};
