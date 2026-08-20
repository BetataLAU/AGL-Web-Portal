/**
 * routes/packing.js
 * 3D ULD 裝箱系統 API 路由。
 *
 * POST /api/packing/pack-uld  — 求解裝載計劃（對應 Spec §5）
 * GET  /api/packing/ulds      — 可用 ULD 清單（前端選單用）
 * GET  /api/packing/health    — 服務健康檢查
 */
const express = require('express');

const { solve, normalizeCargo } = require('../bp3d/solver');
const { getUldCodes, getUldRenderInfo, ALL_ULDS } = require('../bp3d/uld-definitions');

const router = express.Router();

// ===== 健康檢查 =====
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    engine: 'bp3d',
    uldTypes: getUldCodes(),
    strategies: ['density', 'large', 'weight', 'footprint'],
  });
});

// ===== ULD 清單 =====
router.get('/ulds', (req, res) => {
  const list = getUldCodes().map((code) => getUldRenderInfo(code));
  res.json({ data: list });
});

// ===== 主求解 API =====
// POST /api/packing/pack-uld
// Body:
// {
//   "uld_spec": { "type": "AKE", "contour_type": "LD3_STANDARD", "max_weight_kg": 1588, ... },
//   "cargo_list": [ { "id": "PKG-001", "length_mm": 500, "width_mm": 400, "height_mm": 300, "weight_kg": 12.5, "quantity": 10, ... } ],
//   "options": { "min_support_ratio": 0.7, "cog_tolerance_ratio": 0.1 }  // 可選
// }
router.post('/pack-uld', (req, res) => {
  try {
    const { uld_spec, cargo_list, options } = req.body || {};

    // 輸入驗證
    if (!uld_spec || typeof uld_spec !== 'object') {
      return res.status(400).json({ error: 'uld_spec is required' });
    }
    if (!Array.isArray(cargo_list) || cargo_list.length === 0) {
      return res.status(400).json({ error: 'cargo_list must be a non-empty array' });
    }

    // 選項正規化（API 用 snake_case，內部轉 camelCase）
    const solverOptions = {};
    if (options) {
      if (options.min_support_ratio !== undefined) solverOptions.minSupportRatio = Number(options.min_support_ratio);
      if (options.cog_tolerance_ratio !== undefined) solverOptions.cogToleranceRatio = Number(options.cog_tolerance_ratio);
    }

    const result = solve(uld_spec, cargo_list, solverOptions);
    res.json(result);
  } catch (err) {
    console.error('pack-uld error:', err.message);
    res.status(400).json({ error: err.message });
  }
});

// ===== 快速示範 API（內建範例資料，供前端測試/展示）=====
router.get('/demo', (req, res) => {
  const demo = {
    uld_spec: {
      type: 'PMC',
      max_weight_kg: 6804,
      max_floor_pressure_kg_m2: 1953,
      net_clearance_mm: 30,
    },
    cargo_list: [
      { id: 'PKG-A', length_mm: 600, width_mm: 400, height_mm: 400, weight_kg: 45, quantity: 12, is_stackable: true },
      { id: 'PKG-B', length_mm: 800, width_mm: 500, height_mm: 350, weight_kg: 80, quantity: 8, is_stackable: true },
      { id: 'PKG-C', length_mm: 1200, width_mm: 800, height_mm: 600, weight_kg: 250, quantity: 4, is_stackable: false },
      { id: 'PKG-D', length_mm: 400, width_mm: 300, height_mm: 200, weight_kg: 15, quantity: 20, is_stackable: true, allow_tilt: false },
      { id: 'PKG-E', length_mm: 1000, width_mm: 700, height_mm: 500, weight_kg: 180, quantity: 3, is_stackable: true, max_stack_weight: 400 },
    ],
  };
  try {
    const result = solve(demo.uld_spec, demo.cargo_list);
    res.json(result);
  } catch (err) {
    console.error('demo error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;