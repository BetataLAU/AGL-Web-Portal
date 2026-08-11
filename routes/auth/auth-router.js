const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../../db/database');
const router = express.Router();
const { requireAuth } = require('./middleware');
const { resolvePermissions } = require('./helpers');

// ===== 試錯上限（防暴力破解） =====
const MAX_FAILED_ATTEMPTS = 5;   // 連續錯誤 5 次
const LOCK_DURATION_MS = 15 * 60 * 1000; // 鎖定 15 分鐘

// ===== 登入系統：Auth API =====
// POST /api/auth/login → { companyCode, userId, password }
// 流程：companyCode → companies 表找 company_code → users 表找 (company_id, user_id) → 檢查鎖定/啟用 → bcrypt 驗證密碼 → 建立 session
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

        const now = Date.now();

        // 3. 檢查帳號鎖定（試錯上限）
        if (user.locked_until) {
          const lockedUntil = new Date(user.locked_until).getTime();
          if (lockedUntil > now) {
            const remainingMin = Math.ceil((lockedUntil - now) / 60000);
            return res.status(423).json({
              error: `嘗試次數過多，帳號已鎖定。請於 ${remainingMin} 分鐘後再試，或聯絡管理員重設密碼。`
            });
          }
          // 鎖定期已過 → 自動清除鎖定狀態
          db.run(
            "UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?",
            [user.id],
            () => {}
          );
          user.failed_attempts = 0;
          user.locked_until = null;
        }

        // 4. bcrypt 驗證密碼
        bcrypt.compare(password, user.password_hash, (bcryptErr, match) => {
          if (bcryptErr) return res.status(500).json({ error: bcryptErr.message });

          if (!match) {
            // ===== 密碼錯誤：累計失敗次數 =====
            const newAttempts = Number(user.failed_attempts || 0) + 1;
            if (newAttempts >= MAX_FAILED_ATTEMPTS) {
              // 達到上限 → 鎖定帳號，清除計數（下次錯誤會重新計）
              const lockedUntil = new Date(now + LOCK_DURATION_MS).toISOString();
              db.run(
                "UPDATE users SET failed_attempts = 0, locked_until = ? WHERE id = ?",
                [lockedUntil, user.id],
                (updErr) => {
                  if (updErr) return res.status(500).json({ error: updErr.message });
                  return res.status(423).json({
                    error: `密碼錯誤 ${MAX_FAILED_ATTEMPTS} 次，帳號已鎖定 15 分鐘。`
                  });
                }
              );
              return;
            }
            // 未達上限 → 記錄失敗次數，回傳剩餘次數提示
            db.run(
              "UPDATE users SET failed_attempts = ? WHERE id = ?",
              [newAttempts, user.id],
              (updErr) => {
                if (updErr) return res.status(500).json({ error: updErr.message });
                const remaining = MAX_FAILED_ATTEMPTS - newAttempts;
                return res.status(401).json({
                  error: `Company ID 或密碼錯誤（剩餘嘗試次數：${remaining}）`
                });
              }
            );
            return;
          }

          // ===== 密碼正確：清除失敗計數與鎖定，紀錄上次登入時間 =====
          db.run(
            "UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = CURRENT_TIMESTAMP WHERE id = ?",
            [user.id],
            (resetErr) => {
              if (resetErr) return res.status(500).json({ error: resetErr.message });

              // 5. 建立 session（含細粒度權限）
              req.session.user = {
                id: user.id,
                company_id: user.company_id,
                company_code: companyCode,
                company_name: company.name,
                user_id: user.user_id,
                display_name: user.display_name || user.user_id,
                role: user.role,
                permissions: resolvePermissions(user)
              };

              res.json({
                success: true,
                user: req.session.user
              });
            }
          );
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

// PUT /api/auth/me/password → 使用者自己修改密碼（需登入，驗證舊密碼）
router.put('/me/password', requireAuth, (req, res) => {
  const currentPassword = String(req.body.current_password || '');
  const newPassword = String(req.body.new_password || '');

  if (!currentPassword) return res.status(400).json({ error: '請填寫目前密碼' });

  // 新密碼規則（與後台一致：英數混合 4-20 位）
  if (!/^[A-Za-z0-9]{4,20}$/.test(newPassword)) {
    return res.status(400).json({ error: '新密碼須為 4-20 位英文或數字' });
  }
  if (!/[A-Za-z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
    return res.status(400).json({ error: '新密碼須包含英文與數字（例如 ag1234）' });
  }

  const userId = req.session.user.id;
  db.get("SELECT id, password_hash FROM users WHERE id = ?", [userId], (err, user) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!user) return res.status(404).json({ error: '使用者不存在' });

    bcrypt.compare(currentPassword, user.password_hash, (cmpErr, match) => {
      if (cmpErr) return res.status(500).json({ error: cmpErr.message });
      if (!match) return res.status(400).json({ error: '目前密碼不正確' });

      bcrypt.hash(newPassword, 10, (hashErr, hash) => {
        if (hashErr) return res.status(500).json({ error: hashErr.message });
        db.run(
          "UPDATE users SET password_hash = ? WHERE id = ?",
          [hash, userId],
          (updErr) => {
            if (updErr) return res.status(500).json({ error: updErr.message });
            res.json({ success: true });
          }
        );
      });
    });
  });
});

module.exports = router;