// ===== 執 PLAN：一鍵配艙建議（純函式，無 DOM）=====
// 情境：
//   1) PLAN 仍是空的 → 從存貨挑一組「最貼近上限」的貨（TRIAL，不會自動寫入）
//   2) PLAN 已有明細（固定條件）→ 只從存貨補「剩餘容量」，不會動到既有明細
// 限制：可不填（只比較有填的維度）；候選貨物「單票已超出剩餘容量」會列為 skipped。
// 演算法：先依模式排序（大件優先／重量優先／CBM 優先）→ greedy 放入不放超 → 回傳利用率。
//   同一組輸入永遠得到同一組結果（tie-break 用 id），方便測試與現場對數。

export const LP_SUGGEST_MODES = [
  { code: 'balanced', label: '平衡（G.W + CBM）' },
  { code: 'weight', label: '重量優先' },
  { code: 'cbm', label: 'CBM 優先' }
];

const EPS = 1e-6;

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function positiveOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}

function round(value, digits = 2) {
  const factor = Math.pow(10, digits);
  return Math.round((Number(value) + EPS) * factor) / factor;
}

function totalsOf(list) {
  let gw = 0;
  let cbm = 0;
  (Array.isArray(list) ? list : []).forEach((item) => {
    gw += num(item.gross_weight);
    cbm += num(item.cbm);
  });
  return { tickets: (list || []).length, gw: round(gw, 2), cbm: round(cbm, 3) };
}

function pct(used, limit) {
  return limit ? round((used / limit) * 100, 1) : null;
}

function utilScore(totals, limits) {
  const parts = [];
  if (limits.maxGrossWeight) parts.push(totals.gw / limits.maxGrossWeight);
  if (limits.maxCbm) parts.push(totals.cbm / limits.maxCbm);
  return parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : 0;
}

// 排序：大件優先（balanced 用「佔兩個上限的比例和」當大小）
function comparator(mode, limits) {
  return (a, b) => {
    const agw = num(a.gross_weight);
    const acbm = num(a.cbm);
    const bgw = num(b.gross_weight);
    const bcbm = num(b.cbm);
    let diff = 0;
    if (mode === 'weight') diff = bgw - agw || bcbm - acbm;
    else if (mode === 'cbm') diff = bcbm - acbm || bgw - agw;
    else {
      const ak = (limits.maxGrossWeight ? agw / limits.maxGrossWeight : agw / 1000)
        + (limits.maxCbm ? acbm / limits.maxCbm : acbm / 10);
      const bk = (limits.maxGrossWeight ? bgw / limits.maxGrossWeight : bgw / 1000)
        + (limits.maxCbm ? bcbm / limits.maxCbm : bcbm / 10);
      diff = bk - ak;
    }
    if (Math.abs(diff) > EPS) return diff;
    return num(a.id) - num(b.id);
  };
}

function dominantDest(list) {
  const counts = new Map();
  (list || []).forEach((item) => {
    const dest = String(item.dest || '').trim().toUpperCase();
    if (!dest) return;
    counts.set(dest, (counts.get(dest) || 0) + 1);
  });
  let best = '';
  let max = 0;
  counts.forEach((n, dest) => { if (n > max) { max = n; best = dest; } });
  return best;
}

function groupByDest(list) {
  const map = new Map();
  (list || []).forEach((item) => {
    const dest = String(item.dest || '').trim().toUpperCase();
    const key = dest || '—';
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  });
  return [...map.entries()]
    .map(([dest, items]) => ({ dest, items }))
    .sort((a, b) => (a.dest < b.dest ? -1 : a.dest > b.dest ? 1 : 0));
}

export function lpSuggestLoad(options = {}) {
  const candidates = Array.isArray(options.candidates) ? options.candidates : [];
  const fixed = Array.isArray(options.fixed) ? options.fixed : [];
  const limits = {
    maxGrossWeight: positiveOrNull(options.limits && options.limits.maxGrossWeight),
    maxCbm: positiveOrNull(options.limits && options.limits.maxCbm)
  };
  const mode = LP_SUGGEST_MODES.some(m => m.code === options.mode) ? options.mode : 'balanced';
  const sameDest = !!options.sameDest;

  const base = {
    ok: false,
    error: null,
    mode,
    sameDest,
    groupDest: '',
    fixed: totalsOf(fixed),
    picked: [],
    pickedIds: [],
    added: { tickets: 0, gw: 0, cbm: 0 },
    totals: totalsOf(fixed),
    remaining: { gw: null, cbm: null },
    utilization: { gwPct: null, cbmPct: null, avgPct: null },
    skipped: [],
    warnings: []
  };

  if (!candidates.length) return Object.assign(base, { ok: true, warnings: ['存貨沒有可用的貨'] });
  if (!limits.maxGrossWeight && !limits.maxCbm) {
    return Object.assign(base, { error: '請至少輸入一個上限（G.W 或 CBM）' });
  }

  const fixedTotals = base.fixed;
  const warnings = [];
  if (limits.maxGrossWeight && fixedTotals.gw > limits.maxGrossWeight + EPS) warnings.push('現有明細已超重');
  if (limits.maxCbm && fixedTotals.cbm > limits.maxCbm + EPS) warnings.push('現有明細已超 CBM');
  if (warnings.length) return Object.assign(base, { ok: true, warnings });

  const remainingW = limits.maxGrossWeight ? Math.max(0, limits.maxGrossWeight - fixedTotals.gw) : Infinity;
  const remainingC = limits.maxCbm ? Math.max(0, limits.maxCbm - fixedTotals.cbm) : Infinity;

  const skipped = [];
  const usable = [];
  candidates.forEach((item) => {
    if (num(item.gross_weight) > remainingW + EPS || num(item.cbm) > remainingC + EPS) {
      skipped.push({ id: item.id, mawb: item.mawb, dest: item.dest, reason: '單票超出剩餘容量' });
      return;
    }
    usable.push(item);
  });

  // 同 DEST 優先：固定明細有 DEST 就只用那個 DEST；否則每個 DEST 各試一次取最佳
  const fixedDest = dominantDest(fixed);
  let groups;
  if (sameDest) {
    const all = groupByDest(usable);
    groups = fixedDest ? all.filter(group => group.dest === fixedDest) : all;
    if (!groups.length) groups = all;
  } else {
    groups = [{ dest: '', items: usable }];
  }

  let best = null;
  groups.forEach((group) => {
    const result = greedyPick(group.items, mode, remainingW, remainingC, limits, fixedTotals);
    if (!best || result.score > best.score + EPS) best = Object.assign({ groupDest: group.dest }, result);
  });
  if (!best) return Object.assign(base, { ok: true, warnings: ['沒有可放入的貨'] });

  const totals = best.totals;
  const remaining = {
    gw: limits.maxGrossWeight ? round(Math.max(0, limits.maxGrossWeight - totals.gw), 2) : null,
    cbm: limits.maxCbm ? round(Math.max(0, limits.maxCbm - totals.cbm), 3) : null
  };

  const result = Object.assign(base, {
    ok: true,
    groupDest: best.groupDest || '',
    fixed: fixedTotals,
    picked: best.picked,
    pickedIds: best.picked.map(item => item.id),
    added: best.added,
    totals,
    remaining,
    utilization: {
      gwPct: pct(totals.gw, limits.maxGrossWeight),
      cbmPct: pct(totals.cbm, limits.maxCbm),
      avgPct: (limits.maxGrossWeight || limits.maxCbm) ? round(utilScore(totals, limits) * 100, 1) : null
    },
    skipped,
    warnings
  });
  if (!best.picked.length) result.warnings = warnings.concat(['沒有貨物可以放進剩餘容量']);
  return result;
}

function greedyPick(items, mode, remainingW, remainingC, limits, fixedTotals) {
  const sorted = [...items].sort(comparator(mode, limits));
  const picked = [];
  let gw = 0;
  let cbm = 0;
  sorted.forEach((item) => {
    const itemGw = num(item.gross_weight);
    const itemCbm = num(item.cbm);
    if (itemGw > remainingW - gw + EPS) return;
    if (itemCbm > remainingC - cbm + EPS) return;
    gw += itemGw;
    cbm += itemCbm;
    picked.push(item);
  });
  const totals = {
    tickets: fixedTotals.tickets + picked.length,
    gw: round(fixedTotals.gw + gw, 2),
    cbm: round(fixedTotals.cbm + cbm, 3)
  };
  return { picked, added: { tickets: picked.length, gw: round(gw, 2), cbm: round(cbm, 3) }, totals, score: utilScore(totals, limits) };
}
