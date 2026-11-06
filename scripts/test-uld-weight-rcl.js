// ===== ULD 夾重系統：RCL 磅單解析測試（W3）=====
// 驗證 public/js/uldweight/rcl-parse.js（前後端共用的純函式）：
//   表頭偵測、欄位對應（HACTL／AAT／CPSL 常見寫法）、數字清理、略過規則、重複偵測
// 用法：node scripts/test-uld-weight-rcl.js
// 註：出現 MODULE_TYPELESS_PACKAGE_JSON 警告為正常現象（專案 package.json 不是 ESM）。
const path = require('path');
const { pathToFileURL } = require('url');

const RCL_URL = pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'uldweight', 'rcl-parse.js')).href;

let passCount = 0;
let failCount = 0;

function check(name, ok, extra = '') {
  if (ok) passCount += 1; else failCount += 1;
  console.log(`${ok ? '✅' : '❌'} ${name}${extra ? ' ' + extra : ''}`);
}

(async () => {
  console.log('===== ULD 夾重系統：RCL 磅單解析測試 =====\n');
  const rcl = await import(RCL_URL);

  // ===== 1. 數字與文字清理 =====
  console.log('--- 1. 數字／文字清理 ---');
  check('1.1 "1,234.5" → 1234.5', rcl.rclNumber('1,234.5') === 1234.5, String(rcl.rclNumber('1,234.5')));
  check('1.2 "540 KG" → 540', rcl.rclNumber('540 KG') === 540);
  check('1.3 " 1 234 " → 1234', rcl.rclNumber(' 1 234 ') === 1234);
  check('1.4 空字串／null → 0', rcl.rclNumber('') === 0 && rcl.rclNumber(null) === 0);
  check('1.5 數字型別原樣回傳', rcl.rclNumber(115.5) === 115.5);
  check('1.6 文字去不斷行空白', rcl.rclText('  PMC\u00a0123  ') === 'PMC 123');

  // ===== 2. 欄位偵測（三個貨站常見寫法）=====
  console.log('\n--- 2. 欄位偵測 ---');
  const hactl = rcl.rclDetectColumns(['ULD No', 'Tare', 'Gross Weight', 'Pcs']);
  check('2.1 HACTL 寫法（ULD No／Tare／Gross Weight／Pcs）',
    hactl.uld === 0 && hactl.tare === 1 && hactl.gross === 2 && hactl.pcs === 3, JSON.stringify(hactl));

  const aat = rcl.rclDetectColumns(['序號', '板號', '皮重', '毛重', '件數']);
  check('2.2 AAT 中文寫法（板號／皮重／毛重／件數）',
    aat.uld === 1 && aat.tare === 2 && aat.gross === 3 && aat.pcs === 4, JSON.stringify(aat));

  const cpsl = rcl.rclDetectColumns(['Container No', 'Tare Weight', 'Actual Weight', 'Ctns', 'Dest']);
  check('2.3 CPSL 寫法（Container No／Tare Weight／Actual Weight／Ctns）',
    cpsl.uld === 0 && cpsl.tare === 1 && cpsl.gross === 2 && cpsl.pcs === 3, JSON.stringify(cpsl));

  const single = rcl.rclDetectColumns(['ULD', 'Weight']);
  check('2.4 只有一欄 Weight → gross 用它、tare 不使用',
    single.uld === 0 && single.gross === 1 && single.tare === -1, JSON.stringify(single));

  const none = rcl.rclDetectColumns(['A', 'B', 'C']);
  check('2.5 完全看不懂的表頭 → 全部 -1',
    none.uld === -1 && none.gross === -1 && none.tare === -1 && none.pcs === -1, JSON.stringify(none));

  // ===== 3. 表頭列偵測 =====
  console.log('\n--- 3. 表頭列偵測 ---');
  const grid = [
    ['HACTL RCL REPORT'],
    [],
    ['ULD No', 'Tare', 'Gross Weight', 'Pcs'],
    ['PMC0003XX', '115', '540', '8']
  ];
  const found = rcl.rclFindHeaderRow(grid);
  check('3.1 跳過標題列與空列，找到第 3 列當表頭', found.index === 2, String(found.index));
  check('3.2 表頭同時帶回欄位對應', found.columns.uld === 0 && found.columns.gross === 2);
  const noHeader = rcl.rclFindHeaderRow([['A', 'B'], ['1', '2']]);
  check('3.3 找不到表頭 → index = -1', noHeader.index === -1);

  // ===== 4. 資料列解析 =====
  console.log('\n--- 4. 資料列解析 ---');
  const rowsGrid = [
    ['PMC0003XX', '115', '540', '8'],
    ['pmc0004xx', '112', '1,000', '3'],
    ['PMC0003XX', '115', '540', '8'],   // 重複（大小寫不同）
    ['', '0', '0', '0'],                // 空列
    ['PMC0005XX', '0', '0', '2'],       // 沒有磅重
    ['', '50', '600', '1'],             // 沒有 ULD#
    ['PMC0006XX', '200', '150', '4']    // 磅重 < Tare
  ];
  const parsed = rcl.rclRowsFromGrid(rowsGrid, { uld: 0, tare: 1, gross: 2, pcs: 3 });
  check('4.1 解析出 3 筆可建立單位（重複／空／無磅重／無 ULD 都被略過）',
    parsed.rows.length === 3, String(parsed.rows.length));
  check('4.2 第一筆 ULD#／Tare／Gross／件數正確',
    parsed.rows[0].uld_number === 'PMC0003XX' && parsed.rows[0].tare_weight === 115 &&
    parsed.rows[0].rcl_gross_weight === 540 && parsed.rows[0].pcs === 8,
    JSON.stringify(parsed.rows[0]));
  check('4.3 ULD# 轉大寫、磅重去掉千分位',
    parsed.rows[1].uld_number === 'PMC0004XX' && parsed.rows[1].rcl_gross_weight === 1000,
    JSON.stringify(parsed.rows[1]));
  check('4.4 重複 ULD → skipped(duplicate) 且指出第一筆列號',
    parsed.skipped.some(s => s.reason === 'duplicate' && s.uld_number === 'PMC0003XX' && s.first_row === 1),
    JSON.stringify(parsed.skipped));
  check('4.5 沒有磅重 → skipped(no_gross)',
    parsed.skipped.some(s => s.reason === 'no_gross' && s.uld_number === 'PMC0005XX'));
  check('4.6 沒有 ULD# → skipped(no_uld)', parsed.skipped.some(s => s.reason === 'no_uld'));
  check('4.7 磅重 < Tare → 保留但帶警告 gross_lt_tare',
    parsed.rows[2].warnings.includes('gross_lt_tare'), JSON.stringify(parsed.rows[2].warnings));
  check('4.8 沒有件數欄時 pcs = 0',
    rcl.rclRowsFromGrid([['PMC1', '100', '500']], { uld: 0, tare: 1, gross: 2, pcs: -1 }).rows[0].pcs === 0);
  check('4.9 沒有 Tare 欄時 tare = 0',
    rcl.rclRowsFromGrid([['PMC1', '500', '5']], { uld: 0, tare: -1, gross: 1, pcs: 2 }).rows[0].tare_weight === 0);
  check('4.10 沒有 ULD 欄 → skipped(no_uld_column) 且沒有資料',
    rcl.rclRowsFromGrid([['PMC1']], { uld: -1, gross: 1 }).rows.length === 0 &&
    rcl.rclRowsFromGrid([['PMC1']], { uld: -1, gross: 1 }).skipped[0].reason === 'no_uld_column');

  const limited = rcl.rclRowsFromGrid([
    ['PMC1', '500'], ['PMC2', '600'], ['PMC3', '700']
  ], { uld: 0, gross: 1 }, { limit: 2 });
  check('4.11 超過上限（limit=2）→ 第 3 筆 skipped(limit)',
    limited.rows.length === 2 && limited.skipped.some(s => s.reason === 'limit'),
    JSON.stringify(limited.skipped));

  // ===== 5. 其他輔助 =====
  console.log('\n--- 5. 其他輔助 ---');
  const options = rcl.rclColumnOptions(['ULD No', '', 'Gross Weight']);
  check('5.1 欄位選項：空表頭給「第 N 欄」',
    options.length === 3 && options[1].label === '第 2 欄', JSON.stringify(options));
  check('5.2 略過原因與警告都有中文說明',
    rcl.rclSkipReasonText('duplicate').includes('重複') && rcl.rclWarningText('gross_lt_tare').includes('Tare'));
  check('5.3 欄位定義 4 個（ULD／Tare／Gross／件數）', rcl.RCL_COLUMNS.length === 4);

  console.log(`\n===== ${failCount === 0 ? '全部通過' : failCount + ' 項失敗'}（PASS ${passCount} / FAIL ${failCount}）=====`);
  process.exitCode = failCount === 0 ? 0 : 1;
})();
