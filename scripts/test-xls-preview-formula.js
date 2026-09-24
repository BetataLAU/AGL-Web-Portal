// ===== Shipper Role Project - 公式／複合儲存格預覽測試 =====
// 情境：來源檔的欄位是公式（如 VLOOKUP 參照外部活頁簿 [配对表（更新）.xlsx]），
//       ②「預覽與定義欄位」必須顯示 Excel 快取的計算結果（例如航班號 TK0171），
//       而不是 "[object Object]"，且 ③ 標準化仍能讀到同樣的值。
// 驗證：後端 sheetPreview()／resolveCellValue()、前端 xlsCellDisplay()、standardizeRows()
// 啟動方式：node scripts/test-xls-preview-formula.js（不需伺服器）
const fs = require('fs');
const os = require('os');
const path = require('path');
const ExcelJS = require('exceljs');

const { sheetPreview } = require('../routes/xls-booking-helpers');
const { standardizeRows, FIELD_TYPES } = require('./xls-workflow');
const { resolveCellValue } = require('./xls-utils');

let pass = 0;
let fail = 0;
function check(name, actual, expected) {
  const ok = actual === expected;
  if (ok) pass++; else fail++;
  console.log(`  ${ok ? '✅' : '❌'} ${name}：${JSON.stringify(actual)}${ok ? '' : `（預期 ${JSON.stringify(expected)}）`}`);
}

// 從 public/js/xls-booking-state.js 取出前端實際使用的 xlsCellDisplay() / xlsDateDisplay()（瀏覽器全域函式）
function loadFrontendCellDisplay() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'xls-booking-state.js'), 'utf8');
  const extract = (name) => {
    const re = new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`);
    const m = src.match(re);
    if (!m) throw new Error(`找不到 ${name}()`);
    return m[0];
  };
  return new Function(`${extract('xlsDateDisplay')}\n${extract('xlsCellDisplay')}\nreturn xlsCellDisplay;`)();
}

// 產生測試來源檔：模擬「外部連結 VLOOKUP」的公式格 + 各種複合值
async function buildFixture(filePath) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  ws.getCell('A1').value = 'MAWB#';
  ws.getCell('B1').value = '航班號';
  ws.getCell('C1').value = '備註';
  ws.getCell('D1').value = '連結';
  ws.getCell('E1').value = '日期';

  // 第 2 列：公式 + Excel 快取的計算結果（＝本案 TK0171）
  ws.getCell('A2').value = '157-12345678';
  ws.getCell('B2').value = { formula: 'VLOOKUP($A2,[1]Sheet1!$B:$AJ,29,FALSE)', result: 'TK0171' };
  ws.getCell('C2').value = { richText: [{ text: '需' }, { text: '冷藏' }] };
  ws.getCell('D2').value = { text: 'TK 官網', hyperlink: 'https://example.com/tk' };
  ws.getCell('E2').value = new Date(2026, 8, 24); // 2026-09-24（本地時間）

  // 第 3 列：有公式但 Excel 沒快取結果（外部連結未更新且原值空白）→ 應為空字串
  ws.getCell('A3').value = '157-87654321';
  ws.getCell('B3').value = { formula: 'VLOOKUP($A3,[1]Sheet1!$B:$AJ,29,FALSE)' };

  // 第 4 列：公式結果為錯誤值；另放純日期與日期時間格（驗證不會因時區少一天）
  ws.getCell('A4').value = '157-11112222';
  ws.getCell('B4').value = { formula: '1/0', result: { error: '#DIV/0!' } };
  ws.getCell('E3').value = new Date(2026, 8, 24, 14, 11); // 2026-09-24 14:11（本地時間）

  await wb.xlsx.writeFile(filePath);
}

async function main() {
  const fixture = path.join(os.tmpdir(), `xls-preview-formula-${Date.now()}.xlsx`);
  await buildFixture(fixture);
  console.log(`\n=== 測試檔：${fixture} ===`);

  // 1) 後端預覽：模擬 /api/xls-booking/preview 的輸出
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(fixture);
  const rows = sheetPreview(wb.worksheets[0]);

  console.log('\n=== 1. 後端 sheetPreview（② 預覽資料） ===');
  check('B2 公式快取結果（航班號）', rows[1][1], 'TK0171');
  check('C2 富文字', rows[1][2], '需冷藏');
  check('D2 超連結文字', rows[1][3], 'TK 官網');
  check('B3 公式無快取結果 → 空白', rows[2][1], '');
  check('B4 公式錯誤值', rows[3][1], '#DIV/0!');
  const objectCells = rows.flat().filter((v) => v !== null && typeof v === 'object');
  check('預覽不含任何物件型儲存格', objectCells.length, 0);
  check('API JSON 不含 [object Object]', JSON.stringify(rows).includes('[object Object]'), false);
  check('E2 純日期（本地時區，不可少一天）', rows[1][4], '2026-09-24');
  check('E3 日期+時間（本地時區）', rows[2][4], '2026-09-24 14:11');

  // 2) 前端顯示函式（實際載入 public/js/xls-booking-state.js 的版本）
  console.log('\n=== 2. 前端 xlsCellDisplay（② 表格顯示） ===');
  const xlsCellDisplay = loadFrontendCellDisplay();
  check('公式物件', xlsCellDisplay({ formula: 'VLOOKUP(...)', result: 'TK071' }), 'TK071');
  check('無快取結果的公式物件', xlsCellDisplay({ formula: 'VLOOKUP(...)' }), '');
  check('sharedFormula 物件', xlsCellDisplay({ sharedFormula: 'B2', result: 'CX257' }), 'CX257');
  check('富文字物件', xlsCellDisplay({ richText: [{ text: 'A' }, { text: 'B' }] }), 'AB');
  check('錯誤值物件', xlsCellDisplay({ error: '#N/A' }), '#N/A');
  check('數字保持原樣', xlsCellDisplay(100), '100');
  check('null', xlsCellDisplay(null), '');
  check('Date 本地日期顯示', xlsCellDisplay(new Date(2026, 8, 24)), '2026-09-24');
  check('Date 本地日期+時間顯示', xlsCellDisplay(new Date(2026, 8, 24, 14, 11)), '2026-09-24 14:11');

  // 3) resolveCellValue（純函式）
  console.log('\n=== 3. resolveCellValue（共用工具） ===');
  check('公式結果保持型別（數字）', resolveCellValue({ formula: 'A', result: 100 }), 100);
  check('公式結果保持型別（字串）', resolveCellValue({ formula: 'A', result: 'TK0171' }), 'TK0171');
  check('無快取結果 → 空白', resolveCellValue({ formula: 'A' }), '');
  check('undefined → 空白', resolveCellValue(undefined), '');
  check('null → 空白', resolveCellValue(null), '');

  // 4) ③ 標準化：公式格仍要讀到航班號
  console.log('\n=== 4. standardizeRows（③ 標準化） ===');
  const recs = standardizeRows(rows, {
    headerRow: 1,
    firstDataRow: 2,
    fieldMap: { 0: FIELD_TYPES.MAWB, 1: FIELD_TYPES.FLIGHT },
  });
  const rec = recs.find((r) => r.mawb === '157-12345678');
  check('公式格 MAWB 列存在', !!rec, true);
  check('航班號取自公式快取結果', rec && rec.flight, 'TK0171');
  check('第二列（無航班號）仍可解析 MAWB', recs.some((r) => r.mawb === '157-87654321'), true);

  fs.unlinkSync(fixture);
  console.log(`\n結果：${pass} 通過 / ${fail} 失敗`);
  if (fail) process.exit(1);
  console.log('✅ 公式儲存格預覽測試完成');
}

main().catch((e) => { console.error('測試失敗:', e); process.exit(1); });
