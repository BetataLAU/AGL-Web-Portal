// ===== ULD 夾重系統：計算核心（純函式，無 DOM 依賴）=====
// 前後端共用：前端直接 import；後端 routes/uld-weight.js 以 import() 載入同一支重算，
// 確保「畫面算的」與「存進資料庫的」永遠一致。
//
// 核心規則（見 docs/design/uld-weight-system.md）：
//   目標淨重 R = RCL WT（RCL 磅單填的就是淨重；Tare 只顯示參考，不再從 RCL 扣除）
//   磅差     D = R − Σ 各票申報重量（正 = RCL 比申報重，含裝板物料）
//   夾重票（可多票）依比例分攤 D；未勾選夾重的票「重量不變」
//   取整：P / X（交板）一律整數（1.0）；B（散貨）可用 0.5 或 1.0
//   尾差：各票取整後與目標淨重的差，預設由「重量最大的夾重票」吸收

// ===== 選項常數（UI 與後端驗證共用）=====

export const ULD_TERMINALS = ['HACTL', 'AAT', 'CPSL'];

export const ULD_PREDECL_TYPES = [
  { code: 'P', label: 'P — Prepack（每板 1 個 MAWB）' },
  { code: 'X', label: 'X — MIX（混裝，MAWB 數 ≥ 1）' },
  { code: 'B', label: 'B — Bulk（交散貨，無板底）' }
];

// LIH 選項：存檔值仍是 `N`／`UN3481`／`UN3091`（既有資料與比對不變），
// 畫面只顯示業界慣用的短碼 `N`／`3481`／`3091`（避免下拉被長文字撐寬）。
export const ULD_LIH_TYPES = [
  { code: 'N', label: 'N' },
  { code: 'UN3481', label: '3481' },
  { code: 'UN3091', label: '3091' }
];

// LIH 顯示用短碼（找不到就原樣回傳）
export function uldLihLabel(code) {
  const key = String(code == null ? '' : code).trim().toUpperCase();
  if (!key) return 'N';
  const hit = ULD_LIH_TYPES.find(t => t.code === key);
  return hit ? hit.label : key;
}

export const ULD_SQUEEZE_MODES = [
  { code: 'weight', label: '重量比例' },
  { code: 'pcs', label: '件數比例' },
  { code: 'equal', label: '平均分攤' },
  { code: 'manual', label: '手動 %' }
];

export const ULD_TAIL_MODES = [
  { code: 'adjust_largest', label: '由最大票吸收尾差（預設）' },
  { code: 'equal', label: '平均分攤尾差' },
  { code: 'none', label: '不調整（只標示差額）' }
];

export const ULD_ISSUE_LABELS = {
  NEGATIVE_WEIGHT: '夾重後重量為負',
  NO_SQUEEZE: '有磅差但未勾選夾重 MAWB',
  TARGET_TOO_SMALL: 'RCL 淨重比「非夾重票」的合計還小',
  PIECES_MISMATCH: '件數不符',
  LIH_UNIT_MISSING: '票載有鋰電池但收貨單位標示 N',
  LIH_UNIT_ONLY: '收貨單位標示鋰電池但沒有任何票標示',
  LIH_UN_CODE_MISMATCH: '收貨單位與票的 UN 編號不一致',
  DIFF_TOO_BIG: '磅差過大',
  MAWB_SPLIT_MISSING: '同一 MAWB 分板但部分板未填重量',
  DUPLICATE_ULD: 'ULD／批號重複',
  DUPLICATE_MAWB_IN_ULD: '同一單位重複同一 MAWB',
  SQUEEZE_ZERO_WEIGHT: '夾重票申報重量為 0，比例已改用件數',
  CLAMP_INFEASIBLE: '夾重比例上下限無解（已忽略）'
};

// ===== 數值工具 =====

export function uldNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

// 顯示用：最多 1 位小數，去掉多餘的 .0
export function uldFmtKg(value) {
  const n = uldNum(value);
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

// 取整到指定單位（向上）；1.0 → 整數、0.5 → 對齊 0.5
export function uldCeilTo(value, inc) {
  const step = uldNum(inc);
  if (!(step > 0)) return uldNum(value);
  const ticks = uldNum(value) / step;
  const nearest = Math.round(ticks);
  const ceiled = Math.abs(ticks - nearest) < 1e-9 ? nearest : Math.ceil(ticks);
  // 先轉 ticks 再加 1e-9，避免 0.1+0.2 類誤差把整數推高一格
  return Number((ceiled * step).toFixed(6));
}

// MAWB 正規化（去空白／連字號，統一顯示 000-0000 0000 比對用）
export function uldNormalizeMawb(value) {
  return String(value == null ? '' : value).replace(/[\s-]/g, '').toUpperCase();
}

// 夾重票鍵值（同一個 MAWB 可能跨多板，故以正規化後的號碼彙總）
export function uldMawbKey(value) {
  const key = uldNormalizeMawb(value);
  return key || String(value == null ? '' : value).trim();
}


// ===== 多票夾重比例的上下限（R2）=====
// 把「比例陣列」（已正規化、合計 1）限制在 [minPct%, maxPct%]：
//   1) 先依原始比例分配；超出界線的票固定在界線上（water-filling）
//   2) 被固定的票所佔的比例從池子扣除，其餘的票依原始比例重分配
//   3) 重複直到沒有票越界（最多 n+1 輪）
// 參數：minPct / maxPct 為百分比（0 = 該方向不限；maxPct 上限 100）
// 回傳：{ ratios, clamped[], infeasible, reason, minRatio, maxRatio }
//   infeasible：上下限本身互相矛盾（例：3 票各最少 50%、或 3 票各最多 30%）
//               → 比例原封不動（由呼叫端提 CLAMP_INFEASIBLE 警示）
// 註：這裡限制的是「磅差的分攤比例」，不是最終重量比例；尾差調整仍可能讓單票加減 1 tick。
export function uldApplyRatioClamp(ratios, minPct, maxPct) {
  const list = (Array.isArray(ratios) ? ratios : []).map(v => Math.max(0, uldNum(v)));
  const n = list.length;
  const minRatio = uldNum(minPct) > 0 ? Math.min(uldNum(minPct), 100) / 100 : 0;
  const maxRatio = uldNum(maxPct) > 0 ? Math.min(uldNum(maxPct), 100) / 100 : 1;
  const out = {
    ratios: list.slice(),
    clamped: list.map(() => false),
    infeasible: false,
    reason: '',
    minRatio,
    maxRatio
  };
  if (!n) return out;
  // 只有 1 票參與夾重時沒有「重分配」可言（比例必然是 100%）→ 忽略上下限
  if (n < 2) return out;
  if (minRatio > 0 && minRatio * n > 1 + 1e-9) {
    out.infeasible = true;
    out.reason = 'min_sum_exceeds_100';
    return out;
  }
  if (maxRatio < 1 && maxRatio * n < 1 - 1e-9) {
    out.infeasible = true;
    out.reason = 'max_sum_below_100';
    return out;
  }
  if (!(minRatio > 0) && !(maxRatio < 1)) return out; // 兩邊都沒設限 → 原比例

  const total = list.reduce((sum, v) => sum + v, 0);
  const weights = total > 0 ? list.slice() : list.map(() => 1);
  const assign = new Array(n).fill(0);
  const fixed = new Array(n).fill(false);
  let active = weights.map((_, i) => i);
  let remaining = 1;
  let remainingWeight = weights.reduce((sum, v) => sum + v, 0);

  for (let guard = 0; guard <= n + 1 && active.length; guard += 1) {
    const cap = remaining;
    const weightSum = remainingWeight;
    const nextActive = [];
    let anyClamp = false;
    active.forEach(i => {
      const want = weightSum > 0 ? cap * (weights[i] / weightSum) : cap / active.length;
      if (minRatio > 0 && want < minRatio - 1e-12) {
        assign[i] = minRatio;
        fixed[i] = true;
        remaining -= minRatio;
        remainingWeight -= weights[i];
        anyClamp = true;
      } else if (maxRatio < 1 && want > maxRatio + 1e-12) {
        assign[i] = maxRatio;
        fixed[i] = true;
        remaining -= maxRatio;
        remainingWeight -= weights[i];
        anyClamp = true;
      } else {
        assign[i] = want;
        nextActive.push(i);
      }
    });
    if (!anyClamp) break;
    active = nextActive;
  }

  const sum = assign.reduce((acc, v) => acc + v, 0);
  if (!(sum > 0)) {
    // 極端資料保險：全部權重為 0 → 平均
    for (let i = 0; i < n; i += 1) assign[i] = 1 / n;
  } else if (Math.abs(sum - 1) > 1e-9) {
    for (let i = 0; i < n; i += 1) assign[i] /= sum;
  }

  out.ratios = assign;
  out.clamped = fixed;
  return out;
}

// ===== 單一收貨單位（ULD / BULK）的夾重計算 =====
// unit：{ kind:'ULD'|'BULK', tare_weight, rcl_gross_weight, material_weight, pcs,
//         squeeze_mode, items:[{ id, mawb, pcs, port, lih_type, declared_weight, is_squeeze, squeeze_ratio }] }
// options：{ roundBoard:1, roundBulk:0.5|1, tailMode:'adjust_largest'|'equal'|'none', diffWarnPct:2, diffWarnKg:100 }
export function uldComputeUnit(unit, options = {}) {
  const kind = unit && unit.kind === 'BULK' ? 'BULK' : 'ULD';
  const tare = kind === 'BULK' ? 0 : uldNum(unit && unit.tare_weight);
  const rclGross = uldNum(unit && unit.rcl_gross_weight);
  const material = uldNum(unit && unit.material_weight);
  const roundInc = kind === 'BULK'
    ? (uldNum(options.roundBulk) > 0 ? uldNum(options.roundBulk) : 1)
    : (uldNum(options.roundBoard) > 0 ? uldNum(options.roundBoard) : 1);
  const tailMode = options.tailMode || 'adjust_largest';
  const squeezeMode = (unit && unit.squeeze_mode) || 'weight';

  const items = ((unit && unit.items) || []).map((raw, idx) => ({
    key: raw && raw.id != null ? String(raw.id) : `t${idx}`,
    id: raw && raw.id != null ? raw.id : null,
    // 前端暫存 id 與打板計劃 Booking Record 連結（W2 回寫 mawb_records 用）
    uid: raw && raw.uid != null ? raw.uid : null,
    mawb_record_id: raw && raw.mawb_record_id != null ? (Number(raw.mawb_record_id) || null) : null,
    mawb: (raw && raw.mawb) || '',
    port: (raw && raw.port) || '',
    lih_type: (raw && raw.lih_type) || 'N',
    pcs: uldNum(raw && raw.pcs),
    declared: uldNum(raw && raw.declared_weight),
    squeeze: !!(raw && raw.is_squeeze),
    manualRatio: raw && raw.squeeze_ratio != null ? uldNum(raw.squeeze_ratio) : null
  }));

  // RCL 欄 = 貨站磅單的淨重（RCL wt）→ 目標淨重就是 RCL 值。
  // Tare（板重）仍讀進來、仍顯示，但**不再從 RCL 扣除**（2026-11-07 規則變更）。
  const targetNet = rclGross;
  const declaredSum = items.reduce((sum, it) => sum + it.declared, 0);
  const diff = targetNet - declaredSum;
  const diffPct = targetNet > 0 ? (diff / targetNet) * 100 : 0;

  const issues = [];
  const squeezeItems = items.filter(it => it.squeeze);

  // ===== 1. 比例（僅夾重票）=====
  const ratioBase = squeezeItems.map(it => {
    if (squeezeMode === 'pcs') return Math.max(0, it.pcs);
    if (squeezeMode === 'equal') return 1;
    if (squeezeMode === 'manual') return Math.max(0, it.manualRatio == null ? 0 : it.manualRatio);
    return Math.max(0, it.declared); // 預設：重量比例
  });
  let ratioTotal = ratioBase.reduce((sum, v) => sum + v, 0);
  if (squeezeItems.length && !(ratioTotal > 0)) {
    // 全部為 0（例如申報重量都是 0）→ 退回件數比例，再不行就平均
    const pcsBase = squeezeItems.map(it => Math.max(0, it.pcs));
    const pcsTotal = pcsBase.reduce((sum, v) => sum + v, 0);
    if (pcsTotal > 0) {
      squeezeItems.forEach((it, i) => { it.ratioBase = pcsBase[i]; });
      ratioTotal = pcsTotal;
      issues.push({ code: 'SQUEEZE_ZERO_WEIGHT', level: 'warn', unit: kind });
    } else {
      squeezeItems.forEach(it => { it.ratioBase = 1; });
      ratioTotal = squeezeItems.length;
    }
  } else {
    squeezeItems.forEach((it, i) => { it.ratioBase = ratioBase[i]; });
  }

  // ===== 1.5 比例上下限（R2）=====
  // 每票分到的比例限制在 [clamp_min_pct%, clamp_max_pct%]（0 = 不限），
  // 超出界線的部分依原始比例重分配給其他票（water-filling，見 uldApplyRatioClamp）。
  const rawRatios = squeezeItems.map(it => (ratioTotal > 0 ? it.ratioBase / ratioTotal : 0));
  const clampInfo = uldApplyRatioClamp(rawRatios, options.clampMinPct, options.clampMaxPct);
  if (clampInfo.infeasible && squeezeItems.length) {
    issues.push({
      code: 'CLAMP_INFEASIBLE', level: 'warn', unit: kind,
      detail: clampInfo.reason === 'min_sum_exceeds_100'
        ? `比例下限 ${uldFmtKg(clampInfo.minRatio * 100)}% × ${squeezeItems.length} 票 > 100%（已忽略下限）`
        : `比例上限 ${uldFmtKg(clampInfo.maxRatio * 100)}% × ${squeezeItems.length} 票 < 100%（已忽略上限）`
    });
  }
  squeezeItems.forEach((it, i) => {
    it.ratio = clampInfo.ratios[i] || 0;
    it.ratioClamped = !!clampInfo.clamped[i];
  });

  // ===== 2. 精確值（尚未取整）=====
  items.forEach(it => {
    if (!it.squeeze) {
      it.ratio = 0;
      it.ratioClamped = false;
    }
    it.share = it.squeeze ? diff * it.ratio : 0;
    it.exact = it.declared + it.share;
    it.final = it.declared; // 未勾夾重 → 重量不變
    it.tailAdjust = 0;
  });

  // ===== 3. 取整 + 尾差 =====
  // 非夾重票維持申報值；夾重票合計必須等於「取整後目標淨重 − 非夾重票合計」
  const nonSqueezeSum = items.filter(it => !it.squeeze).reduce((sum, it) => sum + it.declared, 0);
  const targetTicks = roundInc > 0 ? Math.round(uldCeilTo(targetNet, roundInc) / roundInc) : 0;
  const targetSqueezeSum = Number((targetTicks * roundInc - nonSqueezeSum).toFixed(6));

  if (squeezeItems.length) {
    if (targetSqueezeSum < 0) {
      issues.push({ code: 'TARGET_TOO_SMALL', level: 'error', unit: kind });
    } else if (tailMode === 'none') {
      squeezeItems.forEach(it => { it.final = uldCeilTo(it.exact, roundInc); });
    } else {
      // 各票先向上取整，再把多出的 ticks 依規則扣回，使合計 = 目標
      squeezeItems.forEach(it => {
        it.ceilTicks = roundInc > 0 ? Math.round(uldCeilTo(it.exact, roundInc) / roundInc) : it.exact;
        it.finalTicks = it.ceilTicks;
      });
      const targetTicksForSqueeze = roundInc > 0
        ? Math.round(targetSqueezeSum / roundInc)
        : targetSqueezeSum;
      let deficit = targetTicksForSqueeze
        - squeezeItems.reduce((sum, it) => sum + it.finalTicks, 0);

      // adjust_largest：申報重量大的先吸收；equal：重量小的先輪流
      const order = squeezeItems.slice().sort((a, b) => (
        tailMode === 'equal' ? (a.declared - b.declared) : (b.declared - a.declared)
      ));
      let guard = 0;
      const maxRounds = Math.max(1, order.length) * (Math.abs(deficit) + 2);
      while (deficit !== 0 && order.length && guard < maxRounds) {
        for (let i = 0; i < order.length && deficit !== 0; i += 1) {
          const it = order[i];
          const step = deficit > 0 ? 1 : -1;
          const next = it.finalTicks + step;
          if (next < 0) continue; // 不可低於 0；向上調整不設限
          it.finalTicks = next;
          deficit -= step;
        }
        guard += 1;
      }

      squeezeItems.forEach(it => {
        it.final = Number((it.finalTicks * roundInc).toFixed(6));
        it.tailAdjust = Number((it.final - uldCeilTo(it.exact, roundInc)).toFixed(6));
      });
    }
  }

  // ===== 4. 檢核 =====
  if (diff !== 0 && !squeezeItems.length) {
    issues.push({ code: 'NO_SQUEEZE', level: 'error', unit: kind });
  }
  if (items.some(it => it.final < 0)) {
    issues.push({ code: 'NEGATIVE_WEIGHT', level: 'error', unit: kind });
  }
  const pcsSum = items.reduce((sum, it) => sum + it.pcs, 0);
  const unitPcs = uldNum(unit && unit.pcs);
  if (unitPcs > 0 && pcsSum > 0 && unitPcs !== pcsSum) {
    issues.push({
      code: 'PIECES_MISMATCH', level: 'warn', unit: kind,
      detail: `單位 ${unitPcs} 件 ≠ 各票合計 ${pcsSum} 件`
    });
  }
  // W5：LIH 檢核細分三種情境（舊版只有一個 LIH_MISMATCH，detail 文字不同）
  const lihItems = items.filter(it => it.lih_type && it.lih_type !== 'N');
  const unitLih = (unit && unit.lih_type) || 'N';
  const lihCodes = [...new Set(lihItems.map(it => it.lih_type))];
  if (lihItems.length && unitLih === 'N') {
    // ① 票有 UN、單位標 N → 板／散貨的 LIH 欄要補
    issues.push({
      code: 'LIH_UNIT_MISSING', level: 'warn', unit: kind,
      detail: `有 ${lihItems.length} 票載有 ${lihCodes.join('／')}，但收貨單位標示 N`
    });
  } else if (unitLih !== 'N' && !lihItems.length) {
    // ② 單位標 UN、但沒有任何票標 → 只有板有標，票漏填
    issues.push({
      code: 'LIH_UNIT_ONLY', level: 'warn', unit: kind,
      detail: `收貨單位標示 ${unitLih}，但沒有任何票標示鋰電池`
    });
  } else if (lihItems.length && unitLih !== 'N' && lihItems.some(it => it.lih_type !== unitLih)) {
    // ③ 兩邊都有 UN 但編號不同（例如板 UN3481、票 UN3091）
    issues.push({
      code: 'LIH_UN_CODE_MISMATCH', level: 'warn', unit: kind,
      detail: `收貨單位 ${unitLih} ≠ 票 ${lihCodes.join('／')}`
    });
  }
  const warnPct = uldNum(options.diffWarnPct) > 0 ? uldNum(options.diffWarnPct) : 2;
  const warnKg = uldNum(options.diffWarnKg) > 0 ? uldNum(options.diffWarnKg) : 100;
  if (Math.abs(diff) > warnKg && Math.abs(diffPct) > warnPct) {
    issues.push({
      code: 'DIFF_TOO_BIG', level: 'warn', unit: kind,
      detail: `磅差 ${uldFmtKg(diff)} kg（${diffPct.toFixed(2)}%），超過警示門檻 ${uldFmtKg(warnPct)}% / ${uldFmtKg(warnKg)} kg`
    });
  }
  const mawbKeys = items.map(it => uldMawbKey(it.mawb)).filter(Boolean);
  if (new Set(mawbKeys).size !== mawbKeys.length) {
    issues.push({ code: 'DUPLICATE_MAWB_IN_ULD', level: 'warn', unit: kind });
  }

  const finalSum = items.reduce((sum, it) => sum + it.final, 0);
  return {
    kind,
    tare,
    rclGross,
    material,
    targetNet,
    roundInc,
    tailMode,
    squeezeMode,
    declaredSum,
    diff,
    diffPct,
    diffWarnPct: warnPct,
    diffWarnKg: warnKg,
    // R2：本次實際套用的比例上下限（%，100 = 該方向不限）
    clampMinPct: Number(((clampInfo.minRatio || 0) * 100).toFixed(2)),
    clampMaxPct: Number(((clampInfo.maxRatio || 1) * 100).toFixed(2)),
    diffAfterFinal: Number((targetNet - finalSum).toFixed(6)),
    finalSum,
    pcsSum,
    items,
    issues,
    hasError: issues.some(i => i.level === 'error')
  };
}

// ===== 整張夾重表：逐單位計算 + MAWB 彙總 + 全表檢核 =====
// sheet：{ round_px, round_b, tail_mode, ulds:[unit...] }；unit 需帶 uid（前端用暫存 id、後端用 DB id）
export function uldComputeSheet(sheet, options = {}) {
  const src = sheet || {};
  const opts = {
    roundBoard: uldNum(src.round_px) > 0 ? uldNum(src.round_px) : 1,
    roundBulk: uldNum(src.round_b) > 0 ? uldNum(src.round_b) : 1,
    tailMode: src.tail_mode || 'adjust_largest',
    diffWarnPct: src.diff_warn_pct,
    diffWarnKg: src.diff_warn_kg,
    // R2：多票夾重比例上下限（%，0 = 不限）
    clampMinPct: src.clamp_min_pct,
    clampMaxPct: src.clamp_max_pct,
    ...options
  };

  const units = (src.ulds || []).map((unit, idx) => {
    const uid = unit.uid != null ? unit.uid : (unit.id != null ? `u${unit.id}` : `u${idx}`);
    return { ...unit, uid, calc: uldComputeUnit(unit, opts) };
  });

  // ===== MAWB 彙總（同一票跨多板時加總）=====
  const mawbMap = new Map();
  units.forEach(unit => {
    unit.calc.items.forEach(it => {
      const key = uldMawbKey(it.mawb);
      if (!key) return;
      let row = mawbMap.get(key);
      if (!row) {
        row = {
          key, mawb: it.mawb, pcs: 0, declared: 0, final: 0,
          units: [], ports: [], lih: [], squeeze: false, hasZeroSplit: false
        };
        mawbMap.set(key, row);
      }
      row.pcs += it.pcs;
      row.declared += it.declared;
      row.final += it.final;
      row.squeeze = row.squeeze || it.squeeze;
      if (!row.units.includes(unit.uid)) row.units.push(unit.uid);
      if (it.port && !row.ports.includes(it.port)) row.ports.push(it.port);
      if (it.lih_type && it.lih_type !== 'N' && !row.lih.includes(it.lih_type)) row.lih.push(it.lih_type);
      if (it.declared === 0) row.hasZeroSplit = true;
    });
  });
  const mawbs = [...mawbMap.values()].map(row => ({
    ...row,
    diff: Number((row.final - row.declared).toFixed(6))
  }));

  // ===== 全表檢核 =====
  const issues = [];
  units.forEach(unit => {
    unit.calc.issues.forEach(issue => {
      issues.push({
        ...issue,
        scope: 'unit',
        uid: unit.uid,
        label: uldUnitLabel(unit)
      });
    });
  });

  const numberSeen = new Map();
  units.forEach(unit => {
    const label = (unit.uld_number || '').trim().toUpperCase();
    if (!label) return;
    if (numberSeen.has(label)) {
      issues.push({
        code: 'DUPLICATE_ULD', level: 'warn', scope: 'sheet',
        uid: unit.uid, label: uldUnitLabel(unit),
        detail: `${label} 重複`
      });
    } else {
      numberSeen.set(label, unit.uid);
    }
  });

  mawbs.forEach(row => {
    if (row.units.length > 1 && row.hasZeroSplit) {
      issues.push({
        code: 'MAWB_SPLIT_MISSING', level: 'warn', scope: 'sheet',
        uid: row.units[0], label: row.mawb,
        detail: '分板重量未填（可用「依件數拆分」）'
      });
    }
  });

  const totals = units.reduce((acc, unit) => {
    acc.unitCount += 1;
    if (unit.calc.kind === 'BULK') acc.bulkCount += 1;
    acc.rclTotal += unit.calc.rclGross;
    acc.tareTotal += unit.calc.tare;
    acc.netTotal += unit.calc.finalSum;
    acc.diffTotal += unit.calc.diff;
    acc.pcsTotal += unit.calc.pcsSum;
    return acc;
  }, { unitCount: 0, bulkCount: 0, rclTotal: 0, tareTotal: 0, netTotal: 0, diffTotal: 0, pcsTotal: 0 });
  totals.mawbCount = mawbs.length;
  // 磅差 % 以 RCL（淨重）合計為分母（RCL 已是淨重，不再扣 Tare）
  totals.diffPct = totals.rclTotal > 0
    ? (totals.diffTotal / totals.rclTotal) * 100
    : 0;
  totals.hasError = issues.some(i => i.level === 'error');

  return { units, mawbs, issues, totals, options: opts };
}

// ===== 依 Booking Record 彙總最終重量（Phase 2 W2：回寫 mawb_records.gross_weight）=====
// computed = uldComputeSheet() 的回傳值；明細需帶 mawb_record_id（可為 null）。
// 同一票跨多板會加總（與 MAWB 彙總一致），最後四捨五入到 1 位小數（取整單位最小 0.5）。
// 回傳：
//   entries   [{ mawb_record_id, mawb, final, declared, pcs, itemCount, unitCount }]  可回寫的票
//   unlinked  [{ mawb, final, declared, pcs, itemCount }]                            未連結 Booking（不回寫）
//   conflicts [{ mawb, mawb_record_id, reason }]                                     資料不一致，安全起見不回寫
// reason：'duplicate_booking'（同一 MAWB 對到多個 Booking）／'mawb_mismatch'（同一 Booking 有多個 MAWB 號碼）
export function uldBookingTotals(computed) {
  const units = (computed && computed.units) || [];
  const byBooking = new Map(); // mawb_record_id → 彙總列
  const byMawbKey = new Map(); // MAWB 鍵 → Set(mawb_record_id)
  const unlinkedMap = new Map(); // MAWB 鍵 → 彙總列（沒有 Booking 連結）

  function totalOf(row, it, unitUid) {
    row.final += uldNum(it.final);
    row.declared += uldNum(it.declared);
    row.pcs += uldNum(it.pcs);
    row.itemCount += 1;
    if (unitUid != null && !row.unitKeys.includes(unitUid)) row.unitKeys.push(unitUid);
  }

  units.forEach(unit => {
    const items = (unit.calc && unit.calc.items) || [];
    items.forEach(it => {
      const key = uldMawbKey(it.mawb);
      if (!key) return;
      const recordId = it.mawb_record_id || null;
      if (!recordId) {
        let row = unlinkedMap.get(key);
        if (!row) {
          row = { mawb: it.mawb, final: 0, declared: 0, pcs: 0, itemCount: 0, unitKeys: [] };
          unlinkedMap.set(key, row);
        }
        totalOf(row, it, unit.uid);
        return;
      }
      if (!byMawbKey.has(key)) byMawbKey.set(key, new Set());
      byMawbKey.get(key).add(recordId);

      let row = byBooking.get(recordId);
      if (!row) {
        row = {
          mawb_record_id: recordId, mawb: it.mawb,
          final: 0, declared: 0, pcs: 0, itemCount: 0, unitKeys: [], mawbKeys: []
        };
        byBooking.set(recordId, row);
      }
      if (!row.mawbKeys.includes(key)) row.mawbKeys.push(key);
      totalOf(row, it, unit.uid);
    });
  });

  const entries = [];
  const conflicts = [];
  byBooking.forEach(row => {
    const ids = byMawbKey.get(row.mawbKeys[0]) || new Set();
    const reason = row.mawbKeys.length > 1
      ? 'mawb_mismatch'
      : (ids.size > 1 ? 'duplicate_booking' : '');
    if (reason) {
      conflicts.push({ mawb: row.mawb, mawb_record_id: row.mawb_record_id, reason });
      return;
    }
    entries.push({
      mawb_record_id: row.mawb_record_id,
      mawb: row.mawb,
      final: Number(row.final.toFixed(1)),
      declared: Number(row.declared.toFixed(1)),
      pcs: row.pcs,
      itemCount: row.itemCount,
      unitCount: row.unitKeys.length
    });
  });
  entries.sort((a, b) => String(a.mawb).localeCompare(String(b.mawb)));

  const unlinked = [...unlinkedMap.values()].map(row => ({
    mawb: row.mawb,
    final: Number(row.final.toFixed(1)),
    declared: Number(row.declared.toFixed(1)),
    pcs: row.pcs,
    itemCount: row.itemCount
  }));
  conflicts.sort((a, b) => String(a.mawb).localeCompare(String(b.mawb)));

  return { entries, unlinked, conflicts };
}

// 單位顯示名稱（ULD 號／BULK 批號）
export function uldUnitLabel(unit) {
  const name = (unit && (unit.uld_number || unit.bulk_ref)) || '';
  return name || (unit && unit.kind === 'BULK' ? 'BULK' : 'ULD');
}

// ===== 依件數比例拆分一票 MAWB 的重量（交散貨／同票分板用）=====
// 回傳與 items 同長度的重量陣列；取整單位 inc（預設 1），尾差給件數最多的一筆
export function uldSplitByPcs(totalWeight, items, inc = 1) {
  const list = Array.isArray(items) ? items : [];
  const step = uldNum(inc) > 0 ? uldNum(inc) : 1;
  const totalTicks = Math.round(uldCeilTo(uldNum(totalWeight), step) / step);
  const pcsList = list.map(it => Math.max(0, uldNum(it && it.pcs)));
  let pcsTotal = pcsList.reduce((sum, v) => sum + v, 0);
  const bases = pcsTotal > 0 ? pcsList : list.map(() => 1);
  if (!(pcsTotal > 0)) pcsTotal = list.length;
  if (!list.length) return [];

  const exact = bases.map(v => (v / pcsTotal) * totalTicks);
  const ticks = exact.map(v => Math.floor(v + 1e-9));
  let deficit = totalTicks - ticks.reduce((sum, v) => sum + v, 0);
  const order = exact
    .map((v, idx) => ({ idx, frac: v - ticks[idx], pcs: bases[idx] }))
    .sort((a, b) => (b.frac - a.frac) || (b.pcs - a.pcs));
  let i = 0;
  while (deficit > 0 && order.length) {
    ticks[order[i % order.length].idx] += 1;
    deficit -= 1;
    i += 1;
  }
  return ticks.map(v => Number((v * step).toFixed(6)));
}

// ===== 方案 B：MAWB 申報列 → 各板重量分配 =====
// 一票 MAWB 的「申報重量」放在表級（`uld_weight_mawbs`），各板只填件數；
// 重量依件數比例分到各板（Σ 一定等於該票申報重量，尾差給件數最多的一筆）。
// 這裡是**唯一**的分配規則：前端、後端、載荷表顯示都呼叫這支，避免三套算法。
export function uldAllocateByPcs(totalWeight, cells) {
  const list = Array.isArray(cells) ? cells : [];
  if (!list.length) return [];
  const total = Math.max(0, uldNum(totalWeight));
  const pcsList = list.map(cell => Math.max(0, uldNum(cell && cell.pcs)));
  let pcsTotal = pcsList.reduce((sum, v) => sum + v, 0);
  const bases = pcsTotal > 0 ? pcsList : list.map(() => 1);
  if (!(pcsTotal > 0)) pcsTotal = list.length;

  const out = bases.map(v => Number(((v / pcsTotal) * total).toFixed(3)));
  const diff = Number((total - out.reduce((sum, v) => sum + v, 0)).toFixed(3));
  if (Math.abs(diff) > 1e-9) {
    let maxIdx = 0;
    bases.forEach((v, i) => { if (v > bases[maxIdx]) maxIdx = i; });
    out[maxIdx] = Math.max(0, Number((out[maxIdx] + diff).toFixed(3)));
  }
  return out;
}

// 把整張表的「申報列」套回各板明細（就地修改 item.declared_weight）
// 規則：
//   1. 只有 `auto_alloc !== 0` 的列會依件數重算（手動分配的舊資料 auto_alloc = 0，重量不動）
//   2. 沒有對應申報列的明細（舊資料／臨時列）維持原重量
//   3. 一票只在一板 → 整票重量都在那一板
// 回傳 { changed }：有幾個明細的重量被調整（給存檔／測試用）
export function uldApplyMawbAllocation(sheet) {
  const src = sheet || {};
  const rows = Array.isArray(src.mawbs) ? src.mawbs : [];
  if (!rows.length) return { changed: 0 };

  const rowByKey = new Map();
  rows.forEach(row => {
    const key = uldMawbKey(row && row.mawb);
    if (key && !rowByKey.has(key)) rowByKey.set(key, row);
  });

  const cellsByKey = new Map();
  (src.ulds || []).forEach(unit => {
    (unit.items || []).forEach(item => {
      const key = uldMawbKey(item && item.mawb);
      if (!key || !rowByKey.has(key)) return;
      if (!cellsByKey.has(key)) cellsByKey.set(key, []);
      cellsByKey.get(key).push({ unit, item });
    });
  });

  let changed = 0;
  cellsByKey.forEach((cells, key) => {
    const row = rowByKey.get(key);
    if (!row) return;
    // 手動分配（auto_alloc = 0，例如舊資料自動長出來的列）→ 保留各板原本填的重量
    if (row.auto_alloc === 0 || row.auto_alloc === false) return;
    const weights = uldAllocateByPcs(row.declared_weight, cells.map(cell => ({ pcs: cell.item.pcs })));
    cells.forEach((cell, i) => {
      const next = weights[i];
      if (Math.abs(uldNum(cell.item.declared_weight) - next) > 1e-6) changed += 1;
      cell.item.declared_weight = next;
    });
  });
  return { changed };
}

// 檢核代碼 → 中文說明
export function uldIssueText(issue) {
  const base = ULD_ISSUE_LABELS[issue && issue.code] || (issue && issue.code) || '未知問題';
  return issue && issue.detail ? `${base}：${issue.detail}` : base;
}

