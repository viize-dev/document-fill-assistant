import { buildCoverDocx } from './lib/docx.js';

// แสดงใบปะหน้า "แบบกลาง" จากโมเดลที่ side panel สร้าง (ดู lib/cover.js) ทุกช่องแก้ไขได้ก่อนพิมพ์
// ใช้ textContent เท่านั้น ไม่ใช้ innerHTML กับข้อความจากเอกสาร

function el(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else e.setAttribute(k, v);
  }
  kids.flat().forEach((c) => c != null && e.append(c));
  return e;
}

// ช่องแก้ไขได้ (contenteditable แบบข้อความล้วน กัน HTML ที่วางเข้ามา)
function editable(value, { block = false, placeholder = '' } = {}) {
  const e = el('span', { class: `ed${block ? ' block' : ''}`, contenteditable: 'plaintext-only', 'data-ph': placeholder, spellcheck: 'false' });
  e.textContent = value || '';
  return e;
}

function option(o, boxes) {
  const box = el('span', { class: 'opt', role: 'checkbox', tabindex: '0', 'aria-checked': String(!!o.checked) }, el('span', { class: 'cb' }), el('span', { text: o.label }));
  const toggle = () => box.setAttribute('aria-checked', String(box.getAttribute('aria-checked') !== 'true'));
  box.dataset.label = o.label;
  boxes.push(box);
  box.addEventListener('click', toggle);
  box.addEventListener('keydown', (ev) => {
    if (ev.key === ' ' || ev.key === 'Enter') {
      ev.preventDefault();
      toggle();
    }
  });
  return box;
}

// ช่องที่แก้ไขได้ทั้งหมด (key -> element) ไว้อ่านค่ากลับตอนส่งออก Word
let refs = {};
let optionBoxes = [];
let baseModel = null;
const ed = (key, value, opts) => (refs[key] = editable(value, opts));

// โมเดลปัจจุบัน = โมเดลตั้งต้น + สิ่งที่ผู้ใช้แก้บนหน้านี้
function currentModel() {
  const text = (k) => refs[k].textContent.replace(/\s+/g, ' ').trim();
  return {
    ...baseModel,
    eNo: text('eNo'),
    unit: text('unit'),
    receiptNo: text('receiptNo'),
    date: text('date'),
    subject: text('subject'),
    route: text('route'),
    due: text('due'),
    summary: text('summary'),
    note: text('note'),
    footerLabel: text('footer'),
    options: optionBoxes.map((b) => ({ id: b.dataset.label, label: b.dataset.label, checked: b.getAttribute('aria-checked') === 'true' })),
  };
}

function render(m) {
  baseModel = m;
  refs = {};
  optionBoxes = [];
  const page = document.getElementById('page');
  page.replaceChildren(
    el('div', { class: 'eno' }, `${m.eNoLabel} `, ed('eNo', m.eNo, { placeholder: '........' })),
    el('div', { class: 'head' },
      el('span', { class: 'unit' }, ed('unit', m.unit, { block: true, placeholder: 'ชื่อหน่วย/ส่วน' })),
      el('span', { class: 'gap' }, `${m.receiptLabel} `, ed('receiptNo', m.receiptNo, { placeholder: '........' })),
      el('span', { class: 'gap' }, `${m.dateLabel} `, ed('date', m.date, { placeholder: '........' })),
    ),
    el('div', { class: 'subject' }, el('span', { text: m.subjectLabel }), ed('subject', m.subject, { block: true })),
    el('table', { class: 'box' },
      el('colgroup', {}, el('col'), el('col', { style: 'width:36mm' })),
      el('tr', {},
        el('td', { class: 'to' }, `${m.routeLabel} `, ed('route', m.route)),
        el('td', { class: 'due', rowspan: '3' }, m.dueLabel, ed('due', m.due, { block: true })),
      ),
      el('tr', {}, el('td', { class: 'opts' }, el('div', { class: 'row' }, m.options.map((o) => option(o, optionBoxes))))),
      el('tr', {}, el('td', { class: 'sum' }, ed('summary', m.summary, { block: true }))),
      el('tr', {}, el('td', { class: 'note', colspan: '2' }, el('span', { class: 'lbl', text: m.noteLabel }), ed('note', m.note))),
      el('tr', {}, el('td', { class: 'blank', colspan: '2' })),
      el('tr', {}, el('td', { class: 'blank', colspan: '2' })),
    ),
    el('div', { class: 'footer' }, ed('footer', m.footerLabel, { placeholder: '' })),
    el('div', { class: 'lines' }, Array.from({ length: m.lines }, () => el('div'))),
  );
  document.title = `ใบปะหน้า ${m.receiptNo}`.trim();
}

document.getElementById('print').onclick = () => window.print();

// ส่งออก Word (.docx): ใช้ค่าที่ผู้ใช้แก้บนหน้านี้ ไม่ใช่ค่าตั้งต้น
// ฟอนต์ Sarabun ที่เก็บไว้ในแพ็กเกจ (lib/vendor/fonts, SIL OFL) ฝังลงไฟล์ Word; โหลดไม่ได้ก็ส่งออกต่อโดยไม่ฝัง
async function loadFonts() {
  try {
    const get = async (name) => {
      const res = await fetch(chrome.runtime.getURL(`lib/vendor/fonts/${name}`));
      if (!res.ok) throw new Error(name);
      return new Uint8Array(await res.arrayBuffer());
    };
    return { regular: await get('Sarabun-Regular.ttf'), bold: await get('Sarabun-Bold.ttf') };
  } catch {
    return undefined;
  }
}

document.getElementById('word').onclick = async () => {
  const m = currentModel();
  const blob = buildCoverDocx(m, { fonts: await loadFonts() });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `ใบปะหน้า-${(m.receiptNo || m.createdAt || 'เอกสาร').replace(/[\\/:*?"<>|\s]+/g, '_')}.docx`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
};

chrome.storage.session.get('coverModel').then(({ coverModel }) => {
  if (coverModel) render(coverModel);
  else document.getElementById('page').textContent = 'ไม่พบข้อมูลใบปะหน้า กรุณากดสร้างจาก side panel อีกครั้ง';
});
