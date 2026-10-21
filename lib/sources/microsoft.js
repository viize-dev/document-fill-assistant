// Outlook / OneDrive ผ่าน Microsoft Graph: OAuth authorization code + PKCE ด้วย chrome.identity.launchWebAuthFlow
// ใช้ endpoint "common" รองรับทั้งบัญชีส่วนตัวและองค์กร (สิทธิ์อ่านอย่างเดียว)
// ⚠ ยังไม่ได้ทดสอบกับการลงทะเบียนแอปจริง: ประเภท platform ของ redirect URI (SPA / public client) มีผลต่อการแลก token
//   จาก extension ต้องทดสอบตอนลงทะเบียน ดู docs/PLAN-sources.md

import { SOURCE_CONFIG } from './config.js';
import { SourceError, httpError } from './guard.js';

const AUTH = 'https://login.microsoftonline.com/common/oauth2/v2.0';
const GRAPH = 'https://graph.microsoft.com/v1.0';
const SCOPES = 'offline_access User.Read Mail.Read Files.Read';
const KEY = 'msAuth';
const PAGE = 10;

const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const randomString = (n = 32) => b64url(crypto.getRandomValues(new Uint8Array(n)));

const clientId = () => {
  if (!SOURCE_CONFIG.microsoftClientId) {
    throw new SourceError('ยังไม่ได้ตั้งค่า Microsoft client id (lib/sources/config.js) ดู README', 'CONFIG');
  }
  return SOURCE_CONFIG.microsoftClientId;
};

const saved = async () => (await chrome.storage.local.get(KEY))[KEY] || null;
const save = (t) => chrome.storage.local.set({ [KEY]: t });

// ข้อความจาก Microsoft ที่บอกว่าองค์กรต้องให้ผู้ดูแลอนุมัติแอป
const ADMIN_CONSENT = /AADSTS(65001|90094|90095|650056|700016)|admin|consent_required/i;

function authError(description = '') {
  if (ADMIN_CONSENT.test(description)) {
    return new SourceError('องค์กรของคุณต้องให้ผู้ดูแลระบบ (admin) อนุมัติแอปนี้ก่อน ส่งลิงก์ขออนุมัติให้ผู้ดูแล แล้วลองใหม่', 'PERMISSION');
  }
  return new SourceError(`เชื่อมต่อ Microsoft ไม่สำเร็จ: ${description.slice(0, 200) || 'ไม่ทราบสาเหตุ'}`, 'CONFIG');
}

async function tokenRequest(params) {
  const res = await fetch(`${AUTH}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId(), scope: SCOPES, ...params }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw authError(j.error_description || j.error || String(res.status));
  return {
    access: j.access_token,
    refresh: j.refresh_token || params.refresh_token,
    expiresAt: Date.now() + (j.expires_in - 60) * 1000, // เผื่อเวลา 1 นาที
  };
}

async function login() {
  const verifier = randomString(48);
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const state = randomString(16);
  const redirect = chrome.identity.getRedirectURL();
  const url =
    `${AUTH}/authorize?` +
    new URLSearchParams({
      client_id: clientId(),
      response_type: 'code',
      redirect_uri: redirect,
      response_mode: 'query',
      scope: SCOPES,
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      prompt: 'select_account',
    });
  let result;
  try {
    result = await chrome.identity.launchWebAuthFlow({ url, interactive: true });
  } catch (e) {
    throw /cancel|closed|did not approve/i.test(e.message) ? new SourceError('ยกเลิกการเชื่อมต่อ Microsoft', 'CANCELLED') : authError(e.message);
  }
  const q = new URL(result).searchParams;
  if (q.get('error')) throw authError(q.get('error_description') || q.get('error'));
  if (q.get('state') !== state) throw new SourceError('การตอบกลับจาก Microsoft ไม่ตรงกับคำขอ (state ไม่ตรง) ลองใหม่', 'CONFIG');
  const tokens = await tokenRequest({ grant_type: 'authorization_code', code: q.get('code'), redirect_uri: redirect, code_verifier: verifier });
  await save(tokens);
}

// คืน access token ที่ใช้ได้ (ต่ออายุด้วย refresh token ให้เอง) ไม่มี/ต่ออายุไม่ได้ = ต้อง login ใหม่
async function getToken() {
  const t = await saved();
  if (!t) throw new SourceError('ยังไม่ได้เชื่อมต่อ Microsoft', 'AUTH');
  if (t.expiresAt > Date.now()) return t.access;
  try {
    const next = await tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refresh });
    await save(next);
    return next.access;
  } catch {
    await chrome.storage.local.remove(KEY);
    throw new SourceError('การเชื่อมต่อ Microsoft หมดอายุ กรุณาเชื่อมต่อใหม่', 'AUTH');
  }
}

async function graph(url, who, init = {}, retried = false) {
  const token = await getToken();
  if (!url.startsWith(GRAPH)) throw new SourceError('ที่อยู่ไม่ถูกต้อง', 'CONFIG'); // ไม่ส่ง token ไปนอก Graph
  const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) } });
  if (res.status === 429 && !retried) {
    const wait = Math.min(Number(res.headers.get('Retry-After')) || 2, 10);
    await new Promise((r) => setTimeout(r, wait * 1000));
    return graph(url, who, init, true);
  }
  if (res.status === 401) await chrome.storage.local.remove(KEY);
  if (!res.ok) throw httpError(res.status, who);
  return res;
}

async function status() {
  try {
    const me = await (await graph(`${GRAPH}/me?$select=userPrincipalName,mail`, 'Microsoft')).json();
    return { connected: true, account: me.mail || me.userPrincipalName };
  } catch {
    return { connected: false };
  }
}

const common = {
  kind: 'oauth',
  status,
  async connect() {
    await login();
  },
  // Microsoft ไม่มี endpoint ยกเลิก token แบบง่ายสำหรับแอปสาธารณะ: ลบ token ในเครื่อง (ผู้ใช้ถอนสิทธิ์เพิ่มได้ที่ myapps.microsoft.com)
  async disconnect() {
    await chrome.storage.local.remove(KEY);
  },
};

const day = (ms) => new Date(ms).toISOString().slice(0, 10);

export const msmail = {
  ...common,
  id: 'msmail',
  label: 'Outlook',
  permissionNote: 'ขอสิทธิ์อ่านอีเมลและไฟล์แนบอย่างเดียว ไม่ส่ง ไม่ลบ ไม่แก้ไข',
  searchPlaceholder: 'ค้นหาอีเมล (ผู้ส่งหรือคำในหัวเรื่อง)',

  async list({ query = '', days = 0, cursor = '' } = {}) {
    const kql = ['hasattachments:true', days ? `received>=${day(Date.now() - days * 864e5)}` : '', query.replace(/["\\]/g, '').trim()].filter(Boolean).join(' ');
    const url =
      cursor ||
      `${GRAPH}/me/messages?$search="${encodeURIComponent(kql)}"&$top=${PAGE}` +
        `&$select=${encodeURIComponent('id,subject,from,receivedDateTime')}` +
        `&$expand=${encodeURIComponent('attachments($select=id,name,contentType,size,isInline)')}`;
    const j = await (await graph(url, 'Outlook')).json();
    const items = [];
    for (const m of j.value || []) {
      for (const a of m.attachments || []) {
        if (a.isInline || !(/\.pdf$/i.test(a.name || '') || a.contentType === 'application/pdf')) continue;
        items.push({
          id: `${m.id}:${a.id}`,
          source: 'msmail',
          name: a.name,
          meta: `${m.from?.emailAddress?.address || ''} · ${m.subject || ''}`,
          date: Date.parse(m.receivedDateTime) || 0,
          size: a.size || 0,
          messageId: m.id,
          attachmentId: a.id,
        });
      }
    }
    return { items, nextCursor: j['@odata.nextLink'] || '' };
  },

  async download(item) {
    const res = await graph(`${GRAPH}/me/messages/${encodeURIComponent(item.messageId)}/attachments/${encodeURIComponent(item.attachmentId)}/$value`, 'Outlook');
    return new Blob([await res.arrayBuffer()], { type: 'application/pdf' });
  },
};

export const msdrive = {
  ...common,
  id: 'msdrive',
  label: 'OneDrive',
  permissionNote: 'ขอสิทธิ์อ่านไฟล์ใน OneDrive อย่างเดียว ไม่แก้ไข ไม่ลบ ไม่อัปโหลด',
  searchPlaceholder: 'ค้นหาชื่อไฟล์ใน OneDrive',

  async list({ query = '', days = 0, cursor = '' } = {}) {
    const q = (query.trim() || '.pdf').replace(/'/g, "''");
    const url =
      cursor ||
      `${GRAPH}/me/drive/root/search(q='${encodeURIComponent(q)}')?$top=15` +
        `&$select=${encodeURIComponent('id,name,file,size,lastModifiedDateTime')}`;
    const j = await (await graph(url, 'OneDrive')).json();
    const since = days ? Date.now() - days * 864e5 : 0;
    const items = (j.value || [])
      .filter((f) => f.file && (/\.pdf$/i.test(f.name) || f.file.mimeType === 'application/pdf'))
      .map((f) => ({ id: f.id, source: 'msdrive', name: f.name, meta: new Date(f.lastModifiedDateTime).toLocaleString('th-TH'), date: Date.parse(f.lastModifiedDateTime) || 0, size: f.size || 0 }))
      .filter((i) => i.date >= since); // ผลค้นหาไม่รองรับกรองวันที่ฝั่งเซิร์ฟเวอร์
    return { items, nextCursor: j['@odata.nextLink'] || '' };
  },

  async download(item) {
    const res = await graph(`${GRAPH}/me/drive/items/${encodeURIComponent(item.id)}/content`, 'OneDrive');
    return new Blob([await res.arrayBuffer()], { type: 'application/pdf' });
  },
};
