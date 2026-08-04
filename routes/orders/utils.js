// ===== 訂單系統共用工具 =====
const db = require('../../db/database');

const MAWB_LATE_LABEL = '後補MAWB#';
const ORDER_NO_PREFIX = 'AGL-';

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

// 訂單序列化（附加公司名稱、解析 power_items）
function serializeOrder(row) {
  let powerItems = null;
  if (row.power_items) {
    try {
      powerItems = JSON.parse(row.power_items);
    } catch (e) {
      powerItems = null;
    }
  }
  let cbmDimensions = null;
  if (row.cbm_dimensions) {
    try {
      cbmDimensions = JSON.parse(row.cbm_dimensions);
    } catch (e) {
      cbmDimensions = null;
    }
  }
  return {
    id: row.id,
    order_no: row.order_no,
    order_type: row.order_type,
    mawb: row.mawb,
    hawb: row.hawb,
    pickup_no: row.pickup_no,
    pickup_datetime: row.pickup_datetime || null,
    customer_company_id: row.customer_company_id,
    customer_company_name: row.customer_company_name || null,
    pickup_company_id: row.pickup_company_id,
    pickup_company_name: row.pickup_company_name || null,
    delivery_company_id: row.delivery_company_id,
    delivery_company_name: row.delivery_company_name || null,
    cargo_desc: row.cargo_desc,
    quantity: row.quantity,
    weight_kg: row.weight_kg,
    cbm: row.cbm,
    cbm_dimensions: cbmDimensions,
    power_type: row.power_type,
    power_code: row.power_code,
    power_items: powerItems,
    urgent: row.urgent,
    receiver_name: row.receiver_name,
    receiver_phone: row.receiver_phone,
    address: row.address,
    receiver_note: row.receiver_note || null,
    contact_note: row.contact_note || null,
    notes: row.notes,
    transport_company: row.transport_company,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

// 訂單查詢（含公司名稱 join）的共用 SQL 前綴
const ORDER_SELECT_SQL = `
  SELECT o.*,
         cc.name AS customer_company_name,
         pc.name AS pickup_company_name,
         dc.name AS delivery_company_name,
         strftime('%Y-%m-%dT%H:%M:%fZ', o.created_at) AS created_at,
         strftime('%Y-%m-%dT%H:%M:%fZ', o.updated_at) AS updated_at
  FROM orders o
  LEFT JOIN companies cc ON cc.id = o.customer_company_id
  LEFT JOIN companies pc ON pc.id = o.pickup_company_id
  LEFT JOIN companies dc ON dc.id = o.delivery_company_id
`;

module.exports = {
  MAWB_LATE_LABEL,
  ORDER_NO_PREFIX,
  normalizeMawb,
  formatMawb,
  validateMawb,
  generateOrderNo,
  serializeOrder,
  ORDER_SELECT_SQL
};