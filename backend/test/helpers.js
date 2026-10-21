import { createSign, generateKeyPairSync } from 'node:crypto';
import { createApp } from '../src/app.js';
import { createOidcVerifier } from '../src/auth.js';
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db.js';
import { loadProfiles } from '../src/profiles.js';
import { createRuntime } from '../src/runtime.js';

const b64u = (x) => Buffer.from(typeof x === 'string' ? x : JSON.stringify(x)).toString('base64url');

export const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
export const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };

export const NOW = Date.UTC(2026, 9, 20, 10, 0, 0); // 2026-10-20T10:00Z
export const ISS = 'https://accounts.google.com';
export const CLIENT_ID = 'client-123.apps.googleusercontent.com';

export function idToken(claims = {}, { header = {}, key = privateKey, sign = true } = {}) {
  const t = Math.floor(NOW / 1000);
  const body = {
    iss: ISS, aud: CLIENT_ID, exp: t + 3600, iat: t, nonce: 'n-1',
    email: 'somchai@example.go.th', email_verified: true, name: 'สมชาย', ...claims,
  };
  const h = b64u({ alg: 'RS256', kid: 'k1', typ: 'JWT', ...header });
  const data = `${h}.${b64u(body)}`;
  if (!sign) return `${data}.`;
  const sig = createSign('RSA-SHA256').update(data).sign(key);
  return `${data}.${sig.toString('base64url')}`;
}

export const rawConfig = (over = {}) => ({
  name: 'Test',
  corsOrigins: ['chrome-extension://abc'],
  oidc: [{ id: 'google', label: 'Google', issuer: ISS, jwks: { keys: [jwk] }, authUrl: 'https://accounts.google.com/o/oauth2/v2/auth', tokenUrl: 'https://idp.example/token', clientSecretEnv: 'GOOGLE_SECRET', clientId: CLIENT_ID, allowedDomains: ['example.go.th'], allowedEmails: ['guest@gmail.com'] }],
  adminEmail: 'admin@example.go.th',
  publicUrl: 'http://localhost:8787',
  adminLogin: { provider: 'google' },
  allowClientPrompt: false,
  upstream: { provider: 'anthropic', defaultModel: 'm-default', models: [{ id: 'm-default', label: 'Default' }, { id: 'm-big', label: 'Big' }] },
  limits: { monthlyRequestsPerUser: 3, requestsPerMinutePerUser: 5, maxPdfBytes: 1000, maxPromptChars: 500, sessionHours: 8 },
  ...over,
});

export const MASTER_KEY = 'ab'.repeat(32);
export const ENV = { JWT_SECRET: 'x'.repeat(40), ANTHROPIC_API_KEY: 'sk-test-secret-key', MASTER_KEY, GOOGLE_SECRET: 'google-client-secret' };
export const profiles = loadProfiles('./profiles');

export function makeApp({ rawOver = {}, upstream, clock, env = ENV, exchangeCode, testKey } = {}) {
  const config = loadConfig({ raw: rawConfig(rawOver), env });
  const db = openDb(':memory:');
  const calls = [];
  const callUpstream = upstream || (async (provider, args) => {
    calls.push({ provider, ...args });
    return { text: '{"doc_type":"other"}', usage: { input: 1200, output: 80 } };
  });
  const state = { now: NOW };
  const runtime = createRuntime({ config, db, masterKey: config.masterKey, env, now: () => state.now });
  const app = createApp({
    config, db, runtime, profiles, exchangeCode, testKey,
    verifyIdToken: createOidcVerifier(config.oidc, { now: () => state.now, getAccess: runtime.access }),
    callUpstream,
    now: clock || (() => state.now),
    log: { error() {} },
  });
  return { app, db, calls, config, state, runtime };
}

export async function login(app, claims, nonce = 'n-1') {
  const res = await app.request('/auth/oidc', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider: 'google', id_token: idToken(claims), nonce }),
  });
  return { res, body: await res.json() };
}

export const PDF_B64 = Buffer.from('%PDF-1.4\n%fake test pdf').toString('base64');

export const post = (app, path, token, body) =>
  app.request(path, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
