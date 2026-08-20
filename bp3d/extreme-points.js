/**
 * bp3d/extreme-points.js
 * Extreme Point (EP) 演算法核心：產生候選放置位置並進行裝載。
 *
 * 原理（Crainic et al., 2008 "Extreme Point-Based Heuristics for
 * Three-Dimensional Bin Packing"）：
 *   1. 初始放置點為箱子角落（與 ULD 內壁相切的位置）。
 *   2. 每次放置一件貨物後，將該貨物的「極點」加入候選集合。
 *   3. 對每個候選點，嘗試所有合法的旋轉方向。
 *   4. 用評分函數挑選「最低且最緊湊」的位置。
 *
 * 座標：原點 = ULD 底部中心；X = 深度，Y = 寬度，Z = 高度；單位 mm。
 */

const geo = require('./geometries');
const constraints = require('./constraints');

// ===== 旋轉方向 =====

/**
 * 產生貨物的合法旋轉方向（l, w, h 三軸排列）。
 * @param {object} item {l, w, h, allowRotateX, allowRotateY, allowRotateZ, mustStayUpright}
 * @returns {Array<[number, number, number]>} 合法 [l, w, h] 排列清單
 */
function generateOrientations(item) {
  const { l, w, h } = item;
  const result = [[l, w, h]]; // 原始方向一定合法

  const allowX = item.allowRotateX !== false; // 繞 X 軸旋轉（寬↔高）
  const allowXY = item.allowRotateY !== false; // 在原平面旋轉（長↔寬）
  const allowZ = item.allowRotateZ !== false;

  // 必須直立：只允許繞 Z 軸旋轉（長↔寬）
  if (item.mustStayUpright) {
    if (allowXY) {
      result.push([w, l, h]);
    }
    return dedupe(result);
  }

  // 一般情形：列出 6 種排列，再依旗標過濾
  const all = [
    [l, w, h],
    [w, l, h],
    [l, h, w],
    [h, l, w],
    [w, h, l],
    [h, w, l],
  ];

  for (const [a, b, c] of all) {
    if (a === l && b === w && c === h) continue; // 已加入
    // c 是高度：若高度不是 h，代表做了繞 X 或繞 Y 的旋轉
    if (c !== h && !allowX) continue; // 繞 X 或繞 Y 旋轉被禁止
    // 長↔寬交換（a,b 互換）需要 allowXY
    if (a === w && b === l && c === h && !allowXY) continue;
    result.push([a, b, c]);
  }

  return dedupe(result);
}

/** 去除重複的方向（例如正方體只有一種） */
function dedupe(arr) {
  const seen = new Set();
  const out = [];
  for (const [a, b, c] of arr) {
    const key = `${a},${b},${c}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push([a, b, c]);
    }
  }
  return out;
}

// ===== 候選點產生 =====

/**
 * 從半空間集合計算「底部（z=0）可用矩形」的四個角。
 * 掃描純 X 方向與純 Y 方向的平面（A=1/0 等），算出保守的底部內接矩形。
 * 對矩形 ULD：等於內縮（net clearance）後的 4 角。
 * 對斜切 ULD：等於底部平坦區域的 4 角（斜切面在底部給出的最窄邊界）。
 *
 * @param {Array<Array<number>>} planes 半空間
 * @returns {{minX: number, maxX: number, minY: number, maxY: number}}
 */
function computeBottomRect(planes) {
  let minX = -Infinity;
  let maxX = Infinity;
  for (const p of planes) {
    if (p[1] === 0 && p[2] === 0 && p[0] !== 0) {
      const bound = -p[3] / p[0];
      if (p[0] > 0) maxX = Math.min(maxX, bound);
      else if (p[0] < 0) minX = Math.max(minX, bound);
    }
  }

  // 底部（z=0）的保守 Y 範圍：
  // 對每個 B != 0 的平面，在 z=0 時評估 y 邊界。
  //   B*y + A*x + D <= 0
  // 對 B>0：y <= (-A*x - D)/B，取「最窄」的 x（使右側最小）
  // 對 B<0：y >= (-A*x - D)/B，取「最窄」的 x（使下限最大）
  // 這能正確處理斜切面（如 AKE 的斜面在底部給出 ±781，而非頂部的 ±1003.5）。
  let minY = -Infinity;
  let maxY = Infinity;
  for (const p of planes) {
    if (p[1] === 0) continue;
    let xForBound;
    if (p[1] > 0) {
      // 使 (-A*x - D) 最小：A>0 取 minX（x 越小 -A*x 越大，不對）
      // 求 min over x of (-A*x - D)：
      //   A>0 時 -A*x 在 x=maxX 最小；A<0 時在 x=minX 最小
      xForBound = p[0] > 0 ? maxX : minX;
      const bound = (-p[0] * xForBound - p[3]) / p[1];
      if (Number.isFinite(bound)) maxY = Math.min(maxY, bound);
    } else {
      // 使 (-A*x - D) 最大（除以負數後 y 下限最大）：
      //   A>0 時 -A*x 在 x=minX 最大；A<0 時在 x=maxX 最大
      xForBound = p[0] > 0 ? minX : maxX;
      const bound = (-p[0] * xForBound - p[3]) / p[1];
      if (Number.isFinite(bound)) minY = Math.max(minY, bound);
    }
  }
  return { minX, maxX, minY, maxY };
}

/**
 * 產生初始候選點：ULD 底部所有可能角落。
 * 對矩形 ULD 是內縮後的 4 角；對斜切 ULD 是底部平坦區域的 4 角。
 *
 * @param {Array<Array<number>>} planes 半空間
 * @param {object} uldBounds {l, w}（僅做 fallback）
 * @returns {Array<{x: number, y: number, z: number}>}
 */
function initialCandidatePoints(planes, uldBounds) {
  const rect = computeBottomRect(planes);
  const hx = Number.isFinite(rect.maxX) && Number.isFinite(rect.minX)
    ? (rect.maxX - rect.minX) / 2
    : uldBounds.l / 2;
  const hy = Number.isFinite(rect.maxY) && Number.isFinite(rect.minY)
    ? (rect.maxY - rect.minY) / 2
    : uldBounds.w / 2;

  // 四個角落（z=0）
  return [
    { x: -hx, y: -hy, z: 0 },
    { x: hx, y: -hy, z: 0 },
    { x: hx, y: hy, z: 0 },
    { x: -hx, y: hy, z: 0 },
  ];
}

/**
 * 加入新放置貨物後，更新候選極點。
 * 對每件已放置貨物 p，產生以下候選點（皆在 ULD 內、與其他貨物不重疊）：
 *   - x = p.x + p.l, y = p.y, z = p.z          （右側）
 *   - x = p.x, y = p.y + p.w, z = p.z          （後側）
 *   - x = p.x, y = p.y, z = p.z + p.h          （上方）
 *
 * @param {object} placedItem 剛放置的貨物 {x,y,z,l,w,h}
 * @param {Array<object>} placed 所有已放置貨物
 * @param {Array} planes ULD 半空間
 * @returns {Array<{x: number, y: number, z: number}>}
 */
function updateCandidatePoints(placedItem, placed, planes) {
  const pts = [
    { x: placedItem.x + placedItem.l, y: placedItem.y, z: placedItem.z },
    { x: placedItem.x, y: placedItem.y + placedItem.w, z: placedItem.z },
    { x: placedItem.x, y: placedItem.y, z: placedItem.z + placedItem.h },
  ];

  // 過濾：必須在 ULD 幾何外框內（含底邊）
  const valid = [];
  for (const p of pts) {
    if (!geo.pointInside(planes, p.x, p.y, p.z)) continue;
    valid.push(p);
  }
  return valid;
}

// ===== 候選點收斂（貼齊） =====

/**
 * 將候選點向下收斂到「可支撐位置」：
 * 對給定貨物尺寸與候選點，找到 z 讓貨物底部落在地面或現有貨物頂面。
 * 如果候選點上方空間不足或無法貼齊，回傳 null。
 *
 * @param {object} item 貨物（含 l,w,h,isStackable 等）
 * @param {{x,y,z}} point 候選點
 * @param {[number,number,number]} orientation [l,w,h]
 * @param {Array<object>} placed 已放置貨物
 * @param {Array<Array<number>>} planes ULD 半空間
 * @param {object} options { minSupportRatio }
 * @returns {null | {x, y, z, orientation, supportRatio, zLayer}}
 */
function settleItem(item, point, orientation, placed, planes, options) {
  const [l, w, h] = orientation;

  // 找 z 層：所有可能的支撐高度（地面 z=0 或某貨物頂面）
  const supportZs = new Set([0]);
  for (const p of placed) {
    supportZs.add(p.z + p.h);
  }
  const sortedZs = [...supportZs].sort((a, b) => b - a); // 高到低

  for (const z of sortedZs) {
    // 貨物在此 z 下要能完全納入 ULD
    if (!geo.boxFits(planes, point.x, point.y, z, l, w, h)) continue;

    const candidate = { id: item.id, x: point.x, y: point.y, z, l, w, h, weightKg: item.weightKg };

    // 不能與已放置貨物重疊
    let occupies = false;
    for (const p of placed) {
      if (geo.aabbOverlap(candidate, p)) {
        occupies = true;
        break;
      }
    }
    if (occupies) continue;

    // 支撐率檢查
    const support = constraints.checkSupportRatio(candidate, placed, options.minSupportRatio);
    if (!support.supported) continue;

    return { x: point.x, y: point.y, z, orientation: [l, w, h], supportRatio: support.ratio, zLayer: z };
  }
  return null;
}

/**
 * 對某件貨物，在所有候選點 × 所有旋轉方向中找最佳放置。
 * 回傳 null 代表此貨物目前放不下。
 *
 * 評分函數（越低越好）：
 *   1. z（高度越低越好）— 優先低層
 *   2. y（越靠外側越好，方便人工裝載）— 用小權重
 *   3. x（越靠前方越好）
 *
 * @param {object} pendingItem 待放貨物
 * @param {Array<{x,y,z}>} candidatePoints
 * @param {Array<object>} placed
 * @param {Array<Array<number>>} planes
 * @param {object} options { minSupportRatio }
 */
function findBestPlacement(pendingItem, candidatePoints, placed, planes, options) {
  let best = null;
  let bestScore = Infinity;

  const orientations = generateOrientations(pendingItem);
  for (const point of candidatePoints) {
    for (const orientation of orientations) {
      const result = settleItem(pendingItem, point, orientation, placed, planes, options);
      if (!result) continue;
      const { x, y, z } = result;
      // 評分：高度最重要，其次往前方/外側
      const score = z * 10000 + Math.abs(y) * 10 + (x < 0 ? -x : x);
      if (score < bestScore) {
        bestScore = score;
        best = { ...result, itemId: pendingItem.id };
      }
    }
  }
  return best;
}

module.exports = {
  generateOrientations,
  initialCandidatePoints,
  updateCandidatePoints,
  settleItem,
  findBestPlacement,
};