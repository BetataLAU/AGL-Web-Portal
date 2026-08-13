// ===== 打板計劃：Booking Record 新增/編輯 Modal =====
// 被 bookingsController.js 引用；儲存成功後透過 onSaved callback 通知重整列表
// 依賴 window.escapeHtml / window.setupAutocomplete（定義於 main.js / utils/autocomplete.js）
// MAWB# 引用 utils/mawb-utils.js（validateMawb/formatMawb/displayMawb 為 window 全域）
// HAWB# 引用 utils/hawb-utils.js（filterHawb/validateHawb 為 window 全域）

import {
  createBooking, updateBooking,
  fetchCompanies, fetchSplCodes, fetchRemarkTemplates,
  createSplCode, createRemarkTemplate
} from './api.js';
import { getSplCodes, setSplCodes, getRemarkTemplates, setRemarkTemplates } from './state.js';

const MODAL_FIELDS = ['#bk-mawb', '#bk-hawb', '#bk-client', '#bk-dest', '#bk-pcs',
  '#bk-gross', '#bk-volume', '#bk-cbm', '#bk-spl', '#bk-remark'];

// ===== 主流程：顯示「新增/編輯 Booking」Modal =====
export function showBookingModal(booking, { onSaved } = {}) {
  const isEdit = !!booking;

  const overlay = document.createElement('div');
  overlay.className = 'pallet-modal-overlay';
  overlay.innerHTML = buildBookingModalHTML(booking);
  document.body.appendChild(overlay);

  const errBox = overlay.querySelector('#pallet-booking-error');
  const showError = (msg) => { errBox.textContent = msg; errBox.classList.add('show'); };

  // 欄位驗證與自動化
  setupMawbField(overlay.querySelector('#bk-mawb'), showError);
  setupHawbField(overlay.querySelector('#bk-hawb'));
  setupDestField(overlay.querySelector('#bk-dest'), showError);
  setupClientAutocomplete(overlay.querySelector('#bk-client'));
  setupNumericFields({
    pcsInput: overlay.querySelector('#bk-pcs'),
    grossInput: overlay.querySelector('#bk-gross'),
    volumeInput: overlay.querySelector('#bk-volume'),
    cbmInput: overlay.querySelector('#bk-cbm')
  });
  setupSplAndRemarkAutocomplete(overlay.querySelector('#bk-spl'), overlay.querySelector('#bk-remark'));

  // 關閉（含未儲存變更確認）
  setupCloseHandlers(overlay);

  // 儲存
  overlay.querySelector('#bk-save').addEventListener('click', async () => {
    const payload = collectPayload(overlay);
    if (!payload.mawb) { showError('MAWB# 必填'); return; }
    // ===== MAWB# 儲存前重新驗證：格式錯誤不允許儲存 =====
    if (typeof window.validateMawb === 'function') {
      const mawbInput = overlay.querySelector('#bk-mawb');
      const mawbResult = window.validateMawb(payload.mawb);
      if (!mawbResult.valid) {
        if (mawbInput) {
          mawbInput.style.borderColor = '#dc2626';
          mawbInput.focus();
        }
        showError(mawbResult.error || 'MAWB# 格式錯誤');
        return;
      }
      // 驗證通過 → 統一格式後儲存
      payload.mawb = mawbResult.formatted;
    }
    try {
      if (isEdit) {
        await updateBooking(booking.id, payload);
      } else {
        await createBooking(payload);
      }
      await maybeAddSplCode(payload.spl);
      await maybeAddRemarkTemplate(payload.remark);
      overlay.remove();
      if (onSaved) await onSaved();
    } catch (err) {
      showError(err.message || '儲存失敗');
    }
  });
}

// ===== Modal DOM =====
function buildBookingModalHTML(booking) {
  const isEdit = !!booking;
  return `
    <div class="pallet-modal">
      <h2>${isEdit ? '✏️ 編輯 Booking' : '＋ 新增 Booking Record'}</h2>
      <div class="pallet-modal-error" id="pallet-booking-error"></div>
      <div class="pallet-form-grid">
        <div class="pallet-form-field">
          <label>MAWB# *</label>
          <input type="text" id="bk-mawb" value="${isEdit ? escapeHtml(booking.mawb || '') : ''}" placeholder="176-0000 0000" autocomplete="off" />
          <small style="color:var(--text-muted);font-size:0.7rem;">11 位數字，自動格式化；可輸入「後補MAWB#」</small>
        </div>
        <div class="pallet-form-field">
          <label>HAWB#</label>
          <input type="text" id="bk-hawb" value="${isEdit ? escapeHtml(booking.hawb || '') : ''}" placeholder="選填" autocomplete="off" />
          <small style="color:var(--text-muted);font-size:0.7rem;">限英文字母或數字，最多 13 字（自動轉大楷）</small>
        </div>
        <div class="pallet-form-field">
          <label>客戶 (CLIENT)</label>
          <input type="text" id="bk-client" value="${isEdit ? escapeHtml(booking.client || '') : ''}" placeholder="輸入公司名稱搜尋" autocomplete="off" />
        </div>
        <div class="pallet-form-field">
          <label>目的地 (DEST)</label>
          <input type="text" id="bk-dest" value="${isEdit ? escapeHtml(booking.dest || '') : ''}" placeholder="如 DWC / VIE / STN（特例 SVO2）" style="text-transform:uppercase;" autocomplete="off" />
          <small style="color:var(--text-muted);font-size:0.7rem;">3 個英文字（唯一特例：SVO2）</small>
        </div>
        <div class="pallet-form-field">
          <label>件數 (PCS)</label>
          <input type="text" id="bk-pcs" inputmode="numeric" pattern="[0-9]*" value="${isEdit ? (booking.pcs || '') : ''}" placeholder="0" />
        </div>
        <div class="pallet-form-field">
          <label>重量 (kg)</label>
          <input type="text" id="bk-gross" inputmode="decimal" value="${isEdit ? (booking.gross_weight || '') : ''}" placeholder="0.0" />
        </div>
        <div class="pallet-form-field">
          <label>體積重 (kg)</label>
          <input type="text" id="bk-volume" inputmode="decimal" value="${isEdit ? (booking.volume_weight || '') : ''}" placeholder="0.0" />
        </div>
        <div class="pallet-form-field">
          <label>CBM</label>
          <input type="text" id="bk-cbm" inputmode="decimal" value="${isEdit ? (booking.cbm || '') : ''}" placeholder="0.00" />
          <small style="color:var(--text-muted);font-size:0.7rem;">輸入體積重後自動計算（體積重 × 0.006）</small>
        </div>
        <div class="pallet-form-field">
          <label>SPL 特殊代碼</label>
          <input type="text" id="bk-spl" value="${isEdit ? escapeHtml(booking.spl || '') : ''}" placeholder="輸入或選擇" />
        </div>
        <div class="pallet-form-field full">
          <label>備註 (REMARK)</label>
          <textarea id="bk-remark" placeholder="輸入或選擇常用備註">${isEdit ? escapeHtml(booking.remark || '') : ''}</textarea>
        </div>
      </div>
      <div class="pallet-modal-actions">
        <button type="button" class="pallet-btn" id="bk-cancel">取消</button>
        <button type="button" class="pallet-btn pallet-btn-primary" id="bk-save">${isEdit ? '💾 儲存' : '＋ 建立'}</button>
      </div>
    </div>
  `;
}

// ===== MAWB#：引用 mawb-utils（window.validateMawb / formatMawb） =====
function setupMawbField(input, showError) {
  input.addEventListener('blur', () => {
    const val = input.value.trim();
    if (!val) { input.style.borderColor = ''; return; }
    if (typeof window.validateMawb !== 'function') return;
    const result = window.validateMawb(val);
    if (result.valid) {
      input.value = result.formatted;   // 自動格式化 000-0000 0000
      input.style.borderColor = '#16a34a';
    } else {
      input.style.borderColor = '#dc2626';
      showError(result.error || 'MAWB# 格式錯誤');
    }
  });
  input.addEventListener('input', () => { input.style.borderColor = ''; });
}

// ===== HAWB#：引用 hawb-utils（window.filterHawb / validateHawb） =====
function setupHawbField(input) {
  input.addEventListener('input', () => {
    if (typeof window.filterHawb === 'function') {
      input.value = window.filterHawb(input.value);
    }
    input.style.borderColor = '';
  });
  input.addEventListener('blur', () => {
    const val = input.value.trim();
    if (!val) { input.style.borderColor = ''; return; }
    if (typeof window.validateHawb === 'function') {
      const result = window.validateHawb(val);
      input.style.borderColor = result.valid ? '#16a34a' : '#dc2626';
    }
  });
}

// ===== DEST：參考 SVO2 規則驗證（3 英文字，特例 SVO2） =====
function setupDestField(input, showError) {
  input.addEventListener('blur', () => {
    const val = input.value.trim();
    if (!val) { input.style.borderColor = ''; return; }
    const upper = val.toUpperCase();
    const valid = upper === 'SVO2' || /^[A-Z]{3}$/.test(upper);
    input.value = upper;
    input.style.borderColor = valid ? '#16a34a' : '#dc2626';
    if (!valid) showError('DEST 只接受 3 個英文字（特例：SVO2）');
  });
  input.addEventListener('input', () => {
    // 特例：SVO2 允許 4 字元；其餘只接受 3 個英文字
    let v = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (v !== 'SVO2' && v !== 'SVO') v = v.replace(/[^A-Z]/g, '');
    if (v.length > 4) v = v.slice(0, 4);
    if (v.length > 3 && v !== 'SVO2') v = v.slice(0, 3);
    input.value = v;
    input.style.borderColor = '';
  });
}

// ===== 客戶 (CLIENT)：資料庫公司 Autocomplete（async 載入，聚焦即有候選） =====
function setupClientAutocomplete(input) {
  let cachePromise = null;
  const loadCompanies = () => {
    if (!cachePromise) {
      cachePromise = fetchCompanies()
        .then(list => list || [])
        .catch(() => []);
    }
    return cachePromise;
  };
  setupAutocomplete({
    input,
    suggestions: async () => {
      const companies = await loadCompanies();
      const q = input.value.trim().toLowerCase();
      if (!q) return companies.slice(0, 12).map(c => c.name);
      return companies
        .filter(c => String(c.name || '').toLowerCase().includes(q))
        .slice(0, 12)
        .map(c => c.name);
    },
    emptyMessage: '沒有相符的公司，可輸入自訂客戶名稱。'
  });
}

// ===== 數字欄位：只允許數字與小數點 + CBM 自動計算 =====
function setupNumericFields({ pcsInput, grossInput, volumeInput, cbmInput }) {
  const applySanitize = (inp) => {
    const cleaned = sanitizeNumber(inp.value);
    if (cleaned !== inp.value) inp.value = cleaned;
  };
  // 編輯模式若既有 CBM 則視為手動值，不再被自動覆蓋
  let cbmUserEdited = !!parseFloat(cbmInput.value);

  [pcsInput, grossInput, volumeInput, cbmInput].forEach(inp => {
    inp.addEventListener('input', () => {
      applySanitize(inp);
      // 用戶聚焦 CBM 並輸入 → 視為手動編輯
      if (inp === cbmInput) {
        cbmUserEdited = cbmInput.value.trim() !== '';
      }
      // 體積重改變 → 若 CBM 未被手動編輯，自動計算 CBM = 體積重 × 0.006
      if (inp === volumeInput && !cbmUserEdited) {
        cbmInput.value = autoCbm(volumeInput.value);
      }
    });
  });
}

// 由體積重自動計算 CBM（四捨五入至 2 位小數）
function autoCbm(volumeStr) {
  const volume = parseFloat(volumeStr);
  if (isNaN(volume) || volume <= 0) return '';
  return String(Math.round(volume * 0.006 * 100) / 100);
}

// SPL / REMARK autocomplete
function setupSplAndRemarkAutocomplete(splInput, remarkInput) {
  const splSuggestions = getSplCodes().map(s => s.code);
  setupAutocomplete({
    input: splInput,
    suggestions: () => splSuggestions,
    emptyMessage: '沒有相符的 SPL 代碼，可輸入自訂值。'
  });

  const remarkSuggestions = getRemarkTemplates().map(r => r.content);
  setupAutocomplete({
    input: remarkInput,
    suggestions: () => remarkSuggestions,
    emptyMessage: '沒有相符的備註，可輸入自訂文字。'
  });
}

// ===== 關閉：若有未儲存變更，先確認 =====
function setupCloseHandlers(overlay) {
  const initialValues = {};
  MODAL_FIELDS.forEach(sel => { initialValues[sel] = (overlay.querySelector(sel) || {}).value; });
  const hasUnsavedChanges = () =>
    MODAL_FIELDS.some(sel => (overlay.querySelector(sel) || {}).value !== initialValues[sel]);
  const safeClose = () => {
    if (hasUnsavedChanges()) {
      if (!confirm('有未儲存的修改，確定離開？')) return;
    }
    overlay.remove();
  };
  overlay.querySelector('#bk-cancel').addEventListener('click', safeClose);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) safeClose(); });
}

// ===== 收集表單 payload =====
function collectPayload(overlay) {
  const val = (sel) => overlay.querySelector(sel).value.trim();
  const num = (sel) => overlay.querySelector(sel).value;
  return {
    mawb: val('#bk-mawb'),
    hawb: val('#bk-hawb'),
    client: val('#bk-client'),
    dest: val('#bk-dest'),
    pcs: num('#bk-pcs'),
    gross_weight: num('#bk-gross'),
    volume_weight: num('#bk-volume'),
    cbm: num('#bk-cbm'),
    spl: val('#bk-spl'),
    remark: val('#bk-remark')
  };
}

// ===== 寫入數字欄位：只允許數字與小數點（解決 type=number 可輸入 E 的問題） =====
function sanitizeNumber(value) {
  let v = String(value == null ? '' : value);
  v = v.replace(/[^0-9.]/g, '');
  const firstDot = v.indexOf('.');
  if (firstDot >= 0) {
    v = v.slice(0, firstDot + 1) + v.slice(firstDot + 1).replace(/\./g, '');
  }
  return v;
}

// ===== 若 SPL 不在清單內，自動加入 spl_codes =====
async function maybeAddSplCode(spl) {
  if (!spl) return;
  const existing = getSplCodes().find(s => s.code.toUpperCase() === spl.toUpperCase());
  if (existing) return;
  try {
    await createSplCode({ code: spl, description: '' });
    setSplCodes(await fetchSplCodes());
  } catch (err) { /* 忽略 */ }
}

// ===== 若 REMARK 不在範本內，自動加入 =====
async function maybeAddRemarkTemplate(remark) {
  if (!remark) return;
  const existing = getRemarkTemplates().find(r => r.content === remark);
  if (existing) return;
  try {
    const name = remark.length > 30 ? remark.slice(0, 30) + '...' : remark;
    await createRemarkTemplate({ name, content: remark });
    setRemarkTemplates(await fetchRemarkTemplates());
  } catch (err) { /* 忽略 */ }
}