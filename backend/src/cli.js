// คำสั่งบนเซิร์ฟเวอร์ (ต้องเข้าเครื่องได้ถึงจะใช้ได้): ใช้ตั้ง/กู้คืน admin เมื่อ admin เดิมเข้าไม่ได้
//   npm run admin:set -- someone@org.go.th   ตั้ง admin (ทับของเดิม และเพิกถอน session ทั้งหมด)
//   npm run admin:show                        ดู admin ปัจจุบัน
import { boot } from './bootstrap.js';

const [cmd, arg] = process.argv.slice(2);
const { runtime, db } = await boot();
try {
  if (cmd === 'admin:set') {
    if (!arg) throw new Error('ใช้: npm run admin:set -- <อีเมล>');
    runtime.setAdminEmail(arg, 'cli');
    runtime.revokeAllSessions('cli');
    console.log(`ตั้ง admin เป็น ${runtime.adminEmail()} แล้ว (session ทั้งหมดถูกเพิกถอน)`);
  } else if (cmd === 'admin:show') {
    console.log(runtime.adminEmail() || '(ยังไม่ได้กำหนด admin)');
  } else {
    throw new Error('คำสั่งที่มี: admin:set <อีเมล>, admin:show');
  }
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  db.close();
}
