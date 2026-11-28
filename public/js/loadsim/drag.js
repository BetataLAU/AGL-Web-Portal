// ===== 模擬裝板：拖曳互動（Pointer Events，滑鼠／觸控共用）=====
// 兩種拖曳：
//   1) 從「待裝貨物」清單拖進畫布 → spawn（放置）
//   2) 直接拖動畫布上的貨物 → move（改位置 / 改高度）
// 不合法（重疊、懸空、嚴格模式下超出輪廓）→ 放開時彈回並提示原因。
import {
  loadsimDimsOf, loadsimExtents, loadsimEvaluatePlacement, loadsimPlacementReason, loadsimSupportHeight,
  loadsimSupportMinRatio, loadsimSupportRatio, loadsimStageAt, loadsimClampToStage, loadsimClampToMoveArea,
  loadsimStageMaxExtent, LOADSIM_EPS
} from './geometry.js';
import {
  loadsimState, loadsimGetItem, loadsimPlaceItem, loadsimMoveItem, loadsimSelect,
  loadsimUnplaceItem, loadsimRotateItem, loadsimUndo, loadsimEmit, loadsimDeleteItem
} from './state.js';
import {
  loadsimPointerToWorld, loadsimHitTest, loadsimGetLayout, loadsimGetViewMode,
  loadsimGetCamera, loadsimOrbit, loadsimZoom
} from './render.js';

const SNAP_CM = 2.5;    // 吸附距離（cm）
const MARGIN_CM = 40;   // 可拖出板外的最大餘裕（cm）→ 讓「超出」看得見但不會飛走
const DRAG_THRESHOLD_PX = 3; // 位移門檻（px）：小於此值視為「點一下選取」，不移動貨物

let deps = {
  canvas: null,
  render: () => {},
  notify: () => {},
  getSpec: () => null,
  // 點一下（沒有拖動）畫布上的貨物 → 由 loadsim.js 載入 ① 表單修改
  onItemClick: () => {}
};
let session = null;
let hoverId = null;
let bound = false;

export function loadsimInitDrag(options) {
  deps = { ...deps, ...options };
  if (bound || !deps.canvas) return;

  const canvas = deps.canvas;
  canvas.addEventListener('pointerdown', handlePointerDown);
  canvas.addEventListener('pointermove', handlePointerMove);
  canvas.addEventListener('pointerup', handlePointerUp);
  canvas.addEventListener('pointercancel', handlePointerUp);
  canvas.addEventListener('pointerleave', handlePointerLeave);
  canvas.addEventListener('dblclick', handleDoubleClick);
  canvas.addEventListener('wheel', handleWheel, { passive: false });
  canvas.addEventListener('contextmenu', ev => ev.preventDefault());
  document.addEventListener('keydown', handleKeyDown);
  // 拖曳中若頁面捲動（2D 模式滾輪可捲動），畫布在視窗中的位置會變 → 重新量一次
  document.addEventListener('scroll', () => {
    if (session) session.rect = canvasRectOf();
  }, { capture: true, passive: true });
  bound = true;
}

export function loadsimGetPreview() {
  // 只有「拖曳貨物」的 session 才有預覽；轉視角（orbit）沒有 temp，
  // 若回傳空殼物件，3D 繪圖會讀 preview.item.id 而丟錯（整張畫布清空 → 貨物全消失）。
  if (!session || !session.temp) return null;
  return {
    item: session.temp,
    valid: session.valid,
    overflows: session.report ? session.report.overflows : [],
    onRing: !!(session.report && session.report.onRing),
    ringOverlap: session.report ? (session.report.ringOverlap || 0) : 0,
    reason: session.reason || ''
  };
}

export function loadsimGetHoverId() {
  return hoverId;
}

export function loadsimIsDragging() {
  return !!session;
}

// 目前的互動種類：'orbit'（轉視角）／'move'（搬貨物）／'spawn'（從清單拖進板內）／null
export function loadsimGetDragMode() {
  return session ? session.mode : null;
}

function cloneItem(item) {
  return { ...item, dims: { ...item.dims } };
}

// ===== 效能：拖曳期間暫停下方的背景動效 =====
// 全螢幕粒子畫布（O(n²) 連線）與游標拖尾（shadowBlur）會和主視圖搶幀預算，
// 拖曳時由 js/animations.js 的 fxBeginBusy() 暫停、放開後自動恢復。
function setFxBusy(on) {
  if (typeof window === 'undefined') return;
  try {
    if (on) {
      if (typeof window.fxBeginBusy === 'function') window.fxBeginBusy('loadsim');
    } else if (typeof window.fxEndBusy === 'function') {
      window.fxEndBusy('loadsim');
    }
  } catch (err) {
    /* 背景動效不存在時不影響拖曳 */
  }
}

// 效能：拖曳期間畫布位置固定，rect 量一次即可（避免每次 pointermove 強制 reflow）
function canvasRectOf() {
  const canvas = deps.canvas;
  return canvas ? canvas.getBoundingClientRect() : null;
}

function pointerPos(ev, rect) {
  const box = rect || canvasRectOf();
  if (!box) return null;
  return { x: ev.clientX - box.left, y: ev.clientY - box.top };
}

// 畫布互動時把焦點從輸入框移開：pointerdown 會 preventDefault（不讓畫布被拖曳選取），
// 瀏覽器因此不會自動 blur；使用者要修改輸入時會自己點輸入框，點畫布不應留游標在表單。
function blurActiveInput() {
  if (typeof document === 'undefined') return;
  const active = document.activeElement;
  if (!active) return;
  const tag = String(active.tagName || '').toUpperCase();
  if ((tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') &&
    typeof active.blur === 'function') {
    active.blur();
  }
}

// ===== 畫布內拖曳 =====
function handlePointerDown(ev) {
  blurActiveInput();
  const rect = canvasRectOf();
  const pos = pointerPos(ev, rect);
  if (!pos) return;
  const isRight = ev.pointerType === 'mouse' && ev.button === 2;
  if (ev.pointerType === 'mouse' && ev.button !== 0 && !isRight) return;

  // 3D：空白處 / 右鍵 → 旋轉視角
  const hit = isRight ? null : loadsimHitTest(pos.x, pos.y);
  if (!hit) {
    if (loadsimGetViewMode() === '3d') {
      session = { mode: 'orbit', lastX: ev.clientX, lastY: ev.clientY, pointerId: ev.pointerId, rect };
      setFxBusy(true);
      try { deps.canvas.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
      ev.preventDefault();
      return;
    }
    loadsimSelect(null);
    return;
  }

  const item = loadsimGetItem(hit.itemId);
  if (!item) return;
  const dims = loadsimDimsOf(item);

  // 移動平面 = 「抓取點的高度」：3D 用實際命中點（可能是側面或頂面），
  // 這樣貨物才會跟著游標 1:1 跑。若用底面高度，透視下比例會差好幾倍
  // → 症狀就是「只拉一點點，貨物卻噴很遠」。
  let planeY = item.y;
  if (hit.point && isFinite(hit.point.y)) {
    planeY = Math.min(Math.max(hit.point.y, item.y), item.y + dims.y);
  }

  session = {
    mode: 'move',
    itemId: item.id,
    temp: cloneItem(item),
    panel: hit.panel || null,
    planeY,
    rect,
    // 抓取偏移延後到「第一次真的移動」時才算：
    // 指針按下瞬間的視圖可能還在取景收合中，先算會用到舊視圖 → 位移比例錯掉。
    grab: null,
    startPx: pos.x,
    startPy: pos.y,
    moved: false,
    dims,
    valid: true,
    report: null,
    pointerId: ev.pointerId
  };
  setFxBusy(true);
  loadsimSelect(item.id);
  setCursor('grabbing');
  try { deps.canvas.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
  ev.preventDefault();
  deps.render();
}

function handleWheel(ev) {
  if (loadsimGetViewMode() !== '3d') return;
  ev.preventDefault();
  loadsimZoom(ev.deltaY > 0 ? 0.92 : 1.08);
  deps.render();
}

let lastCursor = '';
function setCursor(value) {
  if (!deps.canvas || lastCursor === value) return;
  lastCursor = value;
  deps.canvas.style.cursor = value;
}

// ===== 效能：pointermove 合併成「每幀最多處理一次」=====
// 高刷新率滑鼠／觸控板一次拖曳可產生 120～200 個 pointermove，
// 每個都做「吸附＋支撐高度＋合法性判定」純屬浪費（同一幀只會畫最後一個位置）。
let pendingMove = null;
let moveScheduled = false;

function queueMove(ev) {
  pendingMove = ev;
  if (moveScheduled) return;
  moveScheduled = true;
  requestAnimationFrame(() => {
    moveScheduled = false;
    const latest = pendingMove;
    pendingMove = null;
    if (latest) processMove(latest);
  });
}

// 放開前先套用最後一個位置，避免「放下後才跳到指標位置」
function flushMove() {
  if (!pendingMove) return;
  const latest = pendingMove;
  pendingMove = null;
  processMove(latest);
}

function processMove(ev) {
  if (!session) {
    const pos = pointerPos(ev, null);
    if (!pos) return;
    const hit = loadsimHitTest(pos.x, pos.y);
    const nextHover = hit ? hit.itemId : null;
    setCursor(nextHover ? 'grab' : (loadsimGetViewMode() === '3d' ? 'move' : 'default'));
    if (nextHover !== hoverId) {
      hoverId = nextHover;
      deps.render();
    }
    return;
  }

  if (session.mode === 'spawn') {
    processSpawnMove(ev);
    return;
  }

  if (session.mode === 'move') {
    // 拖曳中沿用開始時量到的畫布 rect（畫布不會移動）
    const pos = pointerPos(ev, session.rect);
    if (!pos) return;
    // 位移門檻：避免「點一下選取」時貨物被微量移動（也會白白寫入復原紀錄）
    if (!session.moved &&
      Math.hypot(pos.x - session.startPx, pos.y - session.startPy) < DRAG_THRESHOLD_PX) return;
    const world = loadsimPointerToWorld(pos.x, pos.y, session.planeY);
    // 指標在地平線外／板外（透視打不到平面）→ 維持原位，不要套用失控的座標
    if (!world) return;
    if (!session.grab) {
      // 第一次移動時才用「當前視圖」算抓取偏移，而且要用「按下時的像素」換算，
      // 不是用當前像素（用當前像素會讓貨物多跑一個偏移量 → 一點滑鼠就飛出去）。
      const origin = loadsimPointerToWorld(session.startPx, session.startPy, session.planeY) || world;
      session.grab = {
        x: session.temp.x - (origin.x === undefined ? session.temp.x : origin.x),
        y: session.temp.y - (origin.y === undefined ? session.temp.y : origin.y),
        z: session.temp.z - (origin.z === undefined ? session.temp.z : origin.z)
      };
    }
    session.moved = true;
    updateTempFromPointer(world);
    deps.render();
  }
}

function handlePointerMove(ev) {
  // 轉視角只改相機角度（成本極低），維持即時反應
  if (session && session.mode === 'orbit') {
    loadsimOrbit(ev.clientX - session.lastX, ev.clientY - session.lastY);
    session.lastX = ev.clientX;
    session.lastY = ev.clientY;
    deps.render();
    return;
  }
  queueMove(ev);
}

function handlePointerUp(ev) {
  if (session && session.mode === 'orbit') {
    session = null;
    setFxBusy(false);
    try { deps.canvas.releasePointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
    return;
  }
  if (!session || session.mode !== 'move') {
    if (hoverId) { hoverId = null; deps.render(); }
    return;
  }
  // 套用最後一次指標位置，避免「放下後才跳到指標位置」
  flushMove();
  const finished = session;
  session = null;
  setFxBusy(false);
  setCursor('default');
  try { deps.canvas.releasePointerCapture(ev.pointerId); } catch (e) { /* ignore */ }

  if (!finished.moved) {
    // 只是「點一下選取」：不要移動貨物、也不要寫入復原紀錄
    // 另外把這件貨的資料載入 ① 表單（方便直接修改／儲存）
    if (typeof deps.onItemClick === 'function') deps.onItemClick(finished.itemId);
    deps.render();
    return;
  }

  if (finished.valid) {
    loadsimMoveItem(finished.itemId, {
      x: finished.temp.x, y: finished.temp.y, z: finished.temp.z
    }, !!finished.temp.staged);
    if (finished.temp.staged) {
      deps.notify('已暫存到板外（不在板上、不計重量）');
    } else if (finished.report && finished.report.onRing) {
      deps.notify('已放下，但第一層壓在板底 ring track 上（紅色區域；嚴格模式會擋下）');
    }
  } else {
    deps.notify(finished.reason || '這裡放不進去，已彈回原位');
    loadsimEmit();
  }
  deps.render();
}

function handlePointerLeave() {
  if (!session && hoverId) {
    hoverId = null;
    deps.render();
  }
}

function handleDoubleClick(ev) {
  const pos = pointerPos(ev);
  if (!pos) return;
  const hit = loadsimHitTest(pos.x, pos.y);
  if (!hit) return;
  rotateItemSafely(hit.itemId);
}

// ===== 從清單拖進畫布（spawn）=====
export function loadsimStartSpawnDrag(itemId, event) {
  const item = loadsimGetItem(itemId);
  if (!item) return;
  session = {
    mode: 'spawn',
    itemId: item.id,
    temp: { ...cloneItem(item), placed: true, x: 0, y: 0, z: 0 },
    panel: null,
    grab: null,
    rect: canvasRectOf(),
    dims: loadsimDimsOf(item),
    valid: false,
    report: null,
    reason: '請拖到俯視圖或前視圖內',
    pointerId: event ? event.pointerId : null
  };
  setFxBusy(true);
  window.addEventListener('pointermove', handleSpawnMove);
  window.addEventListener('pointerup', handleSpawnUp);
  window.addEventListener('pointercancel', handleSpawnUp);
  deps.render();
}

function handleSpawnMove(ev) {
  if (!session || session.mode !== 'spawn') return;
  queueMove(ev);
}

function processSpawnMove(ev) {
  if (!session || session.mode !== 'spawn') return;
  const pos = pointerPos(ev, session.rect);
  if (!pos) return;
  const world = loadsimPointerToWorld(pos.x, pos.y, 0);
  if (!world) {
    session.valid = false;
    session.reason = '請把貨物拖到板子範圍內';
    deps.render();
    return;
  }
  const dims = session.dims;
  session.panel = world.panel;
  if (world.panel === 'top' || world.panel === '3d') {
    session.temp.x = (world.x === undefined ? session.temp.x : world.x) - dims.x / 2;
    session.temp.z = (world.z === undefined ? session.temp.z : world.z) - dims.z / 2;
    session.temp.y = 0;
  } else {
    session.temp.z = (world.z === undefined ? session.temp.z : world.z) - dims.z / 2;
    session.temp.y = Math.max(0, world.y === undefined ? 0 : world.y);
    session.temp.x = 0;
  }
  updateTempFromPointer(world);
  deps.render();
}

function handleSpawnUp() {
  window.removeEventListener('pointermove', handleSpawnMove);
  window.removeEventListener('pointerup', handleSpawnUp);
  window.removeEventListener('pointercancel', handleSpawnUp);
  flushMove();
  setFxBusy(false);
  if (!session || session.mode !== 'spawn') return;
  const finished = session;
  session = null;

  if (finished.valid) {
    loadsimPlaceItem(finished.itemId, {
      x: finished.temp.x, y: finished.temp.y, z: finished.temp.z
    }, !!finished.temp.staged);
    const onRing = !!(finished.report && finished.report.onRing) && !finished.temp.staged;
    deps.notify(finished.temp.staged
      ? `已暫存 ${finished.temp.name}（板外暫存區）`
      : (onRing
        ? `已放置 ${finished.temp.name}：第一層壓在板底 ring track 上（紅色區域；嚴格模式會擋下）`
        : `已放置 ${finished.temp.name}`), 'ok');
  } else {
    deps.notify(finished.reason || '放不進去：請拖到板面範圍內');
    loadsimEmit();
  }
  deps.render();
}

// ===== 位置更新（吸附 + 夾範圍 + 合法性）=====
function updateTempFromPointer(world) {
  const spec = deps.getSpec();
  if (!spec || !session) return;
  const item = session.temp;
  const dims = session.dims || loadsimDimsOf(item);
  // 暫存的貨物不在板上 → 不列入「其他貨物」的重疊／支撐判定
  const others = loadsimState.items.filter(other => other.placed && !other.staged && other.id !== item.id);
  const is3d = world.panel === '3d';

  if (session.mode === 'move') {
    // 抓取偏移 grab = 按下時的「貨物座標 - 該像素對應的世界座標」，
    // 套用時必須是「世界座標 + 偏移」（+ 不是 -）：
    //   item = world + (item0 - origin) = item0 + (world - origin) ← 位移量一致
    // 用減號會變成 item0 - (world - origin) 的鏡射，指標動一點貨物就噴很遠。
    if (world.panel === 'front') {
      // 2D 前視圖：垂直方向＝高度
      item.y = Math.max(0, (world.y === undefined ? item.y : world.y) + session.grab.y);
      item.z = (world.z === undefined ? item.z : world.z) + session.grab.z;
    } else {
      // 俯視圖 / 3D：水平面移動
      item.x = (world.x === undefined ? item.x : world.x) + session.grab.x;
      item.z = (world.z === undefined ? item.z : world.z) + session.grab.z;
    }
  }

  // ===== 暫存區（① 板後方 / ② 板前方）：拖到板外的空地 → staged（不做輪廓／重疊／支撐判定）=====
  const stageMax = loadsimStageMaxExtent(spec, dims);
  item.staged = false;
  if (is3d || world.panel === 'top') {
    // 先放寬 X / Z 的夾制範圍才拖得到暫存區（板面 → 暫存區）
    loadsimClampToMoveArea(item, spec, MARGIN_CM, stageMax.x, stageMax.z);
    const stage = loadsimStageAt(loadsimExtents(item), spec);
    if (stage) {
      item.staged = true;
      loadsimClampToStage(item, stage);
      session.report = { ok: true, fits: true, overlaps: [], overflows: [], supported: true, overhangMax: 0 };
      session.valid = true;
      session.reason = '';
      return;
    }
  }

  const snap = buildSnapTargets(spec, others, dims);
  item.x = snapAxis(item.x, snap.x, SNAP_CM);
  item.z = snapAxis(item.z, snap.z, SNAP_CM);
  if (!is3d) item.y = snapAxis(item.y, snap.y, SNAP_CM);

  // 夾制範圍＝「板面 ∪ 輪廓 ±40cm」～「暫存區末端」
  // （外擴型板型的輪廓比板面大：貼地時以板面為準，但疊高後可以伸進外擴／OVERHANG 區 → 由輪廓判定負責）
  // 與方向鍵微調共用 loadsimClampToMoveArea()，兩者的可移動範圍才會一致（都能騎出板邊）
  loadsimClampToMoveArea(item, spec, MARGIN_CM, stageMax.x, stageMax.z);

  // 3D：自動疊在下方最高的支撐面（地板 = 0），拖到哪一疊就疊上去
  //      只會停在「支撐面積合格」的層（比例由畫面選項決定，預設 50%）
  //      ★ 例外：貨物本來就在高處、而且目前高度還有「部分接觸」時，維持高度不讓它掉到地面
  //        → 判定會回報「下方支撐面積只有 xx%（需 ≥ yy%）」，而不是掉下去壓到下方貨物、
  //          訊息變成「與其他貨物重疊」（第二層推不到 OVERHANG 又看不懂原因的主因）。
  if (is3d) {
    const ext = loadsimExtents(item);
    const maxY = Math.max(0, spec.heightCm - dims.y + MARGIN_CM);
    const qualified = loadsimSupportHeight(ext, others, loadsimSupportMinRatio(loadsimState));
    const keepY = item.y > LOADSIM_EPS
      ? loadsimSupportRatio({ ...ext, y0: item.y, y1: item.y + (ext.y1 - ext.y0) }, others)
      : 0;
    if (keepY > 0 && qualified <= 0) {
      item.y = clamp(item.y, 0, maxY);
    } else {
      item.y = clamp(qualified, 0, maxY);
    }
  }

  const report = loadsimEvaluatePlacement(item, spec, others, {
    allowOverhang: loadsimState.allowOverhang,
    requireSupport: loadsimState.requireSupport,
    supportMinPct: loadsimState.supportMinPct,
    supportAreaEnabled: loadsimState.supportAreaEnabled
  });
  session.report = report;
  session.valid = report.ok;
  session.reason = report.ok ? '' : loadsimPlacementReason(report, { allowOverhang: loadsimState.allowOverhang });
}


function buildSnapTargets(spec, others, dims) {
  // 吸附目標＝板面邊緣（貼地範圍）＋其他貨物邊緣
  const fX0 = spec.floorX0 === undefined ? 0 : spec.floorX0;
  const fX1 = spec.floorX1 === undefined ? spec.baseL : spec.floorX1;
  const fZ0 = spec.floorZ0 === undefined ? -spec.baseW / 2 : spec.floorZ0;
  const fZ1 = spec.floorZ1 === undefined ? spec.baseW / 2 : spec.floorZ1;
  const x = [fX0, fX1 - dims.x];
  const z = [fZ0, fZ1 - dims.z];
  const y = [0];
  others.forEach(other => {
    const d = loadsimDimsOf(other);
    x.push(other.x, other.x + d.x, other.x - dims.x, other.x + d.x - dims.x);
    z.push(other.z, other.z + d.z, other.z - dims.z, other.z + d.z - dims.z);
    y.push(other.y + d.y, other.y - dims.y);
  });
  return { x, y, z };
}

function snapAxis(value, targets, tolerance) {
  let best = value;
  let bestDist = tolerance + 1e-6;
  targets.forEach(target => {
    const dist = Math.abs(value - target);
    if (dist < bestDist) {
      bestDist = dist;
      best = target;
    }
  });
  return best;
}

function clamp(value, min, max) {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

// ===== 旋轉（已放置的貨物：轉完若重疊 → 還原）=====
export function rotateItemSafely(itemId) {
  const item = loadsimGetItem(itemId);
  if (!item) return;
  const spec = deps.getSpec();
  if (!spec) return;

  if (!item.placed) {
    loadsimRotateItem(itemId);
    return;
  }

  const candidate = { ...item, dims: { ...item.dims }, orient: (item.orient + 1) % 6 };
  const others = loadsimState.items.filter(other => other.placed && other.id !== item.id);
  const report = loadsimEvaluatePlacement(candidate, spec, others, {
    allowOverhang: loadsimState.allowOverhang,
    requireSupport: loadsimState.requireSupport,
    supportMinPct: loadsimState.supportMinPct,
    supportAreaEnabled: loadsimState.supportAreaEnabled
  });
  if (!report.ok) {
    deps.notify('這個方向放不下（會重疊或懸空），維持原方向');
    return;
  }
  loadsimRotateItem(itemId);
}

// ===== 鍵盤方向鍵：把「選取中」的貨物在板面上微調 1 個單位（cm / inch）=====
// 2D 剖面（俯視圖）：↑＝+X（往板後）、↓＝-X、←＝-Z（左）、→＝+Z（右）
// 3D：依目前相機的 yaw 把「螢幕往上／往右」投影到板面 → 轉過視角後，
//     ↑ 仍然是使用者看到的「螢幕往上」、→ 仍然是「螢幕往右」（不會變成板子的固定方向）。
const ARROW_MOVES = {
  ArrowUp: [1, 0],
  ArrowDown: [-1, 0],
  ArrowLeft: [0, -1],
  ArrowRight: [0, 1]
};

// 把 [螢幕上, 螢幕右] 換算成板面位移 [dx, dz]。
// 相機位置 = target + (cos(pitch)sin(yaw), sin(pitch), cos(pitch)cos(yaw))，
// 因此螢幕右方＝(cos yaw, 0, -sin yaw)、螢幕上方投影到板面＝(-sin yaw, 0, -cos yaw)。
function screenRelativeMove(move) {
  if (loadsimGetViewMode() !== '3d') return move;
  const camera = loadsimGetCamera();
  const yaw = ((camera && camera.yaw) || 0) * Math.PI / 180;
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  return [
    move[0] * -sin + move[1] * cos,
    move[0] * -cos + move[1] * -sin
  ];
}

function nudgeSelectedItem(move) {
  const id = loadsimState.selectedId;
  const item = id ? loadsimGetItem(id) : null;
  if (!item || !item.placed || item.staged) return false;
  const spec = deps.getSpec();
  if (!spec) return false;

  // 1 個顯示單位（cm 為 1cm，inch 為 1 inch = 2.54cm）
  const step = loadsimState.unit === 'in' ? 2.54 : 1;
  const direction = screenRelativeMove(move);
  const candidate = {
    ...item,
    dims: { ...item.dims },
    x: item.x + direction[0] * step,
    z: item.z + direction[1] * step
  };
  // 可移動範圍與滑鼠拖曳一致（板面 ±40cm）→ 方向鍵也可以把貨物騎出板邊／輪廓
  loadsimClampToMoveArea(candidate, spec);
  if (Math.abs(candidate.x - item.x) < 1e-9 && Math.abs(candidate.z - item.z) < 1e-9) {
    deps.notify('已經到可移動範圍的邊緣，往這個方向沒有空間');
    return true;
  }

  // 暫存的貨物不在板上 → 不列入重疊／支撐判定（與滑鼠拖曳相同）
  const others = loadsimState.items.filter(other =>
    other.placed && !other.staged && other.id !== item.id);
  const options = {
    allowOverhang: loadsimState.allowOverhang,
    requireSupport: loadsimState.requireSupport,
    supportMinPct: loadsimState.supportMinPct,
    supportAreaEnabled: loadsimState.supportAreaEnabled
  };

  // 先沿下方最高的合格支撐面落下（移出堆疊時會自然掉到較低的位置），
  // 再判斷合法性 → 才不會出現「移到新位置後才落到地面，結果和下方貨物重疊」。
  // 與滑鼠拖曳相同：原本就在高處且還有部分接觸時維持高度，讓訊息指出「支撐面積不足」。
  const minRatio = loadsimState.requireSupport ? loadsimSupportMinRatio(loadsimState) : 0;
  const candidateExt = loadsimExtents(candidate);
  const qualified = loadsimSupportHeight(candidateExt, others, minRatio);
  const keepY = candidate.y > LOADSIM_EPS
    ? loadsimSupportRatio({ ...candidateExt, y0: candidate.y, y1: candidate.y + (candidateExt.y1 - candidateExt.y0) }, others)
    : 0;
  candidate.y = (keepY > 0 && qualified <= 0) ? candidate.y : qualified;

  const report = loadsimEvaluatePlacement(candidate, spec, others, options);
  if (!report.ok) {
    deps.notify(loadsimPlacementReason(report, options) || '這個位置放不進去');
    return true;
  }

  loadsimMoveItem(item.id, { x: candidate.x, y: candidate.y, z: candidate.z }, false);
  if (report.onRing) {
    deps.notify('第一層壓在板底 ring track 上（紅色區域；嚴格模式會擋下）');
  }
  return true;
}

// ===== 鍵盤快捷鍵（僅在「模擬裝板系統」區塊啟用時生效）=====
function handleKeyDown(ev) {
  const section = document.getElementById('section-loadsim');
  if (!section || !section.classList.contains('active')) return;

  const tag = (ev.target && ev.target.tagName) || '';
  const inField = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';

  if ((ev.ctrlKey || ev.metaKey) && (ev.key === 'z' || ev.key === 'Z')) {
    if (inField) return;
    ev.preventDefault();
    if (!loadsimUndo()) deps.notify('沒有可復原的動作');
    return;
  }
  if (inField) return;

  // ↑↓←→：移動選取中的貨物（1cm / 1inch）
  const move = ARROW_MOVES[ev.key];
  if (move && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
    if (nudgeSelectedItem(move)) ev.preventDefault();
    return;
  }

  if (ev.key === 'Escape' && session) {
    ev.preventDefault();
    cancelSession();
    return;
  }
  if (ev.key === 'r' || ev.key === 'R') {
    const targetId = loadsimState.selectedId || hoverId;
    if (targetId) {
      ev.preventDefault();
      rotateItemSafely(targetId);
    }
    return;
  }
  if (ev.key === 'Delete' || ev.key === 'Backspace') {
    const targetId = loadsimState.selectedId;
    if (!targetId) return;
    const item = loadsimGetItem(targetId);
    if (!item) return;
    ev.preventDefault();
    if (item.placed) loadsimUnplaceItem(targetId);
    else loadsimDeleteItem(targetId);
  }
}

function cancelSession() {
  session = null;
  pendingMove = null;
  setFxBusy(false);
  window.removeEventListener('pointermove', handleSpawnMove);
  window.removeEventListener('pointerup', handleSpawnUp);
  window.removeEventListener('pointercancel', handleSpawnUp);
  deps.render();
}

