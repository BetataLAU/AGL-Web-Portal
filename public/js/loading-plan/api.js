// ===== 執 PLAN：API 呼叫層 =====
// 依賴 window.apiFetch（public/js/utils/api.js，全域）
const BASE = '/api/loading-plan';

function call(path, options = {}) {
  return window.apiFetch(BASE + path, options);
}

function jsonCall(path, method, body) {
  return call(path, { method, body: JSON.stringify(body || {}) });
}

export const lpApi = {
  plans(params = {}) {
    const qs = new URLSearchParams();
    if (params.type) qs.set('type', params.type);
    if (params.search) qs.set('search', params.search);
    const query = qs.toString();
    return call(`/plans${query ? `?${query}` : ''}`);
  },
  plan(id) {
    return call(`/plans/${id}`);
  },
  createPlan(payload) {
    return jsonCall('/plans', 'POST', payload);
  },
  patchPlan(id, payload) {
    return jsonCall(`/plans/${id}`, 'PATCH', payload);
  },
  deletePlan(id) {
    return call(`/plans/${id}`, { method: 'DELETE' });
  },
  stock() {
    return call('/stock');
  },
  // 新增 Booking Record（建立後直接加入存貨；MAWB 已存在 → 409）
  createBooking(payload) {
    return jsonCall('/bookings', 'POST', payload);
  },
  addItems(planId, payload) {
    return jsonCall(`/plans/${planId}/items`, 'POST', payload);
  },
  bulkItems(planId, rows) {
    return jsonCall(`/plans/${planId}/items/bulk`, 'POST', { rows });
  },
  reorder(planId, itemIds, section = 1) {
    return jsonCall(`/plans/${planId}/reorder`, 'POST', { item_ids: itemIds, section });
  },
  patchItem(itemId, payload) {
    return jsonCall(`/items/${itemId}`, 'PATCH', payload);
  },
  removeItem(itemId, hard = false) {
    return call(`/items/${itemId}${hard ? '?hard=1' : ''}`, { method: 'DELETE' });
  },
  copyItem(itemId, planId) {
    return jsonCall(`/items/${itemId}/copy`, 'POST', { plan_id: planId });
  },
  bookings(search = '', limit = 30) {
    const qs = new URLSearchParams();
    if (search) qs.set('search', search);
    qs.set('limit', String(limit));
    return call(`/bookings?${qs.toString()}`);
  },
  placements(params = {}) {
    const qs = new URLSearchParams();
    if (params.mawb) qs.set('mawb', params.mawb);
    if (params.mawb_record_id) qs.set('mawb_record_id', params.mawb_record_id);
    return call(`/placements?${qs.toString()}`);
  },
  events(planId, since = 0) {
    return call(`/plans/${planId}/events?since=${since}`);
  }
};
