/**
 * bp3d/constraints.js
 * 空運 ULD 裝載約束檢查器：
 *   1. 總重量 <= ULD Payload
 *   2. 堆疊承重（max_stack_weight）
 *   3. 底部支撐率 >= 最小支撐率（防止懸空貨物）
 *   4. 地面壓力 <= max_floor_pressure
 *   5. CoG 在 ULD 幾何中心 ± 容許範圍內（X/Y 軸）
 *
 * 所有單位：mm / kg / kg/m²。
 */

// ===== 矩形面積交集工具 =====

/**
 * 計算兩個軸對齊矩形（XY 平面投影）的交集面積。
 * @param {object} a {x, y, l, w}
 * @param {object} b {x, y, l, w}
 * @returns {number} 交集面積（mm²）
 */
function rectIntersectArea(a, b) {
  const overlapX = Math.min(a.x + a.l, b.x + b.l) - Math.max(a.x, b.x);
  const overlapY = Math.min(a.y + a.w, b.y + b.w) - Math.max(a.y, b.y);
  if (overlapX <= 0 || overlapY <= 0) return 0;
  return overlapX * overlapY;
}

/**
 * 計算貨物底部被「支撐面」覆蓋的面積比。
 * 支撐面包括：
 *   - 地面（z === 0）
 *   - 其他貨物的頂面（由 `placed` 提供，且該貨物允許被疊放）
 *
 * @param {object} item 候選貨物 {x, y, z, l, w, h, id}
 * @param {Array<object>} placed 已放置貨物（含 x,y,z,l,w,h,isStackable,supportArea）
 * @param {number} minSupportRatio 最小支撐率（0-1）
 * @returns {{ratio: number, supported: boolean, supportSources: Array}}
 */
function checkSupportRatio(item, placed, minSupportRatio = 0.7) {
  const bottom = { x: item.x, y: item.y, l: item.l, w: item.w };
  let coveredArea = 0;

  // 地面（貨物底層）
  if (Math.abs(item.z) < 1e-6) {
    // 整塊貨物底面都貼地 => 支撐率 1
    return { ratio: 1, supported: true, supportSources: ['floor'] };
  }

  const supportSources = [];
  for (const p of placed) {
    const pTopZ = p.z + p.h;
    // 支撐貨物頂面約等於此貨物底面
    if (Math.abs(pTopZ - item.z) < 1e-6) {
      // 檢查下方貨物是否可堆疊
      if (!p.isStackable) return { ratio: 0, supported: false, supportSources, reason: `Unsupported: sits on non-stackable item ${p.id}` };
      const area = rectIntersectArea(bottom, { x: p.x, y: p.y, l: p.l, w: p.w });
      coveredArea += area;
      supportSources.push({ id: p.id, area });
    }
  }

  const baseArea = item.l * item.w;
  const ratio = baseArea > 0 ? coveredArea / baseArea : 0;
  const supported = ratio + 1e-9 >= minSupportRatio;
  return { ratio, supported, supportSources };
}

/**
 * 檢查堆疊承重：此貨物放在哪些貨物上面，總共施加的重量不得超過下方
 * 貨物的 max_stack_weight。
 *
 * @param {object} item 候選貨物（含 weightKg）
 * @param {Array<object>} placed 已放置貨物（含 x,y,z,l,w,h,weightKg,maxStackWeight）
 * @returns {{ok: boolean, violations: Array}}
 */
function checkStackWeight(item, placed) {
  const violations = [];
  const baseArea = item.l * item.w;
  if (baseArea <= 0) return { ok: false, violations: [{ reason: 'Invalid zero-area item' }] };

  for (const p of placed) {
    const pTopZ = p.z + p.h;
    if (Math.abs(pTopZ - item.z) >= 1e-6) continue; // 不在正下方
    const overlap = rectIntersectArea(
      { x: item.x, y: item.y, l: item.l, w: item.w },
      { x: p.x, y: p.y, l: p.l, w: p.w }
    );
    if (overlap <= 0) continue;

    const ratio = overlap / baseArea; // 此貨物重量中壓在 p 上的比例
    const addedWeight = item.weightKg * ratio;
    const currentLoad = p.supportedLoadKg || 0;
    if (p.maxStackWeight !== undefined && p.maxStackWeight !== null && currentLoad + addedWeight > p.maxStackWeight + 1e-6) {
      violations.push({
        reason: `Stack weight exceeded: ${item.id} (+${addedWeight.toFixed(1)}kg) on ${p.id} (limit ${p.maxStackWeight}kg)`,
        itemId: item.id,
        supportId: p.id,
        currentLoad,
        addedWeight,
        limit: p.maxStackWeight,
      });
    }
  }
  return { ok: violations.length === 0, violations };
}

/**
 * 總重量檢查。
 * @param {Array<object>} placedItems 已放置貨物（含 weightKg）
 * @param {number} maxWeightKg ULD 最大承重
 * @returns {{ok: boolean, totalWeightKg: number, remainingKg: number}}
 */
function checkTotalWeight(placedItems, maxWeightKg) {
  const total = placedItems.reduce((s, it) => s + (it.weightKg || 0), 0);
  return {
    ok: total <= maxWeightKg + 1e-6,
    totalWeightKg: total,
    remainingKg: maxWeightKg - total,
  };
}

/**
 * 地面壓力檢查（貨物與下方支撐物的接觸面壓力）。
 * 簡化模型：對每件貨物，計算其與地面接觸（z=0）時單位面積重量；
 *  後期進階：加入分層壓力傳遞（p = 總疊層重量 / 接觸面積）。
 *
 * @param {Array<object>} placed 已放置貨物
 * @param {number} maxFloorPressureKgM2 最大地面壓力
 * @returns {{ok: boolean, violations: Array, maxPressure: number}}
 */
function checkFloorPressure(placed, maxFloorPressureKgM2) {
  const violations = [];
  let maxPressure = 0;

  // 對每件貼地貨物，累計其上方所有貨物重量 / 面積
  const floorItems = placed.filter((it) => Math.abs(it.z) < 1e-6);
  for (const base of floorItems) {
    const baseArea = (base.l * base.w) / 1e6; // mm² -> m²
    if (baseArea <= 0) continue;

    // 累加所有直接/間接疊在 base 上的重量
    // 簡化：直接計算「以 base 為柱底、位置重疊的上層貨物總重」
    let load = base.weightKg || 0;
    for (const other of placed) {
      if (other === base) continue;
      if (Math.abs(other.z) < 1e-6) continue; // 其他貼地貨不算
      // 粗略：與 base 的 XY 投影有重疊就算壓在 base 上（保守）
      const overlap = rectIntersectArea(
        { x: base.x, y: base.y, l: base.l, w: base.w },
        { x: other.x, y: other.y, l: other.l, w: other.w }
      );
      if (overlap > 0) load += other.weightKg || 0;
    }

    const pressure = load / baseArea; // kg/m²
    if (pressure > maxPressure) maxPressure = pressure;
    if (pressure > maxFloorPressureKgM2 + 1e-6) {
      violations.push({
        reason: `Floor pressure exceeded: ${base.id} area base ${pressure.toFixed(1)} kg/m² > limit ${maxFloorPressureKgM2}`,
        itemId: base.id,
        pressure,
        limit: maxFloorPressureKgM2,
      });
    }
  }

  return { ok: violations.length === 0, violations, maxPressure };
}

/**
 * 計算整板 CoG（質心，mm）。X / Y 方向以 ULD 底部中心為原點。
 * @param {Array<object>} placed 已放置貨物（含 x,y,z,l,w,h,weightKg）
 * @returns {{x: number, y: number, z: number}}
 */
function computeCog(placed) {
  let tx = 0;
  let ty = 0;
  let tz = 0;
  let tw = 0;
  for (const it of placed) {
    const w = it.weightKg || 0;
    // 每件貨物質心
    const cx = it.x + it.l / 2;
    const cy = it.y + it.w / 2;
    const cz = it.z + it.h / 2;
    tx += cx * w;
    ty += cy * w;
    tz += cz * w;
    tw += w;
  }
  if (tw === 0) return { x: 0, y: 0, z: 0 };
  return { x: tx / tw, y: ty / tw, z: tz / tw };
}

/**
 * CoG 範圍檢查：貨物總 CoG 必須落在 ULD 幾何中心 ± 容許比例內。
 *
 * @param {object} cog computeCog 的結果（x,y）
 * @param {object} uldBounds {l, w} ULD 外框尺寸（X/Y 方向）
 * @param {number} toleranceRatio 容許偏移比例（0-1，Spec 用 0.1）
 * @returns {{ok: boolean, dx: number, dy: number, limitX: number, limitY: number, warnings: Array}}
 */
function checkCogRange(cog, uldBounds, toleranceRatio = 0.1) {
  const limitX = (uldBounds.l / 2) * toleranceRatio;
  const limitY = (uldBounds.w / 2) * toleranceRatio;
  const dx = cog.x;
  const dy = cog.y;
  const okX = Math.abs(dx) <= limitX + 1e-6;
  const okY = Math.abs(dy) <= limitY + 1e-6;
  const warnings = [];
  if (!okX) warnings.push(`CoG X offset ${dx.toFixed(1)}mm exceeds limit ±${limitX.toFixed(1)}mm`);
  if (!okY) warnings.push(`CoG Y offset ${dy.toFixed(1)}mm exceeds limit ±${limitY.toFixed(1)}mm`);
  return {
    ok: okX && okY,
    dx,
    dy,
    limitX,
    limitY,
    warnings,
  };
}

module.exports = {
  rectIntersectArea,
  checkSupportRatio,
  checkStackWeight,
  checkTotalWeight,
  checkFloorPressure,
  computeCog,
  checkCogRange,
};