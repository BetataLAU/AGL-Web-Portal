// ===== ULD 夾重系統：MAWB 格式化與檢查碼驗證（共用純函式）=====
// 業界規則（11 位數字）：
//   左 3 位＝航空公司代號（不足 3 位在左邊補 0）／右 8 位＝序號（serial 7 位 + 檢查碼 1 位）
//   檢查碼 = 前 7 位 mod 7（例：071-6195 2074 → 6195207 % 7 = 4 ＝ 第 8 位，合法）
// 顯示格式：`000-0000 0000`（3-4-4）
//
// 只做「格式與檢查碼」這件事，不涉及任何重量計算；前端（輸入／貼上）與測試共用同一份。
// 注意：不阻擋既有資料（舊資料可能本來就不是 11 位），呼叫端自行決定要用提示或略過。

// 只留數字
export function uldMawbDigits(value) {
  return String(value == null ? '' : value).replace(/\D+/g, '');
}

// 正規化成 11 位數字：
//   - 8～11 位 → 取後 8 位為 suffix，前面（不足 3 位）補 0（例：`61952074` → `00061952074` → `000-6195 2074`）
//   - 少於 8 位或超過 11 位 → 原樣回傳（無法判斷，交給驗證回報 LENGTH／TOO_LONG）
export function uldNormalizeMawbDigits(value) {
  const digits = uldMawbDigits(value);
  if (digits.length >= 8 && digits.length <= 11) {
    const suffix = digits.slice(-8);
    const prefix = digits.slice(0, digits.length - 8).padStart(3, '0');
    return `${prefix}${suffix}`;
  }
  return digits;
}

// `000-0000 0000`（無法正規化成 11 位就回傳原文，讓使用者看到自己打了什麼）
export function uldFormatMawb(value) {
  const digits = uldNormalizeMawbDigits(value);
  if (digits.length === 11) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)} ${digits.slice(7, 11)}`;
  }
  return String(value == null ? '' : value).trim();
}

// 檢查碼：suffix 前 7 位 mod 7
export function uldMawbCheckDigit(suffix) {
  const s = String(suffix == null ? '' : suffix).replace(/\D+/g, '');
  if (s.length !== 8) return null;
  return Number(s.slice(0, 7)) % 7;
}

// 驗證：回傳 { ok, empty, reason, digits, formatted, expected, actual, message }
//   reason：EMPTY／LENGTH／TOO_LONG／CHECK_DIGIT／OK
export function uldValidateMawb(value) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) {
    return { ok: false, empty: true, reason: 'EMPTY', digits: '', formatted: '', message: '請輸入 MAWB#' };
  }
  const rawDigits = uldMawbDigits(raw);
  if (rawDigits.length > 11) {
    return {
      ok: false, empty: false, reason: 'TOO_LONG', digits: rawDigits,
      formatted: uldFormatMawb(raw),
      message: `MAWB 是 11 位數字，現在有 ${rawDigits.length} 位`
    };
  }
  const digits = uldNormalizeMawbDigits(raw);
  const formatted = uldFormatMawb(raw);
  if (digits.length !== 11) {
    return {
      ok: false, empty: false, reason: 'LENGTH', digits, formatted,
      message: `MAWB 是 11 位數字（航空公司 3 位＋序號 8 位），現在只有 ${digits.length} 位`
    };
  }
  const suffix = digits.slice(3);
  const expected = uldMawbCheckDigit(suffix);
  const actual = Number(suffix.slice(7, 8));
  if (expected !== actual) {
    return {
      ok: false, empty: false, reason: 'CHECK_DIGIT', digits, formatted, expected, actual,
      message: `檢查碼不符：前 7 位 ${suffix.slice(0, 7)} mod 7 = ${expected}，但第 8 位是 ${actual}`
    };
  }
  return { ok: true, empty: false, reason: 'OK', digits, formatted, expected, actual, message: '' };
}

// 給 UI 用的短標記（輸入框 title／紅框用）
export function uldMawbIssueText(result) {
  if (!result || result.ok || result.empty) return '';
  return result.message || 'MAWB 格式不正確';
}
