const express = require('express');
const db = require('../db/database');
const router = express.Router();

// ===== 工具函數 =====
const MAWB_LATE_LABEL = '後補MAWB#';
const ORDER_NO_PREFIX = 'AGL-';

// 將舊版 ORD- 開頭的訂單編號轉為 AGL-（一次性資料遷移）
db.all("SELECT id, order_no FROM orders WHERE order_no LIKE 'ORD-%'", [], (err, rows) => {
  if (err) {
    console.error('訂單編號遷移查詢失敗:', err.message);
    return;
  }
  if (!rows || !rows.length) return;
  const stmt = db.prepare("UPDATE orders SET order_no = ? WHERE id = ?");
  rows.forEach(row => {
    const newNo = 'AGL-' + row.order_no.slice(4);
    stmt.run(newNo, row.id, (updateErr) => {
      if (updateErr) console.error(`訂單 ${row.id} 編號遷移失敗:`, updateErr.message);
    });
  });
  stmt.finalize();
  console.log(`已將 ${rows.length} 筆訂單編號由 ORD- 遷移至 AGL-`);
});

// 去除空格、連字號，取得 11 位純數字
function normalizeMawb(value) {
  if (value == null) return '';
  return String(value).replace(/[\s-]/g, '');
}

// 統一顯示格式 000-0000 0000
function formatMawb(value) {
  const digits = normalizeMawb(value);
  if (!/^\d{11}$/.test(digits)) return String(value || '');
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)} ${digits.slice(7, 11)}`;
}

// 驗證 MAWB#：格式 + checksum（suffix 前 7 位 mod 7 = 第 8 位）
function validateMawb(value) {
  const raw = (value == null ? '' : String(value)).trim();
  if (!raw) {
    return { valid: false, error: 'empty', formatted: '' };
  }
  if (raw === MAWB_LATE_LABEL) {
    return { valid: true, late: true, error: null, formatted: MAWB_LATE_LABEL };
  }

  const digits = normalizeMawb(raw);
  // 格式：11位全數字
  if (!/^\d{11}$/.test(digits)) {
    return { valid: false, error: '格式錯誤：MAWB# 必須是 11 位數字（如 000-00000000）', formatted: '' };
  }
  // prefix 介於 001-999
  const prefix = digits.slice(0, 3);
  const prefixNum = parseInt(prefix, 10);
  if (prefixNum < 1 || prefixNum > 999) {
    return { valid: false, error: '格式錯誤：MAWB# 前 3 位（prefix）必須介於 001-999', formatted: '' };
  }
  // checksum：suffix 前 7 位 mod 7 = 第 8 位
  const suffix = digits.slice(3);
  const first7 = parseInt(suffix.slice(0, 7), 10);
  const checkDigit = parseInt(suffix.charAt(7), 10);
  const modResult = first7 % 7;
  if (modResult !== checkDigit) {
    return { valid: false, error: 'MAWB# 有問題，請再輸入', formatted: '' };
  }

  return { valid: true, late: false, error: null, formatted: formatMawb(digits) };
}

function generateOrderNo(callback) {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const prefix = `${ORDER_NO_PREFIX}${yyyy}${mm}${dd}-`;

  db.get(
    "SELECT order_no FROM orders WHERE order_no LIKE ? ORDER BY order_no DESC LIMIT 1",
    [`${prefix}%`],
    (err, row) => {
      if (err) return callback(err);
      let seq = 1;
      if (row) {
        const lastSeq = parseInt(row.order_no.split('-').pop(), 10);
        if (!isNaN(lastSeq)) seq = lastSeq + 1;
      }
      callback(null, `${prefix}${String(seq).padStart(3, '0')}`);
    }
  );
}

function getCompanyName(id, cb) {
  if (!id) return cb(null, null);
  db.get("SELECT name FROM companies WHERE id = ?", [id], (err, row) => {
    if (err) return cb(err);
    cb(null, row ? row.name : null);
  });
}

function serializeOrder(row) {
  let powerItems = null;
  if (row.power_items) {
    try {
      powerItems = JSON.parse(row.power_items);
    } catch (e) {
      powerItems = null;
    }
  }
  return {
    id: row.id,
    order_no: row.order_no,
    order_type: row.order_type,
    mawb: row.mawb,
    hawb: row.hawb,
    pickup_no: row.pickup_no,
    pickup_company_id: row.pickup_company_id,
    pickup_company_name: row.pickup_company_name || null,
    delivery_company_id: row.delivery_company_id,
    delivery_company_name: row.delivery_company_name || null,
    cargo_desc: row.cargo_desc,
    quantity: row.quantity,
    weight_kg: row.weight_kg,
    cbm: row.cbm,
    power_type: row.power_type,
    power_code: row.power_code,
    power_items: powerItems,
    urgent: row.urgent,
    receiver_name: row.receiver_name,
    receiver_phone: row.receiver_phone,
    address: row.address,
    notes: row.notes,
    transport_company: row.transport_company,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

// ===== 公司/地點 API =====
// GET /api/orders/companies?search=&category=
router.get('/companies', (req, res) => {
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
    sql += " AND category = ?";
    params.push(category);
  }
  sql += " ORDER BY name ASC LIMIT 100";

  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ data: rows });
  });
});

// POST /api/orders/companies
router.post('/companies', (req, res) => {
  const { category = 'customer', name, address = '', contact_person = '', phone = '', email = '', notes = '' } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: '公司名稱不可為空' });
  }

  const stmt = db.prepare(
    "INSERT INTO companies (category, name, address, contact_person, phone, email, notes) VALUES (?, ?, ?, ?, ?, ?, ?)"
  );
  stmt.run(category, name.trim(), address, contact_person, phone, email, notes, function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true, id: this.lastID });
  });
  stmt.finalize();
});

// ===== 範本 API =====
// GET /api/orders/templates?company_id=
router.get('/templates', (req, res) => {
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
router.post('/templates', (req, res) => {
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
router.delete('/templates/:id', (req, res) => {
  const { id } = req.params;
  const stmt = db.prepare("DELETE FROM templates WHERE id = ?");
  stmt.run(id, function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true, changes: this.changes });
  });
  stmt.finalize();
});

// ===== 訂單 API =====
// GET /api/orders?search=&status=
router.get('/', (req, res) => {
  const search = (req.query.search || '').trim();
  const status = (req.query.status || '').trim();
  const params = [];
  let sql = `
    SELECT o.*,
           pc.name AS pickup_company_name,
           dc.name AS delivery_company_name,
           strftime('%Y-%m-%dT%H:%M:%fZ', o.created_at) AS created_at,
           strftime('%Y-%m-%dT%H:%M:%fZ', o.updated_at) AS updated_at
    FROM orders o
    LEFT JOIN companies pc ON pc.id = o.pickup_company_id
    LEFT JOIN companies dc ON dc.id = o.delivery_company_id
    WHERE 1=1
  `;
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

// POST /api/orders
router.post('/', (req, res) => {
  const {
    order_type, mawb, hawb, pickup_no,
    pickup_company_id, delivery_company_id,
    cargo_desc, quantity, weight_kg, cbm,
    power_type, power_code, power_items, urgent,
    receiver_name, receiver_phone, address,
    notes, transport_company, status = 'pending'
  } = req.body;

  if (!order_type || !hawb || !pickup_no) {
    return res.status(400).json({ error: '請填寫訂單類型、HAWB# 與客戶提貨號' });
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
        order_no, order_type, mawb, hawb, pickup_no,
        pickup_company_id, delivery_company_id,
        cargo_desc, quantity, weight_kg, cbm,
        power_type, power_code, power_items, urgent,
        receiver_name, receiver_phone, address,
        notes, transport_company, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      orderNo, order_type, finalMawb, hawb, pickup_no,
      pickup_company_id || null, delivery_company_id || null,
      cargo_desc, quantity, weight_kg, cbm,
      power_type, power_code || null,
      power_items ? JSON.stringify(power_items) : null,
      urgent,
      receiver_name, receiver_phone, address,
      notes || '', transport_company || '', status,
      function (insertErr) {
        if (insertErr) return res.status(500).json({ error: insertErr.message });
        res.json({ success: true, id: this.lastID, order_no: orderNo });
      }
    );
    stmt.finalize();
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

// GET /api/orders/:id
router.get('/:id', (req, res) => {
  const { id } = req.params;
  db.get(`
    SELECT o.*,
           pc.name AS pickup_company_name,
           dc.name AS delivery_company_name,
           strftime('%Y-%m-%dT%H:%M:%fZ', o.created_at) AS created_at,
           strftime('%Y-%m-%dT%H:%M:%fZ', o.updated_at) AS updated_at
    FROM orders o
    LEFT JOIN companies pc ON pc.id = o.pickup_company_id
    LEFT JOIN companies dc ON dc.id = o.delivery_company_id
    WHERE o.id = ?
  `, [id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: 'Order not found' });
    res.json({ data: serializeOrder(row) });
  });
});

// PUT /api/orders/:id
router.put('/:id', (req, res) => {
  const { id } = req.params;
  const {
    order_type, mawb, hawb, pickup_no,
    pickup_company_id, delivery_company_id,
    cargo_desc, quantity, weight_kg, cbm,
    power_type, power_code, power_items, urgent,
    receiver_name, receiver_phone, address,
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
      order_type = ?, mawb = ?, hawb = ?, pickup_no = ?,
      pickup_company_id = ?, delivery_company_id = ?,
      cargo_desc = ?, quantity = ?, weight_kg = ?, cbm = ?,
      power_type = ?, power_code = ?, power_items = ?, urgent = ?,
      receiver_name = ?, receiver_phone = ?, address = ?,
      notes = ?, transport_company = ?, status = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);
  stmt.run(
    order_type, finalMawb, hawb, pickup_no,
    pickup_company_id || null, delivery_company_id || null,
    cargo_desc, quantity, weight_kg, cbm,
    power_type, power_code || null,
    power_items ? JSON.stringify(power_items) : null,
    urgent,
    receiver_name, receiver_phone, address,
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