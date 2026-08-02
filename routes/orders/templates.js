const express = require('express');
const db = require('../../db/database');
const router = express.Router();

// ===== 範本 API =====
// GET /api/orders/templates?company_id=
router.get('/', (req, res) => {
  const companyId = req.query.company_id ? parseInt(req.query.company_id, 10) : null;
  const params = [];
  let sql = `
    SELECT t.id, t.name, t.company_id, c.name AS company_name,
           t.cargo_desc, t.quantity, t.weight_kg, t.cbm,
           t.power_type, t.receiver_name, t.receiver_phone, t.notes,
           strftime('%Y-%m-%dT%H:%M:%fZ', t.created_at) AS created_at
    FROM templates t
    LEFT JOIN companies c ON c.id = t.company_id
    WHERE 1=1
  `;
  if (companyId) {
    sql += " AND t.company_id = ?";
    params.push(companyId);
  }
  sql += " ORDER BY c.name ASC, t.name ASC";

  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ data: rows });
  });
});

// POST /api/orders/templates
router.post('/', (req, res) => {
  const { name, company_id, cargo_desc = '', quantity = null, weight_kg = null, cbm = null, power_type = 'no', receiver_name = '', receiver_phone = '', notes = '' } = req.body;
  if (!name || !name.trim() || !company_id) {
    return res.status(400).json({ error: '範本名稱與公司為必填' });
  }

  const stmt = db.prepare(
    "INSERT INTO templates (name, company_id, cargo_desc, quantity, weight_kg, cbm, power_type, receiver_name, receiver_phone, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  );
  stmt.run(name.trim(), company_id, cargo_desc, quantity, weight_kg, cbm, power_type, receiver_name, receiver_phone, notes, function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true, id: this.lastID });
  });
  stmt.finalize();
});

// DELETE /api/orders/templates/:id
router.delete('/:id', (req, res) => {
  const { id } = req.params;
  const stmt = db.prepare("DELETE FROM templates WHERE id = ?");
  stmt.run(id, function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true, changes: this.changes });
  });
  stmt.finalize();
});

module.exports = router;