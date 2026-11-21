// ===== 執 PLAN：DIM（L × W × H / PCS）純函式 測試 =====
// 用法：node scripts/test-loading-plan-dim.js
const path = require('path');
const { pathToFileURL } = require('url');

const SRC = pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'loading-plan', 'dim.js')).href;

let pass = 0;
let fail = 0;
function check(name, ok, extra = '') {
  if (ok) pass += 1; else fail += 1;
  console.log(`${ok ? '✅' : '❌'} ${name}${extra ? ' ' + extra : ''}`);
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

(async () => {
  console.log('===== 執 PLAN：DIM 測試 =====\n');
  const {
    LP_DIM_MAX_LEN, LP_DIM_HEADER, LP_DIM_FIELDS,
    lpFormatDimNumber, lpDimLine, lpNormalizeDimRows, lpAppendDim,
    lpIsDimLine, lpIsDimHeaderLine
  } = await import(SRC);

  // ---- 數字格式 ----
  check('1.1 60 → 60（整數不帶小數）', lpFormatDimNumber(60) === '60', lpFormatDimNumber(60));
  check('1.2 60.500 → 60.5（去尾 0）', lpFormatDimNumber('60.500') === '60.5', lpFormatDimNumber('60.500'));
  check('1.3 60.000 → 60', lpFormatDimNumber(60.000) === '60', lpFormatDimNumber(60.000));
  check('1.4 空字串 → 空（不是 0）', lpFormatDimNumber('') === '', lpFormatDimNumber(''));
  check('1.5 null／undefined → 空', lpFormatDimNumber(null) === '' && lpFormatDimNumber(undefined) === '');
  check('1.6 非數字 → 空', lpFormatDimNumber('abc') === '', lpFormatDimNumber('abc'));
  check('1.7 四捨五入到小數 3 位', lpFormatDimNumber(1.23456) === '1.235', lpFormatDimNumber(1.23456));

  // ---- 單行格式 ----
  check('2.1 一組 DIM 格式 L x W x H / PCS',
    lpDimLine({ length: 60, width: 40, height: 50, pcs: 10 }) === '60 x 40 x 50 / 10',
    lpDimLine({ length: 60, width: 40, height: 50, pcs: 10 }));
  check('2.2 小數尺寸保留（60.5 x 40 x 50.25 / 3）',
    lpDimLine({ length: 60.5, width: 40, height: 50.25, pcs: 3 }) === '60.5 x 40 x 50.25 / 3',
    lpDimLine({ length: 60.5, width: 40, height: 50.25, pcs: 3 }));
  check('2.3 缺欄位不會爆（空字串）',
    lpDimLine({}) === ' x  x  / ', JSON.stringify(lpDimLine({})));

  // ---- 驗證 ----
  const two = lpNormalizeDimRows([
    { length: '60', width: '40', height: '50', pcs: '10' },
    { length: 30, width: 20, height: 10, pcs: 5 }
  ]);
  check('3.1 兩組合法的 DIM → 2 行、無錯誤',
    two.error === null && eq(two.lines, ['60 x 40 x 50 / 10', '30 x 20 x 10 / 5']),
    JSON.stringify(two));
  const withEmpty = lpNormalizeDimRows([
    { length: '', width: '', height: '', pcs: '' },
    { length: '10', width: '10', height: '10', pcs: '1' }
  ]);
  check('3.2 整列空白 → 自動略過', withEmpty.error === null && withEmpty.lines.length === 1,
    JSON.stringify(withEmpty));
  const incomplete = lpNormalizeDimRows([{ length: '60', width: '', height: '50', pcs: '10' }]);
  check('3.3 缺 W → incomplete（指出欄位與列號）',
    incomplete.error && incomplete.error.code === 'incomplete' &&
    incomplete.error.field === 'width' && incomplete.error.rowIndex === 0,
    JSON.stringify(incomplete.error));
  check('3.4 尺寸 0 → size 錯誤',
    lpNormalizeDimRows([{ length: '0', width: '10', height: '10', pcs: '1' }]).error.code === 'size');
  check('3.5 尺寸負數 → size 錯誤',
    lpNormalizeDimRows([{ length: '-5', width: '10', height: '10', pcs: '1' }]).error.code === 'size');
  check('3.6 尺寸非數字 → size 錯誤',
    lpNormalizeDimRows([{ length: 'abc', width: '10', height: '10', pcs: '1' }]).error.code === 'size');
  check('3.7 PCS 小數 → pcs 錯誤',
    lpNormalizeDimRows([{ length: '10', width: '10', height: '10', pcs: '1.5' }]).error.code === 'pcs');
  check('3.8 PCS 0 → pcs 錯誤',
    lpNormalizeDimRows([{ length: '10', width: '10', height: '10', pcs: '0' }]).error.code === 'pcs');
  check('3.9 前面合法、後面錯誤 → 回報錯誤那一列',
    (() => {
      const r = lpNormalizeDimRows([
        { length: '10', width: '10', height: '10', pcs: '1' },
        { length: '10', width: '10', height: '', pcs: '1' }
      ]);
      return r.error && r.error.rowIndex === 1 && r.lines.length === 1;
    })());
  check('3.10 空陣列／非陣列 → 不丟錯',
    lpNormalizeDimRows([]).lines.length === 0 && lpNormalizeDimRows(null).error === null);

  // ---- 附加到 REMARK（DIM 上一行固定 DIM(CM):）----
  check('4.1 原本空白 → 自動加 DIM(CM): 標題',
    lpAppendDim('', ['60 x 40 x 50 / 10']).text === 'DIM(CM):\n60 x 40 x 50 / 10',
    JSON.stringify(lpAppendDim('', ['60 x 40 x 50 / 10']).text));
  check('4.2 保留原本文字（標題在 DIM 上一行）',
    lpAppendDim('4 / D6', ['60 x 40 x 50 / 10']).text === '4 / D6\nDIM(CM):\n60 x 40 x 50 / 10',
    JSON.stringify(lpAppendDim('4 / D6', ['60 x 40 x 50 / 10']).text));
  check('4.3 多組 DIM → 一行一組',
    lpAppendDim('', ['a', 'b', 'c']).text === 'DIM(CM):\na\nb\nc');
  check('4.4 空白行忽略', lpAppendDim('x', ['', '  ', 'y']).text === 'x\nDIM(CM):\ny');
  check('4.5 原本內容前後空白會 trim', lpAppendDim('  hi  ', ['y']).text === 'hi\nDIM(CM):\ny');
  check('4.6 超過上限 → overflow（不截斷）',
    lpAppendDim('', ['x'.repeat(LP_DIM_MAX_LEN - 8)]).overflow === true);
  check('4.7 剛好上限 → 不算 overflow',
    lpAppendDim('', ['x'.repeat(LP_DIM_MAX_LEN - 9)]).overflow === false);
  check('4.8 上限可自訂', lpAppendDim('', ['1234'], 13).overflow === false && lpAppendDim('', ['1234'], 12).overflow === true);
  check('4.9 null 既有內容 → 當空白', lpAppendDim(null, ['y']).text === 'DIM(CM):\ny');
  check('4.10 DIM 欄位順序固定',
    eq(LP_DIM_FIELDS, ['length', 'width', 'height', 'pcs']), JSON.stringify(LP_DIM_FIELDS));
  check('4.11 沒有要附加的 DIM → 不亂加標題', lpAppendDim('4 / D6', []).text === '4 / D6');

  // ---- DIM(CM): 標題／區塊 ----
  const once = lpAppendDim('4 / D6', ['60 x 40 x 50 / 10']).text;
  const twice = lpAppendDim(once, ['30 x 20 x 10 / 5']).text;
  check('5.1 標題固定是 DIM(CM):', LP_DIM_HEADER === 'DIM(CM):' && once.split('\n')[1] === 'DIM(CM):');
  check('5.2 重複附加不重複標題', (twice.match(/DIM\(CM\):/g) || []).length === 1, JSON.stringify(twice));
  check('5.3 新 DIM 接在同一區塊最後',
    twice === '4 / D6\nDIM(CM):\n60 x 40 x 50 / 10\n30 x 20 x 10 / 5', JSON.stringify(twice));
  check('5.4 既有其他備註在 DIM 區塊後 → 新 DIM 不會跨過去',
    lpAppendDim('DIM(CM):\n10 x 10 x 10 / 1\n小心易碎', ['20 x 20 x 20 / 2']).text ===
      'DIM(CM):\n10 x 10 x 10 / 1\n20 x 20 x 20 / 2\n小心易碎',
    JSON.stringify(lpAppendDim('DIM(CM):\n10 x 10 x 10 / 1\n小心易碎', ['20 x 20 x 20 / 2']).text));
  check('5.5 標題容忍大小寫／空白／全形冒號',
    lpIsDimHeaderLine('dim (cm)：') && lpIsDimHeaderLine('DIM(CM):') && lpIsDimHeaderLine('Dim ( CM )'));
  check('5.6 舊資料只有 DIM 行、沒有標題 → 自動補在上一行',
    lpAppendDim('4 / D6\n60 x 40 x 50 / 10', ['30 x 20 x 10 / 5']).text ===
      '4 / D6\nDIM(CM):\n60 x 40 x 50 / 10\n30 x 20 x 10 / 5',
    JSON.stringify(lpAppendDim('4 / D6\n60 x 40 x 50 / 10', ['30 x 20 x 10 / 5']).text));
  check('5.7 DIM 行判定（含小數、X 大小寫）',
    lpIsDimLine('60 x 40 x 50 / 10') && lpIsDimLine('60.5 X 40 X 50.25 / 3') && !lpIsDimLine('DIM(CM):'));
  check('5.8 標題單獨存在（還沒有 DIM 行）→ 新 DIM 接在標題後',
    lpAppendDim('DIM(CM):', ['10 x 10 x 10 / 1']).text === 'DIM(CM):\n10 x 10 x 10 / 1');

  console.log(`\n===== 測試結束：${pass} 通過 / ${fail} 失敗 =====`);
  process.exitCode = fail ? 1 : 0;
})().catch((err) => {
  console.error('測試失敗：', err && err.stack ? err.stack : err);
  process.exit(1);
});
