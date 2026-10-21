# doc-fill-backend

Backend กลางของ Document Fill Assistant: ผู้ใช้ login ด้วยบัญชีองค์กร (Google Workspace / Microsoft 365) แล้วเรียก AI ผ่านระบบนี้ **โดยไม่ต้องมี API key** — key ของผู้ให้บริการ AI อยู่ฝั่งเซิร์ฟเวอร์เท่านั้น

## ทำอะไรบ้าง

- ตรวจ ID token จาก OIDC (RS256, issuer, audience, nonce, หมดอายุ, อีเมลยืนยันแล้ว) แล้วอนุญาตเฉพาะโดเมน/อีเมลที่กำหนด
- ออก session token ของตัวเอง (HS256, อายุ 8 ชม. ปรับได้)
- รับ PDF + prompt → ส่งต่อไปค่าย AI ที่ตั้งไว้ (Claude / OpenAI / Gemini) → คืนข้อความ
- โควต้ารายเดือนต่อผู้ใช้ + rate limit ต่อนาที + จำกัดขนาดไฟล์/prompt + ตรวจว่าเป็น PDF จริง
- บันทึกการใช้งาน (ใคร เมื่อไร โมเดลไหน token เท่าไร) ลง SQLite; `GET /admin/usage` สำหรับผู้ดูแล
- **ไม่เก็บเนื้อหาเอกสารและผลลัพธ์** เก็บเฉพาะ metadata การใช้งาน

## หน้า admin (ตั้งค่า API key และอื่นๆ)

ผู้ใช้ทั่วไปไม่เห็นและไม่ต้องกรอก API key: **admin คนเดียว** ตั้งค่าที่ `https://<backend>/admin`

| หมวด | ทำอะไรได้ |
|---|---|
| ผู้ให้บริการ AI / key | ใส่ key ของ Claude / OpenAI / Gemini, ทดสอบ key, ลบ, เลือกค่ายที่ใช้ (key เข้ารหัส AES-256-GCM, ไม่ส่งกลับมาแสดง เห็นแค่ 4 ตัวท้าย) |
| โมเดล | เลือกโมเดลที่เปิดให้ใช้ + โมเดลเริ่มต้น (กด "ทดสอบ key" เพื่อโหลดรายการล่าสุดจากค่าย) |
| โควต้า | ต่อผู้ใช้/เดือน, ต่อนาที, ขนาด PDF สูงสุด |
| สิทธิ์เข้าใช้ | โดเมน/อีเมลที่อนุญาต, ระงับบัญชี (มีผลทันที) |
| ฟีเจอร์ | เปิด/ปิดสรุปเอกสารสำหรับใบปะหน้า |
| รายงาน / audit | การใช้งานต่อผู้ใช้, ใครเปลี่ยนอะไรเมื่อไร (ไม่มีค่าความลับ) |
| ความปลอดภัย | เพิกถอน session ของผู้ใช้ทั้งหมด |

**ตั้งค่าครั้งแรก**
1. ตั้งใน `.env`: `JWT_SECRET`, `MASTER_KEY` (`openssl rand -hex 32` **สำรองไว้ที่ปลอดภัย**), client secret ของ OIDC (`GOOGLE_CLIENT_SECRET` ฯลฯ)
2. ตั้งใน `config.json`: `adminEmail`, `publicUrl` (https), `adminLogin: { "provider": "google" }` และ `tokenUrl` + `clientSecretEnv` ของ oidc รายการนั้น
3. ที่ IdP ลงทะเบียน redirect URI เพิ่ม `https://<backend>/admin/callback` (ชนิด Web application: ต้องมี client secret) นอกเหนือจาก `https://<EXTENSION_ID>.chromiumapp.org/` ของ extension
4. ส่งออก profile จาก extension: `cd .. && node scripts/export-profiles.mjs backend/profiles`
5. เข้า `/admin` → login → ใส่ API key

**admin คนเดียว:** กำหนดด้วย `adminEmail` (หรือ `npm run admin:set -- someone@org.go.th`) บัญชีอื่นแม้อยู่ในโดเมนก็เข้าหน้านี้ไม่ได้ ถ้า admin เข้าไม่ได้ (ลาออก/ลืม/IdP ล่ม) ใช้คำสั่งนี้บนเซิร์ฟเวอร์เพื่อกู้คืน (ต้องเข้าเครื่องได้) ⚠ ควรมีขั้นตอนส่งต่อ admin ในองค์กร

**ความปลอดภัยของหน้า admin:** คุกกี้ HttpOnly + SameSite=Strict (Secure เมื่อ https), หมดอายุเมื่อไม่ใช้งาน 30 นาที และไม่เกิน 8 ชม. จาก login, CSRF header + ตรวจ Origin, CSP แบบ nonce, กัน iframe, จำกัดความถี่ login, ตรวจสิทธิ์ admin ที่ฝั่งเซิร์ฟเวอร์ทุกคำขอ (เปลี่ยน admin แล้วคุกกี้เดิมใช้ไม่ได้)

## เริ่มใช้งาน

```sh
npm install
cp config.example.json config.json   # แก้ให้ตรงกับองค์กร
cp .env.example .env                  # ใส่ JWT_SECRET และ API key ของค่ายที่ใช้
npm start
npm test                              # 24 ข้อ ไม่ต้องใช้เครือข่ายจริง
```

ต้องใช้ Node >= 22.13 (ใช้ `node:sqlite` ในตัว ไม่ต้องติดตั้งไดรเวอร์) ถ้าตั้งค่าไม่ปลอดภัย (secret สั้น, ไม่มี key, ไม่จำกัดโดเมน ฯลฯ) server จะไม่ยอมเริ่มและบอกเหตุผล

## ตั้งค่า login ด้วยบัญชีองค์กร

ใช้ OIDC แบบ implicit (`response_type=id_token`) ผ่าน `chrome.identity.launchWebAuthFlow` ของ extension

Redirect URI ที่ต้องลงทะเบียนคือ `https://<EXTENSION_ID>.chromiumapp.org/` (ดู Extension ID ที่ `chrome://extensions`)

**Google Workspace**
1. Google Cloud Console → APIs & Services → Credentials → OAuth client ชนิด **Web application**
2. Authorized redirect URI ใส่ค่าข้างบน
3. นำ Client ID ใส่ `oidc[].clientId`, `allowedDomains` ใส่โดเมนองค์กร

**Microsoft 365 (Entra ID)**
1. App registrations → New → platform **Single-page application** (หรือ Web) ใส่ redirect URI ข้างบน
2. Authentication → เปิด **ID tokens (implicit)**
3. ใส่ Application (client) ID, และ Tenant ID ใน `issuer` / `jwksUri` / `authUrl` (ดู `config.example.json`)

## API

| Method | Path | สิทธิ์ | หน้าที่ |
|---|---|---|---|
| GET | `/health` | สาธารณะ | ตรวจสถานะ |
| GET | `/config` | สาธารณะ | วิธี login, โมเดลที่เปิดใช้ (ไม่มีความลับ) |
| POST | `/auth/oidc` | สาธารณะ | แลก ID token เป็น session token |
| GET | `/me` | ผู้ใช้ | ข้อมูลผู้ใช้ + โควต้าเดือนนี้ |
| POST | `/v1/extract` | ผู้ใช้ | `{ pdf_base64, profile_id, model? }` → `{ text, model, usage }` — **prompt สร้างฝั่งเซิร์ฟเวอร์จาก profile** (ส่ง `prompt` เองได้เฉพาะเมื่อเปิด `allowClientPrompt`) |
| GET | `/admin` | สาธารณะ (หน้า login) | หน้า admin |
| GET/PUT/POST/DELETE | `/admin/api/*` | admin (คุกกี้) | state, settings, keys, usage, audit, sessions/revoke |
| POST | `/auth/dev` | เฉพาะ `devAuth` | login ทดสอบ (ห้ามเปิดใน production — server จะไม่ยอมเริ่ม) |

## Deploy

```sh
docker build -t doc-fill-backend .
docker run -p 8787:8787 --env-file .env -v $PWD/config.json:/app/config.json:ro -v docfill-data:/app/data doc-fill-backend
```

ต้องอยู่หลัง HTTPS (extension ปฏิเสธ backend ที่ไม่ใช่ https ยกเว้น localhost) เช่น Caddy หรือ load balancer ของคลาวด์

## ข้อจำกัดที่ควรรู้

- **ขายแบบ single-tenant:** 1 องค์กร = 1 deployment/config ยังไม่มีหลายองค์กรใน instance เดียว
- **Rate limit อยู่ในหน่วยความจำ** ใช้ได้กับ instance เดียว (ถ้าจะ scale หลายตัวต้องย้ายไป Redis) โควต้ารายเดือนอยู่ในฐานข้อมูลจึงถูกต้องแม้ restart
- **profile ต้องซิงก์กับ extension:** `src/prompt.js` เป็นสำเนาของ `buildPrompt` ใน extension และ `profiles/*.json` ส่งออกจาก extension (`../scripts/export-profiles.mjs`) ถ้าแก้ฝั่ง extension ต้องส่งออก/คัดลอกใหม่ (มีเทสต์เทียบผลลัพธ์ใน test/org-mode.test.mjs (รากของ repo))
- ยังไม่มีการคิดเงินต่อผู้ใช้ และ audit ยังไม่ละเอียดระดับรายคำขอ (ไม่เก็บเนื้อหาเอกสารโดยตั้งใจ)
- **หน้า admin และ login admin ยังไม่ได้ทดสอบกับ IdP จริง** (ทดสอบด้วย IdP จำลอง + เบราว์เซอร์ด้วย devAuth)
- API key ที่ admin ตั้งอยู่ในฐานข้อมูลแบบเข้ารหัส: ถ้า `MASTER_KEY` หาย ต้องตั้ง key ใหม่ และ rate limit/คุกกี้ login ยังอยู่ในหน่วยความจำ (instance เดียว)
- **ยังไม่ได้ทดสอบกับ Google/Microsoft จริง และไม่ได้เรียกค่าย AI จริง** ทดสอบด้วยกุญแจ RSA จำลองและ upstream จำลอง
- Token ที่ใช้ (`input`/`output`) เป็นข้อมูลจากค่ายต้นทาง ใช้ประมาณค่าใช้จ่ายได้ แต่ไม่ใช่ใบแจ้งหนี้
