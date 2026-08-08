// ===== 訂單系統狀態集中管理 =====
// 從原 orders.js 抽出的所有全域可變狀態
// 注意：為維持零回歸，getter 回傳與原全域變數相同之物件/陣列參考（可原地 push/splice），
//       setter 用於整批替換。

// 原始資料
let ordersData = [];
let companiesCache = [];
let transportCompanies = [];

// 表單/編輯狀態
let currentOrderType = 'pickup';
let editingOrderId = null;
let duplicateConfirmed = false;

// 「今天的收貨」過濾（依提貨日期 pickup_datetime）
let todayPickupActive = false;

// 日期搜尋過濾（依提貨日期 pickup_datetime，'YYYY-MM-DD'）
let dateFilterValue = '';

// blur 重複檢查的 debounce timer（全域：submit handler 需 clearTimeout，防止 blur 卡片覆蓋「仍然繼續」卡片）
let duplicateCheckTimer = null;

// 每個公司欄位的「原始資料快照」（偵測用戶修改既有公司資料）
let companySnapshots = {};

// 備註範本暫存
let noteTemplatesCache = [];

// CBM DIM 尺寸資料 { len, width, height, qty }[]
let currentCbmDimensions = [];

// 電力組合項目（power_items 元素結構）: { type, main?, code, qty }
let powerItemsList = [];

// ===== ordersData =====
export function getOrdersData() { return ordersData; }
export function setOrdersData(list) { ordersData = list || []; }

// ===== companiesCache =====
export function getCompanies() { return companiesCache; }
export function setCompanies(list) { companiesCache = list || []; }

// ===== transportCompanies =====
export function getTransportCompanies() { return transportCompanies; }
export function setTransportCompanies(list) { transportCompanies = list || []; }

// ===== currentOrderType =====
export function getCurrentOrderType() { return currentOrderType; }
export function setCurrentOrderType(type) { currentOrderType = type || 'pickup'; }

// ===== editingOrderId =====
export function getEditingOrderId() { return editingOrderId; }
export function setEditingOrderId(id) { editingOrderId = id; }

// ===== duplicateConfirmed =====
export function getDuplicateConfirmed() { return duplicateConfirmed; }
export function setDuplicateConfirmed(val) { duplicateConfirmed = !!val; }

// ===== todayPickupActive =====
export function getTodayPickupActive() { return todayPickupActive; }
export function setTodayPickupActive(val) { todayPickupActive = !!val; }

// ===== dateFilterValue =====
export function getDateFilterValue() { return dateFilterValue; }
export function setDateFilterValue(val) { dateFilterValue = val || ''; }

// ===== duplicateCheckTimer（blur 重複檢查 debounce timer） =====
export function getDuplicateCheckTimer() { return duplicateCheckTimer; }
export function setDuplicateCheckTimer(timer) { duplicateCheckTimer = timer; }
export function clearDuplicateCheckTimer() {
  if (duplicateCheckTimer) {
    clearTimeout(duplicateCheckTimer);
    duplicateCheckTimer = null;
  }
}

// ===== companySnapshots =====
export function getCompanySnapshots() { return companySnapshots; }
export function getCompanySnapshot(hiddenId) { return companySnapshots[hiddenId] || null; }
export function setCompanySnapshot(hiddenId, snapshot) { companySnapshots[hiddenId] = snapshot; }
export function deleteCompanySnapshot(hiddenId) { delete companySnapshots[hiddenId]; }

// ===== noteTemplatesCache =====
export function getNoteTemplatesCache() { return noteTemplatesCache; }
export function setNoteTemplatesCache(list) { noteTemplatesCache = list || []; }

// ===== currentCbmDimensions =====
export function getCurrentCbmDimensions() { return currentCbmDimensions; }
export function setCurrentCbmDimensions(dims) { currentCbmDimensions = dims || []; }

// ===== powerItemsList =====
export function getPowerItemsList() { return powerItemsList; }
export function setPowerItemsList(list) { powerItemsList = list || []; }
export function resetPowerItemsList() { powerItemsList = []; }