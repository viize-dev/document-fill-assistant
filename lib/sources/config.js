// เปิด/ปิดแหล่งไฟล์ในรุ่นที่ปล่อย
// รุ่นแรก (ตามหัวหน้าทีม): มีแค่อัปโหลดเอกสาร (ไม่อยู่ในรายการนี้) แหล่งอื่นพักไว้ทั้งหมด ดู docs/PLAN-admin-backend-summary.md
// กลับมาทำ: เปิด gmail/drive หลัง Google อนุมัติ OAuth verification; msmail/msdrive หลังลงทะเบียนแอปใน Entra และใส่ client id
export const SOURCE_CONFIG = {
  enabled: { folder: false, gmail: false, drive: false, msmail: false, msdrive: false },
  // Application (client) ID ของแอปที่ลงทะเบียนใน Microsoft Entra (multi-tenant + บัญชีส่วนตัว)
  microsoftClientId: '',
};
