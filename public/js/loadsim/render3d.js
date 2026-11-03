// ===== 模擬裝板：3D 視圖（Canvas 2D 自行投影，無外部 3D 套件）=====
// 座標系與 2D 版本相同：X = 板長 0→baseL、Z = 板寬 ±baseW/2、Y = 高度
// 相機：以板子中心為注視點的球座標（yaw / pitch / zoom），透視投影 + 背面剔除 + 由遠到近繪製。
import {
  loadsimExtents, loadsimEvaluatePlacement, loadsimClipRectOutside, loadsimStageRects,
  loadsimRingHitRects, loadsimOverflowBoundary
} from './geometry.js';
import {
  loadsimFormatAmount, loadsimFormatNumber, loadsimTickStepCm, loadsimFormatTick, loadsimUnitLabel
} from './units.js';
import {
  loadsimThemeColors as themeColors, loadsimRgba as rgba, loadsimShade as shade
} from './colors.js';

const FOV_Y = 40 * Math.PI / 180;
const DEFAULT_CAMERA = { yaw: 40, pitch: 26, zoom: 1 };

let camera = { ...DEFAULT_CAMERA };
let current = null; // { view, spec, unit, items, width, height }

// ===== 向量工具 =====
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const mul = (a, s) => ({ x: a.x * s, y: a.y * s, z: a.z * s });
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a, b) => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x
});
const norm = a => {
  const l = Math.hypot(a.x, a.y, a.z) || 1;
  return { x: a.x / l, y: a.y / l, z: a.z / l };
};
const clamp = (v, min, max) => Math.min(Math.max(v, min), max);

// ===== 相機 =====
export function loadsimOrbit3D(dxPx, dyPx) {
  camera.yaw -= dxPx * 0.45;
  camera.pitch = clamp(camera.pitch + dyPx * 0.35, 8, 80);
}

export function loadsimZoom3D(factor) {
  camera.zoom = clamp(camera.zoom * factor, 0.55, 3);
}

export function loadsimResetView3D() {
  camera = { ...DEFAULT_CAMERA };
  // 重設視角時一併清掉取景快取 → 下一幀直接回到「預設取景」，不做動畫收合
  fitState = { key: '', distance: 0, offX: 0, offY: 0, settling: false };
}

export function loadsimGetCamera3D() {
  return { ...camera };
}

// ===== 取景狀態（效能／穩定化）=====
// 問題：原本每一幀都用「板子＋所有貨物＋拖曳中的預覽」重新求最小可視距離，
// 於是 ① 轉視角時投影範圍改變 → 鏡頭來回推拉（整個板子像呼吸一樣縮放）
//      ② 拖曳貨物時預覽也被算進去 → 鏡頭縮放又改變「指標→世界座標」→ 回饋抖動
// 解法：取景只在「場景／板型／畫布尺寸」變動時重算（frameKey），
//       互動中（拖曳、轉視角）只允許拉遠不允許拉近，閒置時才平滑收合回目標值。
let fitState = { key: '', distance: 0, offX: 0, offY: 0, settling: false };

export function loadsimFrameSettling() {
  return !!fitState.settling;
}

// 切換視圖 / 重設時清掉取景快取（下次繪製直接重新求值）
export function loadsimResetFrameFit() {
  fitState = { key: '', distance: 0, offX: 0, offY: 0, settling: false };
}

function applyFrameFit(want, options) {
  const key = options.frameKey || '';
  // snapFrame：轉視角時用（相機角度一直在變，取景必須跟著重算，
  // 否則平移量會停在舊角度 → 板子與貨物被推到畫布外，看起來像「貨物消失」）。
  // 平移每幀直接套用；距離在互動中（freezeFrame）仍只允許拉遠，
  // 避免轉視角時整張板子「呼吸式」縮放。
  if (options.snapFrame) {
    const nextDistance = options.freezeFrame
      ? Math.max(fitState.distance || 0, want.distance)
      : want.distance;
    fitState = { key, distance: nextDistance, offX: want.offX, offY: want.offY, settling: false };
    return;
  }
  if (!key || fitState.key !== key || !fitState.distance) {
    fitState = { key, distance: want.distance, offX: want.offX, offY: want.offY, settling: false };
    return;
  }
  if (options.freezeFrame) {
    // 互動中：只允許「拉遠」（單調變化，不會來回抽動）
    if (want.distance > fitState.distance) fitState.distance = want.distance;
    fitState.settling = false;
    return;
  }
  // 閒置：平滑收合（每幀 28%），避免放下貨物後畫面突然跳一下
  const k = 0.28;
  const nextDistance = fitState.distance + (want.distance - fitState.distance) * k;
  const nextOffX = fitState.offX + (want.offX - fitState.offX) * k;
  const nextOffY = fitState.offY + (want.offY - fitState.offY) * k;
  const done = Math.abs(want.distance - nextDistance) < 0.5 &&
    Math.abs(want.offX - nextOffX) < 0.5 &&
    Math.abs(want.offY - nextOffY) < 0.5;
  fitState.distance = done ? want.distance : nextDistance;
  fitState.offX = done ? want.offX : nextOffX;
  fitState.offY = done ? want.offY : nextOffY;
  fitState.settling = !done;
}

function buildView(spec, width, height, extraPoints = [], options = {}) {
  const target = { x: spec.baseL / 2, y: spec.heightCm * 0.32, z: 0 };
  const yaw = camera.yaw * Math.PI / 180;
  const pitch = camera.pitch * Math.PI / 180;
  const radius = 0.5 * Math.hypot(spec.baseL, spec.baseW, spec.heightCm);
  const baseDistance = (radius / Math.sin(FOV_Y / 2)) * 1.12;
  const dir = {
    x: Math.cos(pitch) * Math.sin(yaw),
    y: Math.sin(pitch),
    z: Math.cos(pitch) * Math.cos(yaw)
  };
  const f = (Math.min(width, height) * 0.5) / Math.tan(FOV_Y / 2);
  const cx = width / 2;
  const cy = height * 0.52;

  const makeView = (distance, offX = 0, offY = 0) => {
    const pos = {
      x: target.x + dir.x * distance,
      y: target.y + dir.y * distance,
      z: target.z + dir.z * distance
    };
    const forward = norm(sub(target, pos));
    const right = norm(cross(forward, { x: 0, y: 1, z: 0 }));
    const up = cross(right, forward);
    return { target, pos, forward, right, up, f, cx: cx + offX, cy: cy + offY, width, height };
  };

  const boardCorners = [];
  [0, spec.baseL].forEach(x => {
    [0, spec.heightCm].forEach(y => {
      [-spec.baseW / 2, spec.baseW / 2].forEach(z => boardCorners.push({ x, y, z }));
    });
  });

  const spreadOf = (points, view) => {
    const projected = points.map(point => project(view, point));
    if (projected.some(point => !point)) return null;
    const xs = projected.map(point => point.x);
    const ys = projected.map(point => point.y);
    return {
      minX: Math.min(...xs), maxX: Math.max(...xs),
      minY: Math.min(...ys), maxY: Math.max(...ys)
    };
  };

  // 第一階段：讓「板子」填滿畫面（寬 86% / 高 80%）並置中
  let distance = baseDistance;
  let offX = 0;
  let offY = 0;
  for (let i = 0; i < 3; i++) {
    const spread = spreadOf(boardCorners, makeView(distance, offX, offY));
    if (!spread) break;
    const spanX = Math.max(spread.maxX - spread.minX, 1);
    const spanY = Math.max(spread.maxY - spread.minY, 1);
    const ratio = Math.min((width * 0.86) / spanX, (height * 0.80) / spanY);
    distance = distance / clamp(ratio, 0.6, 2.2);
    offX += cx - (spread.minX + spread.maxX) / 2;
    offY += cy - (spread.minY + spread.maxY) / 2;
  }
  const boardDistance = distance;

  // 第二階段：把「板子＋貨物」整組一起納入取景
  // （舊版只把鏡頭拉遠、不平移 → 貨物疊高或超出板邊時會被畫布邊緣切掉）
  if (extraPoints.length) {
    const allPoints = boardCorners.concat(extraPoints);
    for (let i = 0; i < 4; i++) {
      const spread = spreadOf(allPoints, makeView(distance, offX, offY));
      if (!spread) break;
      // 先把整組內容置中（貨物疊高時板子會稍微偏下，但全部看得到）
      offX += cx - (spread.minX + spread.maxX) / 2;
      offY += cy - (spread.minY + spread.maxY) / 2;
      const spanX = Math.max(spread.maxX - spread.minX, 1);
      const spanY = Math.max(spread.maxY - spread.minY, 1);
      const ratio = Math.min((width * 0.94) / spanX, (height * 0.90) / spanY);
      // 只拉遠、不拉近（板子仍以第一階段的填滿率為準，避免畫面忽大忽小）
      if (ratio >= 0.999) break;
      distance = Math.min(distance / clamp(ratio, 0.45, 2.2), boardDistance * 3.2);
    }
  }

  // 取景穩定化：不再每幀直接把距離套用（見檔頭說明）
  applyFrameFit({ distance, offX, offY }, options);

  // 相機不可進入場景：一旦相機比場景還靠近注視點，近平面就會把整個貨物
  // 判定成「在相機背後」而整塊不畫（症狀：放大＋轉視角後貨物消失，縮放一下才回來）。
  // 這裡用「所有角點在視線方向上的最大投影」當下限，確保相機永遠在場景外。
  let frontMax = -Infinity;
  boardCorners.concat(extraPoints).forEach(point => {
    frontMax = Math.max(frontMax, dot(sub(point, target), dir));
  });
  const minDistance = frontMax + Math.max(20, radius * 0.08);
  const viewDistance = Math.max(fitState.distance / camera.zoom, minDistance);

  return makeView(viewDistance, fitState.offX, fitState.offY);
}


function project(view, p) {
  const rel = sub(p, view.pos);
  const cz = dot(rel, view.forward);
  if (cz <= 0.5) return null;
  return {
    x: view.cx + view.f * dot(rel, view.right) / cz,
    y: view.cy - view.f * dot(rel, view.up) / cz,
    depth: cz
  };
}

function depthOf(view, p) {
  return dot(sub(p, view.pos), view.forward);
}

function rayFromPixel(view, px, py) {
  const nx = (px - view.cx) / view.f;
  const ny = -(py - view.cy) / view.f;
  return {
    origin: view.pos,
    dir: norm(add(view.forward, add(mul(view.right, nx), mul(view.up, ny))))
  };
}

// 射線與 AABB 相交（回傳最近命中距離；未命中回 null）
function rayBox(ray, e) {
  let tmin = -Infinity;
  let tmax = Infinity;
  const axes = [['x', e.x0, e.x1], ['y', e.y0, e.y1], ['z', e.z0, e.z1]];
  for (const [axis, lo, hi] of axes) {
    const o = ray.origin[axis];
    const d = ray.dir[axis];
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return null;
      continue;
    }
    let t1 = (lo - o) / d;
    let t2 = (hi - o) / d;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (tmax < 0) return null;
  return tmin > 0 ? tmin : tmax;
}

// ===== 繪圖小工具 =====
function fillPolygon(ctx, pts, fill, stroke, lineWidth, dash) {
  if (!pts || pts.length < 3) return;
  ctx.save();
  ctx.beginPath();
  pts.forEach((p, i) => {
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  });
  ctx.closePath();
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth || 1;
    if (dash) ctx.setLineDash(dash);
    ctx.stroke();
  }
  ctx.restore();
}

// 在多邊形內畫 45° 紅色斜線（出界區塊的網底）：填色在有色貨物上幾乎看不出來，
// 斜線網底＋外框才看得出「這一塊出界」，透明度由呼叫端隨 phase 呼吸。
function hatchPolygon(ctx, pts, alpha) {
  if (!pts || pts.length < 3) return;
  const minX = Math.min(...pts.map(p => p.x));
  const maxX = Math.max(...pts.map(p => p.x));
  const minY = Math.min(...pts.map(p => p.y));
  const maxY = Math.max(...pts.map(p => p.y));
  const span = Math.max(maxY - minY, 1);
  ctx.save();
  ctx.beginPath();
  pts.forEach((p, i) => { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
  ctx.closePath();
  ctx.clip();
  ctx.strokeStyle = `rgba(220,38,38,${alpha.toFixed(3)})`;
  ctx.lineWidth = 1;
  for (let x = minX - span; x < maxX; x += 7) {
    ctx.beginPath();
    ctx.moveTo(x, maxY);
    ctx.lineTo(x + span, minY);
    ctx.stroke();
  }
  ctx.restore();
}

function strokeLine(ctx, a, b, color, width, dash) {
  if (!a || !b) return;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.strokeStyle = color;
  ctx.lineWidth = width || 1;
  if (dash) ctx.setLineDash(dash);
  ctx.stroke();
  ctx.restore();
}

function drawTag(ctx, x, y, text, options = {}) {
  ctx.save();
  ctx.font = options.font || '700 11px Inter, "Segoe UI", Arial, sans-serif';
  const padX = options.padX === undefined ? 10 : options.padX;
  const width = ctx.measureText(text).width + padX;
  const height = options.height === undefined ? 17 : options.height;
  const rx = x - width / 2;
  const ry = y - height / 2;
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') ctx.roundRect(rx, ry, width, height, 5);
  else ctx.rect(rx, ry, width, height);
  ctx.fillStyle = options.bg || 'rgba(220,38,38,0.92)';
  ctx.fill();
  ctx.fillStyle = options.color || '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y + 0.5);
  ctx.restore();
}

function centerOf(e) {
  return {
    x: (e.x0 + e.x1) / 2,
    y: (e.y0 + e.y1) / 2,
    z: (e.z0 + e.z1) / 2
  };
}

// ===== 立方體 =====
function boxFaces(e) {
  const p = (x, y, z) => ({ x, y, z });
  return [
    { n: { x: -1, y: 0, z: 0 }, s: 0.68, pts: [p(e.x0, e.y0, e.z0), p(e.x0, e.y0, e.z1), p(e.x0, e.y1, e.z1), p(e.x0, e.y1, e.z0)] },
    { n: { x: 1, y: 0, z: 0 }, s: 0.68, pts: [p(e.x1, e.y0, e.z1), p(e.x1, e.y0, e.z0), p(e.x1, e.y1, e.z0), p(e.x1, e.y1, e.z1)] },
    { n: { x: 0, y: 1, z: 0 }, s: 1.12, pts: [p(e.x0, e.y1, e.z0), p(e.x0, e.y1, e.z1), p(e.x1, e.y1, e.z1), p(e.x1, e.y1, e.z0)] },
    { n: { x: 0, y: -1, z: 0 }, s: 0.45, pts: [p(e.x0, e.y0, e.z1), p(e.x0, e.y0, e.z0), p(e.x1, e.y0, e.z0), p(e.x1, e.y0, e.z1)] },
    { n: { x: 0, y: 0, z: -1 }, s: 0.88, pts: [p(e.x0, e.y0, e.z0), p(e.x1, e.y0, e.z0), p(e.x1, e.y1, e.z0), p(e.x0, e.y1, e.z0)] },
    { n: { x: 0, y: 0, z: 1 }, s: 0.88, pts: [p(e.x1, e.y0, e.z1), p(e.x0, e.y0, e.z1), p(e.x0, e.y1, e.z1), p(e.x1, e.y1, e.z1)] }
  ];
}

// 畫一個立方體（背面剔除；可指定半透明／虛線＝拖曳預覽）
function drawBox(ctx, view, e, color, options = {}) {
  const faces = boxFaces(e);
  const fillAlpha = options.fillAlpha === undefined ? 0.94 : options.fillAlpha;
  const edge = options.edge || shade(color, 0.45, 1);
  const lineWidth = options.lineWidth || 1;

  faces.forEach(face => {
    const center = mul(face.pts.reduce((acc, p) => add(acc, p), { x: 0, y: 0, z: 0 }), 1 / face.pts.length);
    if (dot(face.n, sub(view.pos, center)) <= 0) return; // 背面
    const pts = face.pts.map(p => project(view, p));
    if (pts.some(p => !p)) return;
    fillPolygon(ctx, pts, shade(color, face.s, fillAlpha), edge, lineWidth, options.dash);
  });
}

// 貨物編號（畫在上表面中心）
function drawItemLabel(ctx, view, ext, text, colors, options = {}) {
  const p = project(view, { x: (ext.x0 + ext.x1) / 2, y: ext.y1, z: (ext.z0 + ext.z1) / 2 });
  if (!p) return;
  ctx.save();
  ctx.font = '700 11px Inter, "Segoe UI", Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 3;
  ctx.strokeStyle = options.stroke || 'rgba(255,255,255,0.75)';
  ctx.strokeText(String(text), p.x, p.y);
  ctx.fillStyle = options.fill || colors.text;
  ctx.fillText(String(text), p.x, p.y);
  ctx.restore();
}

// ===== 地板 / 格線 / 板型線框 =====
// 地板 = 「貼地（板面）」範圍，不是輪廓上限；外擴型板型（H2/H3/H4/W2）的
// 輪廓會比板面大，超過板面的部分由 drawEnvelope() 的剖面線框表示。
function drawFloor(ctx, view, spec, colors) {
  const x0 = spec.floorX0 === undefined ? 0 : spec.floorX0;
  const x1 = spec.floorX1 === undefined ? spec.baseL : spec.floorX1;
  const z0 = spec.floorZ0 === undefined ? -spec.baseW / 2 : spec.floorZ0;
  const z1 = spec.floorZ1 === undefined ? spec.baseW / 2 : spec.floorZ1;
  const corners = [
    { x: x0, y: 0, z: z0 },
    { x: x0, y: 0, z: z1 },
    { x: x1, y: 0, z: z1 },
    { x: x1, y: 0, z: z0 }
  ].map(p => project(view, p));
  if (corners.some(p => !p)) return;
  fillPolygon(ctx, corners, rgba(colors.primary, 0.08), rgba(colors.primary, 0.55), 1.8);
}

function drawGrid(ctx, view, spec, unit, colors) {
  const x0 = spec.floorX0 === undefined ? 0 : spec.floorX0;
  const x1 = spec.floorX1 === undefined ? spec.baseL : spec.floorX1;
  const z0 = spec.floorZ0 === undefined ? -spec.baseW / 2 : spec.floorZ0;
  const z1 = spec.floorZ1 === undefined ? spec.baseW / 2 : spec.floorZ1;
  const pxPerCm = view.f / Math.max(1, depthOf(view, view.target));
  const step = loadsimTickStepCm(unit, pxPerCm);
  const color = rgba(colors.muted, 0.16);
  for (let z = z0; z <= z1 + 0.01; z += step) {
    strokeLine(ctx,
      project(view, { x: x0, y: 0, z }),
      project(view, { x: x1, y: 0, z }), color, 1);
  }
  for (let x = x0; x <= x1 + 0.01; x += step) {
    strokeLine(ctx,
      project(view, { x, y: 0, z: z0 }),
      project(view, { x, y: 0, z: z1 }), color, 1);
  }
}

function drawEnvelope(ctx, view, spec, colors) {
  // 剖面沿某一軸擠出：整圈邊線＋「斜面」半透明面（收角／外擴才看得出來）
  const sectionFaces = (section, along, from, to) => {
    const point = (u, v, t) => (along === 'x' ? { x: t, y: v, z: u } : { x: u, y: v, z: t });
    const n = section.length;
    for (let i = 0; i < n; i++) {
      const [u1, v1] = section[i];
      const [u2, v2] = section[(i + 1) % n];
      const a = project(view, point(u1, v1, from));
      const b = project(view, point(u2, v2, from));
      const c = project(view, point(u2, v2, to));
      const d = project(view, point(u1, v1, to));
      if (!a || !b || !c || !d) continue;
      const slant = Math.abs(u2 - u1) > 0.01 && Math.abs(v2 - v1) > 0.01;
      if (slant) {
        fillPolygon(ctx, [a, b, c, d], rgba(colors.primary, 0.12), rgba(colors.primary, 0.55), 1.1);
      } else {
        strokeLine(ctx, a, b, rgba(colors.primary, 0.26), 1);
        strokeLine(ctx, a, d, rgba(colors.primary, 0.26), 1);
      }
    }
  };

  const zRect = isRectProfile(spec.profileZ);
  const xRect = isRectProfile(spec.profileX);

  // 寬×高剖面沿 X 擠出（Q 系列：上緣收角）
  if (!zRect || xRect) sectionFaces(spec.profileZ, 'x', 0, spec.baseL);
  // 長×高剖面沿 Z 擠出（H/W 系列：底部外擴、A4/Q9：兩端收角）
  if (!xRect) sectionFaces(spec.profileX, 'z', -spec.baseW / 2, spec.baseW / 2);

  // 端面：另一方向的剖面是矩形時，端面就是完整剖面 → 補上淡淡填色
  if (xRect) {
    [0, spec.baseL].forEach(x => {
      const pts = spec.profileZ.map(([z, y]) => project(view, { x, y, z }));
      if (pts.every(Boolean)) fillPolygon(ctx, pts, rgba(colors.primary, 0.05), rgba(colors.primary, 0.30), 1.2);
    });
  }
  if (zRect) {
    [-spec.baseW / 2, spec.baseW / 2].forEach(z => {
      const pts = spec.profileX.map(([x, y]) => project(view, { x, y, z }));
      if (pts.every(Boolean)) fillPolygon(ctx, pts, rgba(colors.primary, 0.05), rgba(colors.primary, 0.30), 1.2);
    });
  }
}

// 剖面是否為「矩形」（沒有收角）→ 用來決定要畫哪一個方向的剖面線框
function isRectProfile(poly) {
  if (!Array.isArray(poly) || poly.length !== 4) return false;
  const us = poly.map(([u]) => u);
  const vs = poly.map(([, v]) => v);
  const u0 = Math.min(...us);
  const u1 = Math.max(...us);
  const v0 = Math.min(...vs);
  const v1 = Math.max(...vs);
  const near = (a, b) => Math.abs(a - b) < 0.01;
  return poly.every(([u, v]) =>
    (near(u, u0) || near(u, u1)) && (near(v, v0) || near(v, v1)));
}

// ===== 暫存區（① 板後方、② 板前方 的空地）=====
function stageCorners(stage) {
  return [
    { x: stage.x0, y: 0, z: stage.z0 },
    { x: stage.x0, y: 0, z: stage.z1 },
    { x: stage.x1, y: 0, z: stage.z1 },
    { x: stage.x1, y: 0, z: stage.z0 }
  ];
}

function drawStage(ctx, view, spec, colors, lod) {
  loadsimStageRects(spec).forEach(stage => {
    const corners = stageCorners(stage).map(p => project(view, p));
    if (corners.some(p => !p)) return;
    fillPolygon(ctx, corners, rgba(colors.muted, 0.05), rgba(colors.muted, 0.45), 1.2, [7, 5]);

    if (lod) return;
    const mid = project(view, {
      x: (stage.x0 + stage.x1) / 2, y: 0, z: (stage.z0 + stage.z1) / 2
    });
    if (!mid) return;
    ctx.save();
    ctx.font = '600 11px Inter, "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = rgba(colors.muted, 0.85);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${stage.label}（拖出板外暫放）`, mid.x, mid.y);
    ctx.restore();
  });
}

// ===== 閃爍高亮（點下方貨物明細時用）=====
function drawHighlight(ctx, view, ext, phase) {
  const t = Math.max(0, Math.min(1, phase === undefined ? 1 : phase));
  const pulse = 0.5 + 0.5 * Math.sin(t * Math.PI * 2 * 2); // 兩次閃爍
  const alpha = 0.18 + 0.5 * pulse;
  const color = `rgba(250, 204, 21, ${alpha.toFixed(3)})`;
  const corners = [];
  [ext.x0, ext.x1].forEach(x => [ext.y0, ext.y1].forEach(y => [ext.z0, ext.z1].forEach(z => corners.push({ x, y, z }))));
  const p = corners.map(c => project(view, c));
  if (p.some(c => !c)) return;
  const pairs = [
    [0, 1], [2, 3], [4, 5], [6, 7],
    [0, 2], [1, 3], [4, 6], [5, 7],
    [0, 4], [1, 5], [2, 6], [3, 7]
  ];
  pairs.forEach(([i, j]) => strokeLine(ctx, p[i], p[j], color, 2.5 + 1.5 * pulse));
}


// ===== 超出輪廓：3D 紅色半透明體積 =====
// 把貨物剖面矩形與「該邊外側」做多邊形裁切，再沿第三軸擠出成柱體
function overflowPrism(ext, entry) {
  const plane = entry.plane;
  if (!plane) return null;
  const isZ = plane.axis === 'z';
  const rect = isZ
    ? [[ext.z0, ext.y0], [ext.z1, ext.y0], [ext.z1, ext.y1], [ext.z0, ext.y1]]
    : [[ext.x0, ext.y0], [ext.x1, ext.y0], [ext.x1, ext.y1], [ext.x0, ext.y1]];
  const poly = loadsimClipRectOutside(rect, plane);
  if (poly.length < 3) return null;

  const toPoint = ([u, v], farEnd) => (isZ
    ? { x: farEnd ? ext.x1 : ext.x0, y: v, z: u }
    : { x: u, y: v, z: farEnd ? ext.z1 : ext.z0 });

  return {
    capA: poly.map(p => toPoint(p, false)),
    capB: poly.map(p => toPoint(p, true))
  };
}

// ===== 第一層壓到板底 ring track 的提示（與超出輪廓同一套：紅色斜線＋標示壓到多少）=====
function drawRingSlabs(ctx, view, spec, ext, unit, options = {}) {
  const rects = loadsimRingHitRects(ext, spec);
  if (!rects.length) return;
  const k = overflowPulse(options);
  const fill = `rgba(220,38,38,${(0.4 * k).toFixed(3)})`;
  const edge = `rgba(220,38,38,${(0.85 * k + 0.12).toFixed(3)})`;
  const hatchAlpha = 0.3 + 0.45 * k;
  let worst = null;
  rects.forEach(rect => {
    const pts = [
      { x: rect.x0, y: 0, z: rect.z0 },
      { x: rect.x0, y: 0, z: rect.z1 },
      { x: rect.x1, y: 0, z: rect.z1 },
      { x: rect.x1, y: 0, z: rect.z0 }
    ].map(p => project(view, p));
    if (pts.some(p => !p)) return;
    fillPolygon(ctx, pts, fill, edge, 1.9, [4, 3]);
    if (!options.lod) hatchPolygon(ctx, pts, hatchAlpha);
    const w = rect.x1 - rect.x0;
    const d = rect.z1 - rect.z0;
    if (!worst || Math.max(w, d) > worst.size) worst = { rect, size: Math.max(w, d) };
  });
  if (options.lod || !worst) return;
  const mid = project(view, {
    x: (worst.rect.x0 + worst.rect.x1) / 2,
    y: 0,
    z: (worst.rect.z0 + worst.rect.z1) / 2
  });
  if (!mid) return;
  // 標籤往「遠離板面中心」的方向推 18px，避免和板面尺寸／ring track 文字疊在一起
  const x0 = spec.floorX0 === undefined ? 0 : spec.floorX0;
  const x1 = spec.floorX1 === undefined ? spec.baseL : spec.floorX1;
  const z0 = spec.floorZ0 === undefined ? -spec.baseW / 2 : spec.floorZ0;
  const z1 = spec.floorZ1 === undefined ? spec.baseW / 2 : spec.floorZ1;
  const centerPx = project(view, { x: (x0 + x1) / 2, y: 0, z: (z0 + z1) / 2 });
  let dx = centerPx ? mid.x - centerPx.x : 0;
  let dy = centerPx ? mid.y - centerPx.y : 1;
  const dist = Math.hypot(dx, dy);
  if (dist < 1e-6) { dx = 0; dy = 1; } else { dx /= dist; dy /= dist; }
  const tagX = clamp(mid.x + dx * 20, 26, Math.max(26, (view.width || 0) - 40));
  const tagY = clamp(mid.y + dy * 20, 14, Math.max(14, (view.height || 0) - 14));
  const amount = options.ringOverlap || 0;
  drawTag(ctx, tagX, tagY, `ring +${loadsimFormatAmount(amount, unit)} ${loadsimUnitLabel(unit)}`, {
    bg: 'rgba(220,38,38,0.92)',
    color: '#ffffff',
    font: '700 10px Inter, "Segoe UI", Arial, sans-serif',
    padX: 7,
    height: 15
  });
}

// 超出輪廓的閃爍係數：phase 0→1 來回呼吸（0.4～1），讓出界區塊「弱弱地閃」
function overflowPulse(options = {}) {
  if (options.overflowPhase === undefined) return 1;
  const t = ((options.overflowPhase % 1) + 1) % 1;
  return 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(t * Math.PI * 2));
}

function drawOverflowSlabs(ctx, view, ext, entries, unit, options = {}) {
  // 弱弱地閃爍：透明度在 40%~100% 之間呼吸
  const k = overflowPulse(options);
  const capFill = `rgba(220,38,38,${(0.32 * k).toFixed(3)})`;
  const capEdge = `rgba(220,38,38,${(0.85 * k + 0.1).toFixed(3)})`;
  const sideFill = `rgba(220,38,38,${(0.2 * k).toFixed(3)})`;
  const sideEdge = `rgba(220,38,38,${(0.5 * k).toFixed(3)})`;
  entries.forEach(entry => {
    const prism = overflowPrism(ext, entry);
    if (!prism) return;
    const isZ = entry.plane.axis === 'z'; // 剖面在 z-y，沿 x 擠出
    const capA = prism.capA.map(p => project(view, p));
    const capB = prism.capB.map(p => project(view, p));
    // 端面剔除（背面剔除）：出界體積是「疊在貨物上面」畫的，
    // 若不剔除背對鏡頭的那一端，會在貨物正面看到一片不該出現的紅色斷面。
    const capANormal = isZ ? { x: -1, y: 0, z: 0 } : { x: 0, y: 0, z: -1 };
    const capBNormal = isZ ? { x: 1, y: 0, z: 0 } : { x: 0, y: 0, z: 1 };
    const faceTowardCamera = (normal, points) => {
      const c = points.reduce((acc, p) => add(acc, p), { x: 0, y: 0, z: 0 });
      const center = mul(c, 1 / points.length);
      return dot(normal, sub(view.pos, center)) > 0;
    };
    const showA = faceTowardCamera(capANormal, prism.capA);
    const showB = faceTowardCamera(capBNormal, prism.capB);
    // 斜線網底：填色疊在有色貨物上幾乎看不出來，網底＋外框才看得出出界區塊（alpha 0.43~0.7 弱弱地呼吸）
    // LOD（拖曳／轉視角）時省略網底，只留填色與外框，維持互動流暢
    const hatchAlpha = 0.25 + 0.45 * k;

    if (showA && capA.every(Boolean)) {
      fillPolygon(ctx, capA, capFill, capEdge, 1.2);
      if (!options.lod) hatchPolygon(ctx, capA, hatchAlpha);
    }
    if (showB && capB.every(Boolean)) {
      fillPolygon(ctx, capB, capFill, capEdge, 1.2);
      if (!options.lod) hatchPolygon(ctx, capB, hatchAlpha);
    }

    // LOD：只畫端面（紅色體積仍看得見），省掉側面四邊形與數字標籤
    if (options.lod) return;

    for (let i = 0; i < prism.capA.length; i++) {
      const j = (i + 1) % prism.capA.length;
      const quad = [capA[i], capA[j], capB[j], capB[i]];
      if (quad.every(Boolean)) {
        fillPolygon(ctx, quad, sideFill, sideEdge, 0.8);
      }
    }

    const all = prism.capA.concat(prism.capB);
    const center = mul(all.reduce((acc, p) => add(acc, p), { x: 0, y: 0, z: 0 }), 1 / all.length);
    const centerPx = project(view, center);
    if (!centerPx) return;

    // ===== 界線＋引線：把「+xx cm」用一條線連到被跨越的那一條輪廓邊 =====
    // 界線取「面向鏡頭那一側」的表面（背面那條看不到，畫了反而誤導）
    const boxCenter = centerOf(ext);
    const boxCenterPx = project(view, boxCenter);
    let edgeMid = null;
    const seg = loadsimOverflowBoundary(ext, entry);
    if (seg) {
      const isZAxis = entry.plane.axis === 'z';
      const side = isZAxis
        ? (dot({ x: 1, y: 0, z: 0 }, sub(view.pos, boxCenter)) > 0 ? ext.x1 : ext.x0)
        : (dot({ x: 0, y: 0, z: 1 }, sub(view.pos, boxCenter)) > 0 ? ext.z1 : ext.z0);
      const toPoint3 = ([u, v]) => (isZAxis ? { x: side, y: v, z: u } : { x: u, y: v, z: side });
      const pA = project(view, toPoint3(seg.a));
      const pB = project(view, toPoint3(seg.b));
      if (pA && pB) {
        strokeLine(ctx, pA, pB, `rgba(220,38,38,${(0.62 + 0.33 * k).toFixed(3)})`, 2.2);
        // 界線幾乎側對鏡頭（投影很短）時不做外推，免得標籤方向亂跳
        if (Math.hypot(pB.x - pA.x, pB.y - pA.y) >= 6) {
          edgeMid = { x: (pA.x + pB.x) / 2, y: (pA.y + pB.y) / 2 };
        }
      }
    }

    let tagX = centerPx.x;
    let tagY = centerPx.y;
    if (edgeMid) {
      // 標籤放到界線外側 26px，再用虛線引線連回界線中點
      let dx = boxCenterPx ? edgeMid.x - boxCenterPx.x : 0;
      let dy = boxCenterPx ? edgeMid.y - boxCenterPx.y : -1;
      const len = Math.hypot(dx, dy);
      if (len < 1e-6) { dx = 0; dy = -1; } else { dx /= len; dy /= len; }
      const maxX = Math.max(24, (view.width || 0) - 24);
      const maxY = Math.max(14, (view.height || 0) - 14);
      tagX = clamp(edgeMid.x + dx * 26, 24, maxX);
      tagY = clamp(edgeMid.y + dy * 26, 14, maxY);
      strokeLine(ctx, { x: tagX, y: tagY }, edgeMid, 'rgba(220,38,38,0.78)', 1.2, [3, 3]);
      ctx.save();
      ctx.beginPath();
      ctx.arc(edgeMid.x, edgeMid.y, 2.4, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(220,38,38,0.95)';
      ctx.fill();
      ctx.restore();
    }
    drawTag(ctx, tagX, tagY, `+${loadsimFormatAmount(entry.amount, unit)} ${loadsimUnitLabel(unit)}`);
  });
}

// ===== 滑過貨物：在「看得見的每一條邊」標出長度 =====
// 立方體 12 條邊中，只要「至少一個相鄰面朝向鏡頭」就是看得到的邊；
// 每條邊在中點往外 13px 標長度（三個方向各 3 條）。投影太短（幾乎對準鏡頭）
// 的邊不標，同一個數字靠得太近也不重複標，避免字疊在一起。
function drawEdgeDims(ctx, view, ext, unit) {
  const corner = (xi, yi, zi) => ({
    x: xi ? ext.x1 : ext.x0,
    y: yi ? ext.y1 : ext.y0,
    z: zi ? ext.z1 : ext.z0
  });
  const faceFront = (normal, pts) => {
    const c = mul(pts.reduce((acc, p) => add(acc, p), { x: 0, y: 0, z: 0 }), 1 / pts.length);
    return dot(normal, sub(view.pos, c)) > 0;
  };
  const visible = {
    x0: faceFront({ x: -1, y: 0, z: 0 }, [corner(0, 0, 0), corner(0, 0, 1), corner(0, 1, 1), corner(0, 1, 0)]),
    x1: faceFront({ x: 1, y: 0, z: 0 }, [corner(1, 0, 0), corner(1, 0, 1), corner(1, 1, 1), corner(1, 1, 0)]),
    y0: faceFront({ x: 0, y: -1, z: 0 }, [corner(0, 0, 1), corner(0, 0, 0), corner(1, 0, 0), corner(1, 0, 1)]),
    y1: faceFront({ x: 0, y: 1, z: 0 }, [corner(0, 1, 0), corner(0, 1, 1), corner(1, 1, 1), corner(1, 1, 0)]),
    z0: faceFront({ x: 0, y: 0, z: -1 }, [corner(0, 0, 0), corner(1, 0, 0), corner(1, 1, 0), corner(0, 1, 0)]),
    z1: faceFront({ x: 0, y: 0, z: 1 }, [corner(1, 0, 1), corner(0, 0, 1), corner(0, 1, 1), corner(1, 1, 1)])
  };

  const names = ['x', 'y', 'z'];
  const edges = [];
  for (let axis = 0; axis < 3; axis++) {
    const o1 = (axis + 1) % 3;
    const o2 = (axis + 2) % 3;
    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < 2; j++) {
        const a = { x: ext.x0, y: ext.y0, z: ext.z0 };
        const b = { x: ext.x0, y: ext.y0, z: ext.z0 };
        a[names[axis]] = ext[`${names[axis]}0`];
        b[names[axis]] = ext[`${names[axis]}1`];
        a[names[o1]] = ext[`${names[o1]}${i}`];
        b[names[o1]] = ext[`${names[o1]}${i}`];
        a[names[o2]] = ext[`${names[o2]}${j}`];
        b[names[o2]] = ext[`${names[o2]}${j}`];
        edges.push({
          a,
          b,
          len: ext[`${names[axis]}1`] - ext[`${names[axis]}0`],
          faces: [`${names[o1]}${i}`, `${names[o2]}${j}`]
        });
      }
    }
  }

  const centerPx = project(view, centerOf(ext));
  const drawn = [];
  edges.forEach(edge => {
    if (!visible[edge.faces[0]] && !visible[edge.faces[1]]) return;
    const pa = project(view, edge.a);
    const pb = project(view, edge.b);
    if (!pa || !pb) return;
    if (Math.hypot(pb.x - pa.x, pb.y - pa.y) < 18) return; // 太短的邊（幾乎對準鏡頭）不標
    const mx = (pa.x + pb.x) / 2;
    const my = (pa.y + pb.y) / 2;
    let dx = centerPx ? mx - centerPx.x : 0;
    let dy = centerPx ? my - centerPx.y : -1;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) { dx = 0; dy = -1; } else { dx /= len; dy /= len; }
    const tx = mx + dx * 13;
    const ty = my + dy * 13;
    const text = loadsimFormatNumber(edge.len, unit);
    if (drawn.some(d => d.text === text && Math.hypot(d.x - tx, d.y - ty) < 26)) return;
    drawn.push({ x: tx, y: ty, text });
    drawTag(ctx, tx, ty, text, {
      bg: 'rgba(15,23,42,0.82)',
      color: '#f8fafc',
      font: '700 10px Inter, "Segoe UI", Arial, sans-serif',
      padX: 7,
      height: 15
    });
  });
}

// ===== 板底 ring track（四邊加強框）=====
// 第一層貨物不能壓在 ring 上：把「板面 − ring 內框」這 4 條帶狀區畫成琥珀色帶，
// 內框再用虛線標出並寫上第一層可用尺寸（第二層以上不受限制）。
function drawRingTrack(ctx, view, spec, unit, lod) {
  const ring = spec.ringRect;
  if (!ring || ring.disabled) return;
  const x0 = spec.floorX0 === undefined ? 0 : spec.floorX0;
  const x1 = spec.floorX1 === undefined ? spec.baseL : spec.floorX1;
  const z0 = spec.floorZ0 === undefined ? -spec.baseW / 2 : spec.floorZ0;
  const z1 = spec.floorZ1 === undefined ? spec.baseW / 2 : spec.floorZ1;

  // 4 條帶狀區（前 / 後 / 左 / 右）
  const strips = [
    { x0, x1, z0, z1: ring.z0 },
    { x0, x1, z0: ring.z1, z1 },
    { x0, x1: ring.x0, z0: ring.z0, z1: ring.z1 },
    { x0: ring.x1, x1, z0: ring.z0, z1: ring.z1 }
  ];
  const fill = rgba('#f59e0b', 0.16);
  const edge = rgba('#f59e0b', 0.5);
  strips.forEach(strip => {
    if (strip.x1 - strip.x0 < 0.01 || strip.z1 - strip.z0 < 0.01) return;
    const pts = [
      { x: strip.x0, y: 0, z: strip.z0 },
      { x: strip.x0, y: 0, z: strip.z1 },
      { x: strip.x1, y: 0, z: strip.z1 },
      { x: strip.x1, y: 0, z: strip.z0 }
    ].map(p => project(view, p));
    if (pts.some(p => !p)) return;
    fillPolygon(ctx, pts, fill, edge, 1);
  });

  // 內框（第一層可裝貨的界線）
  const inner = [
    { x: ring.x0, y: 0, z: ring.z0 },
    { x: ring.x0, y: 0, z: ring.z1 },
    { x: ring.x1, y: 0, z: ring.z1 },
    { x: ring.x1, y: 0, z: ring.z0 }
  ].map(p => project(view, p));
  if (!inner.some(p => !p)) fillPolygon(ctx, inner, null, rgba('#d97706', 0.85), 1.5, [6, 4]);
  if (lod) return;

  // 標籤：靠近鏡頭那一條 ring 帶
  const ringPx = project(view, { x: (x0 + x1) / 2, y: 0, z: (ring.z1 + z1) / 2 });
  if (ringPx) {
    ctx.save();
    ctx.font = '600 10px Inter, "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = rgba('#b45309', 0.95);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`ring track（${spec.plateLabel || ''}）：第一層不可壓`, ringPx.x, ringPx.y);
    ctx.restore();
  }
  const innerPx = project(view, {
    x: (ring.x0 + ring.x1) / 2,
    y: 0,
    z: (ring.z0 + ring.z1) / 2
  });
  if (innerPx) {
    ctx.save();
    ctx.font = '700 10px Inter, "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = rgba('#b45309', 0.9);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`第一層可裝 ${loadsimFormatNumber(ring.widthCm, unit, 0)} × ${loadsimFormatNumber(ring.depthCm, unit, 0)} ${loadsimUnitLabel(unit)}`,
      innerPx.x, innerPx.y);
    ctx.restore();
  }
}

// ===== 輪廓（Contour）每一條邊的長度 =====
// 把 envelope 真正畫出來的邊（兩個端面的多邊形邊＋擠出方向的邊）都標上長度；
// 投影太短、或標籤會疊在一起的重複數字都略過。
function envelopeEdges(spec) {
  const edges = [];
  const seen = new Set();
  const key = p => `${Math.round(p.x * 10)},${Math.round(p.y * 10)},${Math.round(p.z * 10)}`;
  const push = (a, b) => {
    const len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    if (len < 0.5) return;
    const k = [key(a), key(b)].sort().join('|');
    if (seen.has(k)) return;
    seen.add(k);
    edges.push({ a, b, len });
  };
  const sectionAt = (section, along, t) => section.map(([u, v]) => (
    along === 'x' ? { x: t, y: v, z: u } : { x: u, y: v, z: t }
  ));
  const addSection = (section, along, from, to) => {
    const A = sectionAt(section, along, from);
    const B = sectionAt(section, along, to);
    for (let i = 0; i < section.length; i++) {
      const j = (i + 1) % section.length;
      push(A[i], A[j]);
      push(B[i], B[j]);
      push(A[i], B[i]);
    }
  };
  const zRect = isRectProfile(spec.profileZ);
  const xRect = isRectProfile(spec.profileX);
  if (!zRect || xRect) addSection(spec.profileZ, 'x', 0, spec.baseL);
  if (!xRect) addSection(spec.profileX, 'z', -spec.baseW / 2, spec.baseW / 2);
  return edges;
}

function drawEnvelopeDims(ctx, view, spec, unit, colors) {
  const edges = envelopeEdges(spec);
  if (!edges.length) return;
  const centerPx = project(view, { x: spec.baseL / 2, y: spec.heightCm * 0.35, z: 0 });
  const drawn = [];
  edges.forEach(edge => {
    const pa = project(view, edge.a);
    const pb = project(view, edge.b);
    if (!pa || !pb) return;
    if (Math.hypot(pb.x - pa.x, pb.y - pa.y) < 16) return;
    const mx = (pa.x + pb.x) / 2;
    const my = (pa.y + pb.y) / 2;
    let dx = centerPx ? mx - centerPx.x : 0;
    let dy = centerPx ? my - centerPx.y : -1;
    const dist = Math.hypot(dx, dy);
    if (dist < 1e-6) { dx = 0; dy = -1; } else { dx /= dist; dy /= dist; }
    const tx = mx + dx * 11;
    const ty = my + dy * 11;
    const text = loadsimFormatNumber(edge.len, unit);
    if (drawn.some(d => d.text === text && Math.hypot(d.x - tx, d.y - ty) < 24)) return;
    if (drawn.some(d => Math.hypot(d.x - tx, d.y - ty) < 18)) return;
    drawn.push({ x: tx, y: ty, text });
    drawTag(ctx, tx, ty, text, {
      bg: 'rgba(255,255,255,0.9)',
      color: rgba(colors.primary, 0.95),
      font: '700 10px Inter, "Segoe UI", Arial, sans-serif',
      padX: 5,
      height: 14
    });
  });
}

// ===== 板型尺寸標註（畫在板面邊緣）=====
function drawBoardLabels(ctx, view, spec, unit, colors) {
  const label = loadsimFormatNumber;
  const u = loadsimUnitLabel(unit);
  const x0 = spec.floorX0 === undefined ? 0 : spec.floorX0;
  const x1 = spec.floorX1 === undefined ? spec.baseL : spec.floorX1;
  const z0 = spec.floorZ0 === undefined ? -spec.baseW / 2 : spec.floorZ0;
  const floorL = spec.floorL === undefined ? spec.baseL : spec.floorL;
  const floorW = spec.floorW === undefined ? spec.baseW : spec.floorW;
  const floorMid = project(view, { x: (x0 + x1) / 2, y: 0, z: z0 });
  const widthMid = project(view, { x: x0, y: 0, z: (spec.floorZ0 === undefined ? 0 : (spec.floorZ0 + spec.floorZ1) / 2) });
  ctx.save();
  ctx.font = '600 11px Inter, "Segoe UI", Arial, sans-serif';
  ctx.fillStyle = rgba(colors.muted, 0.95);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  if (floorMid) {
    ctx.fillText(`板面 ${label(floorL, unit)} × ${label(floorW, unit)} ${u}`,
      floorMid.x, floorMid.y + 8);
  }
  if (widthMid) {
    ctx.fillText(`板寬 ${label(floorW, unit)} ${u}`, widthMid.x, widthMid.y + 8);
  }
  // 外擴型（H2/H3/H4/W2）：另外標出輪廓上限，避免誤以為板面有那麼長
  if (spec.flared) {
    const outlineMid = project(view, { x: spec.baseL / 2, y: spec.heightCm, z: -spec.baseW / 2 });
    if (outlineMid) {
      ctx.fillStyle = rgba(colors.primary, 0.85);
      ctx.fillText(`輪廓 ${label(spec.baseL, unit)} × ${label(spec.baseW, unit)} ${u}`,
        outlineMid.x, outlineMid.y - 16);
    }
  }
  ctx.restore();
}


// ===== 場景分析快取（效能）=====
// 3D 每一幀都需要「每件貨物是否重疊 / 超出輪廓」與「取景用的角點」。
// 這些結果只跟貨物座標、板型、模式開關有關，跟相機（轉視角 / 縮放）無關；
// 因此用簽章比對，場景沒變就沿用上一幀結果 → 轉視角時不再每幀重算 O(n²) 判定。
let sceneCache = { key: '', entries: null, reports: null, extraPoints: null };

function sceneKeyOf(spec, placed, options) {
  const parts = [
    spec.code, spec.baseL, spec.baseW, spec.heightCm,
    spec.plateType || 'thin',
    options.allowOverhang ? 1 : 0,
    options.requireSupport === false ? 0 : 1,
    options.supportMinPct === undefined ? 50 : Number(options.supportMinPct),
    options.supportAreaEnabled === false ? 0 : 1,
    placed.length
  ];
  for (let i = 0; i < placed.length; i++) {
    const item = placed[i];
    parts.push(item.id, item.x, item.y, item.z, item.orient, item.staged ? 1 : 0);
  }
  return parts.join('|');
}

function analyzeScene(spec, placed, options) {
  const key = sceneKeyOf(spec, placed, options);
  if (sceneCache.key === key && sceneCache.entries) return sceneCache;

  const entries = placed.map(item => ({ item, ext: loadsimExtents(item) }));
  const board = placed.filter(item => !item.staged);
  const reports = new Map();
  placed.forEach(item => {
    // 暫存的貨物不在板上 → 不做輪廓／重疊／支撐判定
    if (item.staged) {
      reports.set(item.id, {
        ok: true, fits: true, overlaps: [], overflows: [], supported: true, overhangMax: 0
      });
      return;
    }
    const others = board.filter(other => other.id !== item.id);
    reports.set(item.id, loadsimEvaluatePlacement(item, spec, others, {
      allowOverhang: options.allowOverhang,
      requireSupport: options.requireSupport,
      supportMinPct: options.supportMinPct,
      supportAreaEnabled: options.supportAreaEnabled
    }));
  });

  const extraPoints = [];
  entries.forEach(({ ext }) => {
    [ext.x0, ext.x1].forEach(x => {
      [ext.y0, ext.y1].forEach(y => {
        [ext.z0, ext.z1].forEach(z => extraPoints.push({ x, y, z }));
      });
    });
  });

  sceneCache = { key, entries, reports, extraPoints };
  return sceneCache;
}

// ===== 主繪圖入口（與 2D 版同一組參數）=====
export function loadsimDraw3D(options) {
  const { ctx, width, height, spec, unit, items } = options;
  // 防呆：轉視角（orbit）等「不是拖曳貨物」的 session 沒有 temp，
  // 若把 preview 當成有效值會讓這裡丟錯，整張畫布清空後貨物全不畫。
  const preview = options.preview && options.preview.item ? options.preview : null;
  const colors = themeColors();
  const placed = (items || []).filter(item => item.placed);
  const analysis = analyzeScene(spec, placed, options);

  // 互動中（拖曳貨物／轉視角）走 LOD：省略文字、刻度、金額標籤等最貴的繪製
  const lod = !!options.lod;
  const freezeFrame = !!options.freezeFrame;
  const snapFrame = !!options.snapFrame;

  // 取景：只納入「已放置貨物」，不含拖曳中的預覽（否則拖到板邊會讓整張板子縮放 → 回饋抖動）
  // frameKey 只放「板型＋畫布尺寸」→ 換板型/改尺寸立刻重算（snap）；
  // 貨物增減只走平滑收合，避免放下貨物時畫面突然跳一下。
  const frameKey = [
    Math.round(width), Math.round(height), spec.code,
    spec.baseL, spec.baseW, spec.heightCm
  ].join('|');
  // 取景要一併納入「暫存區」（① 板後方、② 板前方、③ 兩區延伸的角落），否則把貨物拖到板外時看不到落點
  const stagePoints = [];
  loadsimStageRects(spec).forEach(stage => stageCorners(stage).forEach(p => stagePoints.push(p)));
  const framePoints = analysis.extraPoints.concat(stagePoints);
  const view = buildView(spec, width, height, framePoints, { frameKey, freezeFrame, snapFrame });

  ctx.clearRect(0, 0, width, height);
  drawFloor(ctx, view, spec, colors);
  drawGrid(ctx, view, spec, unit, colors);
  drawRingTrack(ctx, view, spec, unit, lod);
  drawStage(ctx, view, spec, colors, lod);
  drawEnvelope(ctx, view, spec, colors);
  // 輪廓（Contour）每一條邊都標長度（拖曳／轉視角的 LOD 期間省略）
  if (!lod) drawEnvelopeDims(ctx, view, spec, unit, colors);

  const hideId = preview ? preview.item.id : null;
  const ordered = analysis.entries
    .filter(({ item }) => item.id !== hideId)
    .map(({ item, ext }) => ({ item, ext, depth: depthOf(view, centerOf(ext)) }))
    .sort((a, b) => b.depth - a.depth);

  ordered.forEach(({ item, ext }) => {
    const report = analysis.reports.get(item.id);
    const selected = item.id === options.selectedId;
    const hovered = item.id === options.hoverId;
    const staged = !!item.staged;
    drawBox(ctx, view, ext, item.color, {
      // 暫存（不在板上）：淡填色＋虛線框
      fillAlpha: staged ? 0.5 : 0.94,
      edge: staged ? rgba(colors.muted, 0.9) : (selected ? colors.primary : shade(item.color, 0.45, 1)),
      lineWidth: staged ? 1.3 : (selected ? 2.6 : (hovered ? 2.0 : 1)),
      dash: staged ? [5, 4] : undefined
    });
    // LOD：拖曳／轉視角時只保留「選取中／滑過」的編號（文字是 Canvas 2D 最貴的操作）
    if (!lod || selected || hovered) drawItemLabel(ctx, view, ext, item.id, colors);
    // 出界區塊一定要「畫在貨物本體之後」：貨物填色近乎不透明（0.94），
    // 先畫會被自己的貨物整塊蓋掉 → 看不到紅色出界區，也看不到 +xx cm 標籤。
    if (report && report.overflows.length) {
      drawOverflowSlabs(ctx, view, ext, report.overflows, unit, { lod, overflowPhase: options.overflowPhase });
    }
    // 第一層壓到板底 ring track：同樣用紅色斜線＋「ring +xx cm」標示（嚴格模式才會擋下）
    if (report && report.onRing) {
      drawRingSlabs(ctx, view, spec, ext, unit, {
        lod, overflowPhase: options.overflowPhase, ringOverlap: report.ringOverlap
      });
    }
    if (item.id === options.highlightId) drawHighlight(ctx, view, ext, options.highlightPhase);
    // 滑過貨物：把「看得見的每一條邊」的長度標出來（拖曳／轉視角的 LOD 期間省略）
    if (hovered && !lod) drawEdgeDims(ctx, view, ext, unit);
  });

  if (preview) {
    const ext = loadsimExtents(preview.item);
    drawBox(ctx, view, ext, preview.valid ? '#16a34a' : '#dc2626', {
      fillAlpha: 0.45,
      edge: preview.valid ? '#15803d' : '#b91c1c',
      lineWidth: 2,
      dash: [5, 4]
    });
    if (!lod) drawItemLabel(ctx, view, ext, preview.item.id, colors, { stroke: 'rgba(255,255,255,0.85)' });
    // 同上：預覽的出界區塊也要畫在預覽貨物之後
    if (preview.overflows && preview.overflows.length) {
      drawOverflowSlabs(ctx, view, ext, preview.overflows, unit, { lod, overflowPhase: options.overflowPhase });
    }
    if (preview.onRing) {
      drawRingSlabs(ctx, view, spec, ext, unit, {
        lod, overflowPhase: options.overflowPhase, ringOverlap: preview.ringOverlap
      });
    }
  }

  if (!lod) drawBoardLabels(ctx, view, spec, unit, colors);

  // 命中測試直接用快取好的包圍盒，不必每幀重算
  const extents = new Map();
  analysis.entries.forEach(({ item, ext }) => extents.set(item.id, ext));

  current = { view, spec, unit, items: placed, extents, width, height };
  return view;
}

// ===== 命中測試 / 座標換算 =====
export function loadsimHitTest3D(px, py) {
  if (!current) return null;
  const ray = rayFromPixel(current.view, px, py);
  let best = null;
  current.items.forEach(item => {
    const ext = (current.extents && current.extents.get(item.id)) || loadsimExtents(item);
    const t = rayBox(ray, ext);
    if (t !== null && (best === null || t < best.t)) best = { itemId: item.id, t };
  });
  if (!best) return null;
  // 回傳實際命中點：拖曳時用「抓取點所在高度」當移動平面，
  // 貨物才會跟著游標 1:1 移動（用底面高度會因透視比例差而「拉一點點就噴很遠」）
  const point = add(ray.origin, mul(ray.dir, best.t));
  return { itemId: best.itemId, panel: '3d', point };
}

// 指標 → 水平面座標（planeY = 要投影到的高度）
export function loadsimPointer3D(px, py, planeY = 0) {
  if (!current) return null;
  const ray = rayFromPixel(current.view, px, py);
  if (Math.abs(ray.dir.y) < 1e-6) return null;
  const t = (planeY - ray.origin.y) / ray.dir.y;
  if (t <= 0) return null;
  const hit = add(ray.origin, mul(ray.dir, t));
  return { panel: '3d', x: hit.x, z: hit.z, y: planeY };
}

// 世界座標 → 畫布像素（供測試與 tooltip 定位使用）
export function loadsimProjectPoint3D(point) {
  if (!current) return null;
  return project(current.view, point);
}

export function loadsimGetView3D() {
  return current;
}

