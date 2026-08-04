const express = require('express');
const db = require('../../db/database');
const router = express.Router();

// ===== 備註文件範本 API =====

// GET /api/orders/note-templates?search=
router.get('/', (req, res) => {
  const search = (req.query.search || '').trim();
  let sql = "SELECT id, name, content, strftime('%Y-%m-%dT%H:%M:%fZ', created_at) AS created_at FROM note_templates";
  const params = [];
  if (search) {
    sql += " WHERE name LIKE ?";
    params.push(`%${search}%`);
  }
  sql += " ORDER BY name ASC LIMIT 50";

  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ data: rows });
  });
});

// POST /api/orders/note-templates
router.post('/', (req, res) => {
  const { name, content } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: '範本名稱不可為空' });
  }
  if (!content || !content.trim()) {
    return res.status(400).json({ error: '範本內容不可為空' });
  }

  // 避免重複名稱：若已存在同名範本，直接更新內容
  db.get("SELECT id FROM note_templates WHERE name = ?", [name.trim()], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (row) {
      const updateStmt = db.prepare("UPDATE note_templates SET content = ? WHERE id = ?");
      updateStmt.run(content.trim(), row.id, function (updateErr) {
        if (updateErr) return res.status(500).json({ error: updateErr.message });
        res.json({ success: true, id: row.id, updated: true });
      });
      updateStmt.finalize();
      return;
    }
    const stmt = db.prepare("INSERT INTO note_templates (name, content) VALUES (?, ?)");
    stmt.run(name.trim(), content.trim(), function (insertErr) {
      if (insertErr) return res.status(500).json({ error: insertErr.message });
      res.json({ success: true, id: this.lastID, updated: false });
    });
    stmt.finalize();
  });
});

module.exports = router;