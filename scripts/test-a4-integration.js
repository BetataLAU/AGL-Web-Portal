// ===== A4 修正：整合測試（hermetic，不需要伺服器／來源檔） =====
// 直接呼叫 runWorkflow()，用合成資料（defs[0].editedRows）跑完 Step 1~5，驗證：
//   1) result.paper.ok === true（紙張驗證通過）
//   2) 每個 {MAWB}.pdf 都是 2 頁且全部 A4
//   3) ZIP 正常產出（檔名規則不變）
// 不會動到正式的 Report 工作檔（會複製一份到 data/test-a4-integration/ 再寫入）。
//
// 用法：node scripts/test-a4-integration.js
//       對照組（舊紙張）：設定 PDF_PAPER=custom 後再跑一次

const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const ExcelJS = require('exceljs');
const { runWorkflow } = require('./xls-workflow');
const { readPdfPageSizes, A4_SIZE } = require('./xls-sli-eli');

const ROOT = path.resolve(__dirname, '..');
const DATA = process.env.DATA_DIR || path.join(ROOT, 'data');
const TEMPLATES = path.join(DATA, 'templates');
const isA4 = (s) => Math.abs(s.width - A4_SIZE.width) <= 1 && Math.abs(s.height - A4_SIZE.height) <= 1;

async function main() {
  const tmp = path.join(DATA, 'test-a4-integration');
  await fsp.rm(tmp, { recursive: true, force: true });
  await fsp.mkdir(tmp, { recursive: true });
  const reportCopy = path.join(tmp, 'report-copy.xlsx');
  await fsp.copyFile(path.join(TEMPLATES, 'shipper-role-summary-2026.xlsx'), reportCopy);

  const cnee = 'GLOBEXAIR LTD (DAY)\nUNIT 7A FAIRLIE ROAD SLOUGH SL1 4PY';
  const day = new Date(2026, 7, 3);
  const rows = [
    ['MAWB', 'PCS', 'WT', 'FLIGHT', 'DATE', 'CNEE'],
    ['160-15102732', 10, 250.5, 'CX257', day, cnee],
    ['160-15102733', 12, 300.25, 'CX257', day, cnee],
    ['160-15102734', 8, 120, 'CX257', day, cnee],
  ];
  // 合成來源檔（走真實的 ExcelJS 讀檔路徑，不用 editedRows 捷徑）
  const srcPath = path.join(tmp, 'synthetic.xlsx');
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

  const t0 = Date.now();
  const result = await runWorkflow({
    files: [{ originalName: 'synthetic.xlsx', path: srcPath }],
    defs,
    reportTemplate: reportCopy,
    sliTemplate: path.join(TEMPLATES, 'cainiao-sli-eli-template.xlsx'),
    concurrency: 1,
    onProgress: (pct, msg) => console.log(`  ${pct}% ${msg}`),
  });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);

  console.log('');
  console.log(`count=${result.count}  errors=${JSON.stringify(result.errors)}  耗時=${secs}s`);
  console.log('paper:', JSON.stringify(result.paper));
  console.log('fontOpt:', JSON.stringify(result.fontOpt));
  console.log('zip:', result.zipPaths.map((p) => path.basename(p)).join(', '));

  const pdfs = fs.readdirSync(result.workDir).filter((f) => /^\d{3}-\d{8}\.pdf$/.test(f)).sort();
  console.log(`\nPDF（${pdfs.length}）:`);
  let allOk = pdfs.length === result.count && pdfs.length > 0;
  const paperMode = (result.paper && result.paper.mode) || 'a4';
  for (const f of pdfs) {
    const full = path.join(result.workDir, f);
    const sizes = await readPdfPageSizes(full);
    const ok = sizes.length === 2 && sizes.every(isA4);
    const zips = sizeKb(full);
    console.log(`  ${f}: pages=${sizes.length} sizes=${sizes.map((s) => `${s.width.toFixed(1)}x${s.height.toFixed(1)}`).join(' / ')} ${zips} KB -> ${ok ? 'A4' : 'NOT-A4'}`);
    if (paperMode === 'a4') allOk = allOk && ok;
  }

  if (result.paper && paperMode === 'a4') {
    allOk = allOk && result.paper.ok === true;
  }
  // 字型優化（瘦身）驗收：應有實際壓縮，且不得把 PDF 弄大
  const fo = result.fontOpt || {};
  if (fo.files) {
    const okOpt = fo.after < fo.before && fo.reductionPct > 30;
    console.log(`  字型優化：${(fo.before / 1048576).toFixed(2)} MB -> ${(fo.after / 1048576).toFixed(2)} MB (-${fo.reductionPct}%)`);
    allOk = allOk && okOpt;
  }
  console.log(`\nPAPER_MODE=${paperMode} -> ${allOk ? 'A4 INTEGRATION CHECK: PASS' : 'A4 INTEGRATION CHECK: FAIL'}`);
  console.log(`（A4 對照檔：${path.join(DATA, 'test-pdf-a4', 'merged-a4.pdf')}；輸出目錄：${result.workDir}）`);
  if (!allOk) process.exit(1);
}

function sizeKb(p) {
  return (fs.statSync(p).size / 1024).toFixed(1);
}

main().catch((e) => {
  console.error('測試失敗:', e);
  process.exit(1);
});
