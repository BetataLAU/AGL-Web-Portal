// ===== 訂單系統驗證（純函式，無 DOM 依賴） =====
// 從原 orders.js 抽出的獨立驗證邏輯
// 註：MAWB/HAWB 驗證沿用 utils/mawb-utils.js 與 utils/hawb-utils.js（不改動）

// 驗證 DEST：選填欄位；有值必須為 3 個英文字母（自動轉大楷），唯一特例：SVO2
export function validateDest(value) {
  const raw = (value == null ? '' : String(value)).trim().toUpperCase();
  if (!raw) {
    return { valid: true, value: '', error: null };
  }
  if (raw === 'SVO2') {
    return { valid: true, value: raw, error: null };
  }
  if (!/^[A-Z]{3}$/.test(raw)) {
    return { valid: false, value: null, error: 'DEST 只接受 3 個英文字（特例：SVO2）' };
  }
  return { valid: true, value: raw, error: null };
}