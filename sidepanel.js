import { buildRows, rowsToFormValues, fieldSelectors, docTypeKey } from './lib/mapping.js';
import { buildCover } from './lib/cover.js';
import { PROFILES, matchProfile, getProfile } from './profiles/index.js';
import { fileToBase64 } from './lib/file.js';
import { PROVIDERS, DEFAULT_PROVIDER, pickModel, extractFromPdf, listModels, kindOf } from './lib/providers/index.js';
import { extractLocal } from './lib/local/index.js';
import { normalizeBaseUrl, login as backendLogin, me as backendMe, fetchConfig as fetchBackendConfig } from './lib/providers/backend.js';
import { mountSources } from './sourcepanel.js';
import { orgBackendUrl } from './lib/deploy.js';
import { mountDiscovery } from './discoverypanel.js';

const $ = (id) => document.getElementById(id);
const LOW_CONFIDENCE = 0.7;
const CONTENT_VERSION = 2; // ให้ตรงกับ VERSION ใน content.js

let currentBlob = null;
let currentName = '';
let docType = 'other';
let rows = [];
let extracted = null;
let previewUrl = null;

/* ---------- ระบบปลายทาง (profile) ---------- */

let profile = PROFILES[0];

$('profile').replaceChildren(...PROFILES.map((p) => new Option(p.name, p.id)));
$('profile').onchange = async (e) => {
  profile = getProfile(e.target.value);
  await chrome.storage.local.set({ profileId: profile.id });
  resetResult();
  refreshPage();
};

function resetResult() {
  rows = [];
  extracted = null;
  $('result-card').hidden = true;
  if (currentBlob) analyze();
}

/* ---------- หน้าเว็บที่เปิดอยู่ ---------- */

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

// ให้แน่ใจว่า content script อยู่ในแท็บ (inject ตอนใช้งาน ไม่ต้องประกาศ domain ล่วงหน้า)
async function ensureContentScript(tab) {
  try {
    const pong = await chrome.tabs.sendMessage(tab.id, { type: 'PING' });
    if (pong?.v >= CONTENT_VERSION) return true;
    throw new Error('content script เก่า');
  } catch {
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['lib/discovery/scan.js', 'content.js'] });
      return true;
    } catch {
      return false;
    }
  }
}

async function sendToPage(message) {
  const tab = await activeTab();
  if (!tab?.id) throw new Error('ไม่พบแท็บที่ใช้งานอยู่');
  if (!(await ensureContentScript(tab))) {
    throw new Error('ยังไม่ได้รับอนุญาตให้ใช้กับหน้านี้ (กด "อนุญาตให้ใช้กับเว็บนี้" หรือคลิกไอคอน extension บนหน้านั้น)');
  }
  return chrome.tabs.sendMessage(tab.id, message);
}

function setChip(text, on) {
  const chip = $('page-status');
  chip.textContent = text;
  chip.className = `chip ${on ? 'chip-on' : 'chip-off'}`;
}

async function detectPage() {
  const tab = await activeTab();
  $('grant').hidden = true;
  if (!tab?.id) return setChip('ไม่พบแท็บ', false), false;

  // เลือก profile อัตโนมัติจาก URL ของหน้า (ถ้าอ่าน URL ได้)
  const matched = matchProfile(tab.url);
  if (matched && matched.id !== profile.id) {
    profile = matched;
    $('profile').value = profile.id;
    await chrome.storage.local.set({ profileId: profile.id });
    resetResult();
  }

  if (!(await ensureContentScript(tab))) {
    setChip('ยังไม่ได้รับอนุญาตให้ใช้กับหน้านี้', false);
    // ยังไม่ได้รับอนุญาต Chrome จะไม่ให้อ่าน URL ของแท็บ (tab.url ว่าง) จึงต้องแสดงปุ่มเสมอ ไม่ใช่เฉพาะเมื่ออ่าน URL ได้
    $('grant').hidden = false;
    return false;
  }
  const res = await chrome.tabs.sendMessage(tab.id, { type: 'DETECT', detect: profile.detect, detectAll: profile.detectAll, detectNot: profile.detectNot });
  if (res.ok) {
    setChip(`พบหน้า ${profile.name}`, true);
    // หน้าตรงกับ profile: ใช้ selector ของ profile ตามเดิม (ผู้ใช้สแกนเองได้จากส่วน "ช่องที่ตรวจพบ")
    disc.scan({ passive: true }).catch(() => disc.reset());
    return true;
  }
  // ไม่ตรง profile: สแกนหน้าเองแล้วจับคู่กับฟิลด์ของ profile (ถ้าได้อย่างน้อย 1 ช่องถือว่าใช้ได้ แต่ต้องให้ผู้ใช้ตรวจ)
  try {
    const n = await disc.scan({ auto: true });
    if (disc.active) {
      setChip(`ตรวจพบหน้ากรอกอัตโนมัติ (จับคู่ได้ ${n} ช่อง)`, true);
      return true;
    }
  } catch {
    /* สแกนไม่ได้ ใช้ข้อความเดิม */
  }
  setChip(disc.kind === 'search' ? 'หน้านี้เป็นหน้าค้นหา/รายงาน ไม่ใช่ฟอร์มกรอกหนังสือ' : `ไม่ใช่หน้าที่ ${profile.name} รองรับ`, false);
  return false;
}

// ขอสิทธิ์เฉพาะเว็บที่ผู้ใช้กดอนุญาต (ต้องมาจากการคลิกของผู้ใช้)
$('grant').onclick = async () => {
  const tab = await activeTab();
  try {
    // อ่าน URL ของแท็บไม่ได้ก่อนได้รับอนุญาต: ใช้ที่อยู่ของระบบปลายทางที่เลือกไว้ (urlPatterns ของ profile) แทน
    const origins = tab?.url ? [`${new URL(tab.url).origin}/*`] : profile.urlPatterns;
    const ok = await chrome.permissions.request({ origins });
    if (!ok) setStatus('ไม่ได้รับอนุญาต', true);
  } catch {
    setStatus('ขอสิทธิ์ไม่สำเร็จ ลองคลิกไอคอน extension บนหน้านั้นอีกครั้ง', true);
  }
  refreshPage();
};

const disc = mountDiscovery({
  root: $('disc'),
  getProfile: () => profile,
  sendToPage: (m) => sendToPage(m),
  getRows: () => rows,
  setStatus: (t, err) => setStatus(t, err),
  onChange: () => renderRows(),
});

function updateFillButton(ok) {
  $('fill').disabled = !ok || !rows.length;
  document.querySelectorAll('.fill-one').forEach((b) => (b.disabled = !ok));
}

let pageOk = false;
async function refreshPage() {
  try {
    pageOk = await detectPage();
  } catch {
    pageOk = false;
    setChip('ตรวจหน้าไม่สำเร็จ', false);
  }
  updateFillButton(pageOk);
}
chrome.tabs.onActivated.addListener(refreshPage);
// ผู้ใช้สลับเมนูในระบบ (หน้าเดิม ไม่โหลดใหม่): content script แจ้งมา -> ตรวจหน้า/สแกนใหม่อัตโนมัติ
let pageChangedTimer = null;
chrome.runtime.onMessage.addListener(async (msg, sender) => {
  if (msg?.type !== 'PAGE_CHANGED') return;
  const tab = await activeTab();
  if (!tab || sender.tab?.id !== tab.id) return;
  clearTimeout(pageChangedTimer);
  pageChangedTimer = setTimeout(refreshPage, 300);
});
chrome.tabs.onUpdated.addListener((_id, info) => info.status === 'complete' && refreshPage());

async function init() {
  const { profileId } = await chrome.storage.local.get('profileId');
  profile = getProfile(profileId);
  $('profile').value = profile.id;
  refreshPage();
}

/* ---------- ตั้งค่า ---------- */

// settings = { provider, keys: {id: key}, models: {id: modelId}, modelLists: {id: [...]},
//              backendUrl, backendOidc: [{id,label}], session: {token, expiresAt, email, name, isAdmin},
//              coverUnit: ชื่อหน่วยที่หัวใบปะหน้า (ว่าง = ใช้ค่าจาก profile),
//              lastKeyProvider: ค่ายล่าสุดที่ใช้ในโหมด API key (ไว้กลับมาเมื่อสลับวิธี) }
let settings = { provider: DEFAULT_PROVIDER, keys: {}, models: {}, modelLists: {}, backendUrl: '', backendOidc: [], session: null, lastKeyProvider: DEFAULT_PROVIDER, coverUnit: '' };
let shownProvider = DEFAULT_PROVIDER;
// โหมดองค์กร: มี URL ของ backend จากนโยบาย/ค่าตอน build -> ผู้ใช้ login อย่างเดียว ไม่เห็นการตั้ง API key (ดู lib/deploy.js)
let orgUrl = '';

const modelsFor = (pid) => (settings.modelLists[pid]?.length ? settings.modelLists[pid] : PROVIDERS[pid].models);
const needsKey = (pid) => kindOf(pid) === 'key';
const isLogin = (pid) => kindOf(pid) === 'login';
const isLocal = (pid) => kindOf(pid) === 'local';
const sessionValid = () => !!settings.session && settings.session.expiresAt > Date.now();
const persist = () => chrome.storage.local.set({ settings });

function setTestResult(text, kind = '') {
  const el = $('test-result');
  el.textContent = text;
  el.className = `small ${kind}`;
}

function setLoginStatus(text, kind = '') {
  const el = $('login-status');
  el.textContent = text;
  el.className = `small ${kind}`;
}

function renderModels() {
  const pid = shownProvider;
  const list = modelsFor(pid);
  const sel = $('model');
  sel.replaceChildren(
    ...(list.length
      ? list.map((m) => new Option(m.note ? `${m.label} — ${m.note}` : m.label, m.id))
      : [new Option('(กด "ทดสอบและโหลดรายการโมเดล" ก่อน)', '')]),
  );
  sel.value = pickModel(pid, list, settings.models[pid]);
  $('model-note').textContent = list.find((m) => m.id === sel.value)?.note || '';
}

// ปุ่ม login / สถานะการเข้าสู่ระบบของโหมดองค์กร
function renderLogin() {
  const box = $('login-buttons');
  box.replaceChildren();
  $('logout').hidden = !sessionValid();
  if (sessionValid()) {
    setLoginStatus(`เข้าสู่ระบบแล้ว: ${settings.session.email}`, 'ok');
    return;
  }
  setLoginStatus(settings.session ? 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่' : '');
  if (!settings.backendOidc?.length) {
    setLoginStatus('ใส่ URL แล้วกด "ทดสอบและโหลดรายการโมเดล" เพื่อดูวิธีเข้าสู่ระบบ');
    return;
  }
  settings.backendOidc.forEach((o) => {
    const btn = document.createElement('button');
    btn.className = 'btn btn-primary';
    btn.textContent = `เข้าสู่ระบบด้วย ${o.label}`;
    btn.onclick = () => doLogin(o.id);
    box.append(btn);
  });
}

async function doLogin(oidcId) {
  try {
    const baseUrl = orgUrl || normalizeBaseUrl($('backend-url').value);
    setLoginStatus('กำลังเข้าสู่ระบบ…');
    settings.backendUrl = baseUrl;
    settings.session = await backendLogin(baseUrl, oidcId);
    await persist();
    renderLogin();
    renderOrgBar();
    try {
      const m = await backendMe(baseUrl, settings.session.token);
      setLoginStatus(`เข้าสู่ระบบแล้ว: ${m.email} · ใช้ไปแล้ว ${m.usage.requests}/${m.usage.limit} ครั้งเดือนนี้`, 'ok');
    } catch {
      // แสดงสถานะพื้นฐานที่ renderLogin ตั้งไว้แล้ว
    }
  } catch (e) {
    setLoginStatus(e.message, 'err');
    setStatus(e.message, true);
  }
}

async function logout() {
  settings.session = null;
  await persist();
  renderLogin();
  renderOrgBar();
}
$('logout').onclick = logout;

// โหมดองค์กร: ซ่อนทุกอย่างที่เกี่ยวกับ key/ผู้ให้บริการ/โมเดล เหลือเฉพาะบัญชีและชื่อหน่วยที่หัวใบปะหน้า
function applyOrgMode() {
  if (!orgUrl) return;
  ['provider-field', 'key-field', 'key-help', 'local-note', 'test-row', 'model-field', 'model-note', 'backend-url-field', 'personal-login-note'].forEach((id) => ($(id).hidden = true));
  $('backend-box').hidden = false;
  $('privacy-note').hidden = false;
  $('privacy-note').textContent = 'เอกสารที่วิเคราะห์จะถูกส่งผ่านระบบขององค์กรไปยังผู้ให้บริการ AI ที่ผู้ดูแลระบบเลือก ผู้ใช้ไม่ต้องตั้งค่า API key';
}

// แถบเข้าสู่ระบบด้านบน (โหมดองค์กร): เห็นได้โดยไม่ต้องเปิดส่วนตั้งค่า
function renderOrgBar() {
  const bar = $('org-bar');
  bar.hidden = !orgUrl;
  if (!orgUrl) return;
  const buttons = $('org-buttons');
  buttons.replaceChildren();
  if (sessionValid()) {
    $('org-status').textContent = `เข้าสู่ระบบแล้ว: ${settings.session.email}`;
    const out = document.createElement('button');
    out.className = 'btn btn-sm';
    out.textContent = 'ออกจากระบบ';
    out.onclick = logout;
    buttons.append(out);
    return;
  }
  $('org-status').textContent = settings.session ? 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่' : 'กรุณาเข้าสู่ระบบด้วยบัญชีองค์กรเพื่อใช้งาน';
  (settings.backendOidc || []).forEach((o) => {
    const btn = document.createElement('button');
    btn.className = 'btn btn-primary btn-sm';
    btn.textContent = `เข้าสู่ระบบด้วย ${o.label}`;
    btn.onclick = () => doLogin(o.id);
    buttons.append(btn);
  });
  if (!settings.backendOidc?.length) $('org-status').textContent = 'เชื่อมต่อระบบขององค์กรไม่ได้ กรุณาตรวจอินเทอร์เน็ตหรือติดต่อผู้ดูแลระบบ';
}

function renderProvider() {
  const p = PROVIDERS[shownProvider];
  const keyed = needsKey(shownProvider);
  renderProviderOptions();
  $('provider').value = shownProvider;
  $('backend-box').hidden = !isLogin(shownProvider);
  $('key-field').hidden = !keyed;
  $('key-help').hidden = !keyed;
  $('local-note').hidden = !isLocal(shownProvider);
  $('test-row').hidden = isLocal(shownProvider);
  $('model-field').hidden = isLocal(shownProvider);
  $('model-note').hidden = isLocal(shownProvider);
  $('privacy-note').hidden = isLocal(shownProvider);
  if (keyed) {
    $('api-key').value = settings.keys[p.id] || '';
    $('api-key').placeholder = p.keyPlaceholder;
    $('setup-steps').replaceChildren(
      ...p.setup.steps.map((t) => {
        const li = document.createElement('li');
        li.textContent = t;
        return li;
      }),
    );
    $('setup-link').href = p.setup.url;
  } else if (isLogin(shownProvider)) {
    $('backend-url').value = settings.backendUrl || '';
    renderLogin();
  }
  setTestResult('');
  renderModels();
  applyOrgMode();
  renderOrgBar();
}

// เก็บค่าที่กรอกค้างอยู่ของค่ายที่กำลังแสดงเข้า settings (ยังไม่เขียนลง storage)
function stashForm() {
  settings.coverUnit = $('cover-unit').value.trim();
  if (needsKey(shownProvider)) {
    settings.keys[shownProvider] = $('api-key').value.trim();
    settings.lastKeyProvider = shownProvider;
  } else if (isLogin(shownProvider)) settings.backendUrl = orgUrl || $('backend-url').value.trim();
  else settings.lastKeyProvider = shownProvider; // โหมดในเครื่อง
  if (!isLocal(shownProvider) && $('model').value) settings.models[shownProvider] = $('model').value;
}

// วิธีเชื่อมต่อ: login (โหมดองค์กร ผ่าน backend) หรือ API key ของแต่ละค่าย
function renderProviderOptions() {
  const direct = Object.values(PROVIDERS).filter((p) => p.kind !== 'login');
  $('provider').replaceChildren(...direct.map((p) => new Option(p.label, p.id)));
  document.querySelectorAll('input[name=method]').forEach((r) => {
    r.checked = r.value === (isLogin(shownProvider) ? 'login' : 'key');
  });
  $('provider-field').hidden = isLogin(shownProvider);
}

document.querySelectorAll('input[name=method]').forEach((r) => {
  r.onchange = () => {
    if (!r.checked) return;
    stashForm();
    shownProvider = r.value === 'login' ? 'backend' : settings.lastKeyProvider || DEFAULT_PROVIDER;
    renderProvider();
  };
});

$('provider').onchange = (e) => {
  stashForm();
  shownProvider = e.target.value;
  renderProvider();
};
$('model').onchange = () => {
  $('model-note').textContent = modelsFor(shownProvider).find((m) => m.id === $('model').value)?.note || '';
};

$('test-key').onclick = async () => {
  const pid = shownProvider;
  setTestResult('กำลังทดสอบ…');
  try {
    let list;
    if (needsKey(pid)) {
      list = await listModels(pid, $('api-key').value.trim());
      if (!list.length) throw new Error('key ใช้ได้ แต่ไม่พบโมเดลที่อ่านเอกสารได้');
    } else {
      const baseUrl = normalizeBaseUrl($('backend-url').value);
      await chrome.permissions.request({ origins: [`${baseUrl}/*`] }); // ต้องเรียกจากการคลิกของผู้ใช้
      const cfg = await fetchBackendConfig(baseUrl);
      list = await listModels(pid, '', { baseUrl });
      settings.backendUrl = baseUrl;
      settings.backendOidc = cfg.oidc.map(({ id, label }) => ({ id, label }));
      if (!list.length) throw new Error('backend ไม่ได้เปิดโมเดลใดให้ใช้งาน');
    }
    settings.modelLists[pid] = list;
    if (pid === shownProvider) {
      if (needsKey(pid)) settings.keys[pid] = $('api-key').value.trim();
      else renderLogin();
      renderModels();
      setTestResult(`ใช้งานได้ พบ ${list.length} โมเดล`, 'ok');
    }
  } catch (e) {
    setTestResult(e.message, 'err');
  }
};

$('save-settings').onclick = async () => {
  stashForm();
  settings.provider = shownProvider;
  await persist();
  $('saved').textContent = 'บันทึกแล้ว';
  setTimeout(() => ($('saved').textContent = ''), 2000);
};

// ช่องชื่อหน่วยที่หัวใบปะหน้า: ตัวอย่างในช่องมาจาก profile ของระบบปลายทางที่เลือกอยู่
function renderCoverUnitField() {
  $('cover-unit').value = settings.coverUnit || '';
  $('cover-unit').placeholder = profile.cover?.unit || 'เช่น ส่วนบริหารทั่วไป';
}

async function loadSettings() {
  const stored = await chrome.storage.local.get(['settings', 'apiKey']);
  if (stored.settings) settings = { ...settings, ...stored.settings };
  else if (stored.apiKey) settings.keys.anthropic = stored.apiKey; // ย้ายจากเวอร์ชันแรก
  // เวอร์ชันนี้ใช้ API key อย่างเดียว: ถ้าเคยบันทึกโหมดองค์กรไว้ให้กลับไปค่ายเริ่มต้น
  orgUrl = await orgBackendUrl();
  if (orgUrl) {
    // โหมดองค์กร: ใช้ backend เสมอ และดึงรายการวิธี login จาก backend (ไม่ต้องขอสิทธิ์ ใช้ CORS ของ backend)
    settings.provider = 'backend';
    settings.backendUrl = orgUrl;
    try {
      settings.backendOidc = (await fetchBackendConfig(orgUrl)).oidc.map(({ id, label }) => ({ id, label }));
    } catch {
      settings.backendOidc = [];
    }
    shownProvider = 'backend';
  } else {
    // เวอร์ชันนี้ใช้ API key อย่างเดียว: ถ้าเคยบันทึกโหมดองค์กรไว้ให้กลับไปค่ายเริ่มต้น
    shownProvider = PROVIDERS[settings.provider] && !isLogin(settings.provider) ? settings.provider : DEFAULT_PROVIDER;
  }
  renderProvider();
  renderCoverUnitField();
}
loadSettings();

/* ---------- สถานะ ---------- */

function setStatus(text, isError = false) {
  const el = $('status');
  el.hidden = !text;
  el.textContent = text || '';
  el.classList.toggle('error', isError);
}

/* ---------- แหล่งไฟล์ ---------- */

// เรียกหลัง mountSources (ซึ่งตัดแท็บของแหล่งที่ปิดไว้ออกแล้ว)
function wireTabs() {
  document.querySelectorAll('.tab').forEach((btn) => {
    btn.onclick = () => {
      document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b === btn));
      document.querySelectorAll('.pane').forEach((p) => (p.hidden = p.id !== `pane-${btn.dataset.tab}`));
    };
  });
}

function setFile(blob, name) {
  currentBlob = blob;
  currentName = name;
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = URL.createObjectURL(blob);
  $('preview').src = previewUrl;
  $('open-pdf').href = previewUrl;
  $('file-name').textContent = name;
  $('preview-card').hidden = false;
  $('result-card').hidden = true;
  setStatus('');
  analyze();
}

const fileInput = $('file-input');
fileInput.onchange = () => fileInput.files[0] && acceptFile(fileInput.files[0]);
const dz = $('dropzone');
['dragenter', 'dragover'].forEach((ev) =>
  dz.addEventListener(ev, (e) => {
    e.preventDefault();
    dz.classList.add('over');
  }),
);
['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, () => dz.classList.remove('over')));
dz.addEventListener('drop', (e) => {
  e.preventDefault();
  if (e.dataTransfer.files[0]) acceptFile(e.dataTransfer.files[0]);
});

function acceptFile(file) {
  if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) {
    setStatus('รองรับเฉพาะไฟล์ PDF', true);
    return;
  }
  setFile(file, file.name);
}

mountSources({ onPick: setFile, setStatus });
wireTabs();

/* ---------- วิเคราะห์เอกสาร ---------- */

let abortCtl = null;
async function analyze() {
  if (!currentBlob) return;
  abortCtl?.abort();
  abortCtl = new AbortController();
  $('analyze').disabled = true;
  setStatus('กำลังอ่านและวิเคราะห์เอกสาร…');
  try {
    const { settings: saved } = await chrome.storage.local.get('settings');
    const provider = orgUrl ? 'backend' : PROVIDERS[saved?.provider] && !isLogin(saved.provider) ? saved.provider : DEFAULT_PROVIDER;
    if (isLogin(provider)) {
      // โหมดองค์กร: ส่งผ่าน backend ด้วย session ของผู้ใช้ (backend ใช้ key และโมเดลที่ admin ตั้ง)
      if (!sessionValid()) {
        renderOrgBar();
        throw new Error('กรุณาเข้าสู่ระบบด้วยบัญชีองค์กรก่อน (แถบด้านบน)');
      }
      const base64 = await fileToBase64(currentBlob);
      extracted = await extractFromPdf({ provider, apiKey: settings.session.token, base64, profile, baseUrl: orgUrl, signal: abortCtl.signal });
    } else if (isLocal(provider)) {
      extracted = await extractLocal({ data: new Uint8Array(await currentBlob.arrayBuffer()), profile, onProgress: (t) => setStatus(t) });
    } else {
      const apiKey = saved?.keys?.[provider] || '';
      const list = saved?.modelLists?.[provider]?.length ? saved.modelLists[provider] : PROVIDERS[provider].models;
      const model = pickModel(provider, list, saved?.models?.[provider]);
      const base64 = await fileToBase64(currentBlob);
      extracted = await extractFromPdf({ provider, apiKey, model, base64, profile, signal: abortCtl.signal });
    }
    docType = docTypeKey(profile, extracted.doc_type);
    rows = buildRows(profile, docType, extracted);
    renderResult();
    setStatus('');
  } catch (e) {
    if (e.name !== 'AbortError') setStatus(e.message, true);
    // โหมดองค์กร: backend ปฏิเสธเซสชัน (หมดอายุ/ถูกเพิกถอน) -> ล้างเซสชันในเครื่อง ให้แถบด้านบนขอ login ใหม่
    if (orgUrl && /เซสชัน/.test(e.message) && settings.session) {
      settings.session = null;
      await persist();
      renderOrgBar();
    }
  } finally {
    $('analyze').disabled = false;
  }
}
$('analyze').onclick = analyze;

/* ---------- แสดงผล / แก้ไข ---------- */

function renderResult() {
  $('result-card').hidden = false;
  const warnings = extracted?.warnings || [];
  $('result-warn').hidden = !warnings.length;
  $('result-warn').textContent = warnings.join(' ');
  const sel = $('doc-type');
  sel.replaceChildren(
    ...Object.entries(profile.docTypes).map(([k, t]) => new Option(t.label, k, false, k === docType)),
  );
  $('type-hint').textContent = profile.docTypes[docType].hint;
  renderRows();
  updateFillButton(pageOk);
}

$('doc-type').onchange = (e) => {
  // เปลี่ยนประเภท -> สร้างรายการฟิลด์ใหม่ โดยคงค่าที่ผู้ใช้แก้ไว้ในฟิลด์ที่ซ้ำกัน
  const edited = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  docType = e.target.value;
  rows = buildRows(profile, docType, extracted).map((r) => (r.key in edited ? { ...r, value: edited[r.key] } : r));
  $('type-hint').textContent = profile.docTypes[docType].hint;
  renderRows();
};

function renderRows() {
  const box = $('rows');
  box.replaceChildren();
  rows.forEach((row) => {
    const wrap = document.createElement('div');
    const low = row.confidence !== null && row.confidence < LOW_CONFIDENCE;
    wrap.className = `fld${low ? ' low' : ''}`;

    const label = document.createElement('label');
    const name = document.createElement('span');
    name.textContent = row.label;
    const conf = document.createElement('span');
    if (row.confidence !== null) {
      conf.className = `conf ${low ? 'low' : 'ok'}`;
      conf.textContent = low ? `ตรวจอีกครั้ง (${Math.round(row.confidence * 100)}%)` : `${Math.round(row.confidence * 100)}%`;
    }
    const fillable = profile.fields[row.key]?.fill !== false && (disc.active ? disc.has(row.key) : !!profile.fields[row.key]?.selector);
    const tail = document.createElement('span');
    tail.className = 'tail';
    tail.append(conf);
    if (fillable) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'fill-one';
      btn.textContent = 'กรอก';
      btn.title = `กรอกเฉพาะช่อง "${row.label}" ลงฟอร์ม`;
      btn.disabled = !pageOk;
      btn.onclick = () => fillOne(row, btn);
      tail.append(btn);
    } else {
      const tag = document.createElement('span');
      tag.className = 'cover-only';
      tag.textContent = profile.fields[row.key]?.fill === false ? 'ใช้ในใบปะหน้า' : 'ไม่พบช่องในหน้านี้';
      tail.append(tag);
    }
    label.append(name, tail);

    let input;
    if (row.kind === 'select') {
      input = document.createElement('select');
      row.options.forEach(([v, l]) => input.append(new Option(l, v, false, v === row.value)));
    } else if (row.kind === 'textarea') {
      input = document.createElement('textarea');
      input.value = row.value;
    } else {
      input = document.createElement('input');
      input.type = 'text';
      input.value = row.value;
      if (row.kind === 'date') input.placeholder = 'dd/mm/yyyy (พ.ศ.)';
    }
    input.oninput = input.onchange = () => {
      row.value = input.value;
    };
    wrap.append(label, input);
    box.append(wrap);
  });
}

/* ---------- กรอกฟอร์ม ---------- */

// กรอกทีละช่อง: ส่งเฉพาะ selector/ค่าของช่องนั้น (ไม่แตะช่องอื่น)
async function fillOne(row, btn) {
  const flash = (text, cls) => {
    btn.textContent = text;
    btn.className = `fill-one ${cls}`;
    setTimeout(() => {
      btn.textContent = 'กรอก';
      btn.className = 'fill-one';
    }, 1500);
  };
  try {
    let message = { type: 'FILL', selectors: { [row.key]: profile.fields[row.key].selector }, values: { [row.key]: row.value } };
    if (disc.active) {
      const p = disc.payload(profile, rows, row.key);
      if (p.skipped.length) throw new Error(`${row.label}: ${p.skipped[0].reason}`);
      message = { type: 'FILL', selectors: p.selectors, values: p.values };
    }
    const { results } = await sendToPage(message);
    const r = results.find((x) => x.key === row.key);
    if (r?.ok) flash('กรอกแล้ว', 'done');
    else {
      flash('ไม่สำเร็จ', 'fail');
      setStatus(`${row.label}: ${r?.reason || 'กรอกไม่ได้'}`, true);
    }
  } catch (e) {
    flash('ไม่สำเร็จ', 'fail');
    setStatus(e.message, true);
  }
}

$('fill').onclick = async () => {
  const report = $('fill-report');
  try {
    let message = { type: 'FILL', selectors: fieldSelectors(profile), values: rowsToFormValues(profile, docType, rows) };
    let skipped = [];
    if (disc.active) {
      const p = disc.payload(profile, rows);
      message = { type: 'FILL', selectors: p.selectors, values: p.values };
      skipped = [...p.skipped, ...disc.unsure(profile, rows).filter((u) => !p.skipped.some((k) => k.key === u.key)).map((u) => ({ key: u.label, reason: u.reason }))];
    }
    const { results } = await sendToPage(message);
    const failed = [...results.filter((r) => !r.ok), ...skipped.map((s) => ({ key: s.key, reason: s.reason }))];
    report.hidden = false;
    report.replaceChildren();
    const ok = document.createElement('div');
    ok.className = 'good';
    ok.textContent = `กรอกแล้ว ${results.filter((r) => r.ok).length} ช่อง — กรุณาตรวจในฟอร์มก่อนกดบันทึก`;
    report.append(ok);
    failed.forEach((f) => {
      const d = document.createElement('div');
      d.className = 'bad';
      d.textContent = `${profile.fields[f.key]?.label || f.key}: ${f.reason}`;
      report.append(d);
    });
  } catch (e) {
    setStatus(e.message, true);
  }
};

/* ---------- ใบปะหน้า ---------- */

$('cover').onclick = async () => {
  let form = {};
  try {
    form = (await sendToPage({ type: 'READ', selectors: profile.readOnly || {} })).values || {};
  } catch {
    // ไม่มีหน้าปลายทางก็ยังออกใบปะหน้าจากข้อมูลที่ดึงได้
  }
  const { settings: saved } = await chrome.storage.local.get('settings');
  const model = buildCover(profile, {
    unit: saved?.coverUnit || '',
    docTypeLabel: profile.docTypes[docType].label,
    fields: Object.fromEntries(rows.map((r) => [r.key, r.value])),
    summary: extracted?.summary || '',
    requestedAction: extracted?.requested_action || '',
    form,
  });
  await chrome.storage.session.set({ coverModel: model });
  chrome.tabs.create({ url: chrome.runtime.getURL('cover.html') });
};

init();
