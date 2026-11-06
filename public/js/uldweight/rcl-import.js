// ===== ULD 夾重系統：RCL 磅單匯入的前端輔助（W3）=====
// 流程：選檔 → 後端解析（只回傳欄位對應 + 候選單位）→ 使用者調整欄位／勾選 → 併入夾重表草稿 → 儲存
// 依賴：./api.js（importRclSheet）、./rcl-parse.js（前後端共用的解析純函式）
import { importRclSheet } from './api.js';
import { rclRowsFromGrid, rclText } from './rcl-parse.js';

// 開檔對話框（不在 HTML 固定放 <input type="file">，避免每個畫面都要維護）
export function pickRclFile() {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
    return Promise.resolve(null);
  }
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xlsx,.xlsm,.csv';
    input.style.display = 'none';
    document.body.appendChild(input);
    input.addEventListener('change', () => {
      const file = (input.files && input.files[0]) ? input.files[0] : null;
      input.remove();
      resolve(file);
    });
    input.click();
  });
}

// 上傳解析（第一次選檔／切換工作表時呼叫；只會讀檔，不會寫 DB）
export async function loadRclPreview(sheetId, options = {}) {
  const data = await importRclSheet(sheetId, options);
  const preview = {
    fileName: data.file_name || '',
    sheets: data.sheets || [],
    sheetName: data.sheet_name || '',
    headerRow: data.header_row || 0,
    header: data.header || [],
    columns: data.columns || { uld: -1, tare: -1, gross: -1, pcs: -1 },
    grid: data.grid || [],
    rows: data.rows || [],
    skipped: data.skipped || [],
    selected: []
  };
  preview.selected = preview.rows.map((row, idx) => idx); // 預設全選
  return preview;
}

// 改欄位對應後用同一支純函式重算（不必重新上傳檔案）
export function applyRclColumns(importState) {
  if (!importState) return null;
  const parsed = rclRowsFromGrid(importState.grid, importState.columns, { limit: 200 });
  importState.rows = parsed.rows;
  importState.skipped = parsed.skipped;
  importState.selected = parsed.rows.map((row, idx) => idx);
  return importState;
}

// 目前已勾選的列
export function selectedRclRows(importState) {
  if (!importState) return [];
  const set = new Set(importState.selected || []);
  return (importState.rows || []).filter((row, idx) => set.has(idx));
}

// ULD# 正規化（與後端／calc 相同：去空白、轉大寫）
export function rclUldKey(value) {
  return rclText(value).replace(/\s+/g, '').toUpperCase();
}
