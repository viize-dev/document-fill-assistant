import { readFileSync } from 'node:fs';

import { PROVIDERS } from './runtime.js';
import { parseMasterKey } from './crypto.js';

const DEFAULT_LIMITS = {
  monthlyRequestsPerUser: 200,
  requestsPerMinutePerUser: 10,
  maxPdfBytes: 15_000_000,
  maxPromptChars: 20_000,
  sessionHours: 8,
};

// รวม config.json + env และตรวจความถูกต้อง: ถ้าตั้งผิดให้ล้มตั้งแต่เริ่ม ไม่ใช่ตอนมีผู้ใช้
export function loadConfig({ path = './config.json', env = process.env, raw } = {}) {
  const file = raw ?? JSON.parse(readFileSync(path, 'utf8'));
  const config = {
    name: file.name || 'Document Fill Assistant',
    port: Number(env.PORT || file.port || 8787),
    dbPath: file.dbPath || './data/usage.db',
    corsOrigins: file.corsOrigins || [],
    devAuth: !!file.devAuth,
    oidc: file.oidc || [],
    // admin มีคนเดียว (ตั้งผ่าน config / ADMIN_EMAIL / คำสั่ง CLI; ค่าใน DB ทับ)
    adminEmail: String(env.ADMIN_EMAIL || file.adminEmail || file.adminEmails?.[0] || '').toLowerCase(),
    publicUrl: String(env.PUBLIC_URL || file.publicUrl || '').replace(/\/+$/, ''),
    adminLogin: file.adminLogin || null, // { provider: 'google' } ใช้ oidc รายการนั้น + tokenUrl + clientSecretEnv
    features: file.features || {},
    profilesDir: file.profilesDir || './profiles',
    // true = ยอมให้ไคลเอนต์ส่ง prompt เอง (เฉพาะรุ่นเก่า) ค่าตั้งต้นปิด: ใช้ profile_id แล้วสร้าง prompt ฝั่งเซิร์ฟเวอร์
    allowClientPrompt: !!file.allowClientPrompt,
    upstream: file.upstream,
    limits: { ...DEFAULT_LIMITS, ...(file.limits || {}) },
    jwtSecret: env.JWT_SECRET,
    masterKey: null,
    production: env.NODE_ENV === 'production',
  };

  const errors = [];
  if (!config.jwtSecret || config.jwtSecret.length < 32) errors.push('JWT_SECRET ต้องยาวอย่างน้อย 32 ตัวอักษร');
  try {
    config.masterKey = parseMasterKey(env.MASTER_KEY);
  } catch (e) {
    errors.push(e.message);
  }
  if ((file.adminEmails || []).length > 1) errors.push('admin มีได้คนเดียว: ใช้ adminEmail (ไม่ใช่ adminEmails หลายรายการ)');
  if (config.adminEmail && !/^[^\s@]+@[^\s@]+$/.test(config.adminEmail)) errors.push('adminEmail ไม่ถูกต้อง');
  if (!config.upstream?.provider || !PROVIDERS.includes(config.upstream.provider)) {
    errors.push(`upstream.provider ต้องเป็น ${PROVIDERS.join(' | ')}`);
  }
  // API key ไม่บังคับตอนเริ่ม: admin ตั้งผ่านหน้าเว็บได้ภายหลัง (ใช้ ANTHROPIC_API_KEY ฯลฯ จาก environment เป็นค่าสำรอง)
  if (!config.upstream?.models?.length) errors.push('upstream.models ต้องมีอย่างน้อย 1 โมเดล');
  else if (!config.upstream.models.some((m) => m.id === config.upstream.defaultModel)) {
    errors.push('upstream.defaultModel ต้องอยู่ใน upstream.models');
  }
  if (!config.oidc.length && !config.devAuth) errors.push('ต้องตั้ง oidc อย่างน้อย 1 รายการ (หรือ devAuth สำหรับพัฒนา)');
  if (config.adminLogin) {
    const o = config.oidc.find((x) => x.id === config.adminLogin.provider);
    if (!o?.tokenUrl || !o.clientSecretEnv) errors.push('adminLogin ต้องอ้างถึง oidc ที่มี tokenUrl และ clientSecretEnv');
    else if (!env[o.clientSecretEnv]) errors.push(`ยังไม่ได้ตั้ง ${o.clientSecretEnv} (client secret สำหรับ login ของ admin)`);
    if (!/^https:\/\//.test(config.publicUrl) && !/^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(config.publicUrl)) {
      errors.push('ต้องตั้ง publicUrl เป็น https (หรือ localhost ตอนพัฒนา) เพื่อใช้เป็น redirect ของ login admin');
    }
  }
  if (config.devAuth && config.production) errors.push('ห้ามเปิด devAuth เมื่อ NODE_ENV=production');
  for (const o of config.oidc) {
    if (!o.id || !o.issuer || !o.clientId || !(o.jwksUri || o.jwks)) errors.push(`oidc "${o.id}" ตั้งค่าไม่ครบ (id, issuer, clientId, jwksUri)`);
    if (!o.allowedDomains?.length && !o.allowedEmails?.length) {
      errors.push(`oidc "${o.id}" ต้องกำหนด allowedDomains หรือ allowedEmails (ไม่เช่นนั้นใครก็ login ได้)`);
    }
  }
  if (errors.length) throw new Error(`config ไม่ถูกต้อง:\n- ${errors.join('\n- ')}`);
  return config;
}
