import { Hono } from 'hono';
import { AuthError, signSession, verifySession } from './auth.js';
import { monthOf } from './db.js';
import { mountAdmin } from './admin.js';
import { buildPrompt } from './prompt.js';
import { UpstreamError } from './upstream/index.js';

// สร้างแอปจาก dependency ที่ฉีดเข้ามา เพื่อให้ทดสอบได้โดยไม่ต้องต่อเครือข่ายจริง
// runtime = ค่าที่ใช้จริง (config + ที่ admin ตั้ง), profiles = { id: profile JSON } สำหรับสร้าง prompt ฝั่งเซิร์ฟเวอร์
export function createApp({
  config, db, runtime, verifyIdToken, callUpstream, profiles = {}, exchangeCode, testKey,
  now = () => Date.now(), log = console,
}) {
  const app = new Hono();
  const minuteHits = new Map(); // email -> timestamps (หน่วยความจำ: ใช้กับ instance เดียว)

  /* ---------- CORS (เฉพาะ API ของ extension; หน้า admin อยู่ origin เดียวกันจึงไม่ใช้ CORS) ---------- */
  app.use('*', async (c, next) => {
    const origin = c.req.header('origin');
    const allowed = origin && (config.corsOrigins.includes('*') || config.corsOrigins.includes(origin));
    if (allowed) {
      c.header('Access-Control-Allow-Origin', origin);
      c.header('Vary', 'Origin');
      c.header('Access-Control-Allow-Headers', 'authorization, content-type');
      c.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    }
    if (c.req.method === 'OPTIONS') return c.body(null, 204);
    await next();
  });

  app.onError((err, c) => {
    if (err instanceof AuthError) return c.json({ error: err.message }, err.status);
    log.error('unhandled', err);
    return c.json({ error: 'เกิดข้อผิดพลาดภายในระบบ' }, 500);
  });

  /* ---------- helper ---------- */
  const issueSession = (user) => {
    const isAdmin = runtime.isAdmin(user.email);
    const s = signSession({ sub: user.email, name: user.name, scope: 'user' }, config.jwtSecret, runtime.limits().sessionHours * 3600, now());
    return { token: s.token, expiresAt: s.expiresAt, user: { email: user.email, name: user.name, isAdmin } };
  };

  const auth = async (c, next) => {
    const h = c.req.header('authorization') || '';
    const session = verifySession(h.replace(/^Bearer\s+/i, ''), config.jwtSecret, now());
    if (session.scope !== 'user') throw new AuthError('token ไม่ถูกต้อง');
    // เพิกถอนทั้งหมด (admin กด) และระงับรายบุคคลมีผลทันที ไม่ต้องรอ token หมดอายุ
    if (session.iat <= runtime.sessionEpoch()) throw new AuthError('เซสชันถูกเพิกถอน กรุณาเข้าสู่ระบบใหม่');
    if (runtime.isBlocked(session.sub)) throw new AuthError('บัญชีนี้ถูกระงับการใช้งาน', 403);
    c.set('user', { email: session.sub, name: session.name, isAdmin: runtime.isAdmin(session.sub) });
    await next();
  };

  const currentMonth = () => monthOf(new Date(now()).toISOString());

  /* ---------- สาธารณะ ---------- */
  app.get('/health', (c) => c.json({ ok: true }));

  // ข้อมูลที่ extension ต้องใช้ก่อน login (ไม่มีความลับ: client id เป็นข้อมูลสาธารณะอยู่แล้ว)
  app.get('/config', (c) =>
    c.json({
      name: config.name,
      oidc: config.oidc.map((o) => ({ id: o.id, label: o.label, authUrl: o.authUrl, clientId: o.clientId })),
      devAuth: config.devAuth,
      models: runtime.models(),
      defaultModel: runtime.defaultModel(),
      profiles: Object.keys(profiles),
      features: runtime.features(),
      limits: { maxPdfBytes: runtime.limits().maxPdfBytes },
    }),
  );

  app.post('/auth/oidc', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const user = await verifyIdToken({ providerId: body.provider, idToken: body.id_token, nonce: body.nonce });
    if (runtime.isBlocked(user.email)) throw new AuthError('บัญชีนี้ถูกระงับการใช้งาน', 403);
    return c.json(issueSession(user));
  });

  if (config.devAuth) {
    app.post('/auth/dev', async (c) => {
      const body = await c.req.json().catch(() => ({}));
      const email = String(body.email || '').toLowerCase();
      if (!email.includes('@')) return c.json({ error: 'ต้องระบุอีเมล' }, 400);
      return c.json(issueSession({ email, name: email }));
    });
  }

  /* ---------- ต้อง login ---------- */
  app.get('/me', auth, (c) => {
    const user = c.get('user');
    const month = currentMonth();
    return c.json({
      ...user,
      usage: { month, requests: db.requestsThisMonth(user.email, month), limit: runtime.limits().monthlyRequestsPerUser },
    });
  });

  app.post('/v1/extract', auth, async (c) => {
    const user = c.get('user');
    const started = now();
    const limits = runtime.limits();

    // ตรวจขนาดก่อนอ่าน body ทั้งก้อน
    const declared = Number(c.req.header('content-length') || 0);
    const maxBody = Math.ceil(limits.maxPdfBytes * 1.4) + limits.maxPromptChars * 4 + 4096;
    if (declared > maxBody) return c.json({ error: 'ไฟล์ใหญ่เกินกำหนด' }, 413);

    const body = await c.req.json().catch(() => null);
    if (!body || typeof body.pdf_base64 !== 'string') return c.json({ error: 'ข้อมูลที่ส่งมาไม่ครบ (pdf_base64)' }, 400);

    // prompt สร้างฝั่งเซิร์ฟเวอร์จาก profile: ผู้ใช้กำหนดข้อความที่ส่งให้ AI เองไม่ได้
    let prompt;
    if (typeof body.profile_id === 'string') {
      const profile = profiles[body.profile_id];
      if (!profile) return c.json({ error: 'ไม่รู้จัก profile นี้' }, 400);
      prompt = buildPrompt(profile, { summary: runtime.features().summary });
    } else if (config.allowClientPrompt && typeof body.prompt === 'string') {
      if (body.prompt.length === 0 || body.prompt.length > limits.maxPromptChars) return c.json({ error: 'prompt ว่างหรือยาวเกินกำหนด' }, 400);
      prompt = body.prompt;
    } else {
      return c.json({ error: 'ข้อมูลที่ส่งมาไม่ครบ (profile_id)' }, 400);
    }

    const pdfBytes = Math.floor((body.pdf_base64.length * 3) / 4);
    if (pdfBytes > limits.maxPdfBytes) return c.json({ error: 'ไฟล์ PDF ใหญ่เกินกำหนด' }, 413);
    if (!/^[A-Za-z0-9+/=]+$/.test(body.pdf_base64) || Buffer.from(body.pdf_base64.slice(0, 8), 'base64').toString('latin1').slice(0, 4) !== '%PDF') {
      return c.json({ error: 'ไฟล์ที่ส่งมาไม่ใช่ PDF' }, 400);
    }

    const up = runtime.upstream();
    if (!up.apiKey) return c.json({ error: 'ระบบ AI ยังไม่ได้ตั้งค่า กรุณาติดต่อผู้ดูแลระบบ' }, 503);
    const model = body.model && up.models.some((m) => m.id === body.model) ? body.model : up.defaultModel;
    if (body.model && model !== body.model) return c.json({ error: 'โมเดลนี้ไม่ได้เปิดให้ใช้งาน' }, 400);

    // rate limit ต่อนาที
    const t = now();
    const hits = (minuteHits.get(user.email) || []).filter((x) => t - x < 60_000);
    if (hits.length >= limits.requestsPerMinutePerUser) {
      return c.json({ error: 'ส่งคำขอถี่เกินไป กรุณารอสักครู่' }, 429);
    }

    // โควต้ารายเดือน
    const month = currentMonth();
    if (db.requestsThisMonth(user.email, month) >= limits.monthlyRequestsPerUser) {
      return c.json({ error: `ใช้งานครบโควต้าเดือนนี้แล้ว (${limits.monthlyRequestsPerUser} ครั้ง)` }, 429);
    }
    hits.push(t);
    minuteHits.set(user.email, hits);

    const record = { ts: new Date(t).toISOString(), email: user.email, provider: up.provider, model, pdfBytes };
    try {
      const out = await callUpstream(up.provider, { apiKey: up.apiKey, model, prompt, base64: body.pdf_base64 });
      db.logUsage({ ...record, status: 'ok', inputTokens: out.usage.input, outputTokens: out.usage.output, ms: now() - started });
      return c.json({ text: out.text, model, usage: out.usage });
    } catch (e) {
      const status = e instanceof UpstreamError ? e.status : 502;
      db.logUsage({ ...record, status: 'upstream_error', ms: now() - started });
      // detail จากค่ายอาจมีข้อมูลภายใน: ลบสตริงที่หน้าตาเหมือน key ก่อนเขียน log
      log.error('upstream', user.email, status, String(e.detail || e.message).replace(/[A-Za-z0-9_\-]{24,}/g, '[redacted]'));
      return c.json({ error: e instanceof UpstreamError ? e.message : 'เรียกผู้ให้บริการ AI ไม่สำเร็จ' }, status === 429 ? 429 : 502);
    }
  });

  mountAdmin(app, { config, db, runtime, verifyIdToken, exchangeCode, testKey, now, log });
  return app;
}
