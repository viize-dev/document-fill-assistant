// เข้ารหัส API key ของค่าย AI ที่ admin ตั้งผ่านหน้าเว็บ: AES-256-GCM
// MASTER_KEY อยู่ใน environment/secret manager เท่านั้น ไม่อยู่ในฐานข้อมูล ถ้าฐานข้อมูลหลุดก็ถอดรหัส key ไม่ได้
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// รับ hex 64 ตัว หรือ base64 ที่ได้ 32 ไบต์ (สร้างด้วย: openssl rand -hex 32)
export function parseMasterKey(value) {
  if (!value) return null;
  const buf = /^[0-9a-f]{64}$/i.test(value) ? Buffer.from(value, 'hex') : Buffer.from(value, 'base64');
  if (buf.length !== 32) throw new Error('MASTER_KEY ต้องยาว 32 ไบต์ (hex 64 ตัว หรือ base64) สร้างด้วย: openssl rand -hex 32');
  return buf;
}

// aad ผูกข้อมูลกับชื่อ key (เช่น "anthropic") กันสลับ ciphertext ข้ามรายการ
export function encryptSecret(masterKey, plaintext, aad) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', masterKey, iv);
  c.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([c.update(String(plaintext), 'utf8'), c.final()]);
  return { iv, tag: c.getAuthTag(), ct };
}

export function decryptSecret(masterKey, { iv, tag, ct }, aad) {
  const d = createDecipheriv('aes-256-gcm', masterKey, Buffer.from(iv));
  d.setAAD(Buffer.from(aad));
  d.setAuthTag(Buffer.from(tag));
  return Buffer.concat([d.update(Buffer.from(ct)), d.final()]).toString('utf8');
}
