const express = require('express');
const db = require('../../db/database');
const router = express.Router();

// ===== 公司/地點 API =====
// category 支援多值：逗號分隔字串（如 "customer,warehouse"）或陣列
function normalizeCategory(value) {
  if (Array.isArray(value)) {
    // 過濾空值並去重
    const uniq = [...new Set(value.filter(v => v && String(v).trim()))];
    return uniq.join(',');
  }
  return String(value || '').trim();
}

// GET /api/orders/companies?search=&category=
router.get('/', (req, res) => {
  const search = (req.query.search || '').trim();
  const category = (req.query.category || '').trim();
  const params = [];
  let sql = "SELECT id, category, name, address, contact_person, phone, email, notes, strftime('%Y-%m-%dT%H:%M:%fZ', created_at) AS created_at FROM companies WHERE 1=1";
  if (search) {
    sql += " AND (name LIKE ? OR contact_person LIKE ? OR phone LIKE ?)";
    const like = `%${search}%`;
    params.push(like, like, like);
  }
  if (category) {
    // 多值字串 → 只要其中一個類別相符就命中（LIKE）
    sql += " AND category LIKE ?";
    params.push(`%${category}%`);
  }
  sql += " ORDER BY name ASC LIMIT 100";

  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ data: rows });
  });
});

// POST /api/orders/companies
router.post('/', (req, res) => {
  const { category = 'customer', name, address = '', contact_person = '', phone = '', email = '', notes = '' } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: '公司名稱不可為空' });
  }
  const finalCategory = normalizeCategory(category) || 'customer';

  const stmt = db.prepare(
    "INSERT INTO companies (category, name, address, contact_person, phone, email, notes) VALUES (?, ?, ?, ?, ?, ?, ?)"
  );
  stmt.run(finalCategory, name.trim(), address, contact_person, phone, email, notes, function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true, id: this.lastID });
  });
  stmt.finalize();
});

// PUT /api/orders/companies/:id（更新公司資料）
router.put('/:id', (req, res) => {
  const { id } = req.params;
  const { category, name, address = '', contact_person = '', phone = '', email = '', notes = '' } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: '公司名稱不可為空' });
  }
  const finalCategory = normalizeCategory(category) || 'customer';

  const stmt = db.prepare(`
    UPDATE companies SET
      category = ?, name = ?, address = ?, contact_person = ?, phone = ?, email = ?, notes = ?
    WHERE id = ?
  `);
  stmt.run(finalCategory, name.trim(), address, contact_person, phone, email, notes, id, function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true, changes: this.changes });
  });
  stmt.finalize();
});

module.exports = router;