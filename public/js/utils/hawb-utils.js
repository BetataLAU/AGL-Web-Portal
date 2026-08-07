// ===== HAWB# 工具（純函數 + DOM 綁定） =====
// 瀏覽器端版本：過濾輸入、自動轉大楷、限制長度與驗證

const HAWB_MAX_LENGTH = 13;

// 過濾輸入：只保留英文字母或數字、自動轉大楷、最多 13 個字元
function filterHawb(value) {
  if (value == null) return '';
  return String(value).replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, HAWB_MAX_LENGTH);
}

// 驗證 HAWB#：選填欄位；有值必須為 1-13 位英文字母或數字（自動轉大楷後驗證）
function validateHawb(value) {
  const raw = (value == null ? '' : String(value)).trim().toUpperCase();
  if (!raw) {
    return { valid: true, value: '', error: null };
  }
  if (!/^[A-Z0-9]{1,13}$/.test(raw)) {
    return { valid: false, value: null, error: 'HAWB# 只允許英文字母或數字（自動轉大楷），最多 13 字，不可包含符號或空格' };
  }
  return { valid: true, value: raw, error: null };
}

// 綁定 HAWB# 輸入框：即時過濾 + 失焦驗證提示
function setupHawbInput({ input, hintEl }) {
  if (!input) return;
  input.addEventListener('input', () => {
    input.value = filterHawb(input.value);
    if (hintEl) hintEl.style.color = '';
  });

  input.addEventListener('blur', () => {
    if (!hintEl) return;
    const val = input.value.trim();
    if (!val) {
      hintEl.style.color = '';
      hintEl.textContent = '限英文字母或數字（自動轉大楷），最多 13 字（選填）';
      return;
    }
    const result = validateHawb(val);
    if (result.valid) {
      hintEl.style.color = '#16a34a';
      hintEl.textContent = `✅ 有效 HAWB#：${val}（${val.length} 字）`;
    } else {
      hintEl.style.color = '#dc2626';
      hintEl.textContent = `❌ ${result.error}`;
    }
  });
}
