const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../../db/database');
const router = express.Router();

// ===== 登入系統：Auth API =====
// POST /api/auth/login → { companyCode, userId, password }
// 流程：companyCode → companies 表找 company_code → users 表找 (company_id, user_id) → bcrypt 驗證密碼 → 建立 session
router.post('/login', (req, res) => {
  const companyCode = String(req.body.companyCode || '').trim().toUpperCase();
  const userId = String(req.body.userId || '').trim();
  const password = String(req.body.password || '');

  if (!companyCode || !userId || !password) {
    return res.status(400).json({ error: '請填寫 Company ID、User ID 與密碼' });
  }

  // 1. 依 company_code 找公司
  db.get("SELECT id, name FROM companies WHERE company_code = ?", [companyCode], (err, company) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!company) {
      return res.status(401).json({ error: 'Company ID 或密碼錯誤' });
    }

    // 2. 依 (company_id, user_id) 找使用者
    db.get(
      "SELECT * FROM users WHERE company_id = ? AND user_id = ?",
      [company.id, userId],
      (err2, user) => {
        if (err2) return res.status(500).json({ error: err2.message });
        if (!user) {
          return res.status(401).json({ error: 'Company ID 或密碼錯誤' });
        }
        if (!user.is_active) {
          return res.status(403).json({ error: '此帳號已被停用，請聯絡管理員' });
        }

        // 3. bcrypt 驗證密碼
        bcrypt.compare(password, user.password_hash, (bcryptErr, match) => {
          if (bcryptErr) return res.status(500).json({ error: bcryptErr.message });
          if (!match) {
            return res.status(401).json({ error: 'Company ID 或密碼錯誤' });
          }

          // 4. 建立 session
          req.session.user = {
            id: user.id,
            company_id: user.company_id,
            company_code: companyCode,
            company_name: company.name,
            user_id: user.user_id,
            display_name: user.display_name || user.user_id,
            role: user.role
          };

          res.json({
            success: true,
            user: req.session.user
          });
        });
      }
    );
  });
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.clearCookie('connect.sid');
    res.json({ success: true });
  });
});

// GET /api/auth/me → 目前登入者資訊（未登入回 401）
router.get('/me', (req, res) => {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: '未登入' });
  }
  res.json({ user: req.session.user });
});

module.exports = router;