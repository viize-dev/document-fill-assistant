import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const monthOf = (iso) => iso.slice(0, 7); // YYYY-MM (UTC)

export function openDb(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE IF NOT EXISTS usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      month TEXT NOT NULL,
      email TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      status TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      pdf_bytes INTEGER NOT NULL DEFAULT 0,
      ms INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS usage_user_month ON usage (email, month);
    -- ค่าที่ admin ตั้งผ่านหน้าเว็บ (ทับค่าใน config.json)
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      updated_by TEXT NOT NULL
    );
    -- API key ของค่าย AI (เข้ารหัสแล้ว; last4 ไว้แสดงให้ admin เห็นว่าเป็น key ตัวไหน)
    CREATE TABLE IF NOT EXISTS secrets (
      name TEXT PRIMARY KEY,
      iv BLOB NOT NULL,
      tag BLOB NOT NULL,
      ct BLOB NOT NULL,
      last4 TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      updated_by TEXT NOT NULL
    );
    -- บันทึกการเปลี่ยนแปลงโดย admin (ไม่เก็บค่าความลับ)
    CREATE TABLE IF NOT EXISTS audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      target TEXT NOT NULL DEFAULT '',
      detail TEXT NOT NULL DEFAULT ''
    );
  `);

  const insert = db.prepare(
    `INSERT INTO usage (ts, month, email, provider, model, status, input_tokens, output_tokens, pdf_bytes, ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const countStmt = db.prepare('SELECT COUNT(*) AS n FROM usage WHERE email = ? AND month = ?');
  const summaryStmt = db.prepare(
    `SELECT email, COUNT(*) AS requests,
            SUM(CASE WHEN status = 'ok' THEN 1 ELSE 0 END) AS ok,
            COALESCE(SUM(input_tokens), 0) AS input_tokens,
            COALESCE(SUM(output_tokens), 0) AS output_tokens
       FROM usage WHERE month = ? GROUP BY email ORDER BY requests DESC`,
  );

  const getSettingStmt = db.prepare('SELECT value FROM settings WHERE key = ?');
  const setSettingStmt = db.prepare(
    `INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
  );
  const putSecretStmt = db.prepare(
    `INSERT INTO secrets (name, iv, tag, ct, last4, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(name) DO UPDATE SET iv = excluded.iv, tag = excluded.tag, ct = excluded.ct, last4 = excluded.last4,
       updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
  );
  const getSecretStmt = db.prepare('SELECT name, iv, tag, ct, last4, updated_at FROM secrets WHERE name = ?');
  const delSecretStmt = db.prepare('DELETE FROM secrets WHERE name = ?');
  const secretMetaStmt = db.prepare('SELECT name, last4, updated_at FROM secrets');
  const auditInsert = db.prepare('INSERT INTO audit (ts, actor, action, target, detail) VALUES (?, ?, ?, ?, ?)');
  const auditList = db.prepare('SELECT id, ts, actor, action, target, detail FROM audit ORDER BY id DESC LIMIT ?');

  return {
    getSetting(key) {
      const row = getSettingStmt.get(key);
      return row ? JSON.parse(row.value) : undefined;
    },
    setSetting(key, value, actor, ts) {
      setSettingStmt.run(key, JSON.stringify(value), ts, actor);
    },
    putSecret(name, { iv, tag, ct }, last4, actor, ts) {
      putSecretStmt.run(name, iv, tag, ct, last4, ts, actor);
    },
    getSecret: (name) => getSecretStmt.get(name),
    deleteSecret: (name) => delSecretStmt.run(name),
    secretMeta: () => secretMetaStmt.all().map((r) => ({ ...r })),
    audit(ts, actor, action, target = '', detail = '') {
      auditInsert.run(ts, actor, action, target, detail);
    },
    listAudit: (limit = 100) => auditList.all(Math.min(Number(limit) || 100, 500)).map((r) => ({ ...r })),
    logUsage(r) {
      insert.run(r.ts, monthOf(r.ts), r.email, r.provider, r.model, r.status, r.inputTokens || 0, r.outputTokens || 0, r.pdfBytes || 0, r.ms || 0);
    },
    // นับทุกครั้งที่เรียกค่ายต้นทาง (รวมที่ล้มเหลว) เพื่อกันการยิงซ้ำจนกินโควต้าค่าใช้จ่าย
    requestsThisMonth(email, month) {
      return Number(countStmt.get(email, month).n);
    },
    usageSummary(month) {
      return summaryStmt.all(month).map((r) => ({ ...r }));
    },
    close: () => db.close(),
  };
}
