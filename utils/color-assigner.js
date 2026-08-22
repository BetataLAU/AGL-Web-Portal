/**
 * utils/color-assigner.js
 * 客戶色卡自動分配器：以 HAWB 為種子穩定產生專屬色票，並確保同專案內不衝突。
 *
 * 設計原則：
 *  - 同一 HAWB 在不同查詢中必定得到相同色票（穩定 hash 種子）。
 *  - 若 hash 到的色票已被同專案其他客戶佔用，則順延至下一個未使用色票。
 *  - 色票選用高對比、色盲友善的調色盤（HCL 空間均勻取樣）。
 */
const db = require('../db/database');

/** 專屬色票（24 色，HCL 均勻分佈、視覺可區分） */
const PALETTE = [
  '#3498db', '#e74c3c', '#2ecc71', '#f39c12', '#9b59b6',
  '#1abc9c', '#e67e22', '#16a085', '#c0392b', '#2980b9',
  '#27ae60', '#8e44ad', '#f1c40f', '#d35400', '#2c3e50',
  '#7f8c8d', '#5dade2', '#e84393', '#00b894', '#fdcb6e',
  '#6c5ce7', '#fd79a8', '#00cec9', '#a29bfe',
];

/** 穩定字串 hash（FNV-1a 32bit） */
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h;
}

/** 由 HAWB 產生穩定索引（0 ~ palette.length-1） */
function hashIndex(hawb) {
  return fnv1a(String(hawb || '').trim().toUpperCase()) % PALETTE.length;
}

/**
 * 查詢專案內已有的客戶與色票。
 * @param {number} projectId
 * @param {(err, rows: Array<{hawb: string, color_code: string}>) => void} callback
 */
function getProjectCustomers(projectId, callback) {
  db.all(
    'SELECT hawb, color_code FROM customers WHERE project_id = ?',
    [projectId],
    (err, rows) => callback(err, rows || [])
  );
}

/**
 * 解析專案內的色票使用狀況。
 * @returns {{ usedByHawk: Map<string,string>, usedColors: Set<string> }}
 */
function buildUsageMap(customers) {
  const usedByHawk = new Map();
  const usedColors = new Set();
  customers.forEach((c) => {
    usedByHawk.set(c.hawb, c.color_code);
    if (c.color_code) usedColors.add(c.color_code);
  });
  return { usedByHawk, usedColors };
}

/**
 * 分配色票：優先沿用同 HAWB 既有色票；否則產生專案內未使用的色票。
 * @param {string} hawb
 * @param {string} customerName 僅用於錯誤訊息
 * @param {Map<string,string>} usedByHawk
 * @param {Set<string>} usedColors
 * @returns {string} 色票 HEX
 */
function resolveColor(hawb, customerName, usedByHawk, usedColors) {
  const existing = usedByHawk.get(hawb);
  if (existing) return existing;

  if (usedColors.size >= PALETTE.length) {
    // 色票用完：以 hash 回退重複使用（機率極低）
    return PALETTE[hashIndex(hawb)];
  }

  let idx = hashIndex(hawb);
  let attempts = 0;
  while (usedColors.has(PALETTE[idx]) && attempts < PALETTE.length) {
    idx = (idx + 1) % PALETTE.length;
    attempts++;
  }
  usedColors.add(PALETTE[idx]);
  return PALETTE[idx];
}

/**
 * 為專案內指定 HAWB 分配（或沿用）色票。
 * @param {number} projectId
 * @param {string} hawb
 * @param {string} customerName
 * @param {(err, colorCode: string) => void} callback
 */
function assignColor(projectId, hawb, customerName, callback) {
  getProjectCustomers(projectId, (err, customers) => {
    if (err) return callback(err);
    const { usedByHawk, usedColors } = buildUsageMap(customers);
    const color = resolveColor(hawb, customerName, usedByHawk, usedColors);
    callback(null, color);
  });
}

module.exports = {
  PALETTE,
  fnv1a,
  hashIndex,
  assignColor,
  resolveColor,
  buildUsageMap,
  getProjectCustomers,
};