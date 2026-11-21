// ===== ULD 夾重系統：入口（admin / staff，由 main.js 的 initProtectedSections 呼叫）=====
// 版面：① 收貨單位（P/X 板、B 散貨）② 夾重結果（MAWB 彙總）③ 檢核；算法全部在 uldweight/calc.js
import {
  fetchSheets, createSheet, fetchSheet, saveSheet, deleteSheet, duplicateSheet, setSheetLocked, applySheet,
  fetchReportPdfBlob, fetchLoadingSheetPdfBlob, fetchBatchPdfBlob, syncSheetBookings, fetchSheetVersions, fetchVersionDiff
} from './uldweight/api.js';
import {
  uldWeightState, uldSheetFromApi, uldSheetPayload, uldNewUnit, uldNewItem, uldNewMawb,
  uldFindUnit, uldFindMawb, uldRowItems, uldEnsureItem, uldSyncRowToItems, uldRemoveMawbRow,
  uldSetRowSqueeze, uldMarkDirty, uldSplitMawb, uldComputed, uldMoveUnit, uldSetCellWeight, ULD_MAX_UNITS,
  uldToggleUnitLih, uldAssignMawbToUnit, uldMoveItemToUnit
} from './uldweight/state.js';
import { renderList, renderEditor, refreshComputed, refreshRclImport, refreshVersions } from './uldweight/render.js';
import { resetBookingCache } from './uldweight/booking-search.js';
import { uldParsePastedRows, uldPasteIsMawbField } from './uldweight/paste-parse.js';
import { uldFormatMawb, uldValidateMawb, uldMawbDigits, uldMawbIssueText } from './uldweight/mawb-format.js';
import {
  pickRclFile, loadRclPreview, applyRclColumns, selectedRclRows, rclUldKey
} from './uldweight/rcl-import.js';
import { uldFmtKg, uldNum, uldMawbKey, uldIssueText, uldLihLabel, uldUnitLabel } from './uldweight/calc.js';

let initialized = false;
let rootEl = null;
// ③ 合併／分配：十字高亮的目前狀態（'' = 沒有；render 後會歸零，見 render()）
let mergeHlKey = '';
let mergeHlUnit = '';

function state() {
  return uldWeightState;
}

function toast(text) {
  if (typeof window.showTemporaryNotice === 'function' && rootEl) {
    window.showTemporaryNotice(rootEl, text);
  } else if (rootEl) {
    const box = document.createElement('div');
    box.className = 'uldw-toast';
    box.textContent = text;
    rootEl.appendChild(box);
    setTimeout(() => box.remove(), 2500);
  }
}

// ===== 畫畫面 =====
function render() {
  if (!rootEl) return;
  // 合併頁的十字高亮是「額外掛在 DOM 上的 class」，重畫後會被清掉 → 狀態一起歸零
  mergeHlKey = '';
  mergeHlUnit = '';
  if (state().view === 'list') renderList(rootEl);
  else renderEditor(rootEl);
  syncHeaderButtons();
}

function syncHeaderButtons() {
  const inEditor = state().view === 'editor';
  const btnExport = document.getElementById('uldw-btn-export');
  const btnCopy = document.getElementById('uldw-btn-copy');
  if (btnExport) btnExport.disabled = !inEditor;
  if (btnCopy) btnCopy.disabled = !inEditor;
}

// ===== 資料載入 =====
async function loadList(options = {}) {
  const s = state();
  try {
    s.sheets = await fetchSheets(s.listFilter);
  } catch (err) {
    s.sheets = [];
    alert(`載入夾重表失敗：${err.message}`);
  }
  // V2：剔除已不存在（或已被篩掉）的批次勾選 id，避免下載到清單上看不到的夾重表
  const existing = new Set((s.sheets || []).map(row => Number(row.id)));
  s.batchSelected = (s.batchSelected || []).map(id => Number(id)).filter(id => existing.has(id));
  s.view = 'list';
  render();
  // 邊打字邊查時把焦點還給搜尋框（renderList 會重建 DOM）
  if (options.keepSearchFocus) {
    const searchEl = document.getElementById('uldw-list-search');
    if (searchEl) {
      searchEl.focus();
      const len = searchEl.value.length;
      try { searchEl.setSelectionRange(len, len); } catch (e) { /* ignore */ }
    }
  }
}

async function openSheet(id) {
  try {
    const detail = await fetchSheet(id);
    const s = state();
    s.current = uldSheetFromApi(detail);
    s.dirty = false;
    s.view = 'editor';
    resetVersionsState(); // V3：換表時不要沿用上一張的版本清單／比對結果
    resetUiState();       // U1：換表時不要沿用上一張的展開／「更多」選單狀態
    render();
  } catch (err) {
    alert(`開啟夾重表失敗：${err.message}`);
  }
}

async function backToList() {
  const s = state();
  if (s.dirty && !confirm('尚有未儲存的修改，確定要離開嗎？')) return;
  s.current = null;
  s.dirty = false;
  resetVersionsState();
  await loadList();
}

// MAWB# 驗證：回傳格式／檢查碼不合格的清單（存檔前提示用；既有／特殊資料仍可存）
function invalidMawbs(sheet) {
  const seen = new Set();
  const out = [];
  const push = (raw) => {
    const value = String(raw || '').trim();
    if (!value) return;
    const key = uldMawbKey(value);
    if (!key || seen.has(key)) return;
    const check = uldValidateMawb(value);
    if (check.ok) return;
    seen.add(key);
    out.push(`${value}：${check.message || '格式不正確'}`);
  };
  (sheet.mawbs || []).forEach(row => push(row.mawb));
  (sheet.ulds || []).forEach(unit => (unit.items || []).forEach(item => push(item.mawb)));
  return out;
}

async function saveCurrent() {
  const s = state();
  if (!s.current) return;
  const bad = invalidMawbs(s.current);
  if (bad.length) {
    const list = bad.slice(0, 12).map(text => `・${text}`).join('\n');
    const more = bad.length > 12 ? `\n…另有 ${bad.length - 12} 筆` : '';
    if (!confirm(`有 ${bad.length} 筆 MAWB# 格式／檢查碼不正確：\n\n${list}${more}\n\n仍要儲存嗎？（建議先用「✓ 檢查碼」修正）`)) return;
  }
  const computed = uldComputed();
  if (computed.totals.hasError) {
    const first = computed.issues.find(i => i.level === 'error');
    alert(`有錯誤未修正，無法儲存：\n${first ? (first.label ? first.label + '：' : '') + uldIssueText(first) : ''}`);
    return;
  }
  try {
    const detail = await saveSheet(s.current.id, uldSheetPayload(s.current));
    s.current = uldSheetFromApi(detail);
    s.dirty = false;
    render();
    toast('已儲存');
    await refreshVersionsIfOpen();
  } catch (err) {
    alert(`儲存失敗：${err.message}`);
  }
}

async function lockCurrent(locked) {
  const s = state();
  if (!s.current) return;
  if (locked && s.dirty && !confirm('尚未儲存，仍要鎖定嗎？')) return;
  try {
    const detail = await setSheetLocked(s.current.id, locked);
    s.current = uldSheetFromApi(detail);
    s.dirty = false;
    render();
    toast(locked ? '已鎖定' : '已解鎖');
    await refreshVersionsIfOpen();
  } catch (err) {
    alert(`${locked ? '鎖定' : '解鎖'}失敗：${err.message}`);
  }
}

// ===== W2：把夾重後的最終重量套用到 Booking Record（僅鎖定後）=====
const APPLY_REASON_TEXT = {
  no_booking: '未連結 Booking Record（手動輸入的 MAWB）',
  booking_not_found: '找不到 Booking Record（可能已刪除）',
  unchanged: '重量相同（先前已套用過）',
  duplicate_booking: '同一 MAWB 對到多個 Booking Record',
  mawb_mismatch: '同一個 Booking Record 有多個 MAWB 號碼'
};

function applyReasonText(reason) {
  return APPLY_REASON_TEXT[reason] || String(reason || '');
}

async function applyToBookings() {
  const s = state();
  if (!s.current) return;
  if (s.current.status !== 'locked') {
    alert('請先「鎖定」夾重表，才能套用到 Booking Record。');
    return;
  }
  const ok = confirm(
    '把每票夾重後的最終重量回寫到 Booking Record？\n'
    + '・只更新「已連結 Booking」的票（mawb_records.gross_weight，同一票跨板會加總）\n'
    + '・不會修改訂單（orders）的重量\n'
    + '・原重量會留在操作紀錄（audit_log）'
  );
  if (!ok) return;
  try {
    const res = await applySheet(s.current.id);
    const data = (res && res.data) || {};
    const applied = data.applied || [];
    const skipped = data.skipped || [];
    const conflicts = data.conflicts || [];
    if (res && res.sheet) {
      s.current = uldSheetFromApi(res.sheet);
      s.dirty = false;
    }
    render();

    const blocks = [];
    if (applied.length) {
      blocks.push(`已套用 ${applied.length} 票：\n${applied
        .map(a => `・${a.mawb}：${uldFmtKg(a.before)} → ${uldFmtKg(a.after)} kg`).join('\n')}`);
    }
    if (skipped.length) {
      blocks.push(`未更新 ${skipped.length} 票：\n${skipped
        .map(x => `・${x.mawb || '（無 MAWB）'}：${applyReasonText(x.reason)}`).join('\n')}`);
    }
    if (conflicts.length) {
      blocks.push(`資料衝突 ${conflicts.length} 票（未寫入，請先修正）：\n${conflicts
        .map(x => `・${x.mawb || '（無 MAWB）'}：${applyReasonText(x.reason)}`).join('\n')}`);
    }
    alert(blocks.length ? `套用到 Booking Record 完成\n\n${blocks.join('\n\n')}` : '沒有可套用的票。');
    toast(applied.length ? `已套用 ${applied.length} 票到 Booking Record` : '沒有變更');
    await refreshVersionsIfOpen();
  } catch (err) {
    alert(`套用失敗：${err.message}`);
  }
}

// ===== V1：把沒有連結 Booking 的票補到 Booking Record（安全版：先預覽 → 確認 → 才寫入）=====
const SYNC_SKIP_TEXT = {
  no_mawb: '沒有 MAWB#',
  duplicate_booking: 'Booking Record 已有同號 MAWB 多筆（請先人工整理）'
};

function syncSkipText(item) {
  const base = SYNC_SKIP_TEXT[item.reason] || String(item.reason || '');
  return item.count ? `${base} — ${item.count} 筆` : base;
}

async function syncBookings() {
  const s = state();
  if (!s.current) return;
  if (s.dirty && !confirm('尚有未儲存的修改，補建 Booking 會用「已儲存的內容」，仍要繼續嗎？')) return;
  try {
    toast('正在檢查 Booking Record…');
    const preview = await syncSheetBookings(s.current.id, { dryRun: true });
    const data = (preview && preview.data) || {};
    const created = data.created || [];
    const linked = data.linked || [];
    const skipped = data.skipped || [];
    if (!created.length && !linked.length) {
      const lines = ['所有票都已連結 Booking Record，不需要補建。'];
      if (skipped.length) {
        lines.push(`略過 ${skipped.length} 票：`);
        skipped.slice(0, 10).forEach(x => lines.push(`・${x.mawb || '（無 MAWB）'}：${syncSkipText(x)}`));
      }
      alert(lines.join('\n'));
      return;
    }

    const lines = [];
    if (created.length) {
      lines.push(`將建立 ${created.length} 筆 Booking Record：`);
      created.slice(0, 10).forEach(c => lines.push(
        `・${c.mawb}　${c.dest || '-'}　${uldFmtKg(c.pcs)} 件　${uldFmtKg(c.final)} kg`
      ));
      if (created.length > 10) lines.push(`…另有 ${created.length - 10} 筆`);
    }
    if (linked.length) {
      if (lines.length) lines.push('');
      lines.push(`將連結 ${linked.length} 筆「Booking Record 已有同號 MAWB」的票（不重複建立）：`);
      linked.slice(0, 10).forEach(x => lines.push(
        `・${x.mawb} → Booking #${x.mawb_record_id}（原重 ${uldFmtKg(x.before)} kg）`
      ));
      if (linked.length > 10) lines.push(`…另有 ${linked.length - 10} 筆`);
    }
    if (skipped.length) {
      lines.push('', `略過 ${skipped.length} 票：`);
      skipped.slice(0, 10).forEach(x => lines.push(`・${x.mawb || '（無 MAWB）'}：${syncSkipText(x)}`));
    }
    lines.push('', '・只會新增／連結 Booking Record（gross_weight 用夾重後重量），不會修改訂單或夾重表的重量。');

    if (!confirm(`${lines.join('\n')}\n\n確定要寫入 Booking Record 嗎？`)) return;

    const result = await syncSheetBookings(s.current.id, { dryRun: false });
    const done = (result && result.data) || {};
    if (result && result.sheet) {
      s.current = uldSheetFromApi(result.sheet);
      s.dirty = false;
    }
    render();
    const doneCreated = done.created || [];
    const doneLinked = done.linked || [];
    alert(`已完成：建立 ${doneCreated.length} 筆、連結 ${doneLinked.length} 筆 Booking Record。\n`
      + `之後鎖定可按「套用到 Booking」把夾重後重量回寫。`);
    toast(`補建 Booking：建立 ${doneCreated.length}／連結 ${doneLinked.length}`);
    await refreshVersionsIfOpen();
  } catch (err) {
    alert(`補建 Booking Record 失敗：${err.message}`);
  }
}

// ===== V3：版本紀錄（清單 ＋ 異動比對）=====
async function openVersions() {
  const s = state();
  if (!s.current) return;
  const previous = (s.versions && s.versions.list) || [];
  s.versions = { open: true, loading: true, list: previous, error: '' };
  s.versionDiff = null;
  render();
  await loadVersions();
}

async function loadVersions() {
  const s = state();
  if (!s.current) return;
  try {
    const list = await fetchSheetVersions(s.current.id);
    s.versions = { open: true, loading: false, list, error: '' };
  } catch (err) {
    s.versions = { open: true, loading: false, list: [], error: err.message };
  }
  render();
}

function closeVersions() {
  const s = state();
  s.versions = { open: false, loading: false, list: [], error: '' };
  s.versionDiff = null;
  render();
}

// 版本清單裡查 version_no（面板標題要顯示 v幾）
function versionNoOf(id) {
  const key = Number(id) || 0;
  if (!key) return 0;
  const found = ((state().versions && state().versions.list) || []).find(v => Number(v.id) === key);
  return found ? Number(found.version_no) : 0;
}

async function compareVersions(fromId, toId) {
  const s = state();
  if (!s.current) return;
  const from = Number(fromId) || 0;
  const to = Number(toId) || 0;
  if (!from) {
    alert('請選擇要比對的版本。');
    return;
  }
  s.versionDiff = {
    loading: true,
    from: { id: from, version_no: versionNoOf(from) },
    to: { id: to, version_no: versionNoOf(to) }
  };
  refreshVersions(rootEl);
  try {
    const res = await fetchVersionDiff(s.current.id, { fromId: from, toId: to });
    s.versionDiff = { loading: false, data: res.data, from: res.from, to: res.to, error: '' };
  } catch (err) {
    s.versionDiff = { loading: false, error: err.message, from: s.versionDiff.from, to: s.versionDiff.to };
  }
  refreshVersions(rootEl);
}

// 儲存／鎖定／套用／補建之後，若版本面板開著就順便更新列表
async function refreshVersionsIfOpen() {
  const s = state();
  if (!s.current || !s.versions || !s.versions.open) return;
  await loadVersions();
}

function resetVersionsState() {
  const s = state();
  s.versions = { open: false, loading: false, list: [], error: '' };
  s.versionDiff = null;
}

// U1／U2：切換夾重表時把「顯示狀態」歸零（不要沿用上一張的展開／選單狀態）
// 新版預設用「① MAWB LIST／② ULD LIST」建檔頁；要看載荷表再按「▦ 載荷表」。
function resetUiState() {
  const s = state();
  s.ui = {
    step: 'build',
    view: 'cards',
    gridSortMawb: false,
    more: false,
    advanced: false,
    expanded: {},
    expandAll: false,
    printUnit: null,
    mergePick: null
  };
}

// ===== W3：RCL 磅單匯入（Excel／CSV → 預覽 → 勾選後併入草稿）=====
async function startRclImport() {
  const s = state();
  if (!s.current) return;
  if (s.current.status === 'locked') {
    alert('夾重表已鎖定，請先解鎖再匯入 RCL 磅單。');
    return;
  }
  const file = await pickRclFile();
  if (!file) return;
  s.rclImport = { busy: true, fileName: file.name, file };
  render();
  try {
    const preview = await loadRclPreview(s.current.id, { file });
    s.rclImport = { ...preview, file };
    render();
    if (!preview.rows.length) {
      alert('沒有解析到可匯入的單位，請在面板調整「欄位對應」或換一個工作表。');
    }
  } catch (err) {
    s.rclImport = null;
    render();
    alert(`匯入 RCL 磅單失敗：${err.message}`);
  }
}

async function changeRclSheet(sheetName) {
  const s = state();
  const imp = s.rclImport;
  if (!imp || !imp.file || !s.current) return;
  imp.busy = true;
  refreshRclImport(rootEl);
  try {
    const preview = await loadRclPreview(s.current.id, { file: imp.file, sheet: sheetName });
    s.rclImport = { ...preview, file: imp.file };
  } catch (err) {
    imp.busy = false;
    alert(`切換工作表失敗：${err.message}`);
  }
  render();
}

// 改欄位對應 → 用共用純函式重算（不必重新上傳）
function changeRclColumn(key, value) {
  const s = state();
  const imp = s.rclImport;
  if (!imp || !key) return;
  const index = Number(value);
  imp.columns = { ...(imp.columns || {}), [key]: Number.isFinite(index) ? Math.trunc(index) : -1 };
  applyRclColumns(imp);
  refreshRclImport(rootEl);
}

function toggleRclRow(index) {
  const s = state();
  const imp = s.rclImport;
  if (!imp || !Number.isFinite(index)) return;
  const set = new Set(imp.selected || []);
  if (set.has(index)) set.delete(index); else set.add(index);
  imp.selected = [...set].sort((a, b) => a - b);
  refreshRclImport(rootEl);
}

function cancelRclImport() {
  state().rclImport = null;
  render();
}

function addRclUnits() {
  const s = state();
  const imp = s.rclImport;
  if (!imp || !s.current) return;
  const rows = selectedRclRows(imp);
  if (!rows.length) {
    alert('請先勾選要加入的收貨單位。');
    return;
  }
  s.current.ulds = s.current.ulds || [];
  const existing = new Set(
    s.current.ulds.map(unit => rclUldKey(unit.uld_number || unit.bulk_ref || '')).filter(Boolean)
  );
  const added = [];
  const duplicated = [];
  rows.forEach(row => {
    const key = rclUldKey(row.uld_number);
    if (!key || existing.has(key)) {
      duplicated.push(row.uld_number);
      return;
    }
    existing.add(key);
    const unit = uldNewUnit('ULD');
    unit.uld_number = row.uld_number;
    unit.tare_weight = uldNum(row.tare_weight);
    unit.rcl_gross_weight = uldNum(row.rcl_gross_weight);
    unit.pcs = uldNum(row.pcs);
    // Pre-decl Type 完全手動（既定規則）：先給 P，加入後由使用者自行改成 X
    unit.predecl_type = 'P';
    s.current.ulds.push(unit);
    added.push(row.uld_number);
  });
  s.rclImport = null;
  uldMarkDirty();
  render();
  const lines = [`已加入 ${added.length} 個收貨單位（Pre-decl 預設 P，請自行確認 P／X）`];
  if (duplicated.length) {
    lines.push(`略過 ${duplicated.length} 個（夾重表已有相同 ULD#）：`
      + `${duplicated.slice(0, 5).join('、')}${duplicated.length > 5 ? '…' : ''}`);
  }
  if (added.length) lines.push('請為每個 ULD 加入 MAWB 明細後才能儲存（未填明細會有「未勾選夾重」錯誤）。');
  alert(lines.join('\n\n'));
  toast(`已加入 ${added.length} 個單位`);
}

async function duplicateRow(id) {
  try {
    const detail = await duplicateSheet(id);
    await loadList();
    toast(`已複製為 ${detail.sheet_no}`);
  } catch (err) {
    alert(`複製失敗：${err.message}`);
  }
}

async function deleteRow(id) {
  if (!confirm('確定要刪除這張夾重表？（不可復原）')) return;
  try {
    await deleteSheet(id);
    await loadList();
    toast('已刪除');
  } catch (err) {
    alert(`刪除失敗：${err.message}`);
  }
}


// ===== 事件（在 root 上委派）=====
let listReloadTimer = null;
function scheduleListReload() {
  clearTimeout(listReloadTimer);
  listReloadTimer = setTimeout(() => loadList({ keepSearchFocus: true }), 300);
}

function unitOfElement(el) {
  const card = el.closest('.uldw-unit, [data-merge-unit]');
  return card ? uldFindUnit(card.dataset.uid) : null;
}

function itemOfElement(el, unit) {
  const row = el.closest('tr[data-item-uid], [data-merge-item]');
  if (!row || !unit) return null;
  return (unit.items || []).find(it => it.uid === row.dataset.itemUid) || null;
}

const NUMERIC_UNIT_FIELDS = ['pcs', 'tare_weight', 'rcl_gross_weight', 'material_weight'];
const NUMERIC_ITEM_FIELDS = ['pcs', 'declared_weight', 'squeeze_ratio'];
// W5：表頭數字欄（磅差警示門檻）→ 存成數字，且輸入時就重算檢核（不重畫，焦點不會掉）
// R2：比例上下限（0 = 不限）同樣是數字欄
const NUMERIC_HEADER_FIELDS = ['diff_warn_pct', 'diff_warn_kg', 'clamp_min_pct', 'clamp_max_pct'];
// 自動轉大寫的欄位：ULD#／Contour／RCL#／Port／MAWB（業界代號一律大寫）
const UPPER_UNIT_FIELDS = ['uld_number', 'contour_code', 'rcl_no', 'port'];
const UPPER_ITEM_FIELDS = ['mawb', 'port'];
const UPPER_DRAFT_FIELDS = ['mawb', 'port'];

function upperIfNeeded(field, list, value) {
  return list.includes(field) ? String(value == null ? '' : value).toUpperCase() : value;
}

// MAWB 欄位失焦／貼上後的即時驗證標記（不合格 → 紅框＋title；不擋既有資料）
function paintMawbValidation(input, value) {
  const check = uldValidateMawb(value);
  const bad = !check.ok && !check.empty;
  if (!input) return check;
  if (bad) {
    input.dataset.mawbInvalid = '1';
    if (input.classList) input.classList.add('is-invalid');
    input.title = uldMawbIssueText(check);
  } else {
    delete input.dataset.mawbInvalid;
    if (input.classList) input.classList.remove('is-invalid');
    input.title = '';
  }
  return check;
}

// 重量輸入框的顯示值：0 → 空白；允許 0.5kg 時可 0.5，否則整數
function kgInput(value) {
  const n = weightInputNumber(value);
  return n === 0 ? '' : String(n);
}

// 目前表是否允許 0.5kg（0 = 只整數）
function allowHalfKg() {
  return Number(state().current && state().current.allow_half_kg) === 1;
}

// 依目前設定把重量收斂到 0.5 或整數
function weightInputNumber(value) {
  const n = Math.max(0, uldNum(value));
  return allowHalfKg() ? Math.round(n * 2) / 2 : Math.round(n);
}

// 切換「允許使用 0.5kg」時，把所有重量欄位一起收斂（避免畫面顯示 0.5 但實際算整數）
function normalizeSheetWeights(sheet) {
  if (!sheet) return;
  const fix = weightInputNumber;
  (sheet.mawbs || []).forEach(row => { row.declared_weight = fix(row.declared_weight); });
  (sheet.ulds || []).forEach(unit => {
    unit.tare_weight = fix(unit.tare_weight);
    unit.rcl_gross_weight = fix(unit.rcl_gross_weight);
    unit.material_weight = fix(unit.material_weight);
    (unit.items || []).forEach(item => { item.declared_weight = fix(item.declared_weight); });
  });
}

const WEIGHT_FIELDS = ['declared_weight', 'tare_weight', 'rcl_gross_weight', 'material_weight'];

// ===== 載荷表：直接打某一板的重量（keyboard 手改重量）=====
//   - 打字／失焦都會走這裡（normalize = true 時順便把輸入框格式化成 1 位小數）
//   - 第一次改 → 這一列從「自動」變「手動」（自動勾選取消，畫面上同步取消，不重畫）
//   - 打超過申報 WT → 夾到申報 WT 並提示（避免把其他板清成 0）
function applyCellWeight(target, row, normalize) {
  const s = state();
  if (!s.current || s.current.status === 'locked' || !row) return null;
  const wasAuto = Number(row.auto_alloc) !== 0;
  const result = uldSetCellWeight(row.uid, target.dataset.cellUnit, target.value);
  if (!result.ok) {
    if (result.reason === 'no-mawb') toast('這一列還沒有 MAWB#：先填 MAWB 再填重量');
    return null;
  }
  if (result.clamped) {
    target.value = kgInput(result.fixed);
    toast(`單板重量不可超過申報 WT ${uldFmtKg(result.declared)}（已夾到上限）`);
  } else if (normalize) {
    target.value = kgInput(result.fixed);
  }
  // 「自動」勾選取消 → 只改勾選框（重畫會讓焦點跑掉）
  const tr = target.closest ? target.closest('tr[data-row-uid]') : null;
  const autoBox = tr ? tr.querySelector('[data-row-field="auto_alloc"]') : null;
  if (autoBox && autoBox.checked) autoBox.checked = false;
  if (wasAuto && result.cells > 1) {
    toast('已改為手動分配：這一板固定，其餘依件數分剩下的重量');
  }
  refreshComputed(rootEl);
  return result;
}

// ===== ULD LIST 卡片：明細 WT 直接打字（2026-11-11）=====
//   與載荷表同一套規則（`state.uldSetCellWeight()`）：
//   ① 打字的那一板固定 ② 剩下的申報 WT 依件數分給同票其他板（Σ 仍等於申報 WT）
//   ③ 該列轉為手動分配（`auto_alloc = 0`）④ 打超過申報 WT 夾到上限並提示
//   normalize = true（change／失焦）時順便把輸入框格式化成 kg 顯示值。
//   沒有申報列（舊資料）→ 只改這一板的重量。
function applyItemWeight(target, normalize) {
  const s = state();
  if (!s.current || s.current.status === 'locked') return null;
  const unit = unitOfElement(target);
  if (!unit) return null;
  const row = target.dataset.weightRow ? uldFindMawb(target.dataset.weightRow) : null;
  if (!row) {
    const item = itemOfElement(target, unit);
    if (!item) return null;
    // 舊資料（沒有申報列）→ 只改這一板的重量；輸入中不覆寫輸入框（避免打「12.5」被中途改成 12）
    item.declared_weight = Math.max(0, uldNum(target.value));
    if (normalize) target.value = kgInput(weightInputNumber(item.declared_weight));
    uldMarkDirty();
    refreshComputed(rootEl);
    return { ok: true, fixed: item.declared_weight, cells: 1 };
  }
  const wasAuto = Number(row.auto_alloc) !== 0;
  const result = uldSetCellWeight(row.uid, unit.uid, target.value);
  if (!result.ok) {
    if (result.reason === 'no-mawb') toast('這一列還沒有 MAWB#：先填 MAWB 再填重量');
    return null;
  }
  if (result.clamped) {
    target.value = kgInput(result.fixed);
    toast(`單板重量不可超過申報 WT ${uldFmtKg(result.declared)}（已夾到上限）`);
  } else if (normalize) {
    target.value = kgInput(result.fixed);
  }
  if (wasAuto && result.cells > 1) {
    toast('已改為手動分配：這一板固定，其餘依件數分剩下的重量');
  }
  refreshComputed(rootEl);
  return result;
}

// 文字／數字輸入：只更新狀態 + 局部重算（不重畫 → 不會失去焦點）
function onRootInput(event) {
  const target = event.target;
  if (!target || !target.dataset) return;
  if (target.tagName === 'SELECT' || target.type === 'checkbox') return;
  // 清單頁搜尋框（不需要 current sheet）：先即時（本機）篩選，再由 300ms debounce 打 API
  if (target.id === 'uldw-list-search') {
    state().listFilter.search = target.value;
    const caret = typeof target.selectionStart === 'number' ? target.selectionStart : target.value.length;
    if (rootEl) renderList(rootEl);
    const searchEl = rootEl && rootEl.querySelector('#uldw-list-search');
    if (searchEl && searchEl.focus) {
      searchEl.focus();
      try { searchEl.setSelectionRange(caret, caret); } catch (err) { /* ignore */ }
    }
    scheduleListReload();
    return;
  }
  const s = state();
  if (!s.current || s.current.status === 'locked') return;

  if (target.dataset.header) {
    const field = target.dataset.header;
    s.current[field] = NUMERIC_HEADER_FIELDS.includes(field) ? uldNum(target.value) : target.value;
    uldMarkDirty();
    if (NUMERIC_HEADER_FIELDS.includes(field)) refreshComputed(rootEl);
    return;
  }

  // ===== 方案 B：載荷表（申報列／各板件數）=====
  const rowTr = target.closest ? target.closest('tr[data-row-uid]') : null;
  const gridRow = rowTr ? uldFindMawb(rowTr.dataset.rowUid) : null;
  if (gridRow && target.dataset.rowField) {
    const field = target.dataset.rowField;
    if (field === 'mawb' || field === 'dest') {
      const prevMawb = target.dataset.prevMawb != null ? target.dataset.prevMawb : gridRow.mawb;
      gridRow[field] = upperIfNeeded(field, ['mawb', 'dest'], target.value);
      // 改 MAWB／DEST 要同步各板明細（否則重量會算在舊號碼上）
      uldSyncRowToItems(gridRow, uldMawbKey(prevMawb));
      target.dataset.prevMawb = gridRow.mawb;
    } else if (field === 'pcs' || field === 'declared_weight') {
      gridRow[field] = Math.max(0, uldNum(target.value));
    } else if (field === 'wh_ref') {
      gridRow.wh_ref = target.value;
    }
    uldMarkDirty();
    refreshComputed(rootEl);
    return;
  }
  if (gridRow && target.dataset.cellField === 'pcs') {
    const item = uldEnsureItem(target.dataset.cellUnit, gridRow);
    if (!item) return; // 這一票還沒填 MAWB#
    item.pcs = Math.max(0, Math.round(uldNum(target.value)));
    uldMarkDirty();
    refreshComputed(rootEl);
    return;
  }
  // 各板 WT 直接打字（keyboard 手改重量）：固定這一板、其餘依件數分剩下的申報重量
  if (gridRow && target.dataset.cellField === 'wt') {
    applyCellWeight(target, gridRow, false);
    return;
  }

  const unit = unitOfElement(target);
  if (!unit) return;

  // ULD LIST 卡片明細 WT 直接打字（固定這一板、其餘依件數重分）
  if (target.dataset.itemWeight) {
    applyItemWeight(target, false);
    return;
  }

  if (target.dataset.unitField) {
    const field = target.dataset.unitField;
    unit[field] = NUMERIC_UNIT_FIELDS.includes(field)
      ? uldNum(target.value)
      : upperIfNeeded(field, UPPER_UNIT_FIELDS, target.value);
    uldMarkDirty();
    refreshComputed(rootEl);
    return;
  }
  if (target.dataset.itemField) {
    const item = itemOfElement(target, unit);
    if (!item) return;
    const field = target.dataset.itemField;
    item[field] = NUMERIC_ITEM_FIELDS.includes(field)
      ? uldNum(target.value)
      : upperIfNeeded(field, UPPER_ITEM_FIELDS, target.value);
    uldMarkDirty();
    refreshComputed(rootEl);
    return;
  }
  if (target.dataset.draft) {
    unit.draft = unit.draft || {};
    const field = target.dataset.draft;
    unit.draft[field] = upperIfNeeded(field, UPPER_DRAFT_FIELDS, target.value);
  }
}

// 下拉選單／勾選框：需要重畫（例如切到「手動 %」要長出比例輸入框）
function onRootChange(event) {
  const target = event.target;
  if (!target || !target.dataset) return;
  // V2：清單頁批次勾選（checkbox 走 change；只更新勾選狀態，不重畫清單）
  if (target.id === 'uldw-batch-all') { toggleBatchAll(target.checked); return; }
  if (target.dataset.batchId != null) { toggleBatchId(Number(target.dataset.batchId)); return; }
  const s = state();
  if (!s.current || s.current.status === 'locked') return;

  // RCL 磅單匯入面板（W3）：切換工作表／欄位對應／勾選列
  if (target.dataset.rcl === 'sheet') { changeRclSheet(target.value); return; }
  if (target.dataset.rcl === 'col') { changeRclColumn(target.dataset.rclKey, target.value); return; }
  if (target.dataset.rclRow != null) { toggleRclRow(Number(target.dataset.rclRow)); return; }

  // TAB 陷阱：文字／數字／下拉在失焦時都會觸發 change；若在這裡 render()（整份重畫），
  // 被聚焦的欄位會被銷毀 → 焦點丟回 body，TAB 就從文件開頭跑，而不是從剛輸入的格子。
  // 原則：change 只寫回 state 並做局部重算；唯一例外是「夾重方式→手動 %」需要長出比例輸入框。
  if (target.dataset.header) {
    const field = target.dataset.header;
    if (target.type === 'checkbox') {
      s.current[field] = target.checked ? 1 : 0;
      // 「允許使用 0.5kg」：切換時把所有重量一起收斂（未勾選＝整數）
      if (field === 'allow_half_kg') {
        if (target.checked && !(uldNum(s.current.round_b) > 0 && uldNum(s.current.round_b) < 1)) {
          s.current.round_b = 0.5; // 允許 0.5 時，B 散貨預設也用 0.5（可到進階改回 1.0）
        }
        normalizeSheetWeights(s.current);
        uldMarkDirty();
        render();
        return;
      }
    } else {
      s.current[field] = NUMERIC_HEADER_FIELDS.includes(field) ? uldNum(target.value) : target.value;
    }
    uldMarkDirty();
    refreshComputed(rootEl);
    return;
  }

  // ===== 方案 B：載荷表的勾選框（自動分配／夾重）與 MAWB 失焦格式化 =====
  const chgRowTr = target.closest ? target.closest('tr[data-row-uid]') : null;
  const chgRow = chgRowTr ? uldFindMawb(chgRowTr.dataset.rowUid) : null;
  if (chgRow && target.dataset.rowField) {
    const field = target.dataset.rowField;
    if (field === 'auto_alloc') {
      chgRow.auto_alloc = target.checked ? 1 : 0;
      // 勾回「自動」＝各板重量依件數重分（手動填的會被蓋掉，先講清楚）
      if (target.checked) toast('已改回自動分配：依件數重新分申報重量');
    } else if (field === 'is_squeeze') {
      uldSetRowSqueeze(chgRow, target.checked);
    } else if (field === 'mawb' && target.type !== 'checkbox') {
      // MAWB 失焦時格式化（輸入中不格式化，避免游標跳動）
      const formatted = uldFormatMawb(target.value);
      if (formatted && formatted !== target.value) {
        const prevMawb = chgRow.mawb;
        chgRow.mawb = formatted;
        target.value = formatted;
        uldSyncRowToItems(chgRow, uldMawbKey(prevMawb));
      }
      target.dataset.prevMawb = chgRow.mawb;
      paintMawbValidation(target, chgRow.mawb);
    } else if (field === 'dest') {
      target.value = String(chgRow.dest || '').toUpperCase();
    } else if (WEIGHT_FIELDS.includes(field) && target.type !== 'checkbox') {
      target.value = kgInput(chgRow[field]);
    }
    uldMarkDirty();
    refreshComputed(rootEl);
    return;
  }
  if (chgRow && target.dataset.cellField === 'pcs') {
    const item = uldEnsureItem(target.dataset.cellUnit, chgRow);
    if (item) item.pcs = Math.max(0, Math.round(uldNum(target.value)));
    uldMarkDirty();
    refreshComputed(rootEl);
    return;
  }
  // 各板 WT：失焦時把輸入框格式化成 1 位小數（值本身在 input 事件就寫回 state）
  if (chgRow && target.dataset.cellField === 'wt') {
    applyCellWeight(target, chgRow, true);
    return;
  }

  const unit = unitOfElement(target);
  if (!unit) return;

  // ULD LIST 卡片明細 WT 失焦 → 值本身在 input 事件就寫回 state，這裡只做格式化
  if (target.dataset.itemWeight) {
    applyItemWeight(target, true);
    return;
  }

  if (target.dataset.unitField) {
    const field = target.dataset.unitField;
    unit[field] = NUMERIC_UNIT_FIELDS.includes(field)
      ? uldNum(target.value)
      : upperIfNeeded(field, UPPER_UNIT_FIELDS, target.value);
    if (WEIGHT_FIELDS.includes(field)) {
      unit[field] = weightInputNumber(unit[field]);
      target.value = kgInput(unit[field]);
    }
    uldMarkDirty();
    if (field === 'squeeze_mode') render(); // 手動 % 會多出比例輸入欄
    else refreshComputed(rootEl);
    return;
  }
  if (target.dataset.itemField) {
    const item = itemOfElement(target, unit);
    if (!item) return;
    const field = target.dataset.itemField;
    // MAWB 失焦時自動格式化成 000-0000 0000（輸入中不格式化，避免游標跳動）
    if (field === 'mawb' && target.type !== 'checkbox') {
      const formatted = uldFormatMawb(target.value);
      if (formatted && formatted !== target.value) target.value = formatted;
      paintMawbValidation(target, formatted || target.value);
    }
    const raw = target.type === 'checkbox' ? target.checked : target.value;
    item[field] = target.type === 'checkbox' ? raw : upperIfNeeded(field, UPPER_ITEM_FIELDS, raw);
    if (WEIGHT_FIELDS.includes(field) && target.type !== 'checkbox') {
      item[field] = weightInputNumber(item[field]);
      target.value = kgInput(item[field]);
    }
    uldMarkDirty();
    refreshComputed(rootEl);
    return;
  }
  // 草稿（新增 MAWB 列）：MAWB 失焦時格式化
  if (target.dataset.draft) {
    unit.draft = unit.draft || {};
    const field = target.dataset.draft;
    let value = target.value;
    if (field === 'mawb') {
      const formatted = uldFormatMawb(value);
      if (formatted && formatted !== value) target.value = formatted;
      value = formatted;
    }
    if (field === 'declared_weight') {
      value = kgInput(weightInputNumber(value));
      target.value = value;
    }
    unit.draft[field] = upperIfNeeded(field, UPPER_DRAFT_FIELDS, value);
  }
}

function onRootClick(event) {
  const btn = event.target.closest('[data-action]');
  if (!btn || btn.disabled) return;
  const action = btn.dataset.action;
  switch (action) {
    case 'open': openSheet(Number(btn.dataset.id)); break;
    case 'duplicate': duplicateRow(Number(btn.dataset.id)); break;
    case 'delete': deleteRow(Number(btn.dataset.id)); break;
    case 'list-status': setListStatus(btn.dataset.status || ''); break;
    case 'back': backToList(); break;
    case 'save': saveCurrent(); break;
    case 'lock': lockCurrent(true); break;
    case 'unlock': lockCurrent(false); break;
    // 新 UI：③ 合併／分配頁（獨立頁面）＋ ① MAWB LIST
    case 'open-merge': openMerge(); break;
    case 'close-merge': closeMerge(); break;
    case 'pick-mawb': pickMawb(btn.dataset.rowUid); break;
    case 'clear-pick': clearMawbPick(); break;
    case 'assign-picked': assignPickedMawb(btn.dataset.uid); break;
    case 'toggle-lih': toggleUnitLih(btn.dataset.uid, btn.dataset.lih); break;
    case 'merge-remove-item': removeItem(btn.dataset.uid, btn.dataset.itemUid); break;
    case 'merge-unit-left': moveMergeUnit(btn.dataset.uid, -1); break;
    case 'merge-unit-right': moveMergeUnit(btn.dataset.uid, 1); break;
    case 'focus-mawb-add': focusMawbAdd(); break;
    case 'mawb-add': addMawbFromPanel(); break;
    case 'paste-mawbs': pasteMawbRows(); break;
    case 'apply': applyToBookings(); break;
    case 'sync-bookings': syncBookings(); break;
    case 'versions': openVersions(); break;
    case 'versions-close': closeVersions(); break;
    case 'version-diff': compareVersions(btn.dataset.from, btn.dataset.to); break;
    case 'print': printCurrent(); break;
    case 'pdf': downloadPdf(); break;
    case 'pdf-unit': downloadUnitPdf(btn.dataset.uid); break;
    case 'print-unit': printUnit(btn.dataset.uid); break;
    case 'toggle-more': toggleMore(); break;
    case 'toggle-adv': toggleAdvanced(); break;
    case 'toggle-unit': toggleUnitCard(btn.dataset.uid); break;
    case 'toggle-compact': toggleCompact(); break;
    case 'paste-items': pasteItems(btn.dataset.uid); break;
    case 'batch-pdf': downloadBatchPdf(); break;
    case 'import-rcl': startRclImport(); break;
    case 'rcl-add': addRclUnits(); break;
    case 'rcl-cancel': cancelRclImport(); break;
    case 'add-uld': addUnit('ULD'); break;
    case 'add-bulk': addUnit('BULK'); break;
    case 'del-unit': removeUnit(btn.dataset.uid); break;
    case 'add-item': addItem(btn.dataset.uid); break;
    case 'del-item': removeItem(btn.dataset.uid, btn.dataset.itemUid); break;
    case 'split-item': splitItem(btn.dataset.uid, btn.dataset.itemUid); break;
    // 新版載荷表（CHARTER LOADING SHEET）
    case 'view-grid': setEditorView('grid'); break;
    case 'view-cards': setEditorView('cards'); break;
    case 'grid-sort': toggleGridSort(); break;
    case 'grid-check-mawb': checkAndFormatMawbs(); break;
    case 'grid-clear': clearSheetContent(); break;
    case 'grid-add-row': {
      const newInput = rootEl && rootEl.querySelector('#uldw-grid-new-mawb');
      addMawbRow(newInput ? newInput.value : '');
      break;
    }
    case 'grid-del-row': deleteMawbRow(btn.dataset.rowUid); break;
    default: break;
  }
  syncHeaderButtons();
}

// ===== U1：顯示狀態切換（盡量只動 class，不整份重畫 → 不打斷輸入）=====
function uiState() {
  const s = state();
  if (!s.ui) s.ui = {
    step: 'build', view: 'cards', gridSortMawb: false, more: false, advanced: false,
    expanded: {}, expandAll: false, printUnit: null, mergePick: null
  };
  if (s.ui.expandAll === undefined) s.ui.expandAll = false;
  if (s.ui.step !== 'merge') s.ui.step = 'build';
  if (s.ui.mergePick === undefined) s.ui.mergePick = null;
  return s.ui;
}

function toggleMore() {
  const ui = uiState();
  ui.more = !ui.more;
  const box = rootEl && rootEl.querySelector('.uldw-more');
  if (box && box.classList) box.classList.toggle('is-open', ui.more);
}

function toggleAdvanced() {
  const ui = uiState();
  ui.advanced = !ui.advanced;
  const box = rootEl && rootEl.querySelector('.uldw-adv');
  if (box && box.classList) box.classList.toggle('is-open', ui.advanced);
  const btn = rootEl && rootEl.querySelector('[data-action="toggle-adv"]');
  if (btn) btn.textContent = `${ui.advanced ? '▾' : '⚙'} 進階`;
}

function toggleUnitCard(uid) {
  const ui = uiState();
  if (!uid) return;
  const card = rootEl && rootEl.querySelector(`.uldw-unit[data-uid="${uid}"]`);
  if (!card) return;
  const isCompact = card.dataset.compact === '1';
  const nextCompact = !isCompact;
  card.dataset.compact = nextCompact ? '1' : '0';
  ui.expanded = ui.expanded || {};
  ui.expanded[uid] = !nextCompact; // 明確記住這一張，不受「全部展開」影響
  const btn = card.querySelector('[data-action="toggle-unit"]');
  if (btn) btn.textContent = nextCompact ? '▸' : '▾';
}

function toggleCompact() {
  const ui = uiState();
  ui.expandAll = !ui.expandAll;
  ui.expanded = {};
  render();
}

// ===== 新版：載荷表（CHARTER LOADING SHEET）=====
// 版面切換：grid（矩陣檢視，預設）↔ cards（收貨單位卡片，輸入用）
function setEditorView(view) {
  const ui = uiState();
  ui.view = view === 'cards' ? 'cards' : 'grid';
  render();
}

// Sort by MAWB#：只改顯示順序，不寫回資料（存檔後仍是原本的加入順序）
function toggleGridSort() {
  const ui = uiState();
  ui.gridSortMawb = !ui.gridSortMawb;
  render();
  toast(ui.gridSortMawb ? '載荷表已依 MAWB# 排序（只影響顯示）' : '載荷表已恢復加入順序');
}

// Check & format MAWB#：合格的格式化成 000-0000 0000；不合格只列出、不改值
function checkAndFormatMawbs() {
  const s = state();
  if (!s.current) return;
  if (s.current.status === 'locked') { alert('已鎖定的夾重表不能修改。'); return; }
  const bad = [];
  let formatted = 0;
  const formatOne = (raw, label) => {
    const check = uldValidateMawb(raw);
    if (!check.ok) {
      bad.push(`${label}｜${raw}：${uldMawbIssueText(check)}`);
      return null;
    }
    const next = check.formatted || uldFormatMawb(raw);
    return next && next !== raw ? next : null;
  };

  // 申報列優先（改列 → 各板明細一起改）
  (s.current.mawbs || []).forEach((row, idx) => {
    const raw = String(row.mawb || '').trim();
    if (!raw) return;
    const next = formatOne(raw, `SEQ ${String(idx + 1).padStart(3, '0')}`);
    if (!next) return;
    const prevMawb = row.mawb;
    row.mawb = next;
    uldSyncRowToItems(row, uldMawbKey(prevMawb));
    formatted += 1;
  });
  // 沒有對應申報列的明細（舊資料／手動加的）也一併處理
  const rowKeys = new Set((s.current.mawbs || []).map(row => uldMawbKey(row.mawb)));
  (s.current.ulds || []).forEach(unit => {
    (unit.items || []).forEach(item => {
      const raw = String(item.mawb || '').trim();
      if (!raw || rowKeys.has(uldMawbKey(raw))) return;
      const next = formatOne(raw, uldUnitLabel(unit));
      if (!next) return;
      item.mawb = next;
      formatted += 1;
    });
  });

  if (formatted) {
    uldMarkDirty();
    render();
  }
  if (bad.length) {
    const list = bad.slice(0, 20).join('\n');
    const more = bad.length > 20 ? `\n…另有 ${bad.length - 20} 筆` : '';
    alert(`以下 MAWB# 格式不正確（未修改）：\n\n${list}${more}`);
    return;
  }
  toast(formatted ? `已格式化 ${formatted} 筆 MAWB#` : '所有 MAWB# 格式都正確');
}

// Clear Content：清空所有板的明細與申報列（表頭與板資料保留；不會自動存檔）
function clearSheetContent() {
  const s = state();
  if (!s.current) return;
  if (s.current.status === 'locked') { alert('已鎖定的夾重表不能修改。'); return; }
  const units = s.current.ulds || [];
  const itemCount = units.reduce((n, unit) => n + (unit.items || []).length, 0);
  const rowCount = (s.current.mawbs || []).length;
  if (!itemCount && !rowCount) {
    toast('目前沒有明細可清空');
    return;
  }
  if (!confirm(`確定清空全部明細（${rowCount} 票 MAWB／${itemCount} 筆分板）？\n表頭與板資料（ULD#／Tare／RCL（淨）…）會保留；這個動作不會立即存檔。`)) return;
  s.current.mawbs = [];
  units.forEach(unit => { unit.items = []; });
  uldMarkDirty();
  render();
  toast('已清空明細（尚未儲存）');
}

// ===== 新 UI：LOT 列表狀態篩選 =====
function setListStatus(status) {
  const s = state();
  s.listFilter = s.listFilter || { search: '', status: '' };
  s.listFilter.status = status === 'draft' || status === 'locked' ? status : '';
  loadList();
}

// ===== 新 UI：③ 合併／分配頁 =====
function openMerge() {
  const s = state();
  if (!s.current) return;
  s.ui = s.ui || {};
  s.ui.step = 'merge';
  s.ui.mergePick = null;
  render();
  if (!(s.current.ulds || []).length) {
    toast('目前沒有 ULD：先按「＋ ULD」再加入 MAWB');
  } else if (!(s.current.mawbs || []).length) {
    toast('MAWB LIST 還是空的：先回 ① 新增 MAWB');
  }
}

function closeMerge() {
  const s = state();
  s.ui = s.ui || {};
  s.ui.step = 'build';
  s.ui.mergePick = null;
  render();
}

// 點一張 MAWB 票（再點一次取消）：之後可按 ULD 的「＋ 加入」或直接拖曳
function pickMawb(rowUid) {
  if (!rowUid) return;
  const s = state();
  s.ui = s.ui || {};
  s.ui.mergePick = s.ui.mergePick === rowUid ? null : rowUid;
  render();
}

function clearMawbPick() {
  const s = state();
  s.ui = s.ui || {};
  s.ui.mergePick = null;
  render();
}

// 把目前點選的 MAWB 加到指定 ULD（件數預設＝還沒分配的件數）
function assignPickedMawb(unitUid) {
  const s = state();
  const rowUid = s.ui && s.ui.mergePick;
  if (!rowUid) { toast('先在左邊點一票 MAWB'); return; }
  const row = uldFindMawb(rowUid);
  const result = uldAssignMawbToUnit(rowUid, unitUid);
  if (!result.ok) {
    if (result.reason === 'exists') alert(`這一板已經有「${row ? row.mawb : ''}」，請直接改它的件數。`);
    else if (result.reason === 'no-mawb') alert('這一票還沒有 MAWB#，請先回 ① 補上。');
    else alert('無法加入，請重新整理後再試。');
    return;
  }
  uldMarkDirty();
  s.ui.mergePick = null;
  render();
  const unitLabel = result.unit.uld_number || result.unit.bulk_ref || 'ULD';
  toast(`已把 ${row.mawb} 加到 ${unitLabel}（${result.pcs} 件）${result.remaining > 0 ? `，還有 ${result.remaining} 件未分配` : ''}`);
}

// ULD 的 LIH 狀態（NIL／3481／3091；3481 與 3091 可同時亮）
function toggleUnitLih(uid, code) {
  const s = state();
  const unit = uldFindUnit(uid);
  if (!unit || !s.current || s.current.status === 'locked') return;
  uldToggleUnitLih(unit, code);
  uldMarkDirty();
  render();
}

// 合併頁：ULD 卡片左右移位（觸控／鍵盤也能用；拖曳照樣可用）
function moveMergeUnit(uid, delta) {
  const s = state();
  if (!s.current || s.current.status === 'locked') return;
  const list = s.current.ulds || [];
  const index = list.findIndex(unit => unit.uid === uid);
  const target = list[index + delta];
  if (!target) return;
  if (uldMoveUnit(uid, target.uid, delta > 0)) {
    uldMarkDirty();
    render();
  }
}

// ===== ③ 合併／分配：十字高亮 =====
// hover 一票（MAWB 池的 chip 或卡片裡的票）→ 亮起「整個 MAWB 行」；
// hover 一張 ULD（卡片任何位置）→ 亮起「整個 ULD 欄」；兩者交集會更明顯（CSS）。
function applyMergeHighlight(key, unit) {
  const nextKey = key || '';
  const nextUnit = unit || '';
  if (nextKey === mergeHlKey && nextUnit === mergeHlUnit) return;
  mergeHlKey = nextKey;
  mergeHlUnit = nextUnit;
  if (!rootEl || !rootEl.querySelectorAll) return;
  rootEl.querySelectorAll('[data-mawb-key]').forEach(el => {
    const hit = !!nextKey && el.dataset && el.dataset.mawbKey === nextKey;
    if (el.classList) el.classList.toggle('is-xh-row', hit);
  });
  rootEl.querySelectorAll('[data-merge-unit]').forEach(el => {
    const hit = !!nextUnit && el.dataset && el.dataset.uid === nextUnit;
    if (el.classList) el.classList.toggle('is-xh-col', hit);
  });
}

function clearMergeHighlight() {
  applyMergeHighlight('', '');
}

function onRootMouseOver(event) {
  const target = event.target;
  if (!target || !target.closest) return;
  const item = target.closest('[data-merge-item]');
  const unit = target.closest('[data-merge-unit]');
  const chip = target.closest('[data-mawb-chip]');
  // 卡片裡的票 → 行（同一票）＋ 欄（這一板）
  if (item) {
    applyMergeHighlight(item.dataset.mawbKey, (unit && unit.dataset.uid) || item.dataset.unitUid);
    return;
  }
  // 左邊的票 → 只亮同一票的所有列（含各卡裡的）
  if (chip) {
    applyMergeHighlight(chip.dataset.mawbKey, '');
    return;
  }
  // 卡片其他位置（表頭／欄位／空白）→ 只亮這一欄
  if (unit) {
    applyMergeHighlight('', unit.dataset.uid);
    return;
  }
  clearMergeHighlight();
}

function focusMawbAdd() {
  const input = rootEl && rootEl.querySelector('#uldw-mawb-new');
  if (input && input.focus) input.focus();
}

function addMawbFromPanel() {
  const input = rootEl && rootEl.querySelector('#uldw-mawb-new');
  if (!input) return;
  const value = input.value;
  input.value = '';
  addMawbRow(value);
  focusMawbAdd();
}

// ① MAWB LIST：貼上多列（只建立主檔，不分配到板；到 ③ 再拖）
async function pasteMawbRows() {
  const s = state();
  if (!s.current || s.current.status === 'locked') return;
  let text = '';
  try {
    if (navigator.clipboard && navigator.clipboard.readText) text = await navigator.clipboard.readText();
  } catch (err) {
    text = '';
  }
  if (!text) {
    if (typeof window.prompt !== 'function') return;
    text = window.prompt('貼上 MAWB 清單（MAWB／DEST／PCS／WT，Tab 分隔）', '') || '';
  }
  if (!text.trim()) return;
  const parsed = uldParsePastedRows(text);
  const rows = parsed.rows || [];
  if (!rows.length) {
    alert('貼上的內容看不出 MAWB#。\n請從 Excel 複製「MAWB／DEST／PCS／WT」四欄（Tab 分隔），或至少 MAWB 一欄。');
    return;
  }
  s.current.mawbs = s.current.mawbs || [];
  const existing = new Set(s.current.mawbs.map(row => uldMawbKey(row.mawb)).filter(Boolean));
  const invalid = [];
  let added = 0;
  let duplicated = 0;
  rows.forEach(raw => {
    const check = uldValidateMawb(raw.mawb);
    if (!check.ok) {
      invalid.push(`${raw.mawb}　（${check.message || '格式不正確'}）`);
      return;
    }
    const mawb = check.formatted;
    const key = uldMawbKey(mawb);
    if (!key) return;
    if (existing.has(key)) { duplicated += 1; return; }
    existing.add(key);
    s.current.mawbs.push(uldNewMawb({
      mawb,
      dest: String(raw.port || '').toUpperCase(),
      pcs: Math.max(0, Math.round(uldNum(raw.pcs))),
      declared_weight: weightInputNumber(raw.weight)
    }));
    added += 1;
  });
  if (!added) {
    alert(`沒有可加入的票（重複 ${duplicated} 列、格式不符 ${invalid.length} 列）。`
      + (invalid.length ? `\n\n格式不符：\n${invalid.slice(0, 8).join('\n')}${invalid.length > 8 ? '\n…' : ''}` : ''));
    return;
  }
  uldMarkDirty();
  render();
  const lines = [`已加入 ${added} 票到 MAWB LIST${duplicated ? `（略過重複 ${duplicated} 票）` : ''}`];
  if (invalid.length) {
    lines.push(`略過 ${invalid.length} 票（MAWB 格式／檢查碼不符）：\n${invalid.slice(0, 8).join('\n')}${invalid.length > 8 ? '\n…' : ''}`);
  }
  lines.push('下一步：按「③ 合併／分配」把票拖到各 ULD。');
  alert(lines.join('\n\n'));
}

// 新增一票申報列（載荷表「＋ 列」／最下面那列按 Enter）
function addMawbRow(mawb = '') {
  const s = state();
  if (!s.current || s.current.status === 'locked') return null;
  const raw = String(mawb == null ? '' : mawb).trim();
  const formatted = raw ? (uldFormatMawb(raw) || raw.toUpperCase()) : '';
  if (formatted) {
    const key = uldMawbKey(formatted);
    const exists = (s.current.mawbs || []).some(row => uldMawbKey(row.mawb) === key);
    if (exists) {
      alert(`MAWB「${formatted}」已經在清單裡，請直接改那一列的件數／重量。`);
      return null;
    }
    const check = uldValidateMawb(formatted);
    if (!check.ok && !confirm(`MAWB「${formatted}」\n${uldMawbIssueText(check)}\n\n仍要加入嗎？`)) return null;
  }
  s.current.mawbs = s.current.mawbs || [];
  const row = uldNewMawb({ mawb: formatted, seq: s.current.mawbs.length });
  s.current.mawbs.push(row);
  uldMarkDirty();
  render();
  const input = rootEl && rootEl.querySelector(`tr[data-row-uid="${row.uid}"] [data-row-field="mawb"]`);
  if (input && input.focus) input.focus();
  return row;
}

// 刪除一票申報列（連同它在各板的件數）
function deleteMawbRow(rowUid) {
  const s = state();
  if (!s.current || s.current.status === 'locked') return;
  const row = uldFindMawb(rowUid);
  if (!row) return;
  const linked = uldRowItems(row).length;
  const label = row.mawb || '（空白 MAWB）';
  if (linked && !confirm(`確定刪除「${label}」？\n它在 ${linked} 個板上的件數也會一起刪掉。`)) return;
  uldRemoveMawbRow(rowUid);
  uldMarkDirty();
  render();
  toast(`已刪除 ${label}（尚未儲存）`);
}

// 記錄「進欄位前的 MAWB」：改名時才能把各板明細一起改到新號碼
function onRootFocusIn(event) {
  const target = event.target;
  if (!target || !target.dataset) return;
  if (target.dataset.rowField === 'mawb') {
    const tr = target.closest ? target.closest('tr[data-row-uid]') : null;
    const row = tr ? uldFindMawb(tr.dataset.rowUid) : null;
    if (row) target.dataset.prevMawb = row.mawb || '';
    return;
  }
  // 數字格（申報／各板的 PCS、WT、卡片明細 WT）：一進來就全選 → 直接打字＝覆蓋，不用先刪舊值
  if (target.type === 'number' && (target.dataset.cellField || target.dataset.rowField || target.dataset.itemField || target.dataset.itemWeight)) {
    selectInputText(target);
  }
}

function selectInputText(el) {
  if (!el || !el.select) return;
  const apply = () => {
    if (typeof document !== 'undefined' && document && document.activeElement && document.activeElement !== el) return;
    try { el.select(); } catch (err) { /* number input 在部分瀏覽器不支援 select */ }
  };
  apply();
  // 滑鼠點進來時 click 會把游標放到點的位置 → 下一個 tick 再全選一次（Excel 手感）
  if (typeof setTimeout === 'function') setTimeout(apply, 0);
}

// 新 UI：LIH 主要是 ULD 的狀態；新明細在「單一 UN」時沿用，避免一加票就跳出 LIH 檢核
function defaultItemLih(unit, fallback = 'N') {
  const explicit = String(fallback || '').toUpperCase();
  if (explicit === 'UN3481' || explicit === 'UN3091') return explicit;
  const raw = String((unit && unit.lih_type) || '').toUpperCase();
  return (raw === 'UN3481' || raw === 'UN3091') ? raw : 'N';
}

// ===== U2：貼上多列（Excel／booking list → 一次建立多票）=====
function addPastedRows(uid, text) {
  const s = state();
  const unit = uldFindUnit(uid);
  if (!unit || !s.current || s.current.status === 'locked') return;
  const parsed = uldParsePastedRows(text);
  const rows = parsed.rows || [];
  if (!rows.length) {
    alert('貼上的內容看不出 MAWB#。\n請從 Excel 複製「MAWB／DEST／PCS／WT」四欄（Tab 分隔），或至少 MAWB 一欄。');
    return;
  }
  unit.items = unit.items || [];
  const existing = new Set(unit.items.map(it => uldMawbKey(it.mawb)).filter(Boolean));
  let added = 0;
  let duplicated = 0;
  const addedKeys = [];
  const invalid = [];
  rows.forEach(row => {
    const check = uldValidateMawb(row.mawb);
    if (!check.ok) {
      invalid.push(`${row.mawb}　（${check.message || '格式不正確'}）`);
      return;
    }
    const mawb = check.formatted;
    const key = uldMawbKey(mawb);
    if (!key) return;
    if (existing.has(key)) { duplicated += 1; return; }
    existing.add(key);
    const pcs = Math.max(0, Math.round(uldNum(row.pcs)));
    const weight = weightInputNumber(row.weight);
    const dest = String(row.port || '').toUpperCase() || String(unit.port || '').toUpperCase();
    // 方案 B：貼上的每一票都要有「申報列」；重量放列上，各板只記件數
    s.current.mawbs = s.current.mawbs || [];
    let mawbRow = s.current.mawbs.find(r => uldMawbKey(r.mawb) === key) || null;
    if (!mawbRow) {
      mawbRow = uldNewMawb({
        mawb, dest, pcs, declared_weight: weight,
        auto_alloc: 1,
        is_squeeze: unit.items.length === 0 // 第一票預設夾重
      });
      s.current.mawbs.push(mawbRow);
    } else {
      if (!mawbRow.dest && dest) mawbRow.dest = dest;
      if (!uldNum(mawbRow.pcs) && pcs) mawbRow.pcs = pcs;
      if (!uldNum(mawbRow.declared_weight) && weight) mawbRow.declared_weight = weight;
    }
    unit.items.push(uldNewItem({
      mawb,
      mawb_record_id: mawbRow.mawb_record_id || null,
      port: dest || mawbRow.dest,
      pcs,
      declared_weight: 0, // 由申報 WT 依件數分配
      is_squeeze: !!mawbRow.is_squeeze,
      lih_type: defaultItemLih(unit, 'N')
    }));
    addedKeys.push(key);
    added += 1;
  });
  if (!added) {
    alert(`沒有可加入的票（重複 ${duplicated} 列、格式不符 ${invalid.length} 列）。`
      + (invalid.length ? `\n\n格式不符：\n${invalid.slice(0, 8).join('\n')}${invalid.length > 8 ? '\n…' : ''}` : ''));
    return;
  }
  uldMarkDirty();
  render();
  const otherUnits = [];
  (s.current.ulds || []).forEach(u => {
    if (u.uid === unit.uid) return;
    const hit = (u.items || []).some(it => addedKeys.includes(uldMawbKey(it.mawb)));
    if (hit) otherUnits.push(u);
  });
  const lines = [`已加入 ${added} 票${duplicated ? `（略過重複 ${duplicated} 票）` : ''}`];
  if (parsed.skipped && parsed.skipped.length) lines.push(`略過 ${parsed.skipped.length} 列（看不出 MAWB#）`);
  if (invalid.length) {
    lines.push(`略過 ${invalid.length} 票（MAWB 格式／檢查碼不符）：\n${invalid.slice(0, 8).join('\n')}${invalid.length > 8 ? '\n…' : ''}`);
  }
  if (otherUnits.length) {
    lines.push(`提醒：其中有些票也出現在其他板（${otherUnits.map(u => u.uld_number || u.bulk_ref || '散貨').join('、')}），`
      + '請確認件數／重量怎麼分配（可用明細列的「⇄」依件數拆）。');
  }
  alert(lines.join('\n'));
}

async function pasteItems(uid) {
  const unit = uldFindUnit(uid);
  if (!unit) return;
  if (state().current && state().current.status === 'locked') return;
  try {
    if (!navigator.clipboard || typeof navigator.clipboard.readText !== 'function') {
      throw new Error('這個瀏覽器不支援讀取剪貼簿');
    }
    const text = await navigator.clipboard.readText();
    addPastedRows(uid, text);
  } catch (err) {
    // 讀不到剪貼簿（權限／非 HTTPS）→ 退回手動貼上視窗
    const typed = window.prompt(
      '請貼上 MAWB 清單（可從 Excel 直接複製 4 欄：MAWB／DEST／PCS／WT，或以 Tab／逗號分隔）：',
      ''
    );
    if (typed == null) return;
    addPastedRows(uid, typed);
  }
}

// ===== 載荷表：Enter／Shift+Enter 在同一欄上下移動（Excel 手感）=====
// 回傳「同一欄」的選擇器：各板格＝data-cell-field＋data-cell-unit；申報列＝data-row-field
function gridFocusSelector(el) {
  const ds = (el && el.dataset) || {};
  if (ds.cellField && ds.cellUnit) {
    return `[data-cell-field="${ds.cellField}"][data-cell-unit="${ds.cellUnit}"]`;
  }
  if (ds.rowField && el.type !== 'checkbox') return `[data-row-field="${ds.rowField}"]`;
  return '';
}

function moveGridFocus(el, dir) {
  if (!rootEl || !rootEl.querySelectorAll) return false;
  const selector = gridFocusSelector(el);
  if (!selector) return false;
  const tr = el.closest ? el.closest('tr[data-row-uid]') : null;
  if (!tr) return false;
  const trs = Array.from(rootEl.querySelectorAll('.uldw-grid-table tbody tr[data-row-uid]'));
  const idx = trs.indexOf(tr);
  if (idx < 0) return false;
  const nextTr = trs[idx + dir];
  if (!nextTr) {
    // 最後一列再往下 → 跳到最下面「輸入 MAWB# 後按 Enter 新增一票」那格
    if (dir > 0) {
      const addInput = rootEl.querySelector('#uldw-grid-new-mawb');
      if (addInput && addInput.focus) {
        addInput.focus();
        return true;
      }
    }
    return false;
  }
  const nextInput = nextTr.querySelector(selector);
  if (!nextInput || !nextInput.focus) return false;
  nextInput.focus();
  if (nextInput.select) {
    try { nextInput.select(); } catch (err) { /* number input 在部分瀏覽器不支援 select */ }
  }
  return true;
}

// ===== U2：Enter 直接加入（不用再按「加入」）＋ Esc 關閉選單 =====
function onRootKeydown(event) {
  const target = event.target;
  if (!target || !target.dataset) return;
  const s = state();
  if (event.key === 'Escape' && s.ui && (s.ui.more || s.ui.advanced)) {
    s.ui.more = false;
    s.ui.advanced = false;
    render();
    return;
  }
  if (event.key !== 'Enter' || !s.current || s.current.status === 'locked') return;
  // ① MAWB LIST 最下面那格：輸入 MAWB# 按 Enter → 直接新增一票
  if (target.id === 'uldw-mawb-new') {
    if (event.preventDefault) event.preventDefault();
    const value = target.value;
    target.value = '';
    addMawbRow(value);
    focusMawbAdd();
    return;
  }
  // 載荷表最下面那列：輸入 MAWB# 按 Enter → 直接新增一票
  if (target.id === 'uldw-grid-new-mawb') {
    if (event.preventDefault) event.preventDefault();
    const value = target.value;
    target.value = '';
    addMawbRow(value);
    return;
  }
  // 載荷表：Enter／Shift+Enter＝同一欄的下一列／上一列（Excel 手感，連續打重量最快）
  if (target.dataset.rowField || target.dataset.cellField) {
    if (moveGridFocus(target, event.shiftKey ? -1 : 1) && event.preventDefault) event.preventDefault();
    return;
  }
  if (!target.dataset.draft) return;
  if (event.preventDefault) event.preventDefault();
  const unit = unitOfElement(target);
  if (unit) addItem(unit.uid);
}

// ===== ① MAWB LIST：Excel 式貼上 =====
// - 在任一格按 Ctrl+V：Tab／換行分隔的區塊會從「目前這一列」往下填（列不夠自動新增）
// - 只有單一格（沒有 Tab／換行）→ 交給瀏覽器正常貼上（可貼單一 MAWB）
function mawbGridStartIndex(target) {
  const s = state();
  const rows = (s.current && s.current.mawbs) || [];
  const tr = target && target.closest ? target.closest('tr[data-row-uid]') : null;
  if (!tr) return rows.length;
  const idx = rows.findIndex(row => row.uid === tr.dataset.rowUid);
  return idx >= 0 ? idx : rows.length;
}

function applyMawbGridRows(parsedRows, startIndex) {
  const s = state();
  if (!s.current || s.current.status === 'locked') return { updated: 0, added: 0, invalid: [] };
  s.current.mawbs = s.current.mawbs || [];
  const rows = parsedRows || [];
  const start = Math.max(0, startIndex == null ? s.current.mawbs.length : startIndex);
  const invalid = [];
  let updated = 0;
  let added = 0;
  rows.forEach((raw, offset) => {
    const check = uldValidateMawb(raw.mawb);
    if (!check.ok) invalid.push(`${raw.mawb}（${check.message || '格式不正確'}）`);
    const mawb = check.formatted || uldFormatMawb(raw.mawb) || String(raw.mawb || '').trim().toUpperCase();
    const dest = String(raw.port || '').toUpperCase();
    const pcs = Math.max(0, Math.round(uldNum(raw.pcs)));
    const weight = weightInputNumber(raw.weight);
    const index = start + offset;
    const row = s.current.mawbs[index];
    if (row) {
      const prevKey = uldMawbKey(row.mawb);
      row.mawb = mawb;
      if (dest) row.dest = dest;
      if (pcs > 0) row.pcs = pcs;
      if (weight > 0) row.declared_weight = weight;
      row.auto_alloc = row.auto_alloc == null ? 1 : row.auto_alloc;
      // MAWB／DEST 改了 → 各板明細一起改（否則重量會算在舊號碼上）
      uldSyncRowToItems(row, prevKey);
      updated += 1;
    } else {
      s.current.mawbs.push(uldNewMawb({
        mawb, dest, pcs, declared_weight: weight
      }));
      added += 1;
    }
  });
  uldMarkDirty();
  render();
  return { updated, added, invalid };
}

function pasteMawbGrid(text, target) {
  const parsed = uldParsePastedRows(text);
  const rows = parsed.rows || [];
  if (!rows.length) {
    alert('貼上的內容看不出 MAWB#。\n請從 Excel 複製「MAWB／DEST／PCS／WT」四欄（Tab 分隔）。');
    return;
  }
  const result = applyMawbGridRows(rows, mawbGridStartIndex(target));
  const lines = [`已貼上 ${result.updated + result.added} 列（更新 ${result.updated}／新增 ${result.added}）`];
  if (result.invalid.length) {
    lines.push(`其中 ${result.invalid.length} 筆 MAWB# 格式／檢查碼不正確（已標紅）：\n${result.invalid.slice(0, 8).join('\n')}${result.invalid.length > 8 ? '\n…' : ''}`);
  }
  toast(lines.join('\n'));
}

// ===== U2：在卡片內貼上多列 → 自動拆成多票 =====
// 只攔「MAWB 類」欄位（MAWB# 輸入框／明細列 MAWB／申報列 MAWB），其他欄位照瀏覽器正常貼上。
// 原因：ULD# 欄（placeholder 就是 PMC12345QR）若也被攔，貼 PMC40026DS 這種 ULD# 會被
// 丟去 addPastedRows() 當成 MAWB 驗證 → 跳出「沒有可加入的票…MAWB 是 11 位數字…」。
function onRootPaste(event) {
  const target = event.target;
  if (!target || !target.dataset) return;
  const s = state();
  if (!s.current || s.current.status === 'locked') return;
  // ① MAWB LIST：Excel 式貼上（Tab／換行＝整塊貼入；單格照瀏覽器）
  if (target.closest && target.closest('#uldw-mawb-panel')) {
    const raw = event.clipboardData ? event.clipboardData.getData('text') : '';
    const isBlock = raw.includes('\t') || /\r?\n/.test(String(raw).trim());
    if (!isBlock) return;
    if (event.preventDefault) event.preventDefault();
    pasteMawbGrid(raw, target);
    return;
  }
  const unit = unitOfElement(target);
  if (!unit) return;
  // 貼在「非輸入欄位」的空白處 → 仍當成「貼 MAWB 清單」的快捷（原有習慣不變）
  const tag = String(target.tagName || '').toUpperCase();
  const isFormField = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  if (isFormField && !uldPasteIsMawbField(target.dataset)) return;
  const text = event.clipboardData ? event.clipboardData.getData('text') : '';
  if (!text) return;
  const parsed = uldParsePastedRows(text);
  // 只有 1 列且貼在 MAWB 欄 → 讓瀏覽器照常貼單一值（保留 Booking 自動完成）
  if (!parsed.rows.length || (parsed.rows.length === 1 && target.dataset.draft === 'mawb')) return;
  if (event.preventDefault) event.preventDefault();
  addPastedRows(unit.uid, text);
}

// ===== U3：只印這一板（瀏覽器列印；版面由 @media print 的 .uldw-print-single 控制）=====
function printUnit(uid) {
  const s = state();
  if (!s.current || !rootEl) return;
  if (typeof window.print !== 'function') {
    alert('這個瀏覽器不支援列印（window.print）。');
    return;
  }
  const editor = rootEl.querySelector('.uldw-editor');
  const card = rootEl.querySelector(`.uldw-unit[data-uid="${uid}"]`);
  if (!editor || !card) return;
  if (editor.classList) editor.classList.add('uldw-print-single');
  if (card.classList) card.classList.add('is-print-target');
  const cleanup = () => {
    if (editor.classList) editor.classList.remove('uldw-print-single');
    if (card.classList) card.classList.remove('is-print-target');
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  window.print();
  setTimeout(cleanup, 30000); // 保險：部分瀏覽器不會觸發 afterprint
}

// ===== U2：拖曳排序（只改順序；不影響計算）=====
//   dragKind = 'unit-card'：卡片檢視上下拖（把手 ⠿）
//   dragKind = 'grid-col' ：載荷表板欄左右拖（欄頭 01/A、02/B… 直接拖；比左右中点決定插在前／後）
let dragUid = null;
let dragKind = '';
let dragRowUid = null;   // ③ 合併頁：正在拖的 MAWB 申報列
let dragItemUid = null;  // ③ 合併頁：正在拖的分板明細
let dragFromUnit = null; // ③ 合併頁：明細原本在哪一板

function onRootPointerDown(event) {
  const handle = event.target && event.target.closest ? event.target.closest('[data-drag-handle]') : null;
  if (!handle) return;
  const card = handle.closest('.uldw-unit');
  if (card) card.draggable = true;
}

function onRootDragStart(event) {
  const s = state();
  const target = event.target;
  // 在輸入框／下拉裡拖曳文字時不要拖動整張卡片或整票（合併頁窄卡很密，容易誤觸）
  if (target && target.closest && target.closest('input, textarea, select')) return;
  // ===== ③ 合併／分配：MAWB 票（拖到 ULD）=====
  const chip = target && target.closest ? target.closest('[data-mawb-chip]') : null;
  if (chip && s.current && s.current.status !== 'locked') {
    dragKind = 'merge-mawb';
    dragRowUid = chip.dataset.rowUid || null;
    if (!dragRowUid) return;
    if (event.dataTransfer) {
      try {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', dragRowUid);
      } catch (e) { /* ignore */ }
    }
    if (chip.classList) chip.classList.add('is-dragging');
    return;
  }
  // ===== ③ 合併／分配：已分到某板的明細（拖到另一個 ULD）=====
  const mergeItem = target && target.closest ? target.closest('[data-merge-item]') : null;
  if (mergeItem && s.current && s.current.status !== 'locked') {
    dragKind = 'merge-item';
    dragItemUid = mergeItem.dataset.itemUid || null;
    dragFromUnit = mergeItem.dataset.unitUid || null;
    if (!dragItemUid || !dragFromUnit) return;
    if (event.dataTransfer) {
      try {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', dragItemUid);
      } catch (e) { /* ignore */ }
    }
    if (mergeItem.classList) mergeItem.classList.add('is-dragging');
    return;
  }
  // ===== ③ 合併／分配：ULD 欄（拖曳欄頭排序；格子不觸發整欄拖曳）=====
  const mergeUnit = target && target.closest ? target.closest('[data-merge-unit]') : null;
  if (mergeUnit && s.current && s.current.status !== 'locked' && target.closest('.uldw-mx-head')) {
    dragKind = 'merge-unit';
    dragUid = mergeUnit.dataset.uid || null;
    if (!dragUid) return;
    if (event.dataTransfer) {
      try {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', dragUid);
      } catch (e) { /* ignore */ }
    }
    if (mergeUnit.classList) mergeUnit.classList.add('is-dragging');
    return;
  }
  // ===== 載荷表：板欄左右拖（欄頭 01/A、02/B…）=====
  const th = target && target.closest ? target.closest('[data-col-unit]') : null;
  if (th && s.current && s.current.status !== 'locked') {
    dragKind = 'grid-col';
    dragUid = th.dataset.colUnit || null;
    if (!dragUid) return;
    if (event.dataTransfer) {
      try {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', dragUid);
      } catch (e) { /* ignore */ }
    }
    if (th.classList) th.classList.add('is-dragging');
    return;
  }
  // ===== 建檔頁：收貨單位卡片上下／左右拖（把手 ⠿）=====
  const card = target && target.closest ? target.closest('.uldw-unit') : null;
  if (!card) return;
  dragKind = 'unit-card';
  dragUid = card.dataset.uid || null;
  if (!dragUid) return;
  if (event.dataTransfer) {
    try {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', dragUid);
    } catch (e) { /* ignore */ }
  }
  if (card.classList) card.classList.add('is-dragging');
}

function onRootDragOver(event) {
  const targetEl = event.target;
  // ③ 合併／分配：MAWB／明細 拖到某一格（整欄都會亮）
  if (dragKind === 'merge-mawb' || dragKind === 'merge-item') {
    const col = targetEl && targetEl.closest ? targetEl.closest('[data-merge-unit]') : null;
    if (!col) return;
    if (event.preventDefault) event.preventDefault();
    // 整欄淡藍（欄頭＋所有格子）；目前那一格再加放置框
    applyMergeHighlight('', col.dataset.uid || '');
    if (rootEl && rootEl.querySelectorAll) {
      rootEl.querySelectorAll('[data-merge-unit].is-drop-target').forEach(el => {
        if (el !== col && el.classList) el.classList.remove('is-drop-target');
      });
    }
    if (col.classList) col.classList.add('is-drop-target');
    return;
  }
  // ③ 合併／分配：ULD 卡片左右排序（以左右中點決定插在前／後）
  if (dragKind === 'merge-unit') {
    const col = targetEl && targetEl.closest ? targetEl.closest('[data-merge-unit]') : null;
    if (!col) return;
    if (event.preventDefault) event.preventDefault();
    const rect = col.getBoundingClientRect ? col.getBoundingClientRect() : null;
    const after = rect ? (event.clientX - rect.left) > (rect.width / 2) : false;
    if (col.classList) {
      col.classList.toggle('is-drop-after', after);
      col.classList.toggle('is-drop-before', !after);
    }
    return;
  }
  if (!dragUid) return;
  if (dragKind === 'grid-col') {
    const th = event.target && event.target.closest ? event.target.closest('[data-col-unit]') : null;
    if (!th) return;
    if (event.preventDefault) event.preventDefault();
    const rect = th.getBoundingClientRect ? th.getBoundingClientRect() : null;
    const after = rect ? (event.clientX - rect.left) > (rect.width / 2) : false;
    if (th.classList) {
      th.classList.toggle('is-drop-after', after);
      th.classList.toggle('is-drop-before', !after);
    }
    return;
  }
  const card = event.target && event.target.closest ? event.target.closest('.uldw-unit') : null;
  if (!card) return;
  if (event.preventDefault) event.preventDefault();
  const side = cardDropSide(card, event);
  if (card.classList) {
    card.classList.toggle('is-drop-before', side.axis === 'y' && !side.after);
    card.classList.toggle('is-drop-after', side.axis === 'y' && side.after);
    card.classList.toggle('is-drop-left', side.axis === 'x' && !side.after);
    card.classList.toggle('is-drop-right', side.axis === 'x' && side.after);
  }
}

// 卡片是網格排列（一列多張）：左右移得比上下多 → 用水平判斷（可以左右換位），否則照原本上下判斷
function cardDropSide(card, event) {
  const rect = card && card.getBoundingClientRect ? card.getBoundingClientRect() : null;
  if (!rect) return { after: false, axis: 'y' };
  const dx = (event.clientX || 0) - (rect.left + rect.width / 2);
  const dy = (event.clientY || 0) - (rect.top + rect.height / 2);
  const axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
  return { after: axis === 'x' ? dx > 0 : dy > 0, axis };
}

function onRootDrop(event) {
  // ③ 合併／分配：MAWB → ULD（件數預設＝未分配件數；重量由申報列自動分）
  if (dragKind === 'merge-mawb') {
    const col = event.target && event.target.closest ? event.target.closest('[data-merge-unit]') : null;
    const rowUid = dragRowUid;
    dragRowUid = null;
    dragKind = '';
    if (!col || !rowUid) return;
    if (event.preventDefault) event.preventDefault();
    const row = uldFindMawb(rowUid);
    const result = uldAssignMawbToUnit(rowUid, col.dataset.uid);
    if (!result.ok) {
      if (result.reason === 'exists') toast('這一板已經有這票了（直接改件數即可）');
      else if (result.reason === 'no-mawb') toast('這一票還沒有 MAWB#');
      return;
    }
    const s = state();
    if (s.ui) s.ui.mergePick = null;
    uldMarkDirty();
    render();
    toast(`已加入 ${row ? row.mawb : ''}（${result.pcs} 件）${result.remaining > 0 ? `，還有 ${result.remaining} 件未分配` : ''}`);
    return;
  }
  // ③ 合併／分配：明細從 A 板搬到 B 板
  if (dragKind === 'merge-item') {
    const col = event.target && event.target.closest ? event.target.closest('[data-merge-unit]') : null;
    const from = dragFromUnit;
    const itemUid = dragItemUid;
    dragFromUnit = null;
    dragItemUid = null;
    dragKind = '';
    if (!col || !from || !itemUid) return;
    if (event.preventDefault) event.preventDefault();
    const result = uldMoveItemToUnit(from, itemUid, col.dataset.uid);
    if (!result.ok) {
      if (result.reason === 'exists') toast('目標板已經有同一票了');
      return;
    }
    uldMarkDirty();
    render();
    toast('已搬到另一個 ULD（記得儲存）');
    return;
  }
  // ③ 合併／分配：ULD 卡片左右排序
  if (dragKind === 'merge-unit') {
    const col = event.target && event.target.closest ? event.target.closest('[data-merge-unit]') : null;
    const from = dragUid;
    dragUid = null;
    dragKind = '';
    if (!col || !from) return;
    if (event.preventDefault) event.preventDefault();
    const rect = col.getBoundingClientRect ? col.getBoundingClientRect() : null;
    const after = rect ? (event.clientX - rect.left) > (rect.width / 2) : false;
    const targetUid = col.dataset.uid;
    if (from !== targetUid && uldMoveUnit(from, targetUid, after)) {
      uldMarkDirty();
      render();
      toast('已調整板序（左右順序就是列印順序）');
    }
    return;
  }
  if (dragKind === 'grid-col') {
    const th = event.target && event.target.closest ? event.target.closest('[data-col-unit]') : null;
    if (!th || !dragUid) return;
    if (event.preventDefault) event.preventDefault();
    const rect = th.getBoundingClientRect ? th.getBoundingClientRect() : null;
    const after = rect ? (event.clientX - rect.left) > (rect.width / 2) : false;
    const targetUid = th.dataset.colUnit;
    const from = dragUid;
    dragUid = null;
    dragKind = '';
    if (from && targetUid && from !== targetUid && uldMoveUnit(from, targetUid, after)) {
      uldMarkDirty();
      render();
      toast('已調整板序（欄位順序就是列印順序；記得儲存）');
    }
    return;
  }
  const card = event.target && event.target.closest ? event.target.closest('.uldw-unit') : null;
  if (!card || !dragUid) return;
  if (event.preventDefault) event.preventDefault();
  const after = cardDropSide(card, event).after;
  const targetUid = card.dataset.uid;
  const from = dragUid;
  dragUid = null;
  dragKind = '';
  if (from && targetUid && from !== targetUid && uldMoveUnit(from, targetUid, after)) {
    uldMarkDirty();
    render();
    toast('已調整板序（只影響顯示與列印順序）');
  }
}

function onRootDragEnd() {
  dragUid = null;
  dragKind = '';
  dragRowUid = null;
  dragItemUid = null;
  dragFromUnit = null;
  if (!rootEl || !rootEl.querySelectorAll) return;
  rootEl.querySelectorAll('.uldw-unit, [data-merge-unit]').forEach(card => {
    card.draggable = false;
    if (card.classList) {
      card.classList.remove('is-dragging');
      card.classList.remove('is-drop-before');
      card.classList.remove('is-drop-after');
      card.classList.remove('is-drop-left');
      card.classList.remove('is-drop-right');
      card.classList.remove('is-drop-target');
    }
  });
  rootEl.querySelectorAll('[data-mawb-chip], [data-merge-item]').forEach(el => {
    if (el.classList) el.classList.remove('is-dragging');
  });
  // 載荷表的板欄（板頭可拖；dragstart 時只加 class，draggable 由 markup 控制）
  rootEl.querySelectorAll('[data-col-unit]').forEach(th => {
    if (th.classList) {
      th.classList.remove('is-dragging');
      th.classList.remove('is-drop-before');
      th.classList.remove('is-drop-after');
    }
  });
}

// ===== U3：單板 Loading Sheet PDF =====
async function downloadUnitPdf(uid) {
  const s = state();
  const unit = uldFindUnit(uid);
  if (!s.current || !unit) return;
  if (!unit.id) {
    alert('這一板還沒存進資料庫，請先按「儲存」再下載 Loading Sheet。');
    return;
  }
  if (s.dirty) {
    if (!confirm('尚有未儲存的修改，PDF 會用「已儲存的內容」產生，仍要下載嗎？')) return;
  }
  try {
    toast('正在產生 Loading Sheet…');
    const blob = await fetchLoadingSheetPdfBlob(s.current.id, unit.id);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const name = unit.uld_number || unit.bulk_ref || `unit-${unit.id}`;
    link.href = url;
    link.download = `${s.current.sheet_no || 'uld-weight'}-${name}.pdf`.replace(/[^\w.-]+/g, '-');
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast('已下載 Loading Sheet');
  } catch (err) {
    alert(`下載 Loading Sheet 失敗：${err.message}`);
  }
}

// ===== W4：列印／另存 PDF（@media print；草稿與鎖定都可列印）=====
// 只呼叫瀏覽器列印（不另開視窗、不動狀態）；列印版面由 public/css/uld-weight.css 的 @media print 控制。
function printCurrent() {
  const s = state();
  if (s.view !== 'editor' || !s.current) {
    alert('請先開啟一張夾重表再列印。');
    return;
  }
  if (typeof window.print !== 'function') {
    alert('這個瀏覽器不支援列印（window.print）。');
    return;
  }
  // 合併頁的看板不列印 → 先回到 ①② 建檔頁（列印只留表頭、ULD 與明細）
  if (s.ui && s.ui.step === 'merge') {
    s.ui.step = 'build';
    s.ui.mergePick = null;
    render();
  }
  window.print();
}

// ===== R1：下載 server 端正式 PDF（固定排版；草稿與鎖定都可下載）=====
async function downloadPdf() {
  const s = state();
  if (s.view !== 'editor' || !s.current) {
    alert('請先開啟一張夾重表再下載 PDF。');
    return;
  }
  if (s.dirty) {
    if (!confirm('尚有未儲存的修改，PDF 會用「已儲存的內容」產生，仍要下載嗎？')) return;
  }
  try {
    toast('正在產生 PDF…');
    const blob = await fetchReportPdfBlob(s.current.id);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${s.current.sheet_no || 'uld-weight'}.pdf`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast('已下載 PDF');
  } catch (err) {
    alert(`下載 PDF 失敗：${err.message}`);
  }
}

// ===== V2：清單頁批次勾選（只更新勾選狀態與按鈕，不整份重畫）=====
function batchSelectedSet() {
  const s = state();
  if (!Array.isArray(s.batchSelected)) s.batchSelected = [];
  return new Set(s.batchSelected.map(id => Number(id)));
}

function setBatchSelected(ids) {
  const s = state();
  s.batchSelected = [...new Set((ids || []).map(id => Number(id)).filter(id => id > 0))];
  refreshBatchUi();
}

// 勾選狀態變了 → 只更新「已選 N 張」、按鈕、列底色與全選框（不重畫整個清單，焦點／捲動位置不會跑掉）
function refreshBatchUi() {
  if (!rootEl) return;
  const s = state();
  const selected = batchSelectedSet();
  const rows = s.sheets || [];
  const visibleSelected = rows.filter(row => selected.has(Number(row.id))).length;
  const countEl = document.getElementById('uldw-batch-count');
  if (countEl) countEl.textContent = `已選 ${visibleSelected} 張`;
  const btn = document.getElementById('uldw-batch-pdf');
  if (btn) btn.disabled = visibleSelected === 0;
  rows.forEach(row => {
    const tr = rootEl.querySelector ? rootEl.querySelector(`tr[data-sheet-id="${row.id}"]`) : null;
    if (!tr) return;
    const picked = selected.has(Number(row.id));
    if (tr.classList && typeof tr.classList.toggle === 'function') tr.classList.toggle('is-batch-selected', picked);
    const box = tr.querySelector ? tr.querySelector('input[data-batch-id]') : null;
    if (box) box.checked = picked;
  });
  const allEl = document.getElementById('uldw-batch-all');
  if (allEl) allEl.checked = rows.length > 0 && visibleSelected === rows.length;
}

function toggleBatchId(id) {
  const selected = batchSelectedSet();
  const key = Number(id);
  if (!key) return;
  if (selected.has(key)) selected.delete(key); else selected.add(key);
  setBatchSelected([...selected]);
}

function toggleBatchAll(checked) {
  const s = state();
  if (checked) setBatchSelected((s.sheets || []).map(row => row.id));
  else setBatchSelected([]);
}

// ===== V2：批次 PDF（多張夾重表 → 一個 ZIP；含 manifest.txt）=====
async function downloadBatchPdf() {
  const s = state();
  const ids = (s.batchSelected || []).map(id => Number(id)).filter(id => id > 0);
  if (!ids.length) {
    alert('請先在清單勾選要下載的夾重表。');
    return;
  }
  try {
    toast(`正在產生 ${ids.length} 張 PDF…`);
    const blob = await fetchBatchPdfBlob({ ids });
    const url = URL.createObjectURL(blob);
    const pad = n => String(n).padStart(2, '0');
    const now = new Date();
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
      + `-${pad(now.getHours())}${pad(now.getMinutes())}`;
    const link = document.createElement('a');
    link.href = url;
    link.download = `uld-weight-batch-${stamp}.zip`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast(`已下載 ${ids.length} 張的 ZIP`);
  } catch (err) {
    alert(`下載批次 PDF 失敗：${err.message}`);
  }
}

// ===== 匯出 Excel（沿用頁面已載入的 xlsx.full.min.js）=====
function exportExcel() {
  const sheet = state().current;
  if (!sheet) return;
  if (!window.XLSX || !window.XLSX.utils) {
    alert('Excel 匯出元件未載入（xlsx.full.min.js）');
    return;
  }
  const computed = uldComputed();

  const detailRows = [[
    '類別', 'ULD#／批號', 'Contour', 'Port', '件數', 'Tare', 'RCL（淨）', '物料',
    '淨重（夾重後）', '磅差', 'LIH', 'Pre-decl', '夾重方式',
    'MAWB#', 'MAWB Port', 'MAWB 件數', '申報重量', '夾重', '比例%', '最終重量'
  ]];
  computed.units.forEach(unit => {
    const calc = unit.calc;
    const name = calc.kind === 'BULK' ? (unit.bulk_ref || '') : (unit.uld_number || '');
    calc.items.forEach(item => {
      detailRows.push([
        calc.kind === 'BULK' ? 'B' : 'ULD', name, unit.contour_code || '', unit.port || '', unit.pcs || 0,
        calc.tare, calc.rclGross, calc.material, calc.finalSum, calc.diff,
        uldLihLabel(unit.lih_type || 'N'), unit.predecl_type || '', unit.squeeze_mode || '',
        item.mawb || '', item.port || '', item.pcs, item.declared,
        item.squeeze ? 'Y' : 'N', Number((item.ratio * 100).toFixed(1)), item.final
      ]);
    });
  });

  const mawbRows = [['MAWB#', '件數', '原重', '夾重後', '差額', 'Port', '夾重']];
  computed.mawbs.forEach(row => {
    mawbRows.push([row.mawb, row.pcs, row.declared, row.final, row.diff, row.ports.join('/'), row.squeeze ? 'Y' : 'N']);
  });

  const infoRows = [
    ['夾重表', sheet.sheet_no], ['日期', sheet.sheet_date], ['貨站', sheet.terminal],
    ['航班', `${sheet.flight_no || ''} ${sheet.flight_date || ''}`.trim()], ['經手人', sheet.handler],
    ['RCL（淨）總計（kg）', computed.totals.rclTotal], ['Tare 總重（kg，參考）', computed.totals.tareTotal],
    ['夾重後合計（kg）', computed.totals.netTotal], ['磅差（kg）', computed.totals.diffTotal], []
  ];
  const issueRows = [['級別', '對象', '內容']];
  computed.issues.forEach(issue => {
    issueRows.push([issue.level === 'error' ? '錯誤' : '警示', issue.label || '', uldIssueText(issue)]);
  });

  const wb = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.aoa_to_sheet(detailRows), 'ULD 明細');
  window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.aoa_to_sheet(mawbRows), 'MAWB 匯總');
  window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.aoa_to_sheet(infoRows.concat(issueRows)), '檢核');
  window.XLSX.writeFile(wb, `${sheet.sheet_no || 'uld-weight'}.xlsx`);
}

// ===== 複製文字摘要 =====
function copySummary() {
  const sheet = state().current;
  if (!sheet) return;
  const computed = uldComputed();
  const t = computed.totals;
  const sign = t.diffTotal > 0 ? '+' : '';
  const lines = [
    `【ULD 夾重】${sheet.sheet_no}　${sheet.terminal || ''}　${sheet.flight_no || ''}　${sheet.sheet_date || ''}`,
    `單位 ${t.unitCount}（散 ${t.bulkCount}）｜MAWB ${t.mawbCount}｜RCL（淨）${uldFmtKg(t.rclTotal)}kg｜夾重後 ${uldFmtKg(t.netTotal)}kg｜磅差 ${sign}${uldFmtKg(t.diffTotal)}kg`
  ];
  computed.mawbs.forEach(row => {
    const rowSign = row.diff > 0 ? '+' : '';
    lines.push(`${row.mawb}　${row.pcs}件　原重 ${uldFmtKg(row.declared)} → ${uldFmtKg(row.final)} kg（${rowSign}${uldFmtKg(row.diff)}）`);
  });
  const text = lines.join('\n');
  if (typeof window.copyTextToClipboard === 'function') {
    window.copyTextToClipboard(text);
    toast('已複製摘要');
  } else {
    alert(text);
  }
}

// ===== 新增 / 重新整理 =====
async function createNew() {
  try {
    const detail = await createSheet({});
    const s = state();
    s.current = uldSheetFromApi(detail);
    s.dirty = false;
    s.view = 'editor';
    resetVersionsState();
    resetUiState();
    render();
  } catch (err) {
    alert(`新增夾重表失敗：${err.message}`);
  }
}

async function refreshCurrent() {
  const s = state();
  resetBookingCache(); // 執 PLAN／夾重表可能新增／改過 Booking Record，重新整理時一併更新候選清單
  if (s.view === 'editor' && s.current) {
    if (s.dirty && !confirm('尚有未儲存的修改，重新整理會放棄它們，確定嗎？')) return;
    await openSheet(s.current.id);
    return;
  }
  await loadList();
}

// ===== 初始化（由 main.js 的 initProtectedSections 呼叫；admin / staff）=====
export function setupUldWeightSection() {
  if (initialized) return;
  rootEl = document.getElementById('uldw-root');
  if (!rootEl) return;
  initialized = true;

  rootEl.addEventListener('click', onRootClick);
  rootEl.addEventListener('input', onRootInput);
  rootEl.addEventListener('change', onRootChange);
  // U2：Enter 加入、貼上多列、卡片拖曳排序
  rootEl.addEventListener('keydown', onRootKeydown);
  // 方案 B：進 MAWB 欄時記住原值（改名時各板明細要同步）
  rootEl.addEventListener('focusin', onRootFocusIn);
  rootEl.addEventListener('paste', onRootPaste);
  rootEl.addEventListener('pointerdown', onRootPointerDown);
  rootEl.addEventListener('dragstart', onRootDragStart);
  rootEl.addEventListener('dragover', onRootDragOver);
  rootEl.addEventListener('drop', onRootDrop);
  rootEl.addEventListener('dragend', onRootDragEnd);
  // ③ 合併／分配：十字高亮（一票＝一整行、一張 ULD＝一整欄）
  rootEl.addEventListener('mouseover', onRootMouseOver);
  rootEl.addEventListener('mouseleave', clearMergeHighlight);

  const newBtn = document.getElementById('uldw-btn-new');
  if (newBtn) newBtn.addEventListener('click', createNew);
  const refreshBtn = document.getElementById('uldw-btn-refresh');
  if (refreshBtn) refreshBtn.addEventListener('click', refreshCurrent);
  const exportBtn = document.getElementById('uldw-btn-export');
  if (exportBtn) exportBtn.addEventListener('click', exportExcel);
  const copyBtn = document.getElementById('uldw-btn-copy');
  if (copyBtn) copyBtn.addEventListener('click', copySummary);

  // 板型（Contour）建議清單沿用「模擬裝板系統」的 ULD 規格庫；載入失敗就沒有建議清單
  import('./loadsim/uld-specs.js').then(mod => {
    const codes = new Set();
    (mod.LOADSIM_ULD_SPECS || []).forEach(spec => {
      const base = String(spec.code || '').split('-')[0].trim();
      if (base) codes.add(base);
    });
    state().contourOptions = [...codes].sort();
    if (state().view === 'editor') render();
  }).catch(() => { /* 沒有規格庫也能用 */ });

  loadList();
}

// ===== 收貨單位 / 明細操作 =====
function addUnit(kind) {
  const s = state();
  if (!s.current || s.current.status === 'locked') return;
  s.current.ulds = s.current.ulds || [];
  // U2：上限 41 板（超過會讓畫面與列印都失控；業界實務一台包機最多約 41 板）
  if (s.current.ulds.length >= ULD_MAX_UNITS) {
    alert(`最多 ${ULD_MAX_UNITS} 個收貨單位（板）。如需更多，請拆成兩張夾重表（例如依航班或貨站）。`);
    return;
  }
  s.current.ulds.push(uldNewUnit(kind));
  uldMarkDirty();
  render();
}

function removeUnit(uid) {
  const s = state();
  if (!s.current || s.current.status === 'locked') return;
  const unit = uldFindUnit(uid);
  if (!unit) return;
  const label = unit.kind === 'BULK' ? '這批散貨' : '這個 ULD';
  if (!confirm(`確定刪除${label}？（連同其 MAWB 明細）`)) return;
  s.current.ulds = (s.current.ulds || []).filter(u => u.uid !== uid);
  uldMarkDirty();
  render();
}

function addItem(uid) {
  const s = state();
  const unit = uldFindUnit(uid);
  if (!unit || !s.current || s.current.status === 'locked') return;
  const draft = unit.draft || {};
  const rawMawb = String(draft.mawb || '').trim();
  if (!rawMawb) {
    alert('請先輸入 MAWB#');
    return;
  }
  // 保護：MAWB 與本卡 ULD# 相同 → 通常是值被帶到下一格（貼錯／Tab 誤填）
  const unitDigits = uldMawbDigits(unit.uld_number);
  if (unitDigits && uldMawbDigits(rawMawb) === unitDigits) {
    alert(`MAWB# 與這張卡的 ULD# 相同（${rawMawb}），請確認是不是填錯格子。`);
    return;
  }
  // MAWB 檢查碼驗證：不合法 → 先提示，使用者確定才加入（既有／特殊資料仍可作業）
  const check = uldValidateMawb(rawMawb);
  const mawb = check.formatted || rawMawb;
  if (!check.ok) {
    const go = confirm(`MAWB「${mawb}」\n${check.message || '格式不正確'}\n\n仍要加入嗎？（建議先更正）`);
    if (!go) return;
  }
  unit.items = unit.items || [];
  // ===== 方案 B：先找／建「MAWB 申報列」，再在這板建立明細 =====
  // 申報 PCS／WT 放表級；這板只記件數，重量由 calc 依件數分配。
  s.current.mawbs = s.current.mawbs || [];
  const key = uldMawbKey(mawb);
  const draftPcs = Math.max(0, Math.round(uldNum(draft.pcs)));
  const draftWeight = weightInputNumber(draft.declared_weight);
  const draftDest = String(draft.port || '').trim().toUpperCase();
  let row = s.current.mawbs.find(r => uldMawbKey(r.mawb) === key) || null;
  if (!row) {
    row = uldNewMawb({
      mawb,
      mawb_record_id: draft.mawb_record_id || null,
      dest: draftDest,
      pcs: draftPcs,
      declared_weight: draftWeight,
      auto_alloc: 1,
      is_squeeze: unit.items.length === 0 // 第一票預設夾重（單票最常見）
    });
    s.current.mawbs.push(row);
  } else {
    if (!row.dest && draftDest) row.dest = draftDest;
    if (!row.mawb_record_id && draft.mawb_record_id) row.mawb_record_id = draft.mawb_record_id;
    if (!uldNum(row.pcs) && draftPcs) row.pcs = draftPcs;
    if (!uldNum(row.declared_weight) && draftWeight) row.declared_weight = draftWeight;
  }
  if (unit.items.some(it => uldMawbKey(it.mawb) === key)) {
    alert(`這一板已經有「${mawb}」，請直接改它的件數（重量由申報 WT 依件數分配）。`);
    return;
  }
  unit.items.push(uldNewItem({
    mawb,
    mawb_record_id: row.mawb_record_id || draft.mawb_record_id || null,
    port: draftDest || row.dest,
    pcs: draftPcs,          // 先在這一板拿全部件數；要拆到別板就在載荷表改
    declared_weight: 0,     // 由申報列的 WT 依件數分配（auto_alloc）
    is_squeeze: !!row.is_squeeze,
    lih_type: defaultItemLih(unit, draft.lih_type || 'N')
  }));
  unit.draft = { mawb: '', mawb_record_id: null, port: '', pcs: '', declared_weight: '', lih_type: 'N' };
  uldMarkDirty();
  render();
}

function removeItem(uid, itemUid) {
  const s = state();
  const unit = uldFindUnit(uid);
  if (!unit || !s.current || s.current.status === 'locked') return;
  unit.items = (unit.items || []).filter(it => it.uid !== itemUid);
  uldMarkDirty();
  render();
}

// 依件數把一票 MAWB 平均分配到它出現的板（重量會依件數自動分）
function splitItem(uid, itemUid) {
  const s = state();
  const unit = uldFindUnit(uid);
  if (!unit || !s.current || s.current.status === 'locked') return;
  const item = (unit.items || []).find(it => it.uid === itemUid);
  if (!item) return;
  const key = uldMawbKey(item.mawb);
  if (!key) {
    alert('這一列沒有 MAWB#，無法分配件數');
    return;
  }
  const row = (s.current.mawbs || []).find(r => uldMawbKey(r.mawb) === key) || null;
  const links = [];
  (s.current.ulds || []).forEach(u => {
    (u.items || []).forEach(it => {
      if (uldMawbKey(it.mawb) === key) links.push({ unit: u, item: it });
    });
  });
  if (links.length < 2) {
    alert('這票 MAWB 只出現在一個板，不需要分配件數');
    return;
  }
  const totalPcs = row
    ? uldNum(row.pcs)
    : links.reduce((sum, link) => sum + uldNum(link.item.pcs), 0);
  if (!(totalPcs > 0)) {
    alert('這一票的申報件數是 0，請先在載荷表左邊填入申報 PCS。');
    return;
  }
  const base = Math.floor(totalPcs / links.length);
  let remainder = totalPcs - base * links.length;
  links.forEach(link => {
    link.item.pcs = base + (remainder > 0 ? 1 : 0);
    if (remainder > 0) remainder -= 1;
  });
  uldMarkDirty();
  render();
  toast(`已把 ${totalPcs} 件平均分到 ${links.length} 個板（重量依件數自動分）`);
}

// 對外掛到 window（main.js 的 initProtectedSections 用 window.setupUldWeightSection 呼叫）
window.setupUldWeightSection = setupUldWeightSection;
