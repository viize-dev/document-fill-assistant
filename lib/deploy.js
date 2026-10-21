// การติดตั้งแบบองค์กร: ถ้ามี URL ของ backend (จากนโยบายองค์กรหรือค่าตอน build ต่อลูกค้า)
// extension จะทำงานในโหมดองค์กร — ผู้ใช้ login อย่างเดียว ไม่เห็นและไม่ต้องกรอก API key (admin ตั้งที่หลังบ้าน)
// ค่าว่างทั้งหมด = โหมดเดิม (ผู้ใช้ใส่ API key เอง หรือใช้โหมดในเครื่อง)

// ค่าตอน build ต่อลูกค้า (ใส่ URL ของ backend ลูกค้ารายนั้น เช่น 'https://docfill.example.go.th')
export const DEPLOY = { backendUrl: '' };

// นโยบายองค์กรของ Chrome (chrome.storage.managed, schema: managed_schema.json) ทับค่าตอน build
export async function orgBackendUrl() {
  try {
    const managed = await chrome.storage.managed.get('backendUrl');
    if (managed?.backendUrl) return String(managed.backendUrl).replace(/\/+$/, '');
  } catch {
    // ไม่มีนโยบาย (หรืออ่านไม่ได้) ก็ใช้ค่าตอน build
  }
  return String(DEPLOY.backendUrl || '').replace(/\/+$/, '');
}
