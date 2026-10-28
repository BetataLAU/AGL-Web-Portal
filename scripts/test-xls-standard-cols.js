// ===== Shipper Role Project - ③ 標準化結果預覽「欄寬可調整」測試 =====
// 以最小 DOM stub 實際載入 public/js/xls-booking-state.js + xls-booking-standard.js，驗證：
//   A. 表格有 colgroup（預設欄寬）＋每欄表頭有拖曳把手，勾選欄不給把手
//   B. 拖曳只改被拖曳的欄位（其他欄寬不動），表格總寬跟著變、拖曳結束清掉監聽與樣式
//   C. 欄寬會寫入 localStorage，重繪後仍沿用
//   D. 最小／最大寬度夾制（56px～900px；勾選欄最小 44px）
//   E. 雙擊邊界只重設該欄；「重設全部欄寬」清空記憶
// 啟動方式：node scripts/test-xls-standard-cols.js（不需伺服器、不需瀏覽器）
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const PUBLIC_JS = path.join(__dirname, '..', 'public', 'js');
const STORAGE_KEY = 'xls-std-col-widths';

let pass = 0;
let fail = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) pass++; else fail++;
  console.log(`  ${ok ? '✅' : '❌'} ${name}：${JSON.stringify(actual)}${ok ? '' : `（預期 ${JSON.stringify(expected)}）`}`);
}

// ---------- DOM / 瀏覽器 stub ----------
const store = {};
const localStorageStub = {
  getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};

const bodyClassList = {
  classes: [],
  add(c) { if (!this.classes.includes(c)) this.classes.push(c); },
  remove(c) { this.classes = this.classes.filter((x) => x !== c); },
  contains(c) { return this.classes.includes(c); },
};

const panel = {
  innerHTML: '',
  style: {},
  scrollLeft: 0,
  scrollTop: 0,
  _table: null,
  querySelector(sel) {
    return sel === '.xls-standardized-table' ? this._table : null;
  },
};

const windowHandlers = {};
const sandbox = {
  console,
  localStorage: localStorageStub,
  document: {
    getElementById: (id) => (id === 'xls-standardized-panel' ? panel : null),
    querySelectorAll: () => [],
    body: { classList: bodyClassList },
  },
  window: {
    addEventListener(type, fn) { (windowHandlers[type] = windowHandlers[type] || []).push(fn); },
    removeEventListener(type, fn) { windowHandlers[type] = (windowHandlers[type] || []).filter((f) => f !== fn); },
  },
  setTimeout,
  clearTimeout,
};
sandbox.globalThis = sandbox;
sandbox.window.document = sandbox.document;

vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(PUBLIC_JS, 'xls-booking-state.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(PUBLIC_JS, 'xls-booking-standard.js'), 'utf8'), sandbox);

// xlsState 是 `let`（不在 global 物件上），需在 sandbox 內執行才能存取
const run = (code) => vm.runInContext(code, sandbox);

// ---------- 從渲染出的 HTML 取出欄寬，並建立可拖曳的假表格 ----------
function colWidthsFromHtml(html) {
  const out = {};
  const re = /<col data-col-key="([^"]+)" style="width:(\d+)px"/g;
  let m;
  while ((m = re.exec(html))) out[m[1]] = Number(m[2]);
  return out;
}

function tableWidthFromHtml(html) {
  const m = html.match(/<table class="xls-preview-table xls-standardized-table" style="width:(\d+)px/);
  return m ? Number(m[1]) : null;
}

function makeHandle() {
  const classes = [];
  return {
    classes,
    classList: {
      add(c) { if (!classes.includes(c)) classes.push(c); },
      remove(c) { const i = classes.indexOf(c); if (i >= 0) classes.splice(i, 1); },
      contains(c) { return classes.includes(c); },
    },
  };
}

// 依渲染出的 colgroup 建立假 table（getBoundingClientRect 回傳 col 目前的 style.width）
function buildFakeTable(html) {
  const entries = [];
  const re = /<col data-col-key="([^"]+)" style="width:(\d+)px"/g;
  let m;
  while ((m = re.exec(html))) entries.push({ key: m[1], width: Number(m[2]) });
  const pairs = entries.map((e) => {
    const col = {
      style: { width: `${e.width}px` },
      getAttribute(name) { return name === 'data-col-key' ? e.key : null; },
    };
    const th = {
      getBoundingClientRect() { return { width: Number(String(col.style.width).replace('px', '')) }; },
    };
    return { col, th };
  });
  return {
    style: {},
    querySelectorAll(sel) {
      if (sel === 'colgroup > col') return pairs.map((p) => p.col);
      if (sel === 'thead > tr > th') return pairs.map((p) => p.th);
      return [];
    },
  };
}

// ---------- 測試資料（勾選欄＋MAWB#／CNEE＋兩個一般欄位） ----------
run(`
  xlsState.files[0] = {
    originalName: 'test.xlsx',
    _cneeBlocks: [],
    _stdCache: {
      assignedTypes: [
        { value: 'mawb', label: 'MAWB#' },
        { value: 'dest', label: 'DEST' },
        { value: 'pcs', label: '件數' }
      ],
      standardized: [
        { mawbKey: '157-12345678', mawb: '157-12345678', cnee: 'ACME CO', dest: 'HKG', pcs: '10' }
      ]
    }
  };
  xlsState.selections[0] = { all: ['157-12345678'], selected: new Set(['157-12345678']) };
`);

console.log('===== ③ 標準化預覽：欄寬可調整 =====\n');

// ---------- A. 預設渲染 ----------
let html = renderAndRead(0);
console.log('A. 預設渲染');
check('A1 colgroup 欄寬（check/mawb/cnee/dest/pcs）', colWidthsFromHtml(html),
  { check: 44, mawb: 150, cnee: 220, dest: 120, pcs: 120 });
check('A2 表格總寬＝各欄相加', tableWidthFromHtml(html), 44 + 150 + 220 + 120 + 120);
check('A3 勾選欄不給拖曳把手（共 4 個把手）', (html.match(/class="xls-col-resizer"/g) || []).length, 4);
check('A4 每個 col 與 th 都有 data-col-key', (html.match(/data-col-key="/g) || []).length, 10);
check('A5 有「重設全部欄寬」按鈕', html.includes('xlsResetStdColWidths(0)'), true);

// ---------- B. 拖曳 CNEE +80px ----------
console.log('\nB. 拖曳調整欄寬');
const handle = makeHandle();
const startEv = {
  button: 0,
  clientX: 200,
  currentTarget: handle,
  defaultPrevented: false,
  preventDefault() { this.defaultPrevented = true; },
  stopPropagation() {},
};
sandbox.xlsStartStdColResize(startEv, 0, 'cnee');
check('B1 拖曳開始 preventDefault（不選取文字）', startEv.defaultPrevented, true);
check('B2 拖曳開始鎖住頁面游標', bodyClassList.contains('xls-col-resizing'), true);
check('B3 已註冊 pointermove / pointerup 監聽', [
  (windowHandlers.pointermove || []).length > 0,
  (windowHandlers.pointerup || []).length > 0,
], [true, true]);
check('B4 拖曳開始先把所有欄寬定格成 px', colWidthsFromHtml(panel.innerHTML), {
  check: 44, mawb: 150, cnee: 220, dest: 120, pcs: 120,
});

windowHandlers.pointermove[0]({ clientX: 280 });
const colsNow = panel._table.querySelectorAll('colgroup > col');
check('B5 拖曳 +80px → CNEE 變 300px', colsNow[2].style.width, '300px');
check('B6 其他欄位寬度不變', [colsNow[0].style.width, colsNow[1].style.width, colsNow[3].style.width, colsNow[4].style.width],
  ['44px', '150px', '120px', '120px']);
check('B7 表格總寬跟著增加 80px', panel._table.style.width, `${654 + 80}px`);

sandbox.xlsEndStdColResize();
check('B8 拖曳結束移除監聽', [
  (windowHandlers.pointermove || []).length, (windowHandlers.pointerup || []).length,
], [0, 0]);
check('B9 拖曳結束解除頁面游標鎖定', bodyClassList.contains('xls-col-resizing'), false);
check('B10 欄寬寫入 localStorage', JSON.parse(store[STORAGE_KEY] || '{}').cnee, 300);
check('B11 拖曳把手已移除 xls-resizing', handle.classList.contains('xls-resizing'), false);

// ---------- C. 重繪後沿用記憶的欄寬 ----------
console.log('\nC. 欄寬記憶');
html = renderAndRead(0);
check('C1 重繪後 CNEE 仍是 300px', colWidthsFromHtml(html).cnee, 300);
check('C2 重繪後表格總寬仍含調整值', tableWidthFromHtml(html), 654 + 80);

// 每次重繪後：解析 HTML → 掛上假表格（供拖曳測試使用）
function renderAndRead(fileIndex) {
  sandbox.xlsRenderStandardized(fileIndex);
  const html = panel.innerHTML;
  panel._table = buildFakeTable(html);
  return html;
}

// ---------- D. 寬度夾制 ----------
console.log('\nD. 最小／最大寬度夾制');
const dragEv = (clientX) => ({
  button: 0,
  clientX,
  currentTarget: makeHandle(),
  preventDefault() {},
  stopPropagation() {},
});

sandbox.xlsStartStdColResize(dragEv(500), 0, 'mawb');
windowHandlers.pointermove[0]({ clientX: -1000 });
check('D1 往左拖到底 → 最小 56px', panel._table.querySelectorAll('colgroup > col')[1].style.width, '56px');
sandbox.xlsEndStdColResize();

sandbox.xlsStartStdColResize(dragEv(0), 0, 'cnee');
windowHandlers.pointermove[0]({ clientX: 5000 });
check('D2 往右拖到底 → 最大 900px', panel._table.querySelectorAll('colgroup > col')[2].style.width, '900px');
sandbox.xlsEndStdColResize();

store[STORAGE_KEY] = JSON.stringify({ cnee: 5000 });
run('xlsState.stdColWidths = null;');
check('D3 載入時夾制上限（存 5000 → 900）', sandbox.xlsStdColWidth('cnee'), 900);

store[STORAGE_KEY] = JSON.stringify({ check: 10 });
run('xlsState.stdColWidths = null;');
check('D4 載入時夾制下限（check 存 10 → 44）', sandbox.xlsStdColWidth('check'), 44);

store[STORAGE_KEY] = '{not-json';
run('xlsState.stdColWidths = null;');
check('D5 localStorage 毀損 → 用預設寬度', sandbox.xlsStdColWidth('cnee'), 220);

// ---------- E. 重設 ----------
console.log('\nE. 重設欄寬');
store[STORAGE_KEY] = JSON.stringify({ cnee: 300, mawb: 200 });
run('xlsState.stdColWidths = null;');
html = renderAndRead(0);
check('E1 兩欄都套用記憶值', [colWidthsFromHtml(html).cnee, colWidthsFromHtml(html).mawb], [300, 200]);

sandbox.xlsResetStdColWidth({ preventDefault() {}, stopPropagation() {} }, 0, 'cnee');
check('E2 雙擊邊界只重設該欄', colWidthsFromHtml(panel.innerHTML).cnee, 220);
check('E3 其他欄維持調整值', colWidthsFromHtml(panel.innerHTML).mawb, 200);
check('E4 記憶中只剩 mawb', JSON.parse(store[STORAGE_KEY] || '{}'), { mawb: 200 });

sandbox.xlsResetStdColWidths(0);
check('E5 重設全部 → 清空 localStorage', store[STORAGE_KEY], undefined);
check('E6 重設全部 → 回到預設欄寬', colWidthsFromHtml(panel.innerHTML),
  { check: 44, mawb: 150, cnee: 220, dest: 120, pcs: 120 });

console.log(`\n===== ${fail === 0 ? `全部通過（${pass} 項）` : `${fail} 項失敗（通過 ${pass} 項）`} =====`);
if (fail > 0) process.exit(1);

