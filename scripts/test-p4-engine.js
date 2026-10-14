// ===== Shipper Role Project - P4 引擎分派驗證（overlay / com 混合批次 + 自動退回） =====
// 驗收項目（PRD §P4）：
//   1) 混合批次：同一次執行中，可疊字的記錄用疊字引擎、無法疊字的記錄自動退回 Excel
//      （result.engine = { mode:'overlay', overlay, com, fallbackCount, fallbackReasons, cjkFont }）
//   1b) PDF_CJK=auto（預設）：含中文／全形字元的記錄也能疊字（不必退回 Excel）
//   2) 引擎不可用（背景 PDF／fieldmap 缺失、sha 不符）→ 全部自動退回 Excel 引擎（不中斷、明確回報）
//   3) 兩種情況每份 PDF 仍為 2 頁 A4，且 errors 不得出現非預期訊息
//
// 用法：node scripts/test-p4-engine.js
//   注意：case 1/2 會呼叫 Excel COM（Windows），請勿與其他 xls 測試平行執行。

const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const ExcelJS = require('exceljs');
const { runWorkflow, resolvePdfEngineMode } = require('./xls-workflow');
const { readPdfPageSizes, A4_SIZE } = require('./xls-sli-eli');

const ROOT = path.resolve(__dirname, '..');
const DATA = process.env.DATA_DIR || path.join(ROOT, 'data');
const TEMPLATES = path.join(DATA, 'templates');
const isA4 = (s) => Math.abs(s.width - A4_SIZE.width) <= 1 && Math.abs(s.height - A4_SIZE.height) <= 1;

let failures = 0;
function check(label, ok, detail) {
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

async function buildSynthetic(dirName) {
  const tmp = path.join(DATA, dirName);
  await fsp.rm(tmp, { recursive: true, force: true });
  await fsp.mkdir(tmp, { recursive: true });
  const reportCopy = path.join(tmp, 'report-copy.xlsx');
  await fsp.copyFile(path.join(TEMPLATES, 'shipper-role-summary-2026.xlsx'), reportCopy);

  const day = new Date(2026, 7, 3);
  const rows = [
    ['MAWB', 'PCS', 'WT', 'FLIGHT', 'DATE', 'CNEE'],
    ['160-15102742', 10, 250.5, 'CX257', day, 'GLOBEXAIR LTD (DAY)\nUNIT 7A FAIRLIE ROAD SLOUGH SL1 4PY'],
    ['160-15102743', 12, 300.25, 'CX257', day, '測試客戶有限公司，台北市信義區'], // 非 Latin-1 → 退回 com
    ['160-15102744', 8, 120, 'CX257', day, 'ACME LOGISTICS CO., LTD.'],
  ];
  const srcPath = path.join(tmp, 'synthetic-mixed.xlsx');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('配舱计划');
  rows.forEach((r) => ws.addRow(r));
  await wb.xlsx.writeFile(srcPath);

  return {
    srcPath,
    reportCopy,
    defs: [{
      fileIndex: 0,
      sheetIndex: 0,
      headerRow: 1,
      firstDataRow: 2,
      fieldMap: { 0: 'mawb', 1: 'pcs', 2: 'weight', 3: 'flight', 4: 'flight_date', 5: 'cnee_name' },
    }],
  };
}

async function inspectPdfs(workDir) {
  const pdfs = fs.readdirSync(workDir).filter((f) => /^\d{3}-\d{8}\.pdf$/.test(f)).sort();
  const out = [];
  for (const f of pdfs) {
    const full = path.join(workDir, f);
    const sizes = await readPdfPageSizes(full);
    out.push({ name: f, pages: sizes.length, ok: sizes.length === 2 && sizes.every(isA4), kb: (fs.statSync(full).size / 1024).toFixed(1) });
  }
  return out;
}

async function main() {
  // ---- case 0：引擎選擇解析（純函式，無需 COM）----
  console.log('=== case 0：引擎選擇解析（XLS_PDF_ENGINE）===');
  const saved = process.env.XLS_PDF_ENGINE;
  delete process.env.XLS_PDF_ENGINE;
  check("未設定 → 'com'（＝現況）", resolvePdfEngineMode() === 'com');
  process.env.XLS_PDF_ENGINE = 'overlay';
  check("XLS_PDF_ENGINE=overlay → 'overlay'", resolvePdfEngineMode() === 'overlay');
  process.env.XLS_PDF_ENGINE = 'garbage';
  check("未知值 → 安全回退 'com'", resolvePdfEngineMode() === 'com');
  check('opts.pdfEngine 優先於環境變數', resolvePdfEngineMode('overlay') === 'overlay' && resolvePdfEngineMode('com') === 'com');
  if (saved === undefined) delete process.env.XLS_PDF_ENGINE; else process.env.XLS_PDF_ENGINE = saved;

  // ---- case 1：混合批次（overlay + 自動退回 com）----
  // PDF_CJK=off → 模擬「環境沒有 CJK 字型」：含中文／全形字元的記錄整筆退回 Excel（舊行為）。
  console.log('\n=== case 1：混合批次（2 筆疊字 + 1 筆 CJK 退回 Excel；PDF_CJK=off）===');
  const savedCjkMode = process.env.PDF_CJK;
  process.env.PDF_CJK = 'off';
  const f1 = await buildSynthetic('test-p4-engine-mixed');
  let r1;
  try {
    r1 = await runWorkflow({
      files: [{ originalName: 'synthetic-mixed.xlsx', path: f1.srcPath }],
      defs: f1.defs,
      reportTemplate: f1.reportCopy,
      sliTemplate: path.join(TEMPLATES, 'cainiao-sli-eli-template.xlsx'),
      concurrency: 1,
      pdfEngine: 'overlay',
    });
  } finally {
    if (savedCjkMode === undefined) delete process.env.PDF_CJK; else process.env.PDF_CJK = savedCjkMode;
  }
  const pdfs1 = await inspectPdfs(r1.workDir);
  console.log(`  engine=${JSON.stringify(r1.engine)}`);
  console.log(`  fallbackCount=${r1.fallbackCount}  errors=${JSON.stringify(r1.errors)}`);
  pdfs1.forEach((p) => console.log(`  ${p.name}: pages=${p.pages} ${p.ok ? 'A4' : 'NOT-A4'} ${p.kb} KB`));
  check('count=3（疊字 2 ＋ 退回 1，全部產出）', r1.count === 3, `count=${r1.count}`);
  check("engine.mode='overlay'", r1.engine.mode === 'overlay');
  check('engine.overlay=2', r1.engine.overlay === 2, `overlay=${r1.engine.overlay}`);
  check('engine.com=1、fallbackCount=1', r1.engine.com === 1 && r1.fallbackCount === 1);
  check('退回原因含該 MAWB 與非 Latin-1 字元', r1.engine.fallbackReasons.length === 1
    && r1.engine.fallbackReasons[0].mawb === '160-15102743' && /，/.test(r1.engine.fallbackReasons[0].chars));
  check("退回原因 reason='cjk-disabled'（PDF_CJK=off）", r1.engine.fallbackReasons[0].reason === 'cjk-disabled',
    String(r1.engine.fallbackReasons[0].reason));
  check('每份 2 頁 A4', pdfs1.length === 3 && pdfs1.every((p) => p.ok));
  check('errors=[]', r1.errors.length === 0, JSON.stringify(r1.errors));

  // ---- case 1b：預設（PDF_CJK=auto）→ 含 CJK 的記錄也走疊字，不再退回 Excel ----
  console.log('\n=== case 1b：預設（PDF_CJK=auto）→ 3 筆全部疊字，engine.com=0 ===');
  const f1b = await buildSynthetic('test-p4-engine-cjk');
  const r1b = await runWorkflow({
    files: [{ originalName: 'synthetic-mixed.xlsx', path: f1b.srcPath }],
    defs: f1b.defs,
    reportTemplate: f1b.reportCopy,
    sliTemplate: path.join(TEMPLATES, 'cainiao-sli-eli-template.xlsx'),
    concurrency: 1,
    pdfEngine: 'overlay',
  });
  const pdfs1b = await inspectPdfs(r1b.workDir);
  console.log(`  engine=${JSON.stringify(r1b.engine)}`);
  console.log(`  fallbackCount=${r1b.fallbackCount}  errors=${JSON.stringify(r1b.errors)}`);
  pdfs1b.forEach((p) => console.log(`  ${p.name}: pages=${p.pages} ${p.ok ? 'A4' : 'NOT-A4'} ${p.kb} KB`));
  check('count=3', r1b.count === 3, `count=${r1b.count}`);
  if (r1b.engine.cjkFont) {
    check('engine.overlay=3、com=0、fallbackCount=0（CJK 也疊字）',
      r1b.engine.overlay === 3 && r1b.engine.com === 0 && r1b.fallbackCount === 0,
      `overlay=${r1b.engine.overlay} com=${r1b.engine.com} fallback=${r1b.fallbackCount}`);
    check('engine.cjkFont 回報本次使用的字型', !!r1b.engine.cjkFont, String(r1b.engine.cjkFont));
    check('每份 2 頁 A4', pdfs1b.length === 3 && pdfs1b.every((p) => p.ok));
  } else {
    check('環境無 CJK 字型 → 允許退回（engine.com>0 且 fallbackReasons 有記錄）',
      r1b.engine.com > 0 && r1b.engine.fallbackReasons.length > 0,
      `com=${r1b.engine.com} cjkFont=${r1b.engine.cjkFont}`);
  }

  // ---- case 2：引擎不可用 → 全部退回 Excel 引擎 ----
  console.log('\n=== case 2：背景 PDF 缺失 → 全部自動退回 Excel 引擎 ===');
  const f2 = await buildSynthetic('test-p4-engine-nobackground');
  const savedBlank = process.env.SLI_ELI_BLANK_PDF;
  process.env.SLI_ELI_BLANK_PDF = path.join(TEMPLATES, '__missing__.pdf');
  let r2;
  try {
    r2 = await runWorkflow({
      files: [{ originalName: 'synthetic-mixed.xlsx', path: f2.srcPath }],
      defs: f2.defs,
      reportTemplate: f2.reportCopy,
      sliTemplate: path.join(TEMPLATES, 'cainiao-sli-eli-template.xlsx'),
      concurrency: 1,
      pdfEngine: 'overlay',
    });
  } finally {
    if (savedBlank === undefined) delete process.env.SLI_ELI_BLANK_PDF; else process.env.SLI_ELI_BLANK_PDF = savedBlank;
  }
  const pdfs2 = await inspectPdfs(r2.workDir);
  console.log(`  engine=${JSON.stringify(r2.engine)}`);
  console.log(`  errors=${JSON.stringify(r2.errors)}`);
  pdfs2.forEach((p) => console.log(`  ${p.name}: pages=${p.pages} ${p.ok ? 'A4' : 'NOT-A4'} ${p.kb} KB`));
  check('仍產出 3 份（改用 Excel 引擎）', r2.count === 3, `count=${r2.count}`);
  check('engine.overlay=0、com=3、fallbackCount=3', r2.engine.overlay === 0 && r2.engine.com === 3 && r2.fallbackCount === 3);
  check('明確回報「疊字引擎無法使用」', r2.errors.some((e) => /疊字引擎無法使用/.test(e)));
  check('每份 2 頁 A4', pdfs2.length === 3 && pdfs2.every((p) => p.ok));
  check('退回後仍有字型優化（維持 ~123KB，不因 overlay 模式而變大）',
    r2.fontOpt && r2.fontOpt.files === 3 && r2.fontOpt.reductionPct > 30,
    r2.fontOpt ? `${r2.fontOpt.files} 份 -${r2.fontOpt.reductionPct}%` : 'fontOpt=null');

  console.log(`\nP4 ENGINE CHECK: ${failures === 0 ? 'PASS' : `FAIL（${failures} 項）`}`);
  if (failures) process.exit(1);
}

main().catch((e) => { console.error('測試失敗:', e); process.exit(1); });
