// หน้า admin: HTML หน้าเดียว ไม่พึ่งไลบรารีภายนอก; ข้อความที่มาจากเซิร์ฟเวอร์ใส่ด้วย textContent เท่านั้น
// สคริปต์/สไตล์ผูกกับ nonce ของ CSP ต่อคำขอ (ไม่มี inline handler)

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const CSS = `
:root{--bg:#f4f6f9;--card:#fff;--line:#d9dee6;--text:#1c2430;--muted:#667085;--blue:#2b6cb0;--ok:#16794c;--bad:#b42318}
@media (prefers-color-scheme:dark){:root{--bg:#10151c;--card:#18202a;--line:#2b3644;--text:#e8edf3;--muted:#9aa7b8;--blue:#6fa8e8;--ok:#4cc38a;--bad:#f1807a}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,"Noto Sans Thai",sans-serif}
header{padding:12px 20px;border-bottom:1px solid var(--line);background:var(--card);display:flex;gap:12px;align-items:center}
header h1{font-size:17px;margin:0;flex:1}main{max-width:860px;margin:0 auto;padding:16px}
section{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:14px 16px;margin-bottom:14px}
h2{font-size:15px;margin:0 0 10px}label{display:block;font-size:13px;color:var(--muted);margin:8px 0 3px}
input,select,textarea{width:100%;padding:7px 9px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--text);font:inherit}
input[type=radio],input[type=checkbox]{width:auto}label.row{color:var(--text);font-size:14px}textarea{min-height:64px}button{padding:7px 14px;border:1px solid var(--line);border-radius:6px;background:var(--card);color:var(--text);font:inherit;cursor:pointer}
button.primary{background:var(--blue);border-color:var(--blue);color:#fff}button.danger{color:var(--bad)}button:disabled{opacity:.5;cursor:not-allowed}
.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.row>*{flex:0 0 auto}.row>input{flex:1 1 240px}.row>input[type=radio],.row>input[type=checkbox]{flex:0 0 auto}
.card{border:1px solid var(--line);border-radius:6px;padding:10px 12px;margin-bottom:8px}.muted{color:var(--muted);font-size:13px}
.ok{color:var(--ok)}.bad{color:var(--bad)}table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;padding:5px 6px;border-bottom:1px solid var(--line)}
.warn{background:#fff4e5;color:#7a4b00;border:1px solid #f0c36d;border-radius:6px;padding:8px 12px;margin-bottom:12px}
@media (prefers-color-scheme:dark){.warn{background:#3a2c10;color:#f5d28a;border-color:#6b4f12}}
.hidden{display:none!important}
`;

const JS = `
const $ = (id) => document.getElementById(id);
const h = (tag, props = {}, ...kids) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(props)) { if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else e[k] = v; } kids.flat().forEach((c) => c != null && e.append(c)); return e; };
let state = null;
let testedModels = {};

async function api(method, path, body) {
  const res = await fetch('/admin/api' + path, { method, headers: { 'content-type': 'application/json', 'x-admin-csrf': '1' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await res.json().catch(() => ({}));
  if (res.status === 401) { showLogin(); throw new Error(j.error || 'กรุณาเข้าสู่ระบบ'); }
  if (!res.ok) throw new Error(j.error || 'ผิดพลาด (' + res.status + ')');
  return j;
}
function toast(msg, bad) { const t = $('toast'); t.textContent = msg; t.className = bad ? 'bad' : 'ok'; clearTimeout(toast.t); toast.t = setTimeout(() => (t.textContent = ''), 6000); }
const guard = (fn) => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message, true); } };

function showLogin() { $('app').classList.add('hidden'); $('login').classList.remove('hidden'); }

async function load() {
  try { state = await api('GET', '/state'); } catch { return; }
  $('login').classList.add('hidden'); $('app').classList.remove('hidden');
  $('who').textContent = state.admin;
  $('nokey').classList.toggle('hidden', state.masterKeyConfigured);
  renderKeys(); renderModels(); renderLimits(); renderAccess(); renderFeatures();
  loadUsage(); loadAudit();
}

const PROVIDER_LABEL = { anthropic: 'Claude (Anthropic)', openai: 'ChatGPT (OpenAI)', gemini: 'Gemini (Google)' };

function renderKeys() {
  const box = $('keys'); box.replaceChildren();
  state.providers.forEach((p) => {
    const k = state.keys[p];
    const status = !k.set ? 'ยังไม่ได้ตั้ง key' : k.source === 'env' ? 'ใช้ key จาก environment ของเซิร์ฟเวอร์' : 'ตั้งแล้ว ลงท้าย ••••' + k.last4 + ' (' + k.updatedAt.slice(0, 10) + ')';
    const input = h('input', { type: 'password', autocomplete: 'off', placeholder: 'วาง API key ใหม่ (ไม่แสดงกลับหลังบันทึก)' });
    const use = h('input', { type: 'radio', name: 'provider', checked: state.provider === p });
    use.onchange = guard(async () => { await api('PUT', '/settings', { provider: p }); toast('ใช้ ' + PROVIDER_LABEL[p] + ' แล้ว'); await load(); });
    const save = h('button', { class: 'primary', text: 'บันทึก key' });
    save.onclick = guard(async () => { await api('PUT', '/keys/' + p, { key: input.value }); input.value = ''; toast('บันทึก key แล้ว'); await load(); });
    const test = h('button', { text: 'ทดสอบ key' });
    test.onclick = guard(async () => { const r = await api('POST', '/keys/' + p + '/test'); testedModels[p] = r.models; toast('key ใช้งานได้ พบ ' + r.models.length + ' โมเดล'); renderModels(); });
    const del = h('button', { class: 'danger', text: 'ลบ key', disabled: !k.set || k.source === 'env' });
    del.onclick = guard(async () => { if (!confirm('ลบ key ของ ' + PROVIDER_LABEL[p] + '?')) return; await api('DELETE', '/keys/' + p); toast('ลบ key แล้ว'); await load(); });
    save.disabled = !state.masterKeyConfigured;
    box.append(h('div', { class: 'card' },
      h('div', { class: 'row' }, use, h('strong', { text: PROVIDER_LABEL[p] }), h('span', { class: 'muted ' + (k.set ? 'ok' : ''), text: status })),
      h('div', { class: 'row' }, input, save, test, del)));
  });
}

function renderModels() {
  const box = $('models'); box.replaceChildren();
  const list = (testedModels[state.provider] || []).concat(state.models).filter((m, i, a) => a.findIndex((x) => x.id === m.id) === i);
  const enabled = new Set(state.models.map((m) => m.id));
  const checks = list.map((m) => { const c = h('input', { type: 'checkbox', checked: enabled.has(m.id) }); c.dataset.id = m.id; c.dataset.label = m.label || m.id; return [c, m]; });
  const def = h('select');
  const fillDef = () => { const ids = checks.filter(([c]) => c.checked).map(([c]) => c.dataset.id); def.replaceChildren(...ids.map((id) => new Option(id, id, false, id === state.defaultModel))); };
  checks.forEach(([c]) => (c.onchange = fillDef));
  box.append(h('p', { class: 'muted', text: 'ผู้ให้บริการที่ใช้: ' + PROVIDER_LABEL[state.provider] + ' — กด "ทดสอบ key" เพื่อโหลดรายการโมเดลล่าสุดจากค่าย' }));
  checks.forEach(([c, m]) => box.append(h('label', { class: 'row' }, c, h('span', { text: (m.label || m.id) + (m.label && m.label !== m.id ? ' (' + m.id + ')' : '') }))));
  fillDef();
  const save = h('button', { class: 'primary', text: 'บันทึกโมเดล' });
  save.onclick = guard(async () => {
    const models = checks.filter(([c]) => c.checked).map(([c]) => ({ id: c.dataset.id, label: c.dataset.label }));
    await api('PUT', '/settings', { models, defaultModel: def.value }); toast('บันทึกโมเดลแล้ว'); await load();
  });
  box.append(h('label', { text: 'โมเดลเริ่มต้น' }), def, h('div', { class: 'row', style: 'margin-top:10px' }, save));
}

function numberField(label, id, value) { return [h('label', { text: label, htmlFor: id }), h('input', { id, type: 'number', min: 1, value })]; }
function renderLimits() {
  const box = $('limits'); box.replaceChildren();
  const L = state.limits;
  box.append(...numberField('โควต้าต่อผู้ใช้ต่อเดือน (ครั้ง)', 'l-month', L.monthlyRequestsPerUser), ...numberField('ขีดจำกัดต่อผู้ใช้ต่อนาที (ครั้ง)', 'l-min', L.requestsPerMinutePerUser), ...numberField('ขนาดไฟล์ PDF สูงสุด (MB)', 'l-mb', Math.round(L.maxPdfBytes / 1e6)));
  const save = h('button', { class: 'primary', text: 'บันทึกโควต้า' });
  save.onclick = guard(async () => { await api('PUT', '/settings', { limits: { monthlyRequestsPerUser: +$('l-month').value, requestsPerMinutePerUser: +$('l-min').value, maxPdfBytes: Math.round(+$('l-mb').value * 1e6) } }); toast('บันทึกโควต้าแล้ว'); await load(); });
  box.append(h('div', { class: 'row', style: 'margin-top:10px' }, save));
}

const lines = (t) => t.split(/[\\n,]+/).map((x) => x.trim()).filter(Boolean);
function renderAccess() {
  const box = $('access'); box.replaceChildren();
  const fields = {};
  Object.entries(state.access).forEach(([id, a]) => {
    const d = h('textarea', { value: a.allowedDomains.join('\\n') }), e = h('textarea', { value: a.allowedEmails.join('\\n') });
    fields[id] = [d, e];
    box.append(h('div', { class: 'card' }, h('strong', { text: a.label }), h('label', { text: 'โดเมนที่อนุญาต (บรรทัดละ 1 รายการ)' }), d, h('label', { text: 'อีเมลเฉพาะที่อนุญาต' }), e));
  });
  const blocked = h('textarea', { value: state.blockedEmails.join('\\n') });
  const save = h('button', { class: 'primary', text: 'บันทึกสิทธิ์เข้าใช้' });
  save.onclick = guard(async () => {
    const access = Object.fromEntries(Object.entries(fields).map(([id, [d, e]]) => [id, { allowedDomains: lines(d.value), allowedEmails: lines(e.value) }]));
    await api('PUT', '/settings', { access, blockedEmails: lines(blocked.value) }); toast('บันทึกสิทธิ์เข้าใช้แล้ว'); await load();
  });
  box.append(h('label', { text: 'บัญชีที่ถูกระงับ (มีผลทันที)' }), blocked, h('div', { class: 'row', style: 'margin-top:10px' }, save));
}

function renderFeatures() {
  const box = $('features'); box.replaceChildren();
  const c = h('input', { type: 'checkbox', checked: !!state.features.summary });
  c.onchange = guard(async () => { await api('PUT', '/settings', { features: { summary: c.checked } }); toast('บันทึกแล้ว'); await load(); });
  box.append(h('label', { class: 'row' }, c, h('span', { text: 'สรุปเอกสารสำหรับใบปะหน้า (ใช้ token เพิ่มเล็กน้อยต่อไฟล์)' })));
}

function table(head, rows) {
  return h('table', {}, h('thead', {}, h('tr', {}, head.map((x) => h('th', { text: x })))), h('tbody', {}, rows.map((r) => h('tr', {}, r.map((x) => h('td', { text: String(x) }))))));
}
async function loadUsage() {
  const m = $('u-month').value || state.month;
  const r = await api('GET', '/usage?month=' + encodeURIComponent(m));
  $('u-month').value = r.month;
  $('usage').replaceChildren(r.users.length ? table(['ผู้ใช้', 'ครั้ง', 'สำเร็จ', 'token เข้า', 'token ออก'], r.users.map((u) => [u.email, u.requests, u.ok, u.input_tokens, u.output_tokens])) : h('p', { class: 'muted', text: 'ยังไม่มีการใช้งานในเดือนนี้' }));
}
async function loadAudit() {
  const r = await api('GET', '/audit?limit=50');
  $('audit').replaceChildren(r.entries.length ? table(['เวลา', 'ผู้ทำ', 'การกระทำ', 'เป้าหมาย', 'รายละเอียด'], r.entries.map((e) => [e.ts.replace('T', ' ').slice(0, 19), e.actor, e.action, e.target, e.detail])) : h('p', { class: 'muted', text: 'ยังไม่มีรายการ' }));
}

$('u-load').onclick = guard(loadUsage);
$('revoke').onclick = guard(async () => { if (!confirm('เพิกถอน session ของผู้ใช้ทุกคน (ทุกคนต้อง login ใหม่ รวมถึงคุณ)?')) return; await api('POST', '/sessions/revoke'); showLogin(); });
$('logout').onclick = guard(async () => { await api('POST', '/logout'); showLogin(); });
const dev = $('dev-go'); if (dev) dev.onclick = guard(async () => { const r = await fetch('/admin/dev-login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: $('dev-email').value }) }); if (!r.ok) throw new Error('login ไม่สำเร็จ'); await load(); });
load();
`;

export function adminHtml({ nonce, name, loginEnabled, devAuth }) {
  return `<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ผู้ดูแลระบบ — ${esc(name)}</title><style nonce="${nonce}">${CSS}</style></head><body>
<header><h1>ผู้ดูแลระบบ — ${esc(name)}</h1><span id="who" class="muted"></span><button id="logout">ออกจากระบบ</button></header>
<main>
<div id="toast" role="status"></div>
<section id="login" class="hidden"><h2>เข้าสู่ระบบผู้ดูแล</h2>
${loginEnabled ? '<p><a href="/admin/login"><button class="primary">เข้าสู่ระบบด้วยบัญชีองค์กร</button></a></p>' : '<p class="muted">ยังไม่ได้เปิด login ของผู้ดูแล (ตั้ง adminLogin ใน config.json)</p>'}
${devAuth ? '<p class="warn">โหมดพัฒนา (devAuth)</p><div class="row"><input id="dev-email" placeholder="อีเมล admin"><button id="dev-go">เข้าสู่ระบบ (dev)</button></div>' : ''}
</section>
<div id="app" class="hidden">
<div id="nokey" class="warn hidden">เซิร์ฟเวอร์ยังไม่ได้ตั้ง MASTER_KEY จึงบันทึก API key ผ่านหน้านี้ไม่ได้ (ใช้ key จาก environment แทนได้)</div>
<section><h2>ผู้ให้บริการ AI และ API key</h2><p class="muted">key เก็บแบบเข้ารหัสบนเซิร์ฟเวอร์ ไม่ส่งกลับมาแสดง เห็นได้แค่ 4 ตัวท้าย ผู้ใช้ทั่วไปไม่เห็นและไม่ต้องกรอก key</p><div id="keys"></div></section>
<section><h2>โมเดลที่เปิดให้ใช้</h2><div id="models"></div></section>
<section><h2>โควต้าและขนาดไฟล์</h2><div id="limits"></div></section>
<section><h2>สิทธิ์เข้าใช้</h2><div id="access"></div></section>
<section><h2>ฟีเจอร์</h2><div id="features"></div></section>
<section><h2>รายงานการใช้งาน</h2><div class="row"><input id="u-month" placeholder="YYYY-MM" style="max-width:140px"><button id="u-load">ดู</button></div><div id="usage"></div><p class="muted">token เป็นข้อมูลจากค่ายต้นทาง ใช้ประมาณค่าใช้จ่ายได้ ไม่ใช่ใบแจ้งหนี้</p></section>
<section><h2>บันทึกการเปลี่ยนแปลง (audit)</h2><div id="audit"></div></section>
<section><h2>ความปลอดภัย</h2><p class="muted">เพิกถอน session ของผู้ใช้ทุกคนทันที (ใช้เมื่อสงสัยว่ามีการรั่วไหล)</p><button id="revoke" class="danger">เพิกถอน session ทั้งหมด</button></section>
</div></main><script nonce="${nonce}">${JS}</script></body></html>`;
}
