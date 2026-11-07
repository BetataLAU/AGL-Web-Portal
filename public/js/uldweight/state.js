// ===== ULD 夾重系統：前端狀態 =====
// 一張夾重表 = { 表頭欄位..., ulds: [ { uid, items: [ { uid, ... } ] } ] }
// uid 只用在前端（DB id 可能重複出現於不同單位，故統一用 uid 定位）
import {
  uldComputeSheet, uldSplitByPcs, uldNum, uldMawbKey, uldApplyMawbAllocation
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
  //   view       ：編輯畫面用哪一種版面（grid＝CHARTER LOADING SHEET 載荷表／cards＝收貨單位卡片）
  //   gridSortMawb：載荷表是否依 MAWB# 排序（只影響顯示，不寫回資料）
  //   more     ：「⋯ 更多」動作選單是否展開
  //   advanced ：「⚙ 進階」表頭欄位（B 取整／尾差／磅差門檻／比例上下限）是否展開
  //   expanded  ：哪些收貨單位卡片展開次要欄位（{ [uid]: true }）
  //   allCompact：卡片太多時全部收合（只留摘要）
  //   printUnit ：只印這一張卡（列印時用；null = 印全部）
  ui: {
    view: 'grid',
    gridSortMawb: false,
    more: false,
    advanced: false,
    expanded: {},
    expandAll: false,
    printUnit: null
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

// API 回傳的明細 → 編輯用狀態
export function uldSheetFromApi(detail) {
  if (!detail) return null;
  return {
    id: detail.id,
    sheet_no: detail.sheet_no,
    sheet_date: detail.sheet_date || '',
    terminal: detail.terminal || 'CPSL',
    flight_no: detail.flight_no || '',
    flight_date: detail.flight_date || '',
    round_px: detail.round_px || 1,
    round_b: detail.round_b || 1,
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
      is_squeeze: !!row.is_squeeze,
      auto_alloc: Number(row.auto_alloc) === 0 ? 0 : 1
    })),
    ulds: (detail.ulds || []).map(unit => ({
      ...unit,
      uid: unit.uid || `u${unit.id}`,
      items: (unit.items || []).map(item => ({
        ...item,
        uid: uldTempId('i'),
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
  return {
    sheet_date: sheet.sheet_date,
    terminal: sheet.terminal,
    flight_no: sheet.flight_no,
    flight_date: sheet.flight_date,
    round_px: uldNum(sheet.round_px) || 1,
    round_b: uldNum(sheet.round_b) || 1,
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
      declared_weight: uldNum(row.declared_weight),
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
      tare_weight: uldNum(unit.tare_weight),
      rcl_gross_weight: uldNum(unit.rcl_gross_weight),
      material_weight: uldNum(unit.material_weight),
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
        declared_weight: uldNum(item.declared_weight),
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

  const inc = uldNum(sheet.round_px) > 0 ? uldNum(sheet.round_px) : 1;
  const weights = uldSplitByPcs(totalWeight, targets.map(t => ({ pcs: uldNum(t.item.pcs) })), inc);
  targets.forEach((t, idx) => { t.item.declared_weight = weights[idx]; });
  uldMarkDirty();
  return { count: targets.length, weights };
}
