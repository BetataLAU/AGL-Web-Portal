// ===== 登入系統：權限 Middleware =====
// 供所有受保護的 API 路由使用
// - requireAuth：必須已登入
// - requireRole：必須已登入且角色符合（可傳多個角色）
// - requirePermission：必須已登入且具備指定細粒度權限（無 session 權限時退回角色預設）
const { defaultPermissions } = require('./helpers');

// 未登入 → 401（前端 api.js 會自動跳轉登入頁）
function requireAuth(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: '請先登入' });
  }
  next();
}

// 已登入且角色為指定之一（如 requireRole('admin', 'staff')）
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session || !req.session.user) {
      return res.status(401).json({ error: '請先登入' });
    }
    const { role } = req.session.user;
    if (!roles.includes(role)) {
      return res.status(403).json({ error: '沒有權限執行此操作' });
    }
    next();
  };
}

// 已登入且具備指定細粒度權限（如 requirePermission('db_view')）
// session.user.permissions 為 undefined（舊版 session）時，退回角色預設權限
function requirePermission(perm) {
  return (req, res, next) => {
    if (!req.session || !req.session.user) {
      return res.status(401).json({ error: '請先登入' });
    }
    const user = req.session.user;
    const perms = user.permissions || defaultPermissions(user.role);
    if (!perms[perm]) {
      return res.status(403).json({ error: '沒有權限執行此操作' });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole, requirePermission };