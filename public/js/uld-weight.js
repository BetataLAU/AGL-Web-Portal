// ===== ULD 夾重系統：入口（admin / staff，由 main.js 的 initProtectedSections 呼叫）=====
// 版面：① 收貨單位（P/X 板、B 散貨）② 夾重結果（MAWB 彙總）③ 檢核；算法全部在 uldweight/calc.js
import {
  fetchSheets, createSheet, fetchSheet, saveSheet, deleteSheet, duplicateSheet, setSheetLocked, applySheet,
  fetchReportPdfBlob, fetchLoadingSheetPdfBlob, fetchBatchPdfBlob, syncSheetBookings, fetchSheetVersions, fetchVersionDiff
} from './uldweight/api.js';
import {
  uldWeightState, uldSheetFromApi, uldSheetPayload, uldNewUnit, uldNewItem,
  uldFindUnit, uldMarkDirty, uldSplitMawb, uldComputed, uldMoveUnit, ULD_MAX_UNITS
} from './uldweight/state.js';
import { renderList, renderEditor, refreshComputed, refreshRclImport, refreshVersions } from './uldweight/render.js';
import { resetBookingCache } from './uldweight/booking-search.js';
import { uldParsePastedRows } from './uldweight/paste-parse.js';
import { uldFormatMawb, uldValidateMawb, uldMawbDigits } from './uldweight/mawb-format.js';
import {
  pickRclFile, loadRclPreview, applyRclColumns, selectedRclRows, rclUldKey
} from './uldweight/rcl-import.js';
import { uldFmtKg, uldNum, uldMawbKey, uldIssueText } from './uldweight/calc.js';

let initialized = false;
let rootEl = null;

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

async function saveCurrent() {
  const s = state();
  if (!s.current) return;
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
    '把每票夾重後的最終重量回寫到打板計劃的 Booking Record？\n'
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

// ===== V1：把沒有連結 Booking 的票補到打板計劃（安全版：先預覽 → 確認 → 才寫入）=====
const SYNC_SKIP_TEXT = {
  no_mawb: '沒有 MAWB#',
  duplicate_booking: '打板計劃已有同號 MAWB 多筆（請先人工整理）'
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
      lines.push(`將連結 ${linked.length} 筆「打板計劃已有同號 MAWB」的票（不重複建立）：`);
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

    if (!confirm(`${lines.join('\n')}\n\n確定要寫入打板計劃嗎？`)) return;

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
function resetUiState() {
  const s = state();
  s.ui = { more: false, advanced: false, expanded: {}, expandAll: false, printUnit: null };
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
  const card = el.closest('.uldw-unit');
  return card ? uldFindUnit(card.dataset.uid) : null;
}

function itemOfElement(el, unit) {
  const row = el.closest('tr[data-item-uid]');
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

// 文字／數字輸入：只更新狀態 + 局部重算（不重畫 → 不會失去焦點）
function onRootInput(event) {
  const target = event.target;
  if (!target || !target.dataset) return;
  if (target.tagName === 'SELECT' || target.type === 'checkbox') return;
  // 清單頁搜尋框（不需要 current sheet）
  if (target.id === 'uldw-list-search') {
    state().listFilter.search = target.value;
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
  const unit = unitOfElement(target);
  if (!unit) return;

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
  // 清單頁狀態篩選
  if (target.id === 'uldw-list-status') {
    state().listFilter.status = target.value;
    loadList();
    return;
  }
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
    s.current[field] = NUMERIC_HEADER_FIELDS.includes(field) ? uldNum(target.value) : target.value;
    uldMarkDirty();
    refreshComputed(rootEl);
    return;
  }
  const unit = unitOfElement(target);
  if (!unit) return;

  if (target.dataset.unitField) {
    const field = target.dataset.unitField;
    unit[field] = NUMERIC_UNIT_FIELDS.includes(field)
      ? uldNum(target.value)
      : upperIfNeeded(field, UPPER_UNIT_FIELDS, target.value);
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
    }
    const raw = target.type === 'checkbox' ? target.checked : target.value;
    item[field] = target.type === 'checkbox' ? raw : upperIfNeeded(field, UPPER_ITEM_FIELDS, raw);
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
    case 'back': backToList(); break;
    case 'save': saveCurrent(); break;
    case 'lock': lockCurrent(true); break;
    case 'unlock': lockCurrent(false); break;
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
    default: break;
  }
  syncHeaderButtons();
}

// ===== U1：顯示狀態切換（盡量只動 class，不整份重畫 → 不打斷輸入）=====
function uiState() {
  const s = state();
  if (!s.ui) s.ui = { more: false, advanced: false, expanded: {}, expandAll: false, printUnit: null };
  if (s.ui.expandAll === undefined) s.ui.expandAll = false;
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
    unit.items.push(uldNewItem({
      mawb,
      port: (String(row.port || '').toUpperCase()) || String(unit.port || '').toUpperCase(),
      pcs: uldNum(row.pcs),
      declared_weight: uldNum(row.weight),
      is_squeeze: unit.items.length === 0, // 第一票預設夾重
      lih_type: 'N'
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
  if (!target.dataset.draft) return;
  if (event.preventDefault) event.preventDefault();
  const unit = unitOfElement(target);
  if (unit) addItem(unit.uid);
}

// ===== U2：在卡片內貼上多列 → 自動拆成多票 =====
function onRootPaste(event) {
  const target = event.target;
  if (!target || !target.dataset) return;
  const s = state();
  if (!s.current || s.current.status === 'locked') return;
  const unit = unitOfElement(target);
  if (!unit) return;
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

// ===== U2：拖曳排序（只改顯示順序；不影響計算）=====
let dragUid = null;

function onRootPointerDown(event) {
  const handle = event.target && event.target.closest ? event.target.closest('[data-drag-handle]') : null;
  if (!handle) return;
  const card = handle.closest('.uldw-unit');
  if (card) card.draggable = true;
}

function onRootDragStart(event) {
  const card = event.target && event.target.closest ? event.target.closest('.uldw-unit') : null;
  if (!card) return;
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
  if (!dragUid) return;
  const card = event.target && event.target.closest ? event.target.closest('.uldw-unit') : null;
  if (!card) return;
  if (event.preventDefault) event.preventDefault();
  const rect = card.getBoundingClientRect ? card.getBoundingClientRect() : null;
  const after = rect ? (event.clientY - rect.top) > (rect.height / 2) : false;
  if (card.classList) {
    card.classList.toggle('is-drop-after', after);
    card.classList.toggle('is-drop-before', !after);
  }
}

function onRootDrop(event) {
  const card = event.target && event.target.closest ? event.target.closest('.uldw-unit') : null;
  if (!card || !dragUid) return;
  if (event.preventDefault) event.preventDefault();
  const rect = card.getBoundingClientRect ? card.getBoundingClientRect() : null;
  const after = rect ? (event.clientY - rect.top) > (rect.height / 2) : false;
  const targetUid = card.dataset.uid;
  const from = dragUid;
  dragUid = null;
  if (from && targetUid && from !== targetUid && uldMoveUnit(from, targetUid, after)) {
    uldMarkDirty();
    render();
    toast('已調整板序（只影響顯示與列印順序）');
  }
}

function onRootDragEnd() {
  dragUid = null;
  if (!rootEl || !rootEl.querySelectorAll) return;
  rootEl.querySelectorAll('.uldw-unit').forEach(card => {
    card.draggable = false;
    if (card.classList) {
      card.classList.remove('is-dragging');
      card.classList.remove('is-drop-before');
      card.classList.remove('is-drop-after');
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
    '類別', 'ULD#／批號', 'Contour', 'Port', '件數', 'Tare', 'RCL Gross', '物料',
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
        unit.lih_type || 'N', unit.predecl_type || '', unit.squeeze_mode || '',
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
    ['RCL 總重（kg）', computed.totals.rclTotal], ['Tare 總重（kg）', computed.totals.tareTotal],
    ['淨重合計（kg）', computed.totals.netTotal], ['磅差（kg）', computed.totals.diffTotal], []
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
    `單位 ${t.unitCount}（散 ${t.bulkCount}）｜MAWB ${t.mawbCount}｜RCL ${uldFmtKg(t.rclTotal)}kg｜淨重 ${uldFmtKg(t.netTotal)}kg｜磅差 ${sign}${uldFmtKg(t.diffTotal)}kg`
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
  resetBookingCache(); // 打板計劃可能新增／改過 Booking Record，重新整理時一併更新候選清單
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
  rootEl.addEventListener('paste', onRootPaste);
  rootEl.addEventListener('pointerdown', onRootPointerDown);
  rootEl.addEventListener('dragstart', onRootDragStart);
  rootEl.addEventListener('dragover', onRootDragOver);
  rootEl.addEventListener('drop', onRootDrop);
  rootEl.addEventListener('dragend', onRootDragEnd);

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
  unit.items.push(uldNewItem({
    mawb,
    mawb_record_id: draft.mawb_record_id || null, // 從打板計劃 Booking Record 選的才有值
    port: String(draft.port || '').trim().toUpperCase(),
    pcs: uldNum(draft.pcs),
    declared_weight: uldNum(draft.declared_weight),
    is_squeeze: unit.items.length === 0, // 第一票預設夾重（單票最常見）
    lih_type: draft.lih_type || 'N'
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

// 依件數把一票 MAWB 的總重量拆到所有相關單位
function splitItem(uid, itemUid) {
  const s = state();
  const unit = uldFindUnit(uid);
  if (!unit || !s.current || s.current.status === 'locked') return;
  const item = (unit.items || []).find(it => it.uid === itemUid);
  if (!item) return;
  const key = uldMawbKey(item.mawb);
  if (!key) {
    alert('這一列沒有 MAWB#，無法拆分');
    return;
  }
  const related = [];
  (s.current.ulds || []).forEach(u => {
    (u.items || []).forEach(it => {
      if (uldMawbKey(it.mawb) === key) related.push(it);
    });
  });
  if (related.length < 2) {
    alert('這票 MAWB 只出現在一個單位，不需要拆分');
    return;
  }
  const suggested = related.reduce((sum, it) => sum + uldNum(it.declared_weight), 0);
  const input = window.prompt(
    `「${item.mawb}」的總重量（kg），將依件數拆到 ${related.length} 個單位：`,
    suggested > 0 ? String(suggested) : ''
  );
  if (input == null) return;
  const total = uldNum(input);
  if (!(total > 0)) return;
  const result = uldSplitMawb(uid, itemUid, total);
  if (!result.count) {
    alert('找不到可拆分的 MAWB 明細');
    return;
  }
  render();
  toast(`已拆分：${result.weights.map(w => uldFmtKg(w)).join(' / ')} kg`);
}

// 對外掛到 window（main.js 的 initProtectedSections 用 window.setupUldWeightSection 呼叫）
window.setupUldWeightSection = setupUldWeightSection;
