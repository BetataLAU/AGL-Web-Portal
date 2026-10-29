// ===== 模擬裝板：3D 幾何判定（6 方向 / 重疊 / Contour 輪廓 / 支撐）=====
// 座標系（單位 cm）：
//   X = 板長方向 0 → baseL（0 = 板前端）
//   Z = 板寬方向 -baseW/2 → +baseW/2（左右對稱）
//   Y = 高度 0 → height
// Contour 以兩個剖面多邊形描述（凸多邊形，逆時針）：
//   profileZ：u = z, v = y（寬 × 高剖面，主要收角在此）
//   profileX：u = x, v = y（長 × 高剖面，前/後端斜切）
// 兩者的交集即為可用空間。
export const LOADSIM_EPS = 0.01;        // 0.1 mm 容差
export const LOADSIM_SUPPORT_EPS = 0.5; // 支撐判定容差 5 mm

// ===== 6 種軸向擺法（涵蓋所有 90° 旋轉後不重複的擺法）=====
// dims：{ l = 長(X)、w = 寬(Z)、h = 高(Y) }（依使用者輸入的原始方向）
export function loadsimOrientations(dims) {
  const { l, w, h } = dims;
  return [
    { x: l, y: h, z: w, label: '正放' },
    { x: w, y: h, z: l, label: '水平轉 90°' },
    { x: l, y: w, z: h, label: '側倒' },
    { x: h, y: w, z: l, label: '側倒＋轉 90°' },
    { x: w, y: l, z: h, label: '前倒' },
    { x: h, y: l, z: w, label: '前倒＋轉 90°' }
  ];
}

export function loadsimOrientCount() { return 6; }

// 目前方向的三軸尺寸
export function loadsimDimsOf(item) {
  const list = loadsimOrientations(item.dims);
  const idx = ((item.orient % list.length) + list.length) % list.length;
  return list[idx];
}

// 目前方向的名稱（給 tooltip 用）
export function loadsimOrientLabel(item) {
  const list = loadsimOrientations(item.dims);
  const idx = ((item.orient % list.length) + list.length) % list.length;
  return list[idx].label;
}

// 貨物在空間中的包圍盒（x/y/z 都是「最小角」座標）
export function loadsimExtents(item) {
  const d = loadsimDimsOf(item);
  return {
    x0: item.x, x1: item.x + d.x,
    y0: item.y, y1: item.y + d.y,
    z0: item.z, z1: item.z + d.z
  };
}

export function loadsimRectsOverlap(a, b, eps = LOADSIM_EPS) {
  return a.x0 < b.x1 - eps && b.x0 < a.x1 - eps &&
    a.y0 < b.y1 - eps && b.y0 < a.y1 - eps &&
    a.z0 < b.z1 - eps && b.z0 < a.z1 - eps;
}

// ===== 多邊形工具 =====
export function loadsimPolyArea(poly) {
  let area = 0;
  for (let i = 0; i < poly.length; i++) {
    const [u1, v1] = poly[i];
    const [u2, v2] = poly[(i + 1) % poly.length];
    area += u1 * v2 - u2 * v1;
  }
  return area / 2;
}

// 統一成逆時針（面積 > 0）
export function loadsimEnsureCcw(poly) {
  const points = (Array.isArray(poly) ? poly : [])
    .filter(p => Array.isArray(p) && p.length >= 2 && isFinite(Number(p[0])) && isFinite(Number(p[1])))
    .map(p => [Number(p[0]), Number(p[1])]);
  if (points.length < 3) return [];
  return loadsimPolyArea(points) < 0 ? points.slice().reverse() : points;
}

export function loadsimPolyBounds(poly) {
  const bounds = { u0: Infinity, u1: -Infinity, v0: Infinity, v1: -Infinity };
  poly.forEach(([u, v]) => {
    if (u < bounds.u0) bounds.u0 = u;
    if (u > bounds.u1) bounds.u1 = u;
    if (v < bounds.v0) bounds.v0 = v;
    if (v > bounds.v1) bounds.v1 = v;
  });
  return bounds;
}

// 由外向法向量決定人類可讀的方位名稱
// axis：'z' → 左側/右側；'x' → 前端/後端
function loadsimPlaneLabel(nx, ny, axis) {
  const ox = -nx; // 外向法向量
  const oy = -ny;
  if (Math.abs(oy) > 0.8) return oy > 0 ? '上方' : '底部';
  if (Math.abs(ox) > 0.8) {
    if (axis === 'x') return ox > 0 ? '後端' : '前端';
    return ox > 0 ? '右側' : '左側';
  }
  const vertical = oy > 0 ? '上' : '下';
  if (axis === 'x') return `${ox > 0 ? '後' : '前'}${vertical}斜角`;
  return `${ox > 0 ? '右' : '左'}${vertical}斜角`;
}

// 建立半平面（逆時針多邊形：內側在行進方向左側 → 內側滿足 dot(p, n) >= c）
export function loadsimBuildPlanes(poly, axis) {
  const ccw = loadsimEnsureCcw(poly);
  const planes = [];
  for (let i = 0; i < ccw.length; i++) {
    const [u1, v1] = ccw[i];
    const [u2, v2] = ccw[(i + 1) % ccw.length];
    const du = u2 - u1;
    const dv = v2 - v1;
    const len = Math.hypot(du, dv);
    if (len < LOADSIM_EPS) continue;
    const nx = -dv / len;
    const ny = du / len;
    planes.push({
      u1, v1, u2, v2,
      nx, ny,
      c: u1 * nx + v1 * ny,
      label: loadsimPlaneLabel(nx, ny, axis),
      axis
    });
  }
  return planes;
}

// 矩形（u0,v0)-(u1,v1) 是否完全落在多邊形內；並回報每個方位超出多少
export function loadsimTestRectInPolygon(u0, v0, u1, v1, planes) {
  const corners = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
  const overflows = [];
  let fit = true;
  let worst = 0;
  for (const plane of planes) {
    let maxPen = -Infinity;
    for (const [u, v] of corners) {
      const pen = plane.c - (u * plane.nx + v * plane.ny);
      if (pen > maxPen) maxPen = pen;
    }
    if (maxPen > LOADSIM_EPS) {
      fit = false;
      overflows.push({ label: plane.label, amount: maxPen, plane });
      if (maxPen > worst) worst = maxPen;
    }
  }
  return { fit, overflows, worst };
}

// ===== 超出輪廓的多邊形裁切 =====
// 取「矩形 ∩ 該邊外側」的區域（外側＝dot(p, n) < c）；回傳多邊形（可能為空）
export function loadsimClipRectOutside(rect, plane) {
  const signed = p => p[0] * plane.nx + p[1] * plane.ny - plane.c;
  const isOutside = p => signed(p) <= 1e-9;
  const out = [];
  for (let i = 0; i < rect.length; i++) {
    const a = rect[i];
    const b = rect[(i + 1) % rect.length];
    const aOut = isOutside(a);
    const bOut = isOutside(b);
    if (aOut) out.push(a);
    if (aOut !== bOut) {
      const sa = signed(a);
      const sb = signed(b);
      const t = sa / (sa - sb);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}

// ===== 「界的那一條邊」=====
// 出界標籤要能連到「被跨越的輪廓邊」，所以算出「貨物剖面 ∩ 該超出平面」的線段：
//   plane.axis === 'z' → 剖面 (u = z, v = y)；axis === 'x' → 剖面 (u = x, v = y)
// 回傳 { a: [u, v], b: [u, v] }（若只碰到一點，a 與 b 相同）
export function loadsimOverflowBoundary(ext, entry) {
  const plane = entry && entry.plane;
  if (!plane || !ext) return null;
  const isZ = plane.axis === 'z';
  const u0 = isZ ? ext.z0 : ext.x0;
  const u1 = isZ ? ext.z1 : ext.x1;
  const corners = [[u0, ext.y0], [u1, ext.y0], [u1, ext.y1], [u0, ext.y1]];
  const signed = ([u, v]) => u * plane.nx + v * plane.ny - plane.c;
  const eps = 1e-6;
  const points = [];
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % corners.length];
    const sa = signed(a);
    const sb = signed(b);
    if (Math.abs(sa) <= eps) points.push(a);
    if ((sa > eps && sb < -eps) || (sa < -eps && sb > eps)) {
      const t = sa / (sa - sb);
      points.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  if (!points.length) {
    // 沒有交點（理論上不會發生）：退回最貼近平面的一個角
    let best = corners[0];
    let bestAbs = Infinity;
    corners.forEach(corner => {
      const d = Math.abs(signed(corner));
      if (d < bestAbs) { bestAbs = d; best = corner; }
    });
    return { a: best, b: best };
  }
  // 取距離最遠的兩點＝線段兩端
  let a = points[0];
  let b = points[0];
  let span = -1;
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const d = Math.hypot(points[i][0] - points[j][0], points[i][1] - points[j][1]);
      if (d > span) { span = d; a = points[i]; b = points[j]; }
    }
  }
  return { a, b };
}

// 支撐面積門檻（0～1）：只有勾選「上貨需壓在下方貨物 X% 面積」時才套用比例；
// 取消勾選＝只要有支撐就算（門檻 0，但仍然要有接觸）。
export function loadsimSupportMinRatio(options = {}) {
  if (options.supportAreaEnabled === false) return 0;
  const pct = options.supportMinPct === undefined ? 50 : Number(options.supportMinPct);
  const value = isFinite(pct) ? pct : 50;
  return Math.max(0, Math.min(1, value / 100));
}

// 取得貨物「下方最高支撐面」的高度（地板 = 0）：3D 拖曳時用來自動疊放
// minRatio > 0 時只會停在「支撐面積合格」的層，避免放上去又彈回；
// minRatio = 0 時停在「有接觸」的最高層（不是隨便一層）。
export function loadsimSupportHeight(ext, others, minRatio = 0) {
  const list = others || [];
  const min = Math.max(0, Math.min(1, Number(minRatio) || 0));
  const height = Math.max(0, ext.y1 - ext.y0);

  // 候選層＝地板 + 所有「水平有重疊」的貨物頂面
  const levels = [0];
  list.forEach(other => {
    const e = loadsimExtents(other);
    const overlapX = Math.min(e.x1, ext.x1) - Math.max(e.x0, ext.x0);
    const overlapZ = Math.min(e.z1, ext.z1) - Math.max(e.z0, ext.z0);
    if (overlapX > LOADSIM_SUPPORT_EPS && overlapZ > LOADSIM_SUPPORT_EPS && e.y1 > 0) {
      levels.push(Math.round(e.y1 * 100) / 100);
    }
  });
  const sorted = [...new Set(levels)].sort((a, b) => b - a);

  for (const y of sorted) {
    if (y <= LOADSIM_EPS) return 0; // 地板
    const shifted = { x0: ext.x0, x1: ext.x1, y0: y, y1: y + height, z0: ext.z0, z1: ext.z1 };
    const ratio = loadsimSupportRatio(shifted, list);
    if (ratio > 1e-9 && ratio >= min - 1e-9) return y;
  }
  return 0;
}

// 貨物是否「有東西頂住」（貼地或有其他貨物頂面支撐）
// minRatio：上層貨物底面至少要有多少比例面積落在下層貨物頂面（0 = 只要有接觸就算）
export function loadsimIsSupported(ext, others, minRatio = 0) {
  if (ext.y0 <= LOADSIM_EPS) return true;
  const ratio = loadsimSupportRatio(ext, others);
  if (ratio <= 0) return false;
  return ratio >= Math.max(0, Math.min(1, Number(minRatio) || 0)) - 1e-9;
}

// 支撐面積比例（0～1）：同一高度接觸的貨物頂面「聯集」面積 ÷ 上層貨物底面積
// 用途：避免只壓到一點點就往上疊（預設要求 >= 50%）。
export function loadsimSupportRatio(ext, others) {
  const baseW = ext.x1 - ext.x0;
  const baseD = ext.z1 - ext.z0;
  const baseArea = baseW * baseD;
  if (!(baseArea > 0)) return 0;

  const supports = [];
  (others || []).forEach(other => {
    const e = loadsimExtents(other);
    if (Math.abs(e.y1 - ext.y0) > LOADSIM_SUPPORT_EPS) return;
    const x0 = Math.max(e.x0, ext.x0);
    const x1 = Math.min(e.x1, ext.x1);
    const z0 = Math.max(e.z0, ext.z0);
    const z1 = Math.min(e.z1, ext.z1);
    if (x1 - x0 > LOADSIM_SUPPORT_EPS && z1 - z0 > LOADSIM_SUPPORT_EPS) {
      supports.push({ x0, x1, z0, z1 });
    }
  });
  if (!supports.length) return 0;

  // 用所有邊界切格，逐格判斷是否被支撐物覆蓋 → 重疊的支撐物不會重複計算面積
  const xs = new Set([ext.x0, ext.x1]);
  const zs = new Set([ext.z0, ext.z1]);
  supports.forEach(s => { xs.add(s.x0); xs.add(s.x1); zs.add(s.z0); zs.add(s.z1); });
  const xsList = [...xs].sort((a, b) => a - b);
  const zsList = [...zs].sort((a, b) => a - b);

  let covered = 0;
  for (let i = 0; i < xsList.length - 1; i++) {
    const dx = xsList[i + 1] - xsList[i];
    if (dx <= 0) continue;
    const cx = (xsList[i] + xsList[i + 1]) / 2;
    for (let j = 0; j < zsList.length - 1; j++) {
      const dz = zsList[j + 1] - zsList[j];
      if (dz <= 0) continue;
      const cz = (zsList[j] + zsList[j + 1]) / 2;
      if (supports.some(s => cx > s.x0 && cx < s.x1 && cz > s.z0 && cz < s.z1)) {
        covered += dx * dz;
      }
    }
  }
  return Math.min(1, covered / baseArea);
}

// ===== 單一貨物的完整合法性檢查 =====
// 回傳 { ok, fits, overlaps, overflows, supported, supportRatio, overhangMax }
export function loadsimEvaluatePlacement(item, spec, others, options = {}) {
  const allowOverhang = !!options.allowOverhang;
  const requireSupport = options.requireSupport !== false;
  // 上貨需壓在下方貨物上的最低面積比例（勾選「X% 面積」才有；取消勾選＝有接觸即可）
  const supportMin = loadsimSupportMinRatio(options);
  const ext = loadsimExtents(item);

  const zy = loadsimTestRectInPolygon(ext.z0, ext.y0, ext.z1, ext.y1, spec.planesZ);
  const xy = loadsimTestRectInPolygon(ext.x0, ext.y0, ext.x1, ext.y1, spec.planesX);
  const overflows = [...zy.overflows, ...xy.overflows];
  const overlaps = (others || []).filter(other => loadsimRectsOverlap(ext, loadsimExtents(other)));
  const supportRatio = ext.y0 <= LOADSIM_EPS ? 1 : loadsimSupportRatio(ext, others || []);
  // supportMin = 0（沒勾面積比例）時仍要求「有接觸」（ratio > 0），不是完全不管支撐
  const supported = !requireSupport ||
    (supportMin > 0 ? supportRatio >= supportMin - 1e-9 : supportRatio > 1e-9);
  const fits = zy.fit && xy.fit;
  const overhangMax = overflows.reduce((max, o) => Math.max(max, o.amount), 0);

  return {
    ext,
    fits,
    overlaps,
    overflows,
    supported,
    supportRatio,
    supportMin,
    overhangMax,
    ok: overlaps.length === 0 && supported && (fits || allowOverhang)
  };
}

// 不合法的原因（給提示文字，cm 由呼叫端轉單位）
export function loadsimPlacementReason(report, options = {}) {
  if (!report) return '';
  if (report.overlaps.length) return '與其他貨物重疊';
  if (!report.supported) {
    const need = Math.round((report.supportMin === undefined ? 0.5 : report.supportMin) * 100);
    if (need <= 0) return '下方沒有支撐（不可懸空）：請移到板上或疊在其他貨物上';
    const ratio = Math.round((report.supportRatio || 0) * 100);
    return `下方支撐面積只有 ${ratio}%（需 ≥ ${need}%）：請往內移，或先鋪一層底`;
  }
  if (!report.fits && !options.allowOverhang) {
    const list = report.overflows
      .slice()
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 2)
      .map(o => `${o.label} ${o.amount.toFixed(1)}cm`);
    return `超出 Contour 輪廓（${list.join('、')}）`;
  }
  return '';
}

// 把貨物夾在「板面（貼地）」範圍內（**嚴格**：完全不能超出板面）
// 注意：外擴型板型（H2/H3/H4/W2）的輪廓比板面大，貼地仍以板面為準。
// 拖曳／方向鍵請用下面的 loadsimClampToMoveArea()（板面再外 40cm，才騎得出板邊）。
export function loadsimClampToBase(item, spec) {
  const d = loadsimDimsOf(item);
  const floorX0 = spec.floorX0 === undefined ? 0 : spec.floorX0;
  const floorX1 = spec.floorX1 === undefined ? spec.baseL : spec.floorX1;
  const floorZ0 = spec.floorZ0 === undefined ? -spec.baseW / 2 : spec.floorZ0;
  const floorZ1 = spec.floorZ1 === undefined ? spec.baseW / 2 : spec.floorZ1;
  const maxX = Math.max(floorX0, floorX1 - d.x);
  const maxZ = Math.max(floorZ0, floorZ1 - d.z);
  item.x = Math.min(Math.max(item.x, floorX0), maxX);
  item.z = Math.min(Math.max(item.z, floorZ0), maxZ);
  item.y = Math.max(item.y, 0);
  return item;
}

// ===== 可移動範圍（滑鼠拖曳與方向鍵共用）=====
// 板面（貼地範圍）再往外 MARGIN 公分：讓「超出輪廓」看得到、貨物也可以騎出板邊，
// 但不會整件飛出畫面。滑鼠拖曳另外會把 X 再放寬到暫存區（extraMaxX）。
export const LOADSIM_MOVE_MARGIN_CM = 40;

export function loadsimClampToMoveArea(item, spec, margin = LOADSIM_MOVE_MARGIN_CM, extraMaxX = null) {
  const d = loadsimDimsOf(item);
  const floorX0 = spec.floorX0 === undefined ? 0 : spec.floorX0;
  const floorX1 = spec.floorX1 === undefined ? spec.baseL : spec.floorX1;
  const floorZ0 = spec.floorZ0 === undefined ? -spec.baseW / 2 : spec.floorZ0;
  const floorZ1 = spec.floorZ1 === undefined ? spec.baseW / 2 : spec.floorZ1;
  const maxX = Math.max(floorX1 - d.x + margin, extraMaxX === null ? -Infinity : extraMaxX);
  const maxZ = floorZ1 - d.z + margin;
  item.x = Math.min(Math.max(item.x, floorX0 - margin), maxX);
  item.z = Math.min(Math.max(item.z, floorZ0 - margin), maxZ);
  item.y = Math.min(Math.max(item.y, 0), Math.max(0, spec.heightCm - d.y + margin));
  return item;
}

// ===== 暫存區（把貨物暫時拖出 Contour 放著）=====
// 位置：板子「後方（+X）」的一塊空地，寬度同板寬，貼地高度 0。
// 貨物拖進這裡 → item.staged = true（不在板上：不計重量、不做輪廓／重疊判定）。
export const LOADSIM_STAGE_GAP_CM = 30;     // 與板子（輪廓）之間的間隔
export const LOADSIM_STAGE_DEPTH_CM = 130;  // 暫存區深度（沿 X）

export function loadsimStageRect(spec) {
  const x0 = spec.baseL + LOADSIM_STAGE_GAP_CM;
  return {
    x0,
    x1: x0 + LOADSIM_STAGE_DEPTH_CM,
    z0: -spec.baseW / 2,
    z1: spec.baseW / 2,
    y: 0
  };
}

// 貨物「中心」是否落在暫存區內（放開時用來決定算不算暫存）
export function loadsimInStage(ext, stage) {
  if (!stage) return false;
  const cx = (ext.x0 + ext.x1) / 2;
  const cz = (ext.z0 + ext.z1) / 2;
  return cx >= stage.x0 && cx <= stage.x1 && cz >= stage.z0 && cz <= stage.z1;
}

// 把貨物夾在暫存區內（貼地）
export function loadsimClampToStage(item, stage) {
  const d = loadsimDimsOf(item);
  const maxX = Math.max(stage.x0, stage.x1 - d.x);
  const maxZ = Math.max(stage.z0, stage.z1 - d.z);
  item.x = Math.min(Math.max(item.x, stage.x0), maxX);
  item.z = Math.min(Math.max(item.z, stage.z0), maxZ);
  item.y = 0;
  return item;
}
