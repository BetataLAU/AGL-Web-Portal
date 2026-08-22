/**
 * public/js/uld-packing/calc.js
 * 重量與體積計算（IATA 標準）：體積重 V.W、CBM、輕泡判斷、ULD 容量。
 */
(function () {
  'use strict';

  const DIVISOR = 6000;        // IATA 體積重除數
  const CBM_DIVISOR = 1000000; // cm³ → m³

  /**
   * 單件體積重（KG）：長×寬×高(cm) / 6000
   */
  function volumeWeightOne(lCm, wCm, hCm) {
    return (lCm * wCm * hCm) / DIVISOR;
  }

  /**
   * 單件 CBM：長×寬×高(cm) / 1,000,000
   */
  function cbmOne(lCm, wCm, hCm) {
    return (lCm * wCm * hCm) / CBM_DIVISOR;
  }

  /**
   * 貨物群組總體積重（含 PCS）
   */
  function volumeWeightTotal(lCm, wCm, hCm, pcs) {
    return volumeWeightOne(lCm, wCm, hCm) * (pcs || 1);
  }

  /**
   * 貨物群組總 CBM（含 PCS）
   */
  function cbmTotal(lCm, wCm, hCm, pcs) {
    return cbmOne(lCm, wCm, hCm) * (pcs || 1);
  }

  /**
   * 是否為輕泡貨：體積重 > 毛重
   */
  function isLightBubble(lCm, wCm, hCm, pcs, weightKg) {
    const vw = volumeWeightTotal(lCm, wCm, hCm, pcs);
    const gw = weightKg * (pcs || 1);
    return vw > gw;
  }

  /**
   * 估算 ULD 可用容量（CBM）
   * 以基座尺寸 × 最大高度估算；若提供 contour_config 使用其 baseL/baseW/maxHeightMm。
   * @param {object} uld 含 contour_config {baseL, baseW, maxHeightMm}（mm）
   * @returns {number} CBM
   */
  function uldCapacityCbm(uld) {
    const cfg = (uld && uld.contour_config) || {};
    const lMm = cfg.baseL || 3175;
    const wMm = cfg.baseW || 2438;
    const hMm = cfg.maxHeightMm || 3000;
    return (lMm * wMm * hMm) / 1e9;
  }

  /**
   * ULD 限載（KG）。contour_config 不帶重量，UID 由 uld_type 對應後端定義。
   * 前端 fallback 對照表（僅用於顯示估算；實際以 API 回傳 max_weight_kg 為準）。
   */
  const FALLBACK_WEIGHTS = {
    'PMC': 6804, 'PAG': 6804, 'PAP': 4626, 'P1P': 4626, 'P6P': 6804,
    'AKE': 1588, 'AKH': 1588, 'ALF': 3175, 'AMA': 3175,
    'PMC-Q6': 6804, 'PMC-Q7': 6804, 'PAG-Q7': 6804, 'Q7-00': 6804,
  };

  function uldMaxWeight(uld) {
    if (uld && uld.max_weight_kg) return uld.max_weight_kg;
    if (uld && uld.uld_type) return FALLBACK_WEIGHTS[uld.uld_type] || 6804;
    return 6804;
  }

  /** 依目前單位模式格式化數字 */
  function fmt(n, digits) {
    const d = digits === undefined ? 1 : digits;
    return Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: 0 });
  }

  // ===== 對外 =====
  window.UPCalc = {
    volumeWeightOne,
    cbmOne,
    volumeWeightTotal,
    cbmTotal,
    isLightBubble,
    uldCapacityCbm,
    uldMaxWeight,
    fmt,
  };
})();