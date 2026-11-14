// ===== 執 PLAN：Excel（TSV）貼上／複製 測試 =====
// 用法：node scripts/test-loading-plan-paste.js
const path = require('path');
const { pathToFileURL } = require('url');

const SRC = pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'loading-plan', 'paste.js')).href;

let pass = 0;
let fail = 0;
function check(name, ok, extra = '') {
  if (ok) pass += 1; else fail += 1;
  console.log(`${ok ? '✅' : '❌'} ${name}${extra ? ' ' + extra : ''}`);
}
const near = (a, b) => Math.abs(Number(a) - Number(b)) <= 1e-9;

(async () => {
  console.log('===== 執 PLAN：TSV 貼上／複製 測試 =====\n');
  const { lpParseTsv, lpBuildTsv, LP_TSV_HEADERS } = await import(SRC);

  // ---- 1. 產生 TSV ----
  console.log('--- 1. lpBuildTsv ---');
  const items = [
    {
      mawb: '176-6985 5240', client: 'MAERSK', dest: 'DWC', pkgs_text: '17+7P',
      gross_weight: 1302, volume_weight: 1135, cbm: 6.82, tag: '4 / D6', remark: 'ETA 15 Nov前',
      volume: { vol: 1135, cuft: 240.85 }
    },
    {
      mawb: '176-6840 0640', client: 'MAERSK', dest: 'DWC', pkgs_text: '3+4P',
      gross_weight: 220, volume_weight: 238, cbm: 1.43, tag: '', remark: '有\tTAB 與\n換行',
      volume: { vol: 238, cuft: 50.5 }
    }
  ];
  const tsv = lpBuildTsv(items, 'vol');
  const lines = tsv.split('\n');
  check('1.1 第一列是標題', lines[0] === LP_TSV_HEADERS.join('\t'), lines[0]);
  check('1.2 有 3 列（標題＋2 筆）', lines.length === 3, String(lines.length));
  check('1.3 用 tab 分隔（9 欄）', lines[1].split('\t').length === 9, String(lines[1].split('\t').length));
  check('1.4 含 MAWB / G.W / CBM', lines[1].includes('176-6985 5240') && lines[1].includes('1302') && lines[1].includes('6.82'));
  check('1.5 remark 的 tab／換行被清掉', !lines[2].split('\t')[8].includes('\n') && lines[2].split('\t')[8].includes('TAB'));

  const tsvCuft = lpBuildTsv(items, 'cuft');
  check('1.6 cu.ft 模式標題是 cu.ft', tsvCuft.split('\n')[0].includes('cu.ft'), tsvCuft.split('\n')[0]);
  check('1.7 cu.ft 模式第 6 欄是 240.85', tsvCuft.split('\n')[1].split('\t')[5] === '240.85', tsvCuft.split('\n')[1].split('\t')[5]);

  // ---- 2. 往返（自己產生的 TSV 自己讀回）----
  console.log('--- 2. 往返解析 ---');
  const back = lpParseTsv(tsv);
  check('2.1 認出標題列', back.headerUsed === true);
  check('2.2 讀回 2 筆', back.rows.length === 2, String(back.rows.length));
  const first = back.rows[0];
  check('2.3 MAWB 還原', first.mawb === '176-6985 5240', first.mawb);
  check('2.4 數字還原（G.W 1302 / CBM 6.82）', near(first.gross_weight, 1302) && near(first.cbm, 6.82));
  check('2.5 VOL 還原 1135', near(first.volume_weight, 1135));
  check('2.6 TAG 還原', first.tag === '4 / D6', first.tag);
  check('2.7 remark 還原（含中文）', first.remark === 'ETA 15 Nov前', first.remark);

  // ---- 3. 直接從 Excel 複製（無標題列、10 欄）----
  console.log('--- 3. Excel 直貼（無標題）---');
  const excelCopy = [
    ['MAERSK', '176-6985 5240', '4 / D6', 'DWC', '17+7P', '1,302', '1,135', '6.82', '2026-11-14', 'ETA 15 Nov前'].join('\t'),
    ['RS', '176-6558 7491', 'D3/11', 'AMS', 'CTNS', '1,000', '', '6', '2026-11-10', 'RMB 40.5'].join('\t')
  ].join('\n');
  const excelParsed = lpParseTsv(excelCopy);
  check('3.1 無標題列 → 用固定欄位順序', excelParsed.headerUsed === false);
  check('3.2 讀到 2 筆', excelParsed.rows.length === 2, String(excelParsed.rows.length));
  const ex1 = excelParsed.rows[0];
  check('3.3 CLIENT / MAWB / DEST 對位正確',
    ex1.client === 'MAERSK' && ex1.mawb === '176-6985 5240' && ex1.dest === 'DWC',
    JSON.stringify({ c: ex1.client, m: ex1.mawb, d: ex1.dest }));
  check('3.4 千分位逗號可解析（1,302）', near(ex1.gross_weight, 1302), String(ex1.gross_weight));
  check('3.5 空白 VOL 不會變成 0', excelParsed.rows[1].volume_weight === undefined);
  check('3.6 CTNS 原文保留', excelParsed.rows[1].pkgs_text === 'CTNS');

  // ---- 4. 標題別名 ----
  console.log('--- 4. 標題別名 ---');
  const aliasTsv = [
    ['MAWB NUMBER', 'SHIPPER', 'DESTINATION', 'PACKAGES', 'Gross Weight', 'CBM', 'HAWB', 'Remark'].join('\t'),
    ['176-6840 0640', 'MAERSK', 'DWC', '3+4P', '220', '1.43', '1 / D7', 'JPS'].join('\t')
  ].join('\n');
  const alias = lpParseTsv(aliasTsv);
  check('4.1 認得別名標題', alias.headerUsed === true);
  check('4.2 別名對到正確欄位',
    alias.rows[0].mawb === '176-6840 0640' && alias.rows[0].client === 'MAERSK' &&
    alias.rows[0].pkgs_text === '3+4P' && near(alias.rows[0].cbm, 1.43),
    JSON.stringify(alias.rows[0]));

  const zhTsv = ['主號\t客戶\t件數\t重量\t備註', '176-1\tMAERSK\t8P\t1560\t直單'].join('\n');
  const zh = lpParseTsv(zhTsv);
  check('4.3 中文標題也支援', zh.headerUsed === true && zh.rows[0].mawb === '176-1' && zh.rows[0].remark === '直單');

  // ---- 5. 邊界 ----
  console.log('--- 5. 邊界條件 ---');
  check('5.1 空字串 → 0 筆', lpParseTsv('').rows.length === 0);
  check('5.2 只有空白行 → 0 筆', lpParseTsv('\n\n  \n').rows.length === 0);
  const sparse = lpParseTsv('MAWB\tCLIENT\n\n\t\n176-1\t');
  check('5.3 空白列不會變成資料列', sparse.rows.length === 1, JSON.stringify({ n: sparse.rows.length, s: sparse.skipped }));
  check('5.4 欄數不足不會爆', lpParseTsv('176-1').rows.length === 1);
  check('5.5 CRLF 可解析', lpParseTsv('MAWB\tCLIENT\r\n176-1\tRS\r\n').rows.length === 1);
  const nonNumeric = lpParseTsv('MAWB\tCLIENT\tG.W\n176-1\tRS\tabc');
  check('5.6 非數字重量不會寫成 0', nonNumeric.rows[0].gross_weight === undefined);

  console.log(`\n===== 測試結束：${pass} 通過 / ${fail} 失敗 =====`);
  process.exitCode = fail ? 1 : 0;
})().catch((err) => {
  console.error('測試失敗：', err && err.stack ? err.stack : err);
  process.exit(1);
});
