// ===== Shipper Role Project - XLS 通用工具函式 =====
// 從 xls-workflow.js 拆出（.clinerule.md：檔案大小控制）
// 職責：純函式工具（文字清理 / MAWB / 航班 / 日期 / 電話抽取），無副作用、無外部依賴。
// 提供給 xls-workflow.js / xls-cnee.js / xls-sli-eli.js 共用。


// ===== 工具函式 =====

/** 等待 ms 毫秒 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 過濾非必要字元（移除 xlsx 常見的 _x000D_ 控制字元） */
function cleanCell(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object' && v instanceof Date) return v;
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map((part) => String(part && part.text || '')).join('').replace(/_x000D_/g, ' ').replace(/\r/g, ' ').replace(/\u00a0/g, ' ').trim();
    if (typeof v.text === 'string') return cleanCell(v.text);
    if (v.result !== undefined && v.result !== null) return cleanCell(v.result);
    if (Array.isArray(v)) return v.map(cleanCell).join('');
    return '';
  }
  let s = String(v);
  s = s.replace(/_x000D_/g, ' ').replace(/\r/g, ' ').replace(/\u00a0/g, ' ');
  return s.trim();
}

/** 抽取 MAWB#（標準化 000-00000000 或 00000000000） */
function normalizeMawb(v) {
  const s = cleanCell(v);
  const m = s.match(/(\d{3})[-\s]?(\d{8})/);
  return m ? `${m[1]}-${m[2]}` : s.replace(/[^0-9]/g, '');
}

/** 抽取航班公司代碼（航班號頭 2 個字元，如 CX257→CX、QR8409→QR、5Y8230→5Y） */
function flightCompany(flight) {
  const s = cleanCell(flight).toUpperCase();
  const m = s.match(/^([A-Z0-9]{2})/);
  return m ? m[1] : s.slice(0, 2);
}

/** 日期正規化：回傳 Date 或 null */
function normalizeDate(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  const s = cleanCell(v);
  if (!s) return null;
  // 嘗試常見格式
  const patterns = [
    /^(\d{4})-(\d{2})-(\d{2})/,             // 2026-08-03
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})/,       // 03/08/2026 or 08/03/2026
    /^(\d{1,2})-([A-Za-z]{3})-(\d{4})/,     // 03-Aug-2026
    /^(\d{1,2})[A-Za-z]{2}\s*([A-Za-z]{3})\s*(\d{4})/, // 3rd Aug 2026
    /^(\d{4})(\d{2})(\d{2})/,               // 20260803
  ];
  for (const p of patterns) {
    const m = s.match(p);
    if (!m) continue;
    if (p === patterns[0]) {
      const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      if (!isNaN(d)) return d;
    } else if (p === patterns[1]) {
      const [_, a, b, y] = m;
      // 月份在 1-12 才視為月
      if (Number(a) >= 1 && Number(a) <= 12) {
        const d = new Date(Number(y), Number(a) - 1, Number(b));
        if (!isNaN(d)) return d;
      }
    } else if (p === patterns[2] || p === patterns[3]) {
      const monthMap = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
      const mon = m[2].toUpperCase();
      if (mon in monthMap) {
        const d = new Date(Number(m[3]), monthMap[mon], Number(m[1]));
        if (!isNaN(d)) return d;
      }
    } else if (p === patterns[4]) {
      const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      if (!isNaN(d)) return d;
    }
  }
  // Excel serialize number
  const n = Number(s);
  if (!isNaN(n) && n > 20000 && n < 80000) {
    return excelSerialToDate(n);
  }
  return null;
}

function excelSerialToDate(serial) {
  const utcDays = Math.floor(serial - 25569);
  const d = new Date(utcDays * 86400 * 1000);
  return isNaN(d.getTime()) ? null : d;
}

/** 格式化日為 DDMMM（如 03AUG） */
function formatDdmmyyyy(d) {
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  return `${String(d.getDate()).padStart(2, '0')}${months[d.getMonth()]}`;
}

/** 格式化日為 YYYYMMDD（如 20260901） */
function formatYyyymmdd(d) {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

/** 從 CNEE 內容抽取電話號碼 */
function extractTel(text) {
  const s = cleanCell(text);
  if (!s) return '';
  // 優先匹配 TEL:/電話/PHONE 之後的號碼
  const labeled = s.match(/(?:TEL|TELE|PHONE|電話|TEL:|電話)[:\s]*([+\d][\d\s\-()/]{6,20})/i);
  if (labeled) return labeled[1].trim();
  // 備援：抓取一般電話格式
  const generic = s.match(/[+()\d][\d\s\-()/]{7,18}/);
  return generic ? generic[0].trim() : '';
}

/** 保留巨集移除，xlsm → xlsx 格式 */
function workbookToXlsx(wb, targetPath) {
  // exceljs 讀取 xlsm 後無法直接存 xlsx 且保留所有樣式，因此採用「讀取模板 + 逐格覆寫」方式：
  // 在 makeSli / makeEli 中實作（讀 xlsm → 改 cell → save 為 xlsx）
  throw new Error('workbookToXlsx: 請改用 fillSli / fillEli');
}

module.exports = {
  sleep,
  cleanCell,
  normalizeMawb,
  flightCompany,
  normalizeDate,
  excelSerialToDate,
  formatDdmmyyyy,
  formatYyyymmdd,
  extractTel,
  workbookToXlsx,
};
