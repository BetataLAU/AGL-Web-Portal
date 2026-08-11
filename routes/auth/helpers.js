// ===== 登入系統：共用輔助函式 =====
const db = require('../../db/database');

// ===== 預設權限（依角色） =====
// permissions：細粒度權限開關（admin 全開；staff 可看全部訂單+資料庫；customer 只能看自己公司訂單）
function defaultPermissions(role) {
  if (role === 'admin') {
    return {
      orders_view: true,
      orders_edit: true,
      orders_create: true,
      orders_delete: true,
      companies_edit: true,
      db_view: true,
      users_manage: true
    };
  }
  if (role === 'staff') {
    return {
      orders_view: true,
      orders_edit: true,
      orders_create: true,
      orders_delete: true,
      companies_edit: true,
      db_view: true,
      users_manage: false
    };
  }
  // customer：只能看自己公司的訂單（orders_view 仍為 true，後端依 company_id 過濾）
  return {
    orders_view: true,
    orders_edit: false,
    orders_create: true,
    orders_delete: false,
    companies_edit: false,
    db_view: false,
    users_manage: false
  };
}

// 解析使用者的 permissions（JSON 字串 → 物件；缺省用角色預設）
function resolvePermissions(user) {
  if (user && user.permissions) {
    try {
      const parsed = JSON.parse(user.permissions);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch (e) { /* fallthrough */ }
  }
  return defaultPermissions(user ? user.role : 'customer');
}

// 檢查是否為「最後一個 admin」（排除指定 id）
// cb(err, isLast)
function isLastAdmin(excludeId, cb) {
  db.get(
    "SELECT COUNT(*) AS cnt FROM users WHERE role = 'admin' AND id != ?",
    [excludeId || -1],
    (err, row) => {
      if (err) return cb(err);
      cb(null, !row || row.cnt <= 0);
    }
  );
}

// 寫入審計日誌（不阻塞主流程，失敗僅 console）
function writeAuditLog({ session, action, target_type, target_id, detail }) {
  const actorUserId = session && session.user ? session.user.user_id : null;
  const actorDisplay = session && session.user ? (session.user.display_name || session.user.user_id) : 'system';
  db.run(
    "INSERT INTO audit_log (actor_user_id, actor_display, action, target_type, target_id, detail) VALUES (?, ?, ?, ?, ?, ?)",
    [actorUserId, actorDisplay, action, target_type || '', target_id != null ? String(target_id) : '', detail || ''],
    (err) => {
      if (err) console.error('writeAuditLog failed:', err.message);
    }
  );
}

module.exports = { defaultPermissions, resolvePermissions, isLastAdmin, writeAuditLog };