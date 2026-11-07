// ===== Shipper Role Project - ② 預覽表格「兩列表頭 sticky 分層（TAG 那行永遠看得到）」測試 =====
// 以最小 DOM stub 實際載入 public/js/xls-booking-preview.js，驗證：
//   A. CSS：第 1 列（TAG 列）固定 top:0 且疊在最上層；第 2 列（原始欄名）黏在 --xls-head-h 下緣
//   B. JS：面板顯示後會量測；resize／orientationchange／DOMContentLoaded／fonts.ready 會重算
//   C. 執行期：量到高度就寫入 --xls-head-h、量不到就移除（維持 top:0，③ 單列表頭不受影響）
// 啟動方式：node scripts/test-xls-preview-head.js（不需伺服器、不需瀏覽器）
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const PUBLIC_JS = path.join(ROOT, 'public', 'js');
const CSS = fs.readFileSync(path.join(ROOT, 'public', 'css', 'xls-booking.css'), 'utf8');
const PREVIEW_SRC = fs.readFileSync(path.join(PUBLIC_JS, 'xls-booking-preview.js'), 'utf8');
const STANDARD_SRC = fs.readFileSync(path.join(PUBLIC_JS, 'xls-booking-standard.js'), 'utf8');

let pass = 0;
let fail = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) pass++; else fail++;
  console.log(`  ${ok ? '✅' : '❌'} ${name}：${JSON.stringify(actual)}${ok ? '' : `（預期 ${JSON.stringify(expected)}）`}`);
}

// ---------- CSS 區塊取出（同一選擇器只取第一個 { ... }） ----------
function cssBlock(selector) {
  const i = CSS.indexOf(selector);
  if (i < 0) return '';
  const open = CSS.indexOf('{', i);
  const close = CSS.indexOf('}', open);
  return CSS.slice(open + 1, close);
}

// ---------- A. CSS：兩列表頭分層 ----------
console.log('\nA. CSS 兩列表頭分層 sticky');
const baseBlock = cssBlock('.xls-preview-table thead th {');
const row1Block = cssBlock('.xls-preview-table thead tr:nth-child(1) th {');
const row2Block = cssBlock('.xls-preview-table thead tr:nth-child(2) th {');
check('A1 基底：表頭 th 是 sticky', /position:\s*sticky/.test(baseBlock), true);
check('A2 第 1 列（TAG 列）固定 top:0', /top:\s*0/.test(row1Block), true);
check('A3 第 1 列 z-index 4（疊在最上層）', /z-index:\s*4/.test(row1Block), true);
check('A4 第 2 列黏在 --xls-head-h 下緣', /top:\s*var\(--xls-head-h,\s*0px\)/.test(row2Block), true);
check('A5 第 2 列 z-index 3（低於第 1 列，不會蓋掉 TAG）', /z-index:\s*3/.test(row2Block), true);
check('A6 分層規則寫在基底規則之後（才會覆蓋 top/z-index）',
  CSS.indexOf('.xls-preview-table thead tr:nth-child(1) th') > CSS.indexOf('.xls-preview-table thead th {'), true);

// ---------- B. JS：呼叫時機與監聽 ----------
console.log('\nB. JS 量測時機');
const displayIdx = PREVIEW_SRC.indexOf("panel.style.display = 'block';");
const syncCallIdx = PREVIEW_SRC.indexOf('xlsSyncStickyHeadHeight();', displayIdx);
check('B1 renderPreviewPanel 顯示面板後才量測', displayIdx >= 0 && syncCallIdx > displayIdx, true);
check('B2 有 resize 監聽', /addEventListener\('resize'/.test(PREVIEW_SRC), true);
check('B3 有 orientationchange 監聽', /addEventListener\('orientationchange'/.test(PREVIEW_SRC), true);
check('B4 有 fonts.ready 重算', /document\.fonts\.ready/.test(PREVIEW_SRC), true);
check('B5 連續觸發有 debounce（150ms）', /setTimeout\(xlsSyncStickyHeadHeight,\s*150\)/.test(PREVIEW_SRC), true);
// ③ 標準化表格只有一列 thead → 不會套到 tr:nth-child(2) 的偏移
const stdHead = (STANDARD_SRC.match(/<thead>([\s\S]*?)<\/thead>/) || [])[1] || '';
check('B6 ③ 標準化表格表頭只有一列（不受分層影響）', (stdHead.match(/<tr>/g) || []).length, 1);

// ---------- C. 執行期（vm + DOM stub） ----------
console.log('\nC. 執行期量測');
let measureCount = 0;

function makeHeadRow(height) {
  return {
    getBoundingClientRect() { measureCount++; return { height }; },
  };
}

function makeWrap() {
  const props = {};
  return {
    props,
    headRow: null,
    style: {
      setProperty(k, v) { props[k] = v; },
      removeProperty(k) { delete props[k]; },
      getPropertyValue(k) { return props[k]; },
    },
    querySelector(sel) { return sel === '.xls-preview-table > thead > tr' ? this.headRow : null; },
  };
}

const wrap = makeWrap();
const panel = {
  wrap,
  querySelector(sel) { return sel === '.xls-preview-table-wrap' ? this.wrap : null; },
};

const windowHandlers = {};
const docHandlers = {};
const observers = [];
class ResizeObserverStub {
  constructor(cb) { this.cb = cb; this.targets = []; observers.push(this); }
  observe(el) { this.targets.push(el); }
  disconnect() { this.targets = []; }
}

let fontsHandler = null;
const sandbox = {
  console,
  setTimeout,
  clearTimeout,
  document: {
    getElementById: (id) => (id === 'xls-preview-panel' ? panel : null),
    addEventListener(type, fn) { (docHandlers[type] = docHandlers[type] || []).push(fn); },
    fonts: {
      ready: {
        then(fn) { fontsHandler = fn; return { catch() {} }; },
      },
    },
  },
  window: {
    ResizeObserver: ResizeObserverStub,
    addEventListener(type, fn) { (windowHandlers[type] = windowHandlers[type] || []).push(fn); },
    removeEventListener() {},
  },
};
sandbox.globalThis = sandbox;
sandbox.window.document = sandbox.document;
vm.createContext(sandbox);
vm.runInContext(PREVIEW_SRC, sandbox);

check('C0 載入後註冊 resize／orientationchange',
  [typeof windowHandlers.resize?.[0], typeof windowHandlers.orientationchange?.[0]], ['function', 'function']);
check('C1 載入後註冊 fonts.ready 重算', typeof fontsHandler, 'function');

// 第 1 列高 42.4px → 寫入 42px（第 2 列黏在 TAG 列下緣）
wrap.headRow = makeHeadRow(42.4);
sandbox.xlsSyncStickyHeadHeight();
check('C2 量測第 1 列高度 → --xls-head-h', wrap.props['--xls-head-h'], '42px');

// TAG 換行變高 → 重新量測覆寫
wrap.headRow = makeHeadRow(58);
sandbox.xlsSyncStickyHeadHeight();
check('C3 高度改變後覆寫變數', wrap.props['--xls-head-h'], '58px');

// 容器寬度改變（目錄抽屜開合）→ ResizeObserver 會排程重算
check('C4 已用 ResizeObserver 追蹤容器', [observers.length, observers[observers.length - 1].targets[0] === wrap], [1, true]);

// 量不到高度（面板被關掉／表格未建立）→ 移除變數，維持 CSS 的 top:0
wrap.headRow = makeHeadRow(0);
sandbox.xlsSyncStickyHeadHeight();
check('C5 高度量到 0 → 移除變數', wrap.props['--xls-head-h'], undefined);

wrap.headRow = null;
sandbox.xlsSyncStickyHeadHeight();
check('C6 沒有表頭 → 移除變數', wrap.props['--xls-head-h'], undefined);

// debounce：150ms 內多次觸發只量一次（避免 resize 時反覆排版）
wrap.headRow = makeHeadRow(46);
measureCount = 0;
sandbox.xlsScheduleStickyHeadSync();
sandbox.xlsScheduleStickyHeadSync();
sandbox.xlsScheduleStickyHeadSync();
check('C7 debounce 期間尚未量測', measureCount, 0);

setTimeout(() => {
  check('C8 debounce 只量測一次且已寫入變數', [measureCount, wrap.props['--xls-head-h']], [1, '46px']);
  console.log(`\n===== ${fail === 0 ? `全部通過（${pass} 項）` : `${fail} 項失敗（通過 ${pass} 項）`} =====`);
  if (fail > 0) process.exit(1);
}, 220);

