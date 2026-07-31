const express = require('express');
const path = require('path');

// 初始化 SQLite 數據庫（建表 + seed）
require('./db/database');

// 路由模組
const skillsRouter = require('./routes/skills');
const { contoursRouter, contourImageRouter } = require('./routes/contours');
const { threadsRouter, messagesRouter } = require('./routes/forum');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ===== API 路由掛載 =====
app.use('/api/skills', skillsRouter);
app.use('/api/contours', contoursRouter);
app.use('/api/contour-image', contourImageRouter);   // 保持舊路徑
app.use('/api/threads', threadsRouter);
app.use('/api/messages', messagesRouter);

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