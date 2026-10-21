import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createOidcVerifier, signSession, verifySession } from '../src/auth.js';
import { CLIENT_ID, ISS, NOW, idToken, jwk, rawConfig } from './helpers.js';
import { generateKeyPairSync } from 'node:crypto';

const verifier = createOidcVerifier(rawConfig().oidc, { now: () => NOW });
const verify = (token, nonce = 'n-1') => verifier({ providerId: 'google', idToken: token, nonce });
const rejects = (p, re) => assert.rejects(p, re);

test('ID token ที่ถูกต้องผ่านและได้อีเมลตัวพิมพ์เล็ก', async () => {
  const u = await verify(idToken({ email: 'SomChai@Example.go.th' }));
  assert.equal(u.email, 'somchai@example.go.th');
});

test('อีเมลที่อยู่ใน allowedEmails แม้โดเมนไม่ตรงก็ผ่าน', async () => {
  assert.equal((await verify(idToken({ email: 'guest@gmail.com' }))).email, 'guest@gmail.com');
});

test('โดเมนไม่อยู่ในรายการ -> 403', async () => {
  await rejects(verify(idToken({ email: 'x@evil.com' })), (e) => e.status === 403);
});

test('ใช้ preferred_username เมื่อไม่มี email (Microsoft)', async () => {
  const u = await verify(idToken({ email: undefined, preferred_username: 'a@example.go.th' }));
  assert.equal(u.email, 'a@example.go.th');
});

test('ปฏิเสธ: aud ผิด / iss ผิด / หมดอายุ / nonce ไม่ตรง / email ไม่ยืนยัน', async () => {
  await rejects(verify(idToken({ aud: 'other-app' })), /ไม่ได้ออกให้แอปนี้/);
  await rejects(verify(idToken({ iss: 'https://evil.example' })), /ผู้ออก token/);
  await rejects(verify(idToken({ exp: Math.floor(NOW / 1000) - 10 })), /หมดอายุ/);
  await rejects(verify(idToken(), 'wrong-nonce'), /nonce/);
  await rejects(verify(idToken({ email_verified: false })), /ยืนยัน/);
  await rejects(verify(idToken({ nonce: undefined }), ''), /nonce/);
});

test('ปฏิเสธ: alg=none, HS256, ลายเซ็นปลอม, kid ไม่รู้จัก, รูปแบบผิด', async () => {
  await rejects(verify(idToken({}, { header: { alg: 'none' }, sign: false })), /อัลกอริทึม/);
  await rejects(verify(idToken({}, { header: { alg: 'HS256' } })), /อัลกอริทึม/);
  const { privateKey: other } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  await rejects(verify(idToken({}, { key: other })), /ลายเซ็น/);
  await rejects(verify(idToken({}, { header: { kid: 'nope' } })), /กุญแจ/);
  await rejects(verify('not-a-jwt'), /ไม่ถูกต้อง/);
});

test('ปฏิเสธเมื่อแก้ payload หลังลงนาม', async () => {
  const [h, , s] = idToken().split('.');
  const forged = Buffer.from(JSON.stringify({ iss: ISS, aud: CLIENT_ID, exp: 9e9, nonce: 'n-1', email: 'admin@example.go.th' })).toString('base64url');
  await rejects(verify(`${h}.${forged}.${s}`), /ลายเซ็น/);
});

test('ผู้ให้บริการที่ไม่รู้จัก -> 400', async () => {
  await rejects(verifier({ providerId: 'nope', idToken: idToken(), nonce: 'n-1' }), (e) => e.status === 400);
});

test('ดึง JWKS ใหม่หนึ่งครั้งเมื่อพบ kid ที่ไม่รู้จัก (กุญแจหมุนเวียน)', async () => {
  let fetches = 0;
  const cfg = [{ ...rawConfig().oidc[0], jwks: undefined, jwksUri: 'https://jwks.test/keys' }];
  const fetchImpl = async () => {
    fetches++;
    return { ok: true, json: async () => ({ keys: fetches === 1 ? [] : [jwk] }) };
  };
  const v = createOidcVerifier(cfg, { fetchImpl, now: () => NOW });
  const u = await v({ providerId: 'google', idToken: idToken(), nonce: 'n-1' });
  assert.equal(u.email, 'somchai@example.go.th');
  assert.equal(fetches, 2);
});

test('session token: ใช้ได้ / หมดอายุ / ถูกแก้ / secret ผิด', () => {
  const secret = 'x'.repeat(40);
  const { token } = signSession({ sub: 'a@b.c' }, secret, 60, NOW);
  assert.equal(verifySession(token, secret, NOW + 30_000).sub, 'a@b.c');
  assert.throws(() => verifySession(token, secret, NOW + 61_000), /หมดอายุ/);
  assert.throws(() => verifySession(token, 'y'.repeat(40), NOW), /ไม่ถูกต้อง/);
  const [h, p, s] = token.split('.');
  const forged = Buffer.from(JSON.stringify({ sub: 'admin@b.c', adm: true, exp: 9e9 })).toString('base64url');
  assert.throws(() => verifySession(`${h}.${forged}.${s}`, secret, NOW), /ไม่ถูกต้อง/);
  assert.throws(() => verifySession('', secret, NOW), /ไม่ถูกต้อง/);
});
