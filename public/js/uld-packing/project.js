/**
 * public/js/uld-packing/project.js
 * 專案 API 互動：取得列表/詳情、建立專案、追加 ULD、新增客戶/貨物、刪除。
 */
(function () {
  'use strict';

  // 使用專案內建 apiFetch（public/js/utils/api.js）

  // ===== 專案 =====
  async function listProjects() {
    const res = await window.apiFetch('/api/packing/projects');
    return res.data || [];
  }

  async function getProject(id) {
    const res = await window.apiFetch(`/api/packing/projects/${id}`);
    return res.data || null;
  }

  async function createProject({ mawb, dest, ulds }) {
    const res = await window.apiFetch('/api/packing/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mawb, dest, ulds }),
    });
    return res;
  }

  async function deleteProject(id) {
    return window.apiFetch(`/api/packing/projects/${id}`, { method: 'DELETE' });
  }

  // ===== ULD =====
  async function addUlDs(projectId, uld_type, quantity) {
    return window.apiFetch(`/api/packing/projects/${projectId}/ulds`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uld_type, quantity }),
    });
  }

  async function deleteUld(projectId, uldId) {
    return window.apiFetch(`/api/packing/projects/${projectId}/ulds/${uldId}`, { method: 'DELETE' });
  }

  // ===== 客戶 =====
  async function addCustomer(projectId, hawb, customer_name) {
    return window.apiFetch(`/api/packing/projects/${projectId}/customers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hawb, customer_name }),
    });
  }

  // ===== 貨物 =====
  async function addItem(projectId, payload) {
    return window.apiFetch(`/api/packing/projects/${projectId}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  async function updateItem(projectId, itemId, payload) {
    return window.apiFetch(`/api/packing/projects/${projectId}/items/${itemId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  async function deleteItem(projectId, itemId) {
    return window.apiFetch(`/api/packing/projects/${projectId}/items/${itemId}`, { method: 'DELETE' });
  }

  // ===== ULD 選單（新增專案 modal 用） =====
  async function fetchUldTypes() {
    const res = await window.apiFetch('/api/packing/ulds');
    return res.data || [];
  }

  // ===== 對外 =====
  window.UPProject = {
    listProjects,
    getProject,
    createProject,
    deleteProject,
    addUlDs,
    deleteUld,
    addCustomer,
    addItem,
    updateItem,
    deleteItem,
    fetchUldTypes,
  };
})();