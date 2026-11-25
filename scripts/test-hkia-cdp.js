// ===== HKIA CDP：靜態 / 純函式驗收（免伺服器）=====
// 覆蓋：NAV 與頁面掛載、CTO 預檢規則、Preset 範本、錯誤碼字典、程式碼片段、
//       #409 簽章、API 路徑組裝、設定遮罩（clientSecret / webhookPass）。
// 用法：node scripts/test-hkia-cdp.js
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'hkia-cdp-static-'));
process.env.HKIA_DATA_DIR = TMP;

let failed = 0;
function check(label, ok, detail) {
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed += 1;
}

const Validator = require('../public/js/hkia-cdp/cto-validator');
const ErrorCodes = require('../public/js/hkia-cdp/error-codes');
const signature = require('../routes/hkia-cdp/signature');
const hk = require('../routes/hkia-cdp/http-client');
const store = require('../routes/hkia-cdp/store');

function payload(overrides) {
  return Object.assign({
    documentId: crypto.randomUUID(),
    ctoCode: 'AAT', cargoType: 'BUK', airlineCode: 'CX',
    mawbNumber: '160-1234 5678', screeningMethod: 'RACSF',
    securityStatus: { statusCode: 'SPX', screeningMethod: 'RACSF' },
    raCode: 'RA1', rfCode: 'RF1', vehicleRegistration: 'AB1234',
    sealType: 'BOX_TRUCK_V2', seal: 'SEAL-1',
    additionalSecurityInformation: 'SCREENED',
    receipt: { emails: ['a@example.com'] },
    specialHandlingCodes: [],
    cargo: { pieceCount: 10, weight: { value: 950.5, unit: 'KG' }, volume: { value: 4.25, unit: 'CBM' } },
    ulds: [{ uldNumber: 'AKE12345AK', contour: 'AKE', volume: { value: 4.25 }, weight: { value: 950.5 } }]
  }, overrides || {});
}

(async () => {
  console.log('===== HKIA CDP：靜態 / 純函式驗收 =====');

  // ---- A. NAV 與頁面掛載 ----
  const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  check('A1 index.html 有 #nav-hkia-cdp 目錄項目', /href="#section-hkia-cdp"[^>]*id="nav-hkia-cdp"/.test(html));
  check('A2 目錄含鎖頭 #nav-hkia-cdp-lock（需登入）', /nav-hkia-cdp-lock/.test(html));
  check('A3 有 <section id="section-hkia-cdp">', /<section id="section-hkia-cdp"/.test(html));
  check('A4 有 #hkia-root 容器', /id="hkia-root"/.test(html));
  check('A5 引入 hkia-cdp.css', /css\/hkia-cdp\.css/.test(html));
  const validatorIdx = html.indexOf('./js/hkia-cdp/cto-validator.js');
  const moduleIdx = html.indexOf('script type="module" src="./js/hkia-cdp.js"');
  check('A6 先載入共用驗證器，再載入 hkia-cdp.js 模組', validatorIdx !== -1 && moduleIdx !== -1 && validatorIdx < moduleIdx);
  const authSrc = fs.readFileSync(path.join(ROOT, 'public', 'js', 'auth.js'), 'utf8');
  check('A7 auth.js 會解鎖 / 攔截 nav-hkia-cdp', /nav-hkia-cdp-lock/.test(authSrc) && /'nav-hkia-cdp'/.test(authSrc));
  const mainSrc = fs.readFileSync(path.join(ROOT, 'public', 'js', 'main.js'), 'utf8');
  check('A8 main.js initProtectedSections 會初始化 HKIA CDP', /setupHkiaCdpSection/.test(mainSrc));
  const fixSrc = fs.readFileSync(path.join(ROOT, 'scripts', 'fix-nav-order.js'), 'utf8');
  check('A9 fix-nav-order DEFAULT_ORDER 含 #section-hkia-cdp', /'#section-hkia-cdp'/.test(fixSrc));
  const stubSrc = fs.readFileSync(path.join(ROOT, 'scripts', 'test-nav-order-frontend.js'), 'utf8');
  check('A10 前端排序測試 stub 含 #section-hkia-cdp', /'#section-hkia-cdp'/.test(stubSrc));
  const serverSrc = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  check('A11 後端 /api/hkia-cdp 限 admin/staff，webhook 公開且掛在前面',
    /app\.use\('\/api\/hkia-cdp\/webhook', hkiaCdp\.webhookRouter\);[\s\S]{0,240}app\.use\('\/api\/hkia-cdp', requireRole\('admin', 'staff'\), hkiaCdp\.router\)/.test(serverSrc));
  check('A12 main.js 只對 admin/staff 初始化 HKIA CDP',
    /role === 'admin' \|\| role === 'staff'\) && typeof window\.setupHkiaCdpSection/.test(mainSrc));
  check('A13 auth.js 對非員工顯示鎖頭並攔截',
    /nav-hkia-cdp-lock/.test(authSrc) && /HKIA CDP 測試平台僅限內部員工使用/.test(authSrc));

  // ---- B. CTO 預檢 ----
  check('B1 AAT 合法 payload → 無錯誤', Validator.validate(payload(), { api: '#405' }).ok);
  const noVehicle = Validator.validate(payload({ ctoCode: 'AAT', vehicleRegistration: '' }), { api: '#405' });
  check('B2 AAT 缺車牌 → AAT_VEHICLE_REQUIRED', noVehicle.errors.some((e) => e.code === 'AAT_VEHICLE_REQUIRED'));
  const badStatus = Validator.validate(payload({ ctoCode: 'AAT', securityStatus: { statusCode: 'XXX' } }), { api: '#405' });
  check('B3 AAT statusCode 非法 → AAT_STATUS_INVALID', badStatus.errors.some((e) => e.code === 'AAT_STATUS_INVALID'));
  const liteNog = Validator.validate(payload({ ctoCode: 'AAT', screeningMethod: 'CTO', natureOfGoods: '' }), { api: '#415' });
  check('B4 AAT #415 + CTO 缺 natureOfGoods → AAT_NOG_REQUIRED', liteNog.errors.some((e) => e.code === 'AAT_NOG_REQUIRED'));
  const liteNogChars = Validator.validate(payload({ ctoCode: 'AAT', screeningMethod: 'INTEGRATOR', natureOfGoods: '貨物' }), { api: '#415' });
  check('B5 AAT #415 natureOfGoods 非法字元 → AAT_NOG_CHARS', liteNogChars.errors.some((e) => e.code === 'AAT_NOG_CHARS'));
  const manyEmails = Validator.validate(payload({ ctoCode: 'AAT', receipt: { emails: ['a@x.com', 'b@x.com', 'c@x.com', 'd@x.com'] } }), { api: '#405' });
  check('B6 AAT 收件電郵 > 3 → AAT_RECEIPT_MAX', manyEmails.errors.some((e) => e.code === 'AAT_RECEIPT_MAX'));

  const hactlDecimals = Validator.validate(payload({ ctoCode: 'HACTL', cargo: { weight: { value: 1.25 }, volume: { value: 1.234 } } }), { api: '#405' });
  check('B7 HACTL 重量 2 位小數 → 108717', hactlDecimals.errors.some((e) => e.code === '108717'));
  check('B8 HACTL 體積 3 位小數 → 108785', hactlDecimals.errors.some((e) => e.code === '108785'));
  const hactlAsi = Validator.validate(payload({ ctoCode: 'HACTL', additionalSecurityInformation: 'lowercase text' }), { api: '#405' });
  check('B9 HACTL ASI 非全大寫 → 122090', hactlAsi.errors.some((e) => e.code === '122090'));
  const hactlSeal = Validator.validate(payload({ ctoCode: 'HACTL', seal: '1234567890123456' }), { api: '#405' });
  check('B10 HACTL seal > 15 → HACTL_SEAL_LEN', hactlSeal.errors.some((e) => e.code === 'HACTL_SEAL_LEN'));
  const hactlPpk = Validator.validate(payload({
    ctoCode: 'HACTL', cargoType: 'PPK', screeningMethod: 'RACSF',
    ulds: [{ uldNumber: 'A', contour: 'AKE' }, { uldNumber: 'B', contour: 'AKE' }]
  }), { api: '#405' });
  check('B11 HACTL PPK + RACSF 多 ULD → HACTL_PPK_RACSF_ULD', hactlPpk.errors.some((e) => e.code === 'HACTL_PPK_RACSF_ULD'));
  const subcontour = Validator.validate(payload({ ctoCode: 'HACTL', ulds: [{ uldNumber: 'A', contour: 'A1', subcontour: '' }] }), { api: '#405' });
  check('B12 HACTL 需 subcontour 的 contour → HACTL_SUBCONTOUR', subcontour.errors.some((e) => e.code === 'HACTL_SUBCONTOUR'));

  const cpslPi = Validator.validate(payload({
    ctoCode: 'CPSL', cargoType: 'PPK', specialHandlingCodes: ['ELI'], piCode: 'PI967(II)',
    piCodeBooking: '', cargo: { pieceCount: '', weight: { value: '' } }
  }), { api: '#405' });
  check('B13 CPSL 鋰電池 PI967 缺件數／重量 → CPSL_PI_PCS / CPSL_PI_WEIGHT',
    cpslPi.errors.some((e) => e.code === 'CPSL_PI_PCS') && cpslPi.errors.some((e) => e.code === 'CPSL_PI_WEIGHT'));
  check('B14 CPSL PPK 缺 piCodeBooking → CPSL_PI_BOOKING', cpslPi.errors.some((e) => e.code === 'CPSL_PI_BOOKING'));
  const cpslLh = Validator.validate(payload({ ctoCode: 'CPSL', cargoType: 'MIX', airlineCode: 'LH' }), { api: '#405' });
  check('B15 CPSL LH + MIX 缺 buUserName / discNoticeYn',
    cpslLh.errors.some((e) => e.code === 'CPSL_LH_BU') && cpslLh.errors.some((e) => e.code === 'CPSL_LH_DISC'));
  const cpslCx = Validator.validate(payload({ ctoCode: 'CPSL', cargoType: 'BUK', airlineCode: 'CX', raCode: '', rfCode: '' }), { api: '#405' });
  check('B16 CPSL CX + BUK 缺 raCode / rfCode',
    cpslCx.errors.some((e) => e.code === 'CPSL_CX_RA') && cpslCx.errors.some((e) => e.code === 'CPSL_CX_RF'));
  const cpslAsi = Validator.validate(payload({ ctoCode: 'CPSL', additionalSecurityInformation: 'X'.repeat(31) }), { api: '#405' });
  check('B17 CPSL ASI > 30 → CPSL_ASI_LEN', cpslAsi.errors.some((e) => e.code === 'CPSL_ASI_LEN'));

  // ---- C. Seal 格式 ----
  const sealNet = Validator.validate(payload({ sealType: 'SECURENET_V2', seal: 'ABC-01' }), { api: '#405' });
  check('C1 SECURENET_V2 格式不符 → SEAL_FORMAT', sealNet.errors.some((e) => e.code === 'SEAL_FORMAT'));
  const sealNetOk = Validator.validate(payload({ sealType: 'SECURENET_V2', seal: '1234567-01' }), { api: '#405' });
  check('C2 SECURENET_V2 合法（1234567-01）→ 不報 SEAL_FORMAT', !sealNetOk.errors.some((e) => e.code === 'SEAL_FORMAT'));
  const sealMulti = Validator.validate(payload({ sealType: 'BOX_TRUCK_V2', seal: 'A, B ,C' }), { api: '#405' });
  check('C3 BOX_TRUCK_V2 允許逗號分隔多 Seal', !sealMulti.errors.some((e) => e.code === 'SEAL_FORMAT'));
  const sealSmart = Validator.validate(payload({ sealType: 'SMARTSECNET_V2', seal: 'XX123' }), { api: '#405' });
  check('C4 SMARTSECNET_V2 必須 HK 開頭 → SEAL_FORMAT', sealSmart.errors.some((e) => e.code === 'SEAL_FORMAT'));

  // ---- D. 範本 / 錯誤碼 / 片段 ----
  const presets = await import(pathToFileURL(path.join(ROOT, 'public', 'js', 'hkia-cdp', 'presets.js')).href);
  check('D1 內建 8 個測試範本', presets.PRESETS.length === 8, String(presets.PRESETS.length));
  const presetFailures = [];
  presets.PRESETS.forEach((preset) => {
    const built = preset.build();
    const result = Validator.validate(built, { api: preset.api, cto: preset.cto, cargoType: preset.cargoType });
    if (!result.ok) presetFailures.push(`${preset.id}:${result.errors.map((e) => e.code).join('/')}`);
  });
  check('D2 每個範本都能通過自己的 CTO 預檢', presetFailures.length === 0, presetFailures.join(', '));
  check('D3 UUID v4 格式', /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(presets.uuid()));
  check('D4 RFC 3339 時間戳（+08:00）', /\+08:00$/.test(presets.futureRfc3339(3)));
  const parsedUld = presets.parseUldLines('AKE12345AK|ake||4.25|950.5')[0];
  check('D5 ULD 文字解析（ULD|CONTOUR|SUB|CBM|KG）', parsedUld.contour === 'AKE' && parsedUld.weight.value === 950.5);

  const snippets = await import(pathToFileURL(path.join(ROOT, 'public', 'js', 'hkia-cdp', 'snippets.js')).href);
  const builtSnippets = snippets.buildAll({ method: 'POST', url: 'https://api-external.sit.hkiacargo.com/export/external/v1/ra/export-orders', headers: { 'x-api-key': 'K' }, body: { a: 1 } });
  check('D6 cURL 片段含 --cert / --key / --tlsv1.2',
    builtSnippets.curl.indexOf('--cert') !== -1 && builtSnippets.curl.indexOf('--key') !== -1 && builtSnippets.curl.indexOf('--tlsv1.2') !== -1);
  check('D7 JavaScript / Python 片段都指向同一 URL',
    builtSnippets.javascript.indexOf('api-external.sit.hkiacargo.com') !== -1 && builtSnippets.python.indexOf('api-external.sit.hkiacargo.com') !== -1);

  const hit = ErrorCodes.lookup('108717');
  check('D8 錯誤碼 108717 有中文原因與修正建議', !!hit && !!hit.message && !!hit.fix);
  check('D9 CDP_070 → Rate Limit 說明', /Rate Limit/i.test(ErrorCodes.lookup('CDP_070').message));
  check('D10 HTTP 429 → 有對應說明', /Rate Limit/i.test(ErrorCodes.explainHttp(429).message));
  check('D11 未列出的 CDP_0xx 走前綴規則', ErrorCodes.lookup('CDP_055').source === 'prefix');
  const extracted = ErrorCodes.extract({ cto_errors: [{ code: '122090', message: 'x' }] });
  check('D12 從 CTO 回應抽出錯誤並對應字典', extracted.length === 1 && /全大寫/.test(extracted[0].message));
  const successMsg = ErrorCodes.extract(
    { export_order_reference_num: 'EO-AAT-000001', status: 'ACCEPTED', message: 'Export order created（mock）' },
    { ok: true }
  );
  check('D12a 成功回應的 message 不列為錯誤（#405 mock 不再顯示「錯誤解析」）', successMsg.length === 0, JSON.stringify(successMsg));
  const failMsg = ErrorCodes.extract({ error: 'boom', code: 'CDP_010' }, { ok: false });
  check('D12b 失敗回應的 error / message 仍會抽出（CDP_010 → 字典說明）',
    failMsg.length === 1 && failMsg[0].code === 'CDP_010' && /Request body/.test(failMsg[0].message));
  check('D13 KEY_REQUIRED 有中文修正建議', /私鑰/.test((ErrorCodes.lookup('KEY_REQUIRED') || {}).fix || ''));

  // ---- E. #409 簽章 ----
  const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const keyPem = pair.privateKey.export({ type: 'pkcs8', format: 'pem' });
  const pubPem = pair.publicKey.export({ type: 'spki', format: 'pem' });
  const tiny = Buffer.from('fake-image-bytes').toString('base64');
  const signed = signature.signImage(tiny, keyPem);
  check('E1 簽章演算法 SHA256withRSA', signed.algorithm === 'SHA256withRSA');
  check('E2 hash 是 64 位 hex', /^[0-9a-f]{64}$/.test(signed.hash));
  check('E3 簽章可用公鑰驗證', signature.verifyImage(tiny, signed.signature, pubPem) === true);
  let tooLarge = false;
  try { signature.signImage(Buffer.alloc(5 * 1024 * 1024).toString('base64'), keyPem); } catch (err) { tooLarge = err.code === 'IMAGE_TOO_LARGE'; }
  check('E4 超過 4 MB → IMAGE_TOO_LARGE', tooLarge);

  // ---- F. API 定義 / 路徑組裝 ----
  check('F1 API 定義共 15 支（#001 + #401–#412 + #415 + #416）', Object.keys(hk.API_DEFS).length === 15);
  check('F2 #402 以 ra_reference_id 組路徑',
    hk.buildPath('#402', { ra_reference_id: 'RA-1' }).path === '/export/external/v1/ra/pre-declarations/RA-1');
  check('F3 #402 缺少 ra_reference_id 時改用 cto_predeclaration_num',
    hk.buildPath('#402', { cto_predeclaration_num: 'CTO1' }).path.indexOf('cto_predeclaration_num=CTO1') !== -1);
  check('F4 #412 支援 waybill_num',
    hk.buildPath('#412', { waybill_num: '160-1234 5678' }).path.indexOf('waybill_num=') !== -1);
  check('F5 #409 依角色組出 /rf/ 路徑',
    hk.buildPath('#409', { export_order_reference_num: 'EO-1' }, 'rf').path.indexOf('/v1/rf/') !== -1);
  let missingParam = false;
  try { hk.buildPath('#406', {}); } catch (err) { missingParam = err.code === 'PARAM_MISSING'; }
  check('F6 缺少路徑參數 → PARAM_MISSING', missingParam);
  check('F7 限流上限 15 req/sec', hk.rateLimiter.stats().limit === 15 && hk.rateLimiter.stats().windowMs === 1000);
  check('F8 Mock Token 是 JWT 形狀（3 段）', hk.mockAccessToken('RA').split('.').length === 3);

  // ---- G. 設定遮罩 ----
  store.saveConfig({ env: 'sit', role: 'RA', clientId: 'cid', clientSecret: 'top-secret', apiKey: 'APIKEY123', webhookPass: 'pw' });
  const pub = store.publicConfig();
  check('G1 clientSecret 不落回前端（遮罩）', pub.clientSecret.indexOf('••') !== -1 && pub.hasClientSecret === true);
  check('G2 apiKey 只露前 4 碼', pub.apiKey === 'APIK••••');
  check('G3 webhookPass 遮罩', pub.webhookPass.indexOf('••') !== -1 && pub.hasWebhookPass === true);
  store.saveConfig({ clientSecret: '' });
  check('G4 PUT 空 clientSecret＝維持原值', store.getConfig().clientSecret === 'top-secret');
  store.saveConfig({ clientSecret: null });
  check('G5 PUT null clientSecret＝清除', store.getConfig().clientSecret === '');
  store.saveConfig({ env: 'sit' });
  store.saveConfig({ env: 'uat' });
  check('G6 非法 env 會被收斂（保持原值）', store.getConfig().env === 'sit');

  // ---- H. mTLS 檢查（合併式 .pem / 憑證與私鑰判斷） ----
  const certOnly = path.join(TMP, 'cert-only.pem');
  const keyOnly = path.join(TMP, 'key-only.pem');
  const combined = path.join(TMP, 'combined.pem');
  const genKey = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
    .privateKey.export({ type: 'pkcs8', format: 'pem' });
  const fakeCert = '-----BEGIN CERTIFICATE-----\nMIIBfake\n-----END CERTIFICATE-----\n';
  fs.writeFileSync(certOnly, fakeCert, 'utf8');
  fs.writeFileSync(keyOnly, genKey, 'utf8');
  fs.writeFileSync(combined, fakeCert + genKey, 'utf8');

  check('H1 fileHasPrivateKey 認得 PKCS#8 私鑰', hk.fileHasPrivateKey(keyOnly) === true);
  check('H2 fileHasPrivateKey 不會把憑證誤判為私鑰', hk.fileHasPrivateKey(certOnly) === false);
  const stCertOnly = hk.mtlsStatus({ certPath: certOnly, keyPath: '' });
  check('H3 只有憑證 → 未就緒並提示缺私鑰',
    stCertOnly.ok === false && stCertOnly.issues.some((i) => i.indexOf('未設定私鑰') !== -1));
  const stCombined = hk.mtlsStatus({ certPath: combined, keyPath: '' });
  check('H4 合併式 .pem（憑證＋私鑰）→ 就緒且標記 combinedPem',
    stCombined.ok === true && stCombined.combinedPem === true);
  const stKeyOnly = hk.mtlsStatus({ certPath: keyOnly, keyPath: '' });
  check('H5 把私鑰當憑證 → 提示沒有 BEGIN CERTIFICATE',
    stKeyOnly.ok === false && stKeyOnly.issues.some((i) => i.indexOf('BEGIN CERTIFICATE') !== -1));
  const stEmpty = hk.mtlsStatus({});
  check('H6 完全沒設定 → 兩項問題（憑證＋私鑰）', stEmpty.ok === false && stEmpty.issues.length === 2, String(stEmpty.issues.length));
  const lateKey = path.join(TMP, 'late.key');
  const stBefore = hk.mtlsStatus({ certPath: certOnly, keyPath: lateKey });
  fs.writeFileSync(lateKey, genKey, 'utf8');
  const stAfter = hk.mtlsStatus({ certPath: certOnly, keyPath: lateKey });
  check('H7 補上 key 檔後立即偵測到（快取依 mtime/size 失效）', stBefore.ok === false && stAfter.ok === true);

  console.log(`\n===== ${failed === 0 ? '全部通過' : `${failed} 項失敗`} =====`);
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (err) { /* ignore */ }
  process.exit(failed === 0 ? 0 : 1);
})().catch((err) => {
  console.error('測試失敗：', err && err.stack ? err.stack : err);
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  process.exit(1);
});
