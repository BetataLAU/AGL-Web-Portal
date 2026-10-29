// ===== 模擬裝板系統：前端整合測試（DOM stub）=====
// 以最小 DOM stub 實際載入 public/js/loadsim.js，驗證：
//   1. 區塊初始化、板型下拉、單位標籤
//   2. 新增貨物 → 待裝清單
//   3. 點一下 → 自動放置 → 摘要更新
//   4. cm / inch 切換
//   5. 超重提示、嚴格模式（超出輪廓不可放）
//   6. 畫布實際被繪製（Canvas 2D 呼叫紀錄）
// 用法：node scripts/test-loadsim-frontend.js
// 註：出現 MODULE_TYPELESS_PACKAGE_JSON 警告為正常現象（專案 package.json 不是 ESM）。
const path = require('path');
const { pathToFileURL } = require('url');

let passCount = 0;
let failCount = 0;

function check(name, ok, extra = '') {
  if (ok) passCount += 1; else failCount += 1;
  console.log(`${ok ? '✅' : '❌'} ${name}${extra ? ' ' + extra : ''}`);
}

// ===== DOM stub =====
const drawCalls = [];
// ctx 的屬性設定（fillStyle / globalAlpha…）：用來驗證「出界紅色區塊會隨 phase 改變透明度」
const ctxSets = [];
const globalListeners = new Map();
// document 上註冊的監聽器（keydown 快捷鍵等）：stub 的 document.addEventListener 要記錄下來
const documentListeners = new Map();

function makeCtx() {
  const target = {
    measureText: () => ({ width: 26 }),
    createPattern: () => ({ __pattern: true }),
    canvas: null
  };
  return new Proxy(target, {
    get(obj, prop) {
      if (prop in obj) return obj[prop];
      return (...args) => { drawCalls.push({ name: String(prop), args }); };
    },
    set(obj, prop, value) {
      obj[prop] = value;
      ctxSets.push({ prop: String(prop), value });
      return true;
    }
  });
}

class FakeEl {
  constructor(id, tagName = 'div') {
    this.id = id;
    this.tagName = tagName.toUpperCase();
    this.value = '';
    this.textContent = '';
    this.innerHTML = '';
    this.hidden = false;
    this.checked = false;
    this.disabled = false;
    this.style = {};
    this.dataset = {};
    this.offsetWidth = 0;
    this.offsetHeight = 0;
    this.listeners = new Map();
    this.children = [];
    this.classSet = new Set();
    this.classList = {
      add: cls => this.classSet.add(cls),
      remove: cls => this.classSet.delete(cls),
      toggle: (cls, force) => {
        const next = force === undefined ? !this.classSet.has(cls) : !!force;
        if (next) this.classSet.add(cls); else this.classSet.delete(cls);
        return next;
      },
      contains: cls => this.classSet.has(cls)
    };
    this.parentElement = null;
  }

  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }

  removeEventListener(type, fn) {
    const list = this.listeners.get(type) || [];
    this.listeners.set(type, list.filter(item => item !== fn));
  }

  fire(type, ev) {
    (this.listeners.get(type) || []).forEach(fn => fn(ev));
  }

  querySelector() { return null; }
  querySelectorAll() { return []; }
  appendChild(child) { this.children.push(child); return child; }
  setPointerCapture() {}
  releasePointerCapture() {}
  focus() {}
  closest() { return null; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 900, height: 600, right: 900, bottom: 600 }; }
  getContext() { return makeCtx(); }
}

const registry = new Map();
function getEl(id, tag = 'div') {
  if (!registry.has(id)) registry.set(id, new FakeEl(id, tag));
  return registry.get(id);
}

// 需要的元素（對應 public/index.html 的 #section-loadsim）
[
  'section-loadsim', 'loadsim-uld-select', 'loadsim-item-form', 'loadsim-len', 'loadsim-wid',
  'loadsim-hgt', 'loadsim-weight', 'loadsim-qty', 'loadsim-item-name', 'loadsim-btn-add',
  'loadsim-pending', 'loadsim-canvas', 'loadsim-tooltip', 'loadsim-toast', 'loadsim-summary',
  'loadsim-summary-top', 'loadsim-item-lines', 'loadsim-dim-rows', 'loadsim-item-mawb',
  'loadsim-btn-image', 'loadsim-btn-spec', 'loadsim-btn-clear', 'loadsim-strict-overhang',
  'loadsim-require-support', 'loadsim-support-min', 'loadsim-item-max', 'loadsim-btn-reset-view', 'loadsim-hint',
  'loadsim-support-area-enabled', 'loadsim-item-max-enabled', 'loadsim-btn-cancel-edit', 'loadsim-edit-hint'
].forEach(id => getEl(id));

getEl('loadsim-uld-select', 'select');
getEl('loadsim-canvas', 'canvas');

// 摘要拆成兩塊：上半段（件數／重量／警示，夾在畫布與明細列之間）＋底部（板型與單位註記）
function allSummaryHtml() {
  return `${getEl('loadsim-summary-top').innerHTML}${getEl('loadsim-summary').innerHTML}`;
}

const stage = new FakeEl('loadsim-stage');
getEl('loadsim-canvas').parentElement = stage;

const lenEl = getEl('loadsim-len');
const widEl = getEl('loadsim-wid');
const hgtEl = getEl('loadsim-hgt');
lenEl.value = '60';
widEl.value = '40';
hgtEl.value = '50';
getEl('loadsim-weight').value = '25';
getEl('loadsim-qty').value = '1';
getEl('loadsim-item-max').value = '1000';

// 單位按鈕 / 單位標籤
const btnCm = new FakeEl('unit-cm', 'button');
btnCm.dataset.unit = 'cm';
const btnIn = new FakeEl('unit-in', 'button');
btnIn.dataset.unit = 'in';
const labelA = new FakeEl('label-a', 'b');
const labelB = new FakeEl('label-b', 'b');

// 視圖切換按鈕
const btn3d = new FakeEl('view-3d', 'button');
btn3d.dataset.view = '3d';
const btn2d = new FakeEl('view-2d', 'button');
btn2d.dataset.view = '2d';

const root = getEl('section-loadsim');
root.querySelectorAll = selector => {
  if (selector === '.loadsim-unit-btn') return [btnCm, btnIn];
  if (selector === '[data-loadsim-unit]') return [labelA, labelB];
  if (selector === '.loadsim-view-btn') return [btn3d, btn2d];
  return [];
};

const storage = new Map();

globalThis.document = {
  documentElement: {
    getAttribute: () => null,
    style: { setProperty: () => {} }
  },
  getElementById: id => (registry.has(id) ? registry.get(id) : null),
  querySelectorAll: () => [],
  querySelector: () => null,
  createElement: tag => new FakeEl('created', tag),
  addEventListener: (type, fn) => {
    if (!documentListeners.has(type)) documentListeners.set(type, []);
    documentListeners.get(type).push(fn);
  },
  body: new FakeEl('body')
};

globalThis.window = globalThis;
globalThis.devicePixelRatio = 1;
globalThis.requestAnimationFrame = cb => { cb(); return 1; };
globalThis.localStorage = {
  getItem: key => (storage.has(key) ? storage.get(key) : null),
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: key => storage.delete(key)
};
globalThis.getComputedStyle = () => ({ getPropertyValue: () => '' });
globalThis.confirm = () => true;
globalThis.alert = () => {};
globalThis.addEventListener = (type, fn) => {
  if (!globalListeners.has(type)) globalListeners.set(type, []);
  globalListeners.get(type).push(fn);
};
globalThis.removeEventListener = (type, fn) => {
  const list = globalListeners.get(type) || [];
  globalListeners.set(type, list.filter(item => item !== fn));
};
globalThis.setTimeout = (fn) => { fn(); return 0; };
globalThis.clearTimeout = () => {};
globalThis.MutationObserver = undefined;
globalThis.ResizeObserver = undefined;

// ===== 測試主體 =====
function clickPendingCard(id) {
  const card = { dataset: { id: String(id) } };
  const target = { closest: sel => (sel === '[data-id]' ? card : null) };
  getEl('loadsim-pending').fire('pointerdown', {
    button: 0, pointerType: 'mouse', clientX: 10, clientY: 10, target,
    preventDefault() {}
  });
  (globalListeners.get('pointerup') || []).slice().forEach(fn => fn({}));
}

function clickPendingAction(id, action) {
  const card = { dataset: { id: String(id) } };
  const btn = {
    dataset: { action },
    closest: sel => (sel === 'button[data-action]' ? btn : (sel === '[data-id]' ? card : null))
  };
  getEl('loadsim-pending').fire('click', { target: btn });
}

function submitItemForm() {
  getEl('loadsim-item-form').fire('submit', { preventDefault() {} });
}

(async () => {
  console.log('===== 模擬裝板系統：前端整合測試 =====\n');

  const baseUrl = pathToFileURL(path.join(__dirname, '..', 'public', 'js')).href;
  await import(`${baseUrl}/loadsim.js`);

  const stateModule = await import(`${baseUrl}/loadsim/state.js`);
  const specModule = await import(`${baseUrl}/loadsim/uld-specs.js`);
  const renderModule = await import(`${baseUrl}/loadsim/render.js`);
  const geomModule = await import(`${baseUrl}/loadsim/geometry.js`);
  const state = stateModule.loadsimState;

  check('1.1 模組載入後提供 window.setupLoadsimSection', typeof globalThis.setupLoadsimSection === 'function');
  globalThis.setupLoadsimSection();

  const select = getEl('loadsim-uld-select');
  check('1.2 板型下拉已填入所有板型', (select.innerHTML.match(/<option/g) || []).length === specModule.LOADSIM_ULD_SPECS.length,
    `${(select.innerHTML.match(/<option/g) || []).length} / ${specModule.LOADSIM_ULD_SPECS.length}`);
  check('1.3 預設板型 = Q7-00', state.uldCode === 'Q7-00');
  check('1.4 單位標籤顯示 cm', labelA.textContent === 'cm' && labelB.textContent === 'cm');

  // 尺寸輸入框的 step / min 必須讓「整數值」合法，否則瀏覽器原生驗證會擋住表單送出
  const gridValid = field => {
    const value = Number(field.value);
    const min = Number(field.min);
    const step = Number(field.step);
    if (!isFinite(value) || !isFinite(min) || !isFinite(step)) return false;
    const steps = (value - min) / step;
    return Math.abs(steps - Math.round(steps)) < 1e-6;
  };
  check('1.4b 尺寸輸入框 step/min 允許整數值',
    lenEl.step === '1' && lenEl.min === '1' && gridValid(lenEl) && gridValid(widEl) && gridValid(hgtEl),
    `step=${lenEl.step} min=${lenEl.min} value=${lenEl.value}`);
  check('1.5 初始畫面已繪製（Canvas 有繪圖呼叫）', drawCalls.length > 0, `${drawCalls.length} 次`);
  check('1.6 初始待裝清單顯示空狀態', getEl('loadsim-pending').innerHTML.includes('沒有待裝貨物'));
  check('1.7 預設視圖為 3D', renderModule.loadsimGetViewMode() === '3d');
  check('1.8 3D 視角按鈕為 active', btn3d.classSet.has('active') && !btn2d.classSet.has('active'));

  // 後續拖曳測試固定在 2D 模式（座標可預期），最後一段再回 3D 驗證
  btn2d.fire('click', {});
  check('1.9 切換到 2D 剖面', renderModule.loadsimGetViewMode() === '2d' && btn2d.classSet.has('active'));

  // ===== 新增貨物 =====
  getEl('loadsim-qty').value = '2';
  submitItemForm();
  check('2.1 送出表單產生 2 件貨物', state.items.length === 2, `items=${state.items.length}`);
  check('2.2 新貨物為「待裝」', state.items.every(item => !item.placed));
  check('2.3 待裝清單顯示 2 張卡片', (getEl('loadsim-pending').innerHTML.match(/class="loadsim-item-card"/g) || []).length === 2);
  check('2.4 件數輸入框重置為 1', getEl('loadsim-qty').value === '1');

  // ===== 點一下 → 自動放置 =====
  const firstId = state.items[0].id;
  clickPendingCard(firstId);
  check('3.1 點擊卡片後自動放置', state.items[0].placed === true);
  check('3.2 已放置位置為合法座標', state.items[0].x >= 0 && state.items[0].y >= 0);
  const summaryHtml = allSummaryHtml();
  check('3.3 摘要顯示已裝 1 件', summaryHtml.includes('已裝 <strong>1</strong>'));
  check('3.4 摘要顯示待裝 1 件', summaryHtml.includes('待裝 <strong>1</strong>'));
  check('3.5 摘要顯示重量（25 kg）', summaryHtml.includes('25.0 kg'));

  // ===== 旋轉（待裝貨物）=====
  const pendingId = state.items[1].id;
  clickPendingAction(pendingId, 'rotate');
  check('4.1 旋轉後方向 +1', state.items[1].orient === 1, `orient=${state.items[1].orient}`);
  check('4.2 旋轉後清單尺寸跟著變（長×寬×高＝40×60×50）', getEl('loadsim-pending').innerHTML.includes('40×60×50'));

  // ===== 單位切換 =====
  btnIn.fire('click', {});
  check('5.1 切到 inch 後標籤更新', labelA.textContent === 'in');
  check('5.2 輸入框數值換算（60cm → 23.6in）', Math.abs(parseFloat(lenEl.value) - 23.6) < 0.01, `value=${lenEl.value}`);
  check('5.2b 切到 inch 後 step/min 同步且值仍在格線上',
    lenEl.step === '0.1' && lenEl.min === '0.1' && gridValid(lenEl), `step=${lenEl.step} min=${lenEl.min}`);
  check('5.3 摘要註明目前單位', getEl('loadsim-summary').innerHTML.includes('長度單位：in'));
  btnCm.fire('click', {});
  check('5.4 切回 cm', labelA.textContent === 'cm' && Math.abs(parseFloat(lenEl.value) - 60) < 0.01);

  // ===== 拖曳（spawn → 放置；畫布內拖曳 → 移動）=====
  const dragModule = await import(`${baseUrl}/loadsim/drag.js`);
  getEl('loadsim-qty').value = '1';
  submitItemForm();
  const spawnId = state.items[state.items.length - 1].id;
  const beforeSpawnCount = state.items.filter(item => item.placed).length;

  dragModule.loadsimStartSpawnDrag(spawnId, { pointerId: 1 });
  (globalListeners.get('pointermove') || []).forEach(fn => fn({ clientX: 100, clientY: 200 }));
  (globalListeners.get('pointerup') || []).forEach(fn => fn({}));
  const spawned = state.items.find(item => item.id === spawnId);
  check('6.1 從清單拖進畫布 → 放置成功', !!spawned && spawned.placed === true);
  check('6.2 放置件數 +1', state.items.filter(item => item.placed).length === beforeSpawnCount + 1);
  check('6.3 新放置貨物貼地（y=0）', !!spawned && Math.abs(spawned.y) < 0.01, spawned ? `y=${spawned.y}` : '');

  const beforeMove = { x: spawned.x, z: spawned.z };
  getEl('loadsim-canvas').fire('pointerdown', {
    button: 0, pointerType: 'mouse', clientX: 100, clientY: 200, pointerId: 2, preventDefault() {}
  });
  getEl('loadsim-canvas').fire('pointermove', { clientX: 160, clientY: 200, pointerId: 2 });
  getEl('loadsim-canvas').fire('pointerup', { pointerId: 2 });
  const moved = state.items.find(item => item.id === spawnId);
  check('6.4 在俯視圖拖曳 → 左右位置改變（Z）', !!moved && Math.abs(moved.z - beforeMove.z) > 10,
    moved ? `z ${beforeMove.z.toFixed(1)} → ${moved.z.toFixed(1)}` : '');
  check('6.5 拖曳後高度不變（俯視圖不改 Y）', !!moved && Math.abs(moved.y) < 0.01);

  // ===== 超重提示 =====
  getEl('loadsim-weight').value = '7000';
  getEl('loadsim-qty').value = '1';
  submitItemForm();
  const heavyItem = state.items[state.items.length - 1];
  clickPendingCard(heavyItem.id);
  const overHtml = allSummaryHtml();
  check('7.1 超重時顯示紅色警示', overHtml.includes('超出板型最大總重'), overHtml.includes('loadsim-banner over') ? '(over)' : '');
  check('7.2 超重時重量 chip 標記為 over', overHtml.includes('loadsim-chip-weight over'));

  // ===== 嚴格模式 =====
  const strict = getEl('loadsim-strict-overhang');
  strict.checked = true;
  strict.fire('change', {});
  check('8.1 勾選嚴格模式 → 不允許超出輪廓', state.allowOverhang === false);
  strict.checked = false;
  strict.fire('change', {});
  check('8.2 取消嚴格模式 → 允許超出（會標紅）', state.allowOverhang === true);

  // ===== 板型切換 =====
  select.value = 'Q7-04';
  select.fire('change', {});
  check('9.1 切換板型成功', state.uldCode === 'Q7-04');
  check('9.2 切換板型後重新繪製', drawCalls.length > 0);

  // ===== 狀態暫存 =====
  const saved = storage.get('loadsim-state-v1');
  check('10.1 狀態已寫入 localStorage', !!saved);
  let parsedSaved = null;
  try { parsedSaved = JSON.parse(saved); } catch (e) { parsedSaved = null; }
  check('10.2 暫存內容含貨物清單', !!parsedSaved && Array.isArray(parsedSaved.items) && parsedSaved.items.length === state.items.length,
    parsedSaved ? `items=${parsedSaved.items.length}` : '');
  check('10.3 暫存內容含板型與單位', !!parsedSaved && parsedSaved.uldCode === 'Q7-04' && parsedSaved.unit === 'cm');

  // ===== 11. 3D 視圖（投影 / 命中 / 視角 / 縮放 / 重設）=====
  btn3d.fire('click', {});
  check('11.1 切回 3D 視圖', renderModule.loadsimGetViewMode() === '3d' && btn3d.classSet.has('active'));

  const itemCenter = item => {
    const e = geomModule.loadsimExtents(item);
    return { x: (e.x0 + e.x1) / 2, y: (e.y0 + e.y1) / 2, z: (e.z0 + e.z1) / 2 };
  };
  const spec3d = specModule.loadsimGetSpec(state.uldCode, state.specOverrides);
  const drawOptions = {
    ctx: getEl('loadsim-canvas').getContext('2d'),
    width: 900,
    height: 600,
    spec: spec3d,
    unit: 'cm',
    items: state.items,
    selectedId: null,
    hoverId: null,
    allowOverhang: state.allowOverhang,
    requireSupport: state.requireSupport
  };

  drawCalls.length = 0;
  renderModule.loadsimDraw(drawOptions);
  check('11.2 3D 繪圖有實際呼叫 Canvas', drawCalls.length > 0, `${drawCalls.length} 次`);

  const placedAll = state.items.filter(entry => entry.placed);
  const projections = placedAll
    .map(entry => ({ item: entry, p: renderModule.loadsimProjectPoint(itemCenter(entry)) }))
    .filter(entry => entry.p);
  check('11.3 貨物可投影到畫布座標', projections.length === placedAll.length,
    `${projections.length}/${placedAll.length}`);

  const nearest = projections.slice().sort((a, b) => a.p.depth - b.p.depth)[0];
  if (nearest) {
    const hit = renderModule.loadsimHitTest(nearest.p.x, nearest.p.y);
    check('11.4 3D 命中測試選中最靠近相機的貨物', !!hit && hit.itemId === nearest.item.id,
      hit ? `命中 #${hit.itemId} / 預期 #${nearest.item.id}` : '無命中');
  } else {
    check('11.4 3D 命中測試選中最靠近相機的貨物', false, '沒有可投影的貨物');
  }

  const beforeOrbit = nearest ? { ...nearest.p } : null;
  renderModule.loadsimOrbit(90, 0);
  renderModule.loadsimDraw(drawOptions);
  const afterOrbit = nearest ? renderModule.loadsimProjectPoint(itemCenter(nearest.item)) : null;
  check('11.5 轉視角後投影位置改變',
    !!beforeOrbit && !!afterOrbit && Math.abs(afterOrbit.x - beforeOrbit.x) > 1,
    beforeOrbit && afterOrbit ? `x ${beforeOrbit.x.toFixed(0)} → ${afterOrbit.x.toFixed(0)}` : '');

  const beforeZoom = afterOrbit ? { ...afterOrbit } : null;
  renderModule.loadsimZoom(1.4);
  renderModule.loadsimDraw(drawOptions);
  const afterZoom = nearest ? renderModule.loadsimProjectPoint(itemCenter(nearest.item)) : null;
  check('11.6 放大後投影位置改變',
    !!beforeZoom && !!afterZoom && Math.abs(afterZoom.x - beforeZoom.x) > 1);

  renderModule.loadsimResetView();
  renderModule.loadsimDraw(drawOptions);
  const afterReset = nearest ? renderModule.loadsimProjectPoint(itemCenter(nearest.item)) : null;
  check('11.7 重設視角回到預設投影',
    !!beforeOrbit && !!afterReset && Math.abs(afterReset.x - beforeOrbit.x) < 0.5,
    beforeOrbit && afterReset ? `x ${afterReset.x.toFixed(1)} vs ${beforeOrbit.x.toFixed(1)}` : '');

  // ===== 12. 3D 取景：各板型都應完整落在畫布內（避免「畫面空白」）=====
  ['Q7-00', 'Q7-04', 'Q3-00', 'A2-00'].forEach(code => {
    const spec = specModule.loadsimGetSpec(code, null);
    renderModule.loadsimDraw({ ...drawOptions, spec, items: [] });
    const corners = [];
    [0, spec.baseL].forEach(x => {
      [0, spec.heightCm].forEach(y => {
        [-spec.baseW / 2, spec.baseW / 2].forEach(z => corners.push({ x, y, z }));
      });
    });
    const projected = corners.map(point => renderModule.loadsimProjectPoint(point));
    const inside = projected.every(p => p && p.x >= 45 && p.x <= 855 && p.y >= 30 && p.y <= 570);
    const xs = projected.filter(Boolean).map(p => p.x);
    const spanX = xs.length ? Math.max(...xs) - Math.min(...xs) : 0;
    check(`11.8 ${code} 板型完整落在畫布內（留邊）且夠大`, inside && spanX > 200,
      `寬度 ${spanX.toFixed(0)}px`);
  });

  // ===== 13. 疊高 / 超出板邊的貨物也要留在畫面內（避免「貨物不見了」）=====
  const pmcSpec = specModule.loadsimGetSpec('Q7-00', null);
  const edgeItems = [
    { id: 901, name: 'A', dims: { l: 100, w: 100, h: 100 }, weight: 10, color: '#2563eb', orient: 0, placed: true, x: 0, y: 0, z: -50 },
    { id: 902, name: 'B', dims: { l: 100, w: 100, h: 100 }, weight: 10, color: '#16a34a', orient: 0, placed: true, x: 0, y: 100, z: -50 },
    { id: 903, name: 'C', dims: { l: 100, w: 100, h: 100 }, weight: 10, color: '#f59e0b', orient: 0, placed: true, x: 0, y: 200, z: -50 },
    { id: 904, name: 'D', dims: { l: 100, w: 100, h: 60 }, weight: 10, color: '#ef4444', orient: 0, placed: true, x: 300, y: 0, z: 160 }
  ];
  renderModule.loadsimDraw({ ...drawOptions, spec: pmcSpec, items: edgeItems });
  const edgeCorners = [];
  edgeItems.forEach(item => {
    const e = geomModule.loadsimExtents(item);
    [e.x0, e.x1].forEach(x => {
      [e.y0, e.y1].forEach(y => {
        [e.z0, e.z1].forEach(z => edgeCorners.push({ x, y, z }));
      });
    });
  });
  const edgeProjected = edgeCorners.map(point => renderModule.loadsimProjectPoint(point));
  const edgeInside = edgeProjected.every(p => p && p.x >= 0 && p.x <= 900 && p.y >= 0 && p.y <= 600);
  check('11.9 疊高 3 層＋超出板邊的貨物仍全部在畫面內', edgeInside,
    edgeInside ? '' : '有貨物投影落在畫布外');

  // ===== 14. 轉視角：過程中不能因為 preview 而讓貨物全部消失 =====
  renderModule.loadsimResetView();
  renderModule.loadsimDraw({ ...drawOptions, spec: pmcSpec, items: edgeItems });
  let emptyPixel = null;
  for (let x = 20; x < 880 && !emptyPixel; x += 20) {
    for (let y = 40; y < 560 && !emptyPixel; y += 20) {
      if (!renderModule.loadsimHitTest(x, y)) emptyPixel = { x, y };
    }
  }
  check('14.1 找得到空白處（可轉視角）', !!emptyPixel);
  let orbitThrew = false;
  let orbitPreview = 'init';
  let orbitInside = false;
  if (emptyPixel) {
    getEl('loadsim-canvas').fire('pointerdown', {
      button: 0, pointerType: 'mouse', clientX: emptyPixel.x, clientY: emptyPixel.y,
      pointerId: 9, preventDefault() {}
    });
    orbitPreview = dragModule.loadsimGetPreview();
    check('14.2 轉視角 session 的 preview 為 null（不會讓 3D 繪圖丟錯）', orbitPreview === null,
      `mode=${dragModule.loadsimGetDragMode()}`);
    try {
      for (let step = 0; step < 6; step++) {
        getEl('loadsim-canvas').fire('pointermove', {
          clientX: emptyPixel.x + 25 * (step + 1), clientY: emptyPixel.y - 6 * step, pointerId: 9
        });
        renderModule.loadsimDraw({
          ...drawOptions, spec: pmcSpec, items: edgeItems,
          preview: dragModule.loadsimGetPreview(),
          lod: true, freezeFrame: true, snapFrame: true
        });
      }
    } catch (err) {
      orbitThrew = err;
    }
    const orbitPoints = edgeCorners.map(point => renderModule.loadsimProjectPoint(point));
    orbitInside = orbitPoints.every(p => p && p.x >= 0 && p.x <= 900 && p.y >= 0 && p.y <= 600);
    getEl('loadsim-canvas').fire('pointerup', { pointerId: 9 });
  }
  check('14.3 轉視角期間 3D 繪圖不丟錯', !orbitThrew, orbitThrew ? String(orbitThrew) : '');
  check('14.4 轉視角後貨物仍全部在畫布內', orbitInside);

  // 14.5 大幅轉視角掃描（俯視 80° ↔ 平視 8°、yaw 轉一圈以上）貨物都要留在畫布內
  let sweepInside = true;
  let sweepDetail = '';
  if (emptyPixel) {
    getEl('loadsim-canvas').fire('pointerdown', {
      button: 0, pointerType: 'mouse', clientX: emptyPixel.x, clientY: emptyPixel.y,
      pointerId: 12, preventDefault() {}
    });
    const sweep = [[160, -200], [160, 400], [0, -300], [160, 200], [160, 0], [160, 0], [160, 0], [160, 0], [-500, -200], [0, 300]];
    sweep.forEach(([dx, dy], idx) => {
      getEl('loadsim-canvas').fire('pointermove', {
        clientX: emptyPixel.x + dx, clientY: emptyPixel.y + dy, pointerId: 12
      });
      renderModule.loadsimDraw({
        ...drawOptions, spec: pmcSpec, items: edgeItems,
        preview: dragModule.loadsimGetPreview(),
        lod: true, freezeFrame: true, snapFrame: true
      });
      const points = edgeCorners.map(point => renderModule.loadsimProjectPoint(point));
      const ok = points.every(p => p && p.x >= 0 && p.x <= 900 && p.y >= 0 && p.y <= 600);
      if (!ok && sweepInside) {
        sweepInside = false;
        sweepDetail = `第 ${idx + 1} 步跑出畫布`;
      }
    });
    getEl('loadsim-canvas').fire('pointerup', { pointerId: 12 });
  }
  check('14.5 大幅轉視角（8°~80°、yaw 一圈以上）貨物仍在畫布內', sweepInside, sweepDetail);
  renderModule.loadsimResetView();
  renderModule.loadsimDraw({ ...drawOptions, spec: pmcSpec, items: edgeItems });

  // ===== 15. 3D 拖曳必須跟游標 1:1（不能「拉一點點就噴很遠」）=====
  // 只放一件貨物在板中央附近，避免吸附到其他貨物邊緣干擾量測
  const dragTarget = {
    id: 950, name: 'D', dims: { l: 100, w: 100, h: 100 }, weight: 10,
    color: '#2563eb', orient: 0, placed: true, x: 120, y: 0, z: -60
  };
  stateModule.loadsimState.items = [dragTarget];
  renderModule.loadsimDraw({ ...drawOptions, spec: pmcSpec, items: stateModule.loadsimState.items });
  const targetExt = geomModule.loadsimExtents(dragTarget);
  const targetCenter = renderModule.loadsimProjectPoint({
    x: (targetExt.x0 + targetExt.x1) / 2,
    y: (targetExt.y0 + targetExt.y1) / 2,
    z: (targetExt.z0 + targetExt.z1) / 2
  });
  renderModule.loadsimDraw({ ...drawOptions, spec: pmcSpec, items: stateModule.loadsimState.items });
  const grabHit = targetCenter ? renderModule.loadsimHitTest(targetCenter.x, targetCenter.y) : null;
  check('15.1 取得可拖曳的貨物命中點', !!grabHit && !!grabHit.point);
  if (grabHit && grabHit.point) {
    const planeY = grabHit.point.y;
    const px = 12;
    const origin = { ...stateModule.loadsimState.items.find(item => item.id === grabHit.itemId) };
    getEl('loadsim-canvas').fire('pointerdown', {
      button: 0, pointerType: 'mouse', clientX: targetCenter.x, clientY: targetCenter.y,
      pointerId: 10, preventDefault() {}
    });
    getEl('loadsim-canvas').fire('pointermove', {
      clientX: targetCenter.x + px, clientY: targetCenter.y, pointerId: 10
    });
    const draggedPreview = dragModule.loadsimGetPreview();
    const dragged = draggedPreview ? draggedPreview.item : null;
    const w0 = renderModule.loadsimPointerToWorld(targetCenter.x, targetCenter.y, planeY);
    const w1 = renderModule.loadsimPointerToWorld(targetCenter.x + px, targetCenter.y, planeY);
    const errX = dragged ? Math.abs((dragged.x - origin.x) - (w1.x - w0.x)) : 999;
    const errZ = dragged ? Math.abs((dragged.z - origin.z) - (w1.z - w0.z)) : 999;
    check(`15.2 指標 +${px}px → 貨物位移與同平面世界位移一致（誤差 < 1cm）`,
      !!dragged && errX < 1 && errZ < 1,
      dragged ? `Δ貨物 ${(dragged.x - origin.x).toFixed(1)}/${(dragged.z - origin.z).toFixed(1)}、Δ世界 ${(w1.x - w0.x).toFixed(1)}/${(w1.z - w0.z).toFixed(1)}` : '沒有預覽');
    const grabbedPoint = { x: w0.x + (dragged.x - origin.x), y: planeY, z: w0.z + (dragged.z - origin.z) };
    const grabbedPixel = dragged ? renderModule.loadsimProjectPoint(grabbedPoint) : null;
    check('15.3 抓取點在畫面上跟著游標（誤差 < 2px）',
      !!grabbedPixel && Math.abs(grabbedPixel.x - (targetCenter.x + px)) < 2 &&
      Math.abs(grabbedPixel.y - targetCenter.y) < 2,
      grabbedPixel ? `${grabbedPixel.x.toFixed(0)},${grabbedPixel.y.toFixed(0)} vs ${(targetCenter.x + px).toFixed(0)},${targetCenter.y.toFixed(0)}` : '');
    getEl('loadsim-canvas').fire('pointerup', { pointerId: 10 });
  }

  // ===== 16. 只點一下（沒有拖動）不可以移動貨物 =====
  const clickTarget = stateModule.loadsimState.items[0];
  renderModule.loadsimDraw({ ...drawOptions, spec: pmcSpec, items: stateModule.loadsimState.items });
  const clickExt = geomModule.loadsimExtents(clickTarget);
  const clickPos = renderModule.loadsimProjectPoint({
    x: (clickExt.x0 + clickExt.x1) / 2,
    y: (clickExt.y0 + clickExt.y1) / 2,
    z: (clickExt.z0 + clickExt.z1) / 2
  });
  if (clickPos) {
    getEl('loadsim-canvas').fire('pointerdown', {
      button: 0, pointerType: 'mouse', clientX: clickPos.x, clientY: clickPos.y,
      pointerId: 11, preventDefault() {}
    });
    getEl('loadsim-canvas').fire('pointermove', { clientX: clickPos.x + 1, clientY: clickPos.y + 1, pointerId: 11 });
    getEl('loadsim-canvas').fire('pointerup', { pointerId: 11 });
    const afterClick = stateModule.loadsimState.items.find(item => item.id === clickTarget.id);
    check('16.1 只點一下（位移 <3px）貨物位置不變',
      !!afterClick && Math.abs(afterClick.x - clickTarget.x) < 0.01 && Math.abs(afterClick.z - clickTarget.z) < 0.01,
      afterClick ? `x ${clickTarget.x}→${afterClick.x}、z ${clickTarget.z}→${afterClick.z}` : '');
  }

  // ===== 17. 外擴型板型（H3-00）：3D / 2D 都要畫得出來，板面 = 貼地 125" =====
  const h3Spec = specModule.loadsimGetSpec('H3-00', null);
  check('17.1 H3-00 輪廓 161"、板面 125"',
    Math.abs(h3Spec.baseL - 408.94) < 0.05 && Math.abs(h3Spec.floorL - 317.5) < 0.05,
    `輪廓 ${h3Spec.baseL.toFixed(1)}cm、板面 ${h3Spec.floorL.toFixed(1)}cm`);
  let flareThrew = null;
  try {
    renderModule.loadsimDraw({ ...drawOptions, spec: h3Spec, items: [] });
    renderModule.loadsimSetViewMode('2d');
    renderModule.loadsimDraw({ ...drawOptions, spec: h3Spec, items: [] });
  } catch (err) {
    flareThrew = err;
  }
  renderModule.loadsimSetViewMode('3d');
  renderModule.loadsimDraw({ ...drawOptions, spec: h3Spec, items: [] });
  check('17.2 外擴板型 3D / 2D 繪圖不丟錯', !flareThrew, flareThrew ? String(flareThrew) : '');
  // 貨物擺在板面最角落，3D 取景仍要完整入鏡
  const flareItem = {
    id: 960, name: 'E', dims: { l: 80, w: 80, h: 60 }, weight: 10,
    color: '#0ea5e9', orient: 0, placed: true, x: h3Spec.floorX0, y: 0, z: h3Spec.floorZ0
  };
  renderModule.loadsimDraw({ ...drawOptions, spec: h3Spec, items: [flareItem] });
  const fe = geomModule.loadsimExtents(flareItem);
  const flareCorners = [];
  [fe.x0, fe.x1].forEach(x => [fe.y0, fe.y1].forEach(y => [fe.z0, fe.z1].forEach(z => flareCorners.push({ x, y, z }))));
  const flareInside = flareCorners.map(p => renderModule.loadsimProjectPoint(p))
    .every(p => p && p.x >= 0 && p.x <= 900 && p.y >= 0 && p.y <= 600);
  check('17.3 板面角落的貨物在 3D 取景內', flareInside);

  // ===== 18. 畫布下方的「貨物明細列」：每件一行、點一下 → 高亮該件 =====
  const linesBox = getEl('loadsim-item-lines');
  stateModule.loadsimState.items = [{
    id: 970, name: 'LineTest', dims: { l: 50, w: 40, h: 30 }, weight: 12,
    color: '#2563eb', orient: 0, placed: false, staged: false, x: 0, y: 0, z: 0
  }];
  stateModule.loadsimState.selectedId = null;
  stateModule.loadsimEmit();
  check('18.1 明細列會列出每一件貨物（含狀態）',
    linesBox.innerHTML.includes('LineTest') && linesBox.innerHTML.includes('is-pending') &&
    linesBox.innerHTML.includes('待裝'));

  // 點未放置的貨物 → 提示（不會高亮畫布）
  linesBox.fire('click', { target: { closest: () => ({ dataset: { id: '970' } }) } });
  check('18.2 點「待裝」的明細列會提示尚未上板',
    String(getEl('loadsim-toast').textContent).includes('還沒放上板'));

  // 放到板上後再點 → 選取該貨物（畫布會依 highlightId 閃爍）
  stateModule.loadsimState.items[0].placed = true;
  stateModule.loadsimState.items[0].x = 100;
  stateModule.loadsimState.items[0].z = -40;
  stateModule.loadsimEmit();
  linesBox.fire('click', { target: { closest: () => ({ dataset: { id: '970' } }) } });
  check('18.3 點「板上」的明細列 → 選取該貨物', stateModule.loadsimState.selectedId === 970);
  renderModule.loadsimDraw({ ...drawOptions, spec: pmcSpec, items: stateModule.loadsimState.items, highlightId: 970, highlightPhase: 0.25 });
  check('18.4 帶 highlightId 的繪圖不丟錯（畫布上閃爍）', true);

  // ===== 19. 暫存區：拖出輪廓 → staged（不計重量、不算超出）=====
  const stageSpec = specModule.loadsimGetSpec('Q7-00', null);
  const stageRect = geomModule.loadsimStageRect(stageSpec);
  check('19.1 暫存區在板後方（x 從板長 + 30cm 起）',
    Math.abs(stageRect.x0 - (stageSpec.baseL + 30)) < 0.01 && stageRect.x1 > stageRect.x0);
  const stageItem = {
    id: 980, name: 'S', dims: { l: 60, w: 60, h: 60 }, weight: 30,
    color: '#8b5cf6', orient: 0, placed: true, staged: false, x: 120, y: 0, z: -40
  };
  stateModule.loadsimState.items = [stageItem];
  stateModule.loadsimState.selectedId = null;
  renderModule.loadsimResetView();
  renderModule.loadsimDraw({ ...drawOptions, spec: stageSpec, items: stateModule.loadsimState.items });
  const sExt = geomModule.loadsimExtents(stageItem);
  const sCenter = renderModule.loadsimProjectPoint({
    x: (sExt.x0 + sExt.x1) / 2, y: (sExt.y0 + sExt.y1) / 2, z: (sExt.z0 + sExt.z1) / 2
  });
  const sHit = sCenter ? renderModule.loadsimHitTest(sCenter.x, sCenter.y) : null;
  if (sHit && sHit.point) {
    const stageCenterPx = renderModule.loadsimProjectPoint({
      x: (stageRect.x0 + stageRect.x1) / 2, y: sHit.point.y, z: 0
    });
    getEl('loadsim-canvas').fire('pointerdown', {
      button: 0, pointerType: 'mouse', clientX: sCenter.x, clientY: sCenter.y,
      pointerId: 20, preventDefault() {}
    });
    getEl('loadsim-canvas').fire('pointermove', {
      clientX: stageCenterPx.x, clientY: stageCenterPx.y, pointerId: 20
    });
    const stagedPreview = dragModule.loadsimGetPreview();
    getEl('loadsim-canvas').fire('pointerup', { pointerId: 20 });
    const moved = stateModule.loadsimState.items[0];
    check('19.2 拖到暫存區 → staged 且位置落在暫存區內',
      moved.staged === true &&
      moved.x >= stageRect.x0 - 1 && moved.x <= stageRect.x1 &&
      moved.z >= stageRect.z0 - 1 && moved.z <= stageRect.z1,
      `x=${moved.x.toFixed(1)} z=${moved.z.toFixed(1)} staged=${moved.staged}`);
    check('19.3 暫存中的預覽判定為可放（不做輪廓／重疊檢查）',
      !!stagedPreview && stagedPreview.valid === true && stagedPreview.overflows.length === 0);
    check('19.4 摘要出現「暫存」且已裝件數不含暫存',
      String(allSummaryHtml()).includes('暫存'));
    renderModule.loadsimDraw({ ...drawOptions, spec: stageSpec, items: stateModule.loadsimState.items });
    check('19.5 暫存貨物畫在板外（3D 不丟錯）', true);
  } else {
    check('19.2 拖到暫存區 → staged', false, '取不到命中點');
  }

  // ===== 24. 「上貨需壓在下方貨物 ▢% 面積」選項 =====
  check('24.1 預設支撐面積門檻 = 50%', stateModule.loadsimState.supportMinPct === 50);
  const supportInput = getEl('loadsim-support-min');
  check('24.2 選項輸入框已同步現值', String(supportInput.value) === '50');
  supportInput.value = '30';
  supportInput.fire('change', {});
  check('24.3 調整成 30% 會寫回狀態並夾在 0–100',
    stateModule.loadsimState.supportMinPct === 30 &&
    String(supportInput.value) === '30');
  supportInput.value = '150';
  supportInput.fire('change', {});
  check('24.4 超過 100 會被夾成 100', stateModule.loadsimState.supportMinPct === 100);
  supportInput.value = '50';
  supportInput.fire('change', {});

  // ===== 25. 版面：摘要（件數／重量／警示）夾在畫布與貨物明細列之間 =====
  const fs = require('fs');
  const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const idxCanvas = indexHtml.indexOf('id="loadsim-canvas"');
  const idxSummaryTop = indexHtml.indexOf('id="loadsim-summary-top"');
  const idxItemLines = indexHtml.indexOf('id="loadsim-item-lines"');
  check('25.1 摘要列在 #loadsim-canvas 與 #loadsim-item-lines 之間',
    idxCanvas > -1 && idxSummaryTop > idxCanvas && idxItemLines > idxSummaryTop,
    `canvas=${idxCanvas} summaryTop=${idxSummaryTop} itemLines=${idxItemLines}`);
  const topHtmlNow = String(getEl('loadsim-summary-top').innerHTML);
  const noteHtmlNow = String(getEl('loadsim-summary').innerHTML);
  check('25.2 上半段放件數／重量 chip 與警示、底部只留板型與單位註記',
    topHtmlNow.includes('loadsim-summary-row') && !noteHtmlNow.includes('loadsim-summary-row') &&
    noteHtmlNow.includes('板型：') && noteHtmlNow.includes('長度單位：'));

  // ===== 25.3 ① 新增貨物 表單為單列精簡式 =====
  check('25.3 ① 新增貨物 表單為單列精簡式（標籤與輸入框同行）',
    indexHtml.includes('class="loadsim-form-name"') &&
    indexHtml.includes('class="pill btn-primary loadsim-form-add"') &&
    !indexHtml.includes('loadsim-form-wide'));

  // ===== 26. 出界貨物：紅色區塊「弱弱地閃爍」＋標示出界多少 =====
  const overSpec = specModule.loadsimGetSpec('Q7-00', null);
  const overItem = {
    id: 990, name: 'OverflowTest', dims: { l: 60, w: 100, h: 50 }, weight: 25,
    color: '#0ea5e9', orient: 0, placed: true, staged: false,
    x: overSpec.baseL - 28, y: 0, z: -50
  };
  stateModule.loadsimState.unit = 'cm';
  stateModule.loadsimState.allowOverhang = true;
  stateModule.loadsimState.uldCode = 'Q7-00';
  stateModule.loadsimState.items = [overItem];
  stateModule.loadsimState.selectedId = null;
  stateModule.loadsimEmit();

  const overBanner = String(getEl('loadsim-summary-top').innerHTML);
  check('26.1 摘要警示標出「哪一件、哪一側、出界多少」（#990 後端 +32 cm）',
    overBanner.includes('後端 +') && overBanner.includes('#990') && overBanner.includes('32'),
    (overBanner.match(/⚠[^<]*/) || [''])[0].slice(0, 60));

  const overLines = String(getEl('loadsim-item-lines').innerHTML);
  check('26.2 明細列新增「出界」欄並標出超出量',
    overLines.includes('出界') && overLines.includes('is-overflow') && overLines.includes('+32'));

  renderModule.loadsimSetViewMode('3d');
  const drawFrom3d = drawCalls.length;
  renderModule.loadsimDraw({ ...drawOptions, spec: overSpec, items: [overItem], overflowPhase: 0.25 });
  const calls3d = drawCalls.slice(drawFrom3d);
  const idLabel3d = calls3d.findIndex(c => c.name === 'fillText' && String(c.args[0]) === '990');
  const tag3d = calls3d.findIndex(c => c.name === 'fillText' && String(c.args[0]).startsWith('+'));
  check('26.3 3D 出界紅色區塊與 +xx 標籤畫在貨物本體之後（不會被貨物蓋住）',
    idLabel3d > -1 && tag3d > idLabel3d, `貨物編號@${idLabel3d} 出界標籤@${tag3d}`);

  const redFills = (from) => ctxSets.slice(from)
    .filter(item => item.prop === 'fillStyle' && String(item.value).startsWith('rgba(220,38,38'))
    .map(item => String(item.value));
  const setsA = ctxSets.length;
  renderModule.loadsimDraw({ ...drawOptions, spec: overSpec, items: [overItem], overflowPhase: 0.25 });
  const fillA = redFills(setsA);
  const setsB = ctxSets.length;
  renderModule.loadsimDraw({ ...drawOptions, spec: overSpec, items: [overItem], overflowPhase: 0.75 });
  const fillB = redFills(setsB);
  check('26.4 出界紅色區塊隨 phase 改變透明度（弱弱地閃爍）',
    fillA.length > 0 && fillB.length > 0 && fillA[0] !== fillB[0],
    `${fillA[0] || '無'} vs ${fillB[0] || '無'}`);

  renderModule.loadsimSetViewMode('2d');
  const drawFrom2d = drawCalls.length;
  renderModule.loadsimDraw({ ...drawOptions, spec: overSpec, items: [overItem], overflowPhase: 0.5 });
  const calls2d = drawCalls.slice(drawFrom2d);
  const idLabel2d = calls2d.findIndex(c => c.name === 'fillText' && String(c.args[0]) === '990');
  const tag2d = calls2d.findIndex(c => c.name === 'fillText' && String(c.args[0]).startsWith('+'));
  check('26.5 2D 剖面也把出界紅線與 +xx 標籤畫在貨物之後',
    idLabel2d > -1 && tag2d > idLabel2d, `貨物編號@${idLabel2d} 出界標籤@${tag2d}`);
  renderModule.loadsimSetViewMode('3d');

  // ===== 27. ① 多列尺寸＋MAWB／明細列群組＋排序／刪除＋重力＋方向鍵 =====
  // 27.1 表單有兩列尺寸 → 一次建立 2 件、共用同一個 MAWB
  const dimRowsEl = getEl('loadsim-dim-rows');
  const firstRowFields = {
    '.loadsim-dim-l': getEl('loadsim-len'),
    '.loadsim-dim-w': getEl('loadsim-wid'),
    '.loadsim-dim-h': getEl('loadsim-hgt'),
    '.loadsim-dim-kg': getEl('loadsim-weight'),
    '.loadsim-dim-qty': getEl('loadsim-qty')
  };
  const secondRowFields = {
    '.loadsim-dim-l': getEl('row2-len'),
    '.loadsim-dim-w': getEl('row2-wid'),
    '.loadsim-dim-h': getEl('row2-hgt'),
    '.loadsim-dim-kg': getEl('row2-kg'),
    '.loadsim-dim-qty': getEl('row2-qty')
  };
  firstRowFields['.loadsim-dim-l'].value = '60';
  firstRowFields['.loadsim-dim-w'].value = '40';
  firstRowFields['.loadsim-dim-h'].value = '50';
  firstRowFields['.loadsim-dim-kg'].value = '25';
  firstRowFields['.loadsim-dim-qty'].value = '1';
  secondRowFields['.loadsim-dim-l'].value = '80';
  secondRowFields['.loadsim-dim-w'].value = '50';
  secondRowFields['.loadsim-dim-h'].value = '60';
  secondRowFields['.loadsim-dim-kg'].value = '35';
  secondRowFields['.loadsim-dim-qty'].value = '1';
  dimRowsEl.querySelectorAll = selector => (selector === '.loadsim-dim-row'
    ? [
      { querySelector: sel => firstRowFields[sel] || null },
      { querySelector: sel => secondRowFields[sel] || null }
    ]
    : []);
  stateModule.loadsimState.unit = 'cm';
  stateModule.loadsimState.items = [];
  getEl('loadsim-item-mawb').value = '297-11112222';
  getEl('loadsim-item-name').value = 'Grouped';
  submitItemForm();
  const multiRows = stateModule.loadsimState.items.slice();
  check('27.1 兩列尺寸 → 建立 2 件且共用同一個 MAWB',
    multiRows.length === 2 &&
    multiRows.every(item => item.mawb === '297-11112222') &&
    multiRows.some(item => item.dims.l === 80 && item.dims.w === 50 && item.dims.h === 60),
    multiRows.map(item => `${item.id}:${item.dims.l}x${item.dims.w}x${item.dims.h}/${item.mawb}`).join(' '));
  dimRowsEl.querySelectorAll = () => [];

  // 27.2 明細列：同一個 MAWB 第一列是 parent（顯示 MAWB）、其餘 child（縮排 ↳）
  stateModule.loadsimState.items = [
    { id: 11, mawb: 'A1', name: 'P', dims: { l: 50, w: 50, h: 50 }, weight: 10, color: '#2563eb', orient: 0, placed: false, staged: false, x: 0, y: 0, z: 0 },
    { id: 12, mawb: 'A1', name: 'C1', dims: { l: 60, w: 50, h: 50 }, weight: 12, color: '#0ea5e9', orient: 0, placed: false, staged: false, x: 0, y: 0, z: 0 },
    { id: 13, mawb: 'A1', name: 'C2', dims: { l: 70, w: 50, h: 50 }, weight: 14, color: '#16a34a', orient: 0, placed: false, staged: false, x: 0, y: 0, z: 0 },
    { id: 14, mawb: '', name: 'Solo', dims: { l: 40, w: 40, h: 40 }, weight: 8, color: '#f59e0b', orient: 0, placed: false, staged: false, x: 0, y: 0, z: 0 }
  ];
  stateModule.loadsimState.selectedId = null;
  stateModule.loadsimEmit();
  const linesBox2 = getEl('loadsim-item-lines');
  const groupedHtml = String(linesBox2.innerHTML);
  check('27.2 MAWB 分組：第一列 parent、其餘 child（↳）且顯示 MAWB 欄',
    groupedHtml.includes('is-parent') &&
    (groupedHtml.match(/is-child/g) || []).length === 2 &&
    groupedHtml.includes('↳ C1') && groupedHtml.includes('↳ C2') &&
    groupedHtml.includes('data-mawb="A1"'));

  // 27.3 表頭排序：點「重量」小圖示 → 由輕到重，再點一次 → 由重到輕
  stateModule.loadsimState.items = [
    { id: 21, mawb: '', name: 'W10', dims: { l: 50, w: 50, h: 50 }, weight: 10, color: '#2563eb', orient: 0, placed: false, staged: false, x: 0, y: 0, z: 0 },
    { id: 22, mawb: '', name: 'W30', dims: { l: 50, w: 50, h: 50 }, weight: 30, color: '#0ea5e9', orient: 0, placed: false, staged: false, x: 0, y: 0, z: 0 },
    { id: 23, mawb: '', name: 'W20', dims: { l: 50, w: 50, h: 50 }, weight: 20, color: '#16a34a', orient: 0, placed: false, staged: false, x: 0, y: 0, z: 0 }
  ];
  stateModule.loadsimEmit();
  const clickSort = key => linesBox2.fire('click', {
    target: { closest: sel => (sel === '[data-sort]' ? { dataset: { sort: key } } : null) }
  });
  clickSort('weight');
  const ascHtml = String(linesBox2.innerHTML);
  const orderAsc = [21, 22, 23].sort((a, b) =>
    ascHtml.indexOf(`data-id="${a}"`) - ascHtml.indexOf(`data-id="${b}"`));
  check('27.3 點表頭「重量」→ 由輕到重排序', orderAsc.join(',') === '21,23,22', orderAsc.join(','));
  clickSort('weight');
  const descHtml = String(linesBox2.innerHTML);
  const orderDesc = [21, 22, 23].sort((a, b) =>
    descHtml.indexOf(`data-id="${a}"`) - descHtml.indexOf(`data-id="${b}"`));
  check('27.3b 再點一次 → 由重到輕（並顯示 fa-sort-down）',
    orderDesc.join(',') === '22,23,21' && descHtml.includes('fa-sort-down'),
    orderDesc.join(','));

  // 27.4 刪除單筆尺寸 → 上方貨物「物理地」落下
  stateModule.loadsimState.items = [
    { id: 31, mawb: '', name: 'Base', dims: { l: 100, w: 100, h: 50 }, weight: 20, color: '#2563eb', orient: 0, placed: true, staged: false, x: 20, y: 0, z: -50 },
    { id: 32, mawb: '', name: 'Top', dims: { l: 100, w: 100, h: 50 }, weight: 20, color: '#0ea5e9', orient: 0, placed: true, staged: false, x: 20, y: 50, z: -50 }
  ];
  stateModule.loadsimEmit();
  const clickLineAction = (action, id, mawb = '') => {
    const row = { dataset: { id: String(id), mawb } };
    const button = { dataset: { action }, closest: sel => (sel === '[data-id]' ? row : null) };
    linesBox2.fire('click', {
      target: { closest: sel => (sel === '[data-sort]' ? null : (sel === 'button[data-action]' ? button : null)) }
    });
  };
  clickLineAction('delete-item', 31);
  const afterDelete = stateModule.loadsimState.items;
  check('27.4 刪除單筆尺寸後，上方貨物自動落下（y 50 → 0）',
    afterDelete.length === 1 && afterDelete[0].id === 32 && Math.abs(afterDelete[0].y) < 1e-6,
    `剩 ${afterDelete.length} 件 y=${afterDelete[0] ? afterDelete[0].y : 'n/a'}`);
  check('27.4b 刪除後提示「上方貨物已落下」', String(getEl('loadsim-toast').textContent).includes('落下'));

  // 27.5 刪除整個 MAWB → 該 MAWB 的所有尺寸一起消失
  stateModule.loadsimState.items = [
    { id: 41, mawb: 'B2', name: 'B2-1', dims: { l: 50, w: 50, h: 50 }, weight: 10, color: '#2563eb', orient: 0, placed: false, staged: false, x: 0, y: 0, z: 0 },
    { id: 42, mawb: 'B2', name: 'B2-2', dims: { l: 60, w: 50, h: 50 }, weight: 10, color: '#0ea5e9', orient: 0, placed: false, staged: false, x: 0, y: 0, z: 0 },
    { id: 43, mawb: 'C3', name: 'C3-1', dims: { l: 70, w: 50, h: 50 }, weight: 10, color: '#16a34a', orient: 0, placed: false, staged: false, x: 0, y: 0, z: 0 }
  ];
  stateModule.loadsimEmit();
  clickLineAction('delete-mawb', 41, 'B2');
  check('27.5 刪除 MAWB → 該 MAWB 的所有尺寸一起刪除（其他 MAWB 保留）',
    stateModule.loadsimState.items.length === 1 && stateModule.loadsimState.items[0].mawb === 'C3');

  // 27.6 settle 模組：往下掉、不會往上跳
  const settleModule = await import(`${baseUrl}/loadsim/settle.js`);
  const lowItem = { id: 51, dims: { l: 100, w: 100, h: 50 }, weight: 10, orient: 0, placed: true, staged: false, x: 0, y: 0, z: -50 };
  const highItem = { id: 52, dims: { l: 100, w: 100, h: 50 }, weight: 10, orient: 0, placed: true, staged: false, x: 0, y: 120, z: -50 };
  const fallY = settleModule.loadsimFallHeight(highItem, [lowItem, highItem], { requireSupport: true, supportMinPct: 50 });
  check('27.6 貨物往下掉到下方貨物頂面（120 → 50）', Math.abs(fallY - 50) < 1e-6, `y=${fallY}`);
  const asideItem = { ...highItem, id: 53, x: 260, z: 100 };
  const fallFloor = settleModule.loadsimFallHeight(asideItem, [lowItem, asideItem], { requireSupport: true, supportMinPct: 50 });
  check('27.6b 下方沒有貨物 → 掉到地面（0）', Math.abs(fallFloor) < 1e-6, `y=${fallFloor}`);

  // 27.7 方向鍵：選取中的貨物 1cm / 1inch 微調（俯視圖方向）
  stateModule.loadsimState.unit = 'cm';
  stateModule.loadsimState.items = [
    { id: 61, mawb: '', name: 'Nudge', dims: { l: 50, w: 50, h: 50 }, weight: 10, color: '#2563eb', orient: 0, placed: true, staged: false, x: 50, y: 0, z: -50 }
  ];
  stateModule.loadsimState.selectedId = 61;
  stateModule.loadsimEmit();
  root.classList.add('active');
  const keydown = ev => (documentListeners.get('keydown') || []).forEach(fn => fn(ev));
  keydown({ key: 'ArrowUp', target: { tagName: 'DIV' }, preventDefault() {} });
  const nudgedUp = stateModule.loadsimState.items[0];
  check('27.7 ↑＝往板後 +X 1cm', Math.abs(nudgedUp.x - 51) < 1e-6 && Math.abs(nudgedUp.z + 50) < 1e-6,
    `x=${nudgedUp.x} z=${nudgedUp.z}`);
  keydown({ key: 'ArrowRight', target: { tagName: 'DIV' }, preventDefault() {} });
  check('27.7b →＝往右 +Z 1cm', Math.abs(nudgedUp.z + 49) < 1e-6, `z=${nudgedUp.z}`);
  stateModule.loadsimState.unit = 'in';
  keydown({ key: 'ArrowUp', target: { tagName: 'DIV' }, preventDefault() {} });
  check('27.7c 單位切成 inch → 一次移動 1 inch（2.54cm）', Math.abs(nudgedUp.x - 53.54) < 1e-6, `x=${nudgedUp.x}`);
  stateModule.loadsimState.unit = 'cm';

  // 27.7d/27.7e 方向鍵的可移動範圍＝滑鼠拖曳（板面 ±40cm）→ 也騎得出板邊
  const nudgeSpec = specModule.loadsimGetSpec('Q7-00', null);
  stateModule.loadsimState.allowOverhang = true;
  stateModule.loadsimState.items = [
    { id: 63, mawb: '', name: 'Edge', dims: { l: 50, w: 50, h: 50 }, weight: 10, color: '#2563eb', orient: 0, placed: true, staged: false, x: 50, y: 0, z: nudgeSpec.floorZ1 - 50 }
  ];
  stateModule.loadsimState.selectedId = 63;
  stateModule.loadsimEmit();
  keydown({ key: 'ArrowRight', target: { tagName: 'DIV' }, preventDefault() {} });
  const edgeItem = stateModule.loadsimState.items[0];
  check('27.7d 貨物貼在板面右緣 → → 鍵仍可往右（騎出板邊 1cm，與滑鼠拖曳一致）',
    Math.abs(edgeItem.z - (nudgeSpec.floorZ1 - 49)) < 1e-6,
    `z=${edgeItem.z}（板面右緣 z=${nudgeSpec.floorZ1}）`);

  // 板面外 40cm 是方向鍵可移動範圍的上限
  stateModule.loadsimState.items[0].z = nudgeSpec.floorZ1 - 50 + 40;
  stateModule.loadsimEmit();
  keydown({ key: 'ArrowRight', target: { tagName: 'DIV' }, preventDefault() {} });
  check('27.7e 到可移動範圍邊緣（板面外 40cm）→ 不再往右並提示沒有空間',
    Math.abs(stateModule.loadsimState.items[0].z - (nudgeSpec.floorZ1 - 10)) < 1e-6 &&
    String(getEl('loadsim-toast').textContent).includes('可移動範圍'),
    `z=${stateModule.loadsimState.items[0].z} toast=${getEl('loadsim-toast').textContent}`);
  root.classList.remove('active');

  // ===== 28. ① 表單編輯／選項開關／排序圖示 =====
  const cssText = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'loadsim.css'), 'utf8');
  check('28.1 標題改為「① 新增/修改貨物」', indexHtml.includes('① 新增/修改貨物'));
  const strictIdx = indexHtml.indexOf('id="loadsim-strict-overhang"');
  const supportIdx = indexHtml.indexOf('id="loadsim-require-support"');
  check('28.1b 「不可懸空」排在「嚴格模式」的下一行（DOM 順序）', strictIdx > -1 && supportIdx > strictIdx);
  check('28.1c 「上貨需壓在下方貨物 %」「單件重量上限」都有 checkbox',
    indexHtml.includes('id="loadsim-support-area-enabled"') && indexHtml.includes('id="loadsim-item-max-enabled"'));
  check('28.1d 選項每個各佔一行（.loadsim-options flex-direction: column）',
    /\.loadsim-options\s*\{[^}]*flex-direction:\s*column/.test(cssText));
  check('28.1e 長／寬／高輸入框變窄（54px：3 位數放得下，比重量／件數 62px 窄）',
    /\.loadsim-form\s+\.loadsim-dim-l[\s\S]{0,160}?width:\s*54px/.test(cssText));
  check('28.1f 名稱／MAWB 標籤固定寬度 → 兩個輸入框左邊對齊',
    indexHtml.includes('<span class="loadsim-form-label">名稱</span>') &&
    indexHtml.includes('<span class="loadsim-form-label">MAWB</span>') &&
    /\.loadsim-form-label\s*\{[^}]*min-width:\s*3\.4em/.test(cssText));

  // 28.2 排序圖示換成 FontAwesome（fa-sort / fa-sort-up / fa-sort-down）
  const linesHtmlNow = String(getEl('loadsim-item-lines').innerHTML);
  check('28.2 排序圖示改用 FontAwesome（fa-sort／fa-sort-down）',
    linesHtmlNow.includes('fa-solid fa-sort loadsim-sort-icon') &&
    linesHtmlNow.includes('fa-solid fa-sort-down loadsim-sort-icon'));

  // 28.3 支撐面積 checkbox：取消勾選＝有接觸即可（但仍不可懸空）
  const supportSpec = specModule.loadsimGetSpec('Q7-00', null);
  const supportBase = {
    id: 81, mawb: '', name: 'Base', dims: { l: 100, w: 100, h: 50 }, weight: 10,
    color: '#2563eb', orient: 0, placed: true, staged: false, x: 0, y: 0, z: -50
  };
  const supportPart = {
    id: 82, mawb: '', name: 'Part', dims: { l: 100, w: 100, h: 50 }, weight: 10,
    color: '#0ea5e9', orient: 0, placed: true, staged: false, x: 80, y: 50, z: -50
  };
  const supportOptions = { allowOverhang: true, requireSupport: true, supportMinPct: 50 };
  const areaOn = geomModule.loadsimEvaluatePlacement(supportPart, supportSpec, [supportBase], supportOptions);
  const areaOff = geomModule.loadsimEvaluatePlacement(supportPart, supportSpec, [supportBase],
    { ...supportOptions, supportAreaEnabled: false });
  check('28.3 勾選 X% 面積時：只壓 20% → 不合法（需 ≥ 50%）',
    areaOn.supported === false && areaOn.ok === false,
    `supportRatio=${(areaOn.supportRatio * 100).toFixed(0)}%`);
  check('28.3b 取消勾選 → 有接觸即可（20% 也算有支撐）',
    areaOff.supported === true && areaOff.ok === true,
    `supportRatio=${(areaOff.supportRatio * 100).toFixed(0)}%`);
  const supportFloat = {
    id: 83, mawb: '', name: 'Float', dims: { l: 100, w: 100, h: 50 }, weight: 10,
    color: '#16a34a', orient: 0, placed: true, staged: false, x: 300, y: 80, z: -50
  };
  const floatReport = geomModule.loadsimEvaluatePlacement(supportFloat, supportSpec, [supportBase],
    { ...supportOptions, supportAreaEnabled: false });
  check('28.3c 取消勾選仍不可懸空（完全沒支撐 → 不合法）',
    floatReport.supported === false && floatReport.ok === false);

  // 28.4 單件重量上限 checkbox：取消勾選 → 不再標示超重
  const weightModule = await import(`${baseUrl}/loadsim/weight.js`);
  stateModule.loadsimState.itemMaxEnabled = false;
  stateModule.loadsimState.itemMaxKg = 1000;
  stateModule.loadsimState.items = [
    { id: 91, mawb: '', name: 'Heavy', dims: { l: 50, w: 50, h: 50 }, weight: 7000, color: '#ef4444', orient: 0, placed: true, staged: false, x: 10, y: 0, z: -25 }
  ];
  const weightSpec = specModule.loadsimGetSpec('Q7-00', null);
  const sumOff = weightModule.loadsimSummarize(stateModule.loadsimState, weightSpec);
  check('28.4 取消勾選「單件重量上限」→ 不再列超重（heavy 為空）', sumOff.heavy.length === 0);
  stateModule.loadsimState.itemMaxEnabled = true;
  const sumOn = weightModule.loadsimSummarize(stateModule.loadsimState, weightSpec);
  check('28.4b 勾選後 → 7000kg 超過 1000kg 會列入 heavy', sumOn.heavy.length === 1);

  // 28.5 點明細列 → 資料載入 ① 表單（修改模式）
  stateModule.loadsimState.unit = 'cm';
  stateModule.loadsimState.itemMaxEnabled = true;
  stateModule.loadsimState.items = [
    { id: 71, mawb: 'M1', name: 'EditMe', dims: { l: 55, w: 45, h: 35 }, weight: 12, color: '#2563eb', orient: 0, placed: false, staged: false, x: 0, y: 0, z: 0 }
  ];
  stateModule.loadsimState.selectedId = null;
  stateModule.loadsimEmit();
  dimRowsEl.querySelectorAll = () => [];
  const rowTarget = { dataset: { id: '71', mawb: 'M1' } };
  linesBox2.fire('click', { target: { closest: sel => (sel === '[data-id]' ? rowTarget : null) } });
  check('28.5 點明細列 → 載入尺寸／重量／名稱／MAWB 到 ① 表單',
    getEl('loadsim-len').value === '55' && getEl('loadsim-wid').value === '45' &&
    getEl('loadsim-hgt').value === '35' && getEl('loadsim-weight').value === '12' &&
    getEl('loadsim-item-name').value === 'EditMe' && getEl('loadsim-item-mawb').value === 'M1',
    `${getEl('loadsim-len').value}x${getEl('loadsim-wid').value}x${getEl('loadsim-hgt').value} / ${getEl('loadsim-item-mawb').value}`);
  check('28.5b 表單進入修改模式（按鈕變「儲存修改」、出現取消修改）',
    String(getEl('loadsim-btn-add').textContent).includes('儲存修改') &&
    getEl('loadsim-btn-cancel-edit').hidden === false &&
    getEl('loadsim-edit-hint').hidden === false);

  // 28.6 修改後送出 → 更新原貨物（不新增重複）
  getEl('loadsim-len').value = '70';
  getEl('loadsim-weight').value = '18';
  submitItemForm();
  const editedItems = stateModule.loadsimState.items;
  check('28.6 修改後送出 → 更新原貨物（件數不變、尺寸／重量已改）',
    editedItems.length === 1 && editedItems[0].id === 71 &&
    editedItems[0].dims.l === 70 && editedItems[0].weight === 18,
    editedItems.map(item => `${item.id}:${item.dims.l}/${item.weight}`).join(' '));
  check('28.6b 修改完成 → 回到新增模式（按鈕文字復原、取消修改隱藏）',
    String(getEl('loadsim-btn-add').textContent).includes('產生貨物') &&
    getEl('loadsim-btn-cancel-edit').hidden === true);

  // ===== 29. 出界「界線」／hover 邊長／tooltip CTN#／明細列 CBM =====
  // 29.1 geometry：出界的「界的那一條邊」＝貨物剖面與超出平面的交集線段
  const bSpec = specModule.loadsimGetSpec('Q7-00', null);
  const bItem = {
    id: 95, mawb: '', name: 'Boundary', dims: { l: 60, w: 100, h: 50 }, weight: 10,
    color: '#2563eb', orient: 0, placed: true, staged: false, x: 0, y: 0, z: 60
  };
  const bOptions = { allowOverhang: true, requireSupport: true, supportMinPct: 50 };
  const zEntry = geomModule.loadsimEvaluatePlacement(bItem, bSpec, [], bOptions)
    .overflows.find(o => o.plane.axis === 'z');
  const zSeg = geomModule.loadsimOverflowBoundary(geomModule.loadsimExtents(bItem), zEntry);
  const zUs = zSeg ? [zSeg.a[0], zSeg.b[0]] : [];
  const zVs = zSeg ? [zSeg.a[1], zSeg.b[1]].sort((a, b) => a - b) : [];
  check('29.1 出界界線＝右側超出平面與貨物剖面的交集（z = 板寬/2、y 0→50）',
    !!zSeg &&
    zUs.every(u => Math.abs(u - bSpec.baseW / 2) < 0.01) &&
    Math.abs(zVs[0]) < 0.01 && Math.abs(zVs[1] - 50) < 0.01,
    zSeg ? `z=${zUs.map(v => v.toFixed(2))} y=${zVs.map(v => v.toFixed(2))}` : '沒有界線');

  const xBoundItem = { ...bItem, id: 96, x: bSpec.baseL - 28, z: -50 };
  const xEntry = geomModule.loadsimEvaluatePlacement(xBoundItem, bSpec, [], bOptions)
    .overflows.find(o => o.plane.axis === 'x');
  const xSeg = geomModule.loadsimOverflowBoundary(geomModule.loadsimExtents(xBoundItem), xEntry);
  check('29.1b 後端出界 → 界線在 x = 板長（y 0→50）',
    !!xSeg &&
    Math.abs(xSeg.a[0] - bSpec.baseL) < 0.01 && Math.abs(xSeg.b[0] - bSpec.baseL) < 0.01 &&
    Math.abs(Math.abs(xSeg.a[1] - xSeg.b[1]) - 50) < 0.01,
    xSeg ? `x=${xSeg.a[0].toFixed(2)} y=${xSeg.a[1].toFixed(2)}→${xSeg.b[1].toFixed(2)}` : '沒有界線');

  // 29.2 3D：滑過貨物 → 看得見的每一條邊都標長度（沒滑過就不標）
  const hoverItem = {
    id: 97, mawb: '', name: 'Hover', dims: { l: 120, w: 90, h: 80 }, weight: 10,
    color: '#2563eb', orient: 0, placed: true, staged: false, x: 20, y: 0, z: -45
  };
  const dimTexts = ['120', '90', '80'];
  stateModule.loadsimState.unit = 'cm';
  renderModule.loadsimSetViewMode('3d');
  renderModule.loadsimResetView();
  const plainFrom = drawCalls.length;
  renderModule.loadsimDraw({ ...drawOptions, spec: bSpec, items: [hoverItem] });
  const plainTexts = drawCalls.slice(plainFrom)
    .filter(c => c.name === 'fillText').map(c => String(c.args[0]));
  const hoverFrom = drawCalls.length;
  renderModule.loadsimDraw({ ...drawOptions, spec: bSpec, items: [hoverItem], hoverId: hoverItem.id });
  const hoverTexts = drawCalls.slice(hoverFrom)
    .filter(c => c.name === 'fillText').map(c => String(c.args[0]));
  const hoverHits = dimTexts.filter(t => hoverTexts.includes(t));
  check('29.2 3D 滑過貨物 → 可見的邊都標出長度（120／90／80），平常不標',
    hoverHits.length === 3 && dimTexts.every(t => !plainTexts.includes(t)),
    `hover=${hoverHits.join('/')} plain=${dimTexts.filter(t => plainTexts.includes(t)).join('/') || '—'}`);

  // 29.3 2D 剖面：滑過貨物時四條邊也標長度（俯視＝寬 90／長 120；前視＝寬 90／高 80）
  renderModule.loadsimSetViewMode('2d');
  const d2From = drawCalls.length;
  renderModule.loadsimDraw({ ...drawOptions, spec: bSpec, items: [hoverItem], hoverId: hoverItem.id });
  const d2Texts = drawCalls.slice(d2From)
    .filter(c => c.name === 'fillText').map(c => String(c.args[0]));
  check('29.3 2D 滑過貨物 → 四條邊都標長度（90 出現 4 次、120／80 各 2 次）',
    d2Texts.filter(t => t === '90').length === 4 &&
    d2Texts.filter(t => t === '120').length === 2 &&
    d2Texts.filter(t => t === '80').length === 2,
    d2Texts.filter(t => dimTexts.includes(t)).join('/'));

  // 29.4 浮動 tooltip：名稱後面帶對應的 CTN#（| #97）
  renderModule.loadsimSetViewMode('3d');
  stateModule.loadsimState.items = [hoverItem];
  stateModule.loadsimState.selectedId = null;
  stateModule.loadsimEmit();
  renderModule.loadsimResetView();
  renderModule.loadsimDraw({ ...drawOptions, spec: bSpec, items: [hoverItem] });
  const tipPx = renderModule.loadsimProjectPoint({ x: 80, y: 40, z: 0 });
  if (tipPx) {
    getEl('loadsim-canvas').fire('pointermove', { clientX: tipPx.x, clientY: tipPx.y, pointerId: 31 });
  }
  const tipHtml = String(getEl('loadsim-tooltip').innerHTML);
  check('29.4 tooltip 名稱後面加上「| #97」（與明細列的 #id 對照）',
    !!tipPx && getEl('loadsim-tooltip').hidden === false &&
    tipHtml.includes('Hover') && tipHtml.includes('| #97'),
    tipHtml.slice(0, 90));

  // 29.5 明細列「尺寸」右側新增 CBM 欄（100×50×40 → 0.200）
  stateModule.loadsimState.items = [
    { id: 98, mawb: '', name: 'Big', dims: { l: 100, w: 50, h: 40 }, weight: 10, color: '#2563eb', orient: 0, placed: false, staged: false, x: 0, y: 0, z: 0 },
    { id: 99, mawb: '', name: 'Small', dims: { l: 50, w: 50, h: 50 }, weight: 10, color: '#0ea5e9', orient: 0, placed: false, staged: false, x: 0, y: 0, z: 0 }
  ];
  stateModule.loadsimEmit();
  const cbmBox = getEl('loadsim-item-lines');
  const cbmHtml = String(cbmBox.innerHTML);
  check('29.5 明細列新增 CBM 欄（0.200 / 0.125）並可排序',
    cbmHtml.includes('loadsim-line-cbm') && cbmHtml.includes('CBM') &&
    cbmHtml.includes('0.200') && cbmHtml.includes('0.125'));
  cbmBox.fire('click', {
    target: { closest: sel => (sel === '[data-sort]' ? { dataset: { sort: 'cbm' } } : null) }
  });
  const cbmSortedHtml = String(cbmBox.innerHTML);
  check('29.5b 點表頭「CBM」→ 由小到大排序（#99 0.125 → #98 0.200）',
    cbmSortedHtml.indexOf('data-id="99"') < cbmSortedHtml.indexOf('data-id="98"'),
    `99@${cbmSortedHtml.indexOf('data-id="99"')} 98@${cbmSortedHtml.indexOf('data-id="98"')}`);

  console.log(`\n===== 完成：PASS ${passCount} / FAIL ${failCount} =====`);
  if (failCount > 0) process.exitCode = 1;
})().catch(err => {
  console.error('測試執行失敗：', err);
  process.exitCode = 1;
});

