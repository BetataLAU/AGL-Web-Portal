// ===== 打板計劃：Plan 相關 Modal（新增/編輯/狀態/Contour 預覽） =====
// 依賴 window.escapeHtml / window.setupAutocomplete（定義於 main.js / utils/autocomplete.js）
// 使用 callback 注入（onSaved / onChanged），避免與 plansController 循環依賴

import {
  createPlan, updatePlan, fetchContourSuggestions, searchContours, contourImageUrl
} from './api.js';
import {
  getContourSuggestionsCache, setContourSuggestionsCache, getRemarkTemplates
} from './state.js';

// ===== 新增/編輯 Plan Modal =====
export function showPlanModal(plan, { onSaved } = {}) {
  const isEdit = !!plan;

  const overlay = document.createElement('div');
  overlay.className = 'pallet-modal-overlay';
  overlay.innerHTML = `
    <div class="pallet-modal wide">
      <h2>${isEdit ? `✏️ 編輯計劃 ${escapeHtml(plan.plan_no)}` : '＋ 新增打板計劃'}</h2>
      <div class="pallet-modal-error" id="pallet-plan-error"></div>
      <div class="pallet-form-grid">
        <div class="pallet-form-field full">
          <label>公司名稱</label>
          <input type="text" id="pl-company" value="${isEdit ? escapeHtml(plan.company_name || '') : 'AIR GLOBAL LIMITED 世航貨運有限公司'}" />
        </div>
        <div class="pallet-form-field">
          <label>航班 (FLT#)</label>
          <input type="text" id="pl-flight-no" value="${isEdit ? escapeHtml(plan.flight_no || '') : ''}" placeholder="如 EK9859" style="text-transform:uppercase;" autocomplete="off" />
        </div>
        <div class="pallet-form-field">
          <label>航班日期</label>
          <input type="text" id="pl-flight-date" value="${isEdit ? String(plan.flight_date || '').replace(/-/g, '/').slice(0, 10) : ''}" placeholder="yyyy/mm/dd" autocomplete="off" />
        </div>
        <div class="pallet-form-field">
          <label>航班時間（24 小時制）</label>
          <input type="text" id="pl-flight-time" value="${isEdit ? String(plan.flight_date || '').slice(11, 16) : ''}" placeholder="HH:mm" maxlength="5" autocomplete="off" />
        </div>
        <div class="pallet-form-field">
          <label>目的地機場</label>
          <input type="text" id="pl-airport" value="${isEdit ? escapeHtml(plan.arrival_airport || '') : ''}" placeholder="如 DWC（唯一例外 SVO2）" style="text-transform:uppercase;" autocomplete="off" />
        </div>
        <div class="pallet-form-field full">
          <label>板型規格 (CONTOUR DESC)</label>
          <input type="text" id="pl-contour-text" value="${isEdit ? escapeHtml(plan.contour_text || '') : ''}" placeholder="REV 交 MIX 1 X Q4 (PMC-要縮入 10寸裝) - 貨機 / TERMINAL" />
          <div style="display:flex;gap:6px;align-items:center;">
            <input type="text" id="pl-contour-code" value="${isEdit ? escapeHtml(plan.contour_code || '') : ''}" placeholder="Contour code（如 PMC / ZQ / Q4）" style="flex:1;" />
            <button type="button" class="pallet-btn" id="btn-pl-contour-preview" disabled>👁 預覽</button>
          </div>
        </div>
        <div class="pallet-form-field">
          <label>策劃人 (PLANNER)</label>
          <input type="text" id="pl-planner" value="${isEdit ? escapeHtml(plan.planner || '') : ''}" placeholder="如 MAN" />
        </div>
        <div class="pallet-form-field">
          <label>最大承重 (kg，選填)</label>
          <input type="number" id="pl-max-weight" min="0" step="10" value="${isEdit ? (plan.max_gross_weight || '') : ''}" placeholder="如 4500" />
        </div>
        <div class="pallet-form-field">
          <label>交板倒數 (起飛前幾小時，選填)</label>
          <input type="number" id="pl-handover" min="0" step="1" value="${isEdit ? (plan.handover_hours || '') : '8'}" placeholder="如 8" />
        </div>
        <div class="pallet-form-field full">
          <label>備註 (REMARKS)</label>
          <textarea id="pl-remarks" placeholder="輸入或選擇常用備註">${isEdit ? escapeHtml(plan.remarks || '') : ''}</textarea>
        </div>
      </div>
      <div class="pallet-modal-actions">
        <button type="button" class="pallet-btn" id="pl-cancel">取消</button>
        <button type="button" class="pallet-btn pallet-btn-primary" id="pl-save">${isEdit ? '💾 儲存' : '＋ 建立'}</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const errBox = overlay.querySelector('#pallet-plan-error');
  const showError = (msg) => { errBox.textContent = msg; errBox.classList.add('show'); };

  // ===== 航班 (FLT#)：輸入時自動轉大楷 =====
  const flightNoInput = overlay.querySelector('#pl-flight-no');
  flightNoInput.addEventListener('input', () => {
    flightNoInput.value = flightNoInput.value.toUpperCase();
  });

  // ===== 航班日期：yyyy/mm/dd 自動格式化 =====
  const flightDateInput = overlay.querySelector('#pl-flight-date');
  flightDateInput.addEventListener('input', () => {
    let digits = flightDateInput.value.replace(/[^0-9]/g, '').slice(0, 8);
    let formatted = '';
    if (digits.length > 4) {
      formatted = digits.slice(0, 4) + '/' + digits.slice(4);
      if (digits.length > 6) formatted = formatted.slice(0, 7) + '/' + formatted.slice(7, 9);
    } else {
      formatted = digits;
    }
    flightDateInput.value = formatted;
  });

  // ===== 航班時間：HH:mm 自動格式化 =====
  const flightTimeInput = overlay.querySelector('#pl-flight-time');
  flightTimeInput.addEventListener('input', () => {
    let cleaned = flightTimeInput.value.replace(/[^0-9:]/g, '');
    const firstColon = cleaned.indexOf(':');
    if (firstColon >= 0) {
      cleaned = cleaned.slice(0, firstColon + 1) + cleaned.slice(firstColon + 1).replace(/:/g, '');
    }
    cleaned = cleaned.slice(0, 5);
    if (cleaned.indexOf(':') === -1 && cleaned.length >= 3) {
      const hh = cleaned.slice(0, 2);
      const mm = cleaned.slice(2);
      if (mm.length) cleaned = hh + ':' + mm;
    }
    const m = cleaned.match(/^(\d{0,2}):?(\d{0,2})$/);
    if (m) {
      let hh = m[1];
      let mm = m[2];
      if (hh && parseInt(hh, 10) > 23) hh = '23';
      if (mm && parseInt(mm, 10) > 59) mm = '59';
      cleaned = hh + (mm ? ':' + mm : '');
    }
    flightTimeInput.value = cleaned;
  });

  // ===== 目的地機場：只接英文字 + 自動大寫 + SVO2 例外 =====
  const airportInput = overlay.querySelector('#pl-airport');
  airportInput.addEventListener('input', () => {
    let v = airportInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (v !== 'SVO2' && v !== 'SVO') {
      v = v.replace(/[^A-Z]/g, '');
    }
    if (v.length > 4) v = v.slice(0, 4);
    if (v.length > 3 && v !== 'SVO2') v = v.slice(0, 3);
    airportInput.value = v;
  });

  // Contour code autocomplete
  const contourCodeInput = overlay.querySelector('#pl-contour-code');
  setupAutocomplete({
    input: contourCodeInput,
    suggestions: () => {
      const cache = getContourSuggestionsCache();
      if (cache.length) return cache;
      return fetchContourSuggestions('').then(list => { setContourSuggestionsCache(list); return list; });
    },
    emptyMessage: '沒有相符的 Contour，可輸入自訂值。'
  });

  // Contour 預覽按鈕
  const previewBtn = overlay.querySelector('#btn-pl-contour-preview');
  const findContourFile = (results, code) => {
    if (!results || !results.length) return null;
    const exact = results.find(r => (r.code || '').toUpperCase() === code.toUpperCase());
    if (exact) return exact;
    const prefix = results.find(r => (r.title || '').toUpperCase().startsWith(code.toUpperCase()));
    if (prefix) return prefix;
    return results[0];
  };
  const updatePreview = async () => {
    const code = contourCodeInput.value.trim().toUpperCase();
    if (!code) { previewBtn.disabled = true; return; }
    try {
      const results = await searchContours(code);
      const matched = findContourFile(results, code);
      if (matched) {
        previewBtn.disabled = false;
        previewBtn.dataset.filename = matched.filename;
      } else {
        previewBtn.disabled = true;
        delete previewBtn.dataset.filename;
      }
    } catch (e) {
      previewBtn.disabled = true;
    }
  };
  contourCodeInput.addEventListener('input', debounce(updatePreview, 400));
  updatePreview();
  previewBtn.addEventListener('click', () => {
    const filename = previewBtn.dataset.filename;
    if (filename) showContourPreview(filename);
  });

  // 備註 autocomplete
  const remarkInput = overlay.querySelector('#pl-remarks');
  const remarkSuggestions = getRemarkTemplates().map(r => r.content);
  setupAutocomplete({
    input: remarkInput,
    suggestions: () => remarkSuggestions,
    emptyMessage: '沒有相符的備註，可輸入自訂文字。'
  });

  // 關閉：若有未儲存變更，先確認
  const formFields = ['#pl-company', '#pl-flight-no', '#pl-flight-date', '#pl-flight-time',
    '#pl-airport', '#pl-contour-text', '#pl-contour-code', '#pl-max-weight',
    '#pl-handover', '#pl-planner', '#pl-remarks'];
  const initialValues = {};
  formFields.forEach(sel => { initialValues[sel] = (overlay.querySelector(sel) || {}).value; });
  const hasUnsavedChanges = () => formFields.some(sel => (overlay.querySelector(sel) || {}).value !== initialValues[sel]);
  const safeClose = () => {
    if (hasUnsavedChanges()) {
      if (!confirm('有未儲存的修改，確定離開？')) return;
    }
    overlay.remove();
  };
  overlay.querySelector('#pl-cancel').addEventListener('click', safeClose);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) safeClose(); });

  // 儲存
  overlay.querySelector('#pl-save').addEventListener('click', async () => {
    const flightDateRaw = overlay.querySelector('#pl-flight-date').value || '';
    const flightDateVal = flightDateRaw.replace(/\//g, '-');
    const flightTimeVal = overlay.querySelector('#pl-flight-time').value || '';
    const combinedFlightDate = (flightDateVal && flightTimeVal)
      ? `${flightDateVal}T${flightTimeVal}`
      : (flightDateVal || null);
    const payload = {
      company_name: overlay.querySelector('#pl-company').value.trim(),
      fax: '',
      plan_date: '',
      flight_no: overlay.querySelector('#pl-flight-no').value.trim(),
      flight_date: combinedFlightDate,
      arrival_airport: overlay.querySelector('#pl-airport').value.trim(),
      contour_text: overlay.querySelector('#pl-contour-text').value.trim(),
      contour_code: overlay.querySelector('#pl-contour-code').value.trim(),
      max_gross_weight: overlay.querySelector('#pl-max-weight').value || null,
      handover_hours: overlay.querySelector('#pl-handover').value || null,
      planner: overlay.querySelector('#pl-planner').value.trim(),
      remarks: overlay.querySelector('#pl-remarks').value.trim()
    };
    try {
      const savedPlan = isEdit
        ? await updatePlan(plan.id, payload)
        : await createPlan(payload);
      overlay.remove();
      if (onSaved) await onSaved(savedPlan, isEdit);
    } catch (err) {
      showError(err.message || '儲存失敗');
    }
  });
}

// ===== 狀態變更 Modal =====
export function showStatusModal(plan, { onChanged } = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'pallet-modal-overlay';
  overlay.innerHTML = `
    <div class="pallet-modal">
      <h2>📌 變更狀態：${escapeHtml(plan.plan_no)}</h2>
      <div class="pallet-modal-error" id="plan-status-error"></div>
      <div class="pallet-form-field full">
        <label>狀態</label>
        <select id="status-select">
          <option value="draft" ${plan.status === 'draft' ? 'selected' : ''}>草稿</option>
          <option value="locked" ${plan.status === 'locked' ? 'selected' : ''}>已鎖定</option>
          <option value="completed" ${plan.status === 'completed' ? 'selected' : ''}>已完成</option>
          <option value="cancelled" ${plan.status === 'cancelled' ? 'selected' : ''}>已取消</option>
        </select>
      </div>
      <div class="pallet-modal-actions">
        <button type="button" class="pallet-btn" id="status-cancel">取消</button>
        <button type="button" class="pallet-btn pallet-btn-primary" id="status-save">💾 變更</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  const errBox = overlay.querySelector('#plan-status-error');
  overlay.querySelector('#status-cancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  overlay.querySelector('#status-save').addEventListener('click', async () => {
    const newStatus = overlay.querySelector('#status-select').value;
    try {
      await updatePlan(plan.id, { status: newStatus });
      overlay.remove();
      if (onChanged) await onChanged();
    } catch (err) {
      errBox.textContent = err.message;
      errBox.classList.add('show');
    }
  });
}

// ===== Contour 圖片預覽 Modal =====
export function showContourPreview(filename) {
  const overlay = document.createElement('div');
  overlay.className = 'pallet-contour-overlay';
  overlay.innerHTML = `
    <div class="pallet-contour-modal">
      <button type="button" class="pallet-contour-close" id="contour-close">&times;</button>
      <img src="${contourImageUrl(filename)}" alt="${escapeHtml(filename)}" onerror="this.parentElement.innerHTML='<p style=padding:30px;color:#999;>找不到圖片：${escapeHtml(filename)}</p>'" />
      <div class="pallet-contour-modal-title">${escapeHtml(filename)}</div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector('#contour-close').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
}