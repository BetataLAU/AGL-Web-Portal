const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const SQLiteStore = require('connect-sqlite3')(session);

// 初始化 SQLite 數據庫（建表 + seed）
require('./db/database');

// ===== 確保持久目錄（Railway Volume）就緒：首次啟動建立資料夾並複製模板 =====
// 本地（無 DATA_DIR）時此段為 no-op，維持原路徑。
const PERSIST_DIR = process.env.DATA_DIR;
if (PERSIST_DIR) {
  const templatesSrc = path.join(__dirname, 'data', 'templates');
  const templatesDst = path.join(PERSIST_DIR, 'templates');
  const workDst = path.join(PERSIST_DIR, 'work');
  const uploadsDst = path.join(PERSIST_DIR, 'uploads');
  const sessionsDst = path.join(PERSIST_DIR, 'db');
  [templatesDst, workDst, uploadsDst, sessionsDst].forEach((d) => fs.mkdirSync(d, { recursive: true }));
  // 模板是唯讀靜態檔：Volume 缺檔時從 repo 複製過去
  if (fs.existsSync(templatesSrc)) {
    fs.readdirSync(templatesSrc).forEach((f) => {
      const src = path.join(templatesSrc, f);
      const dst = path.join(templatesDst, f);
      if (!fs.existsSync(dst)) fs.copyFileSync(src, dst);
    });
  }
  console.log(`[persist] 使用持久目錄：${PERSIST_DIR}`);
}

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
const packingProjectsRouter = require('./routes/packing-projects');
const packingSolveRouter = require('./routes/packing-solve');
const packingSolutionsRouter = require('./routes/packing-solutions');
const packingPdfRouter = require('./routes/packing-pdf');
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
    // 靜態檔一律「重新驗證」（配合 Express 預設 ETag）：
    // 檔案沒變 → 304 用快取；檔案變了 → 下載新版。部署後立即生效，不再有「看不到更新」。
    res.setHeader('Cache-Control', 'no-cache');
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
    dir: process.env.SESSIONS_DIR || (process.env.DATA_DIR ? path.join(process.env.DATA_DIR, 'db') : path.join(__dirname, 'db')),
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
// ULD 裝箱專案管理（PRD §5）：登入即可使用
app.use('/api/packing', requireAuth, packingProjectsRouter);
// GA-LNS 非同步求解：登入即可使用
app.use('/api/packing', requireAuth, packingSolveRouter);
// 方案存檔（solutions）：登入即可使用
app.use('/api/packing', requireAuth, packingSolutionsRouter);
// 作業單 PDF 導出：登入即可使用
app.use('/api/packing', requireAuth, packingPdfRouter);
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