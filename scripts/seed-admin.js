// ===== 登入系統：預設管理員 seed =====
// 目的：全新環境第一次啟動時，自動建立預設管理員帳號，避免無法登入系統
// 預設帳號：Company Code = AGL / User ID = admin / Password = admin123
// 安全提醒：請於第一次登入後，在「使用者管理」頁面修改密碼或建立自己的管理員帳號
const bcrypt = require('bcryptjs');
const db = require('../db/database');

const DEFAULT_COMPANY_CODE = 'AGL';
const DEFAULT_COMPANY_NAME = 'AGL Logistics';
const ADMIN_USER_ID = 'admin';
const ADMIN_PASSWORD = 'admin123';

// 找（或建立）AGL 公司
function getOrCreateCompany(cb) {
  db.get("SELECT id FROM companies WHERE company_code = ?", [DEFAULT_COMPANY_CODE], (err, row) => {
    if (err) return cb(err);
    if (row) return cb(null, row.id);

    db.run(
      "INSERT INTO companies (category, name, company_code) VALUES ('customer', ?, ?)",
      [DEFAULT_COMPANY_NAME, DEFAULT_COMPANY_CODE],
      function (insertErr) {
        if (insertErr) return cb(insertErr);
        console.log(`[seed-admin] 已建立預設公司：${DEFAULT_COMPANY_NAME} (${DEFAULT_COMPANY_CODE})`);
        cb(null, this.lastID);
      }
    );
  });
}

// 檢查 admin 是否已存在；不存在則建立（含 bcrypt hash）
function seedAdminIfMissing(companyId) {
  db.get(
    "SELECT id FROM users WHERE company_id = ? AND user_id = ?",
    [companyId, ADMIN_USER_ID],
    (err, row) => {
      if (err) {
        console.error('[seed-admin] 查詢失敗:', err.message);
        return;
      }
      if (row) {
        console.log('[seed-admin] 預設管理員已存在，跳過');
        return;
      }
      bcrypt.hash(ADMIN_PASSWORD, 10, (hashErr, hash) => {
        if (hashErr) {
          console.error('[seed-admin] 密碼 hash 失敗:', hashErr.message);
          return;
        }
        db.run(
          `INSERT INTO users (company_id, user_id, password_hash, display_name, role, is_active)
           VALUES (?, ?, ?, ?, 'admin', 1)`,
          [companyId, ADMIN_USER_ID, hash, '系統管理員'],
          (insertErr) => {
            if (insertErr) {
              console.error('[seed-admin] 建立管理員失敗:', insertErr.message);
              return;
            }
            console.log(`[seed-admin] 已建立預設管理員：${DEFAULT_COMPANY_CODE} / ${ADMIN_USER_ID} / ${ADMIN_PASSWORD}`);
          }
        );
      });
    }
  );
}

getOrCreateCompany((err, companyId) => {
  if (err) {
    console.error('[seed-admin] 建立公司失敗:', err.message);
    process.exit(1);
  }
  seedAdminIfMissing(companyId);
});