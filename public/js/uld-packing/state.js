/**
 * public/js/uld-packing/state.js
 * 全域狀態管理：目前專案、目前單位（KG/V.W 或 CBM）、暫存資料。
 */
(function () {
  'use strict';

  // 單位模式：'vw' = KG / 體積重；'cbm' = CBM
  let unitMode = 'vw';

  // 目前選中的專案 ID（null = 未選）
  let currentProjectId = null;

  // 目前選中的 ULD ID（null = 全部）
  let currentUldId = null;

  // 快取的專案詳情（避免重複請求）
  let currentProjectCache = null;

  /** 取得目前單位模式 */
  function getUnitMode() {
    return unitMode;
  }

  /** 切換單位模式 */
  function toggleUnitMode() {
    unitMode = unitMode === 'vw' ? 'cbm' : 'vw';
    return unitMode;
  }

  /** 單位模式顯示文字 */
  function unitLabel() {
    return unitMode === 'vw' ? 'KG / V.W' : 'CBM';
  }

  function getCurrentProjectId() {
    return currentProjectId;
  }

  function setCurrentProjectId(id) {
    currentProjectId = id;
  }

  function getCurrentUldId() {
    return currentUldId;
  }

  function setCurrentUldId(id) {
    currentUldId = id;
  }

  function getCurrentProjectCache() {
    return currentProjectCache;
  }

  function setCurrentProjectCache(project) {
    currentProjectCache = project;
  }

  // ===== 對外 =====
  window.UPState = {
    getUnitMode,
    toggleUnitMode,
    unitLabel,
    getCurrentProjectId,
    setCurrentProjectId,
    getCurrentUldId,
    setCurrentUldId,
    getCurrentProjectCache,
    setCurrentProjectCache,
  };
})();