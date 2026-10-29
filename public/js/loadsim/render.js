// ===== 模擬裝板：Canvas 繪圖（俯視圖 ＋ 前視圖）=====
// 俯視圖：橫軸 = 板寬 Z（左 -W/2 → 右 +W/2）、縱軸 = 板長 X（下 0 → 上 L）
// 前視圖：橫軸 = 板寬 Z、縱軸 = 高度 Y（下 0 → 上 H）
// 兩張圖共用同一個比例尺，數值一致、可互相對照。
import {
  loadsimExtents, loadsimDimsOf, loadsimEvaluatePlacement, LOADSIM_EPS, loadsimStageRect,
  loadsimOverflowBoundary
} from './geometry.js';
import {
  loadsimFormatNumber, loadsimFormatAmount, loadsimFormatTick, loadsimTickStepCm, loadsimUnitLabel
} from './units.js';
import { loadsimThemeColors as themeColors, loadsimRgba as rgba } from './colors.js';
import * as view3d from './render3d.js';

let currentLayout = null;
const hatchCache = new WeakMap();

// ===== 視圖模式（3D 預設；2D 剖面可切換）=====
let viewMode = '3d';

export function loadsimSetViewMode(mode) {
  viewMode = mode === '2d' ? '2d' : '3d';
  view3d.loadsimResetFrameFit();
}

export function loadsimGetViewMode() {
  return viewMode;
}

function hatchPattern(ctx) {
  const cached = hatchCache.get(ctx);
  if (cached) return cached;
  const size = 9;
  const tile = document.createElement('canvas');
  tile.width = size;
  tile.height = size;
  const g = tile.getContext('2d');
  g.strokeStyle = 'rgba(220, 38, 38, 0.85)';
  g.lineWidth = 1.6;
  g.beginPath();
  g.moveTo(-size, size);
  g.lineTo(size, -size);
  g.moveTo(0, size * 2);
  g.lineTo(size * 2, 0);
  g.stroke();
  const pattern = ctx.createPattern(tile, 'repeat');
  hatchCache.set(ctx, pattern);
  return pattern;
}

// ===== 版面計算 =====
const PAD = 12;
const GAP = 14;

export function loadsimComputeLayout(width, height, spec) {
  const panelW = Math.max(140, (width - PAD * 2 - GAP) / 2);
  const panelH = Math.max(140, height - PAD * 2);
  const makePanel = (x, title) => ({
    x, y: PAD, w: panelW, h: panelH, title,
    padL: 46, padT: 30, padR: 16, padB: 30
  });
  const top = makePanel(PAD, '俯視圖（前後 × 左右）');
  const front = makePanel(PAD + panelW + GAP, '前視圖（高度 × Contour 輪廓）');

  const plotOf = panel => ({
    x: panel.x + panel.padL,
    y: panel.y + panel.padT,
    w: Math.max(24, panel.w - panel.padL - panel.padR),
    h: Math.max(24, panel.h - panel.padT - panel.padB)
  });
  const pTop = plotOf(top);
  const pFront = plotOf(front);

  // 俯視圖要含「暫存區」（板後方的空地），否則拖出板外時看不到落點
  const stage = loadsimStageRect(spec);
  const sceneL = Math.max(spec.baseL, stage.x1);

  const scaleTop = Math.min(pTop.w / spec.baseW, pTop.h / sceneL);
  const scaleFront = Math.min(pFront.w / spec.baseW, pFront.h / spec.heightCm);
  const scale = Math.max(0.03, Math.min(scaleTop, scaleFront));

  const centerRect = (plot, wCm, hCm) => ({
    x: plot.x + (plot.w - wCm * scale) / 2,
    y: plot.y + (plot.h - hCm * scale) / 2,
    w: wCm * scale,
    h: hCm * scale
  });

  top.plot = pTop;
  top.rect = centerRect(pTop, spec.baseW, sceneL);
  front.plot = pFront;
  front.rect = centerRect(pFront, spec.baseW, spec.heightCm);

  return { width, height, scale, top, front, sceneL, splitX: PAD + panelW + GAP / 2 };
}

// 公分 → 畫布像素（兩張視圖共用：u 軸為板寬 Z）
function zToPx(layout, panel, z) {
  return panel.rect.x + (z + layout.baseW / 2) * layout.scale;
}

function pxToZ(layout, panel, px) {
  return (px - panel.rect.x) / layout.scale - layout.baseW / 2;
}

// 俯視圖：X 由下往上
function xToPy(layout, panel, x) {
  return panel.rect.y + panel.rect.h - x * layout.scale;
}

function pyToX(layout, panel, py) {
  return (panel.rect.y + panel.rect.h - py) / layout.scale;
}

// 前視圖：Y 由下往上
function yToPy(layout, panel, y) {
  return panel.rect.y + panel.rect.h - y * layout.scale;
}

function pyToY(layout, panel, py) {
  return (panel.rect.y + panel.rect.h - py) / layout.scale;
}

// ===== 共用繪圖工具 =====
function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function drawPanelChrome(ctx, panel, colors) {
  ctx.save();
  roundRect(ctx, panel.x, panel.y, panel.w, panel.h, 14);
  ctx.fillStyle = rgba(colors.input, 0.6);
  ctx.fill();
  ctx.strokeStyle = colors.border;
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = colors.muted;
  ctx.font = '600 12px Inter, "Segoe UI", Arial, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(panel.title, panel.x + 12, panel.y + 16);
  ctx.restore();
}

function drawTag(ctx, px, py, text, colors, options = {}) {
  ctx.save();
  ctx.font = options.bold ? '700 11px Inter, "Segoe UI", Arial, sans-serif' : '600 11px Inter, "Segoe UI", Arial, sans-serif';
  const metrics = ctx.measureText(text);
  const padX = 5;
  const w = metrics.width + padX * 2;
  const h = 17;
  roundRect(ctx, px - w / 2, py - h / 2, w, h, 5);
  ctx.fillStyle = options.bg || 'rgba(220,38,38,0.92)';
  ctx.fill();
  ctx.fillStyle = options.color || '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, px, py + 0.5);
  ctx.restore();
}

// 刻度與網格
function drawAxes(ctx, layout, panel, options, colors) {
  const { unit, axis } = options;
  const stepCm = loadsimTickStepCm(unit, layout.scale);
  const rect = panel.rect;
  const baseW = layout.baseW;

  ctx.save();
  ctx.strokeStyle = rgba(colors.muted, 0.16);
  ctx.lineWidth = 1;
  ctx.font = '10px Inter, "Segoe UI", Arial, sans-serif';
  ctx.fillStyle = rgba(colors.muted, 0.95);

  // 橫軸（Z）
  const zStart = -baseW / 2;
  const zEnd = baseW / 2;
  const first = Math.ceil(zStart / stepCm) * stepCm;
  for (let z = first; z <= zEnd + 1e-6; z += stepCm) {
    const px = zToPx(layout, panel, z);
    ctx.beginPath();
    ctx.moveTo(px, rect.y);
    ctx.lineTo(px, rect.y + rect.h);
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(loadsimFormatTick(z, unit), px, rect.y + rect.h + 6);
  }

  // 縱軸（X 或 Y）
  const vEnd = axis === 'x' ? (layout.sceneL || layout.baseL) : layout.heightCm;
  const vFirst = Math.ceil(0 / stepCm) * stepCm;
  for (let v = vFirst; v <= vEnd + 1e-6; v += stepCm) {
    const py = axis === 'x' ? xToPy(layout, panel, v) : yToPy(layout, panel, v);
    ctx.beginPath();
    ctx.moveTo(rect.x, py);
    ctx.lineTo(rect.x + rect.w, py);
    ctx.stroke();
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(loadsimFormatTick(v, unit), rect.x - 6, py);
  }

  // 軸標題
  ctx.fillStyle = colors.muted;
  ctx.font = '600 10px Inter, "Segoe UI", Arial, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  ctx.fillText(`寬 Z（${loadsimUnitLabel(unit)}）`, rect.x, rect.y + rect.h + 24);

  ctx.save();
  ctx.translate(rect.x - 34, rect.y + 4);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  ctx.fillText(axis === 'x' ? `板長 X（${loadsimUnitLabel(unit)}）` : `高度 Y（${loadsimUnitLabel(unit)}）`, 0, 0);
  ctx.restore();
  ctx.restore();
}

// ===== 貨物繪製 =====
// 閃爍高亮（點下方貨物明細時用；phase 0→1）
function strokeHighlight(ctx, x, y, w, h, phase) {
  const t = Math.max(0, Math.min(1, phase === undefined ? 1 : phase));
  const pulse = 0.5 + 0.5 * Math.sin(t * Math.PI * 2 * 2);
  ctx.save();
  ctx.setLineDash([]);
  ctx.strokeStyle = `rgba(250, 204, 21, ${(0.2 + 0.55 * pulse).toFixed(3)})`;
  ctx.lineWidth = 2.4 + 1.4 * pulse;
  ctx.strokeRect(x - 2, y - 2, w + 4, h + 4);
  ctx.restore();
}

// 滑過貨物：四條邊都標長度（俯視圖＝寬 Z／長 X；前視圖＝寬 Z／高 Y）
// 標籤畫在框內側（2D 面板有 clip，畫在外側會被切掉）
function drawRectEdgeDims(ctx, px, py, w, h, horizontalText, verticalText, colors) {
  const options = { bg: 'rgba(15,23,42,0.82)', color: '#f8fafc' };
  const cx = px + w / 2;
  const cy = py + h / 2;
  if (w >= 46 && h >= 26) {
    drawTag(ctx, cx, py + 9, horizontalText, colors, options);
    drawTag(ctx, cx, py + h - 9, horizontalText, colors, options);
  }
  if (h >= 34 && w >= 64) {
    drawTag(ctx, px + 22, cy, verticalText, colors, options);
    drawTag(ctx, px + w - 22, cy, verticalText, colors, options);
  }
}

function drawItemTop(ctx, layout, panel, item, colors, state2) {
  const ext = loadsimExtents(item);
  const px = zToPx(layout, panel, ext.z0);
  const py = xToPy(layout, panel, ext.x1);
  const w = (ext.z1 - ext.z0) * layout.scale;
  const h = (ext.x1 - ext.x0) * layout.scale;
  ctx.save();
  roundRect(ctx, px, py, w, h, 3);
  ctx.fillStyle = state2.invalid ? 'rgba(220,38,38,0.18)' : rgba(item.color, 0.42);
  ctx.fill();
  // 暫存（不在板上）：虛線＋灰色框
  ctx.setLineDash(state2.staged ? [4, 3] : (state2.invalid ? [5, 4] : []));
  ctx.lineWidth = state2.selected ? 2.6 : (state2.hovered ? 2.0 : 1.3);
  ctx.strokeStyle = state2.staged ? 'rgba(100,116,139,0.9)' : (state2.invalid ? '#dc2626' : item.color);
  ctx.stroke();
  if (state2.highlight !== undefined) strokeHighlight(ctx, px, py, w, h, state2.highlight);

  if (w > 16 && h > 12) {
    ctx.setLineDash([]);
    ctx.fillStyle = colors.text;
    ctx.font = '600 10px Inter, "Segoe UI", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.globalAlpha = 0.85;
    ctx.fillText(String(item.id), px + w / 2, py + h / 2);
  }
  // 滑過貨物：四條邊都標上長度（水平＝寬 Z、垂直＝長 X）
  if (state2.hovered && state2.unit) {
    drawRectEdgeDims(ctx, px, py, w, h,
      loadsimFormatNumber(ext.z1 - ext.z0, state2.unit),
      loadsimFormatNumber(ext.x1 - ext.x0, state2.unit), colors);
  }
  ctx.restore();
}

function drawItemFront(ctx, layout, panel, item, colors, state2) {
  const ext = loadsimExtents(item);
  const px = zToPx(layout, panel, ext.z0);
  const py = yToPy(layout, panel, ext.y1);
  const w = (ext.z1 - ext.z0) * layout.scale;
  const h = (ext.y1 - ext.y0) * layout.scale;
  ctx.save();
  roundRect(ctx, px, py, w, h, 3);
  ctx.fillStyle = state2.invalid ? 'rgba(220,38,38,0.18)' : rgba(item.color, 0.38);
  ctx.fill();
  ctx.setLineDash(state2.staged ? [4, 3] : (state2.invalid ? [5, 4] : []));
  ctx.lineWidth = state2.selected ? 2.6 : (state2.hovered ? 2.0 : 1.3);
  ctx.strokeStyle = state2.staged ? 'rgba(100,116,139,0.9)' : (state2.invalid ? '#dc2626' : item.color);
  ctx.stroke();
  if (state2.highlight !== undefined) strokeHighlight(ctx, px, py, w, h, state2.highlight);

  if (w > 16 && h > 12) {
    ctx.setLineDash([]);
    ctx.fillStyle = colors.text;
    ctx.font = '600 10px Inter, "Segoe UI", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.globalAlpha = 0.85;
    ctx.fillText(String(item.id), px + w / 2, py + h / 2);
  }
  // 滑過貨物：四條邊都標上長度（水平＝寬 Z、垂直＝高 Y）
  if (state2.hovered && state2.unit) {
    drawRectEdgeDims(ctx, px, py, w, h,
      loadsimFormatNumber(ext.z1 - ext.z0, state2.unit),
      loadsimFormatNumber(ext.y1 - ext.y0, state2.unit), colors);
  }
  ctx.restore();
}

// 俯視圖：貨物越出板面（前後 / 左右）的紅色斜線區塊
// pulse：超出輪廓的閃爍係數（0.4～1，undefined = 不閃）
function drawTopOverflow(ctx, layout, panel, item, unit, colors, pulse) {
  const blink = pulse === undefined ? 1 : pulse;
  // 弱弱地閃爍：紅色斜線區塊不搶眼，但看得出來在呼吸（0.3～0.5）
  const fillAlpha = 0.14 + 0.36 * blink;
  const strokeAlpha = 0.3 + 0.4 * blink;
  const ext = loadsimExtents(item);
  const baseZ0 = -layout.baseW / 2;
  const baseZ1 = layout.baseW / 2;
  const left = zToPx(layout, panel, ext.z0);
  const right = zToPx(layout, panel, ext.z1);
  const topPy = xToPy(layout, panel, ext.x1);
  const bottomPy = xToPy(layout, panel, ext.x0);
  const baseLeft = zToPx(layout, panel, baseZ0);
  const baseRight = zToPx(layout, panel, baseZ1);
  const baseBottomPy = xToPy(layout, panel, 0);
  const baseTopPy = xToPy(layout, panel, layout.baseL);

  const strips = [];
  if (ext.x0 < -LOADSIM_EPS) {
    strips.push({
      x: left, y: baseBottomPy, w: right - left, h: bottomPy - baseBottomPy, amount: -ext.x0, label: '前端',
      edge: { x1: left, y1: baseBottomPy, x2: right, y2: baseBottomPy }
    });
  }
  if (ext.x1 > layout.baseL + LOADSIM_EPS) {
    strips.push({
      x: left, y: topPy, w: right - left, h: baseTopPy - topPy, amount: ext.x1 - layout.baseL, label: '後端',
      edge: { x1: left, y1: baseTopPy, x2: right, y2: baseTopPy }
    });
  }
  if (ext.z0 < baseZ0 - LOADSIM_EPS) {
    strips.push({
      x: left, y: topPy, w: baseLeft - left, h: bottomPy - topPy, amount: baseZ0 - ext.z0, label: '左側',
      edge: { x1: baseLeft, y1: topPy, x2: baseLeft, y2: bottomPy }
    });
  }
  if (ext.z1 > baseZ1 + LOADSIM_EPS) {
    strips.push({
      x: baseRight, y: topPy, w: right - baseRight, h: bottomPy - topPy, amount: ext.z1 - baseZ1, label: '右側',
      edge: { x1: baseRight, y1: topPy, x2: baseRight, y2: bottomPy }
    });
  }
  strips.forEach(strip => {
    if (strip.w <= 0.5 || strip.h <= 0.5) return;
    ctx.save();
    ctx.fillStyle = hatchPattern(ctx) || 'rgba(220,38,38,0.25)';
    ctx.globalAlpha = fillAlpha;
    ctx.fillRect(strip.x, strip.y, strip.w, strip.h);
    ctx.restore();
    ctx.save();
    ctx.globalAlpha = strokeAlpha;
    ctx.strokeStyle = 'rgba(220,38,38,0.9)';
    ctx.lineWidth = 1.2;
    ctx.strokeRect(strip.x, strip.y, strip.w, strip.h);
    ctx.restore();
    const tagX = strip.x + strip.w / 2;
    const tagY = strip.y + strip.h / 2;
    // 出界長度 → 用線連到「界的那一條邊」（板面邊線）
    if (strip.edge) {
      const midX = (strip.edge.x1 + strip.edge.x2) / 2;
      const midY = (strip.edge.y1 + strip.edge.y2) / 2;
      ctx.save();
      ctx.globalAlpha = Math.min(1, 0.5 + 0.5 * blink);
      ctx.strokeStyle = 'rgba(220,38,38,0.95)';
      ctx.lineWidth = 1.9;
      ctx.beginPath();
      ctx.moveTo(strip.edge.x1, strip.edge.y1);
      ctx.lineTo(strip.edge.x2, strip.edge.y2);
      ctx.stroke();
      ctx.globalAlpha = 0.85;
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(tagX, tagY);
      ctx.lineTo(midX, midY);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }
    drawTag(ctx, tagX, tagY,
      `+${loadsimFormatAmount(strip.amount, unit)} ${loadsimUnitLabel(unit)}`, colors);
  });
}

// 前視圖：貨物超出 Contour 剖面（含斜角）的紅色斜線區塊
function drawProfileOverflow(ctx, layout, panel, item, overflowEntries, unit, colors, pulse) {
  const blink = pulse === undefined ? 1 : pulse;
  const fillAlpha = 0.14 + 0.36 * blink;
  const ext = loadsimExtents(item);
  const px0 = zToPx(layout, panel, ext.z0);
  const px1 = zToPx(layout, panel, ext.z1);
  const py0 = yToPy(layout, panel, ext.y1);
  const py1 = yToPy(layout, panel, ext.y0);
  const report = overflowEntries || [];
  const BIG = (layout.baseW + layout.heightCm + layout.baseL) * 3;

  report.filter(entry => entry.plane && entry.plane.axis === 'z').forEach(entry => {
    const { nx, ny, c } = entry.plane;
    const onLineU = nx * c;
    const onLineV = ny * c;
    const ex = -ny;
    const ey = nx;
    const quad = [
      [onLineU + ex * BIG, onLineV + ey * BIG],
      [onLineU - ex * BIG, onLineV - ey * BIG],
      [onLineU - ex * BIG - nx * BIG * 2, onLineV - ey * BIG - ny * BIG * 2],
      [onLineU + ex * BIG - nx * BIG * 2, onLineV + ey * BIG - ny * BIG * 2]
    ];
    ctx.save();
    ctx.beginPath();
    ctx.rect(px0, py0, px1 - px0, py1 - py0);
    ctx.clip();
    ctx.beginPath();
    quad.forEach(([u, v], idx) => {
      const px = zToPx(layout, panel, u);
      const py = yToPy(layout, panel, v);
      if (idx === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.closePath();
    ctx.fillStyle = hatchPattern(ctx) || 'rgba(220,38,38,0.25)';
    ctx.globalAlpha = fillAlpha;
    ctx.fill();
    ctx.restore();

    // 標籤放在「超出最多」的那個角
    const corners = [
      [ext.z0, ext.y0], [ext.z1, ext.y0], [ext.z1, ext.y1], [ext.z0, ext.y1]
    ];
    let anchor = corners[0];
    let minDot = Infinity;
    corners.forEach(([u, v]) => {
      const dot = u * nx + v * ny;
      if (dot < minDot) { minDot = dot; anchor = [u, v]; }
    });
    const offU = anchor[0] - nx * Math.min(entry.amount, 40) * 0.5;
    const offV = anchor[1] - ny * Math.min(entry.amount, 40) * 0.5;
    const tagX = zToPx(layout, panel, offU);
    const tagY = yToPy(layout, panel, offV);
    // 出界長度 → 用線連到「界的那一條邊」（輪廓剖面的那一條邊）
    const seg = loadsimOverflowBoundary(ext, entry);
    if (seg) {
      const ax = zToPx(layout, panel, seg.a[0]);
      const ay = yToPy(layout, panel, seg.a[1]);
      const bx = zToPx(layout, panel, seg.b[0]);
      const by = yToPy(layout, panel, seg.b[1]);
      ctx.save();
      ctx.globalAlpha = Math.min(1, 0.5 + 0.5 * blink);
      ctx.strokeStyle = 'rgba(220,38,38,0.95)';
      ctx.lineWidth = 1.9;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
      ctx.globalAlpha = 0.85;
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(tagX, tagY);
      ctx.lineTo((ax + bx) / 2, (ay + by) / 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }
    drawTag(ctx, tagX, tagY,
      `+${loadsimFormatAmount(entry.amount, unit)} ${loadsimUnitLabel(unit)}`, colors);
  });
}

// ===== 2D 雙視圖：主繪圖入口 =====
// options: { ctx, width, height, spec, unit, items, preview, hoverId, selectedId, allowOverhang, requireSupport }
function loadsimDraw2D(options) {
  const { ctx, width, height, spec, unit, items } = options;
  const preview = options.preview || null;
  const colors = themeColors();
  const layout = loadsimComputeLayout(width, height, spec);
  layout.baseW = spec.baseW;
  layout.baseL = spec.baseL;
  layout.heightCm = spec.heightCm;

  // 每件貨物的合法性報告（重疊 / 超出輪廓）：暫存的貨物不在板上 → 跳過
  const placed = (items || []).filter(item => item.placed);
  const onBoard = placed.filter(item => !item.staged);
  const reports = new Map();
  placed.forEach(item => {
    if (item.staged) {
      reports.set(item.id, { ok: true, fits: true, overlaps: [], overflows: [], supported: true, overhangMax: 0 });
      return;
    }
    const others = onBoard.filter(other => other.id !== item.id);
    reports.set(item.id, loadsimEvaluatePlacement(item, spec, others, {
      allowOverhang: options.allowOverhang,
      requireSupport: options.requireSupport,
      supportMinPct: options.supportMinPct,
      supportAreaEnabled: options.supportAreaEnabled
    }));
  });
  const highlightOf = id => (id === options.highlightId
    ? (options.highlightPhase === undefined ? 1 : options.highlightPhase)
    : undefined);
  // 超出輪廓的閃爍係數（0.4～1；undefined = 不閃）
  const overflowBlink = options.overflowPhase === undefined
    ? undefined
    : 0.4 + 0.6 * (0.5 + 0.5 * Math.sin((((options.overflowPhase % 1) + 1) % 1) * Math.PI * 2));

  ctx.clearRect(0, 0, width, height);
  drawPanelChrome(ctx, layout.top, colors);
  drawPanelChrome(ctx, layout.front, colors);

  // ===== 俯視圖 =====
  const top = layout.top;
  ctx.save();
  ctx.beginPath();
  ctx.rect(top.x, top.y, top.w, top.h);
  ctx.clip();

  // 板面（貼地）＝實線框；外擴型板型再加一圈虛線表示「輪廓上限」
  const floorL = spec.floorL === undefined ? spec.baseL : spec.floorL;
  const floorW = spec.floorW === undefined ? spec.baseW : spec.floorW;
  const floorX1 = spec.floorX1 === undefined ? spec.baseL : spec.floorX1;
  const floorZ0 = spec.floorZ0 === undefined ? -spec.baseW / 2 : spec.floorZ0;

  const fX = zToPx(layout, top, floorZ0);
  const fY = xToPy(layout, top, floorX1);
  const fW = floorW * layout.scale;
  const fH = floorL * layout.scale;
  ctx.fillStyle = rgba(colors.primary, 0.06);
  ctx.fillRect(fX, fY, fW, fH);
  ctx.setLineDash([]);
  ctx.strokeStyle = rgba(colors.primary, 0.65);
  ctx.lineWidth = 1.6;
  ctx.strokeRect(fX, fY, fW, fH);

  if (spec.flared) {
    // 輪廓上限（例如 H3-00：板面 125"，輪廓 161"）
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = rgba(colors.primary, 0.38);
    ctx.lineWidth = 1.2;
    ctx.strokeRect(
      zToPx(layout, top, -spec.baseW / 2),
      xToPy(layout, top, spec.baseL),
      spec.baseW * layout.scale,
      spec.baseL * layout.scale
    );
    ctx.setLineDash([]);
  }

  // 暫存區（板後方空地）：拖出輪廓的貨物可以暫放在這裡
  const stage = loadsimStageRect(spec);
  const stageX = zToPx(layout, top, stage.z0);
  const stageY = xToPy(layout, top, stage.x1);
  const stageW = (stage.z1 - stage.z0) * layout.scale;
  const stageH = (stage.x1 - stage.x0) * layout.scale;
  ctx.save();
  ctx.fillStyle = rgba(colors.muted, 0.05);
  ctx.fillRect(stageX, stageY, stageW, stageH);
  ctx.setLineDash([6, 4]);
  ctx.strokeStyle = rgba(colors.muted, 0.55);
  ctx.lineWidth = 1.1;
  ctx.strokeRect(stageX, stageY, stageW, stageH);
  ctx.setLineDash([]);
  if (stageW > 46 && stageH > 14) {
    ctx.fillStyle = rgba(colors.muted, 0.8);
    ctx.font = '600 10px Inter, "Segoe UI", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('暫存區', stageX + stageW / 2, stageY + stageH / 2);
  }
  ctx.restore();

  drawAxes(ctx, layout, top, { unit, axis: 'x' }, colors);

  const hideId = preview ? preview.item.id : null;
  const topItems = placed
    .filter(item => item.id !== hideId)
    .sort((a, b) => (a.y - b.y) || (a.x - b.x));
  topItems.forEach(item => {
    const report = reports.get(item.id);
    drawItemTop(ctx, layout, top, item, colors, {
      selected: item.id === options.selectedId,
      hovered: item.id === options.hoverId,
      // 超出輪廓（含外擴型板型「貼地以外的斜擴區」未疊高就伸出去）→ 紅框虛線
      invalid: !!report && !report.fits,
      staged: !!item.staged,
      highlight: highlightOf(item.id),
      unit
    });
    // 出界紅色斜線要畫在貨物之後，否則會被貨物填色蓋住（也看不到 +xx cm）
    drawTopOverflow(ctx, layout, top, item, unit, colors, overflowBlink);
  });
  if (preview) {
    drawItemTop(ctx, layout, top, preview.item, colors, {
      selected: false, hovered: false, invalid: !preview.valid, staged: !!preview.item.staged, unit
    });
    drawTopOverflow(ctx, layout, top, preview.item, unit, colors, overflowBlink);
  }
  ctx.restore();


  // ===== 前視圖 =====
  const front = layout.front;
  ctx.save();
  ctx.beginPath();
  ctx.rect(front.x, front.y, front.w, front.h);
  ctx.clip();

  // Contour 剖面
  ctx.beginPath();
  spec.profileZ.forEach(([u, v], idx) => {
    const px = zToPx(layout, front, u);
    const py = yToPy(layout, front, v);
    if (idx === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.closePath();
  ctx.fillStyle = rgba(colors.primary, 0.08);
  ctx.fill();
  ctx.strokeStyle = rgba(colors.primary, 0.65);
  ctx.lineWidth = 1.6;
  ctx.stroke();

  // 地面線
  ctx.beginPath();
  ctx.moveTo(zToPx(layout, front, -spec.baseW / 2 - 10), yToPy(layout, front, 0));
  ctx.lineTo(zToPx(layout, front, spec.baseW / 2 + 10), yToPy(layout, front, 0));
  ctx.strokeStyle = rgba(colors.muted, 0.6);
  ctx.lineWidth = 1.4;
  ctx.stroke();

  drawAxes(ctx, layout, front, { unit, axis: 'y' }, colors);

  const frontItems = placed
    .filter(item => item.id !== hideId)
    .sort((a, b) => (b.x - a.x) || (a.y - b.y));
  frontItems.forEach(item => {
    const report = reports.get(item.id);
    drawItemFront(ctx, layout, front, item, colors, {
      selected: item.id === options.selectedId,
      hovered: item.id === options.hoverId,
      invalid: false,
      staged: !!item.staged,
      highlight: highlightOf(item.id),
      unit
    });
    // 出界剖面（含收角斜邊）也要畫在貨物之後，才看得到紅色區塊與超出量
    drawProfileOverflow(ctx, layout, front, item, report ? report.overflows : [], unit, colors, overflowBlink);
  });
  if (preview) {
    drawItemFront(ctx, layout, front, preview.item, colors, {
      selected: false, hovered: false, invalid: !preview.valid, staged: !!preview.item.staged, unit
    });
    drawProfileOverflow(ctx, layout, front, preview.item, preview.overflows || [], unit, colors, overflowBlink);
  }
  ctx.restore();

  // 記錄本次繪圖結果（供 hover / 拖曳命中測試使用）
  currentLayout = {
    layout,
    spec,
    unit,
    items: placed,
    selectedId: options.selectedId,
    width,
    height
  };

  return layout;
}

// ===== 2D：命中測試 / 座標換算 =====
function loadsimGetLayout2D() {
  return currentLayout;
}

function loadsimPanelAt2D(px, py) {
  if (!currentLayout) return null;
  const { layout } = currentLayout;
  const inTop = px >= layout.top.x && px <= layout.top.x + layout.top.w &&
    py >= layout.top.y && py <= layout.top.y + layout.top.h;
  if (inTop) return 'top';
  const inFront = px >= layout.front.x && px <= layout.front.x + layout.front.w &&
    py >= layout.front.y && py <= layout.front.y + layout.front.h;
  if (inFront) return 'front';
  return null;
}

// 指標 → 世界座標（cm）：top 回傳 {x, z}；front 回傳 {y, z}
function loadsimPointerToWorld2D(px, py) {
  const panelKey = loadsimPanelAt2D(px, py);
  if (!panelKey || !currentLayout) return null;
  const { layout } = currentLayout;
  const panel = layout[panelKey];
  const z = pxToZ(layout, panel, px);
  if (panelKey === 'top') {
    return { panel: 'top', x: pyToX(layout, panel, py), z };
  }
  return { panel: 'front', y: pyToY(layout, panel, py), z };
}

function loadsimHitTest2D(px, py) {
  if (!currentLayout) return null;
  const panelKey = loadsimPanelAt2D(px, py);
  if (!panelKey) return null;
  const { layout, items } = currentLayout;
  const panel = layout[panelKey];
  const z = pxToZ(layout, panel, px);

  if (panelKey === 'top') {
    const x = pyToX(layout, panel, py);
    const hits = items.filter(item => {
      const e = loadsimExtents(item);
      return x >= e.x0 && x <= e.x1 && z >= e.z0 && z <= e.z1;
    });
    if (!hits.length) return null;
    hits.sort((a, b) => b.y - a.y);
    return { itemId: hits[0].id, panel: 'top' };
  }

  const y = pyToY(layout, panel, py);
  const hits = items.filter(item => {
    const e = loadsimExtents(item);
    return y >= e.y0 && y <= e.y1 && z >= e.z0 && z <= e.z1;
  });
  if (!hits.length) return null;
  // 前視圖：X 越小越靠近觀察者（畫在最上層）
  hits.sort((a, b) => a.x - b.x);
  return { itemId: hits[0].id, panel: 'front' };
}


// ===== 對外統一介面（依 viewMode 分派 3D / 2D）=====
// 3D：loadsim/drag.js 只需處理 x / z（y 由「自動疊放」決定）
export function loadsimDraw(options) {
  return viewMode === '3d' ? view3d.loadsimDraw3D(options) : loadsimDraw2D(options);
}

export function loadsimHitTest(px, py) {
  return viewMode === '3d' ? view3d.loadsimHitTest3D(px, py) : loadsimHitTest2D(px, py);
}

// 3D：與水平面（高度 planeY）的交點；2D：俯視/前視面板座標
export function loadsimPointerToWorld(px, py, planeY) {
  return viewMode === '3d'
    ? view3d.loadsimPointer3D(px, py, planeY === undefined ? 0 : planeY)
    : loadsimPointerToWorld2D(px, py);
}

export function loadsimGetLayout() {
  return viewMode === '3d' ? view3d.loadsimGetView3D() : loadsimGetLayout2D();
}

export function loadsimOrbit(dxPx, dyPx) {
  view3d.loadsimOrbit3D(dxPx, dyPx);
}

export function loadsimZoom(factor) {
  view3d.loadsimZoom3D(factor);
}

export function loadsimResetView() {
  view3d.loadsimResetView3D();
}

// 世界座標 → 畫布像素（測試 / tooltip 用；2D 模式回傳 null）
export function loadsimProjectPoint(point) {
  return view3d.loadsimProjectPoint3D(point);
}

// 取景是否還在平滑收合中（呼叫端可據此再排一次 rAF）
export function loadsimIsFrameSettling() {
  return viewMode === '3d' ? view3d.loadsimFrameSettling() : false;
}

