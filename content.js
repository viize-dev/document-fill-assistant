// Content script แบบกลาง (ไม่รู้จักระบบใด): รับ selector จาก side panel ทุกครั้งที่เรียก
// ถูก inject ตอนใช้งานด้วย chrome.scripting จึงไม่ต้องประกาศ domain ล่วงหน้าใน manifest
(() => {
  const VERSION = 2;
  // inject ซ้ำ (เช่น หลังอัปเดต extension) ให้ถอด listener เดิมก่อน กันตอบซ้ำ
  if (window.__docFillAssistantLoaded === VERSION) return;
  if (window.__docFillListener) chrome.runtime.onMessage.removeListener(window.__docFillListener);
  window.__docFillAssistantLoaded = VERSION;

  // selector รองรับเส้นทางข้าม iframe/shadow DOM (" >>> ") ผ่านตัวสแกน (lib/discovery/scan.js)
  const $ = (selector) => {
    const deep = globalThis.__docFillScan;
    if (deep) return deep.resolve(selector);
    try {
      return document.querySelector(selector);
    } catch {
      return null;
    }
  };

  // ตั้งค่าแบบที่ React/framework รับรู้: native setter + event ตามชนิดช่อง
  function setValue(el, value) {
    const proto = Object.getPrototypeOf(el);
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function fill(selectors, values) {
    return Object.entries(values)
      .filter(([, v]) => v !== '' && v != null)
      .map(([key, value]) => {
        const el = selectors[key] && $(selectors[key]);
        if (!el) return { key, ok: false, reason: 'ไม่พบช่องในหน้า' };
        if (el.disabled) return { key, ok: false, reason: 'ช่องถูกปิดใช้งาน' };
        if (el.readOnly) return { key, ok: false, reason: 'ช่องอ่านอย่างเดียว' };
        let v = String(value);
        if (el.tagName === 'SELECT') {
          // จับคู่ด้วยค่า (value) ก่อน ไม่เจอลองจับคู่ด้วยข้อความของตัวเลือก (ระบบจริงบางระบบใช้รหัสภายในเป็น value)
          const opt = [...el.options].find((o) => o.value === v) || [...el.options].find((o) => o.text.trim() === v);
          if (!opt) return { key, ok: false, reason: `ไม่มีตัวเลือก "${value}"` };
          v = opt.value;
        }
        setValue(el, v);
        el.style.backgroundColor = '#fff8d6';
        return { key, ok: true };
      });
  }

  function read(selectors) {
    const out = {};
    Object.entries(selectors).forEach(([key, selector]) => {
      const el = $(selector);
      if (!el) return;
      out[key] = 'value' in el && el.tagName !== 'LI' ? el.value : el.textContent.trim();
    });
    return out;
  }

  const listener = (msg, _sender, sendResponse) => {
    switch (msg?.type) {
      case 'PING':
        sendResponse({ ok: true, v: VERSION });
        break;
      case 'SCAN':
        sendResponse(globalThis.__docFillScan ? { snapshot: globalThis.__docFillScan.scan(msg.known || {}) } : { error: 'ไม่มีตัวสแกน' });
        break;
      case 'HIGHLIGHT':
        sendResponse({ ok: !!globalThis.__docFillScan?.highlight(msg.selector) });
        break;
      case 'PICK_START':
        globalThis.__docFillScan?.startPick(
          (field) => chrome.runtime.sendMessage({ type: 'PICKED', field }).catch(() => {}),
          () => chrome.runtime.sendMessage({ type: 'PICK_CANCEL' }).catch(() => {}),
        );
        sendResponse({ ok: true });
        break;
      case 'PICK_STOP':
        globalThis.__docFillScan?.stopPick();
        sendResponse({ ok: true });
        break;
      case 'DETECT':
        // detect = เจออย่างน้อยหนึ่ง, detectAll = ต้องเจอทุกตัว, detectNot = ห้ามเจอ (แยกหน้าที่ใช้ id ชุดเดียวกัน เช่น หน้าค้นหา)
        sendResponse({
          ok: (msg.detect || []).some((s) => !!$(s)) && (msg.detectAll || []).every((s) => !!$(s)) && !(msg.detectNot || []).some((s) => !!$(s)),
          url: location.href,
          title: document.title,
        });
        break;
      case 'FILL':
        sendResponse({ results: fill(msg.selectors || {}, msg.values || {}) });
        break;
      case 'READ':
        sendResponse({ values: read(msg.selectors || {}) });
        break;
      default:
        return false;
    }
    return false;
  };
  window.__docFillListener = listener;
  chrome.runtime.onMessage.addListener(listener);

  // ระบบสารบรรณสลับเมนูโดยไม่โหลดหน้าใหม่ (URL เดิม): เฝ้าดูการเปลี่ยนของช่อง/หัวเรื่อง แล้วแจ้ง side panel ให้สแกนใหม่เอง
  // เช็คไม่เกิน 1 ครั้งต่อวินาที (บางหน้ามีนาฬิกาที่แก้ DOM ทุกวินาที) และแจ้งเฉพาะเมื่อลายเซ็นเปลี่ยนจริง
  const scanner = globalThis.__docFillScan;
  if (scanner?.quickSig) {
    let last = scanner.quickSig();
    let timer = null;
    const check = () => {
      timer = null;
      let now;
      try {
        now = scanner.quickSig();
      } catch {
        return;
      }
      if (now === last) return;
      last = now;
      try {
        chrome.runtime.sendMessage({ type: 'PAGE_CHANGED' }).catch(() => {});
      } catch {
        observer.disconnect(); // extension ถูกรีโหลด: context เดิมใช้ไม่ได้แล้ว
      }
    };
    const schedule = () => {
      if (!timer) timer = setTimeout(check, 1000);
    };
    const observer = new MutationObserver(schedule);
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class', 'hidden'] });
    window.addEventListener('hashchange', schedule);
    window.addEventListener('popstate', schedule);
  }
})();
