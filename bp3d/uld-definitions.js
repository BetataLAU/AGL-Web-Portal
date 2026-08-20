/**
 * bp3d/uld-definitions.js
 * ULD 規格庫：內建常見 ULD 類型的幾何與物理參數。
 *
 * 所有尺寸單位：mm；重量：kg。
 * 座標：原點 = ULD 底部中心，X = 深度，Y = 寬度，Z = 高度。
 *
 * 註：實際 ULD 規格會因航空公司/機型/製造商略有差異，
 *     此處採用業界常用數值（IATA ULD Regulations 近似值），
 *     必要時可在 API 請求中覆寫（uld_spec 傳入客製屬性）。
 */
const {
  createRectangularHalfspaces,
  createExtrudedPolygonHalfspaces,
  shrinkHalfspaces,
} = require('./geometries');

// ===== 內部計算用（建立幾何的快取） =====
const geometryCache = new Map();

/** 產生已套用 net clearance 的半空間集合（有快取） */
function buildHalfspaces(uid, netClearanceMm) {
  const key = `${uid}|${netClearanceMm}`;
  if (geometryCache.has(key)) return geometryCache.get(key);

  const def = ALL_ULDS[uid];
  if (!def) throw new Error(`Unknown ULD type: ${uid}`);

  let planes;
  switch (def.geometryType) {
    case 'rectangular':
      planes = createRectangularHalfspaces(def.baseL, def.baseW, def.maxHeightMm);
      break;
    case 'extrudedProfile':
      planes = createExtrudedPolygonHalfspaces(def.baseL, PROFILE2D[def.profileKey]);
      break;
    default:
      throw new Error(`Unsupported geometryType: ${def.geometryType}`);
  }

  // Net Clearance：把可用空間向內縮（網套/綁帶預留）
  const clearance = netClearanceMm || 0;
  const result = clearance > 0 ? shrinkHalfspaces(planes, clearance) : planes;

  geometryCache.set(key, result);
  return result;
}

/**
 * 預先定義的 Y-Z 截面頂點（逆時針）。
 * 每個頂點：[y, z]。
 */
const PROFILE2D = {
  // AKE / AKH / ALF / AMA（底部矩形段 + 頂部斜切展開段）
  // 底部寬 W_bottom，斜切段高 H_tilt，總高 H_total，頂部寬 W_top
  'LD3_STANDARD': [
    [-781, 0],          // 左下（底部寬 1562）
    [781, 0],           // 右下
    [1003.5, 1190],     // 右下斜切起點（頂部寬 2007 開始）
    [1003.5, 1600],     // 右上（總高 1600）
    [-1003.5, 1600],    // 左上
    [-1003.5, 1190],    // 左上斜切起點
  ],
  // AKH：較高的半尺寸容器，斜切段更高
  'AKH_STANDARD': [
    [-746, 0],
    [746, 0],
    [1087, 1489],
    [1087, 1829],
    [-1087, 1829],
    [-1087, 1489],
  ],
  // ALF：A 型前端全尺寸容器，底部斜切（貨物門）
  'ALF_STANDARD': [
    [-767, 0],
    [767, 0],
    [767, 1626],
    [-767, 1626],
  ],
  // AMA：半尺寸容器，底部斜切
  'AMA_STANDARD': [
    [-767, 0],
    [767, 0],
    [767, 1638],
    [-767, 1638],
  ],
  // PMC + Q6 輪廓（B747F / B777F 主艙中央輪廓近似）
  // 側壁垂直到 2000mm，上方兩側向內收，頂部保留 1219mm 寬平台到 2690mm
  'PMC_Q6': [
    [-1219, 0],
    [1219, 0],
    [1219, 2000],
    [609.5, 2690],
    [-609.5, 2690],
    [-1219, 2000],
  ],
  // PMC + Q7 輪廓（比 Q6 更高的中央平台）
  'PMC_Q7': [
    [-1219, 0],
    [1219, 0],
    [1219, 2032],
    [762, 3048],
    [-762, 3048],
    [-1219, 2032],
  ],
  // Q7-00：Contoured Main Deck ULD（用戶規格精確版）
  // 96"W × 125"D × 118"H；單邊（右側）45° 上緣收角
  //   底部寬 96"（±48"）、右側垂直壁高 96"、左側全高 118"
  //   頂部平台 x∈[0,74]（中心 y∈[-48,+26]"）、收角 x∈[74,96]（中心 y∈[+26,+48]"）
  //   收角：(x=96,z=96) → (x=74,z=118)  即 (y=+48",z=96") → (y=+26",z=118")
  'Q7_00': [
    [-1219.2, 0],       // 左下（底部左側 0"）
    [1219.2, 0],        // 右下（底部最寬 96"）
    [1219.2, 2438.4],   // 右側垂直壁頂（x=96", z=96"）
    [660.4, 2997.2],    // 45° 收角終點（x=74" → y=74-48=26", z=118"）
    [-1219.2, 2997.2],  // 左上（左側全高 118"）
  ],
};

// ===== ULD 定義 =====
// 參考 IATA ULD Regulations（近似值）：
// - 托盤最大高度 maxHeightMm = 該托盤在無輪廓限制下的「建議最大堆疊高度」，
//   貨物超過此高度時 solver 會拒絕放置（可在 API 覆寫）。
const ALL_ULDS = {
  // ===== 矩形托盤（無斜切） =====
  PMC: {
    code: 'PMC',
    name: 'Pallet PMC (B747F Main Deck)',
    type: 'pallet',
    geometryType: 'rectangular',
    baseL: 3160,
    baseW: 2438,
    maxHeightMm: 3000,        // 無輪廓限制時由網套高度決定，預設 3000
    maxWeightKg: 6804,
    tareWeightKg: 140,
    maxFloorPressureKgM2: 1953,
  },
  PAG: {
    code: 'PAG',
    name: 'Pallet PAG (B747F)',
    type: 'pallet',
    geometryType: 'rectangular',
    baseL: 3180,
    baseW: 2240,
    maxHeightMm: 3000,
    maxWeightKg: 6804,
    tareWeightKg: 130,
    maxFloorPressureKgM2: 1953,
  },
  PAP: {
    code: 'PAP',
    name: 'Pallet PAP (B747F)',
    type: 'pallet',
    geometryType: 'rectangular',
    baseL: 3180,
    baseW: 2240,
    maxHeightMm: 3000,
    maxWeightKg: 4626,
    tareWeightKg: 120,
    maxFloorPressureKgM2: 1953,
  },
  P1P: {
    code: 'P1P',
    name: 'Pallet P1P (90 x 125 in)',
    type: 'pallet',
    geometryType: 'rectangular',
    baseL: 3175,
    baseW: 2235,
    maxHeightMm: 3000,
    maxWeightKg: 4626,
    tareWeightKg: 115,
    maxFloorPressureKgM2: 1953,
  },
  P6P: {
    code: 'P6P',
    name: 'Pallet P6P (96 x 125 in)',
    type: 'pallet',
    geometryType: 'rectangular',
    baseL: 3175,
    baseW: 2438,
    maxHeightMm: 3000,
    maxWeightKg: 6804,
    tareWeightKg: 135,
    maxFloorPressureKgM2: 1953,
  },

  // ===== 斜切容器（LD3 家族） =====
  AKE: {
    code: 'AKE',
    name: 'Container AKE (LD3)',
    type: 'container',
    geometryType: 'extrudedProfile',
    profileKey: 'LD3_STANDARD',
    baseL: 1534,
    baseW: 2007,          // 外框最大寬
    maxHeightMm: 1600,
    maxWeightKg: 1588,
    tareWeightKg: 72,
    maxFloorPressureKgM2: 1000,
  },
  AKH: {
    code: 'AKH',
    name: 'Container AKH (LD3-46W)',
    type: 'container',
    geometryType: 'extrudedProfile',
    profileKey: 'AKH_STANDARD',
    baseL: 1534,
    baseW: 2174,
    maxHeightMm: 1829,
    maxWeightKg: 1588,
    tareWeightKg: 85,
    maxFloorPressureKgM2: 1000,
  },
  ALF: {
    code: 'ALF',
    name: 'Container ALF (A-type Full)',
    type: 'container',
    geometryType: 'extrudedProfile',
    profileKey: 'ALF_STANDARD',
    baseL: 3175,
    baseW: 1534,
    maxHeightMm: 1626,
    maxWeightKg: 3175,
    tareWeightKg: 130,
    maxFloorPressureKgM2: 1000,
  },
  AMA: {
    code: 'AMA',
    name: 'Container AMA (A-type Half)',
    type: 'container',
    geometryType: 'extrudedProfile',
    profileKey: 'AMA_STANDARD',
    baseL: 3175,
    baseW: 1534,
    maxHeightMm: 1638,
    maxWeightKg: 3175,
    tareWeightKg: 100,
    maxFloorPressureKgM2: 1000,
  },

  // ===== 輪廓托盤（Q6 / Q7 機艙輪廓限制） =====
  'PMC-Q6': {
    code: 'PMC-Q6',
    name: 'Pallet PMC + Q6 Contour (B747F)',
    type: 'pallet',
    geometryType: 'extrudedProfile',
    profileKey: 'PMC_Q6',
    baseL: 3160,
    baseW: 2438,
    maxHeightMm: 2690,
    maxWeightKg: 6804,
    tareWeightKg: 150,
    maxFloorPressureKgM2: 1953,
  },
  'PMC-Q7': {
    code: 'PMC-Q7',
    name: 'Pallet PMC + Q7 Contour (B777F)',
    type: 'pallet',
    geometryType: 'extrudedProfile',
    profileKey: 'PMC_Q7',
    baseL: 3160,
    baseW: 2438,
    maxHeightMm: 3048,
    maxWeightKg: 6804,
    tareWeightKg: 160,
    maxFloorPressureKgM2: 1953,
  },
  'PAG-Q7': {
    code: 'PAG-Q7',
    name: 'Pallet PAG + Q7 Contour',
    type: 'pallet',
    geometryType: 'extrudedProfile',
    profileKey: 'PMC_Q7',   // 使用相同輪廓剖面，寬度不同由 baseW 標示
    baseL: 3180,
    baseW: 2240,
    maxHeightMm: 3048,
    maxWeightKg: 6804,
    tareWeightKg: 150,
    maxFloorPressureKgM2: 1953,
  },
  'Q7-00': {
    code: 'Q7-00',
    name: 'Container Q7-00 (Contoured Main Deck ULD)',
    type: 'container',
    geometryType: 'extrudedProfile',
    profileKey: 'Q7_00',
    baseL: 3175,       // 125" depth
    baseW: 2438.4,     // 96" width（外框最大）
    maxHeightMm: 2997.2, // 118" total height
    maxWeightKg: 6804, // 主甲板等級（可覆寫）
    tareWeightKg: 160,
    maxFloorPressureKgM2: 1953,
  },
};

/** ULD 代碼清單（供 API 驗證與前端選單） */
function getUldCodes() {
  return Object.keys(ALL_ULDS);
}

/** 取得 ULD 定義（含自訂覆寫） */
function getUldDefinition(uid, overrides = {}) {
  const base = ALL_ULDS[uid];
  if (!base) return null;
  return { ...base, ...overrides };
}

/**
 * 從 API 請求的 uld_spec 正規化出內部定義。
 * 支援：
 *  - type: 'PMC' 等內建代碼
 *  - 自訂屬性覆寫（contour_type、max_weight_kg、max_floor_pressure_kg_m2 等）
 *
 * @param {object} spec 請求裡的 uld_spec
 * @returns {{def: object, planes: Array, clearanceMm: number}}
 */
function resolveUld(spec) {
  if (!spec || typeof spec !== 'object') {
    throw new Error('uld_spec is required');
  }
  const type = String(spec.type || '').toUpperCase();
  const contour = spec.contour_type ? String(spec.contour_type).toUpperCase() : null;

  // 若使用者指定 contour_type 且 type 為托盤，優先找輪廓版本
  let uid = type;
  if (contour && ALL_ULDS[`${type}-${contour}`]) {
    uid = `${type}-${contour}`;
  } else if (contour && ALL_ULDS[type]) {
    uid = type; // 該 type 內建已含對應輪廓（如 AKE 本身）
  }

  const overrides = {};
  if (spec.max_weight_kg !== undefined) overrides.maxWeightKg = spec.max_weight_kg;
  if (spec.max_floor_pressure_kg_m2 !== undefined) overrides.maxFloorPressureKgM2 = spec.max_floor_pressure_kg_m2;
  if (spec.net_clearance_mm !== undefined) overrides.netClearanceMm = spec.net_clearance_mm;
  if (spec.max_height_mm !== undefined) overrides.maxHeightMm = spec.max_height_mm;

  const def = getUldDefinition(uid, overrides);
  if (!def) {
    throw new Error(`Unknown ULD type '${type}'${contour ? ` (contour '${contour}')` : ''}. Available: ${getUldCodes().join(', ')}`);
  }

  const clearanceMm = def.netClearanceMm !== undefined ? def.netClearanceMm : (spec.net_clearance_mm || 30);
  const planes = buildHalfspaces(uid, clearanceMm);

  return { def, planes, clearanceMm };
}

/** 取得前端渲染用幾何描述（剖面頂點、外框尺寸） */
function getUldRenderInfo(uid, overrides = {}) {
  const def = getUldDefinition(uid, overrides);
  if (!def) return null;
  return {
    code: def.code,
    name: def.name,
    type: def.type,
    l: def.baseL,
    w: def.baseW,
    h: def.maxHeightMm,
    profile: def.profileKey ? PROFILE2D[def.profileKey] : null,
    geometryType: def.geometryType,
    maxWeightKg: def.maxWeightKg,
    tareWeightKg: def.tareWeightKg,
  };
}

module.exports = {
  ALL_ULDS,
  PROFILE2D,
  buildHalfspaces,
  getUldCodes,
  getUldDefinition,
  getUldRenderInfo,
  resolveUld,
};