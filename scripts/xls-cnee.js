// ===== Shipper Role Project - CNEE 對照區（自動抽取 + 比對） =====
// 從 xls-workflow.js 拆出（.clinerule.md：檔案大小控制）
// 職責：掃描 sheet 的 A/B/C 欄抽取 CNEE 對照區，並依 DEST + REMARK 加權比對。
// 依賴：xls-utils.js（cleanCell / normalizeLookupKey）

const { cleanCell } = require('./xls-utils');


// ===== CNEE 對照區（自動抽取 + 比對） =====

// 目的港碼 → 可能出現的國家/城市關鍵字（用於「NODE B 巴西」這類不含機場碼的區塊 key）
const DEST_COUNTRY_KEYWORDS = {
  GRU: ['巴西', 'SAO PAULO'],
  VCP: ['巴西', 'VIRACOPOS'],
  SCL: ['智利', 'SANTIAGO'],
  EZE: ['阿根廷', 'BUENOS AIRES'],
  MEX: ['墨西哥'],
  CUN: ['墨西哥'],
  MID: ['墨西哥'],
  LIM: ['秘鲁', '祕魯'],
  BOG: ['哥伦比亚', '哥倫比亞'],
  UIO: ['厄瓜多尔', '厄瓜多'],
  GYE: ['厄瓜多尔', '厄瓜多'],
  PTY: ['巴拿马', '巴拿馬'],
  SJO: ['哥斯达黎加', '哥斯大黎加'],
  ASU: ['巴拉圭'],
  MVD: ['乌拉圭', '烏拉圭'],
  CCS: ['委内瑞拉', '委內瑞拉'],
};

/** 對照區 key 正規化：去雙引號、換行/多空白轉單空格 */
function normalizeLookupKey(key) {
  let s = cleanCell(key);
  s = s.replace(/["“”]/g, '');
  s = s.replace(/\s+/g, ' ');
  return s.trim();
}

/**
 * 自動抽取 CNEE 對照區。
 * 掃整張 sheet 的 A/B/C 欄（index 0/1/2）：
 *  - A 有值           → 新區塊開始（key 通常伴隨 B=SHIPPER:）
 *  - B 開頭為 CNEE     → 開始收集該區塊的 CNEE 值（可能在同列或後續列）
 *  - A、B 都空且 C 有值 → 地址續行，累加進目前區塊的 CNEE
 * @param {Array<Array>} rows
 * @returns {Array<{key: string, cnee: string}>}
 */
function extractCneeLookupArea(rows) {
  const blocks = [];
  let current = null;
  let cneeStarted = false;
  for (let r = 1; r <= rows.length; r++) {
    const row = rows[r - 1] || [];
    const a = cleanCell(row[0]);
    const b = cleanCell(row[1]);
    const c = cleanCell(row[2]);
    if (a) {
      // 新區塊：結算上一個已收集到 CNEE 的區塊
      if (current && cneeStarted) blocks.push(current);
      current = { key: a, cnee: '' };
      cneeStarted = false;
    } else if (b && current) {
      const label = b.toUpperCase().replace(/[:：\s]+$/, '');
      if (label.startsWith('CNEE')) {
        if (!cneeStarted) {
          cneeStarted = true;
          current.cnee = c;
        }
      }
      // SHIPPER: 等其他標籤行忽略
    } else if (c && current && cneeStarted) {
      // 續行：A、B 都空 → 累加
      current.cnee = current.cnee ? `${current.cnee}\n${c}` : c;
    }
  }
  if (current && cneeStarted) blocks.push(current);
  // 去除 CNEE 值首尾的雙引號（來源檔常見），並壓掉多餘空白行
  for (const b of blocks) {
    b.cnee = b.cnee.replace(/^["“”]+|["“”]+$/g, '').trim();
  }
  return blocks;
}

/**
 * 依 DEST + REMARK 比對 CNEE 區塊。
 * 加權：REMARK 命中 +30、DEST 碼命中 +20、國家關鍵字命中 +10、純 DEST 預設 +5。
 * REMARK 空白時優先取「key 恰等於 DEST」的預設區塊（避免「GRU:【外单】…」誤搶）。
 * @param {string} dest - 目的港（如 GRU）
 * @param {string} remark - REMARK（如 NODE B）
 * @param {Array<{key:string, cnee:string}>} blocks - extractCneeLookupArea 的結果
 * @returns {string} 比對到的 CNEE（無則空字串）
 */
function matchCnee(dest, remark, blocks) {
  if (!dest || !blocks || !blocks.length) return '';
  const d = dest.toUpperCase();
  const r = (remark || '').toUpperCase().trim();
  const countries = DEST_COUNTRY_KEYWORDS[d] || [];

  // REMARK 空白：只取「純 DEST 預設區塊」
  if (!r) {
    const plain = blocks.find((b) => normalizeLookupKey(b.key) === d);
    if (plain) return plain.cnee;
  }

  let best = null;
  let bestScore = -1;
  for (const b of blocks) {
    const key = normalizeLookupKey(b.key);
    let score = 0;
    if (r && key.includes(r)) score += 30;       // REMARK 命中
    if (key.includes(d)) score += 20;             // DEST 碼命中
    if (countries.some((c) => key.includes(c))) score += 10; // 國家關鍵字命中
    if (key === d) score += 5;                    // 純 DEST 預設區塊
    if (score > bestScore) {
      bestScore = score;
      best = b;
    }
  }
  return best ? best.cnee : '';
}
module.exports = {
  DEST_COUNTRY_KEYWORDS,
  normalizeLookupKey,
  extractCneeLookupArea,
  matchCnee,
};

