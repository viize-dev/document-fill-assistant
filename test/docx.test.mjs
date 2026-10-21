// รัน: node --test "test/*.test.mjs"
import test from 'node:test';
import assert from 'node:assert/strict';
import { crc32, zipStore, coverDocumentXml, buildCoverDocx, obfuscateFont } from '../lib/docx.js';

const model = {
  eNoLabel: 'เลขที่เอกสารในระบบ E', eNo: 'กษ0100/7562',
  unit: 'ส่วนบริหารทั่วไป', receiptLabel: 'รับที่', receiptNo: 'ว1234', dateLabel: 'วันที่', date: '21 ตุลาคม 2569',
  subjectLabel: 'เรื่อง', subject: 'การขอรับการสนับสนุน <b>งบ</b> & "ทดสอบ"\u0000',
  routeLabel: 'เรียน', route: 'ผส.ชป.2',
  options: [{ label: 'เพื่อโปรดพิจารณา', checked: true }, { label: 'เพื่อโปรดดำเนินการ', checked: true }, { label: 'เพื่อโปรดทราบ', checked: false }],
  dueLabel: 'วันที่กำหนด', due: '7 กรกฎาคม 2569', summary: 'สรุป\nสองบรรทัด',
  noteLabel: 'หมายเหตุ', note: '', footerLabel: '', lines: 10,
};

test('crc32 ตรงกับค่ามาตรฐาน', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('XML: escape ข้อความที่ผู้ใช้กรอก ไม่ให้แทรกแท็ก และตัดอักขระควบคุม', () => {
  const xml = coverDocumentXml(model);
  assert.ok(!xml.includes('<b>งบ'), 'ต้องไม่มีแท็กจากข้อความ');
  assert.ok(xml.includes('&lt;b&gt;งบ&lt;/b&gt; &amp; &quot;ทดสอบ&quot;'));
  assert.ok(!/[\u0000-\u0008]/.test(xml));
});

test('XML: ช่องติ๊กตามค่า checked และขึ้นบรรทัดใหม่ในสรุป', () => {
  const xml = coverDocumentXml(model);
  assert.equal((xml.match(/w14:checked w14:val="1"/g) || []).length, 2);
  assert.equal((xml.match(/w14:checked w14:val="0"/g) || []).length, 1);
  assert.ok(xml.includes('<w:br/>'));
  assert.equal((xml.match(/w:leader="underscore"/g) || []).length, 10, 'เส้นเขียนความเห็น 10 บรรทัด');
});

test('ZIP: โครงสร้างไฟล์ docx ครบ และอ่านกลับได้', async () => {
  const blob = buildCoverDocx(model);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  const text = Buffer.from(bytes).toString('latin1');
  for (const name of ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/styles.xml', 'word/settings.xml', 'word/fontTable.xml']) assert.ok(text.includes(name), name);
  // EOCD: จำนวนรายการ 7 (ไม่ฝังฟอนต์)
  const eocd = bytes.length - 22;
  assert.equal(bytes[eocd + 10], 7);
  assert.ok(!text.includes('word/fonts/'), 'ไม่ส่งฟอนต์มา = ไม่ฝัง');
  assert.equal(zipStore([['a.txt', 'x']]).length > 0, true);
});

test('ฟอนต์ฝัง: obfuscate แล้วย้อนกลับได้ (XOR 32 ไบต์แรก ไม่แตะส่วนที่เหลือ) และ GUID ผิดถูกปฏิเสธ', () => {
  const font = new Uint8Array(100).map((_, i) => i + 1);
  const guid = '{00112233-4455-6677-8899-AABBCCDDEEFF}';
  const ob = obfuscateFont(font, guid);
  // คีย์ = ไบต์ของ GUID อ่านจากท้าย: FF EE DD CC BB AA 99 88 77 66 55 44 33 22 11 00
  assert.equal(ob[0], 1 ^ 0xff);
  assert.equal(ob[1], 2 ^ 0xee);
  assert.equal(ob[16], 17 ^ 0xff, 'ไบต์ 16-31 ใช้คีย์ชุดเดิมซ้ำ');
  assert.deepEqual([...ob.slice(32)], [...font.slice(32)]);
  assert.deepEqual([...obfuscateFont(ob, guid)], [...font]);
  assert.notDeepEqual([...ob.slice(0, 32)], [...font.slice(0, 32)]);
  assert.throws(() => obfuscateFont(font, 'ไม่ใช่ guid'), /GUID/);
});

test('ส่งฟอนต์มา: ไฟล์มี fontTable ที่ฝังฟอนต์ + .odttf + relationship + ตั้ง embedTrueTypeFonts', async () => {
  const fake = new Uint8Array(500).fill(7);
  const bytes = new Uint8Array(await buildCoverDocx(model, { fonts: { regular: fake, bold: fake } }).arrayBuffer());
  const text = Buffer.from(bytes).toString('latin1');
  for (const name of ['word/fonts/font1.odttf', 'word/fonts/font2.odttf', 'word/_rels/fontTable.xml.rels']) assert.ok(text.includes(name), name);
  assert.ok(text.includes('w:embedRegular') && text.includes('w:embedBold') && text.includes('w:fontKey'));
  assert.ok(text.includes('embedTrueTypeFonts'));
  assert.equal(bytes[bytes.length - 22 + 10], 10);
});
