// แหล่งไฟล์ทั้งหมด: เพิ่มแหล่งใหม่ = เพิ่มไฟล์ adapter แล้วลงทะเบียนที่นี่ (side panel ไม่ต้องแก้)
// อินเทอร์เฟซ: { id, kind, label, permissionNote, searchPlaceholder,
//   status(): {connected, account?}, connect(), disconnect(),
//   list({query, days, cursor}): {items, nextCursor}, download(item): Blob }

import { gmail, drive } from './google.js';
import { msmail, msdrive } from './microsoft.js';
import { folder } from './folder.js';
import { checkPdf } from './guard.js';

export const SOURCES = { gmail, drive, msmail, msdrive, folder };

// ดาวน์โหลดแล้วตรวจว่าเป็น PDF ขนาดไม่เกินกำหนดก่อนส่งต่อ
export async function fetchItem(item) {
  const src = SOURCES[item.source];
  if (!src) throw new Error(`ไม่รู้จักแหล่งไฟล์ ${item.source}`);
  return checkPdf(await src.download(item));
}
