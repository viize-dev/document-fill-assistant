import { createHmac, createPublicKey, timingSafeEqual, verify } from 'node:crypto';

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const fromB64u = (s) => Buffer.from(s, 'base64url');

export class AuthError extends Error {
  constructor(message, status = 401) {
    super(message);
    this.status = status;
  }
}

/* ---------- session token ของเราเอง (HS256) ---------- */

export function signSession(payload, secret, ttlSeconds, now = Date.now()) {
  const iat = Math.floor(now / 1000);
  const body = { ...payload, iat, exp: iat + ttlSeconds };
  const data = `${b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${b64u(JSON.stringify(body))}`;
  const sig = createHmac('sha256', secret).update(data).digest();
  return { token: `${data}.${b64u(sig)}`, expiresAt: body.exp * 1000 };
}

export function verifySession(token, secret, now = Date.now()) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new AuthError('token ไม่ถูกต้อง');
  const expected = createHmac('sha256', secret).update(`${parts[0]}.${parts[1]}`).digest();
  const given = fromB64u(parts[2]);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new AuthError('token ไม่ถูกต้อง');
  let body;
  try {
    body = JSON.parse(fromB64u(parts[1]).toString('utf8'));
  } catch {
    throw new AuthError('token ไม่ถูกต้อง');
  }
  if (!body.exp || body.exp * 1000 <= now) throw new AuthError('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
  return body;
}

/* ---------- ตรวจ ID token จาก OIDC (Google / Microsoft / อื่นๆ) ---------- */

const JWKS_TTL_MS = 60 * 60 * 1000;

// getAccess(providerId) -> { allowedDomains, allowedEmails }: ให้ admin ปรับสิทธิ์เข้าใช้ได้ตอนรัน (ไม่ส่งมา = ใช้ค่าใน config)
export function createOidcVerifier(oidcConfigs, { fetchImpl = fetch, now = () => Date.now(), getAccess } = {}) {
  const cache = new Map(); // jwksUri -> { keys, at }

  async function getKeys(cfg, force = false) {
    if (cfg.jwks) return cfg.jwks.keys; // ใช้ในการทดสอบ
    const hit = cache.get(cfg.jwksUri);
    if (hit && !force && now() - hit.at < JWKS_TTL_MS) return hit.keys;
    const res = await fetchImpl(cfg.jwksUri);
    if (!res.ok) throw new AuthError('ดึงกุญแจตรวจสอบจากผู้ให้บริการ login ไม่สำเร็จ', 502);
    const { keys } = await res.json();
    cache.set(cfg.jwksUri, { keys, at: now() });
    return keys;
  }

  // skipAccess: ใช้ตอน login ของ admin (ตรวจว่าเป็น admin ที่ชั้นอื่น ไม่ผูกกับรายการโดเมนของผู้ใช้ทั่วไป)
  return async function verifyIdToken({ providerId, idToken, nonce, skipAccess = false }) {
    const cfg = oidcConfigs.find((o) => o.id === providerId);
    if (!cfg) throw new AuthError('ไม่รู้จักผู้ให้บริการ login', 400);

    const parts = String(idToken || '').split('.');
    if (parts.length !== 3) throw new AuthError('ID token ไม่ถูกต้อง');
    let header, claims;
    try {
      header = JSON.parse(fromB64u(parts[0]).toString('utf8'));
      claims = JSON.parse(fromB64u(parts[1]).toString('utf8'));
    } catch {
      throw new AuthError('ID token ไม่ถูกต้อง');
    }
    // รับเฉพาะ RS256 กัน algorithm confusion (เช่น alg=none/HS256)
    if (header.alg !== 'RS256') throw new AuthError('ไม่รองรับอัลกอริทึมของ token');

    let jwk = (await getKeys(cfg)).find((k) => k.kid === header.kid);
    if (!jwk && !cfg.jwks) jwk = (await getKeys(cfg, true)).find((k) => k.kid === header.kid); // กุญแจหมุนเวียน
    if (!jwk) throw new AuthError('ไม่พบกุญแจที่ใช้ลงนาม token');

    const ok = verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey({ key: jwk, format: 'jwk' }), fromB64u(parts[2]));
    if (!ok) throw new AuthError('ลายเซ็น token ไม่ถูกต้อง');

    const t = Math.floor(now() / 1000);
    if (claims.iss !== cfg.issuer) throw new AuthError('ผู้ออก token ไม่ตรงกับที่ตั้งไว้');
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!aud.includes(cfg.clientId)) throw new AuthError('token ไม่ได้ออกให้แอปนี้');
    if (!claims.exp || claims.exp <= t) throw new AuthError('token หมดอายุ');
    if (claims.nbf && claims.nbf > t + 60) throw new AuthError('token ยังไม่ถึงเวลาใช้งาน');
    if (!nonce || claims.nonce !== nonce) throw new AuthError('nonce ไม่ตรง (ป้องกันการนำ token เก่ามาใช้ซ้ำ)');

    const email = String(claims.email || claims.preferred_username || '').toLowerCase();
    if (!email.includes('@')) throw new AuthError('token ไม่มีอีเมลของผู้ใช้');
    if (claims.email_verified === false) throw new AuthError('อีเมลยังไม่ได้รับการยืนยัน');

    const domain = email.split('@')[1];
    const access = getAccess ? getAccess(cfg.id) : cfg;
    const allowed = (access.allowedEmails || []).map((e) => e.toLowerCase()).includes(email) ||
      (access.allowedDomains || []).map((d) => d.toLowerCase()).includes(domain);
    if (!allowed && !skipAccess) throw new AuthError('บัญชีนี้ไม่ได้รับอนุญาตให้ใช้งาน', 403);

    return { email, name: claims.name || email };
  };
}
