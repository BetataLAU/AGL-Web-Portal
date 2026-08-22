/**
 * bp3d/ga-lns/fitness.js
 * 染色體解碼（decode）與適應度評估。
 *
 * 解碼流程：
 *   對染色體中的順序逐件處理 → 使用 Extreme Point（EP）貪婪放置到指定 ULD
 *   → 統計各 ULD 體積/重量利用率、CoG、地面壓力 → 計算多目標 fitness。
 *
 * fitness（越低越好）：
 *   f1 = 1 - 體積利用率
 *   f2 = 未放置件數 / 總件數
 *   f3 = 地面壓力違規懲罰（0.1）
 *   f4 = CoG 偏移比例（0~1）
 *   fitness = 0.6*f1 + 0.3*f2 + 0.07*f3 + 0.03*f4
 */
'use strict';

const ep = require('../extreme-points');
const constraints = require('../constraints');

/**
 * 貪婪放置單件貨物到指定 ULD（檢查碰撞、支撐、總重、堆疊承重）。
 * @returns {{placed: boolean, placement: object|null}}
 */
function greedyPlaceOne(item, uldInfo, placedList, candidatePoints, options) {
  const placement = ep.findBestPlacement(item, candidatePoints, placedList, uldInfo.planes, options);
  if (!placement) return { placed: false, placement: null };

  const totalCheck = constraints.checkTotalWeight(
    placedList.concat([{ weightKg: item.weightKg }]),
    uldInfo.maxWeightKg
  );
  if (!totalCheck.ok) return { placed: false, placement: null };

  const stackCheck = constraints.checkStackWeight({ ...placement, weightKg: item.weightKg }, placedList);
  if (!stackCheck.ok) return { placed: false, placement: null };

  return { placed: true, placement };
}

/**
 * 解碼染色體：依 order 逐件放置到指定 ULD。
 * @returns {{placedByUld: Array<Array>, unplaced: Array<{id, idx}>}}
 */
function decodeChromosome(chromosome, items, uldInfos, options) {
  const placedByUld = [];
  const unplaced = [];
  const candidatesByUld = [];

  uldInfos.forEach((u, ui) => {
    placedByUld[ui] = [];
    candidatesByUld[ui] = ep.initialCandidatePoints(u.planes, { l: u.l, w: u.w });
  });

  for (const itemIdx of chromosome.order) {
    const item = items[itemIdx];
    const targetUldIdx = chromosome.uldAssign[itemIdx];

    const result = greedyPlaceOne(item, uldInfos[targetUldIdx], placedByUld[targetUldIdx], candidatesByUld[targetUldIdx], options);
    if (!result.placed) {
      unplaced.push({ id: item.id, idx: itemIdx });
      continue;
    }

    const p = result.placement;
    const placedItem = {
      id: item.id,
      groupId: item.groupId,
      customerId: item.customerId,
      x: p.x, y: p.y, z: p.z,
      l: p.orientation[0], w: p.orientation[1], h: p.orientation[2],
      weightKg: item.weightKg,
      volume: item.volume,
      density: item.density,
      isStackable: item.isStackable,
      uldIdx: targetUldIdx,
    };

    // 更新下方貨物支撐負載
    for (const prev of placedByUld[targetUldIdx]) {
      const prevTop = prev.z + prev.h;
      if (Math.abs(prevTop - placedItem.z) < 1e-6) {
        const a = constraints.rectIntersectArea(
          { x: placedItem.x, y: placedItem.y, l: placedItem.l, w: placedItem.w },
          { x: prev.x, y: prev.y, l: prev.l, w: prev.w }
        );
        if (a > 0) {
          prev.supportedLoadKg = (prev.supportedLoadKg || 0) + placedItem.weightKg * (a / (placedItem.l * placedItem.w));
        }
      }
    }

    placedByUld[targetUldIdx].push(placedItem);

    // 加入新極點
    const newPts = ep.updateCandidatePoints(placedItem, placedByUld[targetUldIdx], uldInfos[targetUldIdx].planes);
    for (const np of newPts) {
      if (!candidatesByUld[targetUldIdx].some((c) =>
        Math.abs(c.x - np.x) < 1e-6 && Math.abs(c.y - np.y) < 1e-6 && Math.abs(c.z - np.z) < 1e-6
      )) {
        candidatesByUld[targetUldIdx].push(np);
      }
    }
  }

  return { placedByUld, unplaced };
}

/**
 * 計算方案統計（體積/重量利用率、CoG、地面壓力）。
 */
function computeStats(placedByUld, unplaced, items, uldInfos) {
  let totalVolumeUsed = 0;
  let totalVolumeCapacity = 0;
  let totalWeight = 0;
  let totalWeightCapacity = 0;
  let cogX = 0, cogY = 0, cogZ = 0;
  let weightSum = 0;
  let floorViolation = false;
  let maxFloorPressure = 0;

  uldInfos.forEach((u, ui) => {
    const list = placedByUld[ui];
    const capacityM3 = (u.l * u.w * u.h) / 1e9;
    totalVolumeCapacity += capacityM3;

    for (const p of list) {
      totalVolumeUsed += p.volume;
      totalWeight += p.weightKg;
      const centerX = p.x + p.l / 2 - u.l / 2;
      const centerY = p.y + p.w / 2 - u.w / 2;
      const centerZ = p.z + p.h / 2;
      cogX += centerX * p.weightKg;
      cogY += centerY * p.weightKg;
      cogZ += centerZ * p.weightKg;
      weightSum += p.weightKg;
    }
    totalWeightCapacity += u.maxWeightKg;

    const fc = constraints.checkFloorPressure(list, u.maxFloorPressureKgM2);
    if (!fc.ok) floorViolation = true;
    maxFloorPressure = Math.max(maxFloorPressure, fc.maxPressure || 0);
  });

  const placedCount = items.length - unplaced.length;
  const volumeUtilization = totalVolumeCapacity > 0 ? (totalVolumeUsed / totalVolumeCapacity) * 100 : 0;
  const weightUtilization = totalWeightCapacity > 0 ? (totalWeight / totalWeightCapacity) * 100 : 0;

  const cog = weightSum > 0
    ? { x: cogX / weightSum, y: cogY / weightSum, z: cogZ / weightSum }
    : { x: 0, y: 0, z: 0 };

  const maxDim = Math.max(...uldInfos.map((u) => Math.max(u.l, u.w)));
  const cogOffsetRatio = maxDim > 0 ? Math.sqrt(cog.x * cog.x + cog.y * cog.y) / (maxDim / 2) : 0;

  return {
    placedCount,
    unplacedCount: unplaced.length,
    volumeUtilization,
    weightUtilization,
    totalWeight,
    totalWeightCapacity,
    volumeUsed: totalVolumeUsed,
    volumeCapacity: totalVolumeCapacity,
    cog,
    cogOffsetRatio,
    floorViolation,
    maxFloorPressure,
  };
}

/**
 * 計算適應度（越小越好）。
 */
function fitness(stats, itemsTotal) {
  const f1 = 1 - (stats.volumeUtilization / 100);
  const f2 = itemsTotal > 0 ? stats.unplacedCount / itemsTotal : 0;
  const f3 = stats.floorViolation ? 0.1 : 0;
  const f4 = Math.min(1, stats.cogOffsetRatio);
  return 0.6 * f1 + 0.3 * f2 + 0.07 * f3 + 0.03 * f4;
}

/**
 * 評估一群染色體（解碼 + 統計 + fitness）。
 * @returns {Array<{chromosome, placedByUld, unplaced, stats, fitness}>}
 */
function evaluatePopulation(pop, items, uldInfos, options) {
  return pop.map((chrom) => {
    const { placedByUld, unplaced } = decodeChromosome(chrom, items, uldInfos, options);
    const stats = computeStats(placedByUld, unplaced, items, uldInfos);
    return {
      chromosome: chrom,
      placedByUld,
      unplaced,
      stats,
      fitness: fitness(stats, items.length),
    };
  });
}

module.exports = {
  greedyPlaceOne,
  decodeChromosome,
  computeStats,
  fitness,
  evaluatePopulation,
};