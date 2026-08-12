// ===== 打板計劃：右欄 Plan Containers 管理 =====
// 依賴 window.escapeHtml / window.setupAutocomplete（定義於 main.js / utils/autocomplete.js）

import {
  fetchPlans, createPlan, fetchPlanDetail, updatePlan, deletePlan, duplicatePlan,
  addItemsToPlan, removeItemFromPlan, reorderPlanItems,
  fetchContourSuggestions, searchContours, contourImageUrl
} from './api.js';
import {
  setPlans, getPlans, getPlanItems, setPlanItems, getSelectedPlanItemIds,
  togglePlanItemSelection, clearSelectedPlanItems, isPlanCollapsed, togglePlanCollapsed,
  getSelectedBookingIds, clearSelectedBookings, getSelectedPlanId, setSelectedPlanId,
  getContourSuggestionsCache, setContourSuggestionsCache, getRemarkTemplates
} from './state.js';
import {
  STATUS_LABEL, formatNumber, formatWeight, splBadgeClass, getFlightCountdown, buildPlanTextSummary
} from './formatters.js';
import { loadBookings } from './bookingsController.js';

let plansColEl = null;
let expandedPlanId = null;   // 當前展開載入明細的 Plan

// ===== 渲染整個右欄 =====
export function renderPlansColumn(container) {
  container.innerHTML = `
    <div class="pallet-plans-header">
      <h3>📦 打板計劃</h3>
      <button type="button" class="pallet-btn pallet-btn-primary" id="btn-pallet-new-plan">＋ 新增計劃</button>
    </div>
    <div id="pallet-plans-list" class="pallet-plans-col">
      <div class="pallet-empty"><div class="empty-icon">🧱</div>尚未建立任何打板計劃<br/><span style="font-size:0.75rem;">點「＋ 新增計劃」開始</span></div>
    </div>
  `;
  plansColEl = container.querySelector('#pallet-plans-list');

  document.getElementById('btn-pallet-new-plan').addEventListener('click', () => {
    showPlanModal(null);
  });
}

// ===== 載入 Plans（列表） =====
export async function loadPlans() {
  try {
    const list = await fetchPlans();
    setPlans(list);
    renderPlans();
  } catch (err) {
    if (plansColEl) {
      plansColEl.innerHTML = `<div class="pallet-empty">⚠️ 載入計劃失敗：${escapeHtml(err.message)}</div>`;
    }
  }
}

// ===== 渲染 Plans =====
export function renderPlans() {
  if (!plansColEl) return;
  const plans = getPlans();
  if (!plans.length) {
    plansColEl.innerHTML = `<div class="pallet-empty"><div class="empty-icon">🧱</div>尚未建立任何打板計劃<br/><span style="font-size:0.75rem;">點「＋ 新增計劃」開始</span></div>`;
    return;
  }
  plansColEl.innerHTML = plans.map(plan => {
    const collapsed = isPlanCollapsed(plan.id) || (plan.status !== 'draft' && expandedPlanId !== plan.id);
    return renderPlanCard(plan, collapsed);
  }).join('');

  // 綁定標題列：點擊 = 選定目標 Plan（非按鈕時）
  plansColEl.querySelectorAll('.pallet-plan-card').forEach(card => {
    const planId = Number(card.dataset.planId);
    const plan = getPlans().find(p => p.id === planId);
    if (!plan) return;

    const header = card.querySelector('.pallet-plan-header');
    header.addEventListener('click', (e) => {
      // 點擊操作按鈕或展開箭頭 → 不選定
      if (e.target.closest('.pallet-plan-actions') || e.target.closest('.pallet-plan-action-btn')) return;
      if (e.target.closest('.pallet-plan-arrow')) return;
      setSelectedPlanId(planId);
      renderPlans();
    });

    // 明細表格：點選行多選
    card.querySelectorAll('.pallet-items-table tbody tr').forEach(row => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('.remove-item-btn')) return;
        const planItemId = Number(row.dataset.planItemId);
        togglePlanItemSelection(planId, planItemId);
        renderPlans();
      });
    });
  });

  setupPlanCardActions();
  updateTargetPlanDisplay();
}

// ===== 更新中間「已選定目標」顯示 =====
export function updateTargetPlanDisplay() {
  const el = document.getElementById('pallet-target-plan-display');
  if (!el) return;
  const planId = getSelectedPlanId();
  const plan = getPlans().find(p => p.id === planId);
  if (!plan || plan.status !== 'draft') {
    el.textContent = '📌 尚未選定目標（請點擊一個草稿計劃）';
    el.dataset.hasTarget = '0';
  } else {
    el.textContent = `📌 目標：${plan.plan_no}${plan.flight_no ? '（✈️ ' + plan.flight_no + '）' : ''}`;
    el.dataset.hasTarget = '1';
  }
}

// ===== 單張 Plan Card HTML =====
function renderPlanCard(plan, collapsed) {
  const statusClass = `status-${plan.status}`;
  const statusBadge = `<span class="pallet-status-badge ${plan.status}">${STATUS_LABEL[plan.status] || plan.status}</span>`;

  const countdown = getFlightCountdown(plan);
  const countdownHtml = countdown
    ? `<span class="pallet-plan-countdown ${countdown.urgent ? 'urgent' : ''}" title="${escapeHtml(countdown.text)}">${escapeHtml(countdown.text)}</span>`
    : '';

  const totals = plan.totals || {};
  const overweight = plan.max_gross_weight && Number(totals.gross_weight) > Number(plan.max_gross_weight);
  const overweightHtml = overweight
    ? `<span class="pallet-plan-overweight">⚠️ 超重 ${formatWeight(totals.gross_weight)} / 上限 ${formatWeight(plan.max_gross_weight)} kg</span>`
    : '';

  const isDraft = plan.status === 'draft';
  const showBody = !collapsed;
  const isSelected = getSelectedPlanId() === plan.id;   // 已選定高亮

  let bodyHtml = '';
  if (showBody) {
    bodyHtml = renderPlanBody(plan);
  }

  return `
    <div class="pallet-plan-card ${statusClass} ${collapsed ? 'collapsed' : ''} ${isSelected ? 'is-selected-plan' : ''}" data-plan-id="${plan.id}">
      <div class="pallet-plan-header">
        <div class="pallet-plan-header-left">
          <button type="button" class="pallet-plan-arrow" data-action="arrow-toggle" title="${collapsed ? '展開' : '收合'}">
            <i class="fa-solid ${collapsed ? 'fa-chevron-right' : 'fa-chevron-down'}"></i>
          </button>
          <span class="pallet-plan-title">
            <span class="plan-no">${escapeHtml(plan.plan_no)}</span>
            ${statusBadge}
          </span>
          <span class="pallet-plan-header-meta">
            <span>✈️ ${escapeHtml(plan.flight_no || '-')} ${escapeHtml(plan.flight_date || '')}</span>
            <span>📍 ${escapeHtml(plan.arrival_airport || '-')}</span>
            ${countdownHtml}
            ${overweightHtml}
            <span>PCS <b>${formatNumber(totals.pcs, 0)}</b></span>
            <span>毛重 <b>${formatWeight(totals.gross_weight)}</b>kg</span>
            <span>體積 <b>${formatWeight(totals.volume_weight)}</b>kg</span>
            <span>CBM <b>${formatNumber(totals.cbm, 2)}</b></span>
          </span>
          ${isSelected ? '<span class="pallet-selected-flag">🎯 目標</span>' : ''}
        </div>
        <div class="pallet-plan-actions">
          <button type="button" class="pallet-plan-action-btn" data-action="collapsed-toggle" title="展開/收合">
            <i class="fa-solid ${collapsed ? 'fa-chevron-down' : 'fa-chevron-up'}"></i>
          </button>
          ${isDraft ? `
            <button type="button" class="pallet-plan-action-btn" data-action="edit" title="編輯計劃"><i class="fa-solid fa-pen"></i></button>
            <button type="button" class="pallet-plan-action-btn" data-action="lock" title="鎖定（上鎖後不可修改）"><i class="fa-solid fa-lock"></i></button>
          ` : `
            <button type="button" class="pallet-plan-action-btn lock-btn" data-action="unlock" title="解鎖回草稿"><i class="fa-solid fa-unlock"></i></button>
          `}
          <button type="button" class="pallet-plan-action-btn" data-action="duplicate" title="複製計劃"><i class="fa-solid fa-copy"></i></button>
          <button type="button" class="pallet-plan-action-btn" data-action="print" title="列印"><i class="fa-solid fa-print"></i></button>
          <button type="button" class="pallet-plan-action-btn" data-action="excel" title="匯出 Excel"><i class="fa-solid fa-file-excel"></i></button>
          <button type="button" class="pallet-plan-action-btn" data-action="copy-summary" title="複製總結"><i class="fa-solid fa-clipboard"></i></button>
          <button type="button" class="pallet-plan-action-btn" data-action="status" title="變更狀態"><i class="fa-solid fa-flag"></i></button>
          <button type="button" class="pallet-plan-action-btn danger" data-action="delete" title="刪除計劃"><i class="fa-solid fa-trash"></i></button>
        </div>
      </div>
      ${showBody ? `<div class="pallet-plan-body">${bodyHtml}</div>` : ''}
    </div>
  `;
}

// ===== Plan Body（資訊區 + 備註 + 明細表 + 總計） =====
function renderPlanBody(plan) {
  const items = getPlanItems(plan.id);
  const isDraft = plan.status === 'draft';
  const selectedSet = getSelectedPlanItemIds(plan.id);
  const contourChip = plan.contour_code
    ? `<span class="pallet-contour-chip" data-contour-code="${escapeHtml(plan.contour_code)}" title="點擊查看 Contour 圖片">🖼 ${escapeHtml(plan.contour_code)}</span>`
    : '';

  const rows = items.length ? items.map((it, idx) => {
    const selected = selectedSet.has(it.plan_item_id);
    const splClass = splBadgeClass(it.spl);
    return `
      <tr data-plan-item-id="${it.plan_item_id}" class="${selected ? 'selected-row' : ''}">
        <td>${idx + 1}</td>
        <td class="mawb-cell">${escapeHtml(it.mawb || '-')}</td>
        <td>${escapeHtml(it.hawb || '-')}</td>
        <td>${escapeHtml(it.client || '-')}</td>
        <td>${escapeHtml(it.dest || '-')}</td>
        <td class="num">${formatNumber(it.pcs, 0)}</td>
        <td class="num">${formatWeight(it.gross_weight)}</td>
        <td class="num">${formatWeight(it.volume_weight)}</td>
        <td class="num">${formatNumber(it.cbm, 2)}</td>
        <td>${it.spl ? `<span class="pallet-spl-badge ${splClass}">${escapeHtml(it.spl)}</span>` : '-'}</td>
        <td class="cell-remark" title="${escapeHtml(it.remark || '')}">${escapeHtml(it.remark || '-')}</td>
        ${isDraft ? `<td><button type="button" class="pallet-btn pallet-btn-sm remove-item-btn" data-action="remove-item" data-plan-item-id="${it.plan_item_id}">移出</button></td>` : ''}
      </tr>
    `;
  }).join('') : `<tr><td colspan="12" style="text-align:center;color:var(--text-muted);padding:20px;">尚無 MAWB，拖曳或使用按鈕加入</td></tr>`;

  const totals = plan.totals || {};
  return `
    <div class="pallet-plan-info-grid">
      <div class="pallet-plan-info-item"><span class="label">公司：</span><span class="value">${escapeHtml(plan.company_name || '-')}</span></div>
      <div class="pallet-plan-info-item"><span class="label">航班：</span><span class="value">${escapeHtml(plan.flight_no || '-')} / ${escapeHtml(plan.flight_date || '')}</span></div>
      <div class="pallet-plan-info-item"><span class="label">目的地機場：</span><span class="value">${escapeHtml(plan.arrival_airport || '-')}</span></div>
      <div class="pallet-plan-info-item"><span class="label">板型規格：</span><span class="value">${escapeHtml(plan.contour_text || '-')} ${contourChip}</span></div>
      <div class="pallet-plan-info-item"><span class="label">策劃人：</span><span class="value">${escapeHtml(plan.planner || '-')}</span></div>
      ${plan.max_gross_weight ? `<div class="pallet-plan-info-item"><span class="label">最大承重：</span><span class="value">${formatWeight(plan.max_gross_weight)} kg</span></div>` : ''}
      ${plan.handover_hours ? `<div class="pallet-plan-info-item"><span class="label">交板時間：</span><span class="value">起飛前 ${plan.handover_hours} 小時</span></div>` : ''}
    </div>
    ${plan.remarks ? `<div class="pallet-plan-remarks"><span class="remarks-label">📝 備註 (REMARKS)：</span>${escapeHtml(plan.remarks)}</div>` : ''}
    <div class="pallet-items-table-wrap">
      <table class="pallet-items-table">
        <thead>
          <tr>
            <th>#</th>
            <th>MAWB</th>
            <th>HAWB</th>
            <th>CLIENT</th>
            <th>DEST</th>
            <th class="num">PCS</th>
            <th class="num">G.WT (kg)</th>
            <th class="num">V.WT (kg)</th>
            <th class="num">CBM</th>
            <th>SPL</th>
            <th>REMARK</th>
            ${isDraft ? '<th></th>' : ''}
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>
    <div class="pallet-plan-total">
      <div class="total-grid ${isDraft ? 'has-remove-col' : ''}">
        <span class="total-cell">總計</span>
        <span class="total-cell">${items.length} 單</span>
        <span class="total-cell total-dash">—</span>
        <span class="total-cell total-dash">—</span>
        <span class="total-cell total-dash">—</span>
        <span class="total-cell num">${formatNumber(totals.pcs, 0)}</span>
        <span class="total-cell num">${formatWeight(totals.gross_weight)}</span>
        <span class="total-cell num">${formatWeight(totals.volume_weight)}</span>
        <span class="total-cell num">${formatNumber(totals.cbm, 2)}</span>
        <span class="total-cell total-dash">—</span>
        <span class="total-cell total-dash">—</span>
        ${isDraft ? '<span class="total-cell"></span>' : ''}
      </div>
      ${isDraft ? `<div style="font-size:0.72rem;color:var(--text-muted);padding:8px 14px;">💡 點選行可多選，再按「移出」或拖曳排序</div>` : ''}
    </div>
  `;
}

// ===== 載入單一 Plan 明細 =====
export async function loadPlanDetail(planId) {
  try {
    const detail = await fetchPlanDetail(planId);
    setPlanItems(planId, detail.items);
    // 更新 Plans 列表中的 totals
    const plans = getPlans();
    const idx = plans.findIndex(p => p.id === planId);
    if (idx >= 0) {
      plans[idx] = { ...plans[idx], totals: detail.totals };
      setPlans(plans);
    }
    renderPlans();
  } catch (err) {
    console.error('[pallet] 載入 Plan 明細失敗:', err);
  }
}

// ===== 新增/編輯 Plan Modal =====
export function showPlanModal(plan) {
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

  // ===== 航班日期：yyyy/mm/dd 自動格式化（只保留數字 + 斜線） =====
  const flightDateInput = overlay.querySelector('#pl-flight-date');
  flightDateInput.addEventListener('input', () => {
    // 只保留數字
    let digits = flightDateInput.value.replace(/[^0-9]/g, '').slice(0, 8);
    // 自動插入斜線：yyyy/mm/dd
    let formatted = '';
    if (digits.length > 4) {
      formatted = digits.slice(0, 4) + '/' + digits.slice(4);
      if (digits.length > 6) {
        formatted = formatted.slice(0, 7) + '/' + formatted.slice(7, 9);
      }
    } else {
      formatted = digits;
    }
    flightDateInput.value = formatted;
  });

  // ===== 航班時間：HH:mm 自動格式化（只保留數字 + 冒號，移除非 AM/PM 的 "--"） =====
  const flightTimeInput = overlay.querySelector('#pl-flight-time');
  flightTimeInput.addEventListener('input', () => {
    // 只保留數字與冒號；任何 ""--"" 或 AM/PM 字元直接移除（因為由 placeholder "HH:mm" 顯示格式）
    let cleaned = flightTimeInput.value.replace(/[^0-9:]/g, '');
    // 只保留第一個冒號
    const firstColon = cleaned.indexOf(':');
    if (firstColon >= 0) {
      cleaned = cleaned.slice(0, firstColon + 1) + cleaned.slice(firstColon + 1).replace(/:/g, '');
    }
    // 最多 5 字（HH:mm）
    cleaned = cleaned.slice(0, 5);
    // 自動補冒號：輸入 4 位數字時轉 HH:mm
    if (cleaned.indexOf(':') === -1 && cleaned.length >= 3) {
      const hh = cleaned.slice(0, 2);
      const mm = cleaned.slice(2);
      if (mm.length) cleaned = hh + ':' + mm;
    }
    // 限制小時 0-23、分鐘 0-59
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

  // ===== 目的地機場：只接英文字 + 自動大寫 + 最多 3 字 + SVO2 例外 =====
  const airportInput = overlay.querySelector('#pl-airport');
  airportInput.addEventListener('input', () => {
    // 只保留英文字母（SVO2 例外含數字 2）
    let v = airportInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    // 非 SVO2 的情況只允許英文字
    if (v !== 'SVO2' && v !== 'SVO') {
      v = v.replace(/[^A-Z]/g, '');
    }
    // 最多 4 字（允許暫時輸入 SVO2）
    if (v.length > 4) v = v.slice(0, 4);
    // 若超過 3 字但不等於 SVO2，截斷
    if (v.length > 3 && v !== 'SVO2') v = v.slice(0, 3);
    airportInput.value = v;
  });

  // Contour code autocomplete（動態從 /api/contours/suggestions 取得）
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

  // Contour 預覽按鈕（精確匹配 code 優先，其次才是 substring 第一個結果）
  const previewBtn = overlay.querySelector('#btn-pl-contour-preview');
  const findContourFile = (results, code) => {
    if (!results || !results.length) return null;
    // 1. code 與檔名前綴完全相等（如 ZQ → ZQ*.jpg）
    const exact = results.find(r => (r.code || '').toUpperCase() === code.toUpperCase());
    if (exact) return exact;
    // 2. 檔名（去除副檔名）以 code 開頭
    const prefix = results.find(r => (r.title || '').toUpperCase().startsWith(code.toUpperCase()));
    if (prefix) return prefix;
    // 3. fallback 第一個結果
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

  // 備註 autocomplete（常用範本）
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
    // 合併日期 + 時間 → 'YYYY-MM-DDTHH:mm'（24 小時制）
    // 日期欄位輸入格式為 yyyy/mm/dd → 轉回 yyyy-mm-dd
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
      if (isEdit) {
        await updatePlan(plan.id, payload);
      } else {
        const newPlan = await createPlan(payload);
        togglePlanCollapsed(newPlan.id);
        expandedPlanId = newPlan.id;
      }
      overlay.remove();
      await loadPlans();
      window.dispatchEvent(new CustomEvent('pallet:data-changed'));
    } catch (err) {
      showError(err.message || '儲存失敗');
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

// ===== Plan 卡片操作事件 =====
function setupPlanCardActions() {
  if (!plansColEl) return;
  plansColEl.querySelectorAll('.pallet-plan-card').forEach(card => {
    const planId = Number(card.dataset.planId);
    card.querySelectorAll('.pallet-plan-action-btn[data-action]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        handlePlanAction(planId, btn.dataset.action);
      });
    });
    // 標題列左側箭頭 → 展開/收合
    card.querySelectorAll('.pallet-plan-arrow[data-action]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        handlePlanAction(planId, btn.dataset.action);
      });
    });
    card.querySelectorAll('.remove-item-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const planItemId = Number(btn.dataset.planItemId);
        handleRemoveItem(planId, planItemId);
      });
    });
    card.querySelectorAll('.pallet-contour-chip').forEach(chip => {
      chip.addEventListener('click', (e) => {
        e.stopPropagation();
        const code = chip.dataset.contourCode;
        searchContours(code).then(results => {
          if (results.length) showContourPreview(results[0].filename);
        });
      });
    });
  });
}

// ===== Plan 操作分派 =====
async function handlePlanAction(planId, action) {
  const plan = getPlans().find(p => p.id === planId);
  if (!plan) return;

  switch (action) {
    case 'arrow-toggle':
    case 'collapsed-toggle': {
      const collapsed = isPlanCollapsed(planId);
      if (collapsed) {
        togglePlanCollapsed(planId);
        expandedPlanId = planId;
        loadPlanDetail(planId);
      } else {
        togglePlanCollapsed(planId);
        expandedPlanId = null;
        renderPlans();
      }
      break;
    }
    case 'edit': {
      if (plan.status !== 'draft') {
        alert('計劃已上鎖/完成，請先解鎖再編輯');
        return;
      }
      showPlanModal(plan);
      break;
    }
    case 'lock': {
      if (!confirm(`確定鎖定計劃 ${plan.plan_no}？\n鎖定後左欄的 MAWB 將不再顯示，需解鎖才能修改。`)) return;
      try {
        await updatePlan(planId, { status: 'locked' });
        await afterPlanChange();
        alert('🔒 計劃已鎖定');
      } catch (err) { alert(err.message); }
      break;
    }
    case 'unlock': {
      if (!confirm(`解鎖計劃 ${plan.plan_no} 回「草稿」？`)) return;
      try {
        await updatePlan(planId, { status: 'draft' });
        await afterPlanChange();
        alert('🔓 已解鎖回草稿');
      } catch (err) { alert(err.message); }
      break;
    }
    case 'duplicate': {
      const copyItems = confirm(`複製計劃 ${plan.plan_no}？\n按「確定」→ 連同明細一齊複製\n按「取消」→ 只複製計劃資料（不含 MAWB）`);
      try {
        const newPlan = await duplicatePlan(planId, copyItems);
        await loadPlans();
        if (copyItems) {
          togglePlanCollapsed(newPlan.id);
          expandedPlanId = newPlan.id;
          await loadPlanDetail(newPlan.id);
        }
        await loadBookings();
      } catch (err) { alert(err.message); }
      break;
    }
    case 'print': {
      if (isPlanCollapsed(planId)) {
        togglePlanCollapsed(planId);
        expandedPlanId = planId;
        await loadPlanDetail(planId);
      }
      setTimeout(() => window.print(), 300);
      break;
    }
    case 'excel': {
      exportPlanExcel(planId);
      break;
    }
    case 'copy-summary': {
      try {
        const detail = await fetchPlanDetail(planId);
        const text = buildPlanTextSummary(detail, detail.items);
        await navigator.clipboard.writeText(text);
        alert('📋 計劃總結已複製到剪貼簿');
      } catch (err) {
        alert('複製失敗：' + err.message);
      }
      break;
    }
    case 'status': {
      showStatusModal(plan);
      break;
    }
    case 'delete': {
      if (!confirm(`確定刪除計劃 ${plan.plan_no}？\n其內所有 MAWB 將移回左欄。此操作不可復原！`)) return;
      try {
        await deletePlan(planId);
        clearSelectedPlanItems();
        await afterPlanChange();
      } catch (err) { alert(err.message); }
      break;
    }
  }
}

// 狀態變更 Modal
function showStatusModal(plan) {
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
      await afterPlanChange();
    } catch (err) {
      errBox.textContent = err.message;
      errBox.classList.add('show');
    }
  });
}

// 移出單一明細
async function handleRemoveItem(planId, planItemId) {
  try {
    await removeItemFromPlan(planId, planItemId);
    await afterPlanChange();
    await loadBookings();
  } catch (err) {
    alert(err.message);
  }
}

// 批量加入所選（中間按鈕：使用已選定目標；拖曳：傳入目標 planId）
export async function handleAddSelectedToPlan(planId) {
  const selectedIds = [...getSelectedBookingIds()];
  if (!selectedIds.length) return alert('請先在左欄選擇 MAWB');
  let targetId = planId;
  if (!targetId) {
    targetId = getSelectedPlanId();
  }
  if (!targetId) return alert('請先點擊一個「草稿」打板計劃作為目標');
  const targetPlan = getPlans().find(p => p.id === targetId);
  if (!targetPlan || targetPlan.status !== 'draft') {
    return alert('目標計劃已上鎖/完成，請選擇其他草稿計劃');
  }
  try {
    await addItemsToPlan(targetId, selectedIds);
    clearSelectedBookings();
    await afterPlanChange();
    await loadBookings();
  } catch (err) {
    alert(err.message);
  }
}

// 批量移出所選（中間按鈕：使用已選定目標的明細選取）
export async function handleRemoveSelectedFromPlan(planId) {
  let targetId = planId;
  if (!targetId) {
    targetId = getSelectedPlanId();
  }
  if (!targetId) return alert('請先點擊一個「草稿」打板計劃作為目標');
  const set = getSelectedPlanItemIds(targetId);
  const items = [...set];
  if (!items.length) return alert('請先在計劃明細中選擇要移出的 MAWB');
  if (!confirm(`確定將 ${items.length} 筆 MAWB 移出該計劃？`)) return;
  try {
    for (const planItemId of items) {
      await removeItemFromPlan(targetId, planItemId);
    }
    set.clear();
    await afterPlanChange();
    await loadBookings();
  } catch (err) {
    alert(err.message);
  }
}

// 資料變更後：重整 Plans + 明細
export async function afterPlanChange() {
  const expandedId = expandedPlanId;
  await loadPlans();
  if (expandedId) {
    expandedPlanId = expandedId;
    await loadPlanDetail(expandedId);
  }
  updateTargetPlanDisplay();
}

// ===== Excel 匯出（Q28-B） =====
export async function exportPlanExcel(planId) {
  try {
    const detail = await fetchPlanDetail(planId);
    if (typeof XLSX === 'undefined') {
      alert('Excel 匯出功能未載入（需要 XLSX 函式庫）');
      return;
    }
    const aoa = [
      ['打板計劃', detail.plan_no],
      ['公司名稱', detail.company_name || ''],
      ['航班資料 (FLT#)', `${detail.flight_no || ''} / ${detail.flight_date || ''}`],
      ['目的地機場', detail.arrival_airport || ''],
      ['板型規格', detail.contour_text || ''],
      ['策劃人', detail.planner || ''],
      ['狀態', STATUS_LABEL[detail.status] || detail.status],
      [],
      ['MAWB', 'HAWB', 'CLIENT', 'DEST', 'PCS', 'G.WT (kg)', 'V.WT (kg)', 'CBM', 'SPL', 'REMARK']
    ];
    (detail.items || []).forEach(it => {
      aoa.push([
        it.mawb || '', it.hawb || '', it.client || '', it.dest || '',
        it.pcs || 0, it.gross_weight || 0, it.volume_weight || 0, it.cbm || 0,
        it.spl || '', it.remark || ''
      ]);
    });
    const totals = detail.totals || {};
    aoa.push([]);
    aoa.push(['總計', '', '', '', totals.pcs || 0, totals.gross_weight || 0, totals.volume_weight || 0, totals.cbm || 0, '', '']);
    if (detail.remarks) {
      aoa.push([]);
      aoa.push(['備註', detail.remarks]);
    }

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{ wch: 16 }, { wch: 14 }, { wch: 30 }, { wch: 8 }, { wch: 8 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 40 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '打板計劃');
    XLSX.writeFile(wb, `${detail.plan_no}.xlsx`);
  } catch (err) {
    alert('匯出失敗：' + err.message);
  }
}