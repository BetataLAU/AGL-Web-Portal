/**
 * bp3d/geometries.js
 * ULD 幾何引擎：以「半空間（Half-space）交集」模型描述 ULD 內部可用空間。
 *
 * 半空間：[A, B, C, D] 代表平面不等式  A*x + B*y + C*z + D <= 0
 * ULD 可用空間 = 所有半空間的交集。
 *
 * 座標系統（全系統統一）：
 *   - 原點 = ULD 底部中心
 *   - X = ULD 深度方向（正方向為「前方」）
 *   - Y = ULD 寬度方向
 *   - Z = 高度方向（地面 = 0）
 *   - 單位：mm
 *
 * 優點：矩形托盤、AKE/LD3 斜切、Q6/Q7 輪廓，全部用同一套驗證邏輯
 *       （貨物 8 頂點逐一代入每個平面不等式）。
 */

// ===== 平面工具 =====

/** 建立平面 [A,B,C,D]（不自動 normalize，保留原係數方便除錯） */
function makePlane(a, b, c, d) {
  return [a, b, c, d];
}

/** 計算平面值：A*x + B*y + C*z + D */
function evalPlane(plane, px, py, pz) {
  return plane[0] * px + plane[1] * py + plane[2] * pz + plane[3];
}

/** 平面法向量長度（半空間內縮時需要） */
function planeNorm(plane) {
  return Math.sqrt(plane[0] * plane[0] + plane[1] * plane[1] + plane[2] * plane[2]);
}

/** 將平面法向量單位化（供 shrink 使用；回傳新平面） */
function normalizePlane(plane) {
  const len = planeNorm(plane);
  if (len === 0) throw new Error('Invalid plane normal (zero length)');
  return [plane[0] / len, plane[1] / len, plane[2] / len, plane[3] / len];
}

// ===== ULD 半空間集合 =====

/**
 * 矩形 ULD（PMC / PAG / PAP 等托盤或矩形容器）。
 * @param {number} l X 方向長度
 * @param {number} w Y 方向寬度
 * @param {number} h 高度（Z 方向）
 * @returns {Array<Array<number>>} 半空間集合（6 個平面）
 */
function createRectangularHalfspaces(l, w, h) {
  const hx = l / 2;
  const hy = w / 2;
  return [
    makePlane(1, 0, 0, -hx),   // x <=  l/2
    makePlane(-1, 0, 0, -hx),  // x >= -l/2
    makePlane(0, 1, 0, -hy),   // y <=  w/2
    makePlane(0, -1, 0, -hy),  // y >= -w/2
    makePlane(0, 0, 1, -h),    // z <=  h
    makePlane(0, 0, -1, 0),    // z >=  0
  ];
}

/**
 * 沿 X 軸擠出 Y-Z 多邊形截面的 ULD（AKE/LD3 斜切容器、Q6/Q7 輪廓托盤）。
 *
 * @param {number} length X 方向深度（mm）
 * @param {Array<[number, number]>} profile2D 逆時針 Y-Z 截面頂點，
 *        每個頂點為 [y, z]（例如梯形截面的 6 個頂點）
 * @returns {Array<Array<number>>} 半空間集合（2 個端面 + N 個側面）
 */
function createExtrudedPolygonHalfspaces(length, profile2D) {
  if (!Array.isArray(profile2D) || profile2D.length < 3) {
    throw new Error('Profile needs at least 3 vertices ([y, z] pairs)');
  }
  const hx = length / 2;
  const planes = [
    makePlane(1, 0, 0, -hx),   // x <=  length/2
    makePlane(-1, 0, 0, -hx),  // x >= -length/2
    makePlane(0, 0, -1, 0),    // z >=  0（地面）
  ];

  // profile 中最大 z（容器高度）
  const maxZ = Math.max(...profile2D.map((v) => v[1]));
  planes.push(makePlane(0, 0, 1, -maxZ)); // z <= maxZ

  // 質心（供法向量方向檢查）
  const n = profile2D.length;
  const cy = profile2D.reduce((s, v) => s + v[0], 0) / n;
  const cz = profile2D.reduce((s, v) => s + v[1], 0) / n;

  for (let i = 0; i < n; i++) {
    const [y1, z1] = profile2D[i];
    const [y2, z2] = profile2D[(i + 1) % n];
    const dy = y2 - y1;
    const dz = z2 - z1;

    // 水平邊（dz = 0）：底邊/頂邊不是側牆，不產生側面限制平面
    if (Math.abs(dz) < 1e-9) continue;

    // 邊方向 (dy, dz)；多邊形為逆時針時，內部在邊的左側。
    // 左側法向量 = (-dz, dy)。平面不等式（內部）：dz*y - dy*z + D <= 0
    // 代入邊上一點 (y1, z1) 求 D：
    //   dz*y1 - dy*z1 + D = 0  =>  D = -dz*y1 + dy*z1
    // 注意：此平面只限制 Y-Z（剖面），X 方向係數為 0！
    //   平面 = [0, dz, -dy, D]，不可誤放到 X 軸（A）。
    let by = dz;
    let cz = -dy;
    const ax = 0;
    let d = -dz * y1 + dy * z1;

    // Safety check：以截面質心驗證法向量是否指向內側；若不是則反轉
    if (by * cy + cz * cz + d > 0) {
      by = -by;
      cz = -cz;
      d = -d;
    }
    planes.push(makePlane(ax, by, cz, d));
  }
  return planes;
}

// ===== 驗證 =====

const DEFAULT_EPS = 1e-6;

/** 點是否在半空間交集內（所有平面 <= eps 才通過） */
function pointInside(planes, px, py, pz, eps = DEFAULT_EPS) {
  for (const p of planes) {
    if (evalPlane(p, px, py, pz) > eps) return false;
  }
  return true;
}

/**
 * 貨物盒子 (x, y, z, l, w, h) 是否完全在 ULD 半空間內。
 * 檢查全部 8 個頂點。
 */
function boxFits(planes, x, y, z, l, w, h, eps = DEFAULT_EPS) {
  const x2 = x + l;
  const y2 = y + w;
  const z2 = z + h;
  // 8 頂點
  if (!pointInside(planes, x, y, z, eps)) return false;
  if (!pointInside(planes, x2, y, z, eps)) return false;
  if (!pointInside(planes, x, y2, z, eps)) return false;
  if (!pointInside(planes, x2, y2, z, eps)) return false;
  if (!pointInside(planes, x, y, z2, eps)) return false;
  if (!pointInside(planes, x2, y, z2, eps)) return false;
  if (!pointInside(planes, x, y2, z2, eps)) return false;
  if (!pointInside(planes, x2, y2, z2, eps)) return false;
  return true;
}

/** AABB 碰撞：兩盒子是否在空間中重疊（邊界接觸不算碰撞） */
function aabbOverlap(a, b) {
  return (
    a.x < b.x + b.l && a.x + a.l > b.x &&
    a.y < b.y + b.w && a.y + a.w > b.y &&
    a.z < b.z + b.h && a.z + a.h > b.z
  );
}

/**
 * 半空間內縮：把 ULD 可用空間向內縮 shrink（mm）。
 * 用於 Net Clearance Margin（網套/綁帶預留空間）。
 * 對側面與頂面平面 d' = d + shrink * ||n||。
 *
 * 注意：地面平面（z >= 0，法向量 [0,0,-1]）不能內縮，否則貨物無法貼地。
 *
 * @param {Array<Array<number>>} planes 半空間（可未單位化）
 * @param {number} shrink 內縮距離（mm）
 */
function shrinkHalfspaces(planes, shrink) {
  return planes.map((p) => {
    // 跳過地面平面：法向量指向 -Z（即 z >= 0 的限制）
    if (p[0] === 0 && p[1] === 0 && p[2] < 0) {
      return p;
    }
    const len = planeNorm(p);
    return [p[0], p[1], p[2], p[3] + shrink * len];
  });
}

/** 取得半空間集合的 X 範圍（用於初始化候選點） */
function getBounds(planes) {
  const minX = -Infinity;
  const maxX = Infinity;
  // 掃描 X 方向平面（A != 0, B = C = 0）
  let min = Infinity;
  let max = -Infinity;
  for (const p of planes) {
    if (p[0] !== 0 && p[1] === 0 && p[2] === 0) {
      // x <= -d/a 或 x >= d/a
      const bound = -p[3] / p[0];
      if (p[0] > 0) max = Math.min(max, bound);
      else if (p[0] < 0) min = Math.max(min, bound);
    }
  }
  return { minX: min === Infinity ? minX : min, maxX: max === -Infinity ? maxX : max };
}

/** 取得半空間集合在特定 z 高度的 Y 範圍（供前端渲染斜切輪廓用） */
function yRangeAtZ(planes, z) {
  let minY = -Infinity;
  let maxY = Infinity;
  for (const p of planes) {
    if (p[1] === 0) continue; // 只處理 Y 方向有法向量的平面
    // A*x + B*y + C*z + D <= 0，在給定 z 下：y <= (-C*z - D - A*x)/B
    // 對完整 3D 驗證需保留 x；此函數僅供視覺化粗略估測，忽略 x 影響並假設 B 主導
    // 保守方式：對 n 個頂點代入取 min/max 不準，故只處理 B != 0 的平面
    // 計算 y 邊界：B*y <= -C*z - D  (假設 x 在範圍內有解)
    if (p[1] > 0) maxY = Math.min(maxY, (-p[2] * z - p[3]) / p[1]);
    else minY = Math.max(minY, (-p[2] * z - p[3]) / p[1]);
  }
  return { minY: minY === -Infinity ? null : minY, maxY: maxY === Infinity ? null : maxY };
}

/** 取得 Z 方向最大值（ULD 可用高度） */
function maxHeight(planes) {
  let h = Infinity;
  for (const p of planes) {
    if (p[2] > 0 && p[0] === 0 && p[1] === 0) {
      h = Math.min(h, -p[3] / p[2]);
    }
  }
  return h === Infinity ? null : h;
}

module.exports = {
  makePlane,
  evalPlane,
  planeNorm,
  normalizePlane,
  createRectangularHalfspaces,
  createExtrudedPolygonHalfspaces,
  pointInside,
  boxFits,
  aabbOverlap,
  shrinkHalfspaces,
  getBounds,
  yRangeAtZ,
  maxHeight,
};