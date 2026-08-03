// ===== MAWB# 工具（純函數，無 DOM 依賴） =====
// 供前後端共用的 MAWB 正規化、格式與驗證邏輯（前端版本）

const MAWB_LATE_LABEL = '後補MAWB#';

// 去除空格、連字號，取得 11 位純數字
function normalizeMawb(value) {
  if (value == null) return '';
  return String(value).replace(/[\s-]/g, '');
}

// 統一顯示格式 000-0000 0000
function formatMawb(value) {
  const digits = normalizeMawb(value);
  if (!/^\d{11}$/.test(digits)) return value || '';
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)} ${digits.slice(7, 11)}`;
}

// 驗證 MAWB#：格式 + checksum（suffix 前 7 位 mod 7 = 第 8 位）
function validateMawb(value) {
  const raw = (value || '').trim();
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

// 判斷是否為「後補MAWB#」
function isLateMawb(value) {
  if (value == null) return false;
  return String(value).trim() === MAWB_LATE_LABEL;
}

// 顯示用：後補→顯示「後補MAWB#」，有值→標準格式，無值→'-'
function displayMawb(value) {
  if (!value || !String(value).trim()) return '-';
  if (isLateMawb(value)) return MAWB_LATE_LABEL;
  return formatMawb(value);
}