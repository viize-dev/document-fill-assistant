#!/usr/bin/env python3
"""สร้าง PDF หนังสือราชการ "สมมติ" ไว้ทดสอบ extension (ชื่อหน่วยงาน/เลขที่/บุคคลเป็นข้อมูลสมมติทั้งหมด)
ต้องมี Google Chrome (ใช้โหมด headless พิมพ์ HTML เป็น PDF) รัน: python3 build_samples.py
ผลลัพธ์: ไฟล์ .pdf ในโฟลเดอร์นี้ + expected.json (เฉลย)"""
import json, subprocess, sys, tempfile
from pathlib import Path

HERE = Path(__file__).parent
SRC = HERE / "src"
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

CSS = """
@page { size: A4; margin: 0; }
* { box-sizing: border-box; }
body { margin: 0; font-family: 'Thonburi','Sukhumvit Set','Ayuthaya',sans-serif; color: #111; }
.page { position: relative; width: 210mm; height: 297mm; padding: 16mm 22mm 18mm 28mm; font-size: 15px; line-height: 1.75; background: #fff; overflow: hidden; }
.emblem { width: 22mm; height: 22mm; border: 1.5px solid #333; border-radius: 50%; margin: 0 auto 4mm; display:flex; align-items:center; justify-content:center; font-size: 11px; color:#555; }
.row { display:flex; justify-content:space-between; }
.right { text-align: right; }
.center { text-align: center; }
h1 { text-align:center; font-size: 26px; margin: 2mm 0 6mm; }
p { margin: 0 0 3mm; text-indent: 14mm; text-align: justify; }
.hang { padding-left: 16mm; text-indent: -16mm; margin:0; }
.sig { margin: 14mm 0 0 80mm; text-align:center; }
.sig .line { height: 14mm; }
.stamp { position:absolute; border: 3px solid #c0201a; color:#c0201a; font-weight:700; padding: 1mm 5mm; border-radius: 3mm; transform: rotate(-4deg); font-size: 22px; }
.rcv { position:absolute; right: 18mm; top: 12mm; width: 62mm; border: 2px solid #1a3fa0; color:#1a3fa0; padding: 2mm 3mm; font-size: 13px; line-height:1.5; transform: rotate(3deg); background: rgba(255,255,255,.4); }
.rcv b { font-size: 15px; }
.eno { position:absolute; right:22mm; top:34mm; font-size:14px; }
.foot { position:absolute; left:28mm; bottom: 16mm; font-size: 13px; line-height: 1.5; }
"""

def page(inner, font=None):
    extra = f"body{{font-family:'{font}',sans-serif}}" if font else ""
    return f"<!doctype html><meta charset='utf-8'><style>{CSS}{extra}</style><body><div class='page'>{inner}</div></body>"

def letter(*, no, date, org, addr, to, subject, ref="", attach="", body, signer, role, contact, stamps="", extra="", emblem=True, font=None):
    lines = ""
    if ref: lines += f"<div class='hang'>อ้างถึง&nbsp;&nbsp;{ref}</div>"
    if attach: lines += f"<div class='hang'>สิ่งที่ส่งมาด้วย&nbsp;&nbsp;{attach}</div>"
    paras = "".join(f"<p>{x}</p>" for x in body)
    return page(f"""
      {stamps}{extra}
      {"<div class='emblem'>ตราตัวอย่าง</div>" if emblem else ""}
      <div class='row'><div>ที่ {no}</div><div class='right'>{org}<br>{addr}</div></div>
      <div class='right'>{date}</div>
      <div class='hang' style='margin-top:3mm'>เรื่อง&nbsp;&nbsp;{subject}</div>
      <div class='hang'>เรียน&nbsp;&nbsp;{to}</div>
      {lines}
      <div style='height:3mm'></div>
      {paras}
      <div class='center' style='margin-top:6mm'>ขอแสดงความนับถือ</div>
      <div class='sig'><div class='line'></div>({signer})<br>{role}</div>
      <div class='foot'>{contact}</div>""", font)

def memo(*, org, no, date, subject, to, body, signer, role, stamps=""):
    paras = "".join(f"<p>{x}</p>" for x in body)
    return page(f"""
      {stamps}
      <h1>บันทึกข้อความ</h1>
      <div><b>ส่วนราชการ</b>&nbsp;&nbsp;{org}</div>
      <div class='row' style='justify-content:flex-start;gap:16mm'><div><b>ที่</b>&nbsp;&nbsp;{no}</div><div><b>วันที่</b>&nbsp;&nbsp;{date}</div></div>
      <div><b>เรื่อง</b>&nbsp;&nbsp;{subject}</div>
      <hr style='border:0;border-top:1px solid #444;margin:2mm 0 3mm'>
      <div><b>เรียน</b>&nbsp;&nbsp;{to}</div>
      <div style='height:3mm'></div>{paras}
      <div class='sig'><div class='line'></div>({signer})<br>{role}</div>""")

DOCS = {}
EXPECTED = {}

# 1) หนังสือภายนอก พิมพ์ชัด เลขไทย เดือนเต็ม ด่วนมาก
DOCS["s1-external-clean"] = letter(
    no="ศธ 0599/๒๕๑๘", date="๑๒ สิงหาคม ๒๕๖๙", org="สำนักงานเขตพื้นที่การศึกษาตัวอย่าง เขต ๙", addr="ถนนตัวอย่าง ตำบลสมมติ อำเภอเมือง จังหวัดสมมติ ๙๙๙๙๙",
    to="ผู้อำนวยการโรงเรียนตัวอย่างวิทยา", subject="ขอเชิญเข้าร่วมประชุมชี้แจงแนวทางการจัดสรรงบประมาณ ปีงบประมาณ พ.ศ. ๒๕๗๐",
    ref="หนังสือสำนักงานเขตพื้นที่การศึกษาตัวอย่าง เขต ๙ ที่ ศธ 0599/๑๘๙๐ ลงวันที่ ๒ กรกฎาคม ๒๕๖๙",
    attach="๑. กำหนดการประชุม จำนวน ๑ ชุด &nbsp; ๒. แบบตอบรับ จำนวน ๑ ฉบับ",
    body=["ตามที่สำนักงานเขตพื้นที่การศึกษาตัวอย่าง เขต ๙ ได้แจ้งแผนการจัดสรรงบประมาณประจำปี ความละเอียดแจ้งแล้ว นั้น",
          "เพื่อให้การดำเนินงานเป็นไปด้วยความเรียบร้อย จึงขอเชิญผู้อำนวยการโรงเรียนเข้าร่วมประชุมชี้แจงแนวทางการจัดสรรงบประมาณ ในวันที่ ๒๖ สิงหาคม ๒๕๖๙ เวลา ๐๙.๐๐ น. ณ ห้องประชุมตัวอย่าง ชั้น ๒ และขอให้ส่งแบบตอบรับภายในวันที่ ๒๐ สิงหาคม ๒๕๖๙",
          "จึงเรียนมาเพื่อโปรดทราบและพิจารณาดำเนินการต่อไป"],
    signer="นายสมมติ ตัวอย่างดี", role="ผู้อำนวยการสำนักงานเขตพื้นที่การศึกษาตัวอย่าง เขต ๙",
    contact="กลุ่มบริหารงานการเงินและสินทรัพย์<br>โทร. ๐-๐๐๐๐-๐๐๐๐ &nbsp; โทรสาร ๐-๐๐๐๐-๐๐๐๑",
    stamps="<div class='stamp' style='left:28mm;top:8mm'>ด่วนมาก</div>")
EXPECTED["s1-external-clean"] = dict(doc_type="external", doc_no="ศธ 0599/2518", doc_date="12/08/2569",
    **{"from": "สำนักงานเขตพื้นที่การศึกษาตัวอย่าง เขต 9"}, to="ผู้อำนวยการโรงเรียนตัวอย่างวิทยา",
    subject="ขอเชิญเข้าร่วมประชุมชี้แจงแนวทางการจัดสรรงบประมาณ ปีงบประมาณ พ.ศ. 2570", speed="very_urgent", secret="normal")

# 2) บันทึกข้อความ วันที่ย่อ
DOCS["s2-internal-memo"] = memo(
    org="กลุ่มงานบริหารทั่วไป สำนักงานตัวอย่าง โทร. ๐-๐๐๐๐-๑๑๑๑", no="บท 0012/๑๔๕", date="๕ ส.ค. ๒๕๖๙",
    subject="ขออนุมัติจัดซื้อวัสดุสำนักงาน ประจำไตรมาสที่ ๔", to="ผู้อำนวยการสำนักงานตัวอย่าง",
    body=["ด้วยกลุ่มงานบริหารทั่วไปมีความจำเป็นต้องจัดซื้อวัสดุสำนักงานเพื่อใช้ในการปฏิบัติงานประจำไตรมาสที่ ๔ เป็นเงินทั้งสิ้น ๑๕,๐๐๐ บาท (หนึ่งหมื่นห้าพันบาทถ้วน)",
          "จึงเรียนมาเพื่อโปรดพิจารณาอนุมัติ"],
    signer="นางสาวสมมติ ใจตัวอย่าง", role="หัวหน้ากลุ่มงานบริหารทั่วไป")
EXPECTED["s2-internal-memo"] = dict(doc_type="internal", doc_no="บท 0012/145", doc_date="05/08/2569",
    **{"from": "กลุ่มงานบริหารทั่วไป สำนักงานตัวอย่าง"}, to="ผู้อำนวยการสำนักงานตัวอย่าง",
    subject="ขออนุมัติจัดซื้อวัสดุสำนักงาน ประจำไตรมาสที่ 4", speed="normal", secret="normal")

# 3) หนังสือเวียน เลขอารบิก ด่วนที่สุด + ลับ
DOCS["s3-circular"] = letter(
    no="มท 0808.2/ว 4567", date="20 กันยายน 2569", org="กรมส่งเสริมตัวอย่าง กระทรวงสมมติ", addr="ถนนตัวอย่าง เขตสมมติ กรุงเทพมหานคร 10999",
    to="ผู้ว่าราชการจังหวัดทุกจังหวัด", subject="การป้องกันและแก้ไขปัญหาอุทกภัยในช่วงฤดูฝน",
    attach="แนวทางปฏิบัติ จำนวน 1 ฉบับ",
    body=["ด้วยในช่วงฤดูฝนของปีนี้ คาดว่าจะมีปริมาณน้ำฝนสูงกว่าค่าเฉลี่ยในหลายพื้นที่ อาจส่งผลให้เกิดอุทกภัยและน้ำท่วมฉับพลัน",
          "กรมส่งเสริมตัวอย่างจึงขอให้จังหวัดแจ้งองค์กรปกครองส่วนท้องถิ่นในพื้นที่ดำเนินการตามแนวทางปฏิบัติที่แนบมาพร้อมนี้ และรายงานผลให้กรมทราบภายในวันที่ 10 ตุลาคม 2569",
          "จึงเรียนมาเพื่อโปรดทราบและพิจารณาดำเนินการ"],
    signer="นายสมมติ ตัวอย่างยิ่ง", role="อธิบดีกรมส่งเสริมตัวอย่าง", contact="กองสมมติ โทร. 0-0000-2222",
    stamps="<div class='stamp' style='left:28mm;top:8mm'>ด่วนที่สุด</div><div class='stamp' style='left:80mm;top:8mm;transform:rotate(2deg)'>ลับ</div>")
EXPECTED["s3-circular"] = dict(doc_type="circular", doc_no="มท 0808.2/ว 4567", doc_date="20/09/2569",
    **{"from": "กรมส่งเสริมตัวอย่าง กระทรวงสมมติ"}, to="ผู้ว่าราชการจังหวัดทุกจังหวัด",
    subject="การป้องกันและแก้ไขปัญหาอุทกภัยในช่วงฤดูฝน", speed="most_urgent", secret="secret")

# 4) หนังสือภายนอก (เนื้อหาคนละฉบับ) แล้วทำให้เหมือนสแกน — ดูขั้นตอนด้านล่าง
SCAN_BASE = letter(
    no="สธ 0201.032/๑๑๗๗", date="๓๐ เมษายน ๒๕๖๙", org="สำนักงานสาธารณสุขจังหวัดสมมติ", addr="ถนนตัวอย่าง ตำบลสมมติ จังหวัดสมมติ ๘๘๘๘๘",
    to="นายแพทย์สาธารณสุขจังหวัดสมมติ", subject="ขอความอนุเคราะห์ข้อมูลผู้ป่วยโรคติดต่อรายสัปดาห์",
    ref="หนังสือกรมควบคุมโรคตัวอย่าง ที่ สธ ๐๔๐๓/ว ๙๒๑ ลงวันที่ ๑๕ เมษายน ๒๕๖๙",
    body=["ตามหนังสือที่อ้างถึง กรมควบคุมโรคตัวอย่างได้ขอให้จังหวัดรายงานข้อมูลผู้ป่วยโรคติดต่อรายสัปดาห์ นั้น",
          "สำนักงานสาธารณสุขจังหวัดสมมติจึงขอความอนุเคราะห์ให้ส่งข้อมูลดังกล่าวภายในวันศุกร์ของทุกสัปดาห์ ผ่านระบบรายงานอิเล็กทรอนิกส์",
          "จึงเรียนมาเพื่อโปรดพิจารณา"],
    signer="นายสมมติ ดีเลิศ", role="สาธารณสุขจังหวัดสมมติ", contact="กลุ่มงานควบคุมโรค โทร. ๐-๐๐๐๐-๓๓๓๓")
EXPECTED["s4-external-scan"] = dict(doc_type="external", doc_no="สธ 0201.032/1177", doc_date="30/04/2569",
    **{"from": "สำนักงานสาธารณสุขจังหวัดสมมติ"}, to="นายแพทย์สาธารณสุขจังหวัดสมมติ",
    subject="ขอความอนุเคราะห์ข้อมูลผู้ป่วยโรคติดต่อรายสัปดาห์", speed="normal", secret="normal")

# 5) ฉบับหลอก: มีตราประทับรับ (เลขรับ + วันที่รับ) ที่ต้องไม่เอามาเป็นเลขที่หนังสือ/วันที่หนังสือ
DOCS["s5-received-stamp"] = letter(
    no="อว 0605.1/๖๐๒", date="๘ กรกฎาคม ๒๕๖๙", org="มหาวิทยาลัยตัวอย่าง", addr="ถนนตัวอย่าง ตำบลสมมติ จังหวัดสมมติ ๗๗๗๗๗",
    to="อธิบดีกรมส่งเสริมตัวอย่าง", subject="ขอเชิญเป็นวิทยากรในโครงการอบรมเชิงปฏิบัติการ",
    ref="หนังสือกรมส่งเสริมตัวอย่าง ที่ มท ๐๘๐๘.๒/ว ๑๒๓๔ ลงวันที่ ๑ มิถุนายน ๒๕๖๙ &nbsp;และ&nbsp; ที่ มท ๐๘๐๘.๒/ว ๑๓๐๐ ลงวันที่ ๑๐ มิถุนายน ๒๕๖๙",
    attach="โครงการอบรมเชิงปฏิบัติการ จำนวน ๑ ชุด",
    body=["มหาวิทยาลัยตัวอย่างขอเชิญผู้แทนของกรมส่งเสริมตัวอย่างเป็นวิทยากรในโครงการอบรมเชิงปฏิบัติการ ในวันที่ ๒๐ กรกฎาคม ๒๕๖๙ ณ ห้องประชุมตัวอย่าง",
          "จึงเรียนมาเพื่อโปรดพิจารณา"],
    signer="ผู้ช่วยศาสตราจารย์สมมติ ตัวอย่างเด่น", role="รองอธิการบดีมหาวิทยาลัยตัวอย่าง", contact="คณะสมมติ โทร. ๐-๐๐๐๐-๔๔๔๔",
    extra="<div class='rcv'><b>กรมส่งเสริมตัวอย่าง</b><br>เลขรับ <b>๔๕๘</b><br>วันที่ ๑๔ ก.ค. ๖๙ เวลา ๑๐.๓๐ น.</div>"
          "<div class='eno'>เลขที่เอกสารในระบบ <span style='font-size:20px'>E</span> <u>กษ0100/๗๕๖๒</u></div>")
EXPECTED["s5-received-stamp"] = dict(doc_type="external", doc_no="อว 0605.1/602", doc_date="08/07/2569",
    **{"from": "มหาวิทยาลัยตัวอย่าง"}, to="อธิบดีกรมส่งเสริมตัวอย่าง",
    subject="ขอเชิญเป็นวิทยากรในโครงการอบรมเชิงปฏิบัติการ", speed="normal", secret="normal")


# ---------------------------------------------------------------------------
# ชุด "held-out": สร้างหลังจากปรับตัวแยกฟิลด์แบบกฎกับ s1-s5 แล้ว เพื่อวัดว่าใช้กับเอกสารอื่นได้จริงไหม
# (ฟอนต์ต่างกัน โครงหน้าต่างกัน) ห้ามปรับกฎให้ผ่านชุดนี้โดยไม่บันทึกว่าไม่ใช่ held-out อีกต่อไป
# ---------------------------------------------------------------------------

# h1) ฟอนต์ Sathu, เรื่องยาวขึ้นสองบรรทัด, ไม่มีอ้างถึง/สิ่งที่ส่งมาด้วย/ตราประทับ
DOCS["h1-wrapped-subject"] = letter(
    font="Sathu", no="ทส 0301/๓๓๒๑", date="๑๗ มิถุนายน ๒๕๖๙", org="สำนักงานทรัพยากรธรรมชาติและสิ่งแวดล้อมจังหวัดสมมติ", addr="ถนนตัวอย่าง จังหวัดสมมติ ๖๖๖๖๖",
    to="นายอำเภอทุกอำเภอ และนายกองค์การบริหารส่วนจังหวัดสมมติ",
    subject="ขอความร่วมมือประชาสัมพันธ์โครงการคัดแยกขยะมูลฝอยในครัวเรือนและชุมชน เพื่อลดปริมาณขยะต้นทาง ประจำปีงบประมาณ พ.ศ. ๒๕๗๐",
    body=["ด้วยสำนักงานทรัพยากรธรรมชาติและสิ่งแวดล้อมจังหวัดสมมติมีโครงการคัดแยกขยะมูลฝอยในครัวเรือนและชุมชน", "จึงเรียนมาเพื่อโปรดประชาสัมพันธ์ให้ประชาชนทราบโดยทั่วกัน"],
    signer="นายสมมติ รักษ์โลก", role="ทรัพยากรธรรมชาติและสิ่งแวดล้อมจังหวัดสมมติ", contact="กลุ่มงานสิ่งแวดล้อม โทร. ๐-๐๐๐๐-๕๕๕๕")
EXPECTED["h1-wrapped-subject"] = dict(doc_type="external", doc_no="ทส 0301/3321", doc_date="17/06/2569",
    **{"from": "สำนักงานทรัพยากรธรรมชาติและสิ่งแวดล้อมจังหวัดสมมติ"}, to="นายอำเภอทุกอำเภอ และนายกองค์การบริหารส่วนจังหวัดสมมติ",
    subject="ขอความร่วมมือประชาสัมพันธ์โครงการคัดแยกขยะมูลฝอยในครัวเรือนและชุมชน เพื่อลดปริมาณขยะต้นทาง ประจำปีงบประมาณ พ.ศ. 2570", speed="normal", secret="normal")

# h2) บันทึกข้อความ ฟอนต์ Ayuthaya: ที่/วันที่ อยู่ในบรรทัดเดียวติดกัน, ส่วนราชการยาวสองบรรทัด
DOCS["h2-memo-inline"] = page("""
      <h1>บันทึกข้อความ</h1>
      <div><b>ส่วนราชการ</b> ฝ่ายแผนงานและงบประมาณ กองนโยบายและแผน สำนักงานปลัดกระทรวงสมมติ ถนนตัวอย่าง โทร. ๐-๐๐๐๐-๖๖๖๖ ต่อ ๑๒๓</div>
      <div><b>ที่</b> สม 0105/๘๘๑ <b>วันที่</b> ๒๐ กันยายน ๒๕๖๙</div>
      <div><b>เรื่อง</b> รายงานผลการเบิกจ่ายงบประมาณ ไตรมาสที่ ๓</div>
      <hr style='border:0;border-top:1px solid #444;margin:2mm 0 3mm'>
      <div><b>เรียน</b> ปลัดกระทรวงสมมติ</div>
      <div style='height:3mm'></div>
      <p>ตามที่ได้มอบหมายให้ติดตามการเบิกจ่ายงบประมาณ ขอรายงานผลการเบิกจ่ายไตรมาสที่ ๓ ดังเอกสารแนบ</p>
      <p>จึงเรียนมาเพื่อโปรดทราบ</p>
      <div class='sig'><div class='line'></div>(นายสมมติ คำนวณดี)<br>ผู้อำนวยการกองนโยบายและแผน</div>""", font="Ayuthaya")
EXPECTED["h2-memo-inline"] = dict(doc_type="internal", doc_no="สม 0105/881", doc_date="20/09/2569",
    **{"from": "ฝ่ายแผนงานและงบประมาณ กองนโยบายและแผน สำนักงานปลัดกระทรวงสมมติ ถนนตัวอย่าง"}, to="ปลัดกระทรวงสมมติ",
    subject="รายงานผลการเบิกจ่ายงบประมาณ ไตรมาสที่ 3", speed="normal", secret="normal")

# h3) หนังสือเวียน ฟอนต์ Sukhumvit Set: เนื้อหามีคำว่า "ด่วน" และ "ลับ" แต่ไม่มีตราประทับ (ต้องไม่ตีความเป็นชั้นความเร็ว/ลับ)
DOCS["h3-words-not-stamps"] = letter(
    font="Sukhumvit Set", no="กษ 0210/ว ๑๒๐๐", date="3 พฤศจิกายน 2569", org="กรมวิชาการเกษตรตัวอย่าง", addr="ถนนตัวอย่าง จังหวัดสมมติ 55555",
    to="เกษตรจังหวัดทุกจังหวัด", subject="แนวทางการดำเนินงานตามโครงการส่งเสริมเกษตรกรรุ่นใหม่",
    attach="1. แนวทางการดำเนินงาน &nbsp; 2. แบบรายงาน",
    body=["กรมวิชาการเกษตรตัวอย่างขอแจ้งว่าการดำเนินงานตามโครงการนี้เป็นเรื่องด่วน ขอให้จังหวัดเร่งรัดดำเนินการ และขอให้รักษาข้อมูลเกษตรกรเป็นความลับตามกฎหมายคุ้มครองข้อมูลส่วนบุคคล",
          "จึงเรียนมาเพื่อโปรดทราบและแจ้งหน่วยงานที่เกี่ยวข้อง"],
    signer="นายสมมติ เกษตรดี", role="อธิบดีกรมวิชาการเกษตรตัวอย่าง", contact="กองส่งเสริม โทร. 0-0000-7777")
EXPECTED["h3-words-not-stamps"] = dict(doc_type="circular", doc_no="กษ 0210/ว 1200", doc_date="03/11/2569",
    **{"from": "กรมวิชาการเกษตรตัวอย่าง"}, to="เกษตรจังหวัดทุกจังหวัด",
    subject="แนวทางการดำเนินงานตามโครงการส่งเสริมเกษตรกรรุ่นใหม่", speed="normal", secret="normal")

# h4) หนังสือภายนอก โครงหัวกระดาษต่างออกไป: เลขที่อยู่บรรทัดเดียวลำพัง ชื่อหน่วยงานอยู่กึ่งกลางใต้ตรา
DOCS["h4-centered-header"] = page("""
      <div class='emblem'>ตราตัวอย่าง</div>
      <div class='center' style='font-weight:700'>สำนักงานศาลตัวอย่างจังหวัดสมมติ</div>
      <div class='center'>ถนนตัวอย่าง ตำบลสมมติ จังหวัดสมมติ ๕๕๕๕๕</div>
      <div style='height:3mm'></div>
      <div>ที่ ศท 0042/๗๗๑</div>
      <div class='right'>๒๘ กุมภาพันธ์ ๒๕๖๙</div>
      <div class='hang'>เรื่อง&nbsp;&nbsp;ขอส่งสำเนาคำสั่งแต่งตั้งคณะกรรมการ</div>
      <div class='hang'>เรียน&nbsp;&nbsp;ผู้อำนวยการสำนักงานตัวอย่าง</div>
      <div style='height:3mm'></div>
      <p>ตามที่ได้มีคำสั่งแต่งตั้งคณะกรรมการ จึงขอส่งสำเนาคำสั่งมาเพื่อทราบ</p>
      <p>จึงเรียนมาเพื่อโปรดทราบ</p>
      <div class='center' style='margin-top:6mm'>ขอแสดงความนับถือ</div>
      <div class='sig'><div class='line'></div>(นายสมมติ ยุติธรรม)<br>ผู้พิพากษาหัวหน้าศาลตัวอย่าง</div>""", font="Thonburi")
EXPECTED["h4-centered-header"] = dict(doc_type="external", doc_no="ศท 0042/771", doc_date="28/02/2569",
    **{"from": "สำนักงานศาลตัวอย่างจังหวัดสมมติ"}, to="ผู้อำนวยการสำนักงานตัวอย่าง",
    subject="ขอส่งสำเนาคำสั่งแต่งตั้งคณะกรรมการ", speed="normal", secret="normal")

# เลข E ของสารบรรณ: เฉลยเป็นค่าว่างยกเว้นฉบับที่มีตราประทับ (ต้องว่างไว้เมื่อไม่มี)
for _name, _exp in EXPECTED.items():
    _exp["e_no"] = ""
EXPECTED["s5-received-stamp"]["e_no"] = "กษ0100/7562"

def chrome(*args):
    cmd = [CHROME, "--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars", f"--user-data-dir={tempfile.mkdtemp()}", *args]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    return r

def to_pdf(html_path: Path, out: Path):
    chrome("--no-pdf-header-footer", f"--print-to-pdf={out}", html_path.as_uri())
    if not out.exists() or out.stat().st_size < 500: sys.exit(f"สร้าง {out.name} ไม่สำเร็จ")

SCAN_CSS = """
html,body{margin:0;background:#cfcfc8}
.sheet{position:absolute;left:30px;top:20px;width:794px;height:1123px;transform:rotate(1.3deg);transform-origin:50% 50%;
  filter:grayscale(1) contrast(1.18) brightness(.97) blur(.55px);box-shadow:0 0 18px rgba(0,0,0,.45);background:#f4f3ee}
.grain{position:absolute;inset:0;pointer-events:none;mix-blend-mode:multiply;opacity:.28;
  background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='300' height='300'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2'/><feColorMatrix values='0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 .9 0'/></filter><rect width='300' height='300' filter='url(%23n)'/></svg>")}
"""

def main():
    SRC.mkdir(exist_ok=True)
    for name, html in DOCS.items():
        p = SRC / f"{name}.html"; p.write_text(html, encoding="utf-8")
        to_pdf(p, HERE / f"{name}.pdf")
        print("OK", name)
    # สแกนจำลอง: เอียง + ขาวดำ + เกรน + เงา แล้วแปลงเป็นภาพ ก่อนใส่ใน PDF (ไม่มีข้อความให้ดึงตรงๆ)
    base = SRC / "s4-base.html"; base.write_text(SCAN_BASE, encoding="utf-8")
    scan = SRC / "s4-scan.html"
    inner = SCAN_BASE.split("<body>")[1].split("</body>")[0]
    scan.write_text(f"<!doctype html><meta charset='utf-8'><style>{CSS}{SCAN_CSS}</style><body style='width:900px;height:1180px;overflow:hidden'><div class='sheet'>{inner}<div class='grain'></div></div></body>", encoding="utf-8")
    png = SRC / "s4-scan.png"
    chrome("--force-device-scale-factor=2", "--window-size=900,1180", f"--screenshot={png}", scan.as_uri())
    if not png.exists(): sys.exit("ถ่ายภาพสแกนจำลองไม่สำเร็จ")
    img = SRC / "s4-img.html"
    img.write_text("<!doctype html><meta charset='utf-8'><style>@page{size:A4;margin:0}html,body{margin:0}img{display:block;width:210mm;height:277.3mm;object-fit:cover;object-position:50% 0}</style>"
                   f"<body><img src='{png.name}'></body>", encoding="utf-8")
    to_pdf(img, HERE / "s4-external-scan.pdf"); print("OK s4-external-scan (image-only)")
    (HERE / "expected.json").write_text(json.dumps(EXPECTED, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("เขียน expected.json แล้ว")

if __name__ == "__main__": main()
