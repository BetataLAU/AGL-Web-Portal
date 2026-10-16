// ===== SLI/ELI 版面編輯器「前端」測試腳本（P5）=====
// 以最小 DOM stub 實際載入 public/js/sli-eli-layout-{state,editor,main}.js，驗證：
//   A. 三個檔案都能在瀏覽器語意下載入（無例外）
//   B. 跨檔案要互相呼叫的函式必須是「全域」（function 宣告沒有被包進別的函式內）
//   C. 入口會註冊 DOMContentLoaded → 頁面真的會初始化
//   D. 初始化後畫面內容正確（欄位清單／底圖／欄位方塊／分頁／狀態列）
//   E. sli-eli-layout.html 引用的本地 script / css 檔都存在
//
// 為什麼需要這支腳本：曾經發生「lelTestPdf() 的 finally 少了收尾大括號」，
// 導致後面的 lelBindUi()/lelInit()/DOMContentLoaded 註冊全部被包進 lelTestPdf 內，
// 變成非全域 → 編輯器頁面完全空白、按鈕無效，但 `node --check` 語法檢查仍通過
// （大括號總數剛好平衡）。只有實際載入並觸發 DOMContentLoaded 才驗得出來。
//
// 用法：node scripts/test-sli-eli-layout-frontend.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const TEMPLATES = path.join(ROOT, 'data', 'templates');

const JS_FILES = ['js/sli-eli-layout-state.js', 'js/sli-eli-layout-editor.js', 'js/sli-eli-layout-main.js'];

// 可選參數：改用另一份 sli-eli-layout-main.js（用來確認本測試抓得出壞掉的版本，例如 git show HEAD:…）
const MAIN_OVERRIDE = process.argv[2] ? path.resolve(process.argv[2]) : null;


// fieldmap 是跨檔案共用的 UI 契約：清單／方塊數量都以此為準
const fieldmap = JSON.parse(fs.readFileSync(path.join(TEMPLATES, 'sli-eli-fieldmap.json'), 'utf8'));
const defaultFieldmap = JSON.parse(fs.readFileSync(path.join(TEMPLATES, 'sli-eli-fieldmap.default.json'), 'utf8'));
const fields = fieldmap.fields || [];
const pages = fieldmap.pages || [];
const fieldsOfPage0 = fields.filter((f) => Number(f.page) === Number((pages[0] || {}).index || 0)).length;

let failed = 0;
function check(name, ok, detail = '') {
  if (!ok) failed += 1;
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` ${detail}` : ''}`);
}

// ===== 最小 DOM stub（不引入 jsdom；只實作編輯器初始化會用到的 API）=====
function makeEl(id) {
  return {
    id,
    style: {},
    children: [],
    value: '',
    innerHTML: '',
    textContent: '',
    disabled: false,
    _listeners: {},
    classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } },
    addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); },
    removeEventListener() {},
    setAttribute(k, v) { this[k] = String(v); },
    getAttribute(k) { return this[k] === undefined ? null : this[k]; },
    appendChild(c) { this.children.push(c); return c; },
    remove() {},
    closest() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    focus() {},
    click() {},
    getBoundingClientRect() { return { left: 0, top: 0, width: 0, height: 0 }; },
  };
}

const els = new Map();
const docListeners = {};
const winListeners = {};
const doc = {
  getElementById(id) { if (!els.has(id)) els.set(id, makeEl(id)); return els.get(id); },
  createElement(tag) { return makeEl(`created:${tag}`); },
  querySelector() { return null; },
  querySelectorAll() { return []; },
  addEventListener(type, fn) { (docListeners[type] = docListeners[type] || []).push(fn); },
  removeEventListener() {},
  body: makeEl('body'),
  documentElement: makeEl('html'),
};

const sandbox = {
  console, setTimeout, clearTimeout, setInterval, clearInterval, Promise, JSON, Math, Date, Number, String,
  Object, Array, RegExp, Error, TypeError, isNaN, parseInt, parseFloat, encodeURIComponent, decodeURIComponent,
  document: doc,
  location: { search: '', hash: '' },
  addEventListener(type, fn) { (winListeners[type] = winListeners[type] || []).push(fn); },
  removeEventListener() {},
};
sandbox.window = sandbox;
sandbox.self = sandbox;
sandbox.globalThis = sandbox;

// 取代 js/utils/api.js（真實 api.js 提供 window.apiFetch；這裡提供同樣介面）
//   GET  <api>          → 設定（fieldmap / 頁面 / 樣本 / 權限）
//   POST <api>/preview  → 伺服器端 engine.layout() 的排版結果
const apiCalls = [];
sandbox.apiFetch = async (url, opts = {}) => {
  apiCalls.push({ url: String(url), method: opts.method || 'GET' });
  if (String(url).endsWith('/preview')) {
    return {
      sample: { id: 'sample', label: '內建範例', latin1: true },
      renderable: true,
      usedDraft: true,
      ms: 3,
      fields: fields.map((f) => ({
        key: f.key,
        box: f.box,
        origin: f.origin,
        sizePt: (f.font && f.font.sizePt) || 8,
        lineHeightPt: f.lineHeightPt,
        wrapWidthPt: f.wrapWidthPt,
        maxLines: f.maxLines,
        textBaselineOffsetPt: f.textBaselineOffsetPt,
        color: '#000000',
        bold: false,
        positions: [{ text: f.key, x: f.box.x, baseline: f.box.y + 8 }],
      })),
    };
  }
  return {
    canEdit: true,
    role: 'admin',
    fieldmap,
    defaultFieldmap,
    baselineModel: (fieldmap.calibration && fieldmap.calibration.baselineModel) || null,
    samples: [{ id: 'sample', label: '內建範例', latin1: true }],
    backups: [],
    updatedAt: '2026-10-14T09:33:45.000Z',
    engineIssue: null,
  };
};

(async () => {
  console.log('===== SLI/ELI 版面編輯器前端測試（sli-eli-layout-*.js）=====\n');

  // --- A. 載入 ---
  const ctx = vm.createContext(sandbox);
  const loadErrors = [];
  for (const rel of JS_FILES) {
    const file = (MAIN_OVERRIDE && rel.endsWith('main.js')) ? MAIN_OVERRIDE : path.join(PUBLIC, rel);
    try {
      vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: rel });
    } catch (err) {
      loadErrors.push(`${rel}: ${err.name}: ${err.message}`);
    }
  }
  check('A1 三個 JS 載入無例外', loadErrors.length === 0, loadErrors.join(' | '));

  // --- B. 全域函式（跨檔案呼叫的必須是全域）---
  const globals = [
    // editor.js（DOM / 互動）
    'lelEl', 'lelRenderAll', 'lelRenderPageTabs', 'lelRenderList', 'lelRenderStage', 'lelRenderProps',
    'lelRenderStatus', 'lelRenderToolbarState', 'lelStagePointerDown', 'lelKeydown',
    'lelSelectField', 'lelUndo', 'lelRedo', 'lelApplyProp', 'lelSetAlign',
    // main.js（入口與動作）
    'lelFlash', 'lelSave', 'lelResetOne', 'lelResetAll', 'lelTestPdf', 'lelBindUi', 'lelInit',
    // state.js（state / 幾何 / API）
    'lelLoadConfig', 'lelRunPreview', 'lelSchedulePreview', 'lelDraftPatches', 'lelField',
  ];
  // 用 vm 內求值（而非讀 ctx 屬性）：function 宣告與 const 宣告的全域繫結都算通過
  const declType = (fn) => vm.runInContext(`typeof ${fn}`, ctx);
  const missing = globals.filter((fn) => declType(fn) !== 'function');
  check(`B1 ${globals.length} 個跨檔案函式都是全域（無「假全域」）`, missing.length === 0,
    missing.length
      ? `→ 缺少/非全域：${missing.join(', ')}`
      : `（lelBindUi=${declType('lelBindUi')}, lelInit=${declType('lelInit')}, lelRenderProps=${declType('lelRenderProps')}）`);

  // --- C. DOMContentLoaded ---
  const dcl = docListeners.DOMContentLoaded || [];
  check('C1 只註冊 1 個 DOMContentLoaded（頁面會初始化）', dcl.length === 1, `（實際 ${dcl.length} 個）`);

  // --- D. 初始化後畫面 ---
  for (const fn of dcl) {
    try {
      await fn();
    } catch (err) {
      check('D0 DOMContentLoaded 執行無例外', false, `${err.name}: ${err.message}`);
    }
  }
  const html = (id) => String(els.has(id) ? els.get(id).innerHTML : '');
  const listItems = (html('lel-field-list').match(/lel-list-item/g) || []).length;
  check('D1 欄位清單渲染所有欄位', listItems === fields.length, `（${listItems} / ${fields.length}）`);
  const stage = html('lel-stage');
  check('D2 底圖已插入（伺服器 /background/:page）', stage.includes('lel-bg'));
  const boxes = (stage.match(/lel-field /g) || []).length;
  check('D3 目前頁面的欄位方塊已渲染', boxes === fieldsOfPage0, `（${boxes} / 第 1 頁 ${fieldsOfPage0} 個）`);
  check('D4 文字行位置來自 /preview（與 PDF 同一套數學）', (stage.match(/lel-line/g) || []).length > 0,
    `（${(stage.match(/lel-line/g) || []).length} 行）`);
  const tabCount = (html('lel-page-tabs').match(/data-page/g) || []).length;
  check('D5 分頁按鈕數＝fieldmap 頁數', tabCount === pages.length, `（${tabCount} / ${pages.length}）`);
  check('D6 狀態列已渲染（權限／樣本／上次儲存）', html('lel-status').includes('可編輯'));
  check('D7 樣本下拉已填入選項', html('lel-sample').includes('option'));
  check('D8 已呼叫 config 與 preview API',
    apiCalls.some((c) => c.method === 'GET') && apiCalls.some((c) => c.url.endsWith('/preview')),
    `（${apiCalls.map((c) => c.method).join(', ') || '無'}）`);

  // --- E. HTML 引用的本地資源存在 ---
  const htmlText = fs.readFileSync(path.join(PUBLIC, 'sli-eli-layout.html'), 'utf8');
  const refs = [...htmlText.matchAll(/(?:src|href)="([^"]+)"/g)]
    .map((m) => m[1])
    .filter((u) => !/^(https?:)?\/\//.test(u) && !u.startsWith('#'));
  const missingRefs = refs.filter((u) => !fs.existsSync(path.join(PUBLIC, u.split('#')[0].split('?')[0])));
  check(`E1 sli-eli-layout.html 的 ${refs.length} 個本地資源都存在`, missingRefs.length === 0, missingRefs.join(', '));

  console.log(`\n===== ${failed === 0 ? '全部通過' : `${failed} 項失敗`} =====`);
  process.exitCode = failed === 0 ? 0 : 1;
})();
