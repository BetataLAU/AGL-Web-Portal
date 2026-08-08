// ===== 訂單系統 API 呼叫（全數封裝 /api/orders/*） =====
// apiFetch 為 window 全域函式（定義於 public/js/utils/api.js，經典 script 先執行，module 可透過 window 存取）

import {
  setCompanies,
  getCompanies,
  setTransportCompanies,
  getTransportCompanies,
  setNoteTemplatesCache,
  getNoteTemplatesCache
} from './state.js';

// ===== 公司 API =====
export async function loadCompanies() {
  const result = await apiFetch('/api/orders/companies');
  setCompanies(result.data || []);
  return getCompanies();
}

export async function loadTransportCompanies() {
  const result = await apiFetch('/api/orders/companies?category=transport');
  setTransportCompanies(result.data || []);
  return getTransportCompanies();
}

// 建立新公司
export function saveCompany(payload) {
  return apiFetch('/api/orders/companies', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

// 更新既有公司
export function updateCompany(id, payload) {
  return apiFetch(`/api/orders/companies/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload)
  });
}

// ===== 重複檢查（參數化：由呼叫端組好 params，維持與原邏輯等價） =====
export async function checkDuplicateOrder(params = {}) {
  const search = new URLSearchParams();
  if (params.mawb) search.set('mawb', params.mawb);
  if (params.hawb) search.set('hawb', params.hawb);
  if (params.pickup_no) search.set('pickup_no', params.pickup_no);
  if (params.customer_company_id) search.set('customer_company_id', params.customer_company_id);
  if (params.exclude_id) search.set('exclude_id', params.exclude_id);

  const query = search.toString();
  if (!query) return [];

  try {
    const result = await apiFetch(`/api/orders/check-duplicate?${query}`);
    return result.data || [];
  } catch (err) {
    console.warn('重複檢查失敗：', err.message);
    return [];
  }
}

// ===== 訂單 API =====
// 取得訂單列表（含搜尋/狀態過濾）
export async function fetchOrdersList(params = {}) {
  const search = new URLSearchParams();
  if (params.search) search.set('search', params.search);
  if (params.status) search.set('status', params.status);
  const query = search.toString() ? `?${search.toString()}` : '';
  const result = await apiFetch(`/api/orders${query}`);
  return result.data || [];
}

export async function fetchOrder(id) {
  const result = await apiFetch(`/api/orders/${id}`);
  return result.data;
}

export function createOrder(data) {
  return apiFetch('/api/orders', {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

export function updateOrder(id, data) {
  return apiFetch(`/api/orders/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data)
  });
}

export function deleteOrder(id) {
  return apiFetch(`/api/orders/${id}`, { method: 'DELETE' });
}

// ===== 備註範本 API =====
export async function searchNoteTemplates(query) {
  try {
    const params = new URLSearchParams();
    if (query) params.set('search', query);
    const result = await apiFetch(`/api/orders/note-templates?${params.toString()}`);
    setNoteTemplatesCache(result.data || []);
    return getNoteTemplatesCache();
  } catch (err) {
    console.warn('備註範本搜尋失敗：', err.message);
    return [];
  }
}

export function saveNoteTemplate(name, content) {
  return apiFetch('/api/orders/note-templates', {
    method: 'POST',
    body: JSON.stringify({ name, content })
  });
}

// ===== 電郵應用程式 API =====
export async function getEmailApps() {
  const result = await apiFetch('/api/orders/email-apps');
  return result.data || [];
}

export function openEmailClient(payload) {
  return apiFetch('/api/orders/open-email-client', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}