// ===== 打板計劃：全域狀態管理 =====

let bookings = [];          // 左欄 Booking Records
let plans = [];             // 右欄 Plans（含 totals）
let planDetails = {};       // { planId: { items: [...] } } 已載入的明細
let selectedBookingIds = new Set();   // 左欄已選
let selectedPlanItemIds = {};         // { planId: Set<planItemId> } 右欄已選
let collapsedPlanIds = new Set();     // 已收合的 Plan
let searchQuery = '';
let destFilter = '';
let splCodes = [];
let remarkTemplates = [];
let contourSuggestionsCache = [];
let selectedPlanId = null;   // 目前已選定（目標）的 Plan
let expandedPlanId = null;   // 當前展開載入明細的 Plan

export function setBookings(list) { bookings = list; }
export function getBookings() { return bookings; }

export function setPlans(list) { plans = list; }
export function getPlans() { return plans; }

export function setPlanDetails(details) { planDetails = details; }
export function getPlanDetails() { return planDetails; }
export function getPlanItems(planId) {
  const detail = planDetails[planId];
  return (detail && detail.items) ? detail.items : [];
}
export function setPlanItems(planId, items) {
  if (!planDetails[planId]) planDetails[planId] = {};
  planDetails[planId].items = items;
}

export function getSelectedBookingIds() { return selectedBookingIds; }
export function setSelectedBookingIds(set) { selectedBookingIds = set; }
export function clearSelectedBookings() { selectedBookingIds.clear(); }
export function getSelectedPlanItemIds(planId) {
  if (!selectedPlanItemIds[planId]) selectedPlanItemIds[planId] = new Set();
  return selectedPlanItemIds[planId];
}
export function clearSelectedPlanItems() { selectedPlanItemIds = {}; }

export function getCollapsedPlanIds() { return collapsedPlanIds; }
export function isPlanCollapsed(planId) { return collapsedPlanIds.has(planId); }
export function togglePlanCollapsed(planId) {
  if (collapsedPlanIds.has(planId)) collapsedPlanIds.delete(planId);
  else collapsedPlanIds.add(planId);
}

export function setSearchQuery(q) { searchQuery = q; }
export function getSearchQuery() { return searchQuery; }

export function setDestFilter(d) { destFilter = d; }
export function getDestFilter() { return destFilter; }

export function setSplCodes(list) { splCodes = list; }
export function getSplCodes() { return splCodes; }

export function setRemarkTemplates(list) { remarkTemplates = list; }
export function getRemarkTemplates() { return remarkTemplates; }

export function setContourSuggestionsCache(list) { contourSuggestionsCache = list; }
export function getContourSuggestionsCache() { return contourSuggestionsCache; }

// ===== 已選定（目標）Plan =====
export function getSelectedPlanId() { return selectedPlanId; }
export function setSelectedPlanId(id) { selectedPlanId = id; }

// ===== 當前展開載入明細的 Plan =====
export function getExpandedPlanId() { return expandedPlanId; }
export function setExpandedPlanId(id) { expandedPlanId = id; }

// ===== 工時選取（點擊 + Ctrl/Cmd 多選） =====
export function toggleBookingSelection(bookingId) {
  if (selectedBookingIds.has(bookingId)) selectedBookingIds.delete(bookingId);
  else selectedBookingIds.add(bookingId);
}
export function setBookingSelected(bookingId, selected) {
  if (selected) selectedBookingIds.add(bookingId);
  else selectedBookingIds.delete(bookingId);
}
export function togglePlanItemSelection(planId, planItemId) {
  const set = getSelectedPlanItemIds(planId);
  if (set.has(planItemId)) set.delete(planItemId);
  else set.add(planItemId);
}

// ===== 已選總計 =====
export function getSelectedBookingsSummary() {
  let pcs = 0, grossWeight = 0, volumeWeight = 0, cbm = 0;
  bookings.forEach(b => {
    if (selectedBookingIds.has(b.id)) {
      pcs += Number(b.pcs) || 0;
      grossWeight += Number(b.gross_weight) || 0;
      volumeWeight += Number(b.volume_weight) || 0;
      cbm += Number(b.cbm) || 0;
    }
  });
  return { pcs, grossWeight, volumeWeight, cbm, count: selectedBookingIds.size };
}