// ===== RCL 磅單解析（前後端共用純函式，W3）=====
// 三個貨站（HACTL / AAT / CPSL）的磅單格式不同，而且常常改版，所以這裡「不寫死欄位位置」：
//   1) rclFindHeaderRow()  在前 20 列找出「含 ULD 欄 + 重量欄」的表頭列
//   2) rclDetectColumns()  依表頭文字猜出 ULD／Tare／Gross／件數 的欄位索引
//   3) 前端可讓使用者改欄位對應，並用同一支 rclRowsFromGrid() 重算（不必重新上傳）
// 與 calc.js 一樣：後端以 import() 載入同一支，避免「後端解析一套、畫面顯示另一套」。

// 欄位定義（UI 與後端共用；required 只影響提示，不影響解析）
export const RCL_COLUMNS = [
  { key: 'uld', label: 'ULD#／板號', required: true },
  { key: 'tare', label: 'Tare（板重）', required: false },
  { key: 'gross', label: 'RCL Gross（磅重）', required: true },
  { key: 'pcs', label: '件數', required: false }
];

// 表頭關鍵字（比對前會轉小寫）
const COLUMN_HINTS = {
  uld: [/uld/, /u\.?l\.?d/, /貨櫃/, /櫃號/, /板號/, /container\s*(no|number|#)/, /^container/],
  tare: [/tare/, /皮重/, /板重/, /盤重/, /empty\s*weight/],
  gross: [/gross/, /毛重/, /總重/, /磅重/, /actual/, /^weight$/, /total\s*weight/, /磅秤/],
  pcs: [/pcs/, /pieces/, /件數/, /箱數/, /數量/, /qty/, /quantity/, /ctns?/]
};

// 同一欄位文字可能同時命中（例如「Tare Weight」也含 weight）→ 先排除再比對
const COLUMN_EXCLUDES = {
  uld: [],
  tare: [/gross/, /毛重/, /總重/, /磅重/],
  gross: [/tare/, /皮重/, /板重/, /盤重/],
  pcs: []
};

export const RCL_SKIP_REASON = {
  no_uld_column: '找不到 ULD# 欄位，請在上方「欄位對應」手動選擇',
  no_uld: '沒有 ULD#（略過）',
  no_gross: '沒有磅重或磅重為 0（略過）',
  duplicate: 'ULD# 重複（只取第一筆）',
  limit: '超過單次匯入上限（200 筆）'
};

const WARNING_TEXT = {
  gross_lt_tare: '磅重小於 Tare'
};

// 文字正規化（去不斷行空白、去頭尾空白）
export function rclText(value) {
  if (value == null) return '';
  return String(value).replace(/\u00a0/g, ' ').trim();
}

// 數字解析：可處理「1,234.5」「1 234.5 KG」「540kg」「$1,000」
export function rclNumber(value) {
  if (value == null || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const cleaned = rclText(value).replace(/,/g, '').replace(/[^0-9.\-]/g, '');
  if (!cleaned || cleaned === '-' || cleaned === '.') return 0;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function matchesHint(text, key) {
  const lower = rclText(text).toLowerCase();
  if (!lower) return false;
  const excludes = COLUMN_EXCLUDES[key] || [];
  if (excludes.some(re => re.test(lower))) return false;
  return (COLUMN_HINTS[key] || []).some(re => re.test(lower));
}

// 依表頭文字猜欄位（回傳 0-based 索引，-1 = 找不到）
export function rclDetectColumns(header) {
  const cells = Array.isArray(header) ? header : [];
  const find = key => {
    for (let i = 0; i < cells.length; i += 1) {
      if (matchesHint(cells[i], key)) return i;
    }
    return -1;
  };
  const columns = { uld: find('uld'), tare: find('tare'), gross: find('gross'), pcs: find('pcs') };
  // 只有一欄「Weight」時，tare 與 gross 會指到同一欄 → Tare 視為未提供（B 散貨本來就沒有板重）
  if (columns.tare >= 0 && columns.tare === columns.gross) columns.tare = -1;
  return columns;
}

// 找出表頭列（前 maxScan 列中，第一個同時有 ULD 欄與重量欄的列）
export function rclFindHeaderRow(grid, options = {}) {
  const rows = Array.isArray(grid) ? grid : [];
  const maxScan = Math.max(1, Number(options.maxScan) || 20);
  for (let i = 0; i < Math.min(rows.length, maxScan); i += 1) {
    const header = Array.isArray(rows[i]) ? rows[i] : [];
    const columns = rclDetectColumns(header);
    if (columns.uld >= 0 && (columns.gross >= 0 || columns.tare >= 0)) {
      return { index: i, header, columns };
    }
  }
  return { index: -1, header: [], columns: { uld: -1, tare: -1, gross: -1, pcs: -1 } };
}

// 表頭 → 下拉選項（給「欄位對應」用）
export function rclColumnOptions(header) {
  return (Array.isArray(header) ? header : []).map((label, index) => ({
    index,
    label: rclText(label) || `第 ${index + 1} 欄`
  }));
}

// 資料列 + 欄位對應 → 可建立的收貨單位清單（純資料，不含 UI / DB）
// 回傳 { rows:[{ row, uld_number, tare_weight, rcl_gross_weight, pcs, warnings }], skipped:[{ row, reason, ... }] }
export function rclRowsFromGrid(grid, columns, options = {}) {
  const rows = [];
  const skipped = [];
  const limit = Math.max(1, Number(options.limit) || 200);
  const col = { uld: -1, tare: -1, gross: -1, pcs: -1, ...(columns || {}) };
  const data = Array.isArray(grid) ? grid : [];

  if (!(col.uld >= 0)) {
    return { rows, skipped: [{ row: 0, reason: 'no_uld_column' }] };
  }

  const seen = new Map(); // ULD# → 第一次出現的資料列號
  for (let idx = 0; idx < data.length; idx += 1) {
    const cells = Array.isArray(data[idx]) ? data[idx] : [];
    const rowNo = idx + 1;
    const uldNumber = rclText(cells[col.uld]).replace(/\s+/g, '').toUpperCase();
    const tare = col.tare >= 0 ? rclNumber(cells[col.tare]) : 0;
    const gross = col.gross >= 0 ? rclNumber(cells[col.gross]) : 0;
    const pcs = col.pcs >= 0 ? Math.max(0, Math.trunc(rclNumber(cells[col.pcs]))) : 0;

    if (!uldNumber && !gross) continue; // 空白列 / 合計列（只有文字）
    if (!uldNumber) {
      skipped.push({ row: rowNo, reason: 'no_uld' });
      continue;
    }
    if (!(gross > 0)) {
      skipped.push({ row: rowNo, reason: 'no_gross', uld_number: uldNumber });
      continue;
    }
    if (seen.has(uldNumber)) {
      skipped.push({ row: rowNo, reason: 'duplicate', uld_number: uldNumber, first_row: seen.get(uldNumber) });
      continue;
    }
    if (rows.length >= limit) {
      skipped.push({ row: rowNo, reason: 'limit', uld_number: uldNumber });
      continue;
    }
    seen.set(uldNumber, rowNo);

    const warnings = [];
    if (gross < tare) warnings.push('gross_lt_tare');

    rows.push({
      row: rowNo,
      uld_number: uldNumber,
      tare_weight: Math.max(0, tare),
      rcl_gross_weight: gross,
      pcs,
      warnings
    });
  }

  return { rows, skipped };
}

export function rclSkipReasonText(reason) {
  return RCL_SKIP_REASON[reason] || String(reason || '');
}

export function rclWarningText(code) {
  return WARNING_TEXT[code] || String(code || '');
}
