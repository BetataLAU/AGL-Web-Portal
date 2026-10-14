// ===== SLI/ELI「字元處理」驗收：第 0 層淨化 / 第 1 層 WinAnsi / 第 2 層 CJK 字型子集 =====
// 背景：舊版只要遇到「pdf-lib 標準字型編不出來的字元」就把整筆退回 Excel（每筆 ~4 秒、123 KB）。
//       本檔逐層驗收新的處理政策（不做任何可見字元替換）：
//         第 0 層 sanitizeText：移除 Excel 也不會畫的不可見字元（無損）
//         第 1 層 WinAnsi     ：放寬為「WinAnsi 可編碼」（`–` `“` `€`…），與 pdf-lib 官方表逐筆核對
//         第 2 層 CJK 子集    ：fontkit 按需內嵌 CJK 字型（只有該筆真的用到才 +4~7 KB）
//       並量測實筆的檔案大小／耗時／150dpi 差異（與 Excel 參考 PDF 比對）。
//
// 用法：
//   node scripts/test-sli-eli-charset.js                     # 自動找歷史 payload + 參考 PDF
//   node scripts/test-sli-eli-charset.js --ref data/work/job-xxx
//   node scripts/test-sli-eli-charset.js --no-diff           # 只驗邏輯與尺寸/耗時
// 產出：data/test-charset/{mine,ref}/（可重跑，會先清空）
// 注意：全程不需要 Excel COM；輸出目錄固定，請勿與其他測試平行執行。

const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const overlay = require('./sli-eli-overlay');
const charset = require('./pdf-charset');
const cjkFontLib = require('./pdf-cjk-font');
const { normalizePdfToA4, resolvePython } = require('./xls-sli-eli');

const ROOT = path.resolve(__dirname, '..');
const DATA = process.env.DATA_DIR || path.join(ROOT, 'data');
const WORK = path.join(DATA, 'work');
const OUT_ROOT = path.join(DATA, 'test-charset');
const DIFF_PY = path.join(__dirname, 'sli-eli-diff.py');

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const REF_DIR = opt('--ref', null);
const NO_DIFF = flag('--no-diff');
const MAX_DIFF_PCT = 0.5;
const BLANK_KB = fs.existsSync(overlay.DEFAULT_BLANK_PDF)
  ? fs.statSync(overlay.DEFAULT_BLANK_PDF).size / 1024 : 0;

let failures = 0;
function check(label, ok, extra) {
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? `  ← ${extra}` : ''}`);
}
const kb = (b) => `${(b / 1024).toFixed(1)} KB`;
const cp = (c) => `U+${Number(c).toString(16).toUpperCase()}`;

// ===== 測試資料：從歷史 job 裡挑兩筆代表案例 =====
function scanRecords() {
  const out = { endash: null, cjk: null, emoji: null };
  if (!fs.existsSync(WORK)) return out;
  const dirs = fs.readdirSync(WORK)
    .map((d) => path.join(WORK, d))
    .filter((d) => fs.existsSync(path.join(d, 'sli-eli-payload.json')))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  for (const dir of dirs) {
    let payload;
    try { payload = JSON.parse(fs.readFileSync(path.join(dir, 'sli-eli-payload.json'), 'utf-8')); } catch (e) { continue; }
    for (const rec of payload.records || []) {
      const chars = new Set();
      for (const bag of ['sli', 'eli']) {
        for (const v of Object.values(rec[bag] || {})) for (const ch of String(v)) chars.add(ch.codePointAt(0));
      }
      const nonStd = [...chars].filter((c) => !charset.isStdFontChar(c));
      const hasWinAnsiExtra = [...chars].some((c) => charset.WINANSI_EXTRA.has(c));
      const hasEmoji = [...chars].some((c) => c > 0xffff);
      // case A：以前會因 WinAnsi 特殊字（`–`）退回 Excel，現在應該完全可疊字（nonStd 為空）
      if (!out.endash && hasWinAnsiExtra && nonStd.length === 0) {
        out.endash = { dir, mawb: rec.mawb, rec, chars: [...chars].filter((c) => charset.WINANSI_EXTRA.has(c)) };
      }
      if (!out.cjk && nonStd.length) out.cjk = { dir, mawb: rec.mawb, rec, chars: nonStd };
      if (!out.emoji && hasEmoji) out.emoji = { dir, mawb: rec.mawb, rec, chars: [...chars].filter((c) => c > 0xffff) };
      if (out.endash && out.cjk) break;
    }
    if (out.endash && out.cjk) break;
  }
  return out;
}

function findRefDir() {
  if (REF_DIR) return REF_DIR;
  if (!fs.existsSync(WORK)) return null;
  const dirs = fs.readdirSync(WORK, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => path.join(WORK, e.name))
    .filter((d) => fs.readdirSync(d).some((f) => /^\d{3}-\d{8}\.pdf$/.test(f)))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return dirs[0] || null;
}

// ===== 第 0 層：無損淨化 =====
function layer0() {
  console.log('\n=== 第 0 層：無損淨化（只移除 Excel 也不會畫的不可見字元）===');
  const cases = [
    ['零寬＋BOM', 'a\u200bb\ufeffc', 'abc'],
    ['C0 控制字元（保留 TAB）', 'a\u0007b\tc', 'ab\tc'],
    ['行分隔符號 → \\n', 'a\u2028b\u2029c\u0085d', 'a\nb\nc\nd'],
    ['變體選擇器', 'a\ufe0fb', 'ab'],
    ['保留 soft hyphen（可見/可編碼，不屬於無損範圍）', 'a\u00adb', 'a\u00adb'],
    ['保留全形空白與 NBSP', 'a\u3000b\u00a0c', 'a\u3000b\u00a0c'],
  ];
  for (const [label, input, expected] of cases) {
    const got = charset.sanitizeText(input);
    check(`sanitizeText：${label}`, got === expected, `got ${JSON.stringify(got)}`);
  }
  check('toText 會套用淨化（含 TAB→4 空白＋CRLF 正規化）',
    overlay.toText('a\tb\u200bc\r\nd') === 'a    bc\nd', JSON.stringify(overlay.toText('a\tb\u200bc\r\nd')));
}

// ===== 第 1 層：WinAnsi（與 pdf-lib 官方表逐筆核對）=====
async function layer1() {
  console.log('\n=== 第 1 層：WinAnsi 編碼（與 @pdf-lib/standard-fonts 交叉核對）===');
  // eslint-disable-next-line global-require, import/no-extraneous-dependencies
  const { Encodings } = require('@pdf-lib/standard-fonts');
  const table = Encodings.WinAnsi.unicodeMappings; // { codepoint: 'byte,name' }
  const official = new Map();
  for (const [k, v] of Object.entries(table)) {
    official.set(Number(k), parseInt(String(v).split(',')[0], 10));
  }
  // (a) 我們的集合必須「剛好」等於官方表 ＋ TAB/LF/CR
  const ours = new Set([...charset.STD_FONT_CHARS]);
  [0x09, 0x0a, 0x0d].forEach((c) => ours.delete(c));
  const missingFromOurs = [...official.keys()].filter((c) => !ours.has(c));
  const extraInOurs = [...ours].filter((c) => !official.has(c));
  check(`涵蓋官方表全部 ${official.size} 個 codepoint`, missingFromOurs.length === 0,
    missingFromOurs.map(cp).join(' '));
  check('沒有官方表以外的字元（避免誤判可編碼）', extraInOurs.length === 0, extraInOurs.map(cp).join(' '));
  // (b) byte 對照必須一致
  const badBytes = [];
  for (const [code, byte] of official.entries()) {
    if (charset.winAnsiByte(code) !== byte) badBytes.push(`${cp(code)}=${charset.winAnsiByte(code)}≠${byte}`);
  }
  check('winAnsiByte 與官方對照一致（含 0x80–0x9F 特殊字）', badBytes.length === 0, badBytes.join(' '));
  check('winAnsiHex(U+2013) = 96（endash，供原始內容流使用）', charset.winAnsiHex('\u2013') === '96', charset.winAnsiHex('\u2013'));
  // (c) 端到端：pdf-lib 標準字型真的編得出來嗎（逐字 widthOfTextAtSize 不丟錯）
  const { PDFDocument, StandardFonts } = require('pdf-lib');
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bad = [];
  for (const code of charset.STD_FONT_CHARS) {
    if (code < 0x20) continue; // TAB/LF/CR 不逐字量測
    try { font.widthOfTextAtSize(String.fromCharCode(code), 10); } catch (e) { bad.push(`${cp(code)}：${e.message.slice(0, 40)}`); }
  }
  check('pdf-lib 逐字可編碼（0x20 以上全數）', bad.length === 0, bad.slice(0, 6).join(' | '));
  let throws = 0;
  for (const code of [0xff1a, 0x6e2c, 0x1f600]) {
    try { font.widthOfTextAtSize(String.fromCodePoint(code), 10); } catch (e) { throws += 1; }
  }
  check('pdf-lib 對 CJK／emoji 確實會丟錯（第 2 層才有意義）', throws === 3, `${throws}/3`);
  // (d) 判定函式
  check('isStdFontChar：`–` `“` `€` 為 true', [0x2013, 0x201c, 0x20ac].every((c) => charset.isStdFontChar(c)));
  check('isStdFontChar：全形標點／中文為 false', [0xff1a, 0xff0c, 0x6e2c].every((c) => !charset.isStdFontChar(c)));
  check('findUnsupportedChars 以 codepoint 迭代（emoji 不會被拆成兩半）',
    charset.findUnsupportedChars('a\u{1F600}b').length === 1
    && charset.findUnsupportedChars('a\u{1F600}b')[0].code === 0x1f600);
}

// ===== 第 2 層：CJK 字型（fontkit 按需子集）=====
async function layer2() {
  console.log('\n=== 第 2 層：CJK 字型（fontkit 按需子集內嵌）===');
  const font = await cjkFontLib.loadCjkFont();
  if (font && font.error) {
    check('CJK 字型可載入', false, `${font.error}｜候選：${(font.candidates || []).join(', ')}`);
    return null;
  }
  check('CJK 字型可載入', !!font, font && font.describe());
  const t0 = process.hrtime.bigint();
  await cjkFontLib.loadCjkFont();
  const cachedMs = Number(process.hrtime.bigint() - t0) / 1e6;
  check('解析結果快取命中（< 5 ms，避免每筆重解析 20 MB 的 .ttc）', cachedMs < 5, `${cachedMs.toFixed(2)} ms`);
  const probes = [0xff1a, 0xff0c, 0xff08, 0x6e2c, 0x2013];
  const cover = probes.filter((c) => font.hasGlyph(c));
  check('涵蓋全形標點與常用漢字', cover.length === probes.length,
    probes.filter((c) => cover.indexOf(c) < 0).map(cp).join(' '));
  const w1 = font.measureWidth('\uFF1A', 10);
  check('全形字元寬度 = 1em（與 Excel／Calibri 相同，不會造成整行位移）', Math.abs(w1 - 10) < 0.01, `${w1.toFixed(3)} pt`);
  check('未涵蓋字元（emoji）判定為缺字', !font.hasGlyph(0x1f600));
  const runs = overlay.splitRuns('A\u4E2DB\uFF1AC');
  check('splitRuns：ASCII 與 CJK 逐段切開',
    runs.length === 5 && runs.map((r) => r.cjk).join(',') === 'false,true,false,true,false', JSON.stringify(runs));
  return font;
}

// ===== 實筆渲染：檔案大小／耗時／像素差異 =====
async function main() {
  console.log('=== 環境 ===');
  console.log(`背景 PDF   : ${path.basename(overlay.DEFAULT_BLANK_PDF)} ${BLANK_KB.toFixed(1)} KB`);
  console.log(`參考目錄   : ${findRefDir() || '（無）'}`);

  layer0();
  await layer1();
  await layer2();

  const engine = await overlay.createOverlayEngine();
  console.log('\n=== 引擎 ===');
  console.log(`CJK 字型   : ${engine.cjk.available ? `${engine.cjk.path} → ${engine.cjk.postscriptName}` : `不可用（${engine.cjk.error}）`}`);
  console.log(`字元政策   : PDF_CJK=${engine.cjkMode}（實作：scripts/pdf-charset.js ＋ scripts/pdf-cjk-font.js）`);

  const picks = scanRecords();
  const refDir = findRefDir();
  await fsp.rm(OUT_ROOT, { recursive: true, force: true });
  const mineDir = path.join(OUT_ROOT, 'mine');
  const refOutDir = path.join(OUT_ROOT, 'ref');
  await fsp.mkdir(mineDir, { recursive: true });
  await fsp.mkdir(refOutDir, { recursive: true });

  const jobs = [];
  const rows = [];

  // ---- case A：只有 WinAnsi 特殊字（`–`）→ 應該不必用 CJK 字型 ----
  console.log('\n=== case A：只有 WinAnsi 特殊字（不需 CJK 字型）===');
  if (!picks.endash) {
    console.log('  SKIP  歷史資料找不到「只含 U+2013 等 WinAnsi 特殊字」的記錄');
  } else {
    const rec = picks.endash.rec;
    const c = engine.check(rec);
    check(`check → ok（字元 ${picks.endash.chars.map(cp).join(' ')}）`, c.ok, JSON.stringify(c.unsupported));
    check('check → usesCjk=false（不嵌入 CJK 字型）', c.usesCjk === false);
    const r = await engine.renderToDir(rec, mineDir);
    const delta = r.bytes - BLANK_KB * 1024;
    check('render → ok', r.status === 'ok', r.message || '');
    check('未嵌入 CJK 字型（fontPaths 不含 cjk）',
      r.status === 'ok' && !(r.fontPaths || []).some((p) => /cjk/.test(p)), JSON.stringify(r.fontPaths));
    check('檔案大小接近背景（< +8 KB）', delta < 8 * 1024, `${kb(r.bytes)}（+${(delta / 1024).toFixed(1)} KB）`);
    rows.push({ name: `A ${rec.mawb}（WinAnsi）`, bytes: r.bytes, ms: r.ms });
    if (r.status === 'ok') jobs.push({ mawb: rec.mawb, mine: r.file, needle: rec.mawb });
  }

  // ---- case B：含 CJK（中文／全形標點）→ 應走 CJK 子集而不是退回 Excel ----
  console.log('\n=== case B：含 CJK／全形字元（應走 CJK 子集，不再退回 Excel）===');
  if (!picks.cjk) {
    console.log('  SKIP  歷史資料找不到含 CJK 的記錄');
  } else {
    const rec = picks.cjk.rec;
    const c = engine.check(rec);
    check(`check → ok（字元 ${picks.cjk.chars.map(cp).join(' ')}）`, c.ok, JSON.stringify(c.unsupported));
    check('check → usesCjk=true', c.usesCjk === true);
    const r = await engine.renderToDir(rec, mineDir);
    check('render → ok（不再 status=fallback）', r.status === 'ok', r.message || '');
    check('fontPaths 標示 cjk-subset',
      r.status === 'ok' && (r.fontPaths || []).some((p) => /cjk-subset/.test(p)), JSON.stringify(r.fontPaths));
    const delta = r.bytes - BLANK_KB * 1024;
    check('檔案大小增加有限（< +25 KB）', delta < 25 * 1024, `${kb(r.bytes)}（+${(delta / 1024).toFixed(1)} KB）`);
    rows.push({ name: `B ${rec.mawb}（CJK）`, bytes: r.bytes, ms: r.ms });
    if (r.status === 'ok') jobs.push({ mawb: rec.mawb, mine: r.file, needle: rec.mawb });
  }

  // ---- case C：PDF_CJK=off → 回到「整筆退回」且不寫檔 ----
  console.log('\n=== case C：PDF_CJK=off（一鍵回滾舊行為）===');
  const offEngine = await overlay.createOverlayEngine({ cjkMode: 'off' });
  check('cjk.available=false（未載入字型）', offEngine.cjk.available === false);
  if (picks.cjk) {
    const c = offEngine.check(picks.cjk.rec);
    check('check → 不 ok', c.ok === false);
    check("reason='cjk-disabled'", (c.unsupported[0] || {}).reason === 'cjk-disabled', (c.unsupported[0] || {}).reason);
    const ghost = path.join(mineDir, '__should_not_exist__.pdf');
    const r = await offEngine.render(picks.cjk.rec, ghost);
    check("render → status='fallback' 且不寫檔", r.status === 'fallback' && !fs.existsSync(ghost));
  }

  // ---- case D：字型檔缺失 → reason='no-cjk-font'（不得讓流程失敗）----
  console.log('\n=== case D：找不到字型檔（環境沒有 CJK 字型的情境）===');
  const noFontEngine = await overlay.createOverlayEngine({
    cjkFont: [path.join(DATA, '__missing-font__.ttf')],
    cjkStrict: true,
    logger: { warn() {} }, // 這個案例預期會 warn（環境沒有字型），測試中靜音
  });
  check('引擎仍可建立（不 throw）', !!noFontEngine);
  check('cjk.available=false', noFontEngine.cjk.available === false);
  if (picks.cjk) {
    const c = noFontEngine.check(picks.cjk.rec);
    check("reason='no-cjk-font'", (c.unsupported[0] || {}).reason === 'no-cjk-font', (c.unsupported[0] || {}).reason);
  }

  // ---- case E：像素差異（與 Excel 參考 PDF 比對）----
  if (!NO_DIFF && refDir && jobs.length) {
    console.log('\n=== case E：與 Excel 參考 PDF 的 150dpi 逐像素差異 ===');
    const withRef = [];
    for (const j of jobs) {
      const src = path.join(refDir, `${j.mawb}.pdf`);
      if (!fs.existsSync(src)) { console.log(`  SKIP  ${j.mawb} 在 ${path.basename(refDir)} 沒有參考 PDF`); continue; }
      const refPath = path.join(refOutDir, `${j.mawb}.pdf`);
      await fsp.copyFile(src, refPath);
      await normalizePdfToA4(refPath);
      withRef.push({ mawb: j.mawb, mine: j.mine, ref: refPath, needles: [j.needle] });
    }
    if (withRef.length) {
      const jobsFile = path.join(OUT_ROOT, 'jobs.json');
      await fsp.writeFile(jobsFile, JSON.stringify(withRef), 'utf-8');
      const { stdout } = await execFileAsync(resolvePython(), [DIFF_PY, '--jobs', jobsFile, '--dpi', '150', '--json'], {
        maxBuffer: 32 * 1024 * 1024, windowsHide: true,
      });
      const rowsDiff = JSON.parse(stdout.trim().split('\n').pop());
      for (const row of rowsDiff) {
        const ok = !row.diffError && row.diffPerPage.every((x) => x < MAX_DIFF_PCT)
          && Object.values(row.textHits).every(Boolean) && row.pages === 2;
        check(`${row.mawb}：2 頁＋文字可搜尋＋差異 < ${MAX_DIFF_PCT}%`, ok,
          `diff ${row.diffPerPage.map((x) => `${x.toFixed(3)}%`).join('/')}${row.diffError ? `｜${row.diffError}` : ''}`);
      }
    }
  } else {
    console.log('\n=== case E：像素差異 ===（--no-diff 或找不到參考檔，略過）');
  }

  // ===== 總結 =====
  console.log('\n=== 實測數據（疊字路徑）===');
  for (const r of rows) {
    console.log(`  ${r.name.padEnd(26)} ${kb(r.bytes)}  ${r.ms.toFixed(1)} ms  （背景 ${BLANK_KB.toFixed(1)} KB）`);
  }
  console.log('  對照：舊做法（退回 Excel COM）＝ ~123.4 KB／每筆 ~4000 ms');
  console.log(`\nCHARSET CHECK: ${failures === 0 ? 'PASS' : `FAIL（${failures} 項）`}`);
  if (failures) process.exit(1);
}

main().catch((e) => { console.error('測試失敗:', e); process.exit(1); });
