// ส่วน "ตรวจจับช่องในหน้านี้" ใน side panel (F1–F3): สแกน → จับคู่ → ให้ผู้ใช้ตรวจ/แก้/ชี้ช่อง → จำไว้ → ให้ sidepanel.js ใช้กรอก
import { matchSnapshot, classifyPage, formSignature, matchableKeys, mapOptions, usable, LEVELS } from './lib/discovery/match.js';
import { loadAll, saveLearned, pickLearned } from './lib/discovery/learned.js';
import { buildFillPayload } from './lib/discovery/apply.js';
import { fieldSelectors } from './lib/mapping.js';

const LEVEL_TEXT = { high: 'มั่นใจ', medium: 'ตรวจอีกครั้ง', low: 'ไม่แน่ใจ', manual: 'เลือกเอง' };

export function mountDiscovery({ root, getProfile, sendToPage, getRows, setStatus, onChange }) {
  const state = { debug: false, kind: 'unknown', reason: '', active: false, snapshot: null, signature: '', map: {}, learned: null, picking: null, warnings: [], unmatched: [] };

  const $ = (sel) => root.querySelector(sel);
  const el = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => (k === 'class' ? (n.className = v) : k.startsWith('on') ? (n[k] = v) : n.setAttribute(k, v)));
    n.append(...kids);
    return n;
  };

  const entries = () => Object.values(state.map).filter(Boolean);
  const fieldName = (f) => f.label || f.hints?.[0] || f.name || f.id || f.selector;

  function setMap(res) {
    state.map = {};
    res.entries.forEach((e) => {
      state.map[e.key] = { ...e, confirmed: e.level === LEVELS.HIGH };
    });
    state.warnings = res.warnings;
    state.unmatched = res.unmatched;
  }

  // auto = สแกนเองเพราะ profile ไม่ตรงหน้า (ใช้ผลต่อเมื่อเจออย่างน้อย 1 ช่อง); passive = แสดงผลอย่างเดียว ยังใช้ selector ของ profile
  async function scan({ auto = false, passive = false } = {}) {
    const profile = getProfile();
    const { snapshot, error } = await sendToPage({ type: 'SCAN', known: fieldSelectors(profile) });
    if (error || !snapshot) throw new Error(error || 'สแกนหน้าไม่สำเร็จ');
    state.snapshot = snapshot;
    state.signature = formSignature(snapshot);
    const origin = new URL(snapshot.url).origin;
    state.learned = pickLearned(await loadAll(chrome.storage.local), origin, state.signature, snapshot, profile.id);
    const res = matchSnapshot(snapshot, profile, { learned: state.learned });
    setMap(res);
    ({ kind: state.kind, reason: state.reason } = classifyPage(snapshot, res));
    // สแกนเอง (auto) ใช้ผลต่อเมื่อหน้าเป็นฟอร์มกรอกหนังสือ; ผู้ใช้กด "สแกนใหม่" เอง = ใช้ผลเสมอ (ผู้ใช้ตรวจ/แก้ได้)
    state.active = passive ? false : auto ? state.kind === 'form' : true;
    render();
    onChange?.();
    return entries().length;
  }

  function reset() {
    state.active = false;
    state.snapshot = null;
    state.map = {};
    state.picking = null;
    render();
  }

  const fieldChoices = () => (state.snapshot?.fields || []).filter((f) => usable(f) && !['checkbox', 'radio', 'editable'].includes(f.kind));

  function assign(key, field) {
    const profile = getProfile();
    if (!field) {
      delete state.map[key];
    } else {
      // ช่องเดียวใช้ได้กับฟิลด์เดียว: ถ้าถูกใช้อยู่ ปล่อยจากฟิลด์เดิม
      Object.entries(state.map).forEach(([k, e]) => e && k !== key && e.field.i === field.i && delete state.map[k]);
      const def = profile.fields[key];
      state.map[key] = {
        key,
        field,
        selector: field.selector,
        score: 1,
        level: 'manual',
        reason: 'ผู้ใช้เลือกเอง',
        optionMap: def.kind === 'select' ? mapOptions(def.options, field.options) : null,
        note: '',
        source: 'manual',
        ambiguous: false,
        confirmed: true,
      };
    }
    render();
    onChange?.();
  }

  async function highlight(entry) {
    try {
      await sendToPage({ type: 'HIGHLIGHT', selector: entry.selector });
    } catch (e) {
      setStatus(e.message, true);
    }
  }

  async function pick(key) {
    state.picking = key;
    render();
    try {
      await sendToPage({ type: 'PICK_START' });
      setStatus('คลิกช่องที่ต้องการบนหน้าเว็บ (กด Esc เพื่อยกเลิก)');
    } catch (e) {
      state.picking = null;
      render();
      setStatus(e.message, true);
    }
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'PICKED' && state.picking) {
      const key = state.picking;
      state.picking = null;
      // ช่องที่ชี้อาจไม่อยู่ใน snapshot เดิม (หน้าเพิ่งเปลี่ยน): เติมเข้ารายการ
      let f = state.snapshot?.fields.find((x) => x.selector === msg.field.selector);
      if (!f) {
        f = { ...msg.field, i: (state.snapshot?.fields.length || 0) };
        state.snapshot?.fields.push(f);
      }
      assign(key, f);
      setStatus('');
    } else if (msg?.type === 'PICK_CANCEL' && state.picking) {
      state.picking = null;
      render();
      setStatus('');
    }
  });

  async function remember() {
    if (!state.snapshot) return;
    const profile = getProfile();
    await saveLearned(chrome.storage.local, {
      origin: new URL(state.snapshot.url).origin,
      signature: state.signature,
      profileId: profile.id,
      label: state.snapshot.title || '',
      entries: entries(),
    });
    state.learned = { map: {}, changed: false };
    setStatus('จำการจับคู่ของหน้านี้แล้ว');
    render();
  }

  function render() {
    const box = $('#disc-body');
    // ผู้ใช้ทั่วไปไม่เห็นส่วนนี้ (ตรวจจับอัตโนมัติทั้งหมด) แสดงเฉพาะเมื่อเปิดโหมดนักพัฒนา: chrome.storage.local.debugDiscovery = true
    root.hidden = !(state.snapshot && state.debug);
    box.replaceChildren();
    if (!state.snapshot) return;
    const profile = getProfile();
    const choices = fieldChoices();
    const keys = matchableKeys(profile);

    $('#disc-summary').textContent = `พบ ${state.snapshot.fields.length} ช่องในหน้า • จับคู่ได้ ${entries().length}/${keys.length}${state.learned ? ' • มีที่จำไว้' : ''}${state.active ? '' : state.kind === 'form' ? ' • (ยังใช้โปรไฟล์ของระบบ)' : ' • หน้านี้ไม่ใช่ฟอร์มกรอกหนังสือ'}`;

    const warn = $('#disc-warn');
    warn.hidden = !state.warnings.length;
    warn.textContent = [...state.warnings, ...(state.kind !== 'form' && !state.active ? [`ไม่ใช่ฟอร์มกรอกหนังสือ: ${state.reason}`] : [])].join(' • ');
    warn.hidden = !warn.textContent;

    keys.forEach((key) => {
      const def = profile.fields[key];
      const e = state.map[key];
      const row = el('div', { class: `disc-row${e && !e.confirmed ? ' pending' : ''}` });
      const title = el('div', { class: 'disc-title' }, el('span', {}, def.label));
      if (e) {
        title.append(el('span', { class: `conf ${e.level === 'high' || e.level === 'manual' ? 'ok' : 'low'}` }, LEVEL_TEXT[e.level] || e.level));
      } else {
        title.append(el('span', { class: 'conf low' }, 'ยังไม่พบช่อง'));
      }
      const sel = el('select', { 'aria-label': `ช่องของ ${def.label}` });
      sel.append(new Option('— ไม่กรอก —', ''));
      choices.forEach((f) => sel.append(new Option(`${fieldName(f)}${f.id ? ` (#${f.id})` : ''}`, String(f.i), false, e?.field.i === f.i)));
      sel.onchange = () => assign(key, sel.value === '' ? null : state.snapshot.fields.find((f) => String(f.i) === sel.value));
      const tools = el('span', { class: 'disc-tools' });
      if (e) {
        const use = el('input', { type: 'checkbox', title: 'ใช้ช่องนี้เมื่อกด "กรอกฟอร์ม"' });
        use.checked = e.confirmed;
        use.onchange = () => {
          e.confirmed = use.checked;
          row.classList.toggle('pending', !e.confirmed);
          onChange?.();
        };
        tools.append(el('label', { class: 'small' }, use, ' ใช้'));
        tools.append(el('button', { type: 'button', class: 'fill-one', title: 'ไฮไลต์ช่องนี้บนหน้าเว็บ', onclick: () => highlight(e) }, 'ดู'));
      }
      tools.append(
        el('button', { type: 'button', class: `fill-one${state.picking === key ? ' done' : ''}`, title: 'คลิกเลือกช่องบนหน้าเว็บเอง', onclick: () => pick(key) }, state.picking === key ? 'รอคลิก…' : 'ชี้ช่อง'),
      );
      row.append(title, sel, tools);
      if (e) {
        const why = [e.reason, e.note, e.ambiguous ? 'อาจเป็นช่องอื่นได้ด้วย' : ''].filter(Boolean).join(' • ');
        if (why) row.append(el('div', { class: 'small muted' }, why));
      }
      box.append(row);
    });
    if (state.unmatched.length) {
      const names = state.unmatched.filter((f) => usable(f) && !['checkbox', 'radio'].includes(f.kind)).map(fieldName).slice(0, 12);
      if (names.length) box.append(el('div', { class: 'small muted' }, `ช่องอื่นในหน้าที่ไม่ได้ใช้: ${names.join(', ')}`));
    }
  }

  chrome.storage.local.get('debugDiscovery').then((g) => {
    state.debug = !!g?.debugDiscovery;
    render();
  });
  chrome.storage.onChanged.addListener((ch) => {
    if (ch.debugDiscovery) {
      state.debug = !!ch.debugDiscovery.newValue;
      render();
    }
  });

  $('#disc-rescan').onclick = async () => {
    try {
      await scan();
    } catch (e) {
      setStatus(e.message, true);
    }
  };
  $('#disc-remember').onclick = () => remember().catch((e) => setStatus(e.message, true));

  return {
    scan,
    reset,
    get active() {
      return state.active;
    },
    get kind() {
      return state.kind;
    },
    has: (key) => state.active && !!state.map[key],
    // ฟิลด์ที่ผู้ใช้ควรรู้ว่าไม่ได้กรอกอัตโนมัติ: ไม่พบช่อง หรือพบแต่ไม่มั่นใจ
    unsure: (profile, rows) =>
      rows
        .filter((r) => profile.fields[r.key]?.fill !== false && String(r.value ?? '').trim())
        .map((r) => {
          const e = state.map[r.key];
          if (!e) return { key: r.key, label: r.label, reason: 'ไม่พบช่องนี้ในหน้า' };
          if (!e.confirmed) return { key: r.key, label: r.label, reason: 'ไม่แน่ใจว่าเป็นช่องไหน จึงไม่กรอกอัตโนมัติ (กดปุ่ม "กรอก" เองได้)' };
          return null;
        })
        .filter(Boolean),
    entry: (key) => state.map[key] || null,
    // payload สำหรับ FILL: only = กรอกช่องเดียว (ผู้ใช้กดเอง) ไม่ต้องรอ "ใช้"
    payload: (profile, rows, only = null) => buildFillPayload(entries(), profile, rows, { only }),
  };
}
