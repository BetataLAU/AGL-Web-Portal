/**
 * bp3d/ga-lns/init.js
 * 將專案資料轉為內部求解資料結構（normalizeItems / resolveUlDs）。
 */
'use strict';

const { resolveUld } = require('../uld-definitions');

/**
 * 將資料庫 items（cm/kg）轉成內部單件 items（mm/kg）。
 * @param {Array} projectItems 資料庫 items（含 length_cm, width_cm, height_cm, pcs, weight_kg...）
 * @returns {Array} 展開單件的內部 item
 */
function normalizeItems(projectItems) {
  const items = [];
  projectItems.forEach((it) => {
    const qty = Number(it.pcs || 1);
    const volumeM3 = (it.length_cm * it.width_cm * it.height_cm) / 1e6;
    for (let k = 0; k < qty; k++) {
      items.push({
        id: qty > 1 ? `${it.id}#${k + 1}` : String(it.id),
        groupId: String(it.id),
        l: it.length_cm * 10, // cm → mm
        w: it.width_cm * 10,
        h: it.height_cm * 10,
        weightKg: it.weight_kg,
        volume: volumeM3,
        density: volumeM3 > 0 ? it.weight_kg / volumeM3 : 0,
        isStackable: it.is_stackable !== false && it.is_stackable !== 0,
        allowRotateX: true,
        allowRotateY: true,
        allowRotateZ: true,
        mustStayUpright: false,
        customerId: it.customer_id,
      });
    }
  });
  return items;
}

/**
 * 將資料庫 ulds（含 contour_config）轉成內部 uldInfo（含半空間 planes）。
 * @param {Array} ulds 資料庫 ulds
 * @returns {Array} [{id, label, uld_type, l, w, h, maxWeightKg, maxFloorPressureKgM2, planes}]
 */
function resolveUlDs(ulds) {
  return (ulds || []).map((u) => {
    const spec = { type: u.uld_type };
    if (u.contour_config && u.contour_config.maxHeightMm) {
      spec.max_height_mm = u.contour_config.maxHeightMm;
    }
    const { def, planes } = resolveUld(spec);
    return {
      id: u.id,
      label: u.label || u.uld_type,
      uld_type: u.uld_type,
      l: def.baseL,
      w: def.baseW,
      h: def.maxHeightMm,
      maxWeightKg: Number(u.max_weight_kg || def.maxWeightKg),
      maxFloorPressureKgM2: def.maxFloorPressureKgM2,
      planes,
    };
  });
}

module.exports = {
  normalizeItems,
  resolveUlDs,
};