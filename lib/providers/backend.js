// โหมดองค์กร: เรียกผ่าน backend กลาง (ดู backend/) ผู้ใช้ login ด้วยบัญชีองค์กร ไม่ต้องมี API key
// "apiKey" ในโหมดนี้คือ session token ที่ backend ออกให้

const trim = (u) => String(u || '').trim().replace(/\/+$/, '');

export function normalizeBaseUrl(input) {
  const u = trim(input);
  let url;
  try {
    url = new URL(u);
  } catch {
    throw new Error('URL ของ backend ไม่ถูกต้อง');
  }
  const local = ['localhost', '127.0.0.1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !local) throw new Error('backend ต้องใช้ https (ยกเว้น localhost ตอนพัฒนา)');
  return url.origin;
}

async function jsonOrThrow(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `backend ตอบกลับผิดพลาด (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export async function fetchConfig(baseUrl) {
  let res;
  try {
    res = await fetch(`${baseUrl}/config`);
  } catch {
    throw new Error('เชื่อมต่อ backend ไม่ได้ (ตรวจ URL และการอนุญาตเข้าถึง)');
  }
  return jsonOrThrow(res);
}

// ขอสิทธิ์เข้าถึง backend (ต้องเรียกจากการคลิกของผู้ใช้) แล้ว login ด้วย OIDC ของผู้ให้บริการที่เลือก
export async function login(baseUrl, oidcId) {
  await chrome.permissions.request({ origins: [`${baseUrl}/*`] });
  const cfg = await fetchConfig(baseUrl);
  const o = cfg.oidc.find((x) => x.id === oidcId);
  if (!o) throw new Error('ไม่พบผู้ให้บริการ login นี้ใน backend');

  const nonce = crypto.randomUUID();
  const state = crypto.randomUUID();
  const url = new URL(o.authUrl);
  url.search = new URLSearchParams({
    client_id: o.clientId,
    response_type: 'id_token',
    response_mode: 'fragment',
    scope: 'openid email profile',
    redirect_uri: chrome.identity.getRedirectURL(),
    nonce,
    state,
    prompt: 'select_account',
  }).toString();

  let redirected;
  try {
    redirected = await chrome.identity.launchWebAuthFlow({ url: url.href, interactive: true });
  } catch (e) {
    throw new Error(`login ไม่สำเร็จ: ${e.message || 'ผู้ใช้ปิดหน้าต่าง'}`);
  }
  const frag = new URLSearchParams(new URL(redirected).hash.replace(/^#/, ''));
  if (frag.get('error')) throw new Error(`login ไม่สำเร็จ: ${frag.get('error_description') || frag.get('error')}`);
  if (frag.get('state') !== state) throw new Error('login ไม่สำเร็จ: state ไม่ตรง');

  const res = await fetch(`${baseUrl}/auth/oidc`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider: oidcId, id_token: frag.get('id_token'), nonce }),
  });
  const s = await jsonOrThrow(res);
  return { token: s.token, expiresAt: s.expiresAt, ...s.user };
}

export async function me(baseUrl, token) {
  return jsonOrThrow(await fetch(`${baseUrl}/me`, { headers: { Authorization: `Bearer ${token}` } }));
}

// prompt สร้างฝั่งเซิร์ฟเวอร์จาก profile (ส่งแค่ profile id) ผู้ใช้กำหนดข้อความที่ส่งให้ AI เองไม่ได้
export async function extract({ base64, apiKey, model, profileId, baseUrl, signal }) {
  const res = await fetch(`${baseUrl}/v1/extract`, {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ pdf_base64: base64, profile_id: profileId, model }),
  });
  try {
    return (await jsonOrThrow(res)).text;
  } catch (e) {
    if (e.status === 401) throw new Error('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่ในส่วนตั้งค่า');
    throw e;
  }
}

// โมเดลที่องค์กรเปิดให้ใช้ (ตัวที่เป็นค่าเริ่มต้นของ backend อยู่บนสุด) ไม่ต้อง login ก็ดูได้
export async function listModels(_apiKey, { baseUrl }) {
  const cfg = await fetchConfig(baseUrl);
  return [...cfg.models].sort((a, b) => (b.id === cfg.defaultModel) - (a.id === cfg.defaultModel));
}
