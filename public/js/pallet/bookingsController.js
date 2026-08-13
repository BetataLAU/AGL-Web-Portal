// ===== 打板計劃：左欄 Booking Record 管理 =====
// 依賴 window.escapeHtml / window.setupAutocomplete（定義於 main.js / utils/autocomplete.js）
// MAWB# 引用 utils/mawb-utils.js（validateMawb/formatMawb/displayMawb 為 window 全域）
// HAWB# 引用 utils/hawb-utils.js（filterHawb/validateHawb 為 window 全域）

import {
  fetchBookings, fetchBookingDestinations, fetchSplCodes, fetchRemarkTemplates,
  addItemsToPlan
} from './api.js';
import {
  setBookings, getBookings, getSelectedBookingIds, toggleBookingSelection,
  getSelectedBookingsSummary, setSearchQuery, getSearchQuery,
  setDestFilter, getDestFilter, setAssignmentFilter, getAssignmentFilter,
  setSplCodes, setRemarkTemplates, getSelectedPlanId, clearSelectedBookings
} from './state.js';
import { formatNumber, formatWeight } from './formatters.js';
import { showBookingModal as openBookingModal } from './bookingModal.js';

let bookingsListEl = null;
let selectedCountEl = null;
let summaryPcsEl = null;
let summaryGwEl = null;
let summaryVwEl = null;
let summaryCbmEl = null;

export function renderBookingsColumn(container) {
  container.innerHTML = `
    <div class="pallet-bookings-col">
      <div class="pallet-bookings-toolbar">
        <div class="pallet-bookings-toolbar-row">
          <input type="search" id="pallet-booking-search" placeholder="搜尋 MAWB / 客戶 / 目的地 / SPL..." />
        </div>
        <div class="pallet-bookings-toolbar-row">
          <select id="pallet-assignment-filter">
            <option value="all">全部狀態</option>
            <option value="unassigned">未有 PLAN</option>
            <option value="assigned">已有 PLAN</option>
          </select>
          <button type="button" class="pallet-btn" id="btn-pallet-unselect-all" style="display:none;" title="取消全部選取">✕ 取消全部</button>
          <button type="button" class="pallet-btn pallet-btn-primary" id="btn-pallet-new-booking">＋ 新增</button>
        </div>
      </div>
      <div class="pallet-bookings-list" id="pallet-bookings-list">
        <div class="pallet-loading"><div class="spinner"></div> 載入中...</div>
      </div>
      <div class="pallet-bookings-summary" id="pallet-bookings-summary">
        <span class="summary-cell"><label>MAWB</label><b id="summary-count">0</b></span>
        <span class="summary-cell"><label>PCS</label><b id="summary-pcs">0</b></span>
        <span class="summary-cell"><label>G.WT</label><b id="summary-gw">0</b></span>
        <span class="summary-cell"><label>V.WT</label><b id="summary-vw">0</b></span>
        <span class="summary-cell"><label>CBM</label><b id="summary-cbm">0</b></span>
      </div>
    </div>
  `;

  bookingsListEl = document.getElementById('pallet-bookings-list');
  selectedCountEl = document.getElementById('summary-count');
  summaryPcsEl = document.getElementById('summary-pcs');
  summaryGwEl = document.getElementById('summary-gw');
  summaryVwEl = document.getElementById('summary-vw');
  summaryCbmEl = document.getElementById('summary-cbm');

  // 搜尋
  const searchInput = document.getElementById('pallet-booking-search');
  searchInput.addEventListener('input', debounce(async () => {
    setSearchQuery(searchInput.value.trim());
    await loadBookings();
  }, 350));

  // 入板狀態篩選（全部狀態 / 未有 PLAN / 已有 PLAN）
  const assignmentSelect = document.getElementById('pallet-assignment-filter');
  assignmentSelect.value = getAssignmentFilter();
  assignmentSelect.addEventListener('change', () => {
    setAssignmentFilter(assignmentSelect.value);
    loadBookings();
  });

  // 新增 Booking
  document.getElementById('btn-pallet-new-booking').addEventListener('click', () => {
    openBookingModal(null, { onSaved: handleBookingSaved });
  });

  // ===== 取消全部選取按鈕 =====
  const unselectAllBtn = document.getElementById('btn-pallet-unselect-all');
  if (unselectAllBtn) {
    unselectAllBtn.addEventListener('click', () => {
      clearSelectedBookings();
      renderBookings();
      notifySelectionChanged();
    });
  }
}

// 載入 SPL / REMARK 清單與目的地
export async function loadReferenceData() {
  try {
    const [spls, remarks, destinations] = await Promise.all([
      fetchSplCodes().catch(() => []),
      fetchRemarkTemplates().catch(() => []),
      fetchBookingDestinations().catch(() => [])
    ]);
    setSplCodes(spls);
    setRemarkTemplates(remarks);
    // destinations 清單保留給搜尋提示使用（下拉已轉為「入板狀態」）
    window.__palletDestinations = destinations || [];
  } catch (err) {
    console.error('[pallet] 載入參考資料失敗:', err);
  }
}

// 載入左欄 Bookings
export async function loadBookings() {
  try {
    const params = {
      search: getSearchQuery(),
      dest: getDestFilter(),
      assignment: getAssignmentFilter() || 'all'
    };
    const list = await fetchBookings(params);
    setBookings(list);
    // 清除已不存在的選取
    const validIds = new Set(list.map(b => b.id));
    getSelectedBookingIds().forEach(id => {
      if (!validIds.has(id)) getSelectedBookingIds().delete(id);
    });
    renderBookings();
  } catch (err) {
    if (bookingsListEl) {
      bookingsListEl.innerHTML = `<div class="pallet-empty">⚠️ 載入失敗：${escapeHtml(err.message)}</div>`;
    }
  }
}

// 渲染左欄列表 + 總計
export function renderBookings() {
  if (!bookingsListEl) return;
  const bookings = getBookings();
  if (!bookings.length) {
    bookingsListEl.innerHTML = `<div class="pallet-empty"><div class="empty-icon">📭</div>沒有未入板的 MAWB<br/><span style="font-size:0.75rem;">點「＋ 新增」建立 Booking Record</span></div>`;
  } else {
    bookingsListEl.innerHTML = bookings.map(b => renderBookingCard(b)).join('');
    bindBookingCardEvents();
  }
  renderSummary();
  // 通知 plansController 更新目標 select（拖曳/加入標的）
  window.dispatchEvent(new CustomEvent('pallet:bookings-rendered'));
}

// 綁定卡片事件：選取、編輯、雙擊加入
function bindBookingCardEvents() {
  // 點擊 → 選取/取消選取（僅切換 class + 更新總計，不重繪整列表）
  bookingsListEl.querySelectorAll('.pallet-booking-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.pallet-plan-ref-badge')) return;
      if (e.target.closest('.pallet-booking-edit-btn')) return;   // 修改按鈕不觸發選取
      const id = Number(card.dataset.id);
      toggleBookingSelection(id);
      card.classList.toggle('selected', getSelectedBookingIds().has(id));
      renderSummary();
      notifySelectionChanged();
    });
  });

  // ✏️ 修改按鈕 → 開啟編輯 Modal
  bookingsListEl.querySelectorAll('.pallet-booking-edit-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = Number(btn.dataset.bookingId);
      const booking = getBookings().find(b => b.id === id);
      if (booking) openBookingModal(booking, { onSaved: handleBookingSaved });
    });
  });

  // Double-click → 直接加入「已選定目標」Plan
  bookingsListEl.querySelectorAll('.pallet-booking-card').forEach(card => {
    card.addEventListener('dblclick', async (e) => {
      e.preventDefault();
      const targetPlanId = getSelectedPlanId();
      if (!targetPlanId) {
        alert('請先點擊一個「草稿」打板計劃作為目標');
        return;
      }
      const id = Number(card.dataset.id);
      try {
        await addItemsToPlan(targetPlanId, [id]);
        await loadBookings();
        window.dispatchEvent(new CustomEvent('pallet:data-changed'));
      } catch (err) {
        alert(err.message || '加入失敗');
      }
    });
  });
}

// 單張 Booking 卡片 HTML（精簡：僅核心資訊 + hover 展開次要資訊）
function renderBookingCard(b) {
  const selected = getSelectedBookingIds().has(b.id);
  const planRefs = (b.plan_refs || []).filter(r => r.status !== 'cancelled');
  const refBadges = planRefs.map(ref => {
    const locked = ref.status === 'locked' || ref.status === 'completed';
    return `<span class="pallet-plan-ref-badge ${locked ? 'locked-ref' : ''}" title="已入板：${escapeHtml(ref.plan_no)}（${escapeHtml(ref.status)}）">${escapeHtml(ref.plan_no)}${locked ? ' 🔒' : ''}</span>`;
  }).join(' ');

  // 跨板重複提示：同時存在於 2 個或以上 Plan → 黃色驚嘆號 + tooltip 列出所有板號
  const multiPlanHtml = planRefs.length >= 2
    ? `<span class="pallet-multi-plan-warn" title="此 MAWB 同時存在於 ${planRefs.length} 個打板計劃：&#10;${planRefs.map(r => `• ${escapeHtml(r.plan_no)}（${escapeHtml(r.status)}）`).join('&#10;')}">⚠️${planRefs.length}板</span>`
    : '';

  // 次要資訊（Hover 展開）：HAWB / 客戶 / 備註 / Plan 引用
  const detailRows = [];
  // 公司名稱加粗顯示（BOLD）
  if (b.client) detailRows.push(`<span class="detail-client"><b class="detail-client-name">${escapeHtml(b.client)}</b></span>`);
  if (b.hawb) detailRows.push(`<span class="detail-hawb">HAWB ${escapeHtml(b.hawb)}</span>`);
  if (b.remark) detailRows.push(`<span class="detail-remark">${escapeHtml(b.remark)}</span>`);
  if (refBadges) detailRows.push(`<span class="detail-refs">${refBadges}</span>`);

  return `
    <div class="pallet-booking-card ${selected ? 'selected' : ''}" data-id="${b.id}" draggable="true">
      <div class="pallet-booking-main">
        <button type="button" class="pallet-btn pallet-btn-sm pallet-booking-edit-btn" data-booking-id="${b.id}" title="修改此 MAWB 資料">✏️</button>
        <span class="booking-mawb">${escapeHtml(displayMawb(b.mawb))}</span>
        <span class="booking-dest">${escapeHtml(b.dest || '-')}</span>
        ${b.spl ? `<span class="pallet-spl-badge">${escapeHtml(b.spl)}</span>` : ''}
        ${multiPlanHtml}
        <span class="pallet-drag-hint" title="可拖曳到打板計劃">⠿</span>
      </div>
      <div class="pallet-booking-meta">
        <span>PCS <b>${formatNumber(b.pcs, 0)}</b></span>
        <span>G.WT <b>${formatWeight(b.gross_weight)}</b></span>
        <span>CBM <b>${formatNumber(b.cbm, 2)}</b></span>
      </div>
      ${detailRows.length ? `<div class="pallet-booking-detail">${detailRows.join('')}</div>` : ''}
    </div>
  `;
}

// 更新總計列（單行精簡）
function renderSummary() {
  if (!selectedCountEl) return;
  const summary = getSelectedBookingsSummary();
  selectedCountEl.textContent = summary.count;
  summaryPcsEl.textContent = formatNumber(summary.pcs, 0);
  summaryGwEl.textContent = formatWeight(summary.grossWeight);
  summaryVwEl.textContent = formatWeight(summary.volumeWeight);
  summaryCbmEl.textContent = formatNumber(summary.cbm, 2);
  // 「取消全部選取」按鈕：有選取時顯示
  const unselectAllBtn = document.getElementById('btn-pallet-unselect-all');
  if (unselectAllBtn) {
    unselectAllBtn.style.display = summary.count > 0 ? '' : 'none';
  }
}

// 選取變更 → 通知中間按鈕啟用狀態
function notifySelectionChanged() {
  window.dispatchEvent(new CustomEvent('pallet:selection-changed'));
}

// 顯示「新增/編輯 Booking」Modal（薄包裝：交由 bookingModal.js 處理表單）
export function showBookingModal(booking) {
  openBookingModal(booking, { onSaved: handleBookingSaved });
}

// Modal 儲存成功後：重整左欄 + 通知 plans 更新目標顯示
async function handleBookingSaved() {
  await loadBookings();
  window.dispatchEvent(new CustomEvent('pallet:data-changed'));
}