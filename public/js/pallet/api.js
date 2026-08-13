// ===== 打板計劃：API 呼叫層 =====
// 依賴 window.apiFetch（定義於 utils/api.js）

export async function fetchBookings(params = {}) {
  const query = new URLSearchParams();
  if (params.search) query.set('search', params.search);
  if (params.dest) query.set('dest', params.dest);
  if (params.only_unassigned) query.set('only_unassigned', '1');
  if (params.assignment && params.assignment !== '') query.set('assignment', params.assignment);
  if (params.exclude_plan_id) query.set('exclude_plan_id', params.exclude_plan_id);
  const qs = query.toString();
  const res = await apiFetch(`/api/pallet/bookings${qs ? '?' + qs : ''}`);
  return res.data || [];
}

export async function fetchBookingDestinations() {
  const res = await apiFetch('/api/pallet/bookings/destinations');
  return res.data || [];
}

// ===== 訂單 ↔ 打板 雙向同步 =====
export async function syncOrders(payload = {}) {
  const res = await apiFetch('/api/pallet/sync-orders', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
  return res;
}

export async function createBooking(payload) {
  const res = await apiFetch('/api/pallet/bookings', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
  return res.data;
}

export async function updateBooking(id, payload) {
  const res = await apiFetch(`/api/pallet/bookings/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload)
  });
  return res.data;
}

export async function deleteBooking(id) {
  const res = await apiFetch(`/api/pallet/bookings/${id}`, { method: 'DELETE' });
  return res;
}

export async function fetchPlans(status = '') {
  const qs = status ? `?status=${encodeURIComponent(status)}` : '';
  const res = await apiFetch(`/api/pallet/plans${qs}`);
  return res.data || [];
}

export async function createPlan(payload) {
  const res = await apiFetch('/api/pallet/plans', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
  return res.data;
}

export async function fetchPlanDetail(id) {
  const res = await apiFetch(`/api/pallet/plans/${id}`);
  return res.data;
}

export async function updatePlan(id, payload) {
  const res = await apiFetch(`/api/pallet/plans/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload)
  });
  return res.data;
}

export async function deletePlan(id) {
  const res = await apiFetch(`/api/pallet/plans/${id}`, { method: 'DELETE' });
  return res;
}

export async function duplicatePlan(id, copy_items = false) {
  const res = await apiFetch(`/api/pallet/plans/${id}/duplicate`, {
    method: 'POST',
    body: JSON.stringify({ copy_items })
  });
  return res.data;
}

export async function addItemsToPlan(planId, recordIds) {
  const res = await apiFetch(`/api/pallet/plans/${planId}/items`, {
    method: 'POST',
    body: JSON.stringify({ record_ids: recordIds })
  });
  return res;
}

export async function removeItemFromPlan(planId, planItemId) {
  const res = await apiFetch(`/api/pallet/plans/${planId}/items/${planItemId}`, {
    method: 'DELETE'
  });
  return res;
}

export async function reorderPlanItems(planId, orderedPlanItemIds) {
  const res = await apiFetch(`/api/pallet/plans/${planId}/items/reorder`, {
    method: 'PUT',
    body: JSON.stringify({ ordered_plan_item_ids: orderedPlanItemIds })
  });
  return res;
}

// 整張 Plan 卡片排序（永久儲存）
export async function reorderPlans(orderedPlanIds) {
  const res = await apiFetch('/api/pallet/plans/reorder', {
    method: 'PUT',
    body: JSON.stringify({ ordered_plan_ids: orderedPlanIds })
  });
  return res;
}

export async function fetchSplCodes() {
  const res = await apiFetch('/api/pallet/spl-codes');
  return res.data || [];
}

export async function createSplCode(payload) {
  const res = await apiFetch('/api/pallet/spl-codes', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
  return res;
}

export async function fetchRemarkTemplates() {
  const res = await apiFetch('/api/pallet/remark-templates');
  return res.data || [];
}

export async function createRemarkTemplate(payload) {
  const res = await apiFetch('/api/pallet/remark-templates', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
  return res;
}

// 公司清單（客戶 CLIENT autocomplete，沿用 /api/orders/companies）
export async function fetchCompanies(search = '') {
  const qs = search ? `?search=${encodeURIComponent(search)}` : '';
  const res = await apiFetch(`/api/orders/companies${qs}`);
  return res.data || [];
}

// Contour 相關（沿用現有 /api/contours API）
export async function fetchContourSuggestions(query = '') {
  const qs = query ? `?q=${encodeURIComponent(query)}` : '';
  const res = await fetch(`/api/contours/suggestions${qs}`, { cache: 'no-store' });
  const data = await res.json();
  return data.suggestions || [];
}

export async function searchContours(query = '') {
  const qs = query ? `?q=${encodeURIComponent(query)}` : '';
  const res = await fetch(`/api/contours${qs}`, { cache: 'no-store' });
  const data = await res.json();
  return data.data || [];
}

export function contourImageUrl(filename) {
  return `/api/contour-image/${encodeURIComponent(filename)}`;
}