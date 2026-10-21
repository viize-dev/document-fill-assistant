// ตรวจไฟล์และแปลงข้อผิดพลาดของแหล่งไฟล์ เป็นข้อความภาษาไทยที่ผู้ใช้ทำตามได้
// ไฟล์จากเมล/ไดรฟ์ถือเป็นข้อมูลที่ไม่น่าเชื่อถือ: ตรวจชนิดและขนาดก่อนส่งเข้า pipeline

export const MAX_BYTES = 20 * 1024 * 1024;

export class SourceError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code; // AUTH | PERMISSION | NOT_FOUND | RATE | SERVER | BAD_FILE | CONFIG | CANCELLED
  }
}

export function httpError(status, who) {
  if (status === 401) return new SourceError(`การเชื่อมต่อ ${who} หมดอายุ กรุณาเชื่อมต่อใหม่`, 'AUTH');
  if (status === 403) {
    return new SourceError(`ไม่มีสิทธิ์เข้าถึงข้อมูลใน ${who} (ผู้ใช้ไม่ได้อนุญาต, องค์กรปิดการเข้าถึง หรือเรียกถี่เกินกำหนด)`, 'PERMISSION');
  }
  if (status === 404) return new SourceError(`ไม่พบรายการใน ${who} (อาจถูกลบหรือย้ายไปแล้ว)`, 'NOT_FOUND');
  if (status === 429) return new SourceError(`${who} ถูกเรียกถี่เกินไป รอสักครู่แล้วลองใหม่`, 'RATE');
  if (status >= 500) return new SourceError(`${who} ขัดข้องชั่วคราว (${status}) ลองใหม่ภายหลัง`, 'SERVER');
  return new SourceError(`เรียก ${who} ไม่สำเร็จ (${status})`, 'SERVER');
}

// PDF ที่ถูกต้องมี "%PDF-" ภายใน 1024 ไบต์แรก (ตามข้อกำหนดของรูปแบบไฟล์)
export async function checkPdf(blob, maxBytes = MAX_BYTES) {
  if (blob.size > maxBytes) {
    throw new SourceError(`ไฟล์ใหญ่เกิน ${Math.round(maxBytes / 1048576)} MB (${(blob.size / 1048576).toFixed(1)} MB)`, 'BAD_FILE');
  }
  const head = new Uint8Array(await blob.slice(0, 1024).arrayBuffer());
  const text = String.fromCharCode(...head);
  if (!text.includes('%PDF-')) throw new SourceError('ไฟล์นี้ไม่ใช่ PDF ที่ถูกต้อง', 'BAD_FILE');
  return blob;
}
