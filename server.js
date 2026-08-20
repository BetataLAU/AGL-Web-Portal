const express = require('express');
const session = require('express-session');
const path = require('path');
const { execFile } = require('child_process');
const SQLiteStore = require('connect-sqlite3')(session);

// 初始化 SQLite 數據庫（建表 + seed）
require('./db/database');

// ===== 啟動時自動安裝 git hooks（換電腦免手動安裝，失敗不影響伺服器） =====
execFile(process.execPath, [path.join(__dirname, 'scripts', 'install-hooks.js')], { windowsHide: true, timeout: 15000 }, (hookErr, stdout, stderr) => {
  if (stdout && stdout.trim()) console.log(stdout.trim());
  if (stderr && stderr.trim()) console.error(stderr.trim());
});

// ===== 啟動時自動建立預設管理員（僅全新環境第一次） =====
execFile(process.execPath, [path.join(__dirname, 'scripts', 'seed-admin.js')], { windowsHide: true, timeout: 15000 }, (seedErr, stdout, stderr) => {
  if (stdout && stdout.trim()) console.log(stdout.trim());
  if (stderr && stderr.trim()) console.error(stderr.trim());
});

// 路由模組
const skillsRouter = require('./routes/skills');
const { contoursRouter, contourImageRouter } = require('./routes/contours');
const ordersRouter = require('./routes/orders');
const dbViewerRouter = require('./routes/dbviewer');
const authRouter = require('./routes/auth/auth-router');
const usersRouter = require('./routes/auth/users-router');
const palletRouter = require('./routes/pallet');
const xlsBookingRouter = require('./routes/xls-booking');
const packingRouter = require('./routes/packing');
const { requireAuth, requireRole, requirePermission } = require('./routes/auth/middleware');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    // Express 預設不認得 .jfif 副檔名，會 fallback 成 application/octet-stream。
    // 這裡明確指定 image/jpeg，確保瀏覽器（含行動裝置）能正確渲染背景圖片。
    if (path.extname(filePath).toLowerCase() === '.jfif') {
      res.setHeader('Content-Type', 'image/jpeg');
    }
  }
}));

// ===== Session 中間件（登入系統用） =====
// 使用 SQLite 持久化 store（db/sessions.db）：
// - 伺服器重啟後登入狀態仍保留，不需重新登入
// - 多個 process / 重啟皆可共享 session
app.use(session({
  secret: process.env.SESSION_SECRET || 'agl-web-portal-dev-secret',
  resave: false,
  saveUninitialized: false,
  store: new SQLiteStore({
    db: 'sessions.db',
    dir: path.join(__dirname, 'db'),
    table: 'sessions'
  }),
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 8 // 8 小時
  }
}));

// 防止瀏覽器快取 API 回應（手機瀏覽器對 GET 請求可能回傳舊快取，導致新資料看不到）
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

// ===== API 路由掛載 =====
// 登入系統（公開：login 不需要登入；users 為 admin only，已在路由內保護）
app.use('/api/auth', authRouter);
app.use('/api/auth/users', usersRouter);

app.use('/api/skills', skillsRouter);
app.use('/api/contours', contoursRouter);
app.use('/api/contour-image', contourImageRouter);   // 保持舊路徑

// ===== 受保護路由：必須登入 =====
// 訂單：登入即可（requireAuth），內部另做角色/公司資料隔離與細粒度權限
app.use('/api/orders', requireAuth, ordersRouter);
// 打板計劃：僅限 admin / staff（內部員工操作）
app.use('/api/pallet', requireRole('admin', 'staff'), palletRouter);
// Shipper Role Project（空運單據工具）：登入即可使用
app.use('/api/xls-booking', requireAuth, xlsBookingRouter);
// 3D ULD Packing（打板優化）：登入即可使用
app.use('/api/packing', requireAuth, packingRouter);
// 資料庫：需具備 db_view 權限（admin/staff 預設開啟）
app.use('/api/db', requirePermission('db_view'), dbViewerRouter);

// ===== 伺服器啟動 =====
const HOST = process.env.HOST || '0.0.0.0';
const INITIAL_PORT = Number.isNaN(Number(process.env.PORT)) ? 3000 : Number(process.env.PORT || 3000);

function startServer(port) {
  const server = app.listen(port, HOST, () => {
    console.log(`服務器已啟動： http://${HOST}:${port}`);
    console.log(`內網可訪問地址： http://127.0.0.1:${port}`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      const nextPort = port + 1;
      console.warn(`Port ${port} 已被占用，正在嘗試 ${nextPort}...`);
      server.close(() => startServer(nextPort));
    } else {
      console.error('服務器啟動失敗：', err.message);
      process.exit(1);
    }
  });
}

// 啟動伺服器
startServer(INITIAL_PORT);