// ===== Shipper Role Project - ③ 標準化預覽「雙擊修改 MAWB#／DEST／航班號」測試 =====
// 驗證：
//   A. 後端 standardizeRows：MAWB#／DEST／航班號 覆寫生效（DEST 在 CNEE 比對前套用、以原 MAWB 識別）
//   B. 後端勾選過濾：改過 MAWB# 後仍用「原 MAWB」比對，sourceMawb 不外流到 Report／PDF
//   C. 前端載入：③ 套用 fieldOverrides、勾選 key 仍是原 MAWB、CNEE 用 sourceMawb 對回
//   D. 前端渲染：只有 MAWB#／DEST／航班號 有雙擊編輯（件數等沒有）
//   E. 前端套用修改：存入／改回原值移除覆寫、MAWB 非法值不改、雙擊 input 的 Enter／Esc
// 啟動方式：node scripts/test-xls-standard-fields.js（不需伺服器、不需瀏覽器）
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const { standardizeRows, filterSelectedRecords } = require('./xls-workflow');

const PUBLIC_JS = path.join(__dirname, '..', 'public', 'js');

let pass = 0;
let fail = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) pass++; else fail++;
  console.log(`  ${ok ? '✅' : '❌'} ${name}：${JSON.stringify(actual)}${ok ? '' : `（預期 ${JSON.stringify(expected)}）`}`);
}

console.log('===== ③ 標準化預覽：雙擊修改 MAWB#／DEST／航班號 =====\n');

// ---------- A. 後端 standardizeRows ----------
console.log('A. 後端套用修改（standardizeRows）');
const HEADER = ['MAWB#', 'DEST', '航班號', '件數', 'CNEE'];
const FIELD_MAP = { 0: 'mawb', 1: 'dest', 2: 'flight', 3: 'pcs', 4: 'cnee_name' };
const baseRows = () => [
  HEADER,
  ['157-12345678', 'HKG', 'CX0450', '10', ''],
  ['157-87654321', 'LAX', 'CX0880', '5', 'ORIG CNEE'],
];

const noOv = standardizeRows(baseRows(), { firstDataRow: 2, fieldMap: FIELD_MAP });
check('A1 未修改時取原檔值', [noOv[0].mawb, noOv[0].dest, noOv[0].flight], ['157-12345678', 'HKG', 'CX0450']);

const ovRows = standardizeRows(baseRows(), {
  firstDataRow: 2,
  fieldMap: FIELD_MAP,
  fieldOverrides: { '157-12345678': { mawb: '999-88887777', dest: 'lax', flight: 'cx0450' } },
});
check('A2 MAWB# 覆寫生效（DEST／航班號轉大寫）',
  [ovRows[0].mawb, ovRows[0].dest, ovRows[0].flight],
  ['999-88887777', 'LAX', 'CX0450']);
check('A3 保留原 MAWB（sourceMawb）供勾選比對', ovRows[0].sourceMawb, '157-12345678');
check('A4 未修改的其他列不受影響',
  [ovRows[1].mawb, ovRows[1].dest, ovRows[1].flight, ovRows[1].sourceMawb === undefined],
  ['157-87654321', 'LAX', 'CX0880', true]);

const invalidOv = standardizeRows(baseRows(), {
  firstDataRow: 2,
  fieldMap: FIELD_MAP,
  fieldOverrides: { '157-12345678': { mawb: 'ABC' } },
});
check('A5 MAWB 非法值不改（避免整列被略過）',
  [invalidOv[0].mawb, invalidOv[0].sourceMawb === undefined],
  ['157-12345678', true]);

const cneeWithOv = standardizeRows(baseRows(), {
  firstDataRow: 2,
  fieldMap: FIELD_MAP,
  fieldOverrides: { '157-12345678': { mawb: '999-88887777' } },
  cneeOverrides: { '157-12345678': 'MANUAL CNEE' },
});
check('A6 改 MAWB 後，CNEE 補值仍以原 MAWB 對應',
  [cneeWithOv[0].mawb, cneeWithOv[0].cnee],
  ['999-88887777', 'MANUAL CNEE']);

// DEST 覆寫必須在 CNEE 對照前套用：改對 DEST 後要用新 DEST 重新比對
const rowsWithLookup = () => [
  HEADER,
  ['157-12345678', 'HKG', 'CX0450', '10', ''],
  [],
  ['HKG', '', '', '', ''],
  ['', 'CNEE:', 'HKG CNEE CO', '', ''],
  ['NRT', '', '', '', ''],
  ['', 'CNEE:', 'NRT CNEE CO', '', ''],
];
const cneeBase = standardizeRows(rowsWithLookup(), {
  firstDataRow: 2, fieldMap: FIELD_MAP, cneeLookup: { enabled: true, auto: true },
});
check('A7 未改 DEST → 比對到原 DEST 的 CNEE', cneeBase[0].cnee, 'HKG CNEE CO');
const cneeDestOv = standardizeRows(rowsWithLookup(), {
  firstDataRow: 2,
  fieldMap: FIELD_MAP,
  cneeLookup: { enabled: true, auto: true },
  fieldOverrides: { '157-12345678': { dest: 'NRT' } },
});
check('A8 改 DEST 後用新 DEST 重新比對 CNEE',
  [cneeDestOv[0].dest, cneeDestOv[0].cnee],
  ['NRT', 'NRT CNEE CO']);

// ---------- B. 後端勾選過濾 ----------
console.log('\nB. 勾選過濾（filterSelectedRecords）');
const filtered = filterSelectedRecords([
  { mawb: '999-88887777', sourceMawb: '157-12345678' },
  { mawb: '157-87654321' },
  { mawb: '111-22223333' },
], ['157-12345678', '157-87654321']);
check('B1 改過 MAWB# 的列仍用原 MAWB 命中', filtered.map((r) => r.mawb), ['999-88887777', '157-87654321']);
check('B2 sourceMawb 不會外流', filtered.map((r) => r.sourceMawb === undefined), [true, true]);
const filteredAll = filterSelectedRecords([{ mawb: '999-88887777', sourceMawb: '157-12345678' }], undefined);
check('B3 未帶勾選清單時全數保留（仍清掉 sourceMawb）',
  [filteredAll.length, filteredAll[0].mawb, filteredAll[0].sourceMawb === undefined],
  [1, '999-88887777', true]);

// ---------- 前端：vm + 最小 DOM stub 載入實際前端檔 ----------
const panel = {
  innerHTML: '',
  style: {},
  scrollLeft: 0,
  scrollTop: 0,
  querySelector() { return null; },
};
const apiCalls = [];
const sandbox = {
  console,
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  document: {
    getElementById: (id) => (id === 'xls-standardized-panel' ? panel : null),
    querySelectorAll: () => [],
    body: { classList: { add() {}, remove() {} } },
  },
  window: { addEventListener() {}, removeEventListener() {} },
  setTimeout,
  clearTimeout,
  apiFetch: async (url, opts = {}) => {
    apiCalls.push({ url, body: opts.body });
    if (url === '/api/xls-booking/cnee-preview') {
      return {
        results: [{
          fileIndex: 0,
          blocks: [],
          entries: [{ mawb: '999-88887777', sourceMawb: '157-12345678', dest: 'LAX', remark: '', cnee: 'FROM BACKEND' }],
        }],
      };
    }
    return { rows: [] };
  },
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(PUBLIC_JS, 'xls-booking-state.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(PUBLIC_JS, 'xls-booking-standard.js'), 'utf8'), sandbox);
const run = (code) => vm.runInContext(code, sandbox);
const readState = (expr) => JSON.parse(vm.runInContext(`JSON.stringify(${expr})`, sandbox));

// 假儲存格：支援 innerHTML / querySelector('input') / classList，並可觸發 keydown
function makeCell() {
  const handlers = {};
  const input = {
    value: '',
    placeholder: '',
    spellcheck: true,
    focus() {},
    select() {},
    addEventListener(type, fn) { (handlers[type] = handlers[type] || []).push(fn); },
    trigger(type, ev) { (handlers[type] || []).forEach((fn) => fn(ev || {})); },
  };
  const cell = {
    _html: '',
    classes: [],
    classList: {
      add(c) { if (!cell.classes.includes(c)) cell.classes.push(c); },
      remove(c) { cell.classes = cell.classes.filter((x) => x !== c); },
      contains(c) { return cell.classes.includes(c); },
    },
    set innerHTML(v) { this._html = v; },
    get innerHTML() { return this._html; },
    querySelector(sel) { return (sel === 'input' && cell._html.includes('xls-std-input')) ? input : null; },
  };
  return { cell, input };
}

const ROWS = baseRows();

(async () => {
  // ---------- C. 前端載入（xlsEnsureStandardized） ----------
  run(`
    xlsState.files[0] = {
      id: 'f1',
      originalName: 't.xlsx',
      previewEdited: false,
      lastPreview: { rows: ${JSON.stringify(ROWS)} },
      _cneeBlocks: []
    };
    xlsState.defs = [{ fileIndex: 0, sheetIndex: 0, firstDataRow: 2, fieldMap: ${JSON.stringify(FIELD_MAP)} }];
    xlsState.selections = {};
    xlsState.cneeOverrides = {};
    xlsState.fieldOverrides = { 0: { '157-12345678': { mawb: '999-88887777', dest: 'LAX', flight: 'CX0999' } } };
  `);

  console.log('\nC. 前端載入與顯示');
  await sandbox.xlsEnsureStandardized(0);
  const std = readState('xlsState.files[0]._stdCache.standardized');
  check('C1 ③ 套用 fieldOverrides', [std[0].mawb, std[0].dest, std[0].flight], ['999-88887777', 'LAX', 'CX0999']);
  check('C2 勾選 key 仍是原 MAWB', readState('Array.from(xlsState.selections[0].selected)'),
    ['157-12345678', '157-87654321']);
  check('C3 CNEE 用 sourceMawb 對回', std[0].cnee, 'FROM BACKEND');
  check('C4 記住原始值（改回原值時移除覆寫）', std[0]._orig,
    { mawb: '157-12345678', dest: 'HKG', flight: 'CX0450' });
  const cneeReq = JSON.parse(apiCalls[0].body);
  check('C5 /cnee-preview 帶 fieldOverrides', cneeReq.defs[0].fieldOverrides,
    { '157-12345678': { mawb: '999-88887777', dest: 'LAX', flight: 'CX0999' } });

  run(`xlsState.cneeOverrides = { 0: { '157-12345678': 'MANUAL CNEE' } }; xlsState.files[0]._stdCache = null;`);
  await sandbox.xlsEnsureStandardized(0);
  check('C6 CNEE 手動補值以原 MAWB 對應', readState('xlsState.files[0]._stdCache.standardized[0].cnee'), 'MANUAL CNEE');

  // ---------- D. 渲染：只有三個欄位可雙擊修改 ----------
  console.log('\nD. 渲染（雙擊編輯範圍）');
  sandbox.xlsRenderStandardized(0);
  const html = panel.innerHTML;
  check('D1 MAWB# 可雙擊編輯', html.includes("xlsEditStandardField(event, 0, '157-12345678', 'mawb')"), true);
  check('D2 DEST 可雙擊編輯', html.includes("xlsEditStandardField(event, 0, '157-12345678', 'dest')"), true);
  check('D3 航班號可雙擊編輯', html.includes("xlsEditStandardField(event, 0, '157-12345678', 'flight')"), true);
  check('D4 其他欄位（件數）不可編輯', [
    html.includes("xlsEditStandardField(event, 0, '157-12345678', 'pcs')"),
    (html.match(/xlsEditStandardField\(/g) || []).length,
  ], [false, 6]); // 2 列 × 3 個可編輯欄位
  check('D5 面板有雙擊說明', html.includes('雙擊'), true);


  // ---------- E. 套用修改 ----------
  console.log('\nE. 套用修改（xlsApplyStandardFieldEdit）');
  const rec = () => run('xlsState.files[0]._stdCache.standardized[0]');
  const ovBag = () => readState('xlsState.fieldOverrides[0] || {}');
  check('E1 起始覆寫', ovBag(),
    { '157-12345678': { mawb: '999-88887777', dest: 'LAX', flight: 'CX0999' } });

  check('E2 改 DEST（小寫轉大寫）', sandbox.xlsApplyStandardFieldEdit(0, rec(), 'dest', 'nrt'), true);
  check('E3 DEST 覆寫已更新', ovBag()['157-12345678'].dest, 'NRT');
  check('E4 改回原值 → 移除該欄覆寫', (() => {
    const changed = sandbox.xlsApplyStandardFieldEdit(0, rec(), 'dest', 'hkg');
    return [changed, ovBag()['157-12345678'].dest === undefined];
  })(), [true, true]);
  check('E5 MAWB 非法值不改', (() => {
    const changed = sandbox.xlsApplyStandardFieldEdit(0, rec(), 'mawb', 'ABC');
    return [changed, ovBag()['157-12345678'].mawb, rec().mawb];
  })(), [false, '999-88887777', '999-88887777']);
  check('E6 改回原 MAWB → 移除覆寫', (() => {
    const changed = sandbox.xlsApplyStandardFieldEdit(0, rec(), 'mawb', '15712345678');
    return [changed, ovBag()['157-12345678'].mawb === undefined, rec().mawb];
  })(), [true, true, '157-12345678']);
  check('E7 清空航班號 → 還原原值並移除覆寫', (() => {
    const changed = sandbox.xlsApplyStandardFieldEdit(0, rec(), 'flight', '   ');
    return [changed, ovBag()['157-12345678'] === undefined, rec().flight];
  })(), [true, true, 'CX0450']);

  // ---------- F. 雙擊 input 的 Enter／Esc ----------
  console.log('\nF. 雙擊 input（Enter 儲存／Esc 取消）');
  const one = makeCell();
  sandbox.xlsEditStandardField({ currentTarget: one.cell }, 0, '157-12345678', 'flight');
  check('F1 格子換成 input 並帶入目前值', [one.cell.innerHTML.includes('xls-std-input'), one.input.value], [true, 'CX0450']);
  one.input.value = 'cx9999';
  one.input.trigger('keydown', { key: 'Enter', preventDefault() {} });
  check('F2 Enter → 寫入覆寫並更新畫面', [ovBag()['157-12345678'].flight, panel.innerHTML.includes('CX9999')], ['CX9999', true]);

  const two = makeCell();
  sandbox.xlsEditStandardField({ currentTarget: two.cell }, 0, '157-12345678', 'mawb');
  two.input.value = '111-22223333';
  two.input.trigger('keydown', { key: 'Escape', preventDefault() {} });
  check('F3 Esc → 不修改、還原顯示', [ovBag()['157-12345678'].mawb === undefined, rec().mawb], [true, '157-12345678']);

  run(`xlsState.fieldOverrides = { 0: { '157-12345678': { mawb: '999-88887777' } } };`);
  const three = makeCell();
  sandbox.xlsEditStandardField({ currentTarget: three.cell }, 0, '157-12345678', 'mawb');
  three.input.value = '111-22223333';
  const htmlAfterFirst = three.cell.innerHTML;
  sandbox.xlsEditStandardField({ currentTarget: three.cell }, 0, '157-12345678', 'mawb');
  check('F4 已在編輯中不重複建立 input', [
    three.cell.innerHTML === htmlAfterFirst,
    three.input.value,
  ], [true, '111-22223333']);

  console.log(`\n===== ${fail === 0 ? `全部通過（${pass} 項）` : `${fail} 項失敗（通過 ${pass} 項）`} =====`);
  if (fail > 0) process.exit(1);
})();

