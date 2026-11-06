// ===== ULD 夾重系統：前端狀態 =====
// 一張夾重表 = { 表頭欄位..., ulds: [ { uid, items: [ { uid, ... } ] } ] }
// uid 只用在前端（DB id 可能重複出現於不同單位，故統一用 uid 定位）
import { uldComputeSheet, uldSplitByPcs, uldNum, uldMawbKey } from './calc.js';

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
  versionDiff: null    // V3：目前顯示的版本比對結果（null = 沒有在比對）
};

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
export function uldSheetPayload(sheet) {
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
    ulds: (sheet.ulds || []).map(unit => ({
      // R3：帶回既有 DB id → 後端可做 diff 更新（null／不存在＝新增）
      id: unit.id || null,
      kind: unit.kind,
      uld_number: unit.uld_number,
      bulk_ref: unit.bulk_ref,
      rcl_no: unit.rcl_no,
      contour_code: unit.contour_code,
      port: unit.port,
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
        mawb: item.mawb,
        mawb_record_id: item.mawb_record_id || null,
        port: item.port,
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
export function uldComputed() {
  return uldComputeSheet(uldWeightState.current || {});
}

export function uldFindUnit(uid) {
  return (uldWeightState.current && uldWeightState.current.ulds || [])
    .find(unit => unit.uid === uid) || null;
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
