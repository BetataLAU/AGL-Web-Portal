const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');

const app = express();
const PORT = process.env.PORT || 3000;

const CONTOUR_DIR = path.join(__dirname, 'public', 'image', 'HACTL_contour_spec');

// Security middleware
app.use(helmet());
app.use(rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200, // limit each IP to 200 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false
}));

app.use(express.json({ limit: '10kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Simple health endpoint for readiness checks
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// 初始化 SQLite 數據庫
const dbPath = path.join(__dirname, 'database.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) console.error('數據庫連接失敗:', err.message);
  else console.log('已成功連接 SQLite 數據庫', dbPath);
});

// SQLite performance and concurrency tweaks
db.run("PRAGMA journal_mode = WAL;", [], (err) => {
  if (err) console.warn('Unable to set journal_mode WAL:', err.message);
  else console.log('SQLite PRAGMA journal_mode set to WAL');
});
// Use NORMAL synchronous for better write throughput while keeping durability reasonable
db.run("PRAGMA synchronous = NORMAL;", [], (err) => {
  if (err) console.warn('Unable to set synchronous PRAGMA:', err.message);
  else console.log('SQLite PRAGMA synchronous set to NORMAL');
});

// 建表與預設數據初始化
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS skills (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT,
      name TEXT,
      level INTEGER
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_name TEXT,
      title TEXT,
      category TEXT,
      content TEXT,
      parent_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.all("PRAGMA table_info(messages)", [], (err, rows) => {
    if (err) {
      console.error('PRAGMA table_info failed:', err.message);
    } else {
      const columns = rows.map(column => column.name);
      if (!columns.includes('parent_id')) {
        db.run("ALTER TABLE messages ADD COLUMN parent_id INTEGER", (alterErr) => {
          if (alterErr) {
            console.error('Failed to add parent_id column:', alterErr.message);
          } else {
            console.log('Added parent_id column to messages table');
          }
        });
      }
      if (!columns.includes('title')) {
        db.run("ALTER TABLE messages ADD COLUMN title TEXT", (alterErr) => {
          if (alterErr) {
            console.error('Failed to add title column:', alterErr.message);
          } else {
            console.log('Added title column to messages table');
          }
        });
      }
      if (!columns.includes('category')) {
        db.run("ALTER TABLE messages ADD COLUMN category TEXT", (alterErr) => {
          if (alterErr) {
            console.error('Failed to add category column:', alterErr.message);
          } else {
            console.log('Added category column to messages table');
          }
        });
      }
    }
  });

  // 插入初始技能資料（若表格為空）
  db.get("SELECT COUNT(*) AS count FROM skills", (err, row) => {
    if (row && row.count === 0) {
      const stmt = db.prepare("INSERT INTO skills (category, name, level) VALUES (?, ?, ?)");
      stmt.run("核心能力", "多模態理解與生成", 95);
      stmt.run("核心能力", "程式碼編寫與除錯", 92);
      stmt.run("核心能力", "邏輯推理與分析", 90);
      stmt.run("長處", "上下文處理能力", 95);
      stmt.run("長處", "自動化工作流程整合", 88);
      stmt.finalize();
    }
  });

});

// API 1: 獲取 Gemini 技能與資料
app.get('/api/skills', (req, res) => {
  db.all("SELECT * FROM skills", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ data: rows });
  });
});

// API 1.5: 獲取 Contour 圖片列表，可搜尋型號或檔名
app.get('/api/contours', (req, res) => {
  const query = (req.query.q || '').trim().toLowerCase();
  fs.readdir(CONTOUR_DIR, (err, files) => {
    if (err) {
      console.error('Contour API error:', err);
      return res.status(500).json({ error: err.message });
    }

    const result = files
      .filter(name => /\.(jpe?g|png|gif|webp)$/i.test(name))
      .map(name => {
        const cleanName = name.replace(/\.[^/.]+$/, '');
        const code = cleanName.split(/\s|-/)[0] || cleanName;
        return {
          filename: name,
          code,
          title: cleanName
        };
      })
      .filter(item => {
        if (!query) return true;
        const normalized = `${item.title} ${item.code}`.toLowerCase();
        return normalized.includes(query);
      })
      .sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' }));

    res.json({ data: result });
  });
});

// API: Contour Autocomplete Suggestions（新增）
app.get('/api/contours/suggestions', (req, res) => {
  const query = (req.query.q || '').trim().toLowerCase();
  fs.readdir(CONTOUR_DIR, (err, files) => {
    if (err) return res.status(500).json({ error: err.message });

    const allCodes = files
      .filter(name => /\.(jpe?g|png|gif|webp)$/i.test(name))
      .map(name => {
        const cleanName = name.replace(/\.[^/.]+$/, '');
        return cleanName.split(/[\s-]/)[0] || cleanName;
      })
      .filter((value, index, self) => self.indexOf(value) === index); // 去重

    const matched = query
      ? allCodes.filter(code => code.toLowerCase().includes(query))
      : allCodes;

    res.json({ suggestions: matched.slice(0, 10) });
  });
});

const sseClients = [];

function broadcastMessagesChange(type, payload = {}) {
  const data = JSON.stringify({ type, ...payload });
  sseClients.forEach(client => {
    client.write(`event: messages_update\ndata: ${data}\n\n`);
  });
}

// Guestbook live update stream
app.get('/api/messages/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  res.write('retry: 10000\n\n');

  sseClients.push(res);
  req.on('close', () => {
    const index = sseClients.indexOf(res);
    if (index > -1) sseClients.splice(index, 1);
  });
});

// ✅ 獨立圖片服務路由，避開 URL 空格問題
app.get('/api/contour-image/:filename', (req, res) => {
  const filename = req.params.filename;
  const safeName = path.basename(filename);
  const filepath = path.join(CONTOUR_DIR, safeName);

  if (!fs.existsSync(filepath)) {
    return res.status(404).json({ error: 'Image not found' });
  }

  const ext = path.extname(filepath).toLowerCase();
  const mimeTypes = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp'
  };
  const contentType = mimeTypes[ext] || 'application/octet-stream';

  res.setHeader('Content-Type', contentType);
  res.sendFile(filepath);
});

// API 2: 獲取論壇主題列表 (返回 ISO 8601 格式時間)
app.get('/api/threads', (req, res) => {
  const category = (req.query.category || '').trim();
  const params = [];
  let sql = "SELECT id, user_name, title, category, content, strftime('%Y-%m-%dT%H:%M:%fZ', created_at) AS created_at FROM messages WHERE parent_id IS NULL";
  if (category) {
    sql += " AND category = ?";
    params.push(category);
  }
  sql += " ORDER BY created_at DESC LIMIT 50";

  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ data: rows });
  });
});

// API 3: 新增論壇主題或回覆
app.post('/api/messages', [
  body('user_name').trim().isLength({ min: 1, max: 50 }).withMessage('請填寫名字 (1-50 字元)'),
  body('content').trim().isLength({ min: 1, max: 5000 }).withMessage('內容不可為空且不可過長'),
  body('parent_id').optional().isInt({ min: 1 }).withMessage('parent_id 必須為正整數'),
  body('title').if((value, { req }) => !req.body.parent_id).trim().isLength({ min: 1, max: 200 }).withMessage('請填寫主題標題 (1-200 字元)'),
  body('category').if((value, { req }) => !req.body.parent_id).trim().isLength({ min: 1, max: 50 }).withMessage('請填寫版區')
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { user_name, title, category, content, parent_id } = req.body;

  if (parent_id) {
    const stmt = db.prepare("INSERT INTO messages (user_name, content, parent_id) VALUES (?, ?, ?)");
    stmt.run(user_name, content, parent_id, function (err) {
      if (err) return res.status(500).json({ error: err.message });

      const newReply = {
        id: this.lastID,
        user_name,
        content,
        parent_id,
        created_at: new Date().toISOString()
      };
      broadcastMessagesChange('new_reply', { reply: newReply, thread_id: parent_id });
      res.json({ success: true, id: this.lastID, reply: newReply });
    });
    stmt.finalize();
    return;
  }

  const stmt = db.prepare("INSERT INTO messages (user_name, title, category, content) VALUES (?, ?, ?, ?)");
  stmt.run(user_name, title, category, content, function (err) {
    if (err) return res.status(500).json({ error: err.message });

    const newThread = {
      id: this.lastID,
      user_name,
      title,
      category,
      content,
      parent_id: null,
      created_at: new Date().toISOString()
    };
    broadcastMessagesChange('new_thread', { thread: newThread });
    res.json({ success: true, id: this.lastID, thread: newThread });
  });
  stmt.finalize();
});

const HOST = process.env.HOST || '0.0.0.0';
const INITIAL_PORT = parseInt(process.env.PORT, 10) || 3000;

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

// Start server (after module initialization)
startServer(INITIAL_PORT);

// Graceful shutdown: close DB before exit
function shutdown() {
  console.log('Shutting down...');
  db.close((err) => {
    if (err) console.error('Error closing database:', err.message);
    else console.log('Database connection closed.');
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// API 4: 取得單一主題與回覆
app.get('/api/threads/:id', (req, res) => {
  const { id } = req.params;
  db.get("SELECT id, user_name, title, category, content, parent_id, strftime('%Y-%m-%dT%H:%M:%fZ', created_at) AS created_at FROM messages WHERE id = ?", [id], (err, thread) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!thread) return res.status(404).json({ error: 'Thread not found' });

    db.all("SELECT id, user_name, content, parent_id, strftime('%Y-%m-%dT%H:%M:%fZ', created_at) AS created_at FROM messages WHERE parent_id = ? ORDER BY created_at ASC", [id], (err2, replies) => {
      if (err2) return res.status(500).json({ error: err2.message });
      res.json({ thread, replies });
    });
  });
});

// API 5: 修改留言 (UPDATE)
app.put('/api/messages/:id', [
  body('user_name').trim().isLength({ min: 1, max: 50 }).withMessage('名字長度必須在1到50字元'),
  body('content').trim().isLength({ min: 1, max: 5000 }).withMessage('內容不可為空')
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { id } = req.params;
  const { user_name, content } = req.body;

  const stmt = db.prepare("UPDATE messages SET user_name = ?, content = ? WHERE id = ?");
  stmt.run(user_name, content, id, function (err) {
    if (err) return res.status(500).json({ error: err.message });
    broadcastMessagesChange('refresh');
    res.json({ success: true, changes: this.changes });
  });
  stmt.finalize();
});

// API 5: 刪除留言 (DELETE)
app.delete('/api/messages/:id', (req, res) => {
  const { id } = req.params;

  const stmt = db.prepare("DELETE FROM messages WHERE id = ?");
  stmt.run(id, function (err) {
    if (err) return res.status(500).json({ error: err.message });
    broadcastMessagesChange('refresh');
    res.json({ success: true, changes: this.changes });
  });
  stmt.finalize();
});