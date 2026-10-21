import sarabanDemo from './saraban.js';
import sarabanRid from './saraban-rid.js';

// ลงทะเบียน profile ที่นี่ (ลำดับแรก = ค่าเริ่มต้น)
export const PROFILES = [sarabanDemo, sarabanRid];

// match pattern (https://developer.chrome.com/docs/extensions/develop/concepts/match-patterns) -> RegExp
function patternToRegExp(p) {
  const m = p.match(/^(\*|https?):\/\/([^/]+)(\/.*)$/);
  if (!m) return null;
  const esc = (s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  const scheme = m[1] === '*' ? 'https?' : m[1];
  const host = m[2] === '*' ? '[^/]+' : esc(m[2]).replace(/^\\\*\\\./, '(?:[^/]+\\.)?').replace(/\*/g, '[^/]*');
  const path = esc(m[3]).replace(/\*/g, '.*');
  return new RegExp(`^${scheme}://${host}(?::\\d+)?${path}$`);
}

export function matchProfile(url) {
  if (!url) return null;
  return PROFILES.find((p) => p.urlPatterns.some((pat) => patternToRegExp(pat)?.test(url))) || null;
}

export const getProfile = (id) => PROFILES.find((p) => p.id === id) || PROFILES[0];
