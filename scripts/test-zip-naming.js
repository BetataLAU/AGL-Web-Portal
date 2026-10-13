// ===== Shipper Role Project - ZIP 檔名安全化驗證（hermetic，不需 Excel／伺服器）=====
// 背景（實際案例）：
//   來源檔的航班欄位是 `5Y8050/ 13th Oct`（航班號 + 日期），舊版直接用 rec.flight 組 ZIP 檔名：
//     data/work/job-XXXX/20261013 - 5Y8050/ 13th Oct SLI x 13.zip
//   `/` 在 Windows 既非法又是路徑分隔 → archiver 建檔時 ENOENT（父目錄不存在），整個流程失敗。
// 本測試驗證：
//   1. sanitizeFileLabel() 對各種非法字元／邊界情況的處理
//   2. zipBaseName() 產生的檔名基礎（單一航班／多航班／無日期）
//   3. 端到端：以真實 zipFiles() 打包到「含非法字元的航班標籤」檔名，必須成功建立檔案
//
// 用法：node scripts/test-zip-naming.js

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { sanitizeFileLabel, zipBaseName, zipFiles, planDateGroups } = require('./xls-workflow');

const ROOT = path.resolve(__dirname, '..');
const DATA = process.env.DATA_DIR || path.join(ROOT, 'data');
const BLANK = path.join(DATA, 'templates', 'sli-eli-blank.pdf');
const TMP = path.join(DATA, 'test-zip-naming');

// Windows 檔名不允許的字元（含路徑分隔）
const ILLEGAL = /[\\/:*?"<>|]/;

let failures = 0;
function check(label, ok, detail) {
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

async function main() {
  console.log('=== 1) sanitizeFileLabel ===');
  const cases = [
    ['5Y8050/ 13th Oct', '5Y8050-13th Oct'],
    ['CX257', 'CX257'],
    ['20260803 - CX257', '20260803 - CX257'],           // 既有正常檔名不可被改變
    ['A\\B:C*D?E"F<G>H|I', 'A-B-C-D-E-F-G-H-I'],
    ['A / B', 'A-B'],
    ['  trailing. ', 'trailing'],
    ['tab\tand\nnewline', 'tab and newline'],
    ['CON', '_CON'],
    ['nul', '_nul'],
    ['', 'unknown'],
    ['...', 'unknown'],
  ];
  for (const [input, expected] of cases) {
    const got = sanitizeFileLabel(input);
    check(`${JSON.stringify(input)} → ${JSON.stringify(expected)}`, got === expected, got === expected ? '' : `實際 ${JSON.stringify(got)}`);
  }
  const long = sanitizeFileLabel('x'.repeat(200));
  check('長度上限 80', long.length === 80, `實際 ${long.length}`);
  check('自訂 fallback', sanitizeFileLabel('///', { fallback: '航班未定' }) === '航班未定');

  console.log('\n=== 2) zipBaseName ===');
  const single = zipBaseName({ day: '20261013', flights: new Set(['5Y8050/ 13th Oct']), flightCompanies: new Set(['5Y']) });
  check('單一航班（含 / 的航班欄位）', single === '20261013 - 5Y8050-13th Oct', single);
  check('單一航班無非法字元時與舊命名一致', zipBaseName({ day: '20260803', flights: new Set(['CX257']), flightCompanies: new Set(['CX']) }) === '20260803 - CX257');
  check('無航班日期 → 只用航班標籤', zipBaseName({ day: '', flights: new Set(['CX257']), flightCompanies: new Set(['CX']) }) === 'CX257');
  const multi = zipBaseName({ day: '20261013', flights: new Set(['CX257', '5Y8050/ 13th Oct']), flightCompanies: new Set(['5Y', 'CX']) });
  check('多航班 → {公司}+{公司}多航班', multi === '20261013 - 5Y+CX多航班', multi);

  console.log('\n=== 3) 端到端：zipFiles() 以非法字元航班標籤打包 ===');
  await fsp.rm(TMP, { recursive: true, force: true });
  await fsp.mkdir(TMP, { recursive: true });
  const pdfs = [path.join(TMP, '369-10823853.pdf'), path.join(TMP, '369-10823864.pdf')];
  await fsp.copyFile(BLANK, pdfs[0]);
  await fsp.copyFile(BLANK, pdfs[1]);

  // 與 Step 5 相同的組名方式（planDateGroups → zipBaseName）
  const records = [
    { mawb: '369-10823853', flight: '5Y8050/ 13th Oct', flightDate: new Date(2026, 9, 13) },
    { mawb: '369-10823864', flight: '5Y8050/ 13th Oct', flightDate: new Date(2026, 9, 13) },
  ];
  const groups = planDateGroups(records, pdfs);
  check('planDateGroups 只產生 1 組', groups.length === 1, `${groups.length} 組`);
  const prefix = zipBaseName(groups[0]);
  const zipName = `${prefix} SLI x ${pdfs.length}.zip`;
  check('ZIP 檔名不含 Windows 非法字元', !ILLEGAL.test(zipName), zipName);

  const zipPath = path.join(TMP, zipName);
  check('檔名不會被拆成子路徑（dirname 仍是輸出目錄）', path.dirname(zipPath) === TMP, path.dirname(zipPath));
  let err = null;
  try {
    await zipFiles(pdfs, zipPath);
  } catch (e) {
    err = e;
  }
  check('zipFiles 不再 ENOENT', err === null, err ? err.message : '');
  check('ZIP 檔案實際存在且 > 10 KB', fs.existsSync(zipPath) && fs.statSync(zipPath).size > 10 * 1024,
    fs.existsSync(zipPath) ? `${(fs.statSync(zipPath).size / 1024).toFixed(1)} KB` : '不存在');

  // 對照：舊行為（未過濾）會把檔名寫到不存在的子目錄 → ENOENT
  const badPath = path.join(TMP, `20261013 - 5Y8050/ 13th Oct SLI x 2.zip`);
  let badErr = null;
  try {
    await zipFiles(pdfs, badPath);
  } catch (e) {
    badErr = e;
  }
  check('（對照組）未過濾的舊命名確實會 ENOENT', badErr !== null, badErr ? badErr.code || badErr.message : '竟未失敗');

  await fsp.rm(TMP, { recursive: true, force: true });
  console.log('\n（已清除 data/test-zip-naming/）');
  console.log(`\nZIP NAMING CHECK: ${failures === 0 ? 'PASS' : `FAIL（${failures} 項）`}`);
  if (failures) process.exit(1);
}

main().catch((e) => { console.error('測試失敗:', e); process.exit(1); });
