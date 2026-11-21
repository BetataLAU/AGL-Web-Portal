// ===== Shipper Role Project - ③ 標準化預覽「Shift 整段勾選」測試 =====
// 以最小 DOM stub 實際載入 public/js/xls-booking-state.js + xls-booking-standard.js，驗證：
//   A. 渲染：列勾選框改用 onclick（帶 event）＋勾選格 label 有 Shift 攔截；全選仍是 xlsToggleAll
//   B. 一般點擊＝單列切換並記住錨點；Shift+點擊＝錨點到目標「整段」勾選／取消，錨點不變
//   C. 跨檔案不會誤用錨點（fileIndex 不同 → 退回單列切換）
//   D. 點在 checkbox 外的勾選格留白（label）也支援 Shift 整段勾選（且取消 label 轉發，避免切換兩次）
//   E. 全選／全部不選、資料重建後錨點清空
// 啟動方式：node scripts/test-xls-std-range-select.js（不需伺服器、不需瀏覽器）
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const PUBLIC_JS = path.join(__dirname, '..', 'public', 'js');

let pass = 0;
let fail = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) pass++; else fail++;
  console.log(`  ${ok ? '✅' : '❌'} ${name}：${JSON.stringify(actual)}${ok ? '' : `（預期 ${JSON.stringify(expected)}）`}`);
}

console.log('===== ③ 標準化預覽：Shift 整段勾選 =====\n');

// ---------- DOM / 瀏覽器 stub ----------
const panel = {
  innerHTML: '',
  style: {},
  scrollLeft: 0,
  scrollTop: 0,
  querySelector() { return null; },
};

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
  apiFetch: async () => ({ results: [] }),
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(PUBLIC_JS, 'xls-booking-state.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(PUBLIC_JS, 'xls-booking-standard.js'), 'utf8'), sandbox);

const run = (code) => vm.runInContext(code, sandbox);
const readState = (expr) => JSON.parse(vm.runInContext(`JSON.stringify(${expr})`, sandbox));

// ---------- 測試資料：兩個檔案各 5 / 3 列 ----------
const KEYS0 = ['111-11111111', '222-22222222', '333-33333333', '444-44444444', '555-55555555'];
const KEYS1 = ['666-66666666', '777-77777777', '888-88888888'];

function makeCache(keys) {
  return {
    assignedTypes: [{ value: 'mawb', label: 'MAWB#' }, { value: 'dest', label: 'DEST' }],
    standardized: keys.map((k, i) => ({
      mawbKey: k,
      mawb: k,
      dest: 'HKG',
      cnee: `CNEE ${i + 1}`,
      _orig: { mawb: k, dest: 'HKG', flight: '' },
    })),
  };
}

function resetState() {
  run(`
    xlsStdRangeAnchor = null;
    xlsState.files = [
      { id: 'f1', originalName: 'a.xlsx', _stdCache: ${JSON.stringify(makeCache(KEYS0))} },
      { id: 'f2', originalName: 'b.xlsx', _stdCache: ${JSON.stringify(makeCache(KEYS1))} },
    ];
    xlsState.selections = {
      0: { all: ${JSON.stringify(KEYS0)}, selected: new Set(${JSON.stringify(KEYS0)}) },
      1: { all: ${JSON.stringify(KEYS1)}, selected: new Set(${JSON.stringify(KEYS1)}) },
    };
  `);
}
const selectedOf = (fileIndex) => readState(`Array.from(xlsState.selections[${fileIndex}].selected)`).sort();
const sorted = (arr) => [...arr].sort();
const click = (shiftKey, fileIndex, key) => sandbox.xlsToggleRow({ shiftKey }, fileIndex, key);

// ---------- A. 渲染 ----------
console.log('A. 渲染（勾選框改 onclick ＋ 勾選格 Shift 攔截）');
resetState();
sandbox.xlsRenderStandardized(0);
const html = panel.innerHTML;
check('A1 列勾選框 onclick 帶 event',
  html.includes("onclick=\"xlsToggleRow(event, 0, '111-11111111')\""), true);
check('A2 勾選格 label 有 Shift 攔截',
  html.includes("onclick=\"xlsStdCheckCellClick(event, 0, '111-11111111')\""), true);
check('A3 全選 checkbox 仍走 xlsToggleAll',
  [html.includes('onchange="xlsToggleAll(0)"'), html.includes('xls-select-all-0')], [true, true]);
check('A4 面板有 Shift 操作說明', html.includes('按住 <b>Shift</b> 點選勾選框'), true);
check('A5 不再使用 onchange 切換單列', html.includes('onchange="xlsToggleRow'), false);

// ---------- B. Shift 整段勾選 / 取消 ----------
console.log('\nB. Shift 整段勾選／取消（使用者情境：先勾第 1 列 → Shift+勾第 4 列 → 1~4 全勾）');
resetState();
run('xlsState.selections[0].selected = new Set();'); // 從「全部未勾選」開始，貼近使用者情境
click(false, 0, KEYS0[0]);
check('B1 一般點擊＝單列勾選並記住錨點',
  [readState('xlsStdRangeAnchor'), selectedOf(0)],
  [{ fileIndex: 0, mawbKey: KEYS0[0] }, sorted([KEYS0[0]])]);

click(true, 0, KEYS0[3]); // Shift+第 4 列
check('B2 Shift+點擊＝錨點到目標整段勾選（1~4 全勾）',
  [selectedOf(0), readState('xlsStdRangeAnchor')],
  [sorted(KEYS0.slice(0, 4)), { fileIndex: 0, mawbKey: KEYS0[0] }]);

click(true, 0, KEYS0[1]); // Shift+第 2 列（已勾選）→ 1~2 一起取消
check('B3 Shift+點已勾選的列＝整段取消（錨點不變）',
  [selectedOf(0), readState('xlsStdRangeAnchor')],
  [sorted(KEYS0.slice(2, 4)), { fileIndex: 0, mawbKey: KEYS0[0] }]);

click(false, 0, KEYS0[4]); // 一般點第 5 列 → 勾選，錨點移到第 5 列
check('B4 一般點擊＝單列勾選並把錨點移到該列',
  [readState('xlsStdRangeAnchor'), selectedOf(0)],
  [{ fileIndex: 0, mawbKey: KEYS0[4] }, sorted([...KEYS0.slice(2, 4), KEYS0[4]])]);

click(true, 0, KEYS0[1]); // Shift+第 2 列（目標在錨點之前）
check('B5 反向 Shift（目標在錨點之前）也整段勾選',
  [selectedOf(0), readState('xlsStdRangeAnchor')],
  [sorted(KEYS0.slice(1)), { fileIndex: 0, mawbKey: KEYS0[4] }]);

click(true, 0, KEYS0[4]); // Shift+錨點自己 → 單列切換
check('B6 Shift+點錨點自己＝單列切換（不會整段亂跳）',
  [selectedOf(0), readState('xlsStdRangeAnchor')],
  [sorted(KEYS0.slice(1, 4)), { fileIndex: 0, mawbKey: KEYS0[4] }]);

// ---------- C. 跨檔案 ----------
console.log('\nC. 跨檔案不誤用錨點');
resetState();
run('xlsState.selections[0].selected = new Set(); xlsState.selections[1].selected = new Set();');
click(false, 0, KEYS0[0]);            // 錨點在檔案 0
click(true, 1, KEYS1[2]);             // 檔案 1 的 Shift+點擊
check('C1 錨點屬檔案 0 → 檔案 1 只切換被點的列',
  [selectedOf(1), readState('xlsStdRangeAnchor')],
  [sorted([KEYS1[2]]), { fileIndex: 1, mawbKey: KEYS1[2] }]);

// ---------- D. 勾選格留白（label）的 Shift 點擊 ----------
console.log('\nD. 點在 checkbox 外的勾選格留白（label）');
resetState();
run('xlsState.selections[0].selected = new Set();');
click(false, 0, KEYS0[0]);           // 勾第 1 列並記住錨點
let prevented = 0;
const labelEv = (shiftKey, targetType) => ({
  shiftKey,
  target: { type: targetType },
  preventDefault() { prevented += 1; },
});
sandbox.xlsStdCheckCellClick(labelEv(true, undefined), 0, KEYS0[3]);
check('D1 Shift+點 label 留白＝整段勾選並取消 label 轉發',
  [selectedOf(0), prevented], [sorted(KEYS0.slice(0, 4)), 1]);

prevented = 0;
sandbox.xlsStdCheckCellClick(labelEv(false, undefined), 0, KEYS0[0]);
check('D2 一般點 label＝不攔截（交給 checkbox 轉發）', prevented, 0);

prevented = 0;
sandbox.xlsStdCheckCellClick(labelEv(true, 'checkbox'), 0, KEYS0[4]);
check('D3 直接點 checkbox 的事件 bubbling 到 label＝不重複處理', prevented, 0);

resetState();
run('xlsState.selections[0].selected = new Set();');
prevented = 0;
sandbox.xlsStdCheckCellClick(labelEv(true, undefined), 0, KEYS0[3]);
check('D4 沒有錨點時 Shift+點 label＝走預設（不攔截、不整段）',
  [prevented, selectedOf(0)], [0, []]);

resetState();
run('xlsState.selections[0].selected = new Set();');
click(false, 0, KEYS0[0]);
sandbox.xlsToggleRow({ shiftKey: true, currentTarget: { isConnected: false } }, 0, KEYS0[1]);
check('D5 重繪後 label 再轉發到舊 DOM 的 click 被忽略（不會切換兩次）',
  [selectedOf(0), readState('xlsStdRangeAnchor')],
  [sorted([KEYS0[0]]), { fileIndex: 0, mawbKey: KEYS0[0] }]);

// ---------- E. 錨點清空時機 ----------
console.log('\nE. 錨點清空（全選／資料重建）');
resetState();
click(false, 0, KEYS0[0]);   // 取消第 1 列（原本全選）
sandbox.xlsToggleAll(0);     // 不是全勾 → 全部勾選，同時清掉錨點
check('E1 全選／全不選後錨點清空', readState('xlsStdRangeAnchor'), null);
sandbox.xlsToggleAll(0);     // 全部不選
check('E2 第二次全選＝全部不選', selectedOf(0), []);
click(true, 0, KEYS0[3]);
check('E3 錨點清空後 Shift+點＝只切換該列', selectedOf(0), sorted([KEYS0[3]]));

resetState();
click(false, 0, KEYS0[0]);
run(`
  xlsState.uploadId = 'u1';
  xlsState.defs = [{ fileIndex: 0, firstDataRow: 2, sheetIndex: 0, fieldMap: { 0: 'mawb', 1: 'dest' } }];
  xlsState.cneeOverrides = {};
  xlsState.fieldOverrides = {};
  xlsState.files[0].lastPreview = { rows: [['MAWB#', 'DEST'], ${KEYS0.map((k) => `['${k}', 'HKG']`).join(', ')}] };
  xlsState.files[0]._stdCache = null;   // 模擬欄位定義／資料變更後的重新標準化
`);
(async () => {
  await sandbox.xlsEnsureStandardized(0);
  check('E4 資料重新標準化後錨點清空',
    [readState('xlsStdRangeAnchor'), selectedOf(0)], [null, sorted(KEYS0)]);

  console.log(`\n===== ${fail === 0 ? `全部通過（${pass} 項）` : `${fail} 項失敗（通過 ${pass} 項）`} =====`);
  if (fail > 0) process.exit(1);
})();
