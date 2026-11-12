// ===== ULD 夾重系統：前端狀態 =====
// 一張夾重表 = { 表頭欄位..., ulds: [ { uid, items: [ { uid, ... } ] } ] }
// uid 只用在前端（DB id 可能重複出現於不同單位，故統一用 uid 定位）
import {
  uldComputeSheet, uldSplitByPcs, uldNum, uldMawbKey, uldApplyMawbAllocation, uldAllocateWithFixed,
  uldLihCodes, uldLihToggle
} from './calc.js';

export const uldWeightState = {
  view: 'list',        // list | editor
  sheets: [],          // 清單
  current: null,       // 目前編輯中的夾重表
  selectedUid: null,   // 目前選取的收貨單位
  dirty: false,
  busy: false,
  error: '',
  listFilter: { search: '', status: '' },
  batchSelected: [],   // V2：清單頁勾選要批次下載 PDF 的夾重表 id（重新載入清單時會剔除已不存在的 id）
  contourOptions: [],  // 板型（Contour）建議清單，由入口 loadsim/uld-specs.js 動態填入
  rclImport: null,     // W3：RCL 磅單匯入的預覽狀態（null = 沒有在匯入）
  // V3：版本紀錄面板（每次儲存／鎖定／套用／補建都會留一份快照）
  versions: { open: false, loading: false, list: [], error: '' },
  versionDiff: null,   // V3：目前顯示的版本比對結果（null = 沒有在比對）
  // U1／U2：畫面上的「顯示狀態」（不進 payload、不影響計算）
  //   step       ：編輯流程（build＝① MAWB LIST／② ULD LIST 建檔頁；merge＝③ 合併／分配頁）
  //   view       ：建檔頁版面（cards＝直覺清單／grid＝CHARTER LOADING SHEET 載荷表）
  //   gridSortMawb：載荷表是否依 MAWB# 排序（只影響顯示，不寫回資料）
  //   more     ：「⋯ 更多」動作選單是否展開
  //   advanced ：「⚙ 進階」表頭欄位（B 取整／尾差／磅差門檻／比例上下限）是否展開
  //   expanded  ：哪些收貨單位卡片展開次要欄位（{ [uid]: true }）
  //   allCompact：卡片太多時全部收合（只留摘要）
  //   printUnit ：只印這一張卡（列印時用；null = 印全部）
  //   mergePick ：合併頁目前點選的 MAWB 申報列（uid；null = 沒有）
  ui: {
    step: 'build',
    view: 'cards',
    gridSortMawb: false,
    more: false,
    advanced: false,
    expanded: {},
    expandAll: false,
    printUnit: null,
    mergePick: null
  }
};

// U2：收貨單位（板）數量上限（業界實務：一台包機最多約 41 板）
export const ULD_MAX_UNITS = 41;

// U2：把收貨單位搬到另一個單位的前／後（拖曳排序用；只改順序，不影響計算）
export function uldMoveUnit(fromUid, toUid, placeAfter = false) {
  const sheet = uldWeightState.current;
  if (!sheet || !Array.isArray(sheet.ulds)) return false;
  if (!fromUid || !toUid || fromUid === toUid) return false;
  const list = sheet.ulds;
  const fromIdx = list.findIndex(u => u.uid === fromUid);
  const toIdx = list.findIndex(u => u.uid === toUid);
  if (fromIdx < 0 || toIdx < 0) return false;
  const [moved] = list.splice(fromIdx, 1);
  let insertAt = list.findIndex(u => u.uid === toUid);
  if (insertAt < 0) insertAt = list.length;
  if (placeAfter) insertAt += 1;
  list.splice(insertAt, 0, moved);
  return true;
}

let tempSeq = 1;
export function uldTempId(prefix = 't') {
  const id = `${prefix}${Date.now().toString(36)}${(tempSeq++).toString(36)}`;
  return id;
}

// 新增收貨單位（P/X = ULD；B = 散貨）
export function uldNewUnit(kind = 'ULD') {
  return {
    uid: uldTempId('u'),
    id: null,
    kind: kind === 'BULK' ? 'BULK' : 'ULD',
    uld_number: '',
    bulk_ref: '',
    rcl_no: '',
    contour_code: '',
    port: '',
    pcs: 0,
    tare_weight: kind === 'BULK' ? 0 : 0,
    rcl_gross_weight: 0,
    material_weight: 0,
    lih_type: 'N',
    predecl_type: kind === 'BULK' ? 'B' : 'P',
    squeeze_mode: 'weight',
    items: [],
    draft: { mawb: '', mawb_record_id: null, port: '', pcs: '', declared_weight: '', lih_type: 'N' }
  };
}

export function uldNewItem(values = {}) {
  return {
    uid: uldTempId('i'),
    id: null,
    mawb: '',
    mawb_record_id: null,
    port: '',
    pcs: 0,
    declared_weight: 0,
    is_squeeze: false,
    squeeze_ratio: null,
    lih_type: 'N',
    ...values
  };
}

// 方案 B：新增一票「MAWB 申報列」（載荷表左邊那一列）
// auto_alloc：1 = 依件數自動把申報重量分到各板（預設）；0 = 保留各板自填重量
export function uldNewMawb(values = {}) {
  return {
    uid: uldTempId('m'),
    id: null,
    seq: null,
    mawb: '',
    mawb_record_id: null,
    dest: '',
    pcs: 0,
    declared_weight: 0,
    wh_ref: '',
    auto_alloc: 1,
    is_squeeze: false,
    ...values
  };
}

// 新 UI：重量一律 kg；allow_half_kg = 0 → 只以整數運算（0.5 會四捨五入）
function sheetAllowsHalf(sheet) {
  return Number(sheet && sheet.allow_half_kg) === 1;
}
function roundWeight(value, allowHalf) {
  const n = Math.max(0, uldNum(value));
  return allowHalf ? Math.round(n * 2) / 2 : Math.round(n);
}

// API 回傳的明細 → 編輯用狀態
export function uldSheetFromApi(detail) {
  if (!detail) return null;
  const allowHalf = sheetAllowsHalf(detail);
  return {
    id: detail.id,
    sheet_no: detail.sheet_no,
    sheet_date: detail.sheet_date || '',
    terminal: detail.terminal || 'CPSL',
    flight_no: detail.flight_no || '',
    flight_date: detail.flight_date || '',
    round_px: detail.round_px || 1,
    round_b: detail.round_b || 1,
    // 新 UI：允許使用 0.5kg（0 = 全部整數）
    allow_half_kg: allowHalf ? 1 : 0,
    tail_mode: detail.tail_mode || 'adjust_largest',
    // W5：磅差警示門檻（% 與 kg 需「同時」超過才提示）；舊資料／未設定 → 2% / 100kg
    diff_warn_pct: detail.diff_warn_pct == null || uldNum(detail.diff_warn_pct) <= 0 ? 2 : uldNum(detail.diff_warn_pct),
    diff_warn_kg: detail.diff_warn_kg == null || uldNum(detail.diff_warn_kg) <= 0 ? 100 : uldNum(detail.diff_warn_kg),
    // R2：多票夾重比例上下限（%；0 = 不限；舊資料沒有這兩個欄位）
    clamp_min_pct: uldNum(detail.clamp_min_pct) > 0 ? uldNum(detail.clamp_min_pct) : 0,
    clamp_max_pct: uldNum(detail.clamp_max_pct) > 0 ? uldNum(detail.clamp_max_pct) : 0,
    handler: detail.handler || '',
    remark: detail.remark || '',
    status: detail.status || 'draft',
    // 方案 B：MAWB 申報列（舊資料後端會用明細彙總自動長出來；auto_alloc = 0 保留原重量）
    mawbs: (detail.mawb_rows || []).map(row => ({
      ...row,
      uid: uldTempId('m'),
      declared_weight: roundWeight(row.declared_weight, allowHalf),
      is_squeeze: !!row.is_squeeze,
      auto_alloc: Number(row.auto_alloc) === 0 ? 0 : 1
    })),
    ulds: (detail.ulds || []).map(unit => ({
      ...unit,
      uid: unit.uid || `u${unit.id}`,
      tare_weight: roundWeight(unit.tare_weight, allowHalf),
      rcl_gross_weight: roundWeight(unit.rcl_gross_weight, allowHalf),
      material_weight: roundWeight(unit.material_weight, allowHalf),
      items: (unit.items || []).map(item => ({
        ...item,
        uid: uldTempId('i'),
        declared_weight: roundWeight(item.declared_weight, allowHalf),
        is_squeeze: !!item.is_squeeze,
        squeeze_ratio: item.squeeze_ratio == null ? null : uldNum(item.squeeze_ratio)
      })),
      draft: { mawb: '', mawb_record_id: null, port: '', pcs: '', declared_weight: '', lih_type: 'N' }
    }))
  };
}

// 編輯用狀態 → PUT payload（只送原始輸入，尾差/取整交給後端與 calc 重算）
// 代號類欄位一律轉大寫（ULD#／Contour／RCL#／Port／MAWB），避免大小寫混雜造成重複或比對失敗
function upperText(value) {
  return String(value == null ? '' : value).toUpperCase();
}

export function uldSheetPayload(sheet) {
  // 方案 B：先把申報列的重量依件數分回各板（auto_alloc），再組 payload，
  // 確保「存進 DB 的重量」與「畫面／載荷表算的」完全一致。
  uldApplyMawbAllocation(sheet);
  const allowHalf = sheetAllowsHalf(sheet);
  return {
    sheet_date: sheet.sheet_date,
    terminal: sheet.terminal,
    flight_no: sheet.flight_no,
    flight_date: sheet.flight_date,
    round_px: uldNum(sheet.round_px) || 1,
    round_b: uldNum(sheet.round_b) || 1,
    // 新 UI：允許使用 0.5kg（0 = 全部整數）
    allow_half_kg: allowHalf ? 1 : 0,
    tail_mode: sheet.tail_mode,
    diff_warn_pct: uldNum(sheet.diff_warn_pct) > 0 ? uldNum(sheet.diff_warn_pct) : 2,
    diff_warn_kg: uldNum(sheet.diff_warn_kg) > 0 ? uldNum(sheet.diff_warn_kg) : 100,
    // R2：比例上下限（0 = 不限）
    clamp_min_pct: uldNum(sheet.clamp_min_pct) > 0 ? uldNum(sheet.clamp_min_pct) : 0,
    clamp_max_pct: uldNum(sheet.clamp_max_pct) > 0 ? uldNum(sheet.clamp_max_pct) : 0,
    handler: sheet.handler,
    remark: sheet.remark,
    // 方案 B：MAWB 申報列（帶既有 id → 後端做 diff 更新）
    mawb_rows: (sheet.mawbs || []).map(row => ({
      id: row.id || null,
      mawb: upperText(row.mawb),
      mawb_record_id: row.mawb_record_id || null,
      dest: upperText(row.dest),
      pcs: uldNum(row.pcs),
      declared_weight: roundWeight(row.declared_weight, allowHalf),
      wh_ref: row.wh_ref || '',
      auto_alloc: Number(row.auto_alloc) === 0 ? 0 : 1,
      is_squeeze: row.is_squeeze ? 1 : 0
    })),
    ulds: (sheet.ulds || []).map(unit => ({
      // R3：帶回既有 DB id → 後端可做 diff 更新（null／不存在＝新增）
      id: unit.id || null,
      kind: unit.kind,
      uld_number: upperText(unit.uld_number),
      bulk_ref: unit.bulk_ref,
      rcl_no: upperText(unit.rcl_no),
      contour_code: upperText(unit.contour_code),
      port: upperText(unit.port),
      pcs: uldNum(unit.pcs),
      tare_weight: roundWeight(unit.tare_weight, allowHalf),
      rcl_gross_weight: roundWeight(unit.rcl_gross_weight, allowHalf),
      material_weight: roundWeight(unit.material_weight, allowHalf),
      lih_type: unit.lih_type,
      predecl_type: unit.predecl_type,
      squeeze_mode: unit.squeeze_mode,
      items: (unit.items || []).map(item => ({
        // R3：明細的既有 DB id（null＝新增）
        id: item.id || null,
        mawb: upperText(item.mawb),
        mawb_record_id: item.mawb_record_id || null,
        port: upperText(item.port),
        pcs: uldNum(item.pcs),
        declared_weight: roundWeight(item.declared_weight, allowHalf),
        is_squeeze: item.is_squeeze ? 1 : 0,
        squeeze_ratio: item.squeeze_ratio,
        lih_type: item.lih_type
      }))
    }))
  };
}

// 目前夾重表的即時計算結果
// 方案 B：先依 MAWB 申報列把重量分回各板（只動 auto_alloc 的列），再算夾重。
export function uldComputed() {
  const sheet = uldWeightState.current || {};
  uldApplyMawbAllocation(sheet);
  return uldComputeSheet(sheet);
}

export function uldFindUnit(uid) {
  return (uldWeightState.current && uldWeightState.current.ulds || [])
    .find(unit => unit.uid === uid) || null;
}

// ===== 方案 B：MAWB 申報列的輔助函式 =====
export function uldFindMawb(uid) {
  return ((uldWeightState.current && uldWeightState.current.mawbs) || [])
    .find(row => row.uid === uid) || null;
}

// 一票申報列分佈在哪些板（跨板）
export function uldRowItems(row) {
  const sheet = uldWeightState.current;
  if (!sheet || !row) return [];
  const key = uldMawbKey(row.mawb);
  if (!key) return [];
  const out = [];
  (sheet.ulds || []).forEach(unit => {
    (unit.items || []).forEach(item => {
      if (uldMawbKey(item.mawb) === key) out.push({ unit, item });
    });
  });
  return out;
}

// 確保某板有這票的明細（在載荷表直接輸入件數時用；沒有就建一筆）
export function uldEnsureItem(unitUid, row, values = {}) {
  const unit = uldFindUnit(unitUid);
  if (!unit || !row) return null;
  const key = uldMawbKey(row.mawb);
  if (!key) return null;
  if (!Array.isArray(unit.items)) unit.items = [];
  let item = unit.items.find(it => uldMawbKey(it.mawb) === key);
  if (!item) {
    item = uldNewItem({
      mawb: row.mawb,
      port: row.dest,
      mawb_record_id: row.mawb_record_id || null,
      pcs: 0,
      declared_weight: 0,
      is_squeeze: !!row.is_squeeze,
      ...values
    });
    unit.items.push(item);
  }
  return item;
}

// ===== 新 UI：ULD LIST 的 LIH 狀態（NIL／3481／3091 可多選）=====
export function uldUnitLihCodes(unit) {
  return uldLihCodes(unit && unit.lih_type);
}

// 切換一張 ULD 的 LIH；`NIL` ＝ 清空（存回 `N`）
export function uldToggleUnitLih(unit, code) {
  if (!unit) return 'N';
  const next = uldLihToggle(unit.lih_type, code);
  unit.lih_type = next;
  return next;
}

// 一票 MAWB 目前被分到哪些板（回傳 item 清單）
export function uldMawbLinks(row) {
  const sheet = uldWeightState.current;
  if (!sheet || !row) return [];
  const key = uldMawbKey(row.mawb);
  if (!key) return [];
  const links = [];
  (sheet.ulds || []).forEach(unit => {
    (unit.items || []).forEach(item => {
      if (uldMawbKey(item.mawb) === key) links.push({ unit, item });
    });
  });
  return links;
}

// 一票 MAWB 已分配的件數（各板 items 的 pcs 合計）
export function uldMawbAssignedPcs(row) {
  return uldMawbLinks(row).reduce((sum, link) => sum + Math.max(0, uldNum(link.item.pcs)), 0);
}

// ===== 新 UI：合併頁（MAWB LIST × ULD LIST）=====
// 把一票 MAWB 指派到某個 ULD：
//   - 這一板已經有同一票 → 不重複加（回 exists）
//   - pcs 沒指定 → 帶入「還沒分配的件數」（申報 PCS − 各板已分件數）
//   - 重量沿用申報列（auto_alloc 會依件數自動分）
export function uldAssignMawbToUnit(rowUid, unitUid, pcs = null) {
  const sheet = uldWeightState.current;
  if (!sheet) return { ok: false, reason: 'no-sheet' };
  const row = uldFindMawb(rowUid);
  const unit = uldFindUnit(unitUid);
  if (!row || !unit) return { ok: false, reason: 'missing' };
  const key = uldMawbKey(row.mawb);
  if (!key) return { ok: false, reason: 'no-mawb' };
  if ((unit.items || []).some(item => uldMawbKey(item.mawb) === key)) {
    return { ok: false, reason: 'exists', unit, row };
  }
  const assigned = uldMawbAssignedPcs(row);
  const remaining = Math.max(0, uldNum(row.pcs) - assigned);
  const value = pcs == null
    ? (remaining > 0 ? remaining : 0)
    : Math.max(0, Math.round(uldNum(pcs)));
  // 從合併頁指派＝用件數自動分重量（舊資料 auto_alloc = 0 會讓新明細重量停在 0）
  if (Number(row.auto_alloc) === 0) row.auto_alloc = 1;
  const item = uldEnsureItem(unitUid, row, {
    pcs: value,
    declared_weight: 0, // 由申報列依件數分配
    is_squeeze: !!row.is_squeeze,
    // 新 UI：LIH 是 ULD 的狀態；只有單一 UN 時順便帶到新明細（組合值留給使用者自己標）
    lih_type: uldLihCodes(unit.lih_type).length === 1 ? uldLihCodes(unit.lih_type)[0] : 'N'
  });
  if (!item) return { ok: false, reason: 'failed' };
  return { ok: true, item, unit, row, pcs: value, remaining: Math.max(0, remaining - value) };
}

// 把某板的明細搬到另一個 ULD（合併頁拖曳用）
// 目標板已有同一票 → 不搬（避免重複列；回 exists）
export function uldMoveItemToUnit(fromUnitUid, itemUid, toUnitUid) {
  const sheet = uldWeightState.current;
  if (!sheet) return { ok: false, reason: 'no-sheet' };
  if (!fromUnitUid || !toUnitUid || fromUnitUid === toUnitUid) return { ok: false, reason: 'same' };
  const from = uldFindUnit(fromUnitUid);
  const to = uldFindUnit(toUnitUid);
  if (!from || !to) return { ok: false, reason: 'missing' };
  const item = (from.items || []).find(it => it.uid === itemUid);
  if (!item) return { ok: false, reason: 'no-item' };
  const key = uldMawbKey(item.mawb);
  if (!key) return { ok: false, reason: 'no-mawb' };
  if ((to.items || []).some(it => uldMawbKey(it.mawb) === key)) {
    return { ok: false, reason: 'exists', item, unit: to };
  }
  if (!Array.isArray(to.items)) to.items = [];
  to.items.push(item);
  from.items = (from.items || []).filter(it => it.uid !== itemUid);
  // 跨板搬移＝先刪後插（後端 diff 更新會用新板的 uld_id 重新 INSERT）
  item.id = null;
  return { ok: true, item, from, to };
}


// 行為（改之前先看，這是「自動 ↔ 手動」的分界）：
//   1. 只改「這一板」的重量 → 這一列立刻變成**手動分配**（auto_alloc = 0，畫面上的「自動」勾選會取消）
//   2. 剩下的申報重量（申報 WT − 這一板）依件數分給這票其他板（Σ 仍等於申報 WT）
//   3. 打超過申報 WT → 夾到申報 WT（回 clamped = true，由呼叫端提示），避免把其他板清成 0
//   4. 申報 WT 還是 0（還沒填）→ 直接把申報 WT 設成打進來的值
//   5. 這一板本來沒有明細 → 自動建立（件數 0）
// 回傳 { ok, reason?, clamped, declared, fixed, weights, cells }
export function uldSetCellWeight(rowUid, unitUid, value) {
  const sheet = uldWeightState.current;
  if (!sheet || !Array.isArray(sheet.ulds)) return { ok: false, reason: 'no-sheet' };
  const row = uldFindMawb(rowUid);
  if (!row) return { ok: false, reason: 'no-row' };
  const key = uldMawbKey(row.mawb);
  if (!key) return { ok: false, reason: 'no-mawb' };

  // 這一票在「各板」的明細（依板序排列；沒有明細的板＝這一票不在那塊板上）
  const targets = [];
  sheet.ulds.forEach(unit => {
    const item = (unit.items || []).find(it => uldMawbKey(it.mawb) === key);
    if (item) targets.push({ unitUid: unit.uid, item, pcs: uldNum(item.pcs) });
  });
  let fixedIndex = targets.findIndex(t => t.unitUid === unitUid);
  if (fixedIndex < 0) {
    // 這一板還沒有這票 → 先建明細（件數 0），再分配重量
    const item = uldEnsureItem(unitUid, row);
    if (!item) return { ok: false, reason: 'no-unit' };
    targets.push({ unitUid, item, pcs: uldNum(item.pcs) });
    fixedIndex = targets.length - 1;
  }

  const typed = Math.max(0, uldNum(value));
  let declared = uldNum(row.declared_weight);
  if (declared <= 0) {
    // 還沒填申報 WT → 用打進來的重量當整票申報重量
    row.declared_weight = typed;
    declared = typed;
  }
  const clamped = typed > declared + 1e-9;
  const fixed = clamped ? declared : typed;
  const inc = sheetAllowsHalf(sheet) ? 0.5 : 1;
  const weights = uldAllocateWithFixed(declared, targets.map(t => ({ pcs: t.pcs })), fixedIndex, fixed, inc);
  targets.forEach((t, i) => { t.item.declared_weight = weights[i]; });
  row.auto_alloc = 0;
  uldMarkDirty();
  return { ok: true, clamped, declared, fixed, weights, cells: targets.length };
}

// 改申報列的 MAWB／DEST 時，把它所有板的明細一起改（MAWB 改名、Port 跟 DEST）
export function uldSyncRowToItems(row, prevKey) {
  if (!row) return 0;
  const sheet = uldWeightState.current;
  if (!sheet) return 0;
  const nextKey = uldMawbKey(row.mawb);
  let changed = 0;
  (sheet.ulds || []).forEach(unit => {
    (unit.items || []).forEach(item => {
      const key = uldMawbKey(item.mawb);
      if (key !== prevKey && key !== nextKey) return;
      if (key === prevKey && key !== nextKey) {
        item.mawb = row.mawb;
        changed += 1;
      }
      if (row.mawb_record_id && !item.mawb_record_id) item.mawb_record_id = row.mawb_record_id;
      if (row.dest && item.port !== row.dest) {
        item.port = row.dest;
        changed += 1;
      }
    });
  });
  return changed;
}

// 刪除申報列（連同它在各板的明細）
export function uldRemoveMawbRow(uid) {
  const sheet = uldWeightState.current;
  if (!sheet || !Array.isArray(sheet.mawbs)) return 0;
  const idx = sheet.mawbs.findIndex(row => row.uid === uid);
  if (idx < 0) return 0;
  const row = sheet.mawbs[idx];
  const key = uldMawbKey(row.mawb);
  let removedItems = 0;
  if (key) {
    (sheet.ulds || []).forEach(unit => {
      const before = (unit.items || []).length;
      unit.items = (unit.items || []).filter(item => uldMawbKey(item.mawb) !== key);
      removedItems += before - unit.items.length;
    });
  }
  sheet.mawbs.splice(idx, 1);
  return removedItems;
}

// 列的「夾重」勾選：套到這票的所有明細（之後新加的明細也會沿用 row.is_squeeze）
export function uldSetRowSqueeze(row, squeeze) {
  if (!row) return 0;
  row.is_squeeze = !!squeeze;
  const items = uldRowItems(row);
  items.forEach(({ item }) => { item.is_squeeze = !!squeeze; });
  return items.length;
}

export function uldMarkDirty() {
  uldWeightState.dirty = true;
  const el = document.getElementById('uldw-dirty-flag');
  if (el) el.style.display = '';
}

// 把一票 MAWB 的總重量依件數拆到所有相關單位（交散貨／同票分板）
export function uldSplitMawb(unitUid, itemUid, totalWeight) {
  const sheet = uldWeightState.current;
  if (!sheet) return { count: 0 };
  const unit = uldFindUnit(unitUid);
  if (!unit) return { count: 0 };
  const item = (unit.items || []).find(it => it.uid === itemUid);
  if (!item) return { count: 0 };
  const key = uldMawbKey(item.mawb);
  if (!key) return { count: 0 };

  const targets = [];
  (sheet.ulds || []).forEach(u => {
    (u.items || []).forEach(it => {
      if (uldMawbKey(it.mawb) === key) targets.push({ unit: u, item: it });
    });
  });
  if (!targets.length) return { count: 0 };

  // 新 UI：允許 0.5kg 時拆分單位 0.5，否則整數
  const inc = sheetAllowsHalf(sheet) ? 0.5 : 1;
  const weights = uldSplitByPcs(totalWeight, targets.map(t => ({ pcs: uldNum(t.item.pcs) })), inc);
  targets.forEach((t, idx) => { t.item.declared_weight = weights[idx]; });
  uldMarkDirty();
  return { count: targets.length, weights };
}
