const express = require('express');
const db = require('../db/database');

// ===== SSE 即時推播 =====
const sseClients = [];

function broadcastMessagesChange(type, payload = {}) {
  const data = JSON.stringify({ type, ...payload });
  sseClients.forEach(client => {
    client.write(`event: messages_update\ndata: ${data}\n\n`);
  });
}

// ===== 論壇主題路由 =====
const threadsRouter = express.Router();

// API 2: 獲取論壇主題列表 (返回 ISO 8601 格式時間)
threadsRouter.get('/', (req, res) => {
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

// API 4: 取得單一主題與回覆
threadsRouter.get('/:id', (req, res) => {
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

// ===== 訊息（主題/回覆）路由 =====
const messagesRouter = express.Router();

// Guestbook live update stream
messagesRouter.get('/stream', (req, res) => {
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

// API 3: 新增論壇主題或回覆
messagesRouter.post('/', (req, res) => {
  const { user_name, title, category, content, parent_id } = req.body;
  if (!user_name || !content) {
    return res.status(400).json({ error: '請填寫名字與內容' });
  }

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

  if (!title || !category) {
    return res.status(400).json({ error: '請填寫主題標題與版區' });
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

// API 5: 修改留言 (UPDATE)
messagesRouter.put('/:id', (req, res) => {
  const { id } = req.params;
  const { user_name, content } = req.body;

  if (!user_name || !content) {
    return res.status(400).json({ error: '名字與內容不可為空' });
  }

  const stmt = db.prepare("UPDATE messages SET user_name = ?, content = ? WHERE id = ?");
  stmt.run(user_name, content, id, function (err) {
    if (err) return res.status(500).json({ error: err.message });
    broadcastMessagesChange('refresh');
    res.json({ success: true, changes: this.changes });
  });
  stmt.finalize();
});

// API 5: 刪除留言 (DELETE)
messagesRouter.delete('/:id', (req, res) => {
  const { id } = req.params;

  const stmt = db.prepare("DELETE FROM messages WHERE id = ?");
  stmt.run(id, function (err) {
    if (err) return res.status(500).json({ error: err.message });
    broadcastMessagesChange('refresh');
    res.json({ success: true, changes: this.changes });
  });
  stmt.finalize();
});

module.exports = { threadsRouter, messagesRouter };