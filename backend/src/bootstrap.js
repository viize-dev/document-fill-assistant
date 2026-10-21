// ประกอบ config / ฐานข้อมูล / ค่าที่ใช้จริง ใช้ร่วมกันระหว่างเซิร์ฟเวอร์ (index.js) และคำสั่ง CLI (cli.js)
import { createOidcVerifier } from './auth.js';
import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { loadProfiles } from './profiles.js';
import { createRuntime } from './runtime.js';

// โหลด .env แบบง่าย (ไม่ต้องพึ่ง dotenv) — ถ้ามี env จริงอยู่แล้วจะไม่ทับ
async function loadDotEnv() {
  try {
    const { readFileSync } = await import('node:fs');
    for (const line of readFileSync('.env', 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !(m[1] in process.env) && m[2]) process.env[m[1]] = m[2];
    }
  } catch {
    // ไม่มี .env ก็ใช้ environment ของระบบ
  }
}

export async function boot() {
  await loadDotEnv();
  const config = loadConfig({ path: process.env.CONFIG_PATH || './config.json' });
  const db = openDb(config.dbPath);
  const runtime = createRuntime({ config, db, masterKey: config.masterKey });
  const profiles = loadProfiles(config.profilesDir);
  const verifyIdToken = createOidcVerifier(config.oidc, { getAccess: runtime.access });
  return { config, db, runtime, profiles, verifyIdToken };
}
