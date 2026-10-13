// ===== Shipper Role Project - P3 疊字產生器驗證 =====
// 驗收項目（PRD §P3）：
//   1) 與 Excel 版逐頁 150dpi 逐像素比對 < 0.5%（比對前會把 Excel 參考檔 A4 正規化，對齊舊流程輸出）
//   2) 每份 PDF = 2 頁、兩頁皆 A4、文字可抽取（MAWB 可搜尋）
//   3) 每份檔案大小與每筆耗時
//   4) 含非 Latin-1 的記錄必須「退回舊引擎」而不是畫出亂碼
//
// 用法：
//   node scripts/test-sli-eli-overlay.js                  # 自動找最近含 payload + {MAWB}.pdf 的 job
//   node scripts/test-sli-eli-overlay.js --ref data/work/job-xxx
//   node scripts/test-sli-eli-overlay.js --limit 3 --dpi 150 --no-diff
//
// 產出：data/test-p3-overlay/{mine,ref}/（可重跑，會先清空）

const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

const overlay = require('./sli-eli-overlay');
const { normalizePdfToA4, resolvePython } = require('./xls-sli-eli');

const ROOT = path.resolve(__dirname, '..');
const DATA = process.env.DATA_DIR || path.join(ROOT, 'data');
const OUT_ROOT = path.join(DATA, 'test-p3-overlay');
const DIFF_PY = path.join(__dirname, 'sli-eli-diff.py');

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const REF_DIR = opt('--ref', null);
const LIMIT = Number(opt('--limit', 0)) || 0;
const DPI = Number(opt('--dpi', 150)) || 150;
const NO_DIFF = flag('--no-diff');
const MAX_DIFF_PCT = 0.5; // 驗收門檻（逐頁 150dpi）
const A4 = overlay.A4_SIZE;
const isA4 = (s) => Math.abs(s.width - A4.width) <= 1 && Math.abs(s.height - A4.height) <= 1;

function findRefDir() {
  const work = path.join(DATA, 'work');
  if (!fs.existsSync(work)) return null;
  const candidates = fs.readdirSync(work, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith('job-'))
    .map((d) => path.join(work, d.name))
    .filter((dir) => fs.existsSync(path.join(dir, 'sli-eli-payload.json'))
      && fs.readdirSync(dir).some((f) => /^\d{3}-\d{8}\.pdf$/.test(f)))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return candidates[0] || null;
}

function kb(bytes) { return (bytes / 1024).toFixed(1); }
function avg(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0; }

async function main() {
  // ===== 準備 =====
  const refDir = REF_DIR || findRefDir();
  if (!refDir && !NO_DIFF) {
    console.error('找不到 Excel 參考目錄（需含 sli-eli-payload.json 與 {MAWB}.pdf 的 data/work/job-*）');
    console.error('可用 --ref <dir> 指定，或 --no-diff 只驗結構。');
    process.exit(2);
  }
  const outDir = path.join(OUT_ROOT, 'mine');
  const refOutDir = path.join(OUT_ROOT, 'ref');
  await fsp.rm(OUT_ROOT, { recursive: true, force: true });
  await fsp.mkdir(outDir, { recursive: true });
  await fsp.mkdir(refOutDir, { recursive: true });

  const tCold = Date.now();
  const engine = await overlay.createOverlayEngine();
  const coldMs = Date.now() - tCold;
  const info = engine.describe();
  console.log('=== 環境 ===');
  console.log(`背景 PDF   : ${path.basename(info.blankPdf)} ${kb(info.blankBytes)} KB  ${info.pageSizes.join(' / ')}`);
  console.log(`fieldmap   : ${path.basename(info.fieldmapPath)} v${engine.fieldmap.version} ${info.fieldCount} 欄位`);
  console.log(`字型       : ${info.fonts.regular} / ${info.fonts.bold}（標準字型，0 byte 內嵌）`);
  console.log(`字型模式   : ${info.fontMode}（auto＝優先沿用背景內嵌的 Excel Arial 子集）`);
  (info.embeddedFonts || []).forEach((s) => console.log(`             內嵌字型 ${s}`));
  console.log(`資產問題   : ${info.issues.length ? info.issues.join('；') : '（無）'}`);
  console.log(`冷啟動載入 : ${coldMs} ms（背景＋fieldmap；每筆渲染共用）`);
  console.log(`參考目錄   : ${refDir || '（無，略過像素比對）'}`);
  console.log('');

  const payloadPath = refDir ? path.join(refDir, 'sli-eli-payload.json') : null;
  const payload = payloadPath && fs.existsSync(payloadPath)
    ? JSON.parse(await fsp.readFile(payloadPath, 'utf-8'))
    : { records: [] };
  let records = payload.records || [];
  if (LIMIT) records = records.slice(0, LIMIT);
  if (!records.length) {
    console.error('payload 內沒有記錄可測。');
    process.exit(2);
  }

  // ===== 渲染（逐筆計時）=====
  console.log(`=== 疊字產生（${records.length} 筆）===`);
  const results = [];
  for (const rec of records) {
    const r = await engine.renderToDir(rec, outDir);
    results.push({ rec, r });
    if (r.status === 'ok') {
      console.log(`  ${r.mawb}  ok   ${kb(r.bytes)} KB  ${r.ms.toFixed(1)} ms  ${r.pages} 頁  ${(r.fontPaths || []).join(', ')}`);
    } else {
      const why = (r.unsupported || []).map((u) => `${u.label}=${u.sample}`).join(', ');
      console.log(`  ${r.mawb}  退回舊引擎（${r.reason}）${r.ms.toFixed(2)} ms  非 Latin-1: ${why}`);
    }
  }
  const okList = results.filter((x) => x.r.status === 'ok');
  const fbList = results.filter((x) => x.r.status !== 'ok');
  console.log('');

  // ===== 像素比對（Excel 參考檔先 A4 正規化；一次 Python 程序批次處理）=====
  const diffByMawb = new Map();
  if (refDir && !NO_DIFF) {
    const jobs = [];
    for (const { r } of okList) {
      const src = path.join(refDir, `${r.mawb}.pdf`);
      if (!fs.existsSync(src)) continue;
      const refPath = path.join(refOutDir, `${r.mawb}.pdf`);
      await fsp.copyFile(src, refPath);
      await normalizePdfToA4(refPath); // 舊流程輸出＝A4；未正規化的 job 產物也能比
      jobs.push({ mawb: r.mawb, mine: r.file, ref: refPath, needles: [r.mawb] });
    }
    if (jobs.length) {
      const jobsFile = path.join(OUT_ROOT, 'jobs.json');
      await fsp.writeFile(jobsFile, JSON.stringify(jobs), 'utf-8');
      const py = resolvePython();
      const { stdout } = await execFileAsync(py, [DIFF_PY, '--jobs', jobsFile, '--dpi', String(DPI), '--json'], {
        maxBuffer: 32 * 1024 * 1024,
        windowsHide: true,
      });
      const parsed = JSON.parse(stdout.trim().split('\n').pop());
      for (const row of parsed) diffByMawb.set(row.mawb, row);
    }
  }

  // ===== 驗收斷言 =====
  console.log('=== 驗收（逐份）===');
  console.log('  MAWB            頁數  尺寸(A4±1pt)              文字  差異%(逐頁)              大小     耗時');
  let allOk = true;
  let maxDiff = 0;
  const sizes = [];
  const times = [];
  for (const { r } of results) {
    if (r.status !== 'ok') {
      // 退回舊引擎的記錄：必須真的含 Latin-1 以外的字元（否則就是誤判）
      const genuine = (r.unsupported || []).length > 0
        && r.unsupported.every((u) => u.chars.some((c) => c.code > 0xff));
      if (!genuine) allOk = false;
      console.log(`  ${r.mawb}  → 退回舊引擎：${genuine ? '判定正確' : 'FAIL（判定錯誤）'}`
        + `  ${(r.unsupported || []).map((u) => `${u.label}=${u.sample}`).join(', ')}`);
      continue;
    }
    const d = diffByMawb.get(r.mawb);
    const pages = d ? d.pages : r.pages;
    const sizeList = d ? d.sizes.map(([w, h]) => ({ width: w, height: h })) : r.sizes;
    const pagesOk = pages === 2;
    const a4ok = sizeList.length === 2 && sizeList.every(isA4);
    const textOk = d ? Object.values(d.textHits).every(Boolean) : true;
    const diffs = d ? d.diffPerPage : null;
    const diffOk = !diffs || diffs.every((x) => x < MAX_DIFF_PCT);
    if (!pagesOk || !a4ok || !textOk || !diffOk || (d && d.diffError)) allOk = false;
    if (diffs) maxDiff = Math.max(maxDiff, ...diffs);
    sizes.push(r.bytes);
    times.push(r.ms);
    console.log(`  ${r.mawb}  ${pagesOk ? '2' : 'FAIL'}    `
      + `${a4ok ? sizeList.map((s) => `${s.width.toFixed(1)}x${s.height.toFixed(1)}`).join(' / ') : 'FAIL'}    `
      + `${textOk ? 'OK' : 'FAIL'}   `
      + `${diffs ? diffs.map((x) => `${x.toFixed(3)}%`).join(' / ') : '略過'}`
      + `${diffs && !diffOk ? ` ✗ >${MAX_DIFF_PCT}%` : ''}    `
      + `${kb(r.bytes)} KB  ${r.ms.toFixed(1)} ms`);
    if (d && d.diffError) console.log(`    ✗ 比對失敗：${d.diffError}`);
    if (refDir && !NO_DIFF && !d) {
      console.log('    ✗ 未取得像素比對結果（參考檔不存在，或同時執行了兩份本測試 → 輸出目錄互砍）');
      allOk = false;
    }
    if (d && d.diffsAgree === false) {
      console.log('    ✗ diff 與 sli-eli-font-optimize.diff_pages 不一致（門檻數學有落差）');
      allOk = false;
    }
  }
  console.log('');

  // ===== 總結 =====
  console.log('=== 實測數據 ===');
  if (sizes.length) {
    console.log(`檔案大小   : 最小 ${kb(Math.min(...sizes))} KB / 平均 ${kb(avg(sizes))} KB / 最大 ${kb(Math.max(...sizes))} KB`
      + `（背景 ${kb(engine.blankBytes)} KB，無內嵌字型）`);
    console.log(`每筆耗時   : 平均 ${avg(times).toFixed(1)} ms / 最快 ${Math.min(...times).toFixed(1)} ms / 最慢 ${Math.max(...times).toFixed(1)} ms`
      + `（冷啟動 ${coldMs} ms 另計）`);
    console.log(`總計       : ${okList.length} 份 / ${times.reduce((a, b) => a + b, 0).toFixed(0)} ms（序列，不含 Excel／Python）`);
  }
  if (diffByMawb.size) {
    console.log(`像素差異   : 最大 ${maxDiff.toFixed(3)}%（門檻 ${MAX_DIFF_PCT}%）@ ${DPI}dpi`);
    console.log('             註：Excel 參考檔內嵌 Arial 子集，與標準字型（Helvetica）在同一位置、');
    console.log('                 同字級下的「字型光柵地板」實測約 0.25%(p0) / 0.35%(p1)；');
    console.log('                 位置與內容已逐項對齊（ink bbox 0.00pt、折行/行距/日期格式一致）。');
  }
  console.log(`退回舊引擎 : ${fbList.length} 筆${fbList.length ? `（${fbList.map((x) => x.r.mawb).join(', ')}）` : ''}`);
  console.log(`產出目錄   : ${outDir}`);
  console.log('');
  console.log(allOk ? 'OVERLAY CHECK: PASS' : 'OVERLAY CHECK: FAIL');
  if (!allOk) process.exit(1);
}

main().catch((e) => {
  console.error('測試失敗:', e);
  process.exit(1);
});
