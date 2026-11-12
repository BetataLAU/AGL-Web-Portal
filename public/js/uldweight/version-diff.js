// ===== ULD 夾重系統：版本快照摘要 ＋ 異動比對（V3，純函式 ESM，前後端共用）=====
// 為什麼要獨立一支：版本比較的規則只能有一份（後端算、前端畫），否則會出現
// 「後端說有改、畫面說沒改」。這裡只做「資料層比對」，不涉及重量算法（算法仍只在 calc.js）。
//
// snapshot 結構（由 routes/uld-weight.js 的 buildSnapshot() 產生，只存輸入值、不含 calc 的重算結果）：
//   { header: { sheet_date, terminal, ... }, units: [ { id, kind, uld_number, ..., items: [ {...} ] } ] }
const HEADER_FIELDS = [
  { field: 'sheet_date', label: '日期' },
  { field: 'terminal', label: '貨站' },
  { field: 'flight_no', label: '航班' },
  { field: 'flight_date', label: '航班日期' },
  { field: 'handler', label: '經手人' },
  { field: 'remark', label: '備註' },
  { field: 'round_b', label: 'B 取整', numeric: true },
  { field: 'allow_half_kg', label: '允許 0.5kg', numeric: true },
  { field: 'tail_mode', label: '尾差' },
  { field: 'diff_warn_pct', label: '磅差警示 %', numeric: true },
  { field: 'diff_warn_kg', label: '磅差警示 kg', numeric: true },
  { field: 'clamp_min_pct', label: '比例下限 %', numeric: true },
  { field: 'clamp_max_pct', label: '比例上限 %', numeric: true },
  { field: 'status', label: '狀態' }
];

const UNIT_FIELDS = [
  { field: 'kind', label: '類型' },
  { field: 'uld_number', label: 'ULD#' },
  { field: 'bulk_ref', label: '批號' },
  { field: 'rcl_no', label: 'RCL#' },
  { field: 'contour_code', label: 'Contour' },
  { field: 'port', label: 'Port' },
  { field: 'pcs', label: '件數', numeric: true },
  { field: 'tare_weight', label: 'Tare', numeric: true, kg: true },
  { field: 'rcl_gross_weight', label: 'RCL（淨）', numeric: true, kg: true },
  { field: 'material_weight', label: '物料', numeric: true, kg: true },
  { field: 'lih_type', label: 'LIH' },
  { field: 'predecl_type', label: 'Pre-decl' },
  { field: 'squeeze_mode', label: '夾重方式' }
];

const ITEM_FIELDS = [
  { field: 'mawb', label: 'MAWB#' },
  { field: 'port', label: 'Port' },
  { field: 'pcs', label: '件數', numeric: true },
  { field: 'declared_weight', label: '申報重量', numeric: true, kg: true },
  { field: 'final_weight', label: '最終重量', numeric: true, kg: true },
  { field: 'is_squeeze', label: '夾重' },
  { field: 'squeeze_ratio', label: '比例', numeric: true },
  { field: 'lih_type', label: 'LIH' },
  { field: 'mawb_record_id', label: 'Booking 連結' }
];

// 方案 B：MAWB 申報列（載荷表左邊那一欄）的欄位
const MAWB_FIELDS = [
  { field: 'mawb', label: 'MAWB#' },
  { field: 'dest', label: 'DEST' },
  { field: 'pcs', label: '申報件數', numeric: true },
  { field: 'declared_weight', label: '申報重量', numeric: true, kg: true },
  { field: 'wh_ref', label: 'W/H or Booking' },
  { field: 'auto_alloc', label: '重量分配', numeric: true },
  { field: 'is_squeeze', label: '夾重' },
  { field: 'mawb_record_id', label: 'Booking 連結' }
];

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function text(value) {
  return String(value == null ? '' : value).trim();
}

// 欄位值比較：數字欄位比數值（容忍浮點誤差），其餘比去空白後的字串
function valueOf(field, raw) {
  if (field.field === 'is_squeeze') return raw ? 'Y' : 'N';
  if (field.field === 'squeeze_ratio') return raw == null || raw === '' ? '' : Number(num(raw).toFixed(6));
  if (field.field === 'mawb_record_id') return raw == null || raw === '' ? '' : Number(raw);
  if (field.numeric) return Number(num(raw).toFixed(6));
  return text(raw);
}

function isSame(field, a, b) {
  const va = valueOf(field, a);
  const vb = valueOf(field, b);
  if (field.numeric) return Math.abs(Number(va) - Number(vb)) < 1e-9;
  return String(va) === String(vb);
}

function fieldChanges(fields, prevObj, nextObj) {
  const changes = [];
  fields.forEach(field => {
    const before = prevObj ? prevObj[field.field] : undefined;
    const after = nextObj ? nextObj[field.field] : undefined;
    if (isSame(field, before, after)) return;
    changes.push({
      field: field.field,
      label: field.label,
      kg: !!field.kg,
      numeric: !!field.numeric,
      from: prevObj ? valueOf(field, before) : '',
      to: nextObj ? valueOf(field, after) : ''
    });
  });
  return changes;
}

// 收貨單位顯示名稱（ULD 號／散貨批號；都沒有就用 #序號）
export function uldVersionUnitLabel(unit, index) {
  if (!unit) return '';
  const name = text(unit.uld_number) || text(unit.bulk_ref);
  const kind = unit.kind === 'BULK' ? '散貨' : 'ULD';
  if (name) return `${kind} ${name}`;
  return `${kind} #${(index == null ? 0 : index) + 1}`;
}

// 版本摘要（清單用）：只用 snapshot 裡的欄位，不重算重量
export function uldSnapshotSummary(snapshot) {
  const units = (snapshot && snapshot.units) || [];
  const summary = { uldCount: units.length, bulkCount: 0, itemCount: 0, mawbCount: 0, netTotal: 0, diffTotal: 0 };
  const mawbs = new Set();
  units.forEach(unit => {
    if (unit.kind === 'BULK') summary.bulkCount += 1;
    summary.netTotal += num(unit.net_weight);
    summary.diffTotal += num(unit.diff_weight);
    (unit.items || []).forEach(item => {
      summary.itemCount += 1;
      const key = text(item.mawb).replace(/[\s-]/g, '').toUpperCase();
      if (key) mawbs.add(key);
    });
  });
  summary.mawbCount = mawbs.size;
  summary.netTotal = Number(summary.netTotal.toFixed(1));
  summary.diffTotal = Number(summary.diffTotal.toFixed(1));
  return summary;
}

// 兩份 snapshot 的差異（prev 可為 null＝第一版）
// 回傳：
//   header  [{ field, label, from, to }]
//   units   { added: [{ label, items }], removed: [{ label, items }], changed: [{ label, fields }] }
//   items   { added: [{ unitLabel, mawb, to }], removed: [{ unitLabel, mawb, from }],
//             changed: [{ unitLabel, mawb, fields }] }
//   summary { header, unitsAdded, unitsRemoved, unitsChanged, itemsAdded, itemsRemoved, itemsChanged }
//   hasChanges boolean
export function uldDiffSnapshots(prev, next) {
  const before = prev || { header: {}, units: [] };
  const after = next || { header: {}, units: [] };

  const header = fieldChanges(HEADER_FIELDS, before.header || {}, after.header || {});
  const diff = {
    header,
    // 方案 B：MAWB 申報列（表級）
    mawbs: { added: [], removed: [], changed: [] },
    units: { added: [], removed: [], changed: [] },
    items: { added: [], removed: [], changed: [] }
  };

  // MAWB 申報列以 id 比對（沒有 id 才退回 mawb + 序）
  const keyOfMawb = (row, idx) => (row && row.id != null
    ? `id:${row.id}`
    : `k:${text(row && row.mawb)}|${row && row.seq != null ? row.seq : idx}`);
  const beforeMawbs = new Map();
  (before.mawbs || []).forEach((row, idx) => beforeMawbs.set(keyOfMawb(row, idx), row));
  const afterMawbs = new Map();
  (after.mawbs || []).forEach((row, idx) => afterMawbs.set(keyOfMawb(row, idx), row));
  afterMawbs.forEach((row, key) => {
    const prevRow = beforeMawbs.get(key);
    if (!prevRow) {
      diff.mawbs.added.push({ mawb: text(row.mawb), pcs: num(row.pcs), weight: num(row.declared_weight) });
      return;
    }
    const changes = fieldChanges(MAWB_FIELDS, prevRow, row);
    if (changes.length) {
      diff.mawbs.changed.push({
        mawb: text(row.mawb) || text(prevRow.mawb),
        fields: changes
      });
    }
    beforeMawbs.delete(key);
  });
  beforeMawbs.forEach(row => {
    diff.mawbs.removed.push({ mawb: text(row.mawb), pcs: num(row.pcs), weight: num(row.declared_weight) });
  });

  // 收貨單位以 id 比對（R3 之後 id 不會變）；沒有 id 才退回「類型 + 號碼 + 序」
  const keyOfUnit = (unit, idx) => {
    if (unit && unit.id != null) return `id:${unit.id}`;
    const seq = unit && unit.seq != null ? unit.seq : idx;
    return `k:${text(unit && unit.kind)}|${text(unit && (unit.uld_number || unit.bulk_ref))}|${seq}`;
  };
  const beforeUnits = new Map();
  (before.units || []).forEach((unit, idx) => beforeUnits.set(keyOfUnit(unit, idx), { unit, idx }));
  const afterUnits = new Map();
  (after.units || []).forEach((unit, idx) => afterUnits.set(keyOfUnit(unit, idx), { unit, idx }));

  // 明細以 id 比對（新增列沒有 id 時退回 mawb + 序）
  const keyOfItem = (item, idx) => (item && item.id != null
    ? `id:${item.id}`
    : `k:${text(item && item.mawb)}|${item && item.seq != null ? item.seq : idx}`);

  afterUnits.forEach((entry, key) => {
    const label = uldVersionUnitLabel(entry.unit, entry.idx);
    const prevEntry = beforeUnits.get(key);
    if (!prevEntry) {
      diff.units.added.push({ label, items: (entry.unit.items || []).length });
      (entry.unit.items || []).forEach(item => {
        diff.items.added.push({ unitLabel: label, mawb: text(item.mawb), to: num(item.declared_weight) });
      });
      return;
    }
    const changes = fieldChanges(UNIT_FIELDS, prevEntry.unit, entry.unit);
    if (changes.length) diff.units.changed.push({ label, fields: changes });

    const beforeItems = new Map();
    (prevEntry.unit.items || []).forEach((item, idx) => beforeItems.set(keyOfItem(item, idx), item));
    (entry.unit.items || []).forEach((item, idx) => {
      const itemKey = keyOfItem(item, idx);
      const prevItem = beforeItems.get(itemKey);
      if (!prevItem) {
        diff.items.added.push({ unitLabel: label, mawb: text(item.mawb), to: num(item.declared_weight) });
        return;
      }
      const itemChanges = fieldChanges(ITEM_FIELDS, prevItem, item);
      if (itemChanges.length) {
        diff.items.changed.push({
          unitLabel: label,
          mawb: text(item.mawb) || text(prevItem.mawb),
          fields: itemChanges
        });
      }
      beforeItems.delete(itemKey);
    });
    beforeItems.forEach(item => {
      diff.items.removed.push({ unitLabel: label, mawb: text(item.mawb), from: num(item.declared_weight) });
    });
  });

  beforeUnits.forEach((entry, key) => {
    if (afterUnits.has(key)) return;
    const label = uldVersionUnitLabel(entry.unit, entry.idx);
    diff.units.removed.push({ label, items: (entry.unit.items || []).length });
    (entry.unit.items || []).forEach(item => {
      diff.items.removed.push({ unitLabel: label, mawb: text(item.mawb), from: num(item.declared_weight) });
    });
  });

  diff.summary = {
    header: header.length,
    mawbsAdded: diff.mawbs.added.length,
    mawbsRemoved: diff.mawbs.removed.length,
    mawbsChanged: diff.mawbs.changed.length,
    unitsAdded: diff.units.added.length,
    unitsRemoved: diff.units.removed.length,
    unitsChanged: diff.units.changed.length,
    itemsAdded: diff.items.added.length,
    itemsRemoved: diff.items.removed.length,
    itemsChanged: diff.items.changed.length
  };
  diff.hasChanges = Object.keys(diff.summary).some(key => diff.summary[key] > 0);
  return diff;
}
