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
  setDestFilter, getDestFilter, setSplCodes, setRemarkTemplates, getSelectedPlanId
} from './state.js';
import { formatNumber, formatWeight, splBadgeClass } from './formatters.js';
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
          <select id="pallet-dest-filter">
            <option value="">全部目的地</option>
          </select>
          <button type="button" class="pallet-btn pallet-btn-primary" id="btn-pallet-new-booking">＋ 新增</button>
        </div>
      </div>
      <div class="pallet-bookings-list" id="pallet-bookings-list">
        <div class="pallet-loading"><div class="spinner"></div> 載入中...</div>
      </div>
      <div class="pallet-bookings-summary" id="pallet-bookings-summary">
        <div class="summary-title">📌 已選總計</div>
        <div class="summary-numbers">
          <span>MAWB：<b id="summary-count">0</b></span>
          <span>PCS：<b id="summary-pcs">0</b></span>
          <span>重量：<b id="summary-gw">0</b> kg</span>
          <span>體積重：<b id="summary-vw">0</b> kg</span>
          <span>CBM：<b id="summary-cbm">0</b></span>
        </div>
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

  // 目的地篩選
  const destSelect = document.getElementById('pallet-dest-filter');
  destSelect.addEventListener('change', () => {
    setDestFilter(destSelect.value);
    loadBookings();
  });

  // 新增 Booking
  document.getElementById('btn-pallet-new-booking').addEventListener('click', () => {
    openBookingModal(null, { onSaved: handleBookingSaved });
  });
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
    const destSelect = document.getElementById('pallet-dest-filter');
    if (destSelect) {
      const current = destSelect.value;
      destSelect.innerHTML = '<option value="">全部目的地</option>' +
        destinations.map(d => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join('');
      destSelect.value = current;
    }
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
      only_unassigned: true
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

// 單張 Booking 卡片 HTML
function renderBookingCard(b) {
  const selected = getSelectedBookingIds().has(b.id);
  const splClass = splBadgeClass(b.spl);
  const planRefs = (b.plan_refs || []).filter(r => r.status !== 'cancelled');
  const refBadges = planRefs.map(ref => {
    const locked = ref.status === 'locked' || ref.status === 'completed';
    return `<span class="pallet-plan-ref-badge ${locked ? 'locked-ref' : ''}" title="已入板：${escapeHtml(ref.plan_no)}（${escapeHtml(ref.status)}）">📌 ${escapeHtml(ref.plan_no)}${locked ? ' 🔒' : ''}</span>`;
  }).join(' ');

  return `
    <div class="pallet-booking-card ${selected ? 'selected' : ''}" data-id="${b.id}" draggable="true">
      <div class="pallet-booking-mawb">
        <button type="button" class="pallet-btn pallet-btn-sm pallet-booking-edit-btn" data-booking-id="${b.id}" title="修改此 MAWB 資料">✏️</button>
        <span>✈️ ${escapeHtml(displayMawb(b.mawb))}${b.dest ? ' / ' + escapeHtml(b.dest) : ''}</span>
        ${b.spl ? `<span class="pallet-spl-badge ${splClass}">${escapeHtml(b.spl)}</span>` : ''}
      </div>
      <div class="pallet-booking-meta">
        <span>${escapeHtml(b.client || '-')}</span>
        <span>${formatNumber(b.pcs, 0)} / ${formatWeight(b.gross_weight)} k / v ${formatWeight(b.volume_weight)} k / ${formatNumber(b.cbm, 2)} cbm</span>
      </div>
      ${b.hawb ? `<div class="pallet-booking-meta"><span>HAWB：<b>${escapeHtml(b.hawb)}</b></span></div>` : ''}
      ${b.remark ? `<div class="pallet-booking-meta"><span>備註：${escapeHtml(b.remark)}</span></div>` : ''}
      ${refBadges ? `<div class="pallet-booking-meta">${refBadges}</div>` : ''}
    </div>
  `;
}

// 更新總計列
function renderSummary() {
  if (!selectedCountEl) return;
  const summary = getSelectedBookingsSummary();
  selectedCountEl.textContent = summary.count;
  summaryPcsEl.textContent = formatNumber(summary.pcs, 0);
  summaryGwEl.textContent = formatWeight(summary.grossWeight);
  summaryVwEl.textContent = formatWeight(summary.volumeWeight);
  summaryCbmEl.textContent = formatNumber(summary.cbm, 2);
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