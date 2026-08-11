const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../../db/database');
const router = express.Router();
const { requireAuth, requireRole } = require('./middleware');
const { defaultPermissions, resolvePermissions, isLastAdmin, writeAuditLog } = require('./helpers');

// ===== 登入系統：使用者管理 API（admin only）=====
// 密碼規則：英數混合，至少 4 位（依需求不要求過度複雜）
const USER_ID_REGEX = /^[A-Za-z0-9_]{2,20}$/;
const PASSWORD_REGEX = /^[A-Za-z0-9]{4,20}$/;
const ROLE_LIST = ['admin', 'staff', 'customer'];

function validatePassword(password) {
  if (!PASSWORD_REGEX.test(password)) {
    return '密碼須為 4-20 位英文或數字';
  }
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return '密碼須包含英文與數字（例如 ag1234）';
  }
  return null;
}

// 序列化使用者（不輸出密碼 hash）
function serializeUser(row) {
  return {
    id: row.id,
    company_id: row.company_id,
    company_name: row.company_name || null,
    company_code: row.company_code || null,
    user_id: row.user_id,
    display_name: row.display_name,
    role: row.role,
    is_active: !!row.is_active,
    failed_attempts: row.failed_attempts || 0,
    locked_until: row.locked_until || null,
    last_login_at: row.last_login_at || null,
    permissions: resolvePermissions(row),
    created_at: row.created_at
  };
}

// 驗證 permissions 物件（只接受已知 key 的布林值）
function validatePermissions(perms) {
  if (!perms || typeof perms !== 'object') return null;
  const allowed = ['orders_view', 'orders_edit', 'orders_create', 'orders_delete', 'companies_edit', 'db_view', 'users_manage'];
  const out = {};
  for (const key of allowed) {
    if (perms[key] !== undefined) {
      if (typeof perms[key] !== 'boolean') return null;
      out[key] = perms[key];
    }
  }
  return out;
}

// GET /api/auth/audit-log → 審計日誌（admin only）
router.get('/audit-log', requireRole('admin'), (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
  db.all(
    "SELECT id, actor_user_id, actor_display, action, target_type, target_id, detail, strftime('%Y-%m-%dT%H:%M:%fZ', created_at) AS created_at FROM audit_log ORDER BY id DESC LIMIT ?",
    [limit],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ data: rows || [] });
    }
  );
});

// POST /api/auth/users/batch → 批次建立使用者（admin only）
router.post('/batch', requireRole('admin'), (req, res) => {
  const users = Array.isArray(req.body.users) ? req.body.users : [];
  if (!users.length) return res.status(400).json({ error: '請提供要建立的使用者清單' });

  const results = [];
  let idx = 0;

  const hashAndInsert = (payload, done) => {
    const companyId = payload.company_id;
    const userId = String(payload.user_id || '').trim().toLowerCase();
    const displayName = String(payload.display_name || '').trim();
    const role = payload.role || 'customer';

    if (!companyId) return done({ user_id: payload.user_id, error: '缺少公司' });
    if (!USER_ID_REGEX.test(userId)) return done({ user_id: payload.user_id, error: 'User ID 格式不正確' });
    if (!ROLE_LIST.includes(role)) return done({ user_id: payload.user_id, error: '角色不正確' });
    const passwordError = validatePassword(String(payload.password || ''));
    if (passwordError) return done({ user_id: payload.user_id, error: passwordError });

    db.get("SELECT id FROM companies WHERE id = ?", [companyId], (cErr, company) => {
      if (cErr) return done({ user_id: payload.user_id, error: cErr.message });
      if (!company) return done({ user_id: payload.user_id, error: '公司不存在' });
      db.get(
        "SELECT id FROM users WHERE company_id = ? AND user_id = ?",
        [companyId, userId],
        (dupErr, dupRow) => {
          if (dupErr) return done({ user_id: payload.user_id, error: dupErr.message });
          if (dupRow) return done({ user_id: payload.user_id, error: '此公司在這個 User ID 已存在' });
          bcrypt.hash(String(payload.password), 10, (hErr, hash) => {
            if (hErr) return done({ user_id: payload.user_id, error: hErr.message });
            db.run(
              "INSERT INTO users (company_id, user_id, password_hash, display_name, role) VALUES (?, ?, ?, ?, ?)",
              [companyId, userId, hash, displayName, role],
              function (insErr) {
                if (insErr) return done({ user_id: payload.user_id, error: insErr.message });
                done(null, { id: this.lastID, user_id: userId, company_id: companyId });
              }
            );
          });
        }
      );
    });
  };

  const next = () => {
    if (idx >= users.length) {
      const successCount = results.filter(r => !r.error).length;
      writeAuditLog({
        session: req.session,
        action: 'batch_create_users',
        target_type: 'users_batch',
        target_id: '',
        detail: `批次建立：成功 ${successCount} 筆，失敗 ${results.length - successCount} 筆`
      });
      return res.json({ success: true, results, success_count: successCount, fail_count: results.length - successCount });
    }
    const u = users[idx];
    idx += 1;
    hashAndInsert(u, (result) => {
      results.push(result);
      next();
    });
  };
  next();
});

// GET /api/auth/users?search=&role= → 使用者清單（含公司名稱、鎖定狀態、上次登入）
router.get('/', requireRole('admin'), (req, res) => {
  const search = (req.query.search || '').trim();
  const role = (req.query.role || '').trim();
  const params = [];
  let sql = `
    SELECT u.*,
           c.name AS company_name,
           c.company_code AS company_code,
           strftime('%Y-%m-%dT%H:%M:%fZ', u.created_at) AS created_at,
           strftime('%Y-%m-%dT%H:%M:%fZ', u.last_login_at) AS last_login_at
    FROM users u
    LEFT JOIN companies c ON c.id = u.company_id
    WHERE 1=1
  `;
  if (search) {
    sql += " AND (u.user_id LIKE ? OR u.display_name LIKE ? OR c.name LIKE ? OR c.company_code LIKE ?)";
    const like = `%${search}%`;
    params.push(like, like, like, like);
  }
  if (role && ROLE_LIST.includes(role)) {
    sql += " AND u.role = ?";
    params.push(role);
  }
  sql += " ORDER BY c.name ASC, u.user_id ASC";

  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ data: (rows || []).map(serializeUser) });
  });
});

// POST /api/auth/users → 新增使用者
router.post('/', requireRole('admin'), (req, res) => {
  const {
    company_id,
    user_id,
    password,
    display_name = '',
    role = 'customer'
  } = req.body;

  // 驗證
  if (!company_id) return res.status(400).json({ error: '請選擇公司' });
  if (!USER_ID_REGEX.test(String(user_id || ''))) {
    return res.status(400).json({ error: 'User ID 須為 2-20 位英文、數字或底線' });
  }
  if (!ROLE_LIST.includes(role)) {
    return res.status(400).json({ error: '角色不正確' });
  }
  const passwordError = validatePassword(String(password || ''));
  if (passwordError) return res.status(400).json({ error: passwordError });

  // 確認公司存在
  db.get("SELECT id FROM companies WHERE id = ?", [company_id], (err, company) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!company) return res.status(400).json({ error: '公司不存在' });

    // user_id 轉小寫儲存（登入時不分大小寫）
    const finalUserId = String(user_id).trim().toLowerCase();

    // 確認 (company_id, user_id) 未重複
    db.get(
      "SELECT id FROM users WHERE company_id = ? AND user_id = ?",
      [company_id, finalUserId],
      (dupErr, dupRow) => {
        if (dupErr) return res.status(500).json({ error: dupErr.message });
        if (dupRow) {
          return res.status(400).json({ error: '此公司在這個 User ID 已存在' });
        }

        bcrypt.hash(String(password), 10, (hashErr, hash) => {
          if (hashErr) return res.status(500).json({ error: hashErr.message });

          const stmt = db.prepare(`
            INSERT INTO users (company_id, user_id, password_hash, display_name, role)
            VALUES (?, ?, ?, ?, ?)
          `);
          stmt.run(
            company_id,
            finalUserId,
            hash,
            String(display_name).trim(),
            role,
            function (insertErr) {
              if (insertErr) return res.status(500).json({ error: insertErr.message });
              writeAuditLog({
                session: req.session,
                action: 'create_user',
                target_type: 'user',
                target_id: this.lastID,
                detail: `建立使用者 ${finalUserId}（${role}）`
              });
              res.json({ success: true, id: this.lastID });
            }
          );
          stmt.finalize();
        });
      }
    );
  });
});

// PUT /api/auth/users/:id/reset-password → 重設密碼
router.put('/:id/reset-password', requireRole('admin'), (req, res) => {
  const { id } = req.params;
  const password = String(req.body.password || '');
  const passwordError = validatePassword(password);
  if (passwordError) return res.status(400).json({ error: passwordError });

  bcrypt.hash(password, 10, (hashErr, hash) => {
    if (hashErr) return res.status(500).json({ error: hashErr.message });

    // 重設密碼同時清除失敗計數與鎖定（管理員可藉此解鎖被鎖定的帳號）
    const stmt = db.prepare(
      "UPDATE users SET password_hash = ?, failed_attempts = 0, locked_until = NULL WHERE id = ?"
    );
    stmt.run(hash, id, function (updateErr) {
      if (updateErr) return res.status(500).json({ error: updateErr.message });
      if (!this.changes) return res.status(404).json({ error: '使用者不存在' });
      writeAuditLog({
        session: req.session,
        action: 'reset_password',
        target_type: 'user',
        target_id: id,
        detail: `重設密碼（同時解鎖帳號）`
      });
      res.json({ success: true });
    });
    stmt.finalize();
  });
});

// DELETE /api/auth/users/:id → 刪除使用者（admin only）
router.delete('/:id', requireRole('admin'), (req, res) => {
  const { id } = req.params;
  const targetId = Number(id);

  // 保護：不能刪自己
  if (req.session.user.id === targetId) {
    return res.status(400).json({ error: '不能刪除自己的帳號' });
  }

  // 取得目標使用者（確認存在 + 判斷是否 admin）
  db.get("SELECT id, user_id, role FROM users WHERE id = ?", [targetId], (err, target) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!target) return res.status(404).json({ error: '使用者不存在' });

    const finishDelete = () => {
      db.run("DELETE FROM users WHERE id = ?", [targetId], function (delErr) {
        if (delErr) return res.status(500).json({ error: delErr.message });
        writeAuditLog({
          session: req.session,
          action: 'delete_user',
          target_type: 'user',
          target_id: targetId,
          detail: `刪除使用者 ${target.user_id}（${target.role}）`
        });
        res.json({ success: true });
      });
    };

    // 若是 admin → 需確認不是最後一個 admin
    if (target.role === 'admin') {
      isLastAdmin(targetId, (isLastErr, isLast) => {
        if (isLastErr) return res.status(500).json({ error: isLastErr.message });
        if (isLast) return res.status(400).json({ error: '此為最後一個管理員，不可刪除' });
        finishDelete();
      });
    } else {
      finishDelete();
    }
  });
});

// PUT /api/auth/users/:id → 更新使用者（公司、角色、顯示名稱、啟用狀態、權限）
router.put('/:id', requireRole('admin'), (req, res) => {
  const { id } = req.params;
  const { display_name, role, is_active, company_id, permissions } = req.body;
  const targetId = Number(id);
  const isSelf = req.session.user.id === targetId;

  const sets = [];
  const params = [];
  if (display_name !== undefined) {
    sets.push('display_name = ?');
    params.push(String(display_name).trim());
  }
  if (role !== undefined) {
    if (!ROLE_LIST.includes(role)) {
      return res.status(400).json({ error: '角色不正確' });
    }
    sets.push('role = ?');
    params.push(role);
  }
  if (is_active !== undefined) {
    if (typeof is_active !== 'boolean') {
      return res.status(400).json({ error: 'is_active 必須為布林值' });
    }
    sets.push('is_active = ?');
    params.push(is_active ? 1 : 0);
  }
  // 可選：更新細粒度權限（JSON）
  let newPermissions = null;
  if (permissions !== undefined) {
    const validated = validatePermissions(permissions);
    if (!validated) return res.status(400).json({ error: '權限格式不正確' });
    newPermissions = validated;
  }
  // 可選：更新所屬公司
  let newCompanyId = null;
  if (company_id !== undefined) {
    newCompanyId = parseInt(company_id, 10);
    if (!newCompanyId) return res.status(400).json({ error: '請選擇公司' });
  }
  if (sets.length === 0 && newCompanyId === null && newPermissions === null) {
    return res.status(400).json({ error: '沒有可更新的欄位' });
  }

  // 保護：不可停用/降級/改公司/改自己權限自己（避免把唯一 admin 鎖死或把自己移出公司）
  if (isSelf && (is_active === false || (role !== undefined && role !== 'admin') || newCompanyId !== null || newPermissions !== null)) {
    return res.status(400).json({ error: '不能修改自己的角色、公司、權限或停用自己' });
  }

  const finishUpdate = () => {
    if (newPermissions !== null) {
      // 與現有權限合併（保留未提供的項目）
      db.get("SELECT permissions FROM users WHERE id = ?", [targetId], (gErr, uRow) => {
        if (gErr) return res.status(500).json({ error: gErr.message });
        const base = uRow && uRow.permissions ? resolvePermissions(uRow) : defaultPermissions(undefined);
        const merged = { ...base, ...newPermissions };
        sets.push('permissions = ?');
        params.push(JSON.stringify(merged));
        doUpdate();
      });
      return;
    }
    doUpdate();
  };

  const doUpdate = () => {
    if (newCompanyId !== null) {
      sets.push('company_id = ?');
      params.push(newCompanyId);
    }
    params.push(targetId);
    const stmt = db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`);
    stmt.run(...params, function (updateErr) {
      if (updateErr) return res.status(500).json({ error: updateErr.message });
      if (!this.changes) return res.status(404).json({ error: '使用者不存在' });
      const detailParts = [];
      if (role !== undefined) detailParts.push(`角色→${role}`);
      if (is_active !== undefined) detailParts.push(is_active ? '啟用' : '停用');
      if (newCompanyId !== null) detailParts.push(`公司→${newCompanyId}`);
      if (newPermissions !== null) detailParts.push('權限更新');
      if (display_name !== undefined) detailParts.push('顯示名稱更新');
      writeAuditLog({
        session: req.session,
        action: 'update_user',
        target_type: 'user',
        target_id: targetId,
        detail: detailParts.join('、')
      });
      res.json({ success: true, changes: this.changes });
    });
    stmt.finalize();
  };

  // 若要改公司：驗證公司存在 + 新的 (company_id, user_id) 不與其他使用者重複
  if (newCompanyId === null) {
    finishUpdate();
    return;
  }
  db.get('SELECT id FROM companies WHERE id = ?', [newCompanyId], (err, company) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!company) return res.status(400).json({ error: '公司不存在' });

    db.get(
      `SELECT id FROM users
       WHERE company_id = ? AND user_id = (SELECT user_id FROM users WHERE id = ?) AND id != ?`,
      [newCompanyId, targetId, targetId],
      (dupErr, dupRow) => {
        if (dupErr) return res.status(500).json({ error: dupErr.message });
        if (dupRow) return res.status(400).json({ error: '此公司在這個 User ID 已存在' });
        finishUpdate();
      }
    );
  });
});

module.exports = router;