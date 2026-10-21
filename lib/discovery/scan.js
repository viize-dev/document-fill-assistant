// ตัวสแกนช่อง input ของหน้าเว็บ (F1) — classic script ที่ถูก inject คู่กับ content.js (ไม่ใช่ ES module)
// เก็บเฉพาะโครงสร้าง (ป้ายชื่อ ชนิด ตัวเลือก selector) ไม่เก็บค่าที่ผู้ใช้พิมพ์ไว้ในช่อง
// selector แบบลึก: ส่วนที่ผ่าน iframe (same-origin) หรือ shadow DOM คั่นด้วย " >>> "
(() => {
  const SEP = ' >>> ';
  const SKIP_TYPES = new Set(['hidden', 'password', 'file', 'submit', 'button', 'reset', 'image']);
  // ช่องอ่อนไหว: ไม่เข้า snapshot เลย
  const SENSITIVE = /pass(word|wd)?\b|pwd|otp|cvv|cvc|card.?n|credit|ssn|รหัสผ่าน|เลขบัตร|รหัสความปลอดภัย/i;
  const GENERATED_ID = /(\d{4,}|^:|^ember|^react|^mui-|^radix-|[0-9a-f]{8}-[0-9a-f]{4})/i;
  const MAX_OPTIONS = 80;

  const esc = (s) => (globalThis.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/([^\w-])/g, '\\$1'));
  const clean = (s, max = 80) =>
    String(s ?? '')
      .replace(/[​-‍﻿]/g, '')
      .replace(/\s+/g, ' ')
      .replace(/[\s:：*]+$/g, '')
      .replace(/^[\s*]+/, '')
      .trim()
      .slice(0, max);

  const viewOf = (el) => el.ownerDocument.defaultView || window;

  function isShown(el) {
    const win = viewOf(el);
    for (let n = el; n && n.nodeType === 1; n = n.parentElement || (n.getRootNode().host ?? null)) {
      const st = win.getComputedStyle(n);
      if (st.display === 'none' || st.visibility === 'hidden') return false;
    }
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  // select2 ซ่อน <select> จริงไว้และวาด .select2-container แทน: ถือว่ามองเห็นถ้า container เห็น
  function widgetOf(el) {
    if (el.tagName !== 'SELECT') return null;
    const next = el.nextElementSibling;
    if (next && next.classList.contains('select2-container')) return { name: 'select2', box: next };
    return null;
  }
  function isVisible(el) {
    const w = widgetOf(el);
    return w ? isShown(w.box) : isShown(el);
  }

  const textOf = (el) => clean(el?.textContent, 120);
  const fillableIn = (root) => root.querySelectorAll('input,select,textarea');

  function labelCandidates(el) {
    const out = [];
    const add = (source, text) => {
      const t = clean(text);
      if (t && t.length <= 80 && !out.some((o) => o.text === t)) out.push({ source, text: t });
    };
    const doc = el.ownerDocument;
    // 1) <label for> / label ที่ครอบ
    if (el.labels) [...el.labels].forEach((l) => add('label', labelText(l)));
    // 2) aria
    const by = el.getAttribute('aria-labelledby');
    if (by) add('aria', by.split(/\s+/).map((id) => doc.getElementById(id)?.textContent || '').join(' '));
    add('aria', el.getAttribute('aria-label'));
    // 3) ตาราง: เซลล์ก่อนหน้าในแถวเดียวกัน
    const cell = el.closest('td,th');
    if (cell) {
      let prev = cell.previousElementSibling;
      while (prev && !textOf(prev)) prev = prev.previousElementSibling;
      if (prev && !fillableIn(prev).length) add('table', prev.textContent);
    }
    // 4) กลุ่มฟอร์ม (form-group / row / col): label ที่อยู่ในกลุ่มที่มีช่องนี้ช่องเดียว
    let node = el.parentElement;
    for (let depth = 0; node && depth < 4; depth += 1, node = node.parentElement) {
      const controls = [...fillableIn(node)].filter((c) => !SKIP_TYPES.has(c.type) && c.type !== 'search');
      if (controls.length > 1) break;
      const lab = [...node.querySelectorAll('label,.control-label,.form-label,legend')].find(
        (l) => !l.contains(el) && textOf(l),
      );
      if (lab) {
        add('group', lab.textContent);
        break;
      }
      // ข้อความของพี่น้องก่อนหน้าที่เป็นคอลัมน์ (เช่น <div class="col-2">เรื่อง</div><div class="col-10"><input></div>)
      let sib = node.previousElementSibling;
      while (sib && !textOf(sib)) sib = sib.previousElementSibling;
      if (sib && !fillableIn(sib).length && textOf(sib).length <= 60) {
        add('sibling', sib.textContent);
        break;
      }
    }
    // 5) ข้อความที่อยู่ก่อนหน้าโดยตรง
    for (let n = el.previousSibling, hops = 0; n && hops < 3; n = n.previousSibling, hops += 1) {
      const t = clean(n.textContent);
      if (t) {
        if (n.nodeType === 3 || !fillableIn(n.nodeType === 1 ? n : doc).length) add('before', t);
        break;
      }
    }
    return out;
  }

  // ข้อความของ label โดยตัดข้อความภายในช่องที่ถูกครอบออก
  function labelText(label) {
    const copy = label.cloneNode(true);
    copy.querySelectorAll('input,select,textarea,option,script,style').forEach((n) => n.remove());
    return copy.textContent;
  }

  function uniqueSelector(el, root) {
    const tag = el.tagName.toLowerCase();
    const only = (sel) => {
      try {
        const found = root.querySelectorAll(sel);
        return found.length === 1 && found[0] === el;
      } catch {
        return false;
      }
    };
    if (el.id && !GENERATED_ID.test(el.id) && only(`#${esc(el.id)}`)) return `#${esc(el.id)}`;
    const name = el.getAttribute('name');
    if (name && only(`${tag}[name="${name.replace(/"/g, '\\"')}"]`)) return `${tag}[name="${name.replace(/"/g, '\\"')}"]`;
    for (const attr of ['data-field', 'data-name', 'data-testid', 'data-test', 'data-id']) {
      const v = el.getAttribute(attr);
      if (v && only(`[${attr}="${v.replace(/"/g, '\\"')}"]`)) return `[${attr}="${v.replace(/"/g, '\\"')}"]`;
    }
    // เส้นทาง: ไต่ขึ้นจนเจอจุดยึด (id ที่ไม่ใช่ค่าสุ่ม) หรือราก
    const parts = [];
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      if (n !== el && n.id && !GENERATED_ID.test(n.id)) {
        parts.unshift(`#${esc(n.id)}`);
        break;
      }
      const same = n.parentElement ? [...n.parentElement.children].filter((c) => c.tagName === n.tagName) : [n];
      parts.unshift(same.length > 1 ? `${n.tagName.toLowerCase()}:nth-of-type(${same.indexOf(n) + 1})` : n.tagName.toLowerCase());
    }
    return parts.join(' > ');
  }

  // รวบรวมช่องจากรากหนึ่ง (document / shadowRoot) พร้อมเข้าไปใน shadow DOM และ iframe ที่อ่านได้
  function collect(root, prefix, out, stats) {
    const doc = root.ownerDocument || root;
    root.querySelectorAll('*').forEach((host) => {
      if (host.shadowRoot) collect(host.shadowRoot, `${prefix}${uniqueSelector(host, root)}${SEP}`, out, stats);
      if (host.tagName === 'IFRAME' || host.tagName === 'FRAME') {
        let inner = null;
        try {
          inner = host.contentDocument;
        } catch {
          inner = null;
        }
        if (inner && inner.documentElement) collect(inner, `${prefix}${uniqueSelector(host, root)}${SEP}`, out, stats);
        else stats.crossOriginFrames += 1;
      }
    });
    root.querySelectorAll('input,select,textarea,[contenteditable=""],[contenteditable="true"]').forEach((el) => {
      out.push({ el, root, prefix, doc });
    });
  }

  function describe({ el, root, prefix }, known) {
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute('type') || (tag === 'input' ? 'text' : '')).toLowerCase();
    if (tag === 'input' && SKIP_TYPES.has(type)) return null;
    const label = labelCandidates(el);
    const name = el.getAttribute('name') || '';
    const idAttr = el.id || '';
    if (SENSITIVE.test(`${name} ${idAttr} ${el.getAttribute('autocomplete') || ''} ${label.map((l) => l.text).join(' ')}`)) return null;
    const widget = widgetOf(el);
    let kind = 'text';
    if (tag === 'select') kind = 'select';
    else if (tag === 'textarea') kind = 'textarea';
    else if (tag === 'input') {
      if (type === 'checkbox' || type === 'radio') kind = type;
      else if (type === 'number') kind = 'number';
      else if (['date', 'datetime-local', 'month', 'time'].includes(type)) kind = 'date';
    } else kind = 'editable';
    const cls = (el.getAttribute('class') || '').trim().slice(0, 80);
    const hints = [el.getAttribute('placeholder'), el.getAttribute('title')].map((h) => clean(h)).filter(Boolean);
    const options = [];
    if (tag === 'select') {
      [...el.options].slice(0, MAX_OPTIONS).forEach((o) => options.push({ value: o.value, text: clean(o.text, 60) }));
    } else if (type === 'radio' && name) {
      root.querySelectorAll(`input[type="radio"][name="${name.replace(/"/g, '\\"')}"]`).forEach((r) => {
        options.push({ value: r.value, text: clean(labelCandidates(r)[0]?.text || r.value, 60) });
      });
    }
    const selector = prefix + uniqueSelector(el, root);
    const profileKeys = Object.entries(known || {})
      .filter(([, s]) => s && resolve(s, el.ownerDocument) === el)
      .map(([k]) => k);
    return {
      tag,
      kind,
      inputType: type,
      name,
      id: idAttr,
      cls,
      label: label[0]?.text || '',
      labelSource: label[0]?.source || '',
      labels: label.map((l) => l.text),
      hints,
      options,
      optionCount: tag === 'select' ? el.options.length : options.length,
      required: el.required === true || el.getAttribute('aria-required') === 'true',
      readonly: el.readOnly === true || el.getAttribute('aria-readonly') === 'true',
      disabled: el.disabled === true,
      visible: isVisible(el),
      maxlength: el.maxLength > 0 ? el.maxLength : 0,
      dateLike: kind === 'date' || /date|picker/i.test(cls) || /dd\/mm|วว\/ดด|\d{2}\/\d{2}\/\d{4}/i.test(hints.join(' ')),
      widget: widget ? widget.name : null,
      selector,
      profileKeys,
    };
  }

  // หัวเรื่องของหน้า (h1/h2 ที่มองเห็นอันแรก) ใช้แยกฟอร์มกรอกออกจากหน้าค้นหา/รายงาน
  function pageHeading() {
    const h = [...document.querySelectorAll('h1,h2,.page-title')].find((e) => textOf(e) && isShown(e));
    return h ? clean(h.textContent, 100) : '';
  }

  // ลายเซ็นแบบเบาๆ ของหน้า (หัวเรื่อง + รายการ id/name ของช่องที่มองเห็น) ไว้ตรวจว่าผู้ใช้เปลี่ยนเมนู/หน้าหรือไม่
  function quickSig() {
    const ids = [...document.querySelectorAll('input,select,textarea')]
      .filter((e) => !SKIP_TYPES.has(e.type) && isVisible(e))
      .map((e) => e.id || e.name || e.tagName)
      .join(',');
    return `${pageHeading()}#${ids}`;
  }

  // known: { key: selector } ของ profile ที่เลือกอยู่ (ใช้ระบุว่าช่องไหนตรงกับ profile อยู่แล้ว)
  function scan(known = {}) {
    const found = [];
    const stats = { crossOriginFrames: 0 };
    collect(document, '', found, stats);
    const seenRadio = new Set();
    const fields = [];
    for (const item of found) {
      const f = describe(item, known);
      if (!f) continue;
      if (f.kind === 'radio') {
        const k = `${item.prefix}|${f.name}`;
        if (f.name && seenRadio.has(k)) continue;
        seenRadio.add(k);
      }
      fields.push(f);
    }
    fields.forEach((f, i) => {
      f.i = i;
    });
    return { url: location.href, title: document.title, heading: pageHeading(), fields, crossOriginFrames: stats.crossOriginFrames, scannedAt: Date.now() };
  }

  // แก้ selector (รองรับ " >>> ") เป็นองค์ประกอบ
  function resolve(selector, startDoc = document) {
    if (!selector) return null;
    let root = startDoc;
    const parts = String(selector).split(SEP);
    let el = null;
    for (let i = 0; i < parts.length; i += 1) {
      try {
        el = root.querySelector(parts[i]);
      } catch {
        return null;
      }
      if (!el) return null;
      if (i < parts.length - 1) {
        let next = el.shadowRoot || null;
        if (!next) {
          try {
            next = el.contentDocument;
          } catch {
            next = null;
          }
        }
        if (!next) return null;
        root = next;
      }
    }
    return el;
  }

  // ไฮไลต์ชั่วคราว (ให้ผู้ใช้เห็นว่าช่องไหน)
  let hlTimer = null;
  function highlight(selector, ms = 2000) {
    const el = resolve(selector);
    if (!el) return false;
    const target = widgetOf(el)?.box || el;
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const prev = target.style.outline;
    const prevOff = target.style.outlineOffset;
    target.style.outline = '3px solid #2b8fe0';
    target.style.outlineOffset = '2px';
    clearTimeout(hlTimer);
    hlTimer = setTimeout(() => {
      target.style.outline = prev;
      target.style.outlineOffset = prevOff;
    }, ms);
    return true;
  }

  // โหมดชี้ช่อง: คลิกองค์ประกอบบนหน้า -> ส่ง snapshot ของช่องนั้นกลับ (ไม่ทำให้คลิกไปถึงหน้าเว็บ)
  let picker = null;
  function stopPick() {
    if (!picker) return;
    picker.off();
    picker = null;
  }
  function fieldFromTarget(target) {
    let el = target;
    if (el.closest) {
      const wrap = el.closest('.select2-container');
      if (wrap) {
        const sel = wrap.previousElementSibling;
        if (sel && sel.tagName === 'SELECT') return sel;
      }
      const label = el.closest('label');
      if (label && label.control) return label.control;
      const ctl = el.closest('input,select,textarea');
      if (ctl) return ctl;
    }
    return null;
  }
  function startPick(onPick, onCancel) {
    stopPick();
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;border:2px solid #e67e22;background:rgba(230,126,34,.12);display:none';
    document.documentElement.append(box);
    const move = (e) => {
      const el = fieldFromTarget(e.target);
      const t = el ? widgetOf(el)?.box || el : null;
      if (!t) {
        box.style.display = 'none';
        return;
      }
      const r = t.getBoundingClientRect();
      Object.assign(box.style, { display: 'block', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    };
    const block = (e) => {
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    const click = (e) => {
      block(e);
      const el = fieldFromTarget(e.target);
      if (!el) return;
      const root = el.getRootNode();
      const item = { el, root: root.nodeType === 9 || root.nodeType === 11 ? root : document, prefix: '' };
      // ช่องใน shadow/iframe: ใช้เส้นทางของ scan แทน (หาจากผล scan ให้ตรงตัว)
      const snap = scan();
      const hit = snap.fields.find((f) => resolve(f.selector) === el);
      const field = hit || describe(item, {});
      stopPick();
      if (field) onPick(field);
    };
    const key = (e) => {
      if (e.key === 'Escape') {
        block(e);
        stopPick();
        onCancel?.();
      }
    };
    const types = ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'touchstart', 'dblclick', 'contextmenu'];
    document.addEventListener('mousemove', move, true);
    document.addEventListener('click', click, true);
    document.addEventListener('keydown', key, true);
    types.forEach((t) => document.addEventListener(t, block, true));
    picker = {
      off() {
        document.removeEventListener('mousemove', move, true);
        document.removeEventListener('click', click, true);
        document.removeEventListener('keydown', key, true);
        types.forEach((t) => document.removeEventListener(t, block, true));
        box.remove();
      },
    };
  }

  globalThis.__docFillScan = { scan, quickSig, resolve, highlight, startPick, stopPick, SEP };
})();
