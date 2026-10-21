// สร้างไฟล์ Word (.docx) ของใบปะหน้า ในเบราว์เซอร์ ไม่พึ่งไลบรารีภายนอก
// .docx คือไฟล์ ZIP ของ XML จึงเขียน ZIP แบบไม่บีบอัด (store) เอง; ช่องติ๊กเป็น content control ของ Word (คลิกติ๊กได้)
// รับโมเดลเดียวกับหน้าใบปะหน้า (หลังผู้ใช้แก้ไขแล้ว) ข้อความทุกช่องผ่าน esc() เสมอ

// ฟอนต์ Sarabun (Google Fonts, SIL OFL 1.1 อนุญาตให้ฝังในเอกสาร) ฝังลงไฟล์ได้ถ้าส่ง fonts เข้ามา (ดู buildCoverDocx)
// ไม่ได้ฝัง/ผู้เปิดไม่รองรับฟอนต์ฝัง: Word จะใช้ TH SarabunPSK ถ้าเครื่องมี (altName) ไม่เช่นนั้นใช้ฟอนต์สำรอง
const FONT = 'Sarabun';
const ALT_FONT = 'TH SarabunPSK';
const SZ = 26; // 13pt (หน่วยครึ่งจุด) Sarabun ตัวใหญ่กว่า TH SarabunPSK ที่ขนาดเท่ากัน
const PAGE_W = 11906; // A4 (twips)
const MARGIN = 1134; // 2 ซม.
const TEXT_W = PAGE_W - MARGIN * 2;
const LEFT_COL = 7200;
const RIGHT_COL = TEXT_W - LEFT_COL;

// ตัดอักขระควบคุมที่ XML ไม่รับ แล้ว escape
const esc = (s) =>
  String(s ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const rpr = ({ u, b, sz = SZ } = {}) =>
  `<w:rPr><w:rFonts w:ascii="${FONT}" w:hAnsi="${FONT}" w:cs="${FONT}" w:eastAsia="${FONT}"/>${b ? '<w:b/><w:bCs/>' : ''}${u ? `<w:u w:val="${u}"/>` : ''}<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/><w:lang w:bidi="th-TH"/></w:rPr>`;

// ข้อความ 1 ช่วง; \t = แท็บ, \n = ขึ้นบรรทัดใหม่
function run(text, o = {}) {
  const parts = String(text ?? '').split(/(\t|\n)/);
  const inner = parts
    .map((t) => (t === '\t' ? '<w:tab/>' : t === '\n' ? '<w:br/>' : t ? `<w:t xml:space="preserve">${esc(t)}</w:t>` : ''))
    .join('');
  return `<w:r>${rpr(o)}${inner}</w:r>`;
}

// ค่าที่กรอก (ขีดเส้นประใต้ให้เห็นว่าแก้ได้) ว่าง = เว้นช่องว่างให้เขียน
const value = (text, o = {}) => run(text || '          ', { ...o, u: 'dotted' });

function para(children, { jc, tabs, ind, before = 0, after = 0, line, border, keepNext } = {}) {
  const tabXml = tabs ? `<w:tabs>${tabs.map(([t, pos, leader]) => `<w:tab w:val="${t}"${leader ? ` w:leader="${leader}"` : ''} w:pos="${pos}"/>`).join('')}</w:tabs>` : '';
  const indXml = ind ? `<w:ind ${Object.entries(ind).map(([k, v]) => `w:${k}="${v}"`).join(' ')}/>` : '';
  const lineXml = line ? ` w:line="${line}" w:lineRule="exact"` : '';
  const bdr = border ? '<w:pBdr><w:bottom w:val="single" w:sz="8" w:space="1" w:color="222222"/></w:pBdr>' : '';
  return `<w:p><w:pPr>${keepNext ? '<w:keepNext/>' : ''}${bdr}${tabXml}<w:spacing w:before="${before}" w:after="${after}"${lineXml}/>${indXml}${jc ? `<w:jc w:val="${jc}"/>` : ''}</w:pPr>${children}</w:p>`;
}

// ช่องติ๊กของ Word (w14:checkbox) ผู้ใช้คลิกติ๊ก/ยกเลิกในไฟล์ได้
function checkbox(checked, sz = SZ) {
  const glyph = checked ? '☒' : '☐';
  return (
    `<w:sdt><w:sdtPr><w14:checkbox><w14:checked w14:val="${checked ? 1 : 0}"/>` +
    '<w14:checkedState w14:val="2612" w14:font="MS Gothic"/><w14:uncheckedState w14:val="2610" w14:font="MS Gothic"/></w14:checkbox></w:sdtPr>' +
    `<w:sdtContent><w:r><w:rPr><w:rFonts w:ascii="MS Gothic" w:eastAsia="MS Gothic" w:hAnsi="MS Gothic" w:hint="eastAsia"/><w:sz w:val="${sz}"/></w:rPr><w:t>${glyph}</w:t></w:r></w:sdtContent></w:sdt>`
  );
}

function cell(width, content, { span, vMerge, borders = true, vAlign } = {}) {
  const tcBorders = borders ? '' : '<w:tcBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/></w:tcBorders>';
  return (
    `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${span ? `<w:gridSpan w:val="${span}"/>` : ''}` +
    `${vMerge ? (vMerge === 'start' ? '<w:vMerge w:val="restart"/>' : '<w:vMerge/>') : ''}${tcBorders}${vAlign ? `<w:vAlign w:val="${vAlign}"/>` : ''}</w:tcPr>${content}</w:tc>`
  );
}
const row = (cells, minHeight) => `<w:tr><w:trPr><w:cantSplit/>${minHeight ? `<w:trHeight w:val="${minHeight}" w:hRule="atLeast"/>` : ''}</w:trPr>${cells}</w:tr>`;

export function coverDocumentXml(m) {
  const body = [];
  body.push(para(run(`${m.eNoLabel} `) + value(m.eNo), { jc: 'right', after: 60 }));
  body.push(
    para(value(m.unit) + run(`\t${m.receiptLabel} `) + value(m.receiptNo) + run(`\t${m.dateLabel} `) + value(m.date), {
      tabs: [['left', 5400], ['right', TEXT_W]],
      after: 60,
    }),
  );
  body.push(para(run(`${m.subjectLabel}\t`) + value(m.subject), { tabs: [['left', 720]], ind: { left: 720, hanging: 720 }, after: 120 }));

  const opts = (m.options || []).length;
  const optRuns = (m.options || [])
    .map((o, i) => (i ? run('\t') : '') + checkbox(!!o.checked, 24) + run(` ${o.label}`, { sz: 24 }))
    .join('');
  const optTabs = Array.from({ length: Math.max(0, opts - 1) }, (_, i) => ['left', Math.round(((i + 1) * LEFT_COL) / opts)]);

  const dueCell = para(run(m.dueLabel), { jc: 'center' }) + para(value(m.due, { sz: 24 }), { jc: 'center', before: 60 });
  const table =
    '<w:tbl><w:tblPr><w:tblW w:w="' + TEXT_W + '" w:type="dxa"/><w:tblLayout w:type="fixed"/>' +
    '<w:tblBorders>' + ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((b) => `<w:${b} w:val="single" w:sz="12" w:space="0" w:color="222222"/>`).join('') + '</w:tblBorders>' +
    '<w:tblCellMar><w:left w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
    `<w:tblGrid><w:gridCol w:w="${LEFT_COL}"/><w:gridCol w:w="${RIGHT_COL}"/></w:tblGrid>` +
    // เรียน | วันที่กำหนด (ช่องขวารวม 3 แถวแรก)
    row(cell(LEFT_COL, para(run(`${m.routeLabel} `) + value(m.route))) + cell(RIGHT_COL, dueCell, { vMerge: 'start' }), 560) +
    row(cell(LEFT_COL, para(optRuns, { tabs: optTabs })) + cell(RIGHT_COL, para(''), { vMerge: 'cont' }), 560) +
    row(
      cell(LEFT_COL, para(value(m.summary, { sz: 22 }), { line: 260 })) + cell(RIGHT_COL, para(''), { vMerge: 'cont' }),
      900,
    ) +
    row(cell(TEXT_W, para(run(`${m.noteLabel} `) + value(m.note)), { span: 2 }), 560) +
    row(cell(TEXT_W, para(''), { span: 2 }), 560) +
    row(cell(TEXT_W, para(''), { span: 2 }), 560) +
    '</w:tbl>';
  body.push(table);

  body.push(para(m.footerLabel ? value(m.footerLabel) : '', { jc: 'right', before: 80, after: 200 }));
  // เส้นเขียนความเห็น: ย่อหน้าที่มีแท็บขวาสุดแบบมีเส้นนำ (underscore) ได้เส้นเต็มความกว้างที่ Word/LibreOffice แสดงตรงกัน
  // (ใช้ขอบย่อหน้าไม่ได้เพราะ Word รวมขอบของย่อหน้าติดกันเป็นเส้นเดียว)
  for (let i = 0; i < (m.lines ?? 10); i++) body.push(para(run('\t'), { tabs: [['right', TEXT_W, 'underscore']], line: 600 }));

  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" ' +
    'xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" mc:Ignorable="w14"><w:body>' +
    body.join('') +
    `<w:sectPr><w:pgSz w:w="${PAGE_W}" w:h="16838"/><w:pgMar w:top="${MARGIN}" w:right="${MARGIN}" w:bottom="${MARGIN}" w:left="${MARGIN}" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>` +
    '</w:body></w:document>'
  );
}

const STYLES =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr>' +
  `<w:rFonts w:ascii="${FONT}" w:hAnsi="${FONT}" w:cs="${FONT}" w:eastAsia="${FONT}"/><w:sz w:val="${SZ}"/><w:szCs w:val="${SZ}"/><w:lang w:val="th-TH" w:bidi="th-TH"/>` +
  '</w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
  '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style></w:styles>';

const CONTENT_TYPES =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
  '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
  '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>' +
  '<Override PartName="/word/fontTable.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml"/>' +
  '<Default Extension="odttf" ContentType="application/vnd.openxmlformats-officedocument.obfuscatedFont"/></Types>';
const ROOT_RELS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>';
const DOC_RELS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
  '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>' +
  '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/fontTable" Target="fontTable.xml"/></Relationships>';

/* ---------- ZIP แบบไม่บีบอัด ---------- */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// files = [[ชื่อ, ข้อความหรือ Uint8Array]] -> Uint8Array ของไฟล์ zip
export function zipStore(files) {
  const enc = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;
  const u16 = (v) => [v & 0xff, (v >>> 8) & 0xff];
  const u32 = (v) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
  for (const [name, text] of files) {
    const nameB = enc.encode(name);
    const data = typeof text === 'string' ? enc.encode(text) : text; // ข้อความหรือไบต์ (ฟอนต์ฝัง)
    const crc = crc32(data);
    // 0x0800 = ชื่อไฟล์เป็น UTF-8; วันที่/เวลา DOS คงที่ (1980-01-01) เพื่อให้ผลลัพธ์เหมือนเดิมทุกครั้ง
    const common = [...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(nameB.length), ...u16(0)];
    const local = new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...common, ...nameB]);
    chunks.push(local, data);
    central.push(new Uint8Array([0x50, 0x4b, 0x01, 0x02, ...u16(20), ...common, ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset), ...nameB]));
    offset += local.length + data.length;
  }
  const centralSize = central.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array([0x50, 0x4b, 0x05, 0x06, ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(centralSize), ...u32(offset), ...u16(0)]);
  const all = [...chunks, ...central, end];
  const out = new Uint8Array(all.reduce((n, c) => n + c.length, 0));
  let p = 0;
  for (const c of all) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}

/* ---------- ฟอนต์ฝัง ---------- */

// Word เก็บฟอนต์ฝังแบบ "obfuscated" (.odttf): XOR 32 ไบต์แรกด้วยคีย์ 16 ไบต์ที่ได้จาก GUID (อ่านเลขฐานสิบหกของ GUID จากท้ายมาหน้า)
export function obfuscateFont(bytes, guid) {
  const hex = guid.replace(/[{}-]/g, '');
  if (!/^[0-9a-fA-F]{32}$/.test(hex)) throw new Error('GUID ของฟอนต์ไม่ถูกต้อง');
  const key = [];
  for (let i = 30; i >= 0; i -= 2) key.push(parseInt(hex.slice(i, i + 2), 16));
  const out = new Uint8Array(bytes);
  for (let i = 0; i < 32 && i < out.length; i++) out[i] ^= key[i % 16];
  return out;
}

const guidOf = (n) => `{${'A1B2C3D4-0000-4000-8000-0000000000'}${String(n).padStart(2, '0')}}`; // GUID คงที่ ให้ไฟล์เหมือนเดิมทุกครั้ง

// fonts = { regular: Uint8Array, bold?: Uint8Array } (TTF ของ Sarabun) -> ส่วนที่ต้องเพิ่มใน zip
function fontParts(fonts) {
  const slots = [['embedRegular', fonts.regular], ['embedBold', fonts.bold]].filter(([, f]) => f);
  const files = [];
  const rels = [];
  const embeds = slots.map(([tag, bytes], i) => {
    const n = i + 1;
    files.push([`word/fonts/font${n}.odttf`, obfuscateFont(bytes, guidOf(n))]);
    rels.push(`<Relationship Id="rId${n}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/font" Target="fonts/font${n}.odttf"/>`);
    return `<w:${tag} r:id="rId${n}" w:fontKey="${guidOf(n)}"/>`;
  });
  const table =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:fonts xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    `<w:font w:name="${FONT}"><w:altName w:val="${ALT_FONT}"/><w:charset w:val="DE"/><w:family w:val="swiss"/><w:pitch w:val="variable"/>${embeds.join('')}</w:font></w:fonts>`;
  const tableRels = rels.length
    ? `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>`
    : null;
  return { files, table, tableRels };
}

const settingsXml = (embed) =>
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
  `${embed ? '<w:embedTrueTypeFonts/>' : ''}<w:defaultTabStop w:val="720"/><w:themeFontLang w:val="th-TH" w:bidi="th-TH"/></w:settings>`;

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

// fonts (ไม่บังคับ) = { regular, bold } ไบต์ TTF ของ Sarabun ส่งมา = ฝังฟอนต์ลงในไฟล์ (เปิดบนเครื่องที่ไม่มีฟอนต์ก็เห็นตรงกัน)
export function buildCoverDocx(model, { fonts } = {}) {
  const f = fonts?.regular ? fontParts(fonts) : null;
  const files = [
    ['[Content_Types].xml', CONTENT_TYPES],
    ['_rels/.rels', ROOT_RELS],
    ['word/document.xml', coverDocumentXml(model)],
    ['word/_rels/document.xml.rels', DOC_RELS],
    ['word/styles.xml', STYLES],
    ['word/settings.xml', settingsXml(!!f)],
    ['word/fontTable.xml', f ? f.table : fontParts({ regular: null }).table],
  ];
  if (f) files.push(['word/_rels/fontTable.xml.rels', f.tableRels], ...f.files);
  return new Blob([zipStore(files)], { type: DOCX_MIME });
}
