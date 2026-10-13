// ===== 驗證「A4 修正」 =====
// 把 Excel 匯出的 SLI/ELI PDF 合併後正規化成 A4，並列印前後的頁面尺寸/大小/耗時。
// 用法：node scripts/test-pdf-a4.js [workDir]     預設 data/test-sli-job
//
// 前置：先跑 python scripts/test-sli-generate.py（產生 SLI/ELI PDF），
//       或指定任一含「xxx SLI.pdf / xxx ELI.pdf」的目錄（例如 data/work/job-xxxx）。

const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const { mergePdfs, normalizePdfToA4, readPdfPageSizes, A4_SIZE } = require('./xls-sli-eli');

const fmt = (sizes) => sizes.map((s) => `${s.width.toFixed(1)}x${s.height.toFixed(1)}`).join(' / ');
const isA4 = (s) => Math.abs(s.width - A4_SIZE.width) <= 1 && Math.abs(s.height - A4_SIZE.height) <= 1;

(async () => {
  const workDir = path.resolve(process.argv[2] || path.join(__dirname, '..', 'data', 'test-sli-job'));
  const files = fs.readdirSync(workDir);
  const sli = files.find((f) => f.endsWith(' SLI.pdf'));
  const eli = files.find((f) => f.endsWith(' ELI.pdf'));
  if (!sli || !eli) {
    console.error('找不到 SLI/ELI PDF，請先跑：python scripts/test-sli-generate.py');
    process.exit(1);
  }
  const outDir = path.resolve(__dirname, '..', 'data', 'test-pdf-a4');
  await fsp.mkdir(outDir, { recursive: true });

  // 1) 合併（未正規化）→ 同時保留一份對照檔（等效 PDF_PAPER=custom 的輸出）
  const rawOut = path.join(outDir, 'merged-raw.pdf');
  await mergePdfs([path.join(workDir, sli), path.join(workDir, eli)], rawOut);
  const rawSizes = await readPdfPageSizes(rawOut);
  console.log('合併後（未正規化）:', fmt(rawSizes), rawSizes.every(isA4) ? '(已全 A4)' : '(非 A4)');
  await fsp.copyFile(rawOut, path.join(outDir, 'merged-custom.pdf'));

  // 2) A4 正規化
  const a4Out = path.join(outDir, 'merged-a4.pdf');
  await fsp.copyFile(rawOut, a4Out);
  const t0 = Date.now();
  const changed = await normalizePdfToA4(a4Out);
  const ms = Date.now() - t0;
  const a4Sizes = await readPdfPageSizes(a4Out);
  console.log('A4 正規化後    :', fmt(a4Sizes), `| 調整頁數=${changed} 耗時=${ms}ms`);

  const before = fs.statSync(rawOut).size;
  const after = fs.statSync(a4Out).size;
  console.log(`檔案大小: ${(before / 1024).toFixed(1)} KB -> ${(after / 1024).toFixed(1)} KB`);

  // 3) 驗收：2 頁、全部 A4
  const ok = a4Sizes.length === 2 && a4Sizes.every(isA4);
  console.log(ok ? 'A4 CHECK: PASS' : 'A4 CHECK: FAIL');
  console.log(`（輸出：${path.join(outDir, 'merged-a4.pdf')}）`);
  if (!ok) process.exit(1);
})().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
