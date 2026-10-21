// หน้า admin และ API ของ admin (/admin/*): admin คนเดียว ตั้งค่า key / โมเดล / สิทธิ์ / โควต้า ดูรายงานและ audit
// login ผ่าน OIDC แบบ authorization code + PKCE ฝั่งเซิร์ฟเวอร์ (redirect: <publicUrl>/admin/callback)
// session เป็นคุกกี้ HttpOnly + SameSite=Strict หมดอายุเมื่อไม่ใช้งาน 30 นาที (ไม่เกิน 8 ชม. นับจาก login)
import { createHash, randomBytes } from 'node:crypto';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { AuthError, signSession, verifySession } from './auth.js';
import { adminHtml } from './admin-ui.js';
import { PROVIDERS, SettingsError } from './runtime.js';
import { UpstreamError } from './upstream/index.js';
import { listModels } from './upstream/models.js';

const IDLE_SECONDS = 30 * 60;
const MAX_SECONDS = 8 * 3600;
const LOGIN_TTL_MS = 10 * 60_000;
const COOKIE = 'admin_session';

const b64u = (b) => Buffer.from(b).toString('base64url');

async function defaultExchangeCode({ cfg, code, verifier, redirectUri, env = process.env }) {
  const res = await fetch(cfg.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: cfg.clientId,
      client_secret: env[cfg.clientSecretEnv] || '', code_verifier: verifier,
    }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.id_token) throw new AuthError('แลก code กับผู้ให้บริการ login ไม่สำเร็จ', 502);
  return j.id_token;
}

export function mountAdmin(app, { config, db, runtime, verifyIdToken, exchangeCode = defaultExchangeCode, testKey = listModels, now = () => Date.now(), log = console }) {
  const ts = () => new Date(now()).toISOString();
  const secureCookie = config.production || config.publicUrl.startsWith('https://');
  const pending = new Map(); // state -> { verifier, nonce, exp }
  const loginHits = []; // จำกัดความถี่ของการเริ่ม/จบ login (admin มีคนเดียว จึงนับรวมทั้งระบบ)

  const tooManyLogins = () => {
    const t = now();
    while (loginHits.length && t - loginHits[0] > LOGIN_TTL_MS) loginHits.shift();
    if (loginHits.length >= 20) return true;
    loginHits.push(t);
    return false;
  };

  // หัวความปลอดภัยของทุกหน้า/ API ใน /admin
  app.use('/admin', async (c, next) => { await next(); harden(c); });
  app.use('/admin/*', async (c, next) => { await next(); harden(c); });
  function harden(c) {
    c.header('Cache-Control', 'no-store');
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'no-referrer');
    c.header('X-Frame-Options', 'DENY');
  }

  /* ---------- หน้าเว็บ ---------- */
  app.get('/admin', (c) => {
    const nonce = randomBytes(16).toString('base64');
    c.header(
      'Content-Security-Policy',
      `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`,
    );
    return c.html(adminHtml({ nonce, name: config.name, loginEnabled: !!config.adminLogin, devAuth: config.devAuth }));
  });

  /* ---------- login ---------- */
  const redirectUri = () => `${config.publicUrl}/admin/callback`;

  app.get('/admin/login', (c) => {
    if (!config.adminLogin) return c.text('ยังไม่ได้เปิด login ของ admin (ตั้ง adminLogin ใน config.json)', 404);
    if (tooManyLogins()) return c.text('พยายามเข้าสู่ระบบถี่เกินไป กรุณารอสักครู่', 429);
    const cfg = config.oidc.find((o) => o.id === config.adminLogin.provider);
    const state = b64u(randomBytes(24));
    const nonce = b64u(randomBytes(24));
    const verifier = b64u(randomBytes(48));
    pending.set(state, { verifier, nonce, exp: now() + LOGIN_TTL_MS });
    for (const [k, v] of pending) if (v.exp < now()) pending.delete(k);
    const url = new URL(cfg.authUrl);
    url.search = new URLSearchParams({
      client_id: cfg.clientId, response_type: 'code', redirect_uri: redirectUri(), scope: 'openid email profile',
      state, nonce, code_challenge: b64u(createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256',
      prompt: 'select_account',
    }).toString();
    return c.redirect(url.href, 302);
  });

  const startAdminSession = (c, user, since = Math.floor(now() / 1000)) => {
    const s = signSession({ sub: user.email, name: user.name, scope: 'admin', since }, config.jwtSecret, IDLE_SECONDS, now());
    setCookie(c, COOKIE, s.token, { httpOnly: true, secure: secureCookie, sameSite: 'Strict', path: '/admin', maxAge: IDLE_SECONDS });
  };

  const finishLogin = (c, user) => {
    if (!runtime.isAdmin(user.email)) {
      db.audit(ts(), user.email, 'admin.login_denied');
      return c.text('บัญชีนี้ไม่ใช่ผู้ดูแลระบบ', 403);
    }
    startAdminSession(c, user);
    db.audit(ts(), user.email, 'admin.login');
    return c.redirect('/admin', 302);
  };

  app.get('/admin/callback', async (c) => {
    if (!config.adminLogin) return c.text('ไม่พบหน้านี้', 404);
    if (tooManyLogins()) return c.text('พยายามเข้าสู่ระบบถี่เกินไป กรุณารอสักครู่', 429);
    const { code, state, error } = c.req.query();
    const p = pending.get(state);
    pending.delete(state); // ใช้ได้ครั้งเดียว
    if (error || !code || !p || p.exp < now()) return c.text('เข้าสู่ระบบไม่สำเร็จหรือหมดเวลา กรุณาลองใหม่จาก /admin', 400);
    const cfg = config.oidc.find((o) => o.id === config.adminLogin.provider);
    const idToken = await exchangeCode({ cfg, code, verifier: p.verifier, redirectUri: redirectUri() });
    const user = await verifyIdToken({ providerId: cfg.id, idToken, nonce: p.nonce, skipAccess: true });
    return finishLogin(c, user);
  });

  // ตอนพัฒนาเท่านั้น (devAuth ห้ามเปิดใน production): login admin โดยไม่ผ่าน IdP
  if (config.devAuth) {
    app.post('/admin/dev-login', async (c) => {
      const body = await c.req.json().catch(() => ({}));
      const email = String(body.email || '').toLowerCase();
      if (!runtime.isAdmin(email)) return c.json({ error: 'ไม่ใช่ admin' }, 403);
      startAdminSession(c, { email, name: email });
      db.audit(ts(), email, 'admin.login', 'dev');
      return c.json({ ok: true });
    });
  }

  /* ---------- API (ต้องเป็น admin) ---------- */
  const api = async (c, next) => {
    const token = getCookie(c, COOKIE);
    let s;
    try {
      s = verifySession(token, config.jwtSecret, now());
    } catch {
      return c.json({ error: 'กรุณาเข้าสู่ระบบ' }, 401);
    }
    const t = Math.floor(now() / 1000);
    // ตรวจทุกครั้ง: ยังเป็น admin คนปัจจุบันอยู่ไหม, ไม่ถูกเพิกถอน, ไม่เกินอายุสูงสุด
    if (s.scope !== 'admin' || !runtime.isAdmin(s.sub) || s.iat <= runtime.sessionEpoch() || t - s.since > MAX_SECONDS) {
      deleteCookie(c, COOKIE, { path: '/admin' });
      return c.json({ error: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่' }, 401);
    }
    // กัน CSRF: คำขอที่เปลี่ยนค่าต้องมี header พิเศษ (เว็บอื่นส่งข้าม origin ไม่ได้ถ้าไม่ผ่าน CORS) และ Origin ต้องตรงกับเรา
    if (c.req.method !== 'GET') {
      const origin = c.req.header('origin');
      const mine = config.publicUrl ? new URL(config.publicUrl).origin : new URL(c.req.url).origin;
      if (c.req.header('x-admin-csrf') !== '1' || (origin && origin !== mine && origin !== new URL(c.req.url).origin)) {
        return c.json({ error: 'คำขอไม่ถูกต้อง (CSRF)' }, 403);
      }
    }
    c.set('admin', s.sub);
    startAdminSession(c, { email: s.sub, name: s.name }, s.since); // ต่ออายุเมื่อมีการใช้งาน
    await next();
  };

  const fail = (c, e) => {
    if (e instanceof SettingsError) return c.json({ error: e.message }, 400);
    if (e instanceof UpstreamError) return c.json({ error: e.message }, e.status === 400 ? 400 : 502);
    throw e;
  };

  app.get('/admin/api/state', api, (c) => {
    const month = new Date(now()).toISOString().slice(0, 7);
    return c.json({
      admin: c.get('admin'),
      masterKeyConfigured: runtime.masterKeyConfigured,
      providers: PROVIDERS,
      provider: runtime.provider(),
      keys: runtime.keyMeta(),
      models: runtime.models(),
      defaultModel: runtime.defaultModel(),
      limits: runtime.limits(),
      features: runtime.features(),
      blockedEmails: runtime.blockedEmails(),
      access: Object.fromEntries(config.oidc.map((o) => [o.id, { label: o.label, ...runtime.access(o.id) }])),
      month,
    });
  });

  app.put('/admin/api/settings', api, async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== 'object') return c.json({ error: 'ข้อมูลไม่ถูกต้อง' }, 400);
    try {
      return c.json({ changed: runtime.update(body, c.get('admin')) });
    } catch (e) {
      return fail(c, e);
    }
  });

  app.put('/admin/api/keys/:provider', api, async (c) => {
    const body = await c.req.json().catch(() => ({}));
    try {
      runtime.setKey(c.req.param('provider'), body.key, c.get('admin'));
      return c.json({ ok: true, keys: runtime.keyMeta() }); // ไม่ส่งตัว key กลับ
    } catch (e) {
      return fail(c, e);
    }
  });

  app.delete('/admin/api/keys/:provider', api, (c) => {
    try {
      runtime.deleteKey(c.req.param('provider'), c.get('admin'));
      return c.json({ ok: true, keys: runtime.keyMeta() });
    } catch (e) {
      return fail(c, e);
    }
  });

  // ทดสอบ key ที่เก็บไว้ (เรียก list models ของค่าย) และคืนรายการโมเดลให้เลือก
  app.post('/admin/api/keys/:provider/test', api, async (c) => {
    const provider = c.req.param('provider');
    if (!PROVIDERS.includes(provider)) return c.json({ error: 'ไม่รู้จักผู้ให้บริการ AI' }, 400);
    try {
      const key = runtime.apiKey(provider);
      if (!key) return c.json({ error: 'ยังไม่ได้ตั้ง key ของผู้ให้บริการนี้' }, 400);
      const models = await testKey(provider, key);
      db.audit(ts(), c.get('admin'), 'key.test', provider, `models=${models.length}`);
      return c.json({ ok: true, models });
    } catch (e) {
      return fail(c, e);
    }
  });

  app.get('/admin/api/usage', api, (c) => {
    const month = c.req.query('month') || new Date(now()).toISOString().slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) return c.json({ error: 'month ต้องเป็นรูปแบบ YYYY-MM' }, 400);
    return c.json({ month, users: db.usageSummary(month) });
  });

  app.get('/admin/api/audit', api, (c) => c.json({ entries: db.listAudit(c.req.query('limit')) }));

  app.post('/admin/api/sessions/revoke', api, (c) => {
    runtime.revokeAllSessions(c.get('admin'));
    return c.json({ ok: true }); // รวม session ของ admin เอง: ต้อง login ใหม่
  });

  app.post('/admin/api/logout', api, (c) => {
    db.audit(ts(), c.get('admin'), 'admin.logout');
    deleteCookie(c, COOKIE, { path: '/admin' });
    return c.json({ ok: true });
  });
}
