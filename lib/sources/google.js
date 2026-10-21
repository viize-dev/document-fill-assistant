// Gmail / Google Drive ผ่าน OAuth ของ chrome.identity (ขอสิทธิ์อ่านอย่างเดียว)
// ต้องตั้ง oauth2.client_id ใน manifest.json ก่อน (ดู README)
// หมายเหตุ: getAuthToken ใช้ได้เฉพาะ Chrome ที่ผู้ใช้ sign in โปรไฟล์ Google (เบราว์เซอร์อื่นรอทางสำรอง ดู docs/PLAN-sources.md)

import { SourceError, httpError } from './guard.js';

const PAGE = 10;

function getToken(interactive) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      const err = chrome.runtime.lastError?.message;
      if (err || !token) {
        const cancelled = /did not approve|user.*(cancel|denied)|closed/i.test(err || '');
        reject(
          new SourceError(
            cancelled ? 'ยกเลิกการเชื่อมต่อ Google' : `เชื่อมต่อ Google ไม่สำเร็จ: ${err || 'ไม่ได้รับ token'} (ตรวจ oauth2.client_id ใน manifest.json และว่า sign in Chrome ด้วยบัญชี Google อยู่)`,
            cancelled ? 'CANCELLED' : 'CONFIG',
          ),
        );
      } else resolve(token);
    });
  });
}

const dropToken = (token) => new Promise((r) => chrome.identity.removeCachedAuthToken({ token }, r));

async function api(url, token, who, retried = false) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 429 && !retried) {
    await new Promise((r) => setTimeout(r, 1500));
    return api(url, token, who, true);
  }
  if (res.status === 401) await dropToken(token); // ครั้งหน้าจะขอ token ใหม่
  if (!res.ok) throw httpError(res.status, who);
  return res;
}

const b64urlToBlob = (data) => {
  const bin = atob(data.replace(/-/g, '+').replace(/_/g, '/'));
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: 'application/pdf' });
};

async function revoke() {
  let token;
  try {
    token = await getToken(false);
  } catch {
    return; // ไม่มี token อยู่แล้ว
  }
  await dropToken(token);
  await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: 'POST' }).catch(() => {});
}

async function statusOf(accountUrl, pick, who) {
  try {
    const token = await getToken(false);
    const j = await (await api(accountUrl, token, who)).json();
    return { connected: true, account: pick(j) };
  } catch {
    return { connected: false };
  }
}

// ----- Gmail -----

const walk = (part) => [part, ...(part.parts || []).flatMap(walk)];

export const gmail = {
  id: 'gmail',
  kind: 'oauth',
  label: 'Gmail',
  permissionNote: 'ขอสิทธิ์อ่านเมลและไฟล์แนบอย่างเดียว ไม่ส่ง ไม่ลบ ไม่แก้ไขเมล',
  searchPlaceholder: 'ค้นหาอีเมล (เช่น from:... หรือคำในหัวเรื่อง)',
  status: () => statusOf('https://gmail.googleapis.com/gmail/v1/users/me/profile', (j) => j.emailAddress, 'Gmail'),
  connect: async () => void (await getToken(true)),
  disconnect: () => revoke(),

  // -> { items: [{id, source, name, meta, size, messageId, attachmentId}], nextCursor }
  async list({ query = '', days = 0, cursor = '' } = {}) {
    const token = await getToken(true);
    const parts = ['has:attachment', 'filename:pdf', days ? `newer_than:${Number(days)}d` : '', query.trim()];
    const q = encodeURIComponent(parts.filter(Boolean).join(' '));
    const page = cursor ? `&pageToken=${encodeURIComponent(cursor)}` : '';
    const list = await (await api(`https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${PAGE}&q=${q}${page}`, token, 'Gmail')).json();

    // ดึงรายละเอียดทุกฉบับพร้อมกัน (เดิมยิงทีละฉบับ)
    const msgs = await Promise.all(
      (list.messages || []).map(async (m) => (await api(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=full`, token, 'Gmail')).json()),
    );
    const items = [];
    for (const msg of msgs) {
      const header = (n) => msg.payload.headers.find((h) => h.name.toLowerCase() === n)?.value || '';
      walk(msg.payload)
        .filter((p) => p.filename && /\.pdf$/i.test(p.filename) && p.body?.attachmentId)
        .forEach((p) =>
          items.push({
            id: `${msg.id}:${p.body.attachmentId}`,
            source: 'gmail',
            name: p.filename,
            meta: `${header('from')} · ${header('subject')}`,
            date: Number(msg.internalDate) || 0,
            size: p.body.size || 0,
            messageId: msg.id,
            attachmentId: p.body.attachmentId,
          }),
        );
    }
    return { items, nextCursor: list.nextPageToken || '' };
  },

  async download(item) {
    const token = await getToken(true);
    const att = await (
      await api(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${item.messageId}/attachments/${item.attachmentId}`, token, 'Gmail')
    ).json();
    return b64urlToBlob(att.data);
  },
};

// ----- Google Drive -----

export const drive = {
  id: 'drive',
  kind: 'oauth',
  label: 'Google Drive',
  permissionNote: 'ขอสิทธิ์อ่านไฟล์ใน Drive อย่างเดียว ไม่แก้ไข ไม่ลบ ไม่อัปโหลด',
  searchPlaceholder: 'ค้นหาชื่อไฟล์ใน Drive',
  status: () => statusOf('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)', (j) => j.user?.emailAddress, 'Google Drive'),
  connect: async () => void (await getToken(true)),
  disconnect: () => revoke(),

  async list({ query = '', days = 0, cursor = '' } = {}) {
    const token = await getToken(true);
    const safe = query.replace(/['\\]/g, '');
    const conds = ["mimeType='application/pdf'", 'trashed=false'];
    if (safe) conds.push(`name contains '${safe}'`);
    if (days) conds.push(`modifiedTime > '${new Date(Date.now() - days * 864e5).toISOString()}'`);
    const url =
      'https://www.googleapis.com/drive/v3/files?pageSize=15&orderBy=modifiedTime desc' +
      `&q=${encodeURIComponent(conds.join(' and '))}` +
      `&fields=${encodeURIComponent('nextPageToken,files(id,name,modifiedTime,size)')}` +
      (cursor ? `&pageToken=${encodeURIComponent(cursor)}` : '');
    const res = await (await api(url, token, 'Google Drive')).json();
    return {
      items: (res.files || []).map((f) => ({
        id: f.id,
        source: 'drive',
        name: f.name,
        meta: new Date(f.modifiedTime).toLocaleString('th-TH'),
        date: Date.parse(f.modifiedTime) || 0,
        size: Number(f.size) || 0,
      })),
      nextCursor: res.nextPageToken || '',
    };
  },

  async download(item) {
    const token = await getToken(true);
    const res = await api(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(item.id)}?alt=media`, token, 'Google Drive');
    return new Blob([await res.arrayBuffer()], { type: 'application/pdf' });
  },
};
