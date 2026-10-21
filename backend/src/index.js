import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { boot } from './bootstrap.js';
import { callUpstream } from './upstream/index.js';

const { config, db, runtime, profiles, verifyIdToken } = await boot();
const app = createApp({ config, db, runtime, verifyIdToken, callUpstream, profiles });

serve({ fetch: app.fetch, port: config.port }, (info) => {
  const up = runtime.upstream();
  console.log(`${config.name} backend listening on :${info.port} (AI: ${up.provider}, profiles: ${Object.keys(profiles).join(', ') || '-'})`);
  if (config.devAuth) console.warn('⚠ devAuth เปิดอยู่ — ใช้เฉพาะตอนพัฒนา');
  if (!up.apiKey) console.warn('⚠ ยังไม่มี API key ของ AI — ให้ admin ตั้งที่ /admin (หรือใช้ environment)');
  if (!runtime.masterKeyConfigured) console.warn('⚠ ยังไม่ได้ตั้ง MASTER_KEY — ตั้ง API key ผ่านหน้า admin ไม่ได้ (สร้างด้วย: openssl rand -hex 32)');
  if (!runtime.adminEmail()) console.warn('⚠ ยังไม่ได้กำหนด admin — รัน: npm run admin:set -- <อีเมล>');
  if (!config.adminLogin && !config.devAuth) console.warn('⚠ ยังไม่ได้ตั้ง adminLogin — เข้าหน้า admin ไม่ได้');
  if (!Object.keys(profiles).length) console.warn('⚠ ไม่พบ profile ใน ' + config.profilesDir + ' — ผู้ใช้เรียก /v1/extract ไม่ได้');
});
