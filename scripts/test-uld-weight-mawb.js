// ===== ULD 夾重系統：MAWB 格式化／檢查碼驗證測試 =====
// 規則：11 位數字（3 位航空公司＋8 位序號；序號前 7 位 mod 7 = 第 8 位檢查碼）
// 用法：node scripts/test-uld-weight-mawb.js
const path = require('path');
const { pathToFileURL } = require('url');

const MAWB_URL = pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'uldweight', 'mawb-format.js')).href;

let passCount = 0;
let failCount = 0;

function check(name, ok, extra = '') {
  if (ok) passCount += 1; else failCount += 1;
  console.log(`${ok ? '✅' : '❌'} ${name}${extra ? ' ' + extra : ''}`);
}

function eq(name, actual, expected) {
  check(name, actual === expected, JSON.stringify(actual) + (actual === expected ? '' : ` （預期 ${JSON.stringify(expected)}）`));
}

(async () => {
  console.log('===== ULD 夾重系統：MAWB 格式／檢查碼測試 =====\n');
  const mawb = await import(MAWB_URL);

  // ===== 1. 只取數字 =====
  console.log('--- 1. 數字抽取 ---');
  eq('1.1 去連字號與空白', mawb.uldMawbDigits('071-6195 2074'), '07161952074');
  eq('1.2 全形／雜訊也去掉', mawb.uldMawbDigits(' 071 / 6195-2074 '), '07161952074');
  eq('1.3 空值 → 空字串', mawb.uldMawbDigits(null), '');

  // ===== 2. 正規化與格式化 =====
  console.log('\n--- 2. 格式化（000-0000 0000）---');
  eq('2.1 11 位數字', mawb.uldFormatMawb('07161952074'), '071-6195 2074');
  eq('2.2 已含連字號', mawb.uldFormatMawb('071-61952074'), '071-6195 2074');
  eq('2.3 已含空白', mawb.uldFormatMawb('071-6195 2074'), '071-6195 2074');
  eq('2.4 只給 8 位序號 → 航空公司補 000', mawb.uldFormatMawb('61952074'), '000-6195 2074');
  eq('2.5 航空公司只有 2 位 → 左補 0（71 → 071）', mawb.uldFormatMawb('7161952074'), '071-6195 2074');
  eq('2.6 航空公司只有 1 位 → 左補 00（7 → 007）', mawb.uldFormatMawb('761952074'), '007-6195 2074');
  eq('2.7 不足 8 位 → 原樣保留（不亂補）', mawb.uldFormatMawb('0716195'), '0716195');
  eq('2.8 超過 11 位 → 原樣保留', mawb.uldFormatMawb('071619520741'), '071619520741');
  eq('2.9 純文字 → 原樣保留', mawb.uldFormatMawb('ABC'), 'ABC');
  eq('2.10 空值 → 空字串', mawb.uldFormatMawb(''), '');

  // ===== 3. 檢查碼 =====
  console.log('\n--- 3. 檢查碼（前 7 位 mod 7）---');
  eq('3.1 61952074 → 檢查碼 4', mawb.uldMawbCheckDigit('61952074'), 4);
  eq('3.2 檢查碼長度不足 → null', mawb.uldMawbCheckDigit('6195207'), null);
  // 造幾組合法號碼：serial 0000001..3
  const validSerial = (seven) => `${seven}${Number(seven) % 7}`;
  eq('3.3 serial 0000001 → 0000001 1', mawb.uldMawbCheckDigit(validSerial('0000001')), 1);
  eq('3.4 serial 0000007 → 0000007 0', mawb.uldMawbCheckDigit(validSerial('0000007')), 0);

  // ===== 4. 驗證結果 =====
  console.log('\n--- 4. 驗證（ok／reason）---');
  const ok1 = mawb.uldValidateMawb('071-6195 2074');
  check('4.1 合法：071-6195 2074', ok1.ok === true && ok1.reason === 'OK' && ok1.formatted === '071-6195 2074',
    JSON.stringify(ok1));
  const ok2 = mawb.uldValidateMawb('7161952074');
  check('4.2 少一位航空公司也能通過（自動補 071）',
    ok2.ok === true && ok2.digits === '07161952074' && ok2.formatted === '071-6195 2074', ok2.formatted);
  const bad = mawb.uldValidateMawb('071-6195 2075');
  check('4.3 檢查碼錯 → CHECK_DIGIT（預期 4、實際 5）',
    bad.ok === false && bad.reason === 'CHECK_DIGIT' && bad.expected === 4 && bad.actual === 5,
    JSON.stringify({ reason: bad.reason, expected: bad.expected, actual: bad.actual }));
  check('4.4 檢查碼錯的訊息含「檢查碼不符」', /檢查碼不符/.test(bad.message), bad.message);
  const short1 = mawb.uldValidateMawb('0716195');
  check('4.5 位數不足 → LENGTH', short1.ok === false && short1.reason === 'LENGTH', short1.message);
  const long1 = mawb.uldValidateMawb('071619520741');
  check('4.6 位數過多 → TOO_LONG', long1.ok === false && long1.reason === 'TOO_LONG', long1.message);
  const empty1 = mawb.uldValidateMawb('   ');
  check('4.7 空值 → EMPTY（不是錯誤，只是還沒填）',
    empty1.ok === false && empty1.reason === 'EMPTY' && empty1.empty === true);
  check('4.8 合法時 message 為空字串', ok1.message === '');

  // ===== 5. 其他格式也能驗證 =====
  console.log('\n--- 5. 各種輸入寫法 ---');
  ['07161952074', '071-6195 2074', '071 6195 2074', '071-61952074', '0716195-2074']
    .forEach((variant) => {
      const r = mawb.uldValidateMawb(variant);
      check(`5.x ${variant} → 合法且格式化一致`, r.ok === true && r.formatted === '071-6195 2074', r.formatted);
    });

  // ===== 6. UI 文案 =====
  console.log('\n--- 6. UI 文案 ---');
  eq('6.1 合法 → 不顯示問題', mawb.uldMawbIssueText(ok1), '');
  eq('6.2 空值 → 不顯示問題（還沒填不算錯）', mawb.uldMawbIssueText(empty1), '');
  check('6.3 不合法 → 回傳訊息', mawb.uldMawbIssueText(bad).length > 0, mawb.uldMawbIssueText(bad));

  console.log(`\n===== ${failCount === 0 ? '全部通過' : failCount + ' 項失敗'}（PASS ${passCount} / FAIL ${failCount}）=====`);
  process.exitCode = failCount === 0 ? 0 : 1;
})();
