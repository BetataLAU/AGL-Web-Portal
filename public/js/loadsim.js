// ===== 模擬裝板系統：入口模組 =====
// 版面：① 新增貨物（左）｜② 俯視圖 ＋ 前視圖（右）｜底部摘要（重量 / 利用率 / 警示）
// 純前端：無後端 API、無資料表；板型規格內建，使用中的狀態存 localStorage。
// 掛載方式與 public/js/pallet.js 一致（type="module" ＋ window.setupLoadsimSection）。
import {
  LOADSIM_ULD_SPECS, loadsimBaseSpec, loadsimGetSpec, loadsimSpecImageUrl
} from './loadsim/uld-specs.js';
import {
  loadsimFormatLength, loadsimFormatNumber, loadsimFormatAmount, loadsimUnitLabel,
  loadsimUnitToCm, loadsimInputStep, loadsimInputMin, loadsimFormatTick
} from './loadsim/units.js';
import {
  loadsimState, loadsimLoadStored, loadsimSave, loadsimOnChange, loadsimCreateItemsBatch, loadsimUpdateCargo,
  loadsimPendingItems, loadsimPlacedItems, loadsimBoardItems, loadsimSelect,
  loadsimDeleteItem, loadsimDeleteItems, loadsimUnplaceItem, loadsimClearAll, loadsimEmit,
  loadsimGetItem, loadsimPlaceItem
} from './loadsim/state.js';
import {
  loadsimDraw, loadsimHitTest, loadsimSetViewMode, loadsimGetViewMode, loadsimResetView,
  loadsimIsFrameSettling
} from './loadsim/render.js';
import {
  loadsimInitDrag, loadsimGetPreview, loadsimGetHoverId, loadsimStartSpawnDrag,
  loadsimIsDragging, loadsimGetDragMode, rotateItemSafely
} from './loadsim/drag.js';
import { loadsimFindAutoPlacement } from './loadsim/autoplace.js';
import { loadsimSettleBoard } from './loadsim/settle.js';
import { loadsimSummarize, loadsimWeightLevel, loadsimItemCbm } from './loadsim/weight.js';
import {
  loadsimDimsOf, loadsimExtents, loadsimEvaluatePlacement
} from './loadsim/geometry.js';

let initialized = false;
let els = {};
let renderQueued = false;
let resizeObserver = null;

// 畫布尺寸快取（效能）：拖曳時每幀都 getBoundingClientRect() 會強制 reflow，
// 這裡改成只在 ResizeObserver / 視窗尺寸變化 / 切換到本區塊時重新量測。
let stageSize = { w: 0, h: 0, dirty: true };

function measureStageSize() {
  const canvas = els.canvas;
  if (!canvas) return stageSize;
  const rect = canvas.getBoundingClientRect();
  if (rect.width > 0 && rect.height > 0) {
    stageSize = { w: Math.round(rect.width), h: Math.round(rect.height), dirty: false };
  }
  return stageSize;
}

function invalidateStageSize() {
  stageSize.dirty = true;
}

// 畫布 rect 快取（效能）：tooltip 定位只需要「相對畫布左上角」的座標，
// 因此快取一次即可；捲動 / 縮放 / 尺寸變化時失效。
let canvasRectCache = null;
function invalidateCanvasRect() { canvasRectCache = null; }
function canvasRect() {
  const canvas = els.canvas;
  if (!canvas) return null;
  if (!canvasRectCache) canvasRectCache = canvas.getBoundingClientRect();
  return canvasRectCache;
}

function esc(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

function fmtKg(value) {
  return `${(Number(value) || 0).toFixed(1)} kg`;
}

function fmtLen(cm) {
  return loadsimFormatLength(cm, loadsimState.unit);
}

// 目前生效的板型（含使用者覆寫）
function currentSpec() {
  return loadsimGetSpec(loadsimState.uldCode, loadsimState.specOverrides);
}

export function setupLoadsimSection() {
  if (initialized) return;
  const root = document.getElementById('section-loadsim');
  if (!root) return;
  initialized = true;

  els = {
    root,
    select: document.getElementById('loadsim-uld-select'),
    unitButtons: root.querySelectorAll('.loadsim-unit-btn'),
    form: document.getElementById('loadsim-item-form'),
    dimRows: document.getElementById('loadsim-dim-rows'),
    len: document.getElementById('loadsim-len'),
    wid: document.getElementById('loadsim-wid'),
    hgt: document.getElementById('loadsim-hgt'),
    weight: document.getElementById('loadsim-weight'),
    qty: document.getElementById('loadsim-qty'),
    name: document.getElementById('loadsim-item-name'),
    mawb: document.getElementById('loadsim-item-mawb'),
    addBtn: document.getElementById('loadsim-btn-add'),
    btnCancelEdit: document.getElementById('loadsim-btn-cancel-edit'),
    editHint: document.getElementById('loadsim-edit-hint'),
    pending: document.getElementById('loadsim-pending'),
    canvas: document.getElementById('loadsim-canvas'),
    tooltip: document.getElementById('loadsim-tooltip'),
    toast: document.getElementById('loadsim-toast'),
    summary: document.getElementById('loadsim-summary'),
    summaryTop: document.getElementById('loadsim-summary-top'),
    unitLabels: root.querySelectorAll('[data-loadsim-unit]'),
    btnImage: document.getElementById('loadsim-btn-image'),
    btnSpec: document.getElementById('loadsim-btn-spec'),
    btnClear: document.getElementById('loadsim-btn-clear'),
    toggleOverhang: document.getElementById('loadsim-strict-overhang'),
    toggleSupport: document.getElementById('loadsim-require-support'),
    supportMin: document.getElementById('loadsim-support-min'),
    toggleSupportArea: document.getElementById('loadsim-support-area-enabled'),
    itemMaxKg: document.getElementById('loadsim-item-max'),
    toggleItemMax: document.getElementById('loadsim-item-max-enabled'),
    viewButtons: root.querySelectorAll('.loadsim-view-btn'),
    btnResetView: document.getElementById('loadsim-btn-reset-view'),
    itemLines: document.getElementById('loadsim-item-lines'),
    hint: document.getElementById('loadsim-hint')
  };

  loadsimLoadStored();
  if (!LOADSIM_ULD_SPECS.some(spec => spec.code === loadsimState.uldCode)) {
    loadsimState.uldCode = LOADSIM_ULD_SPECS[0].code;
  }

  buildUldSelect();
  wireToolbar();
  wireForm();
  wirePendingList();
  wireItemLines();
  wireCanvas();

  loadsimInitDrag({
    canvas: els.canvas,
    render: scheduleRender,
    notify: showToast,
    getSpec: currentSpec
  });

  loadsimOnChange(() => {
    refreshUi();
    scheduleRender();
  });

  applyUnitLabels();
  setViewMode(loadsimGetViewMode(), { silent: true });
  refreshUi();
  scheduleRender();

  if (typeof ResizeObserver === 'function') {
    resizeObserver = new ResizeObserver(() => {
      invalidateStageSize();
      invalidateCanvasRect();
      scheduleRender();
    });
    resizeObserver.observe(els.canvas.parentElement || els.canvas);
  } else {
    window.addEventListener('resize', () => {
      invalidateStageSize();
      invalidateCanvasRect();
      scheduleRender();
    });
  }

  // 區塊隱藏時（display:none）畫布量不到尺寸，切換成顯示後要重新量測再畫
  const navLink = document.getElementById('nav-loadsim');
  if (navLink) {
    navLink.addEventListener('click', () => {
      invalidateStageSize();
      setTimeout(scheduleRender, 80);
    });
  }
  if (typeof MutationObserver === 'function') {
    new MutationObserver(() => {
      if (root.classList.contains('active')) {
        invalidateStageSize();
        // 切回本區塊時重算一次（順便讓「出界閃爍」計時器重新啟動）
        refreshUi();
        scheduleRender();
      }
    }).observe(root, { attributes: true, attributeFilter: ['class'] });
  }

  // 捲動 / 縮放會改變畫布在視窗中的位置 → 讓 tooltip 用的 rect 快取失效
  document.addEventListener('scroll', () => {
    invalidateCanvasRect();
    hideTooltip();
  }, { capture: true, passive: true });
  window.addEventListener('resize', invalidateCanvasRect);
}

// ===== 板型下拉 =====
function buildUldSelect() {
  if (!els.select) return;
  const unit = loadsimState.unit;
  const label = loadsimUnitLabel(unit);
  els.select.innerHTML = LOADSIM_ULD_SPECS.map(base => {
    const spec = loadsimGetSpec(base.code, loadsimState.specOverrides);
    // 顯示「貼地（板面）」尺寸＝現場實際的板子尺寸；外擴型板型另外標輪廓上限
    const dims = `${loadsimFormatNumber(spec.floorL, unit, 0)}×${loadsimFormatNumber(spec.floorW, unit, 0)}×${loadsimFormatNumber(spec.heightCm, unit, 0)} ${label}`;
    const outline = spec.flared
      ? `（輪廓 ${loadsimFormatNumber(spec.baseL, unit, 0)}×${loadsimFormatNumber(spec.baseW, unit, 0)}）`
      : '';
    return `<option value="${esc(base.code)}">${esc(base.code)}　${dims}${outline}</option>`;
  }).join('');
  els.select.value = loadsimState.uldCode;
}


// ===== 工具列 =====
function wireToolbar() {
  if (els.select) {
    els.select.addEventListener('change', () => {
      loadsimState.uldCode = els.select.value;
      loadsimSave();
      buildUldSelect();
      refreshUi();
      scheduleRender();
    });
  }

  els.unitButtons.forEach(btn => {
    btn.addEventListener('click', () => setUnit(btn.dataset.unit));
  });

  if (els.btnImage) els.btnImage.addEventListener('click', showContourImage);
  if (els.btnSpec) els.btnSpec.addEventListener('click', openSpecEditor);

  if (els.btnClear) {
    els.btnClear.addEventListener('click', () => {
      if (!loadsimState.items.length) {
        showToast('目前還沒有貨物');
        return;
      }
      if (!confirm('清空所有貨物？（清空後可用 Ctrl+Z 復原）')) return;
      loadsimClearAll();
      showToast('已清空');
    });
  }

  if (els.toggleOverhang) {
    els.toggleOverhang.checked = !loadsimState.allowOverhang;
    els.toggleOverhang.addEventListener('change', () => {
      loadsimState.allowOverhang = !els.toggleOverhang.checked;
      loadsimSave();
      refreshUi();
      scheduleRender();
    });
  }

  if (els.toggleSupport) {
    els.toggleSupport.checked = !!loadsimState.requireSupport;
    els.toggleSupport.addEventListener('change', () => {
      loadsimState.requireSupport = !!els.toggleSupport.checked;
      loadsimSave();
      refreshUi();
      scheduleRender();
    });
  }

  // 「上貨需壓在下方貨物 X% 面積」開關（取消勾選＝有支撐即可，不看面積比例）
  if (els.toggleSupportArea) {
    els.toggleSupportArea.checked = loadsimState.supportAreaEnabled !== false;
    els.toggleSupportArea.addEventListener('change', () => {
      loadsimState.supportAreaEnabled = !!els.toggleSupportArea.checked;
      loadsimSave();
      refreshUi();
      scheduleRender();
    });
  }

  // 「單件重量上限」開關（取消勾選＝不檢查單件重量）
  if (els.toggleItemMax) {
    els.toggleItemMax.checked = loadsimState.itemMaxEnabled !== false;
    els.toggleItemMax.addEventListener('change', () => {
      loadsimState.itemMaxEnabled = !!els.toggleItemMax.checked;
      loadsimSave();
      refreshUi();
    });
  }

  // 取消修改：離開編輯模式並清空表單
  if (els.btnCancelEdit) {
    els.btnCancelEdit.addEventListener('click', () => {
      exitEditMode(true);
      showToast('已取消修改');
    });
  }

  if (els.supportMin) {
    els.supportMin.value = String(loadsimState.supportMinPct === undefined ? 50 : loadsimState.supportMinPct);
    els.supportMin.addEventListener('change', () => {
      const value = parseFloat(els.supportMin.value);
      loadsimState.supportMinPct = isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : 50;
      els.supportMin.value = String(loadsimState.supportMinPct);
      loadsimSave();
      refreshUi();
      scheduleRender();
    });
  }
  if (els.itemMaxKg) {
    els.itemMaxKg.value = String(loadsimState.itemMaxKg || '');
    els.itemMaxKg.addEventListener('change', () => {
      const value = parseFloat(els.itemMaxKg.value);
      loadsimState.itemMaxKg = isFinite(value) && value > 0 ? value : 0;
      loadsimSave();
      refreshUi();
    });
  }

  els.viewButtons.forEach(btn => {
    btn.addEventListener('click', () => setViewMode(btn.dataset.view));
  });

  if (els.btnResetView) {
    els.btnResetView.addEventListener('click', () => {
      loadsimResetView();
      scheduleRender();
    });
  }
}

// 視圖切換：3D（預設）↔ 2D 剖面
function setViewMode(mode, options = {}) {
  const next = mode === '2d' ? '2d' : '3d';
  loadsimSetViewMode(next);
  els.viewButtons.forEach(btn => btn.classList.toggle('active', btn.dataset.view === next));
  if (els.btnResetView) els.btnResetView.hidden = next !== '3d';
  if (els.hint) els.hint.dataset.mode = next;
  if (!options.silent) {
    hideTooltip();
    scheduleRender();
  }
}

// ===== 單位切換（輸入框數值同步換算，實際尺寸不變）=====
function setUnit(unit) {
  if (unit !== 'in' && unit !== 'cm') return;
  if (unit === loadsimState.unit) return;
  const previous = loadsimState.unit;

  // 表單可能有多列尺寸 → 每一列的長/寬/高都要換算
  dimRowEls().forEach(fields => {
    ['len', 'wid', 'hgt'].forEach(key => {
      const field = fields[key];
      if (!field) return;
      const value = parseFloat(field.value);
      if (!isFinite(value) || value <= 0) return;
      const cm = loadsimUnitToCm(value, previous);
      field.value = loadsimFormatNumber(cm, unit);
    });
  });

  loadsimState.unit = unit;
  loadsimSave();
  els.unitButtons.forEach(btn => btn.classList.toggle('active', btn.dataset.unit === unit));
  applyUnitLabels();
  buildUldSelect();
  refreshUi();
  scheduleRender();
}

function applyUnitLabels() {
  const label = loadsimUnitLabel(loadsimState.unit);
  const step = loadsimInputStep(loadsimState.unit);
  const min = loadsimInputMin(loadsimState.unit);
  els.unitLabels.forEach(node => { node.textContent = label; });
  dimRowEls().forEach(fields => {
    ['len', 'wid', 'hgt'].forEach(key => {
      const field = fields[key];
      if (!field) return;
      // step 的基準點是 min，兩者要一起改，否則整數值會被瀏覽器判定為不合法（無法送出表單）
      field.step = step;
      field.min = min;
      field.placeholder = label;
    });
  });
}

// ===== ① 新增貨物：尺寸列（可「＋ 新增」多列，同一 MAWB 多種尺寸）=====
const DIM_ROW_TEMPLATE = `
  <label>長 <input class="loadsim-dim-l" type="number" step="1" min="1" required /></label>
  <label>寬 <input class="loadsim-dim-w" type="number" step="1" min="1" required /></label>
  <label>高 <input class="loadsim-dim-h" type="number" step="1" min="1" required /></label>
  <label>重量 <input class="loadsim-dim-kg" type="number" step="0.1" min="0" required /><em>kg</em></label>
  <label>件數 <input class="loadsim-dim-qty" type="number" step="1" min="1" value="1" /></label>
  <button type="button" class="loadsim-dim-add" data-action="add-dim" title="再加一列尺寸">＋ 新增</button>
  <button type="button" class="loadsim-dim-del" data-action="remove-dim" title="移除這一列尺寸" hidden>✕</button>`;

// 取得每一列尺寸的輸入框（真實 DOM 依 class 找；DOM stub／舊 HTML 只剩第一列時用 els 後備）
function dimRowEls() {
  const container = els.dimRows;
  const nodes = container && typeof container.querySelectorAll === 'function'
    ? Array.from(container.querySelectorAll('.loadsim-dim-row'))
    : [];
  if (nodes.length) {
    return nodes.map(row => ({
      node: row,
      len: row.querySelector ? row.querySelector('.loadsim-dim-l') : null,
      wid: row.querySelector ? row.querySelector('.loadsim-dim-w') : null,
      hgt: row.querySelector ? row.querySelector('.loadsim-dim-h') : null,
      weight: row.querySelector ? row.querySelector('.loadsim-dim-kg') : null,
      qty: row.querySelector ? row.querySelector('.loadsim-dim-qty') : null
    }));
  }
  return [{ node: null, len: els.len, wid: els.wid, hgt: els.hgt, weight: els.weight, qty: els.qty }];
}

function addDimRow() {
  const container = els.dimRows;
  if (!container || typeof container.appendChild !== 'function') return null;
  const rows = dimRowEls();
  const template = rows[0] && rows[0].node ? rows[0].node : null;
  let row = null;

  if (template && typeof template.cloneNode === 'function') {
    row = template.cloneNode(true);
    // 複製列不可重複 id，數值清空讓使用者重新輸入
    if (row.querySelectorAll) {
      row.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
    }
    ['.loadsim-dim-l', '.loadsim-dim-w', '.loadsim-dim-h', '.loadsim-dim-kg'].forEach(selector => {
      const field = row.querySelector ? row.querySelector(selector) : null;
      if (field) field.value = '';
    });
    const qty = row.querySelector ? row.querySelector('.loadsim-dim-qty') : null;
    if (qty) qty.value = '1';
    const del = row.querySelector ? row.querySelector('.loadsim-dim-del') : null;
    if (del) del.hidden = false;
  } else if (typeof document !== 'undefined' && document.createElement) {
    row = document.createElement('div');
    row.className = 'loadsim-dim-row';
    row.innerHTML = DIM_ROW_TEMPLATE;
  }
  if (!row) return null;

  container.appendChild(row);
  applyUnitLabels();
  const firstField = row.querySelector ? row.querySelector('.loadsim-dim-l') : null;
  if (firstField && typeof firstField.focus === 'function') firstField.focus();
  return row;
}

function removeDimRow(button) {
  const row = button && typeof button.closest === 'function' ? button.closest('.loadsim-dim-row') : null;
  if (!row || !els.dimRows || typeof els.dimRows.querySelectorAll !== 'function') return;
  // 至少保留一列
  if (els.dimRows.querySelectorAll('.loadsim-dim-row').length <= 1) return;
  if (typeof row.remove === 'function') row.remove();
}

function readFormRows() {
  const unit = loadsimState.unit;
  return dimRowEls().map(fields => {
    const num = field => (field ? parseFloat(field.value) : NaN);
    return {
      fields,
      dims: {
        l: loadsimUnitToCm(num(fields.len), unit),
        w: loadsimUnitToCm(num(fields.wid), unit),
        h: loadsimUnitToCm(num(fields.hgt), unit)
      },
      weight: num(fields.weight),
      qty: Math.max(1, parseInt(fields.qty ? fields.qty.value : 1, 10) || 1)
    };
  });
}

function resetFormRows() {
  const container = els.dimRows;
  if (container && typeof container.querySelectorAll === 'function') {
    const rows = Array.from(container.querySelectorAll('.loadsim-dim-row'));
    rows.slice(1).forEach(row => { if (row && typeof row.remove === 'function') row.remove(); });
  }
  if (els.qty) els.qty.value = '1';
  if (els.name) els.name.value = '';
  if (els.mawb) els.mawb.value = '';
  if (els.len && typeof els.len.focus === 'function') els.len.focus();
}

// ===== 明細列點選 → 把該筆（或整個 MAWB）載入表單修改 =====
let editing = { ids: [] };

function editingItems() {
  return editing.ids
    .map(id => loadsimState.items.find(item => item.id === Number(id)))
    .filter(Boolean);
}

function syncOptionInputs() {
  const supportOn = loadsimState.requireSupport !== false;
  const areaOn = supportOn && loadsimState.supportAreaEnabled !== false;
  if (els.supportMin) els.supportMin.disabled = !areaOn;
  if (els.itemMaxKg) els.itemMaxKg.disabled = loadsimState.itemMaxEnabled === false;
  if (els.toggleSupportArea) els.toggleSupportArea.checked = loadsimState.supportAreaEnabled !== false;
  if (els.toggleItemMax) els.toggleItemMax.checked = loadsimState.itemMaxEnabled !== false;
}

function exitEditMode(resetForm) {
  const wasEditing = editing.ids.length > 0;
  editing = { ids: [] };
  if (els.addBtn) els.addBtn.textContent = '＋ 產生貨物';
  if (els.btnCancelEdit) els.btnCancelEdit.hidden = true;
  if (els.editHint) {
    els.editHint.hidden = true;
    els.editHint.textContent = '';
  }
  if (resetForm && wasEditing) resetFormRows();
}

function syncEditingState() {
  if (!editing.ids.length) return;
  if (!editingItems().length) exitEditMode(true);
}

// 把指定貨物（同一個 MAWB 的所有尺寸）載入 ① 表單，供使用者修改
function loadCargoIntoForm(ids) {
  const items = (ids || []).map(id => loadsimGetItem(id)).filter(Boolean);
  if (!items.length) return;
  const unit = loadsimState.unit;

  resetFormRows();
  const container = els.dimRows;
  if (container && typeof container.querySelectorAll === 'function') {
    let rows = dimRowEls();
    while (rows.length < items.length) {
      addDimRow();
      const next = dimRowEls();
      if (next.length === rows.length) break; // 無法新增（DOM stub）→ 避免無限迴圈
      rows = next;
    }
  }

  const rows = dimRowEls();
  items.forEach((item, index) => {
    const fields = rows[index];
    if (!fields) return;
    const d = loadsimDimsOf(item);
    if (fields.len) fields.len.value = loadsimFormatNumber(d.x, unit);
    if (fields.wid) fields.wid.value = loadsimFormatNumber(d.z, unit);
    if (fields.hgt) fields.hgt.value = loadsimFormatNumber(d.y, unit);
    if (fields.weight) fields.weight.value = String(item.weight);
    if (fields.qty) fields.qty.value = '1';
  });

  const first = items[0];
  if (els.name) els.name.value = first.name || '';
  if (els.mawb) els.mawb.value = first.mawb || '';

  editing = { ids: items.map(item => item.id) };
  if (els.addBtn) els.addBtn.textContent = '✔ 儲存修改';
  if (els.btnCancelEdit) els.btnCancelEdit.hidden = false;
  if (els.editHint) {
    els.editHint.hidden = false;
    const mawb = String(first.mawb || '').trim();
    const scope = mawb && items.length > 1
      ? `MAWB ${mawb}（${items.length} 種尺寸）`
      : `#${first.id}`;
    els.editHint.textContent = `正在修改 ${scope}：改完按「儲存修改」，或按「取消修改」離開`;
  }
  applyUnitLabels();
}

// 點明細列 → 有 MAWB 就把整個 MAWB 的尺寸一起載入
function loadCargoGroupIntoForm(id) {
  const item = loadsimGetItem(id);
  if (!item) return;
  const mawb = String(item.mawb || '').trim();
  const group = mawb
    ? loadsimState.items.filter(other => String(other.mawb || '').trim() === mawb)
    : [item];
  loadCargoIntoForm(group.map(entry => entry.id));
}

// ===== 新增貨物表單 =====
function wireForm() {
  if (!els.form) return;

  // 「＋ 新增」再加一列尺寸 /「✕」移除該列
  els.form.addEventListener('click', ev => {
    const btn = ev.target && typeof ev.target.closest === 'function'
      ? ev.target.closest('[data-action]')
      : null;
    const action = btn && btn.dataset ? btn.dataset.action : '';
    if (action === 'add-dim') {
      ev.preventDefault();
      addDimRow();
    } else if (action === 'remove-dim') {
      ev.preventDefault();
      removeDimRow(btn);
    }
  });

  els.form.addEventListener('submit', ev => {
    ev.preventDefault();
    const rows = readFormRows();
    const invalid = rows.filter(row =>
      !(row.dims.l > 0 && row.dims.w > 0 && row.dims.h > 0) ||
      !isFinite(row.weight) || row.weight < 0);
    if (!rows.length || invalid.length) {
      showToast('請輸入大於 0 的長 / 寬 / 高，以及重量（kg）');
      if (invalid[0] && invalid[0].fields.len && typeof invalid[0].fields.len.focus === 'function') {
        invalid[0].fields.len.focus();
      }
      return;
    }

    const mawbValue = els.mawb ? String(els.mawb.value || '').trim() : '';
    const nameValue = els.name ? els.name.value : '';

    // 修改模式（明細列點選過）：更新既有貨物，不新增重複資料
    if (editing.ids.length && editingItems().length) {
      const result = loadsimUpdateCargo({
        ids: editing.ids.slice(),
        rows: rows.map(row => ({ dims: row.dims, weight: row.weight, qty: row.qty })),
        name: nameValue,
        mawb: mawbValue
      });
      exitEditMode(true);
      const moved = loadsimSettleBoard({
        requireSupport: loadsimState.requireSupport,
        supportMinPct: loadsimState.supportMinPct,
        supportAreaEnabled: loadsimState.supportAreaEnabled
      });
      if (moved) {
        loadsimSave();
        loadsimEmit();
      }
      if (result) {
        const extra = [
          result.created ? `新增 ${result.created} 件` : '',
          result.removed ? `刪除 ${result.removed} 件` : ''
        ].filter(Boolean);
        showToast(`已更新 ${result.updated} 件${extra.length ? `、${extra.join('、')}` : ''}${moved ? '（上方貨物已重新落下）' : ''}`, 'ok');
      }
      return;
    }

    const created = loadsimCreateItemsBatch(
      rows.map(row => ({ dims: row.dims, weight: row.weight, qty: row.qty })),
      { name: nameValue, mawb: mawbValue }
    );
    if (!created.length) {
      showToast('沒有建立任何貨物');
      return;
    }

    const mawbText = mawbValue ? `（MAWB ${esc(mawbValue)}）` : '';
    showToast(`已產生 ${created.length} 件貨物${mawbText} → 拖到板內，或點一下自動放置`, 'ok');
    resetFormRows();
  });
}

// ===== 待裝貨物清單（拖曳 / 點擊自動放置 / 旋轉 / 刪除）=====
function wirePendingList() {
  const list = els.pending;
  if (!list) return;

  list.addEventListener('click', ev => {
    const btn = ev.target.closest('button[data-action]');
    if (!btn) return;
    const card = btn.closest('[data-id]');
    if (!card) return;
    const id = Number(card.dataset.id);
    if (btn.dataset.action === 'rotate') rotateItemSafely(id);
    else if (btn.dataset.action === 'remove') loadsimDeleteItem(id);
  });

  list.addEventListener('pointerdown', ev => {
    if (ev.button !== 0 && ev.pointerType === 'mouse') return;
    if (ev.target.closest('button[data-action]')) return;
    const card = ev.target.closest('[data-id]');
    if (!card) return;

    const id = Number(card.dataset.id);
    const startX = ev.clientX;
    const startY = ev.clientY;
    let dragging = false;

    const cleanup = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    const onMove = moveEv => {
      if (dragging) return;
      if (Math.hypot(moveEv.clientX - startX, moveEv.clientY - startY) < 7) return;
      dragging = true;
      cleanup();
      loadsimStartSpawnDrag(id, moveEv);
    };
    const onUp = () => {
      cleanup();
      if (!dragging) autoPlaceItem(id);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    ev.preventDefault();
  });
}

// 點一下 → 自動放到第一個合法空位
function autoPlaceItem(id) {
  const spec = currentSpec();
  const item = loadsimGetItem(id);
  if (!item) return;
  const found = loadsimFindAutoPlacement(item, spec, loadsimState.items, {
    allowOverhang: loadsimState.allowOverhang,
    requireSupport: loadsimState.requireSupport,
    supportMinPct: loadsimState.supportMinPct,
    supportAreaEnabled: loadsimState.supportAreaEnabled
  });
  if (!found) {
    showToast('板內已沒有足夠空間（可先移走部分貨物，或換更大的板型）');
    return;
  }
  loadsimPlaceItem(id, found);
  loadsimSelect(id);
  showToast(`已放到 X ${loadsimFormatNumber(found.x, loadsimState.unit)}、Y ${loadsimFormatNumber(found.y, loadsimState.unit)}、Z ${loadsimFormatNumber(found.z + loadsimDimsOf(item).z / 2, loadsimState.unit)} ${loadsimUnitLabel(loadsimState.unit)}`, 'ok');
}

// ===== 畫布：hover 顯示「當前方向的長闊高」=====
// 效能：pointermove 在高刷新率滑鼠/觸控板可達 120Hz，原本每次移動都做
// ① 射線命中測試 ② tooltip innerHTML 重建 ③ offsetWidth/offsetHeight 版面查詢
// （讀寫交錯 → 每次移動觸發強制 reflow）。現在改成每個影格最多處理一次，
// 且內容沒變就不重建 DOM、拖曳（移動貨物／轉視角）期間直接不顯示。
function wireCanvas() {
  const canvas = els.canvas;
  if (!canvas) return;

  let pending = null;
  let scheduled = false;

  const flush = () => {
    scheduled = false;
    const ev = pending;
    pending = null;
    if (!ev) return;
    if (loadsimIsDragging()) {
      hideTooltip();
      return;
    }
    const rect = canvasRect();
    if (!rect) return;
    const hit = loadsimHitTest(ev.clientX - rect.left, ev.clientY - rect.top);
    updateTooltip(hit, ev, rect);
  };

  canvas.addEventListener('pointermove', ev => {
    pending = ev;
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(flush);
  }, { passive: true });
  canvas.addEventListener('pointerleave', () => {
    pending = null;
    hideTooltip();
  });
  canvas.addEventListener('pointerdown', () => {
    pending = null;
    invalidateCanvasRect();
    hideTooltip();
  });
}

let tooltipKey = '';
let tooltipSize = { w: 0, h: 0 };

function updateTooltip(hit, ev, rect) {
  const tooltip = els.tooltip;
  if (!tooltip) return;
  if (!hit) {
    hideTooltip();
    return;
  }
  const item = loadsimGetItem(hit.itemId);
  if (!item) {
    hideTooltip();
    return;
  }
  const d = loadsimDimsOf(item);
  const unit = loadsimState.unit;

  // 內容沒變（同一件貨物、同位置、同單位）就不重建 DOM，只更新位置
  const key = [
    item.id, item.name, item.x, item.y, item.z, item.orient,
    item.weight, unit, d.x, d.y, d.z, loadsimPlacedItems().length
  ].join('|');

  if (key !== tooltipKey) {
    const report = item.placed ? loadsimPlacementInfo(item) : null;
    const lines = [
      // 名稱後面帶對應的 CTN#（與明細列的 #id 一致，方便對照）
      `<span class="loadsim-tooltip-head"><strong>${esc(item.name)}</strong><span class="loadsim-tooltip-id">| #${item.id}</span></span>`,
      `<span>長 × 寬 × 高：${loadsimFormatNumber(d.x, unit)} × ${loadsimFormatNumber(d.z, unit)} × ${loadsimFormatNumber(d.y, unit)} ${loadsimUnitLabel(unit)}</span>`,
      `<span>重量：${fmtKg(item.weight)}</span>`
    ];
    if (report && report.overflows.length) {
      const text = report.overflows
        .slice()
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 3)
        .map(o => `${o.label} +${loadsimFormatAmount(o.amount, unit)} ${loadsimUnitLabel(unit)}`)
        .join('　');
      lines.push(`<span class="loadsim-tooltip-warn">超出輪廓：${text}</span>`);
    }
    tooltip.innerHTML = lines.join('');
    // 尺寸只在內容變動後量一次（避開每次移動都讀 offsetWidth/offsetHeight）
    tooltipSize = { w: tooltip.offsetWidth || 180, h: tooltip.offsetHeight || 64 };
    tooltipKey = key;
  }
  tooltip.hidden = false;

  const px = ev.clientX - rect.left;
  const py = ev.clientY - rect.top;
  tooltip.style.left = `${Math.max(4, Math.min(px + 14, rect.width - tooltipSize.w - 8))}px`;
  tooltip.style.top = `${Math.max(6, Math.min(py + 14, rect.height - tooltipSize.h - 8))}px`;
}

function loadsimPlacementInfo(item) {
  const spec = currentSpec();
  // 暫存的貨物不在板上 → 不做輪廓／重疊判定
  if (item.staged) {
    return { ok: true, fits: true, overlaps: [], overflows: [], supported: true, overhangMax: 0 };
  }
  const others = loadsimState.items.filter(other => other.placed && !other.staged && other.id !== item.id);
  return loadsimEvaluatePlacement(item, spec, others, {
    allowOverhang: loadsimState.allowOverhang,
    requireSupport: loadsimState.requireSupport,
    supportMinPct: loadsimState.supportMinPct,
    supportAreaEnabled: loadsimState.supportAreaEnabled
  });
}

function hideTooltip() {
  if (els.tooltip) els.tooltip.hidden = true;
}


// ===== 畫布下方的「貨物明細」列（點一下 → 對應貨物閃爍）=====
// 表頭的小圖示＝排序；每列右端＝刪除單筆尺寸／刪除整個 MAWB。
// 同一個 MAWB 有多種尺寸時：第一列是 parent（顯示 MAWB），其餘是 child（縮排）。
let highlight = { id: null, start: 0, end: 0, raf: 0 };
let lineSort = { key: 'id', dir: 'asc' };

function nowMs() {
  return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
}

function toggleLineSort(key) {
  if (!key) return;
  if (lineSort.key === key) {
    lineSort = { key, dir: lineSort.dir === 'asc' ? 'desc' : 'asc' };
  } else {
    lineSort = { key, dir: 'asc' };
  }
  renderItemLines();
}

function wireItemLines() {
  const box = els.itemLines;
  if (!box) return;
  box.addEventListener('click', ev => {
    const target = ev.target;
    const closest = target && typeof target.closest === 'function'
      ? selector => target.closest(selector)
      : null;
    if (!closest) return;

    // ① 排序圖示
    const sortBtn = closest('[data-sort]');
    if (sortBtn && sortBtn.dataset && sortBtn.dataset.sort) {
      toggleLineSort(sortBtn.dataset.sort);
      return;
    }

    // ② 刪除（單筆尺寸 / 整個 MAWB）
    const actionBtn = closest('button[data-action]');
    const action = actionBtn && actionBtn.dataset ? actionBtn.dataset.action : '';
    if (action) {
      const row = typeof actionBtn.closest === 'function' ? actionBtn.closest('[data-id]') : null;
      const id = row && row.dataset ? Number(row.dataset.id) : 0;
      const mawb = row && row.dataset ? String(row.dataset.mawb || '') : '';
      if (action === 'delete-item' && id) deleteItemWithSettle(id);
      else if (action === 'delete-mawb' && mawb) deleteMawbWithSettle(mawb);
      return;
    }

    // ③ 點一列 → 畫布上閃爍 + 把該筆（整個 MAWB）載入 ① 表單修改
    const row = closest('[data-id]');
    if (!row) return;
    const rowId = Number(row.dataset.id);
    highlightItem(rowId);
    loadCargoGroupIntoForm(rowId);
  });
}

// 刪除後讓上方貨物「物理地」落下（item 10）
function settleAfterRemoval(removed) {
  if (!removed) return;
  const moved = loadsimSettleBoard({
    requireSupport: loadsimState.requireSupport,
    supportMinPct: loadsimState.supportMinPct,
    supportAreaEnabled: loadsimState.supportAreaEnabled
  });
  if (moved) {
    loadsimSave();
    loadsimEmit();
  }
  showToast(moved ? `已刪除 ${removed} 件，上方貨物已落下` : `已刪除 ${removed} 件`, 'ok');
}

function deleteItemWithSettle(id) {
  const item = loadsimGetItem(id);
  if (!item) return;
  loadsimDeleteItem(id);
  settleAfterRemoval(1);
}

function deleteMawbWithSettle(mawb) {
  const key = String(mawb || '').trim();
  if (!key) return;
  const ids = loadsimState.items
    .filter(item => String(item.mawb || '').trim() === key)
    .map(item => item.id);
  if (!ids.length) return;
  if (typeof confirm === 'function' &&
    !confirm(`刪除 MAWB「${key}」的所有尺寸（共 ${ids.length} 件）？`)) return;
  loadsimDeleteItems(ids);
  settleAfterRemoval(ids.length);
}

// 讓某件貨物在畫布上「弱弱地閃爍」一段時間（1.8 秒）
function highlightItem(id) {
  const item = loadsimGetItem(id);
  if (!item) return;
  if (!item.placed) {
    // 還沒放上板（在待裝清單）→ 只閃那一行並提示
    const row = els.itemLines && els.itemLines.querySelector(`[data-id="${id}"]`);
    if (row) {
      row.classList.remove('is-flash');
      void row.offsetWidth; // 重新觸發動畫
      row.classList.add('is-flash');
    }
    showToast('這件還沒放上板：可從左邊「待裝」拖進板內，或點一下自動放');
    return;
  }
  loadsimSelect(id);
  const t = nowMs();
  highlight = { id, start: t, end: t + 1800, raf: highlight.raf, frames: 0 };
  if (!highlight.raf) pulseTick();
}

function pulseTick() {
  const t = nowMs();
  highlight.frames = (highlight.frames || 0) + 1;
  // frames 上限是保險：背景分頁／測試環境的 rAF 可能不推進時間
  if (!highlight.id || t >= highlight.end || highlight.frames > 150) {
    highlight = { id: null, start: 0, end: 0, raf: 0, frames: 0 };
    scheduleRender();
    return;
  }
  highlight.raf = requestAnimationFrame(pulseTick);
  scheduleRender();
}

function highlightPhase() {
  if (!highlight.id) return undefined;
  const span = Math.max(1, highlight.end - highlight.start);
  return Math.max(0, Math.min(1, (nowMs() - highlight.start) / span));
}

// ===== 超出輪廓的閃爍（只重畫、不改狀態；沒有出界就停掉）=====
let overflowTimer = 0;

function overflowPhase() {
  return (nowMs() / 1500) % 1;
}

function setOverflowPulse(on) {
  if (on && !overflowTimer) {
    // 只有「本區塊正在顯示」時才啟動計時器（切到別的頁面 / 測試環境不會空轉）
    const section = document.getElementById('section-loadsim');
    if (!section || !section.classList.contains('active')) return;
    overflowTimer = setInterval(() => {
      const el = document.getElementById('section-loadsim');
      if (el && !el.classList.contains('active')) return; // 切走了 → 這一輪跳過
      if (loadsimIsDragging()) return;                    // 拖曳本身每幀已重畫
      scheduleRender();
    }, 60);
  } else if (!on && overflowTimer) {
    clearInterval(overflowTimer);
    overflowTimer = 0;
  }
}

// 單件的出界資訊（明細列顯示＋排序用）：沒有出界回傳 { worst: null, text: '' }
function lineOverflowOf(item) {
  if (!item.placed || item.staged) return { worst: null, text: '' };
  const info = loadsimPlacementInfo(item);
  if (!info || !info.overflows || !info.overflows.length) return { worst: null, text: '' };
  const worst = info.overflows.reduce((a, b) => (b.amount > a.amount ? b : a), info.overflows[0]);
  return {
    worst,
    text: `+${loadsimFormatAmount(worst.amount, loadsimState.unit)} ${loadsimUnitLabel(loadsimState.unit)}`
  };
}

function lineStateRank(item) {
  if (item.staged) return 1;
  return item.placed ? 0 : 2;
}

function lineSortValue(item) {
  if (!item) return 0;
  switch (lineSort.key) {
    case 'name': return String(item.name || '').toLowerCase();
    case 'mawb': return String(item.mawb || '').toLowerCase();
    case 'dims': {
      const d = loadsimDimsOf(item);
      return d.x * d.z * d.y;
    }
    case 'cbm': return loadsimItemCbm(item);
    case 'weight': return Number(item.weight) || 0;
    case 'over': {
      const worst = lineOverflowOf(item).worst;
      return worst ? worst.amount : -1;
    }
    case 'state': return lineStateRank(item);
    default: return Number(item.id) || 0;
  }
}

function lineSortCompare(a, b) {
  const dir = lineSort.dir === 'desc' ? -1 : 1;
  const av = lineSortValue(a);
  const bv = lineSortValue(b);
  if (typeof av === 'string' || typeof bv === 'string') {
    return String(av).localeCompare(String(bv), 'zh-Hant') * dir;
  }
  return (av - bv) * dir;
}

// 以 MAWB 分組：同一個 MAWB 的多種尺寸排在一起（第一列＝parent，其餘＝child）
function lineGroups(items) {
  const map = new Map();
  items.forEach(item => {
    const mawb = String(item.mawb || '').trim();
    const key = mawb ? `m:${mawb}` : `i:${item.id}`;
    if (!map.has(key)) map.set(key, { key, mawb, items: [] });
    map.get(key).items.push(item);
  });
  const groups = [...map.values()];
  groups.forEach(group => group.items.sort(lineSortCompare));
  const dir = lineSort.dir === 'desc' ? -1 : 1;
  groups.sort((a, b) => {
    if (lineSort.key === 'mawb') {
      if (a.mawb && b.mawb) return a.mawb.localeCompare(b.mawb, 'zh-Hant') * dir;
      if (a.mawb) return -1;
      if (b.mawb) return 1;
    }
    return lineSortCompare(a.items[0], b.items[0]);
  });
  return groups;
}

function renderItemLines() {
  const box = els.itemLines;
  if (!box) return;
  const items = loadsimState.items;
  if (!items.length) {
    box.innerHTML = '<div class="loadsim-line-empty">新增貨物後，這裡會列出每一件的尺寸／重量／MAWB 與狀態（點一下 → 畫布上閃爍；右端可刪除單筆尺寸或整個 MAWB）</div>';
    return;
  }
  const unit = loadsimState.unit;
  const label = loadsimUnitLabel(unit);

  const rows = [];
  lineGroups(items).forEach(group => {
    group.items.forEach((item, index) => {
      const isParent = !!group.mawb && index === 0;
      const isChild = !!group.mawb && index > 0;
      const d = loadsimDimsOf(item);
      const dims = `${loadsimFormatNumber(d.x, unit)}×${loadsimFormatNumber(d.z, unit)}×${loadsimFormatNumber(d.y, unit)}`;
      const cbm = loadsimItemCbm(item);
      const state = item.staged ? 'staged' : (item.placed ? 'board' : 'pending');
      const stateText = item.staged ? '暫存' : (item.placed ? '板上' : '待裝');
      const over = lineOverflowOf(item);
      const classes = [
        'loadsim-line',
        `is-${state}`,
        over.worst ? 'is-overflow' : '',
        isParent ? 'is-parent' : '',
        isChild ? 'is-child' : '',
        item.id === loadsimState.selectedId ? 'is-selected' : ''
      ].filter(Boolean).join(' ');
      rows.push(`
      <div class="${classes}" data-id="${item.id}"${group.mawb ? ` data-mawb="${esc(group.mawb)}"` : ''}
        role="button" tabindex="0" style="--loadsim-color:${esc(item.color)}"
        title="點一下 → 在畫布上閃爍標示${over.text ? `（出界 ${over.text}）` : ''}">
        <span class="loadsim-line-dot"></span>
        <span class="loadsim-line-id">#${item.id}</span>
        <span class="loadsim-line-name">${isChild ? '↳ ' : ''}${esc(item.name)}</span>
        <span class="loadsim-line-mawb">${isParent ? esc(group.mawb) : ''}</span>
        <span class="loadsim-line-dims">${dims} ${label}</span>
        <span class="loadsim-line-cbm">${cbm.toFixed(3)}</span>
        <span class="loadsim-line-kg">${fmtKg(item.weight)}</span>
        <span class="loadsim-line-over">${over.text}</span>
        <span class="loadsim-line-state">${stateText}</span>
        <span class="loadsim-line-actions">
          <button type="button" class="loadsim-line-del" data-action="delete-item" title="刪除這一筆尺寸">✕</button>
          ${isParent
            ? `<button type="button" class="loadsim-line-del" data-action="delete-mawb" title="刪除整個 MAWB（${esc(group.mawb)}）的所有尺寸">🗑</button>`
            : ''}
        </span>
      </div>`);
    });
  });

  // 排序圖示用 FontAwesome（fa-sort / fa-sort-up / fa-sort-down），比文字箭頭更好懂
  const sortIcon = key => {
    if (lineSort.key !== key) return '<i class="fa-solid fa-sort loadsim-sort-icon" aria-hidden="true"></i>';
    return lineSort.dir === 'desc'
      ? '<i class="fa-solid fa-sort-down loadsim-sort-icon" aria-hidden="true"></i>'
      : '<i class="fa-solid fa-sort-up loadsim-sort-icon" aria-hidden="true"></i>';
  };
  const sortBtn = (key, text) => `
    <button type="button" class="loadsim-sort${lineSort.key === key ? ' is-active' : ''}" data-sort="${key}"
      title="依「${text}」排序（再按一次切換升冪／降冪）">${text}${sortIcon(key)}</button>`;

  box.innerHTML = `
    <div class="loadsim-line-head">
      <span></span>
      <span>${sortBtn('id', '#')}</span>
      <span>${sortBtn('name', '名稱')}</span>
      <span>${sortBtn('mawb', 'MAWB')}</span>
      <span>${sortBtn('dims', '尺寸（長×寬×高）')}</span>
      <span>${sortBtn('cbm', 'CBM')}</span>
      <span>${sortBtn('weight', '重量')}</span>
      <span>${sortBtn('over', '出界')}</span>
      <span>${sortBtn('state', '狀態')}</span>
      <span></span>
    </div>
    ${rows.join('')}`;
}

// ===== 畫面更新（清單 / 摘要 / 畫布）=====
function refreshUi() {
  renderPendingList();
  renderItemLines();
  renderSummary();
  syncEditingState();
  syncOptionInputs();
  if (els.select) els.select.value = loadsimState.uldCode;
  if (els.toggleOverhang) els.toggleOverhang.checked = !loadsimState.allowOverhang;
  if (els.toggleSupport) els.toggleSupport.checked = !!loadsimState.requireSupport;
  if (els.supportMin) {
    els.supportMin.value = String(loadsimState.supportMinPct === undefined ? 50 : loadsimState.supportMinPct);
  }
}

function renderPendingList() {
  const list = els.pending;
  if (!list) return;
  const pending = loadsimPendingItems();
  const unit = loadsimState.unit;

  if (!pending.length) {
    list.innerHTML = '<div class="loadsim-empty">沒有待裝貨物<br><small>在上面輸入尺寸 → 按「＋ 產生貨物」</small></div>';
    return;
  }

  list.innerHTML = pending.map(item => {
    const d = loadsimDimsOf(item);
    const dims = `${loadsimFormatNumber(d.x, unit)}×${loadsimFormatNumber(d.z, unit)}×${loadsimFormatNumber(d.y, unit)}`;
    return `
      <div class="loadsim-item-card" data-id="${item.id}" style="--loadsim-color:${esc(item.color)}" title="拖到右邊板內，或點一下自動放置">
        <span class="loadsim-dot"></span>
        <div class="loadsim-card-main">
          <strong>${esc(item.name)}</strong>
          <small>${dims} ${loadsimUnitLabel(unit)} · ${fmtKg(item.weight)}</small>
        </div>
        <button type="button" class="loadsim-icon-btn" data-action="rotate" title="旋轉 90°（或按 R）">⟳</button>
        <button type="button" class="loadsim-icon-btn" data-action="remove" title="刪除這件">✕</button>
      </div>`;
  }).join('');
}

// 出界摘要文字：「#2 後端 +32 cm、#5 右側 +4 cm」；超過 3 件只列前 3 件（量最多的），後面補「等 N 件」
function overflowDetailText(overItems, unit) {
  const unitLabel = loadsimUnitLabel(unit);
  const sorted = overItems.slice().sort((a, b) => b.amount - a.amount);
  const parts = sorted.slice(0, 3).map(row =>
    `#${row.id} ${row.label} +${loadsimFormatAmount(row.amount, unit)} ${unitLabel}`);
  return sorted.length > 3 ? `${parts.join('、')} 等 ${sorted.length} 件` : parts.join('、');
}

function renderSummary() {
  const topBox = els.summaryTop;
  const noteBox = els.summary;
  if (!topBox && !noteBox) return;
  const spec = currentSpec();
  const summary = loadsimSummarize(loadsimState, spec);
  const level = loadsimWeightLevel(summary);
  const unit = loadsimState.unit;

  const pct = summary.maxKg ? Math.min(100, Math.round(summary.ratio * 100)) : 0;
  const maxText = summary.maxKg ? fmtKg(summary.maxKg) : '未設定';

  // 超出輪廓統計（暫存的貨物不算）：同時記下每件「出界最多」的方位與量
  const placed = loadsimBoardItems();
  const overItems = [];
  placed.forEach(item => {
    const info = loadsimPlacementInfo(item);
    if (!info || !info.overflows.length) return;
    const worst = info.overflows.reduce((a, b) => (b.amount > a.amount ? b : a), info.overflows[0]);
    overItems.push({ id: item.id, label: worst.label, amount: worst.amount });
  });
  const overCount = overItems.length;
  // 有出界就開始「弱弱地閃爍」，沒有就停掉
  setOverflowPulse(overCount > 0);

  const bannerClass = level === 'over' ? 'over' : (level === 'warn' || overCount ? 'warn' : '');
  const bannerText = level === 'over'
    ? `⚠ 超出板型最大總重 ${fmtKg(summary.overKg)}（目前 ${fmtKg(summary.totalKg)} / 上限 ${fmtKg(summary.maxKg)}）`
    : (overCount
      ? `⚠ ${overCount} 件貨物超出 Contour 輪廓：${overflowDetailText(overItems, unit)}（紅色區域會閃爍）`
      : (summary.heavy.length
        ? `⚠ ${summary.heavy.length} 件超過單件上限 ${fmtKg(summary.maxKgLimit)}`
        : ''));

  const rowHtml = `
    <div class="loadsim-summary-row">
      <span class="loadsim-chip">已裝 <strong>${summary.count}</strong> 件</span>
      <span class="loadsim-chip">待裝 <strong>${summary.pendingCount}</strong> 件</span>
      ${summary.stagedCount
        ? `<span class="loadsim-chip loadsim-chip-staged">暫存 <strong>${summary.stagedCount}</strong> 件（${fmtKg(summary.stagedKg)}，不計入板重）</span>`
        : ''}
      <span class="loadsim-chip">貨重 <strong>${fmtKg(summary.cargoKg)}</strong></span>
      <span class="loadsim-chip">板重 <strong>${fmtKg(summary.tareKg)}</strong></span>
      <span class="loadsim-chip loadsim-chip-weight ${level}">總重 <strong>${fmtKg(summary.totalKg)}</strong> / ${maxText}</span>
      <div class="loadsim-progress ${level}" title="重量使用率"><span style="width:${pct}%"></span></div>
      <span class="loadsim-chip">容積利用率 <strong>${summary.utilPct.toFixed(0)}%</strong>（${summary.cbm.toFixed(2)} CBM）</span>
    </div>`;
  const bannerHtml = bannerText
    ? `<div class="loadsim-banner ${bannerClass}">${esc(bannerText)}</div>`
    : '';
  const noteHtml = `
    <div class="loadsim-summary-note">
      ${spec.note ? `板型：${esc(spec.code)}｜${esc(spec.note)}` : `板型：${esc(spec.code)}｜${esc(spec.name)}`}
      ${spec.maxGrossKg ? '' : '｜最大總重未設定，請按「板型設定」填寫'}
      ｜長度單位：${loadsimUnitLabel(unit)}｜重量：kg
    </div>
    ${spec.flared
      ? `<div class="loadsim-summary-note">板面（貼地）：${fmtLen(spec.floorL)} × ${fmtLen(spec.floorW)}｜輪廓上限：${fmtLen(spec.baseL)} × ${fmtLen(spec.baseW)}（貼地以外的外擴區需疊高才能使用）</div>`
      : ''}`;

  // 件數／重量／警示放在「畫布」與「貨物明細列」之間（看明細時就看得到），
  // 板型說明與單位註記留在底部摘要區；舊版 HTML 沒有 #loadsim-summary-top 時全部退回底部。
  if (topBox) {
    topBox.innerHTML = rowHtml + bannerHtml;
    if (noteBox) noteBox.innerHTML = noteHtml;
  } else if (noteBox) {
    noteBox.innerHTML = rowHtml + bannerHtml + noteHtml;
  }
}

function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    renderCanvas();
  });
}

// ===== 效能診斷 HUD（?loadsim-debug=1 或 localStorage loadsim-debug=1）=====
// 用途：拖曳不順時先分辨是「每幀太慢（FPS 低）」還是「畫面在抖（FPS 正常）」。
function debugEnabled() {
  try {
    if (typeof location !== 'undefined' && location.search &&
      new URLSearchParams(location.search).get('loadsim-debug') === '1') return true;
    return localStorage.getItem('loadsim-debug') === '1';
  } catch (err) {
    return false;
  }
}

let debugEl = null;
let debugStats = { frames: 0, drawMs: 0, last: 0 };

function updateDebugHud(drawMs, interacting) {
  if (!debugEnabled()) return;
  const stage = els.canvas && els.canvas.parentElement;
  if (!stage) return;
  if (!debugEl) {
    debugEl = document.createElement('div');
    debugEl.className = 'loadsim-debug';
    stage.appendChild(debugEl);
  }
  const now = performance.now();
  if (!debugStats.last) debugStats.last = now;
  debugStats.frames += 1;
  debugStats.drawMs += drawMs;
  if (now - debugStats.last < 400) return;
  const fps = Math.round((debugStats.frames * 1000) / Math.max(1, now - debugStats.last));
  const avgDraw = debugStats.drawMs / debugStats.frames;
  debugEl.textContent =
    `${fps} FPS ／ 繪製 ${avgDraw.toFixed(1)} ms ／ ${loadsimPlacedItems().length} 件` +
    `${interacting ? '（互動 LOD）' : ''}`;
  debugStats = { frames: 0, drawMs: 0, last: now };
}

function renderCanvas() {
  const canvas = els.canvas;
  if (!canvas) return;
  // 效能：尺寸只在必要時量（ResizeObserver / 縮放 / 切換區塊），
  // 避免每一幀都 getBoundingClientRect() 觸發強制 reflow。
  if (stageSize.dirty || !stageSize.w || !stageSize.h) measureStageSize();
  const cssW = Math.max(240, stageSize.w || 240);
  const cssH = Math.max(240, stageSize.h || 240);

  // 互動中（拖曳貨物／轉視角）：凍結取景＋降低細節＋降低解析度，讓每幀成本與畫面都穩定
  const dragMode = loadsimGetDragMode();
  const interacting = !!dragMode;
  // 效能：互動中把 DPR 上限降到 1.25（文字已在 LOD 關閉，畫質差異小，
  // 但 4K / Retina 上填色像素少 2～4 倍 → 拖曳明顯更順）
  const dpr = Math.min(interacting ? 1.25 : 2, window.devicePixelRatio || 1);
  const pxW = Math.round(cssW * dpr);
  const pxH = Math.round(cssH * dpr);
  if (canvas.width !== pxW || canvas.height !== pxH) {
    canvas.width = pxW;
    canvas.height = pxH;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const started = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;
  loadsimDraw({
    ctx,
    width: cssW,
    height: cssH,
    spec: currentSpec(),
    unit: loadsimState.unit,
    items: loadsimState.items,
    preview: loadsimGetPreview(),
    hoverId: loadsimGetHoverId(),
    selectedId: loadsimState.selectedId,
    allowOverhang: loadsimState.allowOverhang,
    requireSupport: loadsimState.requireSupport,
    supportMinPct: loadsimState.supportMinPct,
    supportAreaEnabled: loadsimState.supportAreaEnabled,
    highlightId: highlight.id,
    highlightPhase: highlightPhase(),
    overflowPhase: overflowPhase(),
    lod: interacting,
    // 搬貨物／轉視角：距離只拉遠不拉近（避免抖動與呼吸式縮放）；
    // 轉視角另開 snapFrame 讓「平移」每幀重算，否則板子與貨物會被推出畫布外
    freezeFrame: !!dragMode,
    snapFrame: dragMode === 'orbit'
  });
  const drawMs = started ? performance.now() - started : 0;

  updateDebugHud(drawMs, interacting);

  // 閒置時取景採平滑收合 → 還在收斂就再排一幀
  if (loadsimIsFrameSettling()) scheduleRender();
}


// ===== 小提示（toast）=====
let toastTimer = null;
function showToast(message, kind) {
  const el = els.toast;
  if (!el) return;
  el.textContent = message;
  el.className = `loadsim-toast visible${kind ? ' ' + kind : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'loadsim-toast'; }, 2800);
}

// ===== Contour 原圖（沿用 routes/contours.js 的圖片 API）=====
function showContourImage() {
  const spec = currentSpec();
  const url = loadsimSpecImageUrl(spec);
  const notes = [spec.name, spec.aircraft, spec.note, spec.weightNote]
    .filter(Boolean)
    .map(text => `<p class="loadsim-modal-note">${esc(text)}</p>`)
    .join('');
  const body = `
    <div class="loadsim-modal-image">
      <img src="${esc(url)}" alt="${esc(spec.code)} contour" />
    </div>
    ${notes}`;

  if (typeof openModal === 'function') {
    openModal({
      title: `🖼 ${esc(spec.code)} Contour 規格圖`,
      body,
      actions: [{ label: '關閉', className: 'pill' }],
      className: 'loadsim-modal'
    });
  } else {
    window.open(url, '_blank');
  }
}

// ===== 板型設定（尺寸 / 重量上限；存 localStorage，可還原）=====
function openSpecEditor() {
  if (typeof openModal !== 'function') return;
  const base = loadsimBaseSpec(loadsimState.uldCode);
  const spec = currentSpec();
  const unit = loadsimState.unit;
  const step = loadsimInputStep(unit);
  const min = loadsimInputMin(unit);

  const body = document.createElement('div');
  body.className = 'loadsim-spec-form';
  const floorNote = spec.flared
    ? `<p class="loadsim-modal-note">本板型為外擴型：貼地（板面）${loadsimFormatNumber(spec.floorL, unit)}×${loadsimFormatNumber(spec.floorW, unit)} ${loadsimUnitLabel(unit)}，輪廓上限 ${loadsimFormatNumber(spec.baseL, unit)}×${loadsimFormatNumber(spec.baseW, unit)} ${loadsimUnitLabel(unit)}。下面三個欄位改的是「輪廓上限」。</p>`
    : '';
  body.innerHTML = `
    <p class="loadsim-modal-note">這裡的修改只影響本機（存 localStorage），按「還原內建值」可回到原始規格。</p>
    ${floorNote}
    <label>輪廓長 X
      <input id="loadsim-spec-l" type="number" min="${min}" step="${step}" value="${loadsimFormatNumber(spec.baseL, unit)}" />
      <span>${loadsimUnitLabel(unit)}</span>
    </label>
    <label>輪廓寬 Z
      <input id="loadsim-spec-w" type="number" min="${min}" step="${step}" value="${loadsimFormatNumber(spec.baseW, unit)}" />
      <span>${loadsimUnitLabel(unit)}</span>
    </label>
    <label>高度 Y
      <input id="loadsim-spec-h" type="number" min="${min}" step="${step}" value="${loadsimFormatNumber(spec.heightCm, unit)}" />
      <span>${loadsimUnitLabel(unit)}</span>
    </label>
    <label>最大總重
      <input id="loadsim-spec-max" type="number" min="0" step="1" value="${spec.maxGrossKg ? spec.maxGrossKg : ''}" placeholder="未設定" />
      <span>kg</span>
    </label>
    <label>板重 (tare)
      <input id="loadsim-spec-tare" type="number" min="0" step="1" value="${spec.tareKg || ''}" placeholder="0" />
      <span>kg</span>
    </label>
    ${base.weightNote ? `<p class="loadsim-modal-note">${esc(base.weightNote)}</p>` : ''}
    <p class="loadsim-modal-note">改了長／寬／高之後，原有收角（斜切）輪廓會改以矩形計算，避免對不上實際尺寸。</p>
  `;

  const modal = openModal({
    title: `⚙ ${esc(base.code)} 板型設定`,
    body,
    actions: [
      { label: '儲存', className: 'pill btn-primary', onClick: () => saveSpecOverride(body, modal) },
      { label: '還原內建值', className: 'pill', onClick: () => resetSpecOverride(modal) },
      { label: '取消', className: 'pill' }
    ],
    className: 'loadsim-modal'
  });
}

function saveSpecOverride(body, modal) {
  const unit = loadsimState.unit;
  const readNumber = id => parseFloat((body.querySelector(`#${id}`) || {}).value);
  const toCm = value => (isFinite(value) ? loadsimUnitToCm(value, unit) : '');

  const override = {
    baseL: toCm(readNumber('loadsim-spec-l')),
    baseW: toCm(readNumber('loadsim-spec-w')),
    heightCm: toCm(readNumber('loadsim-spec-h')),
    maxGrossKg: isFinite(readNumber('loadsim-spec-max')) ? readNumber('loadsim-spec-max') : '',
    tareKg: isFinite(readNumber('loadsim-spec-tare')) ? readNumber('loadsim-spec-tare') : ''
  };

  if (!(override.baseL > 0) || !(override.baseW > 0) || !(override.heightCm > 0)) {
    showToast('長 / 寬 / 高 必須大於 0');
    return;
  }

  loadsimState.specOverrides[loadsimState.uldCode] = override;
  loadsimSave();
  if (modal && modal.close) modal.close();
  buildUldSelect();
  refreshUi();
  scheduleRender();
  showToast('板型設定已更新', 'ok');
}

function resetSpecOverride(modal) {
  delete loadsimState.specOverrides[loadsimState.uldCode];
  loadsimSave();
  if (modal && modal.close) modal.close();
  buildUldSelect();
  refreshUi();
  scheduleRender();
  showToast('已還原內建規格', 'ok');
}

// ===== 掛載到 window（供 main.js 呼叫，與 pallet.js 同一種模式）=====
window.setupLoadsimSection = setupLoadsimSection;

// 主題切換時重畫（畫布顏色取自 CSS 變數）
if (typeof MutationObserver === 'function') {
  new MutationObserver(() => scheduleRender()).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme', 'style']
  });
}

