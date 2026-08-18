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

// GET /api/auth/me/nav-order → 讀取目前登入者的側邊欄導航排序（伺服器端持久化）
router.get('/me/nav-order', requireAuth, (req, res) => {
  const userId = req.session.user.id;
  db.get("SELECT sidebar_nav_order FROM users WHERE id = ?", [userId], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    let order = [];
    if (row && row.sidebar_nav_order) {
      try {
        const parsed = JSON.parse(row.sidebar_nav_order);
        if (Array.isArray(parsed)) order = parsed;
      } catch (e) { /* ignore */ }
    }
    res.json({ order });
  });
});

// PUT /api/auth/me/nav-order → 儲存目前登入者的側邊欄導航排序（重啟伺服器 / 換瀏覽器後仍保留）
router.put('/me/nav-order', requireAuth, (req, res) => {
  const userId = req.session.user.id;
  const order = req.body.order;
  if (!Array.isArray(order)) {
    return res.status(400).json({ error: '排序格式不正確（需為陣列）' });
  }
  // 限制每個項目為有效的 href 字串，避免異常資料
  const cleanOrder = order
    .map(item => String(item).trim())
    .filter(item => item.startsWith('#section-') || item === 'users.html');
  const MAX_ORDER_ITEMS = 20;
  if (cleanOrder.length > MAX_ORDER_ITEMS) {
    return res.status(400).json({ error: '排序項目過多' });
  }
  const storeValue = JSON.stringify(cleanOrder);

  db.run(
    "UPDATE users SET sidebar_nav_order = ? WHERE id = ?",
    [storeValue, userId],
    (updErr) => {
      if (updErr) return res.status(500).json({ error: updErr.message });
      if (req.session.user) req.session.user.sidebar_nav_order = storeValue;
      res.json({ success: true, order: cleanOrder });
    }
  );
});

// 解析 sidebar_bg_url 欄位內容（相容純 URL 舊資料與 JSON 新格式）
function parseSidebarBg(raw) {
  if (!raw) return { bgUrl: '', scale: 1, posX: 0, posY: 0 };
  // 舊格式：純 URL 字串（data: 或 http）
  if (typeof raw === 'string' && (raw.startsWith('data:') || /^https?:\/\//i.test(raw))) {
    return { bgUrl: raw, scale: 1, posX: 0, posY: 0 };
  }
  // 新格式：JSON 字串
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && parsed.url) {
      return {
        bgUrl: parsed.url,
        scale: Number.isFinite(Number(parsed.scale)) ? Number(parsed.scale) : 1,
        posX: Number.isFinite(Number(parsed.posX)) ? Number(parsed.posX) : 0,
        posY: Number.isFinite(Number(parsed.posY)) ? Number(parsed.posY) : 0
      };
    }
  } catch (e) { /* ignore */ }
  return { bgUrl: raw, scale: 1, posX: 0, posY: 0 };
}

// GET /api/auth/me/sidebar-bg → 讀取目前登入者的登入卡背景圖（伺服器端持久化）
router.get('/me/sidebar-bg', requireAuth, (req, res) => {
  const userId = req.session.user.id;
  db.get("SELECT sidebar_bg_url FROM users WHERE id = ?", [userId], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(parseSidebarBg(row && row.sidebar_bg_url));
  });
});

// PUT /api/auth/me/sidebar-bg → 儲存目前登入者的登入卡背景圖（重啟伺服器後仍保留）
// 接收：{ bgUrl, scale, posX, posY }
//   bgUrl 支援 data:image/... 或 http(s)://...；空字串 = 移除背景圖
//   scale 縮放倍率（0.5 ~ 5）；posX/posY 位移像素
router.put('/me/sidebar-bg', requireAuth, (req, res) => {
  const userId = req.session.user.id;
  const bgUrl = String(req.body.bgUrl || '').trim();
  const MAX_BG_LENGTH = 2 * 1024 * 1024; // 限制 2MB 內，避免資料庫膨脹

  // 驗證格式
  if (bgUrl !== '') {
    const isDataUrl = /^data:image\/[a-zA-Z0-9.+_-]+;base64,/.test(bgUrl);
    const isHttp = /^https?:\/\//i.test(bgUrl);
    if (!isDataUrl && !isHttp) {
      return res.status(400).json({ error: '背景圖格式不正確（僅支援 data:image 或 http/https 網址）' });
    }
    if (bgUrl.length > MAX_BG_LENGTH) {
      return res.status(400).json({ error: '背景圖過大（上限 2MB），請改用較小的圖片' });
    }
  }

  // 解析調整參數（有限範圍，避免異常值）
  let scale = Number(req.body.scale);
  if (!Number.isFinite(scale)) scale = 1;
  scale = Math.min(5, Math.max(0.5, scale));

  let posX = Number(req.body.posX);
  if (!Number.isFinite(posX)) posX = 0;
  posX = Math.min(1000, Math.max(-1000, posX));

  let posY = Number(req.body.posY);
  if (!Number.isFinite(posY)) posY = 0;
  posY = Math.min(1000, Math.max(-1000, posY));

  // 組裝儲存內容（純 URL 舊格式相容性：無調整參數時存純字串）
  let storeValue = null;
  if (bgUrl !== '') {
    storeValue = (scale === 1 && posX === 0 && posY === 0)
      ? bgUrl  // 無調整 → 存純 URL，維持與舊資料相容
      : JSON.stringify({ url: bgUrl, scale, posX, posY });
  }

  db.run(
    "UPDATE users SET sidebar_bg_url = ? WHERE id = ?",
    [storeValue, userId],
    (updErr) => {
      if (updErr) return res.status(500).json({ error: updErr.message });
      // 同步更新 session 中的快取，讓 /api/auth/me 也能拿到最新值
      if (req.session.user) req.session.user.sidebar_bg_url = storeValue || null;
      res.json({ success: true, bgUrl, scale: scale === 1 ? 1 : scale, posX, posY });
    }
  );
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