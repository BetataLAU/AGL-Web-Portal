/**
 * bp3d/solver.js
 * 主求解器：整合 ULD 解析、貨物正規化、排序策略、EP 放置、約束驗證。
 *
 * 流程：
 *   1. 解析 ULD（含 net clearance）
 *   2. 正規化貨物清單（展開 quantity、尺寸驗證、方向旗標）
 *   3. 以多個排序策略依序執行放置（heavy-first / large-first / density-first）
 *   4. 每個放置：EP 候選點 × 旋轉方向 → 支撐率/碰撞/堆疊承重檢查
 *   5. 完成後：總重量 / 地面壓力 / CoG 驗證
 *   6. 取裝載率最佳策略作為最終結果
 *
 * 單位：mm / kg / kg/m²。
 */

const { resolveUld, getUldRenderInfo } = require('./uld-definitions');
const geo = require('./geometries');
const ep = require('./extreme-points');
const constraints = require('./constraints');

const DEFAULT_OPTIONS = {
  minSupportRatio: 0.7,
  cogToleranceRatio: 0.1,
  maxIterationsPerStrategy: 3, // 每策略最多重試次數（重新排序小變動）
};

/** 排序策略定義（依「適合先放」優先度排序） */
const SORT_STRATEGIES = {
  // 重貨優先：密度大（重量/體積）先放，保護輕貨
  density: {
    name: 'Density (Heavy-First)',
    sort: (a, b) => (b.density - a.density) || (b.volume - a.volume),
  },
  // 大件優先：體積大先放，減少剩餘碎空間
  large: {
    name: 'Large Volume First',
    sort: (a, b) => (b.volume - a.volume) || (b.weightKg - a.weightKg),
  },
  // 重量優先
  weight: {
    name: 'Weight First',
    sort: (a, b) => (b.weightKg - a.weightKg) || (b.volume - a.volume),
  },
  // 底面積大優先：大底面積先放，建立穩定底層
  footprint: {
    name: 'Footprint (Base Area) First',
    sort: (a, b) => (b.l * b.w - a.l * a.w) || (b.height - a.height),
  },
};

/**
 * 正規化貨物輸入（展開 quantity 成單件）。
 * @param {Array<object>} cargoList API cargo_list
 * @returns {Array<object>} 展開後的單件清單
 */
function normalizeCargo(cargoList) {
  if (!Array.isArray(cargoList) || cargoList.length === 0) {
    throw new Error('cargo_list must be a non-empty array');
  }

  const items = [];
  cargoList.forEach((c, i) => {
    const id = String(c.id || `cargo-${i + 1}`);
    const l = Number(c.length_mm);
    const w = Number(c.width_mm);
    const h = Number(c.height_mm);
    const weight = Number(c.weight_kg);
    const qty = Number(c.quantity || 1);

    // 輸入驗證
    if (![l, w, h].every((v) => Number.isFinite(v) && v > 0)) {
      throw new Error(`Cargo ${id}: 尺寸必須為正數 (length/width/height_mm)`);
    }
    if (!Number.isFinite(weight) || weight <= 0) {
      throw new Error(`Cargo ${id}: weight_kg 必須為正數`);
    }
    if (!Number.isFinite(qty) || qty < 1 || !Number.isInteger(qty)) {
      throw new Error(`Cargo ${id}: quantity 必須為正整數`);
    }
    // 不合理的超大貨（> ULD 尺寸的 2 倍，晚點真正檢查）
    if (qty > 10000) {
      throw new Error(`Cargo ${id}: quantity 過大（>10000）`);
    }

    for (let k = 0; k < qty; k++) {
      const item = {
        id: qty > 1 ? `${id}#${k + 1}` : id,
        groupId: id,
        l,
        w,
        h,
        weightKg: weight,
        volume: (l * w * h) / 1e9, // m³
        density: weight / ((l * w * h) / 1e9), // kg/m³
        baseArea: l * w,
        isStackable: c.is_stackable !== false,
        allowRotateX: c.allow_rotation_x !== false,
        allowRotateY: c.allow_rotation_y !== false,
        allowRotateZ: c.allow_rotation_z !== false,
        mustStayUpright: c.must_stay_upright === true || c.allow_tilt === false,
        maxStackWeight: c.max_stack_weight !== undefined ? Number(c.max_stack_weight) : null,
      };
      items.push(item);
    }
  });
  return items;
}

/**
 * 執行單一策略的裝載。
 * @param {Array<object>} items 單件貨物（已排序）
 * @param {Array<Array<number>>} planes ULD 半空間（含 clearance）
 * @param {object} uldInfo {l, w, h, maxWeightKg}
 * @param {object} opts 選項
 * @returns {{placed: Array, unplaced: Array, placedCount: number, volumeUsed: number, stats: object}}
 */
function runStrategy(items, planes, uldInfo, opts) {
  const placed = [];
  const unplaced = [];
  const candidatePoints = ep.initialCandidatePoints(planes, { l: uldInfo.l, w: uldInfo.w });

  for (const item of items) {
    // 拆解單件再處理（items 已是展開後的單件）
    const placement = ep.findBestPlacement(item, candidatePoints, placed, planes, opts);
    if (!placement) {
      // 檢查是不是「單件太大」根本放不進去 → 記錄原因
      const fitsAnywhere = ep.generateOrientations(item).some(([l, w, h]) =>
        l <= uldInfo.l + 1 && w <= uldInfo.w + 1 && h <= uldInfo.h + 1
      );
      unplaced.push({
        id: item.id,
        reason: fitsAnywhere
          ? 'No feasible position found with current constraints'
          : `Item dimensions ${item.l}x${item.w}x${item.h} exceed ULD limits (${uldInfo.l}x${uldInfo.w}x${uldInfo.h})`,
        l: item.l,
        w: item.w,
        h: item.h,
        weightKg: item.weightKg,
        isStackable: item.isStackable,
      });
      continue;
    }

    // 建立放置後的實體記錄
    const [pl, pw, ph] = placement.orientation;
    const placedItem = {
      id: item.id,
      groupId: item.groupId,
      x: placement.x,
      y: placement.y,
      z: placement.z,
      l: pl,
      w: pw,
      h: ph,
      originalDimensions: { l: item.l, w: item.w, h: item.h },
      weightKg: item.weightKg,
      volume: item.volume,
      density: item.density,
      isStackable: item.isStackable,
      maxStackWeight: item.maxStackWeight,
      supportRatio: placement.supportRatio,
      stepIndex: placed.length, // 裝載順序（逐步動畫用）
      orientation: `(${pl},${pw},${ph})`,
    };

    // 重量與堆疊承重檢查（若超重，拒絕放置並重試其他位置 —— 簡化：先試其他位置）
    const totalCheck = constraints.checkTotalWeight(placed.concat(placedItem).map((p) => ({ weightKg: p.weightKg })), uldInfo.maxWeightKg);
    if (!totalCheck.ok) {
      unplaced.push({ id: item.id, reason: `ULD max gross weight exceeded (${totalCheck.totalWeightKg.toFixed(1)}kg > ${uldInfo.maxWeightKg}kg)` });
      continue;
    }

    const stackCheck = constraints.checkStackWeight(placedItem, placed);
    if (!stackCheck.ok) {
      unplaced.push({
        id: item.id,
        reason: stackCheck.violations[0].reason,
      });
      continue;
    }

    // 更新下方貨物的 supportedLoadKg
    for (const p of placed) {
      const pTop = p.z + p.h;
      if (Math.abs(pTop - placedItem.z) < 1e-6) {
        const overlapArea = constraints.rectIntersectArea(
          { x: placedItem.x, y: placedItem.y, l: placedItem.l, w: placedItem.w },
          { x: p.x, y: p.y, l: p.l, w: p.w }
        );
        if (overlapArea > 0) {
          p.supportedLoadKg = (p.supportedLoadKg || 0) + placedItem.weightKg * (overlapArea / (placedItem.l * placedItem.w));
        }
      }
    }

    placed.push(placedItem);

    // 加入新的極點候選
    const newPoints = ep.updateCandidatePoints(placedItem, placed, planes);
    for (const np of newPoints) {
      // 避免重複點
      if (!candidatePoints.some((c) => Math.abs(c.x - np.x) < 1e-6 && Math.abs(c.y - np.y) < 1e-6 && Math.abs(c.z - np.z) < 1e-6)) {
        candidatePoints.push(np);
      }
    }
  }

  // 統計
  const totalVolumeKgM3 = placed.reduce((s, p) => s + p.volume, 0);
  const uldVolumeM3 = (uldInfo.l * uldInfo.w * uldInfo.h) / 1e9;
  const totalWeight = placed.reduce((s, p) => s + p.weightKg, 0);

  return {
    placed,
    unplaced,
    placedCount: placed.length,
    volumeUsed: totalVolumeKgM3,
    volumeUtilization: uldVolumeM3 > 0 ? (totalVolumeKgM3 / uldVolumeM3) * 100 : 0,
    totalWeightKg: totalWeight,
    uldVolumeM3,
  };
}

/**
 * 主求解入口。
 * @param {object} uldSpec API uld_spec
 * @param {Array<object>} cargoList API cargo_list
 * @param {object} options 選項（可覆寫預設）
 * @returns {object} 完整求解結果（含逐步順序）
 */
function solve(uldSpec, cargoList, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const startedAt = Date.now();

  // 解析 ULD
  const { def, planes } = resolveUld(uldSpec);
  const uldInfo = {
    l: def.baseL,
    w: def.baseW,
    h: def.maxHeightMm,
    maxWeightKg: def.maxWeightKg,
    maxFloorPressureKgM2: def.maxFloorPressureKgM2,
  };

  // 正規化貨物
  const items = normalizeCargo(cargoList);

  // 執行多策略，取最佳
  const strategyKeys = Object.keys(SORT_STRATEGIES);
  let bestResult = null;
  let bestScore = -Infinity;
  const strategyResults = [];

  for (const key of strategyKeys) {
    // 深拷貝 items 排序（不影響原陣列）
    const ordered = [...items].sort(SORT_STRATEGIES[key].sort);

    // 每策略跑多次（微調排序：同優先級隨機微擾）— 只用 1 次，避免非確定性
    const result = runStrategy(ordered, planes, uldInfo, opts);

    // 最終全局檢查
    if (result.placed.length > 0) {
      // 地面壓力
      const floorCheck = constraints.checkFloorPressure(result.placed, uldInfo.maxFloorPressureKgM2);
      result.floorPressureOk = floorCheck.ok;
      result.maxFloorPressureKgM2Actual = floorCheck.maxPressure;

      // CoG
      const cog = constraints.computeCog(result.placed);
      const cogCheck = constraints.checkCogRange(cog, { l: uldInfo.l, w: uldInfo.w }, opts.cogToleranceRatio);
      result.cog = cog;
      result.cogCheck = cogCheck;
      result.cogOk = cogCheck.ok;
    } else {
      result.floorPressureOk = true;
      result.maxFloorPressureKgM2Actual = 0;
      result.cog = { x: 0, y: 0, z: 0 };
      result.cogOk = true;
      result.cogCheck = { ok: true, dx: 0, dy: 0, limitX: 0, limitY: 0, warnings: [] };
    }

    // 評分：裝載件數多 + 體積利用率高 + 重量高，但 CoG/壓力違規扣分
    let score = result.placedCount * 1000 + result.volumeUtilization;
    if (!result.floorPressureOk) score -= 500;
    if (!result.cogOk) score -= 300;

    strategyResults.push({
      strategyKey: key,
      strategyName: SORT_STRATEGIES[key].name,
      placedCount: result.placedCount,
      volumeUtilization: Number(result.volumeUtilization.toFixed(1)),
      totalWeightKg: Number(result.totalWeightKg.toFixed(1)),
      cogOk: result.cogOk,
      floorPressureOk: result.floorPressureOk,
      score,
    });

    if (score > bestScore) {
      bestScore = score;
      bestResult = { ...result };
      bestResult.strategyKey = key;
      bestResult.strategyName = SORT_STRATEGIES[key].name;
    }
  }

  // 輸出組裝
  const elapsedMs = Date.now() - startedAt;
  return {
    success: true,
    elapsedMs,
    uld: {
      type: def.code,
      name: def.name,
      geometryType: def.geometryType,
      dimensionsMm: { l: uldInfo.l, w: uldInfo.w, h: uldInfo.h },
      maxWeightKg: uldInfo.maxWeightKg,
      maxFloorPressureKgM2: uldInfo.maxFloorPressureKgM2,
      netClearanceMm: uldSpec.net_clearance_mm ?? def.netClearanceMm ?? 30,
      renderInfo: getUldRenderInfo(def.code, { netClearanceMm: uldSpec.net_clearance_mm }),
    },
    strategy: bestResult.strategyKey,
    strategyName: bestResult.strategyName,
    strategies: strategyResults,
    summary: {
      totalItems: items.length,
      placedCount: bestResult.placedCount,
      unplacedCount: bestResult.unplaced.length,
      volumeUtilizationPct: Number(bestResult.volumeUtilization.toFixed(1)),
      totalWeightKg: Number(bestResult.totalWeightKg.toFixed(1)),
      remainingWeightKg: Number((uldInfo.maxWeightKg - bestResult.totalWeightKg).toFixed(1)),
      cog: {
        xMm: Number(bestResult.cog.x.toFixed(1)),
        yMm: Number(bestResult.cog.y.toFixed(1)),
        zMm: Number(bestResult.cog.z.toFixed(1)),
        ok: bestResult.cogOk,
        warnings: bestResult.cogCheck.warnings,
      },
      floorPressureKgM2: Number(bestResult.maxFloorPressureKgM2Actual.toFixed(1)),
      floorPressureOk: bestResult.floorPressureOk,
    },
    sequence: bestResult.placed.map((p) => ({
      step: p.stepIndex + 1,
      id: p.id,
      x: p.x,
      y: p.y,
      z: p.z,
      l: p.l,
      w: p.w,
      h: p.h,
      weightKg: p.weightKg,
      supportRatio: Number(p.supportRatio.toFixed(2)),
      orientation: p.orientation,
    })),
    placed: bestResult.placed,
    unplaced: bestResult.unplaced,
  };
}

module.exports = {
  solve,
  normalizeCargo,
  runStrategy,
  SORT_STRATEGIES,
};