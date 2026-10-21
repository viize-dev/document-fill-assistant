import { parseThaiGov } from './thai-gov.js';

// profile.localParser = ชื่อตัวแยกฟิลด์แบบกฎ (เพิ่มตัวใหม่ได้โดยไม่แก้ core)
export const PARSERS = { 'thai-gov': parseThaiGov };
