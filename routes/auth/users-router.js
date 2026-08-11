const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../../db/database');
const router = express.Router();
const { requireAuth, requireRole } = require('./middleware');

// ===== 登入系統：使用者管理 API（admin only）=====
// 密碼規則：英數混合，至少 4 位（依需求不要求過度複雜）
const USER_ID_REGEX = /^[A-Za-z0-9_]{2,20}$/;
const PASSWORD_REGEX = /^[A-Za-z0-9]{4,20}$/;

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
    created_at: row.created_at
  };
}

// GET /api/auth/users → 使用者清單（含公司名稱）
router.get('/', requireRole('admin'), (req, res) => {
  const sql = `
    SELECT u.*,
           c.name AS company_name,
           c.company_code AS company_code,
           strftime('%Y-%m-%dT%H:%M:%fZ', u.created_at) AS created_at
    FROM users u
    LEFT JOIN companies c ON c.id = u.company_id
    ORDER BY c.name ASC, u.user_id ASC
  `;
  db.all(sql, [], (err, rows) => {
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
  if (!['admin', 'staff', 'customer'].includes(role)) {
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
      res.json({ success: true });
    });
    stmt.finalize();
  });
});

// PUT /api/auth/users/:id → 更新使用者（公司、角色、顯示名稱、啟用狀態）
router.put('/:id', requireRole('admin'), (req, res) => {
  const { id } = req.params;
  const { display_name, role, is_active, company_id } = req.body;

  const sets = [];
  const params = [];
  if (display_name !== undefined) {
    sets.push('display_name = ?');
    params.push(String(display_name).trim());
  }
  if (role !== undefined) {
    if (!['admin', 'staff', 'customer'].includes(role)) {
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
  // 可選：更新所屬公司
  let newCompanyId = null;
  if (company_id !== undefined) {
    newCompanyId = parseInt(company_id, 10);
    if (!newCompanyId) return res.status(400).json({ error: '請選擇公司' });
  }
  if (sets.length === 0 && newCompanyId === null) {
    return res.status(400).json({ error: '沒有可更新的欄位' });
  }

  // 保護：不可停用/降級/改公司自己（避免把唯一 admin 鎖死或把自己移出公司）
  if (req.session.user.id === Number(id) &&
      (is_active === false || (role !== undefined && role !== 'admin') || newCompanyId !== null)) {
    return res.status(400).json({ error: '不能停用自己的帳號、修改自己的角色或公司' });
  }

  const finishUpdate = () => {
    if (newCompanyId !== null) {
      sets.push('company_id = ?');
      params.push(newCompanyId);
    }
    params.push(id);
    const stmt = db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`);
    stmt.run(...params, function (updateErr) {
      if (updateErr) return res.status(500).json({ error: updateErr.message });
      if (!this.changes) return res.status(404).json({ error: '使用者不存在' });
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
      [newCompanyId, id, id],
      (dupErr, dupRow) => {
        if (dupErr) return res.status(500).json({ error: dupErr.message });
        if (dupRow) return res.status(400).json({ error: '此公司在這個 User ID 已存在' });
        finishUpdate();
      }
    );
  });
});

module.exports = router;