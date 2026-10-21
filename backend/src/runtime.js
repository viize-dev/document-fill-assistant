// ค่าที่ใช้จริงตอนรัน = ค่าใน config.json (ค่าตั้งต้น) + ค่าที่ admin ตั้งผ่านหน้าเว็บ (เก็บในฐานข้อมูล ทับค่าตั้งต้น)
// API key: ใช้ที่ admin ตั้ง (เข้ารหัส) ก่อน ถ้าไม่มีใช้จาก environment (รองรับการติดตั้งแบบเดิม)
import { decryptSecret, encryptSecret } from './crypto.js';

export const PROVIDERS = ['anthropic', 'openai', 'gemini'];
const KEY_ENV = { anthropic: 'ANTHROPIC_API_KEY', openai: 'OPENAI_API_KEY', gemini: 'GEMINI_API_KEY' };

export class SettingsError extends Error {}

const isEmail = (s) => typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
const isDomain = (s) => typeof s === 'string' && /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(s);

export function createRuntime({ config, db, masterKey = null, env = process.env, now = () => Date.now() }) {
  const ts = () => new Date(now()).toISOString();
  const get = (key, fallback) => db.getSetting(key) ?? fallback;

  const rt = {
    masterKeyConfigured: !!masterKey,

    adminEmail: () => get('adminEmail', config.adminEmail || ''),
    isAdmin: (email) => !!email && email === rt.adminEmail(),
    setAdminEmail(email, actor) {
      if (!isEmail(email)) throw new SettingsError('อีเมล admin ไม่ถูกต้อง');
      db.setSetting('adminEmail', email.toLowerCase(), actor, ts());
      db.audit(ts(), actor, 'admin.set', email.toLowerCase());
    },

    limits: () => ({ ...config.limits, ...get('limits', {}) }),
    features: () => ({ summary: true, ...(config.features || {}), ...get('features', {}) }),
    blockedEmails: () => get('blockedEmails', []),
    isBlocked: (email) => rt.blockedEmails().includes(email),
    // เพิกถอน session ทั้งหมดที่ออกก่อนเวลานี้ (วินาที)
    sessionEpoch: () => get('sessionEpoch', 0),

    // สิทธิ์เข้าใช้ต่อผู้ให้บริการ login: ค่าที่ admin ตั้งทับค่าใน config
    access(providerId) {
      const base = config.oidc.find((o) => o.id === providerId);
      const over = get('access', {})[providerId];
      return { allowedDomains: over?.allowedDomains ?? base?.allowedDomains ?? [], allowedEmails: over?.allowedEmails ?? base?.allowedEmails ?? [] };
    },

    provider: () => get('provider', config.upstream?.provider),
    models: () => get('models', config.upstream?.models || []),
    defaultModel: () => get('defaultModel', config.upstream?.defaultModel),

    /* ---------- API key ---------- */
    keyMeta() {
      const rows = Object.fromEntries(db.secretMeta().map((r) => [r.name, r]));
      return Object.fromEntries(
        PROVIDERS.map((p) => [p, rows[p] ? { set: true, source: 'admin', last4: rows[p].last4, updatedAt: rows[p].updated_at } : env[KEY_ENV[p]] ? { set: true, source: 'env', last4: '', updatedAt: '' } : { set: false }]),
      );
    },
    // key ที่ใช้เรียกค่าย (ถอดรหัสเฉพาะตอนใช้ ไม่เก็บค้างในหน่วยความจำ)
    apiKey(provider) {
      const row = db.getSecret(provider);
      if (row) {
        if (!masterKey) throw new SettingsError('มี key ในฐานข้อมูลแต่ไม่ได้ตั้ง MASTER_KEY');
        return decryptSecret(masterKey, row, provider);
      }
      return env[KEY_ENV[provider]] || null;
    },
    setKey(provider, key, actor) {
      if (!PROVIDERS.includes(provider)) throw new SettingsError('ไม่รู้จักผู้ให้บริการ AI');
      if (!masterKey) throw new SettingsError('ยังไม่ได้ตั้ง MASTER_KEY บนเซิร์ฟเวอร์ จึงเก็บ key แบบเข้ารหัสไม่ได้');
      const k = String(key ?? '').trim();
      if (k.length < 20 || /\s/.test(k)) throw new SettingsError('รูปแบบ key ไม่ถูกต้อง (สั้นเกินไปหรือมีช่องว่าง)');
      db.putSecret(provider, encryptSecret(masterKey, k, provider), k.slice(-4), actor, ts());
      db.audit(ts(), actor, 'key.set', provider, `last4=${k.slice(-4)}`); // ไม่บันทึกตัว key
    },
    deleteKey(provider, actor) {
      if (!PROVIDERS.includes(provider)) throw new SettingsError('ไม่รู้จักผู้ให้บริการ AI');
      db.deleteSecret(provider);
      db.audit(ts(), actor, 'key.delete', provider);
    },

    // ค่าที่ /v1/extract ใช้ ณ ขณะนั้น
    upstream() {
      const provider = rt.provider();
      return { provider, models: rt.models(), defaultModel: rt.defaultModel(), apiKey: provider ? rt.apiKey(provider) : null };
    },

    /* ---------- ตั้งค่า (ตรวจความถูกต้องก่อนเขียน) ---------- */
    update(patch, actor) {
      const changed = [];
      const put = (key, value) => {
        db.setSetting(key, value, actor, ts());
        changed.push(key);
      };
      if (patch.provider !== undefined) {
        if (!PROVIDERS.includes(patch.provider)) throw new SettingsError('ผู้ให้บริการ AI ไม่ถูกต้อง');
        put('provider', patch.provider);
      }
      if (patch.models !== undefined) {
        const ms = patch.models;
        if (!Array.isArray(ms) || !ms.length || ms.length > 50 || ms.some((m) => !m || typeof m.id !== 'string' || !/^[\w.:\-/]{1,100}$/.test(m.id))) {
          throw new SettingsError('รายการโมเดลไม่ถูกต้อง');
        }
        put('models', ms.map((m) => ({ id: m.id, label: String(m.label || m.id).slice(0, 80), note: String(m.note || '').slice(0, 120) })));
      }
      if (patch.defaultModel !== undefined) {
        if (!rt.models().concat(patch.models || []).some((m) => m.id === patch.defaultModel)) throw new SettingsError('โมเดลเริ่มต้นต้องอยู่ในรายการโมเดลที่เปิดใช้');
        put('defaultModel', patch.defaultModel);
      }
      if (patch.limits !== undefined) {
        const L = patch.limits;
        const RULES = {
          monthlyRequestsPerUser: [1, 1_000_000, 'โควต้ารายเดือนไม่ถูกต้อง'],
          requestsPerMinutePerUser: [1, 600, 'ขีดจำกัดต่อนาทีไม่ถูกต้อง'],
          maxPdfBytes: [100_000, 50_000_000, 'ขนาดไฟล์สูงสุดไม่ถูกต้อง'],
        };
        const out = {};
        for (const [k, [min, max, msg]] of Object.entries(RULES)) {
          if (L[k] === undefined) continue;
          if (!Number.isInteger(L[k]) || L[k] < min || L[k] > max) throw new SettingsError(msg);
          out[k] = L[k];
        }
        put('limits', { ...get('limits', {}), ...out });
      }
      if (patch.features !== undefined) {
        const out = { ...get('features', {}) };
        for (const k of ['summary']) if (patch.features[k] !== undefined) out[k] = !!patch.features[k];
        put('features', out);
      }
      if (patch.access !== undefined) {
        const out = { ...get('access', {}) };
        for (const [id, a] of Object.entries(patch.access)) {
          if (!config.oidc.some((o) => o.id === id)) throw new SettingsError(`ไม่รู้จักผู้ให้บริการ login "${id}"`);
          const domains = (a.allowedDomains || []).map((d) => String(d).toLowerCase().trim()).filter(Boolean);
          const emails = (a.allowedEmails || []).map((e) => String(e).toLowerCase().trim()).filter(Boolean);
          if (!domains.every(isDomain) || !emails.every(isEmail)) throw new SettingsError('โดเมนหรืออีเมลที่อนุญาตไม่ถูกต้อง');
          if (!domains.length && !emails.length) throw new SettingsError('ต้องกำหนดโดเมนหรืออีเมลอย่างน้อย 1 รายการ (ไม่เช่นนั้นใครก็ login ได้)');
          out[id] = { allowedDomains: domains, allowedEmails: emails };
        }
        put('access', out);
      }
      if (patch.blockedEmails !== undefined) {
        const list = [...new Set(patch.blockedEmails.map((e) => String(e).toLowerCase().trim()))];
        if (!list.every(isEmail)) throw new SettingsError('อีเมลที่ระงับไม่ถูกต้อง');
        if (list.includes(rt.adminEmail())) throw new SettingsError('ระงับบัญชี admin ไม่ได้');
        put('blockedEmails', list);
      }
      if (changed.length) db.audit(ts(), actor, 'settings.update', changed.join(','));
      return changed;
    },

    revokeAllSessions(actor) {
      db.setSetting('sessionEpoch', Math.floor(now() / 1000), actor, ts());
      db.audit(ts(), actor, 'sessions.revoke_all');
    },
  };
  return rt;
}
