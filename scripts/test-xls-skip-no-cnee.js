// ===== Shipper Role Project - 缺 CNEE 的 MAWB「不制作」（hermetic 整合測試） =====
// 直接呼叫 runWorkflow()（合成 xlsx，走真實讀檔路徑），驗證：
//   1) 缺 CNEE（空字串／只有空白）的 MAWB 完全不制作：count 不含它、workDir 沒有它的 PDF／xlsx
//   2) Report 不含該 MAWB（整列都不寫入）
//   3) ZIP 份數只算實際產生的（SLI x 2.zip）
//   4) warnings / skippedNoCnee 回報被跳過的筆數；fileResults 帶 skipped
//   5) 重覆 MAWB 仍以「勾選到的全部列」偵測（即使其中一列因缺 CNEE 被跳過）
// 用法：node scripts/test-xls-skip-no-cnee.js（不需伺服器；PDF 走 overlay 引擎）
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const ExcelJS = require('exceljs');
const { runWorkflow, dedupeRecordsByMawb } = require('./xls-workflow');

const ROOT = path.resolve(__dirname, '..');
const DATA = process.env.DATA_DIR || path.join(ROOT, 'data');
const TEMPLATES = path.join(DATA, 'templates');

let pass = 0;
let fail = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) pass++; else fail++;
  console.log(`  ${ok ? '✅' : '❌'} ${name}：${JSON.stringify(actual)}${ok ? '' : `（預期 ${JSON.stringify(expected)}）`}`);
}

// 把 xlsx 全部儲存格的文字串起來（用來確認 Report 有沒有寫入某個 MAWB）
async function workbookText(file) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const parts = [];
  wb.eachSheet((ws) => {
    ws.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        const v = cell.value;
        if (v == null) return;
        if (v instanceof Date) { parts.push(v.toISOString()); return; }
        if (typeof v === 'object') {
          if (Array.isArray(v.richText)) parts.push(v.richText.map((t) => t.text || '').join(''));
          else if (v.result !== undefined && v.result !== null) parts.push(String(v.result));
          return;
        }
        parts.push(String(v));
      });
    });
  });
  return parts.join('\n');
}

(async () => {
  console.log('===== 缺 CNEE 的 MAWB：不制作（Report／SLI／ELI／ZIP 全排除） =====\n');

  // ---------- A. 純函式：同一 MAWB 只保留 1 筆（優先完整度） ----------
  console.log('A. dedupeRecordsByMawb（同 MAWB 只留 1 筆）');
  const day0 = new Date(2026, 7, 3);
  const dd = dedupeRecordsByMawb([
    { mawb: '160-15102804', cnee: '', flight: 'CX257', flightDate: day0 },  // 缺 CNEE（實際流程會先被跳過）
    { mawb: '16015102804', cnee: 'ACME', flight: '', flightDate: null },     // 同 MAWB（格式不同）→ 有 CNEE 較完整
    { mawb: '160-15102805', cnee: 'GLOBEX', flight: 'CX257', flightDate: day0 },
  ]);
  check('A1 同 MAWB（含格式差異）只保留一筆', dd.records.map((r) => r.cnee), ['ACME', 'GLOBEX']);
  check('A2 保留完整度較高者（有 CNEE 優先）', dd.records[0].cnee, 'ACME');
  check('A3 dropped 回報被丟棄的筆數', dd.dropped.length, 1);

  const tmp = path.join(DATA, 'test-xls-skip-no-cnee');
  await fsp.rm(tmp, { recursive: true, force: true });
  await fsp.mkdir(tmp, { recursive: true });
  const reportCopy = path.join(tmp, 'report-copy.xlsx');
  await fsp.copyFile(path.join(TEMPLATES, 'shipper-role-summary-2026.xlsx'), reportCopy);

  const cnee = 'GLOBEXAIR LTD (DAY)\nUNIT 7A FAIRLIE ROAD SLOUGH SL1 4PY';
  const day = new Date(2026, 7, 3);
  const rows = [
    ['MAWB', 'PCS', 'WT', 'FLIGHT', 'DATE', 'CNEE'],
    ['160-15102801', 10, 250.5, 'CX257', day, cnee],                       // ✅ 有 CNEE → 制作
    ['160-15102802', 12, 300.25, 'CX257', day, ''],                        // ❌ 缺 CNEE → 跳過
    ['160-15102802', 8, 120, 'CX257', day, 'ACME LOGISTICS CO., LTD.'],    // ✅ 同 MAWB 有 CNEE → 制作
    ['160-15102803', 5, 90, 'CX257', day, '   '],                          // ❌ 只有空白 → 跳過
    // 模擬實際案例（157-36504591）：同 MAWB 一列完整、一列只有 MAWB+CNEE（無航班／日期）
    ['160-15102804', 9, 100, 'CX257', day, 'FULL DATA CNEE CO.'],          // ✅ 完整 → 保留
    ['160-15102804', null, null, '', null, 'FULL DATA CNEE CO.'],          // ⚠️ 同 MAWB 不完整 → dedupe 丟棄
  ];
  const srcPath = path.join(tmp, 'synthetic-no-cnee.xlsx');
  const srcWb = new ExcelJS.Workbook();
  const srcWs = srcWb.addWorksheet('配舱计划');
  rows.forEach((r) => srcWs.addRow(r));
  await srcWb.xlsx.writeFile(srcPath);

  const defs = [{
    fileIndex: 0,
    sheetIndex: 0,
    headerRow: 1,
    firstDataRow: 2,
    fieldMap: { 0: 'mawb', 1: 'pcs', 2: 'weight', 3: 'flight', 4: 'flight_date', 5: 'cnee_name' },
  }];

  const result = await runWorkflow({
    files: [{ originalName: 'synthetic-no-cnee.xlsx', path: srcPath }],
    defs,
    reportTemplate: reportCopy,
    sliTemplate: path.join(TEMPLATES, 'cainiao-sli-eli-template.xlsx'),
    concurrency: 1,
    pdfEngine: 'overlay',
  });

  const warnMawbs = (result.warnings || []).map((w) => w.mawb).sort();
  check('1. 只產生 3 份（2 列缺 CNEE 跳過＋1 列重覆 MAWB 去重）', result.count, 3);
  check('2. warnings 列出被跳過的 2 筆', warnMawbs, ['160-15102802', '160-15102803']);
  check('3. skippedNoCnee／deduped 回報筆數', [result.skippedNoCnee, result.deduped], [2, 1]);
  check('4. fileResults 記錄實際製作／跳過／去重筆數',
    result.results, [{ file: 'synthetic-no-cnee.xlsx', records: 3, skipped: 2, deduped: 1 }]);

  const produced = fs.readdirSync(result.workDir).filter((f) => /^\d{3}-\d{8}\.pdf$/.test(f)).sort();
  check('5. workDir 只有實際製作的 PDF（同 MAWB 只有一份）', produced, ['160-15102801.pdf', '160-15102802.pdf', '160-15102804.pdf']);
  check('6. 缺 CNEE 的 MAWB 沒有任何殘留檔',
    fs.readdirSync(result.workDir).filter((f) => f.startsWith('160-15102803')), []);

  check('7. ZIP 份數只算實際產生的', result.zipPaths.map((p) => path.basename(p)), ['20260803 - CX257 SLI x 3.zip']);

  const reportText = await workbookText(reportCopy);
  check('8. Report 有寫入製作的 MAWB', [
    reportText.includes('160-15102801'),
    reportText.includes('160-15102802'),
    reportText.includes('160-15102804'),
  ], [true, true, true]);
  check('9. Report 完全沒有缺 CNEE 的 MAWB', reportText.includes('160-15102803'), false);

  check('10. 重覆 MAWB 仍以勾選到的全部列偵測（含被跳過的那列）',
    (result.duplicates || []).map((d) => ({ mawb: d.mawb, count: d.count })),
    [{ mawb: '160-15102802', count: 2 }, { mawb: '160-15102804', count: 2 }]);
  check('11. 沒有因缺 CNEE 產生錯誤訊息',
    (result.errors || []).filter((e) => e.includes('CNEE')), []);

  // ---------- C. 前端文案（避免又改回「照常產生、CNEE 留空」） ----------
  const wfSrc = fs.readFileSync(path.join(ROOT, 'public', 'js', 'xls-booking-workflow.js'), 'utf8');
  const stdSrc = fs.readFileSync(path.join(ROOT, 'public', 'js', 'xls-booking-standard.js'), 'utf8');
  const routeSrc = fs.readFileSync(path.join(ROOT, 'routes', 'xls-booking.js'), 'utf8');
  check('12. ④ 警告文案＝已跳過、不會產生', wfSrc.includes('已跳過、不會產生'), true);
  check('13. ④ 檔名列表顯示略過筆數', wfSrc.includes('缺 CNEE 略過 ${r.skipped} 筆'), true);
  check('14. ③ 標示執行時不會製作', stdSrc.includes('執行時<b>不會製作</b>'), true);
  check('15. 路由回傳 skippedNoCnee', routeSrc.includes('skippedNoCnee: result.skippedNoCnee'), true);
  check('16. ④ 重覆警告文案＝每張 MAWB 只留 1 筆制作', wfSrc.includes('每張 MAWB 只保留 1 筆制作'), true);
  check('17. 路由回傳 deduped', routeSrc.includes('deduped: result.deduped'), true);

  console.log(`\n===== ${fail === 0 ? `全部通過（${pass} 項）` : `${fail} 項失敗（通過 ${pass} 項）`} =====`);
  console.log(`輸出目錄：${result.workDir}`);
  if (fail > 0) process.exit(1);
})().catch((e) => {
  console.error('測試失敗:', e);
  process.exit(1);
});
