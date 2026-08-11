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
  let sql = "SELECT id, category, name, address, contact_person, phone, email, notes, company_code, strftime('%Y-%m-%dT%H:%M:%fZ', created_at) AS created_at FROM companies WHERE 1=1";
  if (search) {
    sql += " AND (name LIKE ? OR contact_person LIKE ? OR phone LIKE ? OR company_code LIKE ?)";
    const like = `%${search}%`;
    params.push(like, like, like, like);
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
  const { category = 'customer', name, address = '', contact_person = '', phone = '', email = '', notes = '', company_code = '' } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: '公司名稱不可為空' });
  }
  const finalCategory = normalizeCategory(category) || 'customer';
  // company_code 自動轉大寫；空字串存 NULL
  const finalCode = company_code ? String(company_code).trim().toUpperCase() : null;

  // 檢查 company_code 是否已被其他公司使用（登入用，不可重複）
  if (finalCode) {
    db.get("SELECT id FROM companies WHERE company_code = ?", [finalCode], (dupErr, dupRow) => {
      if (dupErr) return res.status(500).json({ error: dupErr.message });
      if (dupRow) return res.status(400).json({ error: '此 Company Code 已被其他公司使用' });

      const stmt = db.prepare(
        "INSERT INTO companies (category, name, address, contact_person, phone, email, notes, company_code) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      );
      stmt.run(finalCategory, name.trim(), address, contact_person, phone, email, notes, finalCode, function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, id: this.lastID });
      });
      stmt.finalize();
    });
    return;
  }

  const stmt = db.prepare(
    "INSERT INTO companies (category, name, address, contact_person, phone, email, notes, company_code) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  );
  stmt.run(finalCategory, name.trim(), address, contact_person, phone, email, notes, null, function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true, id: this.lastID });
  });
  stmt.finalize();
});

// PUT /api/orders/companies/:id（更新公司資料）
router.put('/:id', (req, res) => {
  const { id } = req.params;
  const { category, name, address = '', contact_person = '', phone = '', email = '', notes = '', company_code } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: '公司名稱不可為空' });
  }
  const finalCategory = normalizeCategory(category) || 'customer';
  // company_code 未傳入 → 保留原值；有值 → 轉大寫；空字串 → 清除
  const storeCode = (value) => {
    const trimmed = String(value == null ? '' : value).trim();
    return trimmed ? trimmed.toUpperCase() : null;
  };

  const finishUpdate = () => {
    const stmt = db.prepare(`
      UPDATE companies SET
        category = ?, name = ?, address = ?, contact_person = ?, phone = ?, email = ?, notes = ?, company_code = ?
      WHERE id = ?
    `);
    stmt.run(finalCategory, name.trim(), address, contact_person, phone, email, notes, codeValue, id, function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, changes: this.changes });
    });
    stmt.finalize();
  };

  // 決定 company_code 處理方式
  let codeValue;
  if (company_code === undefined) {
    // 未傳入 → 保留原值（需要先查詢目前值）
    db.get("SELECT company_code FROM companies WHERE id = ?", [id], (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      codeValue = row ? row.company_code : null;
      finishUpdate();
    });
    return;
  }
  codeValue = storeCode(company_code);
  // 有給值 → 檢查是否與其他公司重複（排除自己）
  if (codeValue) {
    db.get("SELECT id FROM companies WHERE company_code = ? AND id != ?", [codeValue, id], (dupErr, dupRow) => {
      if (dupErr) return res.status(500).json({ error: dupErr.message });
      if (dupRow) return res.status(400).json({ error: '此 Company Code 已被其他公司使用' });
      finishUpdate();
    });
    return;
  }
  finishUpdate();
});

module.exports = router;