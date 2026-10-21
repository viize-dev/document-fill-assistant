// จำว่าไฟล์ไหนประมวลผลแล้ว (เก็บเฉพาะรหัสรายการ ไม่เก็บชื่อ/เนื้อหา) เพื่อขึ้นป้าย "ทำแล้ว"

const KEY = 'sourceHistory';
const MAX = 500;

export const itemKey = (item) => `${item.source}:${item.id}`;

export async function doneSet() {
  const { [KEY]: list = [] } = await chrome.storage.local.get(KEY);
  return new Set(list);
}

export async function markDone(item) {
  const { [KEY]: list = [] } = await chrome.storage.local.get(KEY);
  const key = itemKey(item);
  const next = [key, ...list.filter((k) => k !== key)].slice(0, MAX);
  await chrome.storage.local.set({ [KEY]: next });
}

export const clearHistory = () => chrome.storage.local.remove(KEY);
