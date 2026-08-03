const express = require('express');
const db = require('../../db/database');
const router = express.Router();
const {
  MAWB_LATE_LABEL,
  validateMawb,
  generateOrderNo,
  serializeOrder,
  ORDER_SELECT_SQL
} = require('./utils');

// ===== 訂單 API =====
// GET /api/orders?search=&status=
router.get('/', (req, res) => {
  const search = (req.query.search || '').trim();
  const status = (req.query.status || '').trim();
  const params = [];
  let sql = ORDER_SELECT_SQL + ' WHERE 1=1';
  if (search) {
    sql += " AND (o.order_no LIKE ? OR o.mawb LIKE ? OR o.hawb LIKE ? OR o.pickup_no LIKE ? OR pc.name LIKE ? OR dc.name LIKE ? OR o.transport_company LIKE ?)";
    const like = `%${search}%`;
    params.push(like, like, like, like, like, like, like);
  }
  if (status) {
    sql += " AND o.status = ?";
    params.push(status);
  }
  sql += " ORDER BY o.created_at DESC LIMIT 100";

  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ data: rows.map(serializeOrder) });
  });
});

// GET /api/orders/check-duplicate?mawb=&hawb=&pickup_no=&exclude_id=
router.get('/check-duplicate', (req, res) => {
  const mawb = (req.query.mawb || '').trim();
  const hawb = (req.query.hawb || '').trim();
  const pickupNo = (req.query.pickup_no || '').trim();
  const excludeId = req.query.exclude_id ? parseInt(req.query.exclude_id, 10) : null;

  const conditions = [];
  const params = [];
  if (mawb && mawb !== MAWB_LATE_LABEL) {
    conditions.push('o.mawb = ?');
    params.push(mawb);
  }
  if (hawb) {
    conditions.push('o.hawb = ?');
    params.push(hawb);
  }
  if (pickupNo) {
    conditions.push('o.pickup_no = ?');
    params.push(pickupNo);
  }
  if (excludeId) {
    conditions.push('o.id != ?');
    params.push(excludeId);
  }
  if (conditions.length === 0) {
    return res.json({ data: [] });
  }

  const sql = `
    SELECT o.*,
           pc.name AS pickup_company_name,
           dc.name AS delivery_company_name,
           strftime('%Y-%m-%dT%H:%M:%fZ', o.created_at) AS created_at,
           strftime('%Y-%m-%dT%H:%M:%fZ', o.updated_at) AS updated_at
    FROM orders o
    LEFT JOIN companies pc ON pc.id = o.pickup_company_id
    LEFT JOIN companies dc ON dc.id = o.delivery_company_id
    WHERE ${conditions.join(' OR ')}
    ORDER BY o.created_at DESC LIMIT 20
  `;

  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ data: rows.map(serializeOrder) });
  });
});

// POST /api/orders
router.post('/', (req, res) => {
  const {
    order_type, mawb, hawb, pickup_no, pickup_datetime,
    pickup_company_id, delivery_company_id,
    cargo_desc, quantity, weight_kg, cbm,
    power_type, power_code, power_items, urgent,
    receiver_name, receiver_phone, address, receiver_note, contact_note,
    notes, transport_company, status = 'pending'
  } = req.body;

  if (!order_type || !pickup_no) {
    return res.status(400).json({ error: '請填寫訂單類型與客戶提貨號' });
  }
  // MAWB# 驗證：可留空代表「後補MAWB#」，有值則必須通過格式 + checksum 驗證
  let finalMawb = MAWB_LATE_LABEL;
  if (mawb != null && String(mawb).trim() !== '') {
    const mawbResult = validateMawb(mawb);
    if (!mawbResult.valid) {
      return res.status(400).json({ error: 'MAWB# 有問題，請再輸入' });
    }
    finalMawb = mawbResult.formatted;
  }
  if (!pickup_company_id && !delivery_company_id) {
    return res.status(400).json({ error: '請選擇收/送貨公司' });
  }
  if (!cargo_desc || !quantity || !weight_kg || !cbm) {
    return res.status(400).json({ error: '請填寫貨品描述、件數、重量與 CBM' });
  }
  if (!power_type) {
    return res.status(400).json({ error: '請選擇電力分類' });
  }
  if (!urgent) {
    return res.status(400).json({ error: '請選擇是否趕機' });
  }
  if (!receiver_name || !receiver_phone || !address) {
    return res.status(400).json({ error: '請填寫收貨人、聯絡電話與地址' });
  }

  generateOrderNo((err, orderNo) => {
    if (err) return res.status(500).json({ error: err.message });

    const stmt = db.prepare(`
      INSERT INTO orders (
        order_no, order_type, mawb, hawb, pickup_no, pickup_datetime,
        pickup_company_id, delivery_company_id,
        cargo_desc, quantity, weight_kg, cbm,
        power_type, power_code, power_items, urgent,
        receiver_name, receiver_phone, address, receiver_note, contact_note,
        notes, transport_company, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      orderNo, order_type, finalMawb, hawb, pickup_no,
      pickup_datetime || null,
      pickup_company_id || null, delivery_company_id || null,
      cargo_desc, quantity, weight_kg, cbm,
      power_type, power_code || null,
      power_items ? JSON.stringify(power_items) : null,
      urgent,
      receiver_name, receiver_phone, address,
      receiver_note || '', contact_note || '',
      notes || '', transport_company || '', status,
      function (insertErr) {
        if (insertErr) return res.status(500).json({ error: insertErr.message });
        res.json({ success: true, id: this.lastID, order_no: orderNo });
      }
    );
    stmt.finalize();
  });
});

// GET /api/orders/:id
router.get('/:id', (req, res) => {
  const { id } = req.params;
  db.get(ORDER_SELECT_SQL + ' WHERE o.id = ?', [id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: 'Order not found' });
    res.json({ data: serializeOrder(row) });
  });
});

// PUT /api/orders/:id
router.put('/:id', (req, res) => {
  const { id } = req.params;
  const {
    order_type, mawb, hawb, pickup_no, pickup_datetime,
    pickup_company_id, delivery_company_id,
    cargo_desc, quantity, weight_kg, cbm,
    power_type, power_code, power_items, urgent,
    receiver_name, receiver_phone, address, receiver_note, contact_note,
    notes, transport_company, status
  } = req.body;

  if (!status) {
    return res.status(400).json({ error: '缺少狀態欄位' });
  }
  // MAWB# 驗證：可留空代表「後補MAWB#」，有值則必須通過格式 + checksum 驗證
  let finalMawb = MAWB_LATE_LABEL;
  if (mawb != null && String(mawb).trim() !== '') {
    const mawbResult = validateMawb(mawb);
    if (!mawbResult.valid) {
      return res.status(400).json({ error: 'MAWB# 有問題，請再輸入' });
    }
    finalMawb = mawbResult.formatted;
  }

  const stmt = db.prepare(`
    UPDATE orders SET
      order_type = ?, mawb = ?, hawb = ?, pickup_no = ?, pickup_datetime = ?,
      pickup_company_id = ?, delivery_company_id = ?,
      cargo_desc = ?, quantity = ?, weight_kg = ?, cbm = ?,
      power_type = ?, power_code = ?, power_items = ?, urgent = ?,
      receiver_name = ?, receiver_phone = ?, address = ?, receiver_note = ?, contact_note = ?,
      notes = ?, transport_company = ?, status = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);
  stmt.run(
    order_type, finalMawb, hawb, pickup_no,
    pickup_datetime || null,
    pickup_company_id || null, delivery_company_id || null,
    cargo_desc, quantity, weight_kg, cbm,
    power_type, power_code || null,
    power_items ? JSON.stringify(power_items) : null,
    urgent,
    receiver_name, receiver_phone, address,
    receiver_note || '', contact_note || '',
    notes || '', transport_company || '', status,
    id,
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, changes: this.changes });
    }
  );
  stmt.finalize();
});

// DELETE /api/orders/:id
router.delete('/:id', (req, res) => {
  const { id } = req.params;
  const stmt = db.prepare("DELETE FROM orders WHERE id = ?");
  stmt.run(id, function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true, changes: this.changes });
  });
  stmt.finalize();
});

module.exports = router;