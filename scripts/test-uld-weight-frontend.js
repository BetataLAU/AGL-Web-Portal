// ===== ULD 夾重系統：前端（狀態轉換 + 渲染）測試 =====
// 以最小 DOM stub 載入 public/js/uldweight/{calc,state,render}.js：
//   1. 狀態轉換（API → 編輯狀態 → payload）
//   2. 依件數拆分散貨重量
//   3. 清單／編輯畫面 HTML 產生（含夾重欄位、比例、最終重量）
//   4. 局部更新 refreshComputed 不應拋錯
// 用法：node scripts/test-uld-weight-frontend.js
// 註：出現 MODULE_TYPELESS_PACKAGE_JSON 警告為正常現象（專案 package.json 不是 ESM）。
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const BASE = pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'uldweight')).href;

let passCount = 0;
let failCount = 0;

function check(name, ok, extra = '') {
  if (ok) passCount += 1; else failCount += 1;
  console.log(`${ok ? '✅' : '❌'} ${name}${extra ? ' ' + extra : ''}`);
}

// ===== 最小 DOM stub =====
globalThis.document = {
  getElementById: () => null,
  createElement: () => ({ style: {}, classList: { add() {} }, appendChild() {}, remove() {} })
};
globalThis.window = globalThis;

function makeRoot() {
  return {
    _html: '',
    set innerHTML(value) { this._html = value; },
    get innerHTML() { return this._html; },
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    appendChild() {}
  };
}

// API 回傳格式（與 routes/uld-weight.js 的 GET /sheets/:id 相同）
function apiDetail() {
  return {
    id: 7,
    sheet_no: 'WGT-20261105-01',
    sheet_date: '2026-11-05',
    terminal: 'CPSL',
    flight_no: 'CX1234',
    flight_date: '2026-11-05',
    round_px: 1,
    round_b: 0.5,
    tail_mode: 'adjust_largest',
    handler: 'tester',
    remark: '',
    status: 'draft',
    ulds: [
      {
        id: 11, uid: 'u11', kind: 'ULD', uld_number: 'PMC0003XX', contour_code: 'ZQ',
        port: 'HKG', pcs: 8, tare_weight: 115, rcl_gross_weight: 425, material_weight: 0,
        lih_type: 'N', predecl_type: 'X', squeeze_mode: 'weight',
        items: [
          { id: 21, mawb: '160-00000005', port: 'HKG', pcs: 5, declared_weight: 300, final_weight: 300, is_squeeze: 0, squeeze_ratio: null, lih_type: 'N' },
          { id: 22, mawb: '160-00000006', port: 'TPE', pcs: 3, declared_weight: 125, final_weight: 125, is_squeeze: 1, squeeze_ratio: null, lih_type: 'N' }
        ]
      },
      {
        id: 12, uid: 'u12', kind: 'ULD', uld_number: 'PMC0004XX', contour_code: 'PMC',
        port: 'HKG', pcs: 3, tare_weight: 112, rcl_gross_weight: 888, material_weight: 0,
        lih_type: 'N', predecl_type: 'P', squeeze_mode: 'weight',
        items: [
          { id: 23, mawb: '160-00000006', port: 'TPE', pcs: 3, declared_weight: 888, final_weight: 888, is_squeeze: 1, squeeze_ratio: null, lih_type: 'N' }
        ]
      }
    ],
    mawbs: [],
    issues: [],
    totals: {}
  };
}

(async () => {
  console.log('===== ULD 夾重系統：前端測試 =====\n');
  const state = await import(`${BASE}/state.js`);
  const render = await import(`${BASE}/render.js`);
  const calc = await import(`${BASE}/calc.js`);
  const versionDiff = await import(`${BASE}/version-diff.js`);

  // 2026-11-07：編輯畫面預設改成「載荷表（CHARTER LOADING SHEET，grid）」；
  // 這一支測試的 §7～§21 是卡片／狀態行為，固定切回 cards（§22 再測 grid）。
  state.uldWeightState.ui.view = 'cards';

  // ===== 1. 新增單位預設值 =====
  console.log('--- 1. 新增收貨單位 ---');
  const uldUnit = state.uldNewUnit('ULD');
  check('1.1 ULD 預設 kind=ULD、Pre-decl=P、Tare=0',
    uldUnit.kind === 'ULD' && uldUnit.predecl_type === 'P' && uldUnit.tare_weight === 0);
  check('1.2 ULD 有 uid 與空白 draft', !!uldUnit.uid && uldUnit.draft && uldUnit.draft.mawb === '');
  const bulkUnit = state.uldNewUnit('BULK');
  check('1.3 散貨預設 kind=BULK、Pre-decl=B', bulkUnit.kind === 'BULK' && bulkUnit.predecl_type === 'B');
  check('1.4 兩個單位 uid 不同（避免覆蓋）', uldUnit.uid !== bulkUnit.uid);

  // ===== 2. API → 編輯狀態 =====
  console.log('\n--- 2. API 資料轉編輯狀態 ---');
  const sheet = state.uldSheetFromApi(apiDetail());
  check('2.1 表頭帶入（貨站／航班／B 取整）',
    sheet.terminal === 'CPSL' && sheet.flight_no === 'CX1234' && Number(sheet.round_b) === 0.5);
  check('2.2 收貨單位 2 個、明細 3 筆',
    sheet.ulds.length === 2 && sheet.ulds.reduce((n, u) => n + u.items.length, 0) === 3);
  check('2.3 is_squeeze 轉布林', sheet.ulds[0].items[1].is_squeeze === true && sheet.ulds[0].items[0].is_squeeze === false);
  check('2.4 每個明細都有前端 uid', sheet.ulds.every(u => u.items.every(it => !!it.uid)));

  // ===== 3. 即時計算（CASE 4）=====
  console.log('\n--- 3. 即時計算 ---');
  state.uldWeightState.current = sheet;
  const computed = state.uldComputed();
  const mawbB = computed.mawbs.find(m => m.mawb === '160-00000006');
  const mawbA = computed.mawbs.find(m => m.mawb === '160-00000005');
  check('3.1 MAWB a = 300（不夾重）', Math.abs(mawbA.final - 300) < 1e-6, String(mawbA.final));
  check('3.2 MAWB b = 1013（125 + 888）', Math.abs(mawbB.final - 1013) < 1e-6, String(mawbB.final));
  check('3.3 全表淨重 1313', Math.abs(computed.totals.netTotal - 1313) < 1e-6, String(computed.totals.netTotal));
  check('3.4 沒有任何檢核問題', computed.issues.length === 0, JSON.stringify(computed.issues.map(i => i.code)));

  // ===== 4. 編輯狀態 → PUT payload =====
  console.log('\n--- 4. 送出格式 ---');
  sheet.ulds[0].items[0].mawb_record_id = 21; // 從 Booking Record 帶入的票
  const payload = state.uldSheetPayload(sheet);
  check('4.1 payload 有表頭與 2 個單位', payload.ulds.length === 2 && payload.terminal === 'CPSL');
  check('4.2 payload 明細不含前端 uid', payload.ulds.every(u => u.items.every(it => it.uid === undefined)));
  check('4.3 is_squeeze 轉 0/1（後端用整數存）',
    payload.ulds[0].items[1].is_squeeze === 1 && payload.ulds[0].items[0].is_squeeze === 0);
  check('4.4 重量為數字（不是字串）',
    typeof payload.ulds[0].rcl_gross_weight === 'number' && typeof payload.ulds[0].items[0].declared_weight === 'number');
  check('4.5 payload 保留 mawb_record_id（Booking Record 連結）',
    payload.ulds[0].items[0].mawb_record_id === 21 && payload.ulds[0].items[1].mawb_record_id === null,
    JSON.stringify(payload.ulds[0].items.map(it => it.mawb_record_id)));

  // ===== 5. 散貨／同票分板：依件數拆分 =====
  console.log('\n--- 5. 依件數拆分重量 ---');
  const splitSheet = state.uldSheetFromApi(apiDetail());
  state.uldWeightState.current = splitSheet;
  const unitA = splitSheet.ulds[0];
  const itemB = unitA.items[1];
  const splitResult = state.uldSplitMawb(unitA.uid, itemB.uid, 1013);
  check('5.1 拆到 2 個單位', splitResult.count === 2, String(splitResult.count));
  check('5.2 3:3 → 507 / 506（合計 1013）',
    Math.abs(splitResult.weights[0] - 507) < 1e-6 && Math.abs(splitResult.weights[1] - 506) < 1e-6,
    splitResult.weights.join(' / '));
  check('5.3 重量已寫回兩個單位的同一票 MAWB',
    Math.abs(splitSheet.ulds[0].items[1].declared_weight - 507) < 1e-6 &&
    Math.abs(splitSheet.ulds[1].items[0].declared_weight - 506) < 1e-6);
  check('5.4 標記為未儲存', state.uldWeightState.dirty === true);

  // ===== 6. 渲染：清單 =====
  console.log('\n--- 6. 渲染清單 ---');
  const listRoot = makeRoot();
  state.uldWeightState.view = 'list';
  state.uldWeightState.sheets = [{
    id: 7, sheet_no: 'WGT-20261105-01', sheet_date: '2026-11-05', terminal: 'CPSL',
    flight_no: 'CX1234', uld_count: 2, bulk_count: 0, rcl_total: 1540, net_total: 1313,
    diff_total: 0, status: 'draft'
  }];
  render.renderList(listRoot);
  check('6.1 清單出現夾重表編號', listRoot.innerHTML.includes('WGT-20261105-01'));
  check('6.2 清單顯示 RCL 總重 1540', listRoot.innerHTML.includes('1540'));
  check('6.3 清單有開啟／複製／刪除按鈕',
    listRoot.innerHTML.includes('data-action="open"') &&
    listRoot.innerHTML.includes('data-action="duplicate"') &&
    listRoot.innerHTML.includes('data-action="delete"'));
  check('6.4 草稿狀態標籤', listRoot.innerHTML.includes('uldw-status-draft') && listRoot.innerHTML.includes('草稿'));



  // ===== 7. 渲染：編輯畫面 =====
  console.log('\n--- 7. 渲染編輯畫面 ---');
  const editorRoot = makeRoot();
  state.uldWeightState.current = state.uldSheetFromApi(apiDetail());
  state.uldWeightState.view = 'editor';
  state.uldWeightState.dirty = false;
  state.uldWeightState.contourOptions = ['A3', 'PMC', 'ZQ'];
  render.renderEditor(editorRoot);
  const html = editorRoot.innerHTML;
  check('7.1 標題列有編號與儲存／鎖定按鈕',
    html.includes('WGT-20261105-01') && html.includes('data-action="save"') && html.includes('data-action="lock"'));
  check('7.2 貨站下拉含 HACTL / AAT / CPSL',
    html.includes('>HACTL<') && html.includes('>AAT<') && html.includes('>CPSL<'));
  check('7.3 有 ULD# 與 Contour 輸入（含建議清單）',
    html.includes('data-unit-field="uld_number"') && html.includes('data-unit-field="contour_code"') && html.includes('uldw-contour-list'));
  check('7.4 有 Tare / RCL（淨） / 物料欄位',
    html.includes('data-unit-field="tare_weight"') &&
    html.includes('data-unit-field="rcl_gross_weight"') &&
    html.includes('data-unit-field="material_weight"'));
  check('7.5 有 LIH 與 Pre-decl 選單（含 UN3481／UN3091）',
    html.includes('data-unit-field="lih_type"') && html.includes('UN3481') && html.includes('UN3091'));
  check('7.6 有夾重勾選框與夾重方式選單',
    html.includes('data-item-field="is_squeeze"') && html.includes('data-unit-field="squeeze_mode"') && html.includes('手動 %'));
  check('7.7 有兩張收貨單位卡', (html.match(/class="uldw-unit"/g) || []).length === 2,
    String((html.match(/class="uldw-unit"/g) || []).length));
  check('7.8 明細列有 MAWB# 與申報重量輸入',
    html.includes('data-item-field="mawb"') && html.includes('data-item-field="declared_weight"'));
  check('7.9 有「加入」MAWB 與「依件數拆分」按鈕',
    html.includes('data-action="add-item"') && html.includes('data-action="split-item"'));
  check('7.10 尾差選項（由最大票吸收）',
    html.includes('data-header="tail_mode"') && html.includes('由最大票吸收尾差'));
  check('7.11 草稿時「套用到 Booking」（W2）按鈕存在但禁用',
    /data-action="apply" disabled/.test(html), 'data-action="apply" disabled');

  // ===== 8. 局部更新不拋錯 =====
  console.log('\n--- 8. 局部更新 ---');
  let threw = false;
  try {
    render.refreshComputed(editorRoot);
  } catch (err) {
    threw = true;
    console.log(err);
  }
  check('8.1 refreshComputed 不拋錯（stub DOM 無子節點）', threw === false);

  // ===== 9. 鎖定狀態 =====
  console.log('\n--- 9. 鎖定狀態 ---');
  const lockedSheet = state.uldSheetFromApi(Object.assign({}, apiDetail(), { status: 'locked' }));
  state.uldWeightState.current = lockedSheet;
  const lockedRoot = makeRoot();
  render.renderEditor(lockedRoot);
  check('9.1 已鎖定：輸入框 disabled', lockedRoot.innerHTML.includes('disabled'));
  check('9.2 已鎖定：按鈕改為「解鎖」', lockedRoot.innerHTML.includes('data-action="unlock"'));
  check('9.3 已鎖定：儲存按鈕禁用', /data-action="save" disabled/.test(lockedRoot.innerHTML));
  check('9.4 已鎖定：「套用到 Booking」可按（W2）',
    /data-action="apply" title=/.test(lockedRoot.innerHTML) &&
    !/data-action="apply" disabled/.test(lockedRoot.innerHTML));

  // ===== 10. 邊界情況 =====
  console.log('\n--- 10. 邊界情況 ---');
  const emptyRoot = makeRoot();
  state.uldWeightState.current = state.uldSheetFromApi(Object.assign({}, apiDetail(), { ulds: [] }));
  let emptyThrew = false;
  try {
    render.renderEditor(emptyRoot);
  } catch (err) {
    emptyThrew = true;
    console.log(err);
  }
  check('10.1 空表渲染不拋錯（顯示提示）', emptyThrew === false && emptyRoot.innerHTML.includes('新增 ULD'));
  check('10.2 空表計算總計為 0', state.uldComputed().totals.netTotal === 0);
  check('10.3 uldFmtKg 顯示整數不帶小數', calc.uldFmtKg(1013) === '1013' && calc.uldFmtKg(1013.5) === '1013.5');

  // ===== 11. MAWB 從打板計劃 Booking Record 帶入（W1）=====
  console.log('\n--- 11. Booking Record 帶入（W1）---');
  const booking = await import(`${BASE}/booking-search.js`);
  const bookingRow = { id: 12, mawb: '160-00000777', dest: 'LAX', pcs: 12, gross_weight: 345.5 };
  const bookingText = booking.bookingLabel(bookingRow);
  check('11.1 下拉字串含 MAWB／DEST／件數／重量',
    bookingText.startsWith('160-00000777') && bookingText.includes('LAX') &&
    bookingText.includes('12件') && bookingText.includes('345.5kg'), bookingText);
  check('11.2 選到後只取 MAWB（不會把 DEST／件數寫進 MAWB 欄位）',
    booking.bookingLabelMawb(bookingText) === '160-00000777', booking.bookingLabelMawb(bookingText));
  const draftValues = booking.bookingDraftValues(bookingRow);
  check('11.3 Booking 帶入値：MAWB／Port／件數／重量／mawb_record_id',
    draftValues.mawb === '160-00000777' && draftValues.port === 'LAX' &&
    draftValues.pcs === '12' && draftValues.declared_weight === '345.5' && draftValues.mawb_record_id === 12,
    JSON.stringify(draftValues));
  check('11.4 沒有件數／重量時留空（不寫 0）',
    JSON.stringify(booking.bookingDraftValues({ id: 5, mawb: '160-1', dest: 'tpe', pcs: 0, gross_weight: 0 })) ===
    JSON.stringify({ mawb: '160-1', port: 'TPE', pcs: '', declared_weight: '', mawb_record_id: 5 }));
  check('11.5 沒有 Booking 時回傳 null', booking.bookingDraftValues(null) === null);
  check('11.6 新增的單位 draft 預設沒有 Booking 連結',
    state.uldNewUnit('ULD').draft.mawb_record_id === null && state.uldSheetFromApi(apiDetail()).ulds[0].draft.mawb_record_id === null);
  let wireThrew = false;
  try {
    booking.wireBookingPickers(null);        // 沒有 root
    booking.wireBookingPickers(editorRoot);  // 沒有 window.setupAutocomplete（退回純手動輸入）
  } catch (err) {
    wireThrew = true;
    console.log(err);
  }
  check('11.7 沒有 autocomplete 時 wireBookingPickers 安全跳過', wireThrew === false);
  check('11.8 「新增 MAWB」列有搜尋容器與帶入提示',
    html.includes('uldw-ac-field') && html.includes('data-draft-hint="mawb"'));

  const linkedDetail = apiDetail();
  linkedDetail.ulds[0].items[0].mawb_record_id = 99;
  state.uldWeightState.current = state.uldSheetFromApi(linkedDetail);
  const linkedRoot = makeRoot();
  render.renderEditor(linkedRoot);
  check('11.9 已連結的明細列顯示 Booking #99',
    linkedRoot.innerHTML.includes('已連結打板計劃 Booking Record #99'));

  // ===== 12. 輸入即篩選：選到 Booking 後自動帶入（模擬 setupAutocomplete）=====
  console.log('\n--- 12. 選到 Booking 自動帶入 ---');
  booking.resetBookingCache();
  let requestedUrl = '';
  globalThis.apiFetch = async (url) => {
    requestedUrl = url;
    return { data: [{ id: 31, mawb: '160-00000777', dest: 'LAX', pcs: 12, gross_weight: 345.5 }] };
  };
  const suggestions = await booking.bookingSuggestions('');
  check('12.1 取候選會呼叫 /api/uld-weight/bookings（limit=200）',
    requestedUrl.includes('/api/uld-weight/bookings') && requestedUrl.includes('limit=200'), requestedUrl);
  check('12.2 候選字串含 MAWB 與重量',
    suggestions.length === 1 && suggestions[0].includes('160-00000777') && suggestions[0].includes('345.5kg'),
    String(suggestions[0]));

  const draftSheet = state.uldSheetFromApi(apiDetail());
  state.uldWeightState.current = draftSheet;
  const draftUnit = draftSheet.ulds[0];

  const draftInputs = { port: { value: '' }, pcs: { value: '' }, declared_weight: { value: '' } };
  const draftHint = { textContent: '' };
  const draftForm = {
    querySelector(sel) {
      if (sel === 'input[data-draft="port"]') return draftInputs.port;
      if (sel === 'input[data-draft="pcs"]') return draftInputs.pcs;
      if (sel === 'input[data-draft="declared_weight"]') return draftInputs.declared_weight;
      if (sel === '[data-draft-hint="mawb"]') return draftHint;
      return null;
    }
  };
  const mawbInput = {
    value: '',
    dataset: {},
    listeners: {},
    addEventListener(type, fn) { this.listeners[type] = fn; },
    closest(sel) {
      if (sel === '.uldw-unit') return { dataset: { uid: draftUnit.uid } };
      if (sel === '.uldw-item-add') return draftForm;
      return null;
    }
  };
  let captured = null;
  globalThis.setupAutocomplete = config => { captured = config; };
  booking.wireBookingPickers({ querySelectorAll: () => [mawbInput] });
  check('12.3 每個 MAWB 輸入框都接上 setupAutocomplete', !!captured && typeof captured.onSelect === 'function');

  captured.onSelect(suggestions[0]);
  check('12.4 選到後 MAWB 只留號碼，件數／重量／Port 自動帶入',
    mawbInput.value === '160-00000777' && draftUnit.draft.pcs === '12' &&
    draftUnit.draft.declared_weight === '345.5' && draftUnit.draft.port === 'LAX' &&
    draftInputs.pcs.value === '12' && draftInputs.declared_weight.value === '345.5' && draftInputs.port.value === 'LAX',
    JSON.stringify({ mawb: mawbInput.value, draft: draftUnit.draft }));
  check('12.5 draft 記下 mawb_record_id', draftUnit.draft.mawb_record_id === 31, String(draftUnit.draft.mawb_record_id));
  check('12.6 顯示「已帶入 Booking #31」提示', draftHint.textContent.includes('Booking #31'), draftHint.textContent);

  mawbInput.value = '160-99999999';
  mawbInput.listeners.input();
  check('12.7 手動改 MAWB 會解除連結（仍可手動輸入）',
    draftUnit.draft.mawb_record_id === null && draftHint.textContent === '');

  const builtItem = state.uldNewItem({ mawb: '160-00000777', mawb_record_id: 31, pcs: 12, declared_weight: 345.5 });
  check('12.8 uldNewItem 保留 mawb_record_id 與帶入的重量',
    builtItem.mawb_record_id === 31 && builtItem.pcs === 12 && builtItem.declared_weight === 345.5);

  delete globalThis.setupAutocomplete;
  delete globalThis.apiFetch;

  // ===== 13. RCL 磅單匯入（W3）=====
  console.log('\n--- 13. RCL 磅單匯入（W3）---');
  const rclParse = await import(`${BASE}/rcl-parse.js`);
  const rclImport = await import(`${BASE}/rcl-import.js`);

  state.uldWeightState.current = state.uldSheetFromApi(apiDetail());
  state.uldWeightState.rclImport = null;
  const noRclRoot = makeRoot();
  render.renderEditor(noRclRoot);
  check('13.1 沒有匯入狀態時不顯示 RCL 面板', !noRclRoot.innerHTML.includes('uldw-rcl-panel'));

  const rclGrid = [
    ['PMC0003XX', '115', '540', '8'],
    ['PMC0004XX', '112', '1000', '3']
  ];
  const rclParsed = rclParse.rclRowsFromGrid(rclGrid, { uld: 0, tare: 1, gross: 2, pcs: 3 });
  state.uldWeightState.rclImport = {
    fileName: 'rcl-test.xlsx',
    sheetName: 'RCL',
    sheets: ['RCL', 'Sheet2'],
    headerRow: 3,
    header: ['ULD No', 'Tare', 'Gross Weight', 'Pcs'],
    columns: { uld: 0, tare: 1, gross: 2, pcs: 3 },
    grid: rclGrid,
    rows: rclParsed.rows,
    skipped: rclParsed.skipped,
    selected: [0]
  };
  const rclRoot = makeRoot();
  render.renderEditor(rclRoot);
  const rclHtml = rclRoot.innerHTML;
  check('13.2 匯入面板顯示檔名、工作表選擇與欄位對應',
    rclHtml.includes('rcl-test.xlsx') && rclHtml.includes('data-rcl="sheet"') && rclHtml.includes('data-rcl="col"'));
  check('13.3 面板列出可建立的單位（ULD#／Tare／Gross）',
    rclHtml.includes('uldw-rcl-panel') && rclHtml.includes('PMC0003XX') &&
    rclHtml.includes('PMC0004XX') && rclHtml.includes('1000'));
  check('13.4 已勾選的列標記 checked、未勾選的不勾',
    /data-rcl-row="0" checked/.test(rclHtml) && /data-rcl-row="1">/.test(rclHtml));
  check('13.5 有「加入選取的單位」與「取消匯入」按鈕',
    rclHtml.includes('data-action="rcl-add"') && rclHtml.includes('data-action="rcl-cancel"'));
  check('13.6 顯示已勾選數量（1／2）', rclHtml.includes('已勾選 1／2'));

  const switched = rclImport.applyRclColumns({
    grid: rclGrid,
    columns: { uld: 0, tare: -1, gross: 2, pcs: -1 }
  });
  check('13.7 改欄位對應後重算（Tare／件數變 0、磅重保留）',
    switched.rows.length === 2 && switched.rows[0].tare_weight === 0 &&
    switched.rows[0].pcs === 0 && switched.rows[0].rcl_gross_weight === 540,
    JSON.stringify(switched.rows[0]));
  check('13.8 selectedRclRows 只回傳勾選的列',
    rclImport.selectedRclRows({ rows: switched.rows, selected: [1] }).length === 1 &&
    rclImport.selectedRclRows({ rows: switched.rows, selected: [1] })[0].uld_number === 'PMC0004XX');
  check('13.9 ULD# 正規化（去空白、轉大寫）', rclImport.rclUldKey(' pmc 0003 xx ') === 'PMC0003XX');

  state.uldWeightState.current = state.uldSheetFromApi(Object.assign({}, apiDetail(), { status: 'locked' }));
  state.uldWeightState.rclImport = null;
  const lockedRclRoot = makeRoot();
  render.renderEditor(lockedRclRoot);
  check('13.10 已鎖定時「匯入 RCL」按鈕 disabled',
    /data-action="import-rcl" disabled/.test(lockedRclRoot.innerHTML));

  // ===== 14. 列印／另存 PDF（W4）=====
  console.log('\n--- 14. 列印／PDF 報表（W4）---');
  state.uldWeightState.current = state.uldSheetFromApi(apiDetail());
  state.uldWeightState.rclImport = null;
  const draftPrintRoot = makeRoot();
  render.renderEditor(draftPrintRoot);
  const draftHtml = draftPrintRoot.innerHTML;
  const actionsIdx = draftHtml.indexOf('class="uldw-editor-actions"');
  const printIdx = draftHtml.indexOf('data-action="print"');
  check('14.1 編輯畫面有「🖨 列印」按鈕（data-action="print"）',
    printIdx > -1 && draftHtml.includes('🖨 列印'));
  check('14.2 草稿可以直接列印（按鈕沒有 disabled）',
    printIdx > -1 && !/data-action="print"[^>]*\sdisabled/.test(draftHtml));
  check('14.3 列印按鈕在 .uldw-editor-actions 內（不在匯入面板）',
    actionsIdx > -1 && printIdx > actionsIdx && !draftHtml.slice(actionsIdx, printIdx).includes('</div>'));

  state.uldWeightState.current = state.uldSheetFromApi(Object.assign({}, apiDetail(), { status: 'locked' }));
  const lockedPrintRoot = makeRoot();
  render.renderEditor(lockedPrintRoot);
  check('14.4 已鎖定時列印按鈕仍在且可用（草稿／鎖定都能列印）',
    /data-action="print"/.test(lockedPrintRoot.innerHTML) &&
    !/data-action="print"[^>]*\sdisabled/.test(lockedPrintRoot.innerHTML) &&
    /data-action="save" disabled/.test(lockedPrintRoot.innerHTML));

  const cssText = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'uld-weight.css'), 'utf8');
  const printBlock = cssText.slice(cssText.indexOf('@media print'));
  // 在 @media print 區塊裡找「包含某選擇器且同時有指定宣告」的規則
  function printRule(selector, ...decls) {
    return printBlock.split('}').some(chunk => chunk.includes(selector) && decls.every(d => chunk.includes(d)));
  }
  check('14.5 CSS 有 @media print 與 A4 直式 @page', printBlock.length > 0 &&
    printBlock.includes('@page') && /A4 portrait/.test(printBlock));
  check('14.6 列印時隱藏側欄／操作按鈕區／RCL 匯入面板',
    printRule('.sidebar', 'display: none') &&
    printRule('.uldw-editor-actions', 'display: none') &&
    printRule('.uldw-rcl', 'display: none') &&
    printRule('.uldw-btn', 'display: none'));
  check('14.7 收貨單位卡與全表合計不跨頁（break-inside: avoid）',
    printRule('.uldw-unit', 'break-inside: avoid') &&
    printRule('.uldw-totals', 'break-inside: avoid'));
  check('14.8 列印數字欄等寬對齊（tabular-nums）',
    printRule('.uldw-final-cell', 'font-variant-numeric: tabular-nums') &&
    printRule('.uldw-totals-grid', 'font-variant-numeric: tabular-nums'));
  check('14.9 輸入框／下拉去框線、鎖定灰字改回黑色',
    printRule('.uldw-items input', 'border: none', '-webkit-text-fill-color: #000'));
  check('14.10 列印改單欄且表格不裁切（overflow: visible）',
    printRule('.uldw-columns', 'display: block') &&
    printRule('.uldw-table-wrap', 'overflow: visible'));

  // ===== 15. 磅差門檻可調 ＋ LIH 檢核細分（W5）=====
  console.log('\n--- 15. 磅差門檻可調 ＋ LIH 檢核細分（W5）---');
  const legacyDetail = apiDetail();
  delete legacyDetail.diff_warn_pct;
  delete legacyDetail.diff_warn_kg;
  const mappedLegacy = state.uldSheetFromApi(legacyDetail);
  check('15.1 舊資料沒有門檻欄位 → 預設 2% / 100kg',
    mappedLegacy.diff_warn_pct === 2 && mappedLegacy.diff_warn_kg === 100);

  const mappedWarn = state.uldSheetFromApi(Object.assign({}, apiDetail(), { diff_warn_pct: 5, diff_warn_kg: 50 }));
  check('15.2 API 回傳的門檻會帶進編輯狀態', mappedWarn.diff_warn_pct === 5 && mappedWarn.diff_warn_kg === 50);
  const payloadWarn = state.uldSheetPayload(mappedWarn);
  check('15.3 PUT payload 帶門檻（PUT／GET 往返不遺失）',
    payloadWarn.diff_warn_pct === 5 && payloadWarn.diff_warn_kg === 50);
  const payloadZero = state.uldSheetPayload(Object.assign({}, mappedWarn, { diff_warn_pct: 0, diff_warn_kg: '' }));
  check('15.4 門檻 0／空白 → payload 回預設 2 / 100',
    payloadZero.diff_warn_pct === 2 && payloadZero.diff_warn_kg === 100);

  state.uldWeightState.current = state.uldSheetFromApi(apiDetail());
  state.uldWeightState.rclImport = null;
  const headerRoot = makeRoot();
  render.renderEditor(headerRoot);
  const headerHtml = headerRoot.innerHTML;
  check('15.5 表頭有「磅差警示 %／kg」兩個數字輸入（data-header）',
    headerHtml.includes('data-header="diff_warn_pct"') && headerHtml.includes('data-header="diff_warn_kg"'));
  check('15.6 表頭輸入顯示目前門檻（2 / 100）',
    /data-header="diff_warn_pct" value="2"/.test(headerHtml) && /data-header="diff_warn_kg" value="100"/.test(headerHtml));
  check('15.7 列印時門檻欄位不印（uldw-print-hide）',
    /class="uldw-print-hide"[^>]*>磅差警示 %/.test(headerHtml) &&
    /class="uldw-print-hide"[^>]*>磅差警示 kg/.test(headerHtml));

  // 同一份資料、只改門檻 → 檢核結果跟著變（門檻走 calc.uldComputeSheet 的 src.diff_warn_*）
  function diffSheet(diffPct, diffKg) {
    return {
      id: 99, sheet_no: 'WGT-20261105-99', sheet_date: '2026-11-05', terminal: 'CPSL', status: 'draft',
      round_px: 1, round_b: 1, tail_mode: 'adjust_largest',
      diff_warn_pct: diffPct, diff_warn_kg: diffKg,
      ulds: [{
        uid: 'u1', kind: 'ULD', uld_number: 'PMC9999XX', tare_weight: 0, rcl_gross_weight: 1000,
        pcs: 1, lih_type: 'N', predecl_type: 'P', squeeze_mode: 'weight',
        items: [{ uid: 'i1', mawb: '160-00000099', pcs: 1, declared_weight: 980, is_squeeze: true, lih_type: 'N' }]
      }]
    };
  }
  state.uldWeightState.current = diffSheet(2, 100);
  const looseComputed = state.uldComputed();
  state.uldWeightState.current = diffSheet(1, 10);
  const tightComputed = state.uldComputed();
  check('15.8 門檻放寬（2%／100kg）不警示、收緊（1%／10kg）警示 DIFF_TOO_BIG',
    !looseComputed.issues.some(i => i.code === 'DIFF_TOO_BIG') &&
    tightComputed.issues.some(i => i.code === 'DIFF_TOO_BIG'),
    `loose=${looseComputed.issues.map(i => i.code)} tight=${tightComputed.issues.map(i => i.code)}`);

  const lihLabels = Object.keys(calc.ULD_ISSUE_LABELS).filter(k => k.startsWith('LIH_')).sort();
  check('15.9 LIH 檢核已細分為 3 個代碼（舊 LIH_MISMATCH 已移除）',
    calc.ULD_ISSUE_LABELS.LIH_MISMATCH === undefined &&
    lihLabels.join(',') === 'LIH_UNIT_MISSING,LIH_UNIT_ONLY,LIH_UN_CODE_MISMATCH', lihLabels.join(','));

  const lihSheet = diffSheet(2, 100);
  lihSheet.ulds[0].items[0].lih_type = 'UN3481';
  state.uldWeightState.current = lihSheet;
  const lihComputed = state.uldComputed();
  const lihIssue = lihComputed.issues.find(i => i.code === 'LIH_UNIT_MISSING');
  check('15.10 票標 UN3481、板標 N → LIH_UNIT_MISSING（訊息帶 UN 編號）',
    !!lihIssue && calc.uldIssueText(lihIssue).includes('UN3481'), lihIssue ? calc.uldIssueText(lihIssue) : '（沒有檢核）');

  // ===== 16. 多票夾重比例上下限（R2）=====
  console.log('\n--- 16. 多票夾重比例上下限（R2）---');
  const legacyNoClamp = apiDetail();
  delete legacyNoClamp.clamp_min_pct;
  delete legacyNoClamp.clamp_max_pct;
  const mappedNoClamp = state.uldSheetFromApi(legacyNoClamp);
  check('16.1 舊資料沒有比例上下限 → 預設 0／0（＝不限）',
    mappedNoClamp.clamp_min_pct === 0 && mappedNoClamp.clamp_max_pct === 0);

  const mappedClamp = state.uldSheetFromApi(Object.assign({}, apiDetail(), { clamp_min_pct: 20, clamp_max_pct: 60 }));
  check('16.2 API 回傳的上下限會帶進編輯狀態',
    mappedClamp.clamp_min_pct === 20 && mappedClamp.clamp_max_pct === 60);
  const payloadClamp = state.uldSheetPayload(mappedClamp);
  check('16.3 PUT payload 帶上下限（PUT／GET 往返不遺失）',
    payloadClamp.clamp_min_pct === 20 && payloadClamp.clamp_max_pct === 60);
  const payloadClampZero = state.uldSheetPayload(Object.assign({}, mappedClamp, { clamp_min_pct: '', clamp_max_pct: 0 }));
  check('16.4 上下限空白／0 → payload 回 0（不限）',
    payloadClampZero.clamp_min_pct === 0 && payloadClampZero.clamp_max_pct === 0);

  state.uldWeightState.current = state.uldSheetFromApi(apiDetail());
  state.uldWeightState.rclImport = null;
  const clampRoot = makeRoot();
  render.renderEditor(clampRoot);
  const clampHtml = clampRoot.innerHTML;
  check('16.5 表頭有「比例下限 %／比例上限 %」兩個數字輸入（data-header）',
    clampHtml.includes('data-header="clamp_min_pct"') && clampHtml.includes('data-header="clamp_max_pct"'));
  check('16.6 表頭輸入顯示目前上下限（0／0 = 不限）',
    /data-header="clamp_min_pct" value="0"/.test(clampHtml) &&
    /data-header="clamp_max_pct" value="0"/.test(clampHtml));
  check('16.7 列印時上下限欄位不印（uldw-print-hide）',
    /class="uldw-print-hide"[^>]*>比例下限 %/.test(clampHtml) &&
    /class="uldw-print-hide"[^>]*>比例上限 %/.test(clampHtml));

  // 同一份票、只改上限 → 比例被壓下來（走 calc.uldComputeSheet 的 src.clamp_max_pct）
  function clampSheetState(maxPct) {
    return {
      id: 98, sheet_no: 'WGT-20261105-98', sheet_date: '2026-11-05', terminal: 'CPSL', status: 'draft',
      round_px: 1, round_b: 1, tail_mode: 'adjust_largest',
      diff_warn_pct: 2, diff_warn_kg: 100, clamp_min_pct: 0, clamp_max_pct: maxPct,
      ulds: [{
        uid: 'u1', kind: 'ULD', uld_number: 'PMC9998XX', tare_weight: 0, rcl_gross_weight: 2000,
        pcs: 11, lih_type: 'N', predecl_type: 'X', squeeze_mode: 'weight',
        items: [
          { uid: 'i1', mawb: '160-00000071', pcs: 9, declared_weight: 900, is_squeeze: true, lih_type: 'N' },
          { uid: 'i2', mawb: '160-00000072', pcs: 1, declared_weight: 50, is_squeeze: true, lih_type: 'N' },
          { uid: 'i3', mawb: '160-00000073', pcs: 1, declared_weight: 50, is_squeeze: true, lih_type: 'N' }
        ]
      }]
    };
  }
  state.uldWeightState.current = clampSheetState(0);
  const noClampComputed = state.uldComputed();
  state.uldWeightState.current = clampSheetState(40);
  const maxClampComputed = state.uldComputed();
  check('16.8 沒設限時最大票比例 90%；上限 40% 時被壓到 40%（ratioClamped 標記）',
    Math.abs(noClampComputed.units[0].calc.items[0].ratio - 0.9) < 1e-9 &&
    Math.abs(maxClampComputed.units[0].calc.items[0].ratio - 0.4) < 1e-9 &&
    maxClampComputed.units[0].calc.items[0].ratioClamped === true,
    `no=${noClampComputed.units[0].calc.items[0].ratio} max=${maxClampComputed.units[0].calc.items[0].ratio}`);
  check('16.9 上限生效後合計仍等於目標淨重 2000（尾差照原規則）',
    Math.abs(maxClampComputed.units[0].calc.finalSum - 2000) < 1e-6,
    String(maxClampComputed.units[0].calc.finalSum));

  const infeasibleState = clampSheetState(30);
  infeasibleState.ulds[0].items = infeasibleState.ulds[0].items.slice(0, 2);
  infeasibleState.ulds[0].rcl_gross_weight = 1100;
  state.uldWeightState.current = infeasibleState;
  const infeasibleComputed = state.uldComputed();
  check('16.10 上下限無解（上限 30% × 2 票）→ 檢核出現 CLAMP_INFEASIBLE（warn）',
    infeasibleComputed.issues.some(i => i.code === 'CLAMP_INFEASIBLE' && i.level === 'warn'),
    JSON.stringify(infeasibleComputed.issues.map(i => i.code)));

  // ===== 17. 明細 diff 更新（R3）＋ server 端 PDF 入口（R1）=====
  console.log('\n--- 17. 明細 diff 更新（R3）＋ PDF 入口（R1）---');
  const idSheet = state.uldSheetFromApi(apiDetail());
  const idPayload = state.uldSheetPayload(idSheet);
  check('17.1 payload 帶收貨單位的 DB id（11／12）',
    idPayload.ulds[0].id === 11 && idPayload.ulds[1].id === 12,
    JSON.stringify(idPayload.ulds.map(u => u.id)));
  check('17.2 payload 帶明細的 DB id（21／22／23）',
    idPayload.ulds[0].items[0].id === 21 && idPayload.ulds[0].items[1].id === 22 && idPayload.ulds[1].items[0].id === 23,
    JSON.stringify(idPayload.ulds.map(u => u.items.map(it => it.id))));
  check('17.3 明細仍不含前端 uid（只多帶 DB id）',
    idPayload.ulds.every(u => u.items.every(it => it.uid === undefined)));

  const newUnitSheet = state.uldSheetFromApi(apiDetail());
  newUnitSheet.ulds.push(state.uldNewUnit('ULD'));
  newUnitSheet.ulds[0].items.push(state.uldNewItem({ mawb: '160-00000007', declared_weight: 10 }));
  const newUnitPayload = state.uldSheetPayload(newUnitSheet);
  check('17.4 新加入的單位／明細 id 為 null（後端會 INSERT）',
    newUnitPayload.ulds[2].id === null && newUnitPayload.ulds[0].items[2].id === null,
    `${newUnitPayload.ulds[2].id}／${newUnitPayload.ulds[0].items[2].id}`);
  check('17.5 刪掉一列後 payload 不再帶該 id（後端會 DELETE）',
    (() => {
      const trimmed = state.uldSheetFromApi(apiDetail());
      trimmed.ulds[0].items = trimmed.ulds[0].items.filter(it => it.id !== 22);
      const p = state.uldSheetPayload(trimmed);
      return p.ulds[0].items.length === 1 && p.ulds[0].items[0].id === 21;
    })());

  state.uldWeightState.current = state.uldSheetFromApi(apiDetail());
  state.uldWeightState.rclImport = null;
  const pdfRoot = makeRoot();
  render.renderEditor(pdfRoot);
  check('17.6 編輯畫面有「⤓ PDF」按鈕（data-action="pdf"）',
    pdfRoot.innerHTML.includes('data-action="pdf"') && !/data-action="pdf"[^>]*\sdisabled/.test(pdfRoot.innerHTML));

  // ===== 18. 批次 PDF（V2：清單勾選 → 多張打包 ZIP）=====
  console.log('\n--- 18. 批次 PDF（V2）---');
  const listRows = [
    {
      id: 1, sheet_no: 'WGT-20261105-01', sheet_date: '2026-11-05', terminal: 'CPSL', flight_no: 'CX1234',
      status: 'locked', uld_count: 2, bulk_count: 0, item_count: 3,
      rcl_total: 1540, net_total: 1313, diff_total: 0
    },
    {
      id: 2, sheet_no: 'WGT-20261105-02', sheet_date: '2026-11-05', terminal: 'HACTL', flight_no: 'CX5678',
      status: 'draft', uld_count: 1, bulk_count: 1, item_count: 2,
      rcl_total: 800, net_total: 700, diff_total: -5
    }
  ];
  state.uldWeightState.sheets = listRows;
  state.uldWeightState.batchSelected = [];
  const batchRoot = makeRoot();
  render.renderList(batchRoot);
  const batchHtml = batchRoot.innerHTML;
  check('18.1 清單有批次勾選欄與「批次 PDF」按鈕（data-batch-id／data-action="batch-pdf"）',
    (batchHtml.match(/data-batch-id="/g) || []).length === 2 &&
    batchHtml.includes('data-action="batch-pdf"'));
  check('18.2 沒勾選時批次按鈕是 disabled（顯示「已選 0 張」）',
    /data-action="batch-pdf"[\s\S]{0,200}?disabled/.test(batchHtml) && batchHtml.includes('已選 0 張'));
  check('18.3 清單有全選 checkbox（id="uldw-batch-all"）且未全選時不勾',
    batchHtml.includes('id="uldw-batch-all"') && !/id="uldw-batch-all"[^>]*checked/.test(batchHtml));

  state.uldWeightState.batchSelected = [2];
  const batchRoot2 = makeRoot();
  render.renderList(batchRoot2);
  const batchHtml2 = batchRoot2.innerHTML;
  check('18.4 勾選後：該列 checked、列有 is-batch-selected、按鈕可用、顯示「已選 1 張」',
    /data-batch-id="2" checked/.test(batchHtml2) &&
    !/data-batch-id="1" checked/.test(batchHtml2) &&
    batchHtml2.includes('is-batch-selected') &&
    batchHtml2.includes('已選 1 張') &&
    !/data-action="batch-pdf"[\s\S]{0,200}?disabled/.test(batchHtml2));

  state.uldWeightState.batchSelected = [1, 2];
  const batchRoot3 = makeRoot();
  render.renderList(batchRoot3);
  check('18.5 全部勾選時全選 checkbox 會打勾（已選 2 張）',
    /id="uldw-batch-all"[^>]*checked/.test(batchRoot3.innerHTML) && batchRoot3.innerHTML.includes('已選 2 張'));

  const apiText = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'uldweight', 'api.js'), 'utf8');
  check('18.6 api.js 有 fetchBatchPdfBlob（打 /sheets/batch-pdf 並帶 ids）',
    /export async function fetchBatchPdfBlob/.test(apiText) &&
    apiText.includes('/api/uld-weight/sheets/batch-pdf') &&
    apiText.includes("query.set('ids'"));
  const entryText = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'uld-weight.js'), 'utf8');
  check('18.7 入口有 batch-pdf 分派與 downloadBatchPdf()（ZIP 下載）',
    /case 'batch-pdf':\s*downloadBatchPdf\(\)/.test(entryText) &&
    /async function downloadBatchPdf\(/.test(entryText) &&
    entryText.includes(".zip"));

  // ===== 19. 補建 Booking Record（V1：先預覽再寫入）=====
  console.log('\n--- 19. 補建 Booking Record（V1）---');
  state.uldWeightState.current = state.uldSheetFromApi(apiDetail());
  state.uldWeightState.rclImport = null;
  const syncRoot = makeRoot();
  render.renderEditor(syncRoot);
  const syncHtml = syncRoot.innerHTML;
  check('19.1 編輯畫面有「⇧ 補建 Booking」按鈕（data-action="sync-bookings"）',
    syncHtml.includes('data-action="sync-bookings"') && syncHtml.includes('補建 Booking'));
  check('19.2 草稿時補建按鈕可用（不需要先鎖定）',
    !/data-action="sync-bookings"[^>]*\sdisabled/.test(syncHtml));
  const lockedDetail = Object.assign({}, apiDetail(), { status: 'locked' });
  state.uldWeightState.current = state.uldSheetFromApi(lockedDetail);
  const syncLockedRoot = makeRoot();
  render.renderEditor(syncLockedRoot);
  check('19.3 已鎖定時補建按鈕仍可用（建立 Booking 不算改重量）',
    !/data-action="sync-bookings"[^>]*\sdisabled/.test(syncLockedRoot.innerHTML));

  check('19.4 api.js 有 syncSheetBookings（打 /sync-bookings 並帶 dry_run）',
    /export async function syncSheetBookings/.test(apiText) &&
    apiText.includes('/sync-bookings') &&
    apiText.includes('dry_run'));
  check('19.5 入口有 sync-bookings 分派，且先用 dryRun 預覽、確認後才寫入',
    /case 'sync-bookings':\s*syncBookings\(\)/.test(entryText) &&
    /async function syncBookings\(/.test(entryText) &&
    /syncSheetBookings\([^)]*\{\s*dryRun:\s*true\s*\}/.test(entryText) &&
    /syncSheetBookings\([^)]*\{\s*dryRun:\s*false\s*\}/.test(entryText));

  // ===== 20. 版本紀錄／異動比對（V3）=====
  console.log('\n--- 20. 版本紀錄／異動比對（V3）---');
  function snapshotFixture() {
    return {
      header: {
        sheet_date: '2026-11-05', terminal: 'CPSL', flight_no: 'CX1234', flight_date: '2026-11-05',
        round_px: 1, round_b: 0.5, tail_mode: 'adjust_largest',
        diff_warn_pct: 2, diff_warn_kg: 100, clamp_min_pct: 0, clamp_max_pct: 0,
        handler: 'tester', remark: '', status: 'draft'
      },
      units: [
        {
          id: 11, seq: 0, kind: 'ULD', uld_number: 'PMC0003XX', bulk_ref: '', rcl_no: '',
          contour_code: 'ZQ', port: 'HKG', pcs: 8, tare_weight: 115, rcl_gross_weight: 425,
          material_weight: 0, lih_type: 'N', predecl_type: 'X', squeeze_mode: 'weight',
          net_weight: 425, diff_weight: 0,
          items: [
            { id: 21, seq: 0, mawb: '160-00000005', mawb_record_id: null, port: 'HKG', pcs: 5, declared_weight: 300, final_weight: 300, is_squeeze: 0, squeeze_ratio: null, lih_type: 'N' },
            { id: 22, seq: 1, mawb: '160-00000006', mawb_record_id: null, port: 'TPE', pcs: 3, declared_weight: 125, final_weight: 125, is_squeeze: 1, squeeze_ratio: null, lih_type: 'N' }
          ]
        },
        {
          id: 12, seq: 1, kind: 'ULD', uld_number: 'PMC0004XX', bulk_ref: '', rcl_no: '',
          contour_code: 'PMC', port: 'HKG', pcs: 3, tare_weight: 112, rcl_gross_weight: 888,
          material_weight: 0, lih_type: 'N', predecl_type: 'P', squeeze_mode: 'weight',
          net_weight: 888, diff_weight: 0,
          items: [
            { id: 23, seq: 0, mawb: '160-00000006', mawb_record_id: null, port: 'TPE', pcs: 3, declared_weight: 888, final_weight: 888, is_squeeze: 1, squeeze_ratio: null, lih_type: 'N' }
          ]
        }
      ]
    };
  }
  const snapA = snapshotFixture();
  const sameDiff = versionDiff.uldDiffSnapshots(snapA, snapshotFixture());
  check('20.1 兩份相同快照 → hasChanges = false（所有計數都是 0）',
    sameDiff.hasChanges === false &&
    Object.keys(sameDiff.summary).every(key => sameDiff.summary[key] === 0),
    JSON.stringify(sameDiff.summary));

  const snapHeader = snapshotFixture();
  snapHeader.header.flight_no = 'CX9999';
  snapHeader.header.diff_warn_kg = 50;
  const headerDiff = versionDiff.uldDiffSnapshots(snapA, snapHeader);
  check('20.2 表頭改 2 個欄位 → header 2 筆（label／from／to）',
    headerDiff.summary.header === 2 &&
    headerDiff.header.some(c => c.label === '航班' && c.from === 'CX1234' && c.to === 'CX9999') &&
    headerDiff.header.some(c => c.label === '磅差警示 kg' && Number(c.to) === 50),
    JSON.stringify(headerDiff.header));

  const snapUnit = snapshotFixture();
  snapUnit.units[0].tare_weight = 120;
  snapUnit.units[0].port = 'TPE';
  const unitDiff = versionDiff.uldDiffSnapshots(snapA, snapUnit);
  check('20.3 單位改 Tare／Port → units.changed 1 筆（欄位 2 個、kg 標記）',
    unitDiff.summary.unitsChanged === 1 &&
    unitDiff.units.changed[0].fields.length === 2 &&
    unitDiff.units.changed[0].fields.some(f => f.label === 'Tare' && f.kg === true && Number(f.to) === 120),
    JSON.stringify(unitDiff.units.changed));

  const snapItem = snapshotFixture();
  snapItem.units[0].items[1].declared_weight = 130;
  snapItem.units[0].items[1].final_weight = 130;
  const itemDiff = versionDiff.uldDiffSnapshots(snapA, snapItem);
  check('20.4 明細改申報重量／最終重量 → items.changed 1 筆（帶 MAWB）',
    itemDiff.summary.itemsChanged === 1 &&
    itemDiff.items.changed[0].mawb === '160-00000006' &&
    itemDiff.items.changed[0].fields.some(f => f.label === '申報重量' && Number(f.from) === 125 && Number(f.to) === 130),
    JSON.stringify(itemDiff.items.changed));

  const snapNewUnit = snapshotFixture();
  snapNewUnit.units.push({
    id: null, seq: 2, kind: 'BULK', uld_number: '', bulk_ref: 'BULK-1', rcl_no: '',
    contour_code: '', port: 'HKG', pcs: 2, tare_weight: 0, rcl_gross_weight: 200,
    material_weight: 0, lih_type: 'N', predecl_type: 'B', squeeze_mode: 'weight',
    net_weight: 200, diff_weight: 0,
    items: [{ id: null, seq: 0, mawb: '160-00000007', mawb_record_id: null, port: 'HKG', pcs: 2, declared_weight: 200, final_weight: 200, is_squeeze: 1, squeeze_ratio: null, lih_type: 'N' }]
  });
  const addDiff = versionDiff.uldDiffSnapshots(snapA, snapNewUnit);
  check('20.5 新增一個散貨單位 → units.added 1、items.added 1（標籤為「散貨 BULK-1」）',
    addDiff.summary.unitsAdded === 1 && addDiff.summary.itemsAdded === 1 &&
    addDiff.units.added[0].label.includes('BULK-1') &&
    addDiff.items.added[0].mawb === '160-00000007',
    JSON.stringify(addDiff.units.added));
  const removeDiff = versionDiff.uldDiffSnapshots(snapNewUnit, snapA);
  check('20.6 反向比對（單位被刪除）→ units.removed 1、items.removed 1',
    removeDiff.summary.unitsRemoved === 1 && removeDiff.summary.itemsRemoved === 1,
    JSON.stringify(removeDiff.summary));

  const snapshotSummary = versionDiff.uldSnapshotSummary(snapA);
  check('20.7 uldSnapshotSummary：2 單位／3 票／2 個 MAWB／淨重 1313',
    snapshotSummary.uldCount === 2 && snapshotSummary.itemCount === 3 && snapshotSummary.mawbCount === 2 &&
    Math.abs(snapshotSummary.netTotal - 1313) < 1e-6,
    JSON.stringify(snapshotSummary));

  state.uldWeightState.current = state.uldSheetFromApi(apiDetail());
  state.uldWeightState.rclImport = null;
  state.uldWeightState.versions = { open: false, loading: false, list: [], error: '' };
  state.uldWeightState.versionDiff = null;
  const verRoot = makeRoot();
  render.renderEditor(verRoot);
  check('20.8 編輯畫面有「🕘 版本」按鈕（data-action="versions"）',
    verRoot.innerHTML.includes('data-action="versions"'));

  state.uldWeightState.versions = {
    open: true,
    loading: false,
    error: '',
    list: [
      {
        id: 2, version_no: 2, action: 'save', status: 'draft', note: '', created_at: '2026-11-06T03:04:05Z',
        created_by: 'admin', summary: { uldCount: 2, itemCount: 3, netTotal: 1313, diffTotal: 0 }
      },
      {
        id: 1, version_no: 1, action: 'create', status: 'draft', note: '', created_at: '2026-11-06T02:00:00Z',
        created_by: 'admin', summary: { uldCount: 0, itemCount: 0, netTotal: 0, diffTotal: 0 }
      }
    ]
  };
  const verRoot2 = makeRoot();
  render.renderEditor(verRoot2);
  const verHtml = verRoot2.innerHTML;
  check('20.9 版本面板列出 v1／v2 與「與前一版比／對目前」按鈕',
    verHtml.includes('id="uldw-versions"') && verHtml.includes('>v1<') && verHtml.includes('>v2<') &&
    verHtml.includes('data-action="version-diff"') && verHtml.includes('與前一版比') &&
    verHtml.includes('對目前') && verHtml.includes('data-action="versions-close"'));

  state.uldWeightState.versionDiff = {
    loading: false,
    from: { id: 1, version_no: 1 },
    to: { id: 0, version_no: 0 },
    data: headerDiff
  };
  const verRoot3 = makeRoot();
  render.renderEditor(verRoot3);
  const diffHtml = verRoot3.innerHTML;
  check('20.10 比對結果會顯示表頭差異（v1 → 目前內容）',
    diffHtml.includes('v1 → 目前內容') && diffHtml.includes('航班') && diffHtml.includes('CX9999') &&
    diffHtml.includes('uldw-diff-list'));

  check('20.11 api.js 有 fetchSheetVersions／fetchVersionDiff（打 /versions）',
    /export async function fetchSheetVersions/.test(apiText) &&
    /export async function fetchVersionDiff/.test(apiText) &&
    apiText.includes('/versions?') && apiText.includes('/versions/diff?'));
  check('20.12 入口有 versions／versions-close／version-diff 分派',
    /case 'versions':\s*openVersions\(\)/.test(entryText) &&
    /case 'versions-close':\s*closeVersions\(\)/.test(entryText) &&
    /case 'version-diff':\s*compareVersions\(/.test(entryText));

  // ===== 21. 直觀版（U1／U2／U3）=====
  console.log('\n--- 21. 直觀版：減法版面／貼上多列／單板 Loading Sheet ---');
  const renderText = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'uldweight', 'render.js'), 'utf8');
  const stateText = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'uldweight', 'state.js'), 'utf8');
  const routeText = fs.readFileSync(path.join(__dirname, '..', 'routes', 'uld-weight.js'), 'utf8');
  const pdfText = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'uld-weight-report-pdf.js'), 'utf8');

  state.uldWeightState.current = state.uldSheetFromApi(apiDetail());
  state.uldWeightState.rclImport = null;
  state.uldWeightState.ui = { view: 'cards', more: false, advanced: false, expanded: {}, allCompact: false, printUnit: null };
  const uxRoot = makeRoot();
  render.renderEditor(uxRoot);
  const uxHtml = uxRoot.innerHTML;

  // U1：工具列減法（低頻動作收進「⋯ 更多」，但仍在 .uldw-editor-actions 內）
  const moreIdx = uxHtml.indexOf('class="uldw-more');
  check('21.1 工具列有「⋯ 更多」（低頻動作收起來）',
    moreIdx > -1 && uxHtml.includes('data-action="toggle-more"'));
  check('21.2 apply／補建／版本／列印／PDF／複製／刪除都在「更多」選單內',
    ['apply', 'sync-bookings', 'versions', 'print', 'pdf', 'duplicate', 'delete']
      .every(action => uxHtml.indexOf(`data-action="${action}"`) > moreIdx),
    String(moreIdx));

  // U1：進階表頭欄位收在 .uldw-adv（值仍會送出）
  const advIdx = uxHtml.indexOf('class="uldw-adv');
  check('21.3 有「⚙ 進階」開關，6 個進階欄位都在收合區內',
    uxHtml.includes('data-action="toggle-adv"') && advIdx > -1 &&
    ['diff_warn_pct', 'diff_warn_kg', 'clamp_min_pct', 'clamp_max_pct', 'round_b', 'tail_mode']
      .every(f => uxHtml.indexOf(`data-header="${f}"`) > advIdx));

  // U1：卡片網格＋板序代號＋拖曳把手
  check('21.4 卡片區是網格（CSS）', /\.uldw-unit-list\s*\{[^}]*display:\s*grid/.test(cssText));
  check('21.5 卡片有拖曳把手與板序代號 01/A',
    uxHtml.includes('data-drag-handle') && uxHtml.includes('>01/A<') && uxHtml.includes('>02/B<'));
  check('21.6 unitCode()：0→01/A、25→26/Z、26→27/AA（可到 41 板）',
    render.unitCode(0) === '01/A' && render.unitCode(25) === '26/Z' &&
    render.unitCode(26) === '27/AA' && render.unitCode(40) === '41/AO');

  // U2：卡片操作（收合／單板 PDF／單板列印／貼上多列）
  check('21.7 卡片有收合、單板 PDF、單板列印、貼上多列',
    ['toggle-unit', 'pdf-unit', 'print-unit', 'paste-items', 'toggle-compact']
      .every(action => uxHtml.includes(`data-action="${action}"`)));

  // U2：貼上多列（共用純函式）
  const paste = await import(`${BASE}/paste-parse.js`);
  const paste4 = paste.uldParsePastedRows('369-9649 4182\tTLV\t60\t1122\n369-9649 4193\tTLV\t1\t70');
  check('21.8 貼上 4 欄（MAWB／DEST／PCS／WT）→ 2 列、值正確',
    paste4.rows.length === 2 && paste4.rows[0].port === 'TLV' &&
    paste4.rows[0].pcs === 60 && paste4.rows[0].weight === 1122,
    JSON.stringify(paste4.rows[0]));
  const paste3 = paste.uldParsePastedRows('369-9649 4543,45,698');
  check('21.9 貼上 3 欄（MAWB／PCS／WT）也能解析',
    paste3.rows.length === 1 && paste3.rows[0].pcs === 45 && paste3.rows[0].weight === 698,
    JSON.stringify(paste3.rows[0]));
  const pasteHeader = paste.uldParsePastedRows('MAWB\tDEST\tPCS\tWT\n369-9649 5560\tTLV\t100\t310');
  check('21.10 表頭列自動略過，只留資料列',
    pasteHeader.rows.length === 1 && pasteHeader.rows[0].mawb === '369-9649 5560',
    JSON.stringify(pasteHeader.rows));
  check('21.11 看不出 MAWB# 的列會列入 skipped',
    paste.uldParsePastedRows('hello\nworld').rows.length === 0 &&
    paste.uldParsePastedRows('hello\nworld').skipped.length === 2);

  // U1：合計列照業界讀法（PLAN TTL／RCL TTL／DIFF，單位 kg）
  check('21.12 合計列顯示 PLAN TTL／RCL TTL／DIFF 且單位是 kg',
    renderText.includes('PLAN TTL') && renderText.includes('RCL TTL') &&
    renderText.includes('>DIFF<') && renderText.includes('</b> kg'));

  // U1：色碼（紅＝夾重、橙＝WT 已改）
  check('21.13 CSS 有色碼：夾重紅、WT 已改橙',
    /tr\.is-squeeze[^}]*#dc2626/.test(cssText) && /tr\.is-changed[^}]*#b45309/.test(cssText));

  // U2／U3：入口事件分派與 API
  check('21.14 入口有 toggle-more／toggle-adv／toggle-unit／toggle-compact 分派',
    /case 'toggle-more'/.test(entryText) && /case 'toggle-adv'/.test(entryText) &&
    /case 'toggle-unit'/.test(entryText) && /case 'toggle-compact'/.test(entryText));
  check('21.15 入口有 Enter 加入、貼上多列、拖曳排序的監聽',
    /addEventListener\('keydown', onRootKeydown\)/.test(entryText) &&
    /addEventListener\('paste', onRootPaste\)/.test(entryText) &&
    /addEventListener\('dragstart', onRootDragStart\)/.test(entryText) &&
    /addEventListener\('drop', onRootDrop\)/.test(entryText));
  check('21.16 41 板上限（ULD_MAX_UNITS）在前端狀態與入口都生效',
    /ULD_MAX_UNITS = 41/.test(stateText) && /length >= ULD_MAX_UNITS/.test(entryText) &&
    uxHtml.includes('/ 41'));

  // U3：單板 Loading Sheet（API＋PDF＋前端）
  check('21.17 api.js 有 fetchLoadingSheetPdfBlob（打 /loading-sheet.pdf）',
    /export async function fetchLoadingSheetPdfBlob/.test(apiText) && apiText.includes('/loading-sheet.pdf'));
  check('21.18 route 有 GET /sheets/:id/loading-sheet.pdf（含 unit 參數檢核）',
    routeText.includes("'/sheets/:id/loading-sheet.pdf'") && routeText.includes('req.query.unit') &&
    routeText.includes('這張夾重表沒有這個收貨單位'));
  check('21.19 PDF 產生器有 buildUldWeightLoadingSheetPdf 與 MAWB／DEST／PCS／WT 欄位',
    /async function buildUldWeightLoadingSheetPdf/.test(pdfText) &&
    pdfText.includes("label: 'MAWB'") && pdfText.includes("label: 'DEST'") &&
    pdfText.includes("label: 'PCS'") && pdfText.includes("label: 'WT'"));
  check('21.20 Loading Sheet 固定 16 列（空白列可手寫）且有 To／Date／Unit／Dest',
    pdfText.includes('LOADING_ROWS_PER_PAGE = 16') && pdfText.includes('To:') &&
    pdfText.includes('Date:') && pdfText.includes('Unit:') && pdfText.includes('Dest :'));
  check('21.21 檢核沒問題時收起空盒子，列印時還原',
    renderText.includes('uldw-issues-empty') &&
    cssText.includes('.uldw-issues-empty { display: none; }') &&
    cssText.includes('.uldw-issues-empty { display: block !important; }'));
  check('21.22 卡片收合時隱藏次要欄位與比例／LIH 欄（CSS）',
    /\.uldw-unit\[data-compact="1"\] \.uldw-unit-more \{ display: none; \}/.test(cssText) &&
    /\.uldw-unit\[data-compact="1"\] \.uldw-col-optional \{ display: none; \}/.test(cssText));
  check('21.23 卡片預設收合（第一次看到只留摘要＋明細）', uxHtml.includes('data-compact="1"'));

  const upperSheet = state.uldSheetFromApi(apiDetail());
  upperSheet.ulds[0].uld_number = 'pmc12345qr';
  upperSheet.ulds[0].contour_code = 'zq';
  upperSheet.ulds[0].port = 'hkg';
  upperSheet.ulds[0].items[0].mawb = '160-abc';
  upperSheet.ulds[0].items[0].port = 'tpe';
  const upperPayload = state.uldSheetPayload(upperSheet);
  check('21.24 存檔 payload 把 ULD#／Contour／Port／MAWB 轉大寫',
    upperPayload.ulds[0].uld_number === 'PMC12345QR' && upperPayload.ulds[0].contour_code === 'ZQ' &&
    upperPayload.ulds[0].port === 'HKG' && upperPayload.ulds[0].items[0].mawb === '160-ABC' &&
    upperPayload.ulds[0].items[0].port === 'TPE',
    JSON.stringify([upperPayload.ulds[0].uld_number, upperPayload.ulds[0].items[0].mawb]));
  check('21.25 代號欄位輸入時即顯示大寫（CSS text-transform）',
    cssText.includes('input[data-unit-field="uld_number"]') &&
    cssText.includes('input[data-item-field="mawb"]') &&
    /text-transform: uppercase/.test(cssText));
  check('21.26 長選項欄位跨兩欄（LIH／Pre-decl 不撐破卡片）',
    renderText.includes('uldw-more-wide') &&
    /\.uldw-unit-more label\.uldw-more-wide \{ grid-column: span 2; \}/.test(cssText));
  check('21.27 明細欄寬足夠顯示 MAWB 13 字／DEST 3 字母／PCS 4 位數',
    /\.uldw-items \.uldw-input-mawb \{ width: 134px/.test(cssText) &&
    /\.uldw-input-dest \{ width: 58px/.test(cssText) &&
    /\.uldw-input-pcs \{ width: 64px/.test(cssText) &&
    uxHtml.includes('uldw-input-dest') && uxHtml.includes('uldw-input-pcs') &&
    uxHtml.includes('uldw-input-wt'));
  check('21.28 TAB 不因 change 重畫而跳焦點（只有 squeeze_mode 才 render）',
    /field === 'squeeze_mode'\) render\(\)/.test(entryText) &&
    !/item\[field\] = target\.type === 'checkbox'[\s\S]{0,140}?uldMarkDirty\(\);\s*render\(\)/.test(entryText));

  // ===== MAWB 格式／檢查碼（U2b）=====
  const mawbText = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'uldweight', 'mawb-format.js'), 'utf8');
  const autoText = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'utils', 'autocomplete.js'), 'utf8');
  const bookingSrcText = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'uldweight', 'booking-search.js'), 'utf8');
  check('21.29 自動完成：Tab 只關閉清單、不選取候選（避免被塞值到下一格）',
    /tabSelects = true/.test(autoText) && /if \(tabSelects && activeIndex >= 0/.test(autoText) &&
    /tabSelects: false/.test(bookingSrcText));
  check('21.30 夾重表的輸入框關閉瀏覽器自動填入（autocomplete="off"）',
    (uxHtml.match(/autocomplete="off"/g) || []).length >= 8,
    String((uxHtml.match(/autocomplete="off"/g) || []).length));
  check('21.31 MAWB 有格式化／驗證純函式（11 位、mod 7 檢查碼）',
    /export function uldFormatMawb/.test(mawbText) && /export function uldValidateMawb/.test(mawbText) &&
    /% 7/.test(mawbText) && /CHECK_DIGIT/.test(mawbText));
  check('21.32 加入前驗證：MAWB 不可與 ULD# 相同，且不合格會 prompt',
    /uldMawbDigits\(unit\.uld_number\)/.test(entryText) &&
    /uldValidateMawb\(rawMawb\)/.test(entryText) &&
    /仍要加入嗎/.test(entryText));
  check('21.33 檢查碼不符的列會標紅（data-mawb-invalid）',
    /data-mawb-invalid="1"/.test(renderText) &&
    /input\[data-mawb-invalid="1"\]/.test(cssText));
  check('21.34 LIH 下拉顯示短碼 N／3481／3091（存檔值仍是 UN3481／UN3091）',
    uxHtml.includes('value="UN3481"') && uxHtml.includes('>3481<') &&
    uxHtml.includes('value="UN3091"') && uxHtml.includes('>3091<') &&
    !uxHtml.includes('無鋰電池') &&
    calc.uldLihLabel('UN3481') === '3481' && calc.uldLihLabel('N') === 'N');
  check('21.35 貼上只攔 MAWB 欄位（ULD#／Contour 等照正常貼上）',
    paste.uldPasteIsMawbField({ draft: 'mawb' }) === true &&
    paste.uldPasteIsMawbField({ itemField: 'mawb' }) === true &&
    paste.uldPasteIsMawbField({ rowField: 'mawb' }) === true &&
    paste.uldPasteIsMawbField({ unitField: 'uld_number' }) === false &&
    paste.uldPasteIsMawbField({ unitField: 'contour_code' }) === false &&
    paste.uldPasteIsMawbField({ draft: 'port' }) === false &&
    paste.uldPasteIsMawbField({}) === false);
  check('21.36 onRootPaste 先判斷欄位（貼 ULD# 不會被當成 MAWB 驗證）',
    /uldPasteIsMawbField\(target\.dataset\)/.test(entryText) &&
    /isFormField/.test(entryText));
  check('21.37 RCL WT = 淨重：卡片標示「RCL（淨）」、摘要不再寫 RCL − Tare',
    uxHtml.includes('RCL（淨）') && uxHtml.includes('Tare') &&
    /RCL（淨）/.test(renderText) && !/RCL \$\{uldFmtKg\(calc\.rclGross\)\}`\s*\n\s*\+ `\$\{calc\.tare \? ` − Tare/.test(renderText));
  check('21.38 PDF 以「RCL（淨重）」呈現（不再寫 RCL − Tare = 淨重）',
    pdfText.includes('RCL（淨重）') && !/RCL \$\{fmtKg\(calc\.rclGross\)\} - Tare/.test(pdfText));

  // ===== 22. CHARTER LOADING SHEET（載荷表：Excel 式矩陣檢視／列印，2026-11-07）=====
  console.log('\n--- 22. 載荷表（CHARTER LOADING SHEET）---');
  const gridMod = await import(`${BASE}/sheet-grid.js`);
  state.uldWeightState.current = state.uldSheetFromApi(apiDetail());
  const gridModel = gridMod.uldGridModel(state.uldComputed());
  check('22.1 一票一列（2 票 MAWB）', gridModel.rows.length === 2, String(gridModel.rows.length));
  const gridRowB = gridModel.rows.find(row => row.mawb === '160-00000006');
  check('22.2 同票跨板：上數＝各板最終重量相加（125 + 888 = 1013）',
    Math.abs(gridRowB.upWt - 1013) < 1e-6, String(gridRowB.upWt));
  check('22.3 每板一格：MAWB b 在兩張板都有 cell（3 + 3 = 6 PCS）',
    Object.keys(gridRowB.cells).length === 2 && gridRowB.upPcs === 6,
    JSON.stringify([Object.keys(gridRowB.cells), gridRowB.upPcs]));
  check('22.4 底部數字：PLAN 1313／RCL（淨）1313／DIFF 0（同卡片檢視的定義）',
    Math.abs(gridModel.planWt - 1313) < 1e-6 && Math.abs(gridModel.rclTotal - 1313) < 1e-6 &&
    Math.abs(gridModel.planDiff) < 1e-6,
    JSON.stringify([gridModel.planWt, gridModel.rclTotal, gridModel.planDiff]));
  const gridSorted = gridMod.uldGridSortRows(gridModel.rows);
  check('22.5 Sort by MAWB# 只排顯示順序（回傳新陣列、不改資料）',
    gridSorted !== gridModel.rows && gridSorted.length === 2 &&
    String(gridSorted[0].key) <= String(gridSorted[1].key));

  state.uldWeightState.ui = {
    view: 'grid', gridSortMawb: false, more: false, advanced: false,
    expanded: {}, expandAll: false, printUnit: null
  };
  const gridRoot = makeRoot();
  render.renderEditor(gridRoot);
  const gridHtml = gridRoot.innerHTML;
  check('22.6 標題帶 CHARTER LOADING SHEET', gridHtml.includes('CHARTER LOADING SHEET'));
  check('22.7 圖例：要自己入／會自動計／紅字=夾重／橙字=wt有差',
    ['要自己入', '會自動計', '紅字=夾重', '橙字=wt有差'].every(t => gridHtml.includes(t)));
  check('22.8 三顆按鈕：Clear Content／Check & format MAWB#／Sort by MAWB#',
    ['grid-clear', 'grid-check-mawb', 'grid-sort'].every(a => gridHtml.includes(`data-action="${a}"`)));
  check('22.9 表頭：SEQ／MAWB／DEST／PCS／WT（kg）／W/H or Booking／上數＋01/A、02/B',
    ['>SEQ<', '>MAWB<', '>DEST<', '>PCS<', '>WT（kg）<', 'W/H or Booking', '>上數<', '>01/A<', '>02/B<']
      .every(t => gridHtml.includes(t)));
  check('22.10 板頭顯示 ULD#／Contour（PMC0003XX/ZQ）', gridHtml.includes('PMC0003XX/ZQ'));
  check('22.11 底部有 PLAN TTL／RCL TTL／DIFF',
    ['PLAN TTL', 'RCL TTL', 'DIFF'].every(t => gridHtml.includes(t)));
  check('22.11b 底部標籤是 RCL（淨）（RCL wt = 淨重）',
    gridHtml.includes('RCL（淨）／ 磅差'));
  check('22.12 夾重格標紅（is-squeeze）、有 wt 有差（is-diff）的樣式',
    /class="uldw-grid-num[^"]*is-squeeze"/.test(gridHtml) &&
    /\.uldw-grid-num\.is-diff\s*\{[^}]*color/.test(cssText));
  check('22.13 載荷表是唯讀矩陣（沒有明細輸入框）＋有「▤ 卡片編輯」切換',
    !gridHtml.includes('data-item-field="mawb"') && gridHtml.includes('data-action="view-cards"'));
  check('22.14 預設版面是 ①② 建檔頁（state.ui.step=build、view=cards）',
    /step: 'build'/.test(stateText) && /view: 'cards'/.test(stateText) && /gridSortMawb/.test(stateText));

  // 卡片檢視仍可用（切回 cards 就回到原本的收貨單位卡片）
  state.uldWeightState.ui.view = 'cards';
  const backRoot = makeRoot();
  render.renderEditor(backRoot);
  check('22.15 切回 cards 有收貨單位卡片與「▦ 載荷表」按鈕',
    (backRoot.innerHTML.match(/class="uldw-unit"/g) || []).length === 2 &&
    backRoot.innerHTML.includes('data-action="view-grid"'));

  // 入口：版面切換／排序／檢查格式化／清空的動作分派
  check('22.16 入口有 view-grid／view-cards／grid-sort／grid-check-mawb／grid-clear',
    ['view-grid', 'view-cards', 'grid-sort', 'grid-check-mawb', 'grid-clear']
      .every(action => entryText.includes(`case '${action}':`)));
  check('22.17 Check & format MAWB# 走共用格式／驗證函式、Clear Content 先 confirm',
    /function checkAndFormatMawbs/.test(entryText) && /uldValidateMawb\(raw\)/.test(entryText) &&
    /uldFormatMawb\(raw\)/.test(entryText) && /function clearSheetContent/.test(entryText) &&
    /confirm\(/.test(entryText.slice(entryText.indexOf('function clearSheetContent'))));
  check('22.18 列印：載荷表用 A4 橫向（named page uld-grid）',
    /@page uld-grid\s*\{\s*size:\s*A4 landscape/.test(cssText) &&
    /\.uldw-grid\s*\{[^}]*page:\s*uld-grid/.test(cssText));
  check('22.19 載荷表 CSS：表頭 sticky／左右捲動／前兩欄固定',
    /\.uldw-grid-table thead th\s*\{[^}]*position:\s*sticky/.test(cssText) &&
    /\.uldw-grid-wrap\s*\{[^}]*overflow:\s*auto/.test(cssText) &&
    /td\.uldw-grid-mawb\s*\{[^}]*left:\s*44px/.test(cssText));

  // 邊界：空表（沒有收貨單位）不拋錯、鎖定時破壞性按鈕 disabled
  state.uldWeightState.current = state.uldSheetFromApi(Object.assign({}, apiDetail(), { ulds: [] }));
  state.uldWeightState.ui = {
    view: 'grid', gridSortMawb: false, more: false, advanced: false,
    expanded: {}, expandAll: false, printUnit: null
  };
  const emptyGridRoot = makeRoot();
  let emptyGridThrew = false;
  try {
    render.renderEditor(emptyGridRoot);
  } catch (err) {
    emptyGridThrew = true;
    console.log(err);
  }
  check('22.20 空表（0 板）載荷表不拋錯，顯示「還沒有收貨單位」提示',
    emptyGridThrew === false && emptyGridRoot.innerHTML.includes('還沒有收貨單位'));

  state.uldWeightState.current = state.uldSheetFromApi(Object.assign({}, apiDetail(), { status: 'locked' }));
  const lockedGridRoot = makeRoot();
  render.renderEditor(lockedGridRoot);
  check('22.21 鎖定時 Clear Content／Check & format／新增板 都 disabled（唯讀）',
    /data-action="grid-clear" disabled/.test(lockedGridRoot.innerHTML) &&
    /data-action="grid-check-mawb" disabled/.test(lockedGridRoot.innerHTML) &&
    /data-action="add-uld" disabled/.test(lockedGridRoot.innerHTML));

  // ===== 23. 方案 B：MAWB 申報列（可編輯載荷表）=====
  console.log('\n--- 23. MAWB 申報列（方案 B）---');
  function detailWithRows() {
    const detail = apiDetail();
    detail.mawb_rows = [
      { id: 91, seq: 0, mawb: '160-00000005', dest: 'HKG', pcs: 5, declared_weight: 300, wh_ref: 'W/H-1', auto_alloc: 1, is_squeeze: 0 },
      { id: 92, seq: 1, mawb: '160-00000006', dest: 'TPE', pcs: 6, declared_weight: 1013, wh_ref: '', auto_alloc: 1, is_squeeze: 1 }
    ];
    return detail;
  }
  state.uldWeightState.current = state.uldSheetFromApi(detailWithRows());
  state.uldWeightState.rclImport = null;
  check('23.1 API → 編輯狀態帶申報列（2 票、有 uid／auto_alloc／is_squeeze）',
    state.uldWeightState.current.mawbs.length === 2 &&
    state.uldWeightState.current.mawbs.every(row => !!row.uid) &&
    state.uldWeightState.current.mawbs[1].auto_alloc === 1 &&
    state.uldWeightState.current.mawbs[1].is_squeeze === true);

  const computedRows = state.uldComputed();
  const cellB1 = computedRows.units[0].calc.items.find(it => it.mawb === '160-00000006');
  const cellB2 = computedRows.units[1].calc.items.find(it => it.mawb === '160-00000006');
  check('23.2 申報重量依件數分到各板（allow_half_kg=0 → 整數 507／506，合計 1013）',
    Math.abs((cellB1.declared + cellB2.declared) - 1013) < 1e-6 &&
    Number.isInteger(cellB1.declared) && Number.isInteger(cellB2.declared),
    JSON.stringify([cellB1.declared, cellB2.declared]));

  state.uldWeightState.ui = {
    view: 'grid', gridSortMawb: false, more: false, advanced: false,
    expanded: {}, expandAll: false, printUnit: null
  };
  const gridB = makeRoot();
  render.renderEditor(gridB);
  const gridBHtml = gridB.innerHTML;
  const gridBModel = gridMod.uldGridModel(state.uldComputed(), state.uldWeightState.current);
  const gridRowB2 = gridBModel.rows.find(row => row.mawb === '160-00000006');
  check('23.3 載荷表列以申報列為準（W/H、自動、上數 = 夾重後 1013）',
    gridBModel.rows.length === 2 && gridBModel.rows[0].whRef === 'W/H-1' &&
    gridBModel.rows.every(row => row.autoAlloc === 1) &&
    Math.abs(gridRowB2.upWt - 1013) < 1e-6,
    JSON.stringify([gridBModel.rows.length, gridBModel.rows[0].whRef, gridRowB2.upWt]));
  check('23.4 載荷表可編輯：申報列欄位＋各板件數＋新增列／刪除列',
    ['mawb', 'dest', 'pcs', 'declared_weight', 'wh_ref', 'auto_alloc', 'is_squeeze']
      .every(field => gridBHtml.includes(`data-row-field="${field}"`)) &&
    gridBHtml.includes('data-cell-field="pcs"') &&
    gridBHtml.includes('id="uldw-grid-new-mawb"') &&
    gridBHtml.includes('data-action="grid-add-row"') &&
    gridBHtml.includes('data-action="grid-del-row"'),
    'data-row-field／data-cell-field／grid-add-row／grid-del-row');
  check('23.5 右邊 WT 是可打字的輸入框（keyboard 手改重量）',
    /data-cell-unit="u11" data-cell-field="wt"/.test(gridBHtml) &&
    /class="uldw-grid-input uldw-grid-input-wt"/.test(gridBHtml));

  // 各板件數 → 自動建立明細
  const rowA = state.uldWeightState.current.mawbs[0];
  const beforeItems = state.uldWeightState.current.ulds[1].items.length;
  const ensured = state.uldEnsureItem('u12', rowA, { pcs: 0 });
  check('23.6 在沒有這票的板輸入件數 → 自動建立明細（帶 DEST）',
    !!ensured && state.uldWeightState.current.ulds[1].items.length === beforeItems + 1 &&
    ensured.mawb === '160-00000005' && ensured.port === 'HKG',
    ensured ? `${ensured.mawb}／${ensured.port}` : 'missing');

  // 改 MAWB → 各板明細一起改
  const rowAKey = calc.uldMawbKey(rowA.mawb);
  rowA.mawb = '160-00000005X';
  state.uldSyncRowToItems(rowA, rowAKey);
  check('23.7 改申報列的 MAWB → 各板明細一起改名（不會留在舊號碼）',
    state.uldWeightState.current.ulds.every(unit =>
      (unit.items || []).every(item => item.mawb !== '160-00000005')),
    JSON.stringify(state.uldWeightState.current.ulds.map(u => u.items.map(it => it.mawb))));
  rowA.mawb = '160-00000005';
  state.uldSyncRowToItems(rowA, calc.uldMawbKey('160-00000005X'));

  // 列夾重開關 → 套到所有明細
  state.uldSetRowSqueeze(state.uldWeightState.current.mawbs[0], true);
  const squeezed = state.uldRowItems(state.uldWeightState.current.mawbs[0]);
  check('23.8 勾「夾重」→ 這票所有板的明細都參與夾重',
    squeezed.length >= 1 && squeezed.every(({ item }) => item.is_squeeze === true));
  state.uldSetRowSqueeze(state.uldWeightState.current.mawbs[0], false);

  // 存檔 payload 帶申報列
  const payloadRows = state.uldSheetPayload(state.uldWeightState.current);
  check('23.9 存檔 payload 帶 mawb_rows（id／W-H／auto_alloc／夾重）',
    Array.isArray(payloadRows.mawb_rows) && payloadRows.mawb_rows.length === 2 &&
    payloadRows.mawb_rows[0].id === 91 && payloadRows.mawb_rows[0].wh_ref === 'W/H-1' &&
    payloadRows.mawb_rows[1].auto_alloc === 1 && payloadRows.mawb_rows[1].is_squeeze === 1,
    JSON.stringify(payloadRows.mawb_rows));

  // 卡片檢視：MAWB 由申報列管 → 唯讀
  state.uldWeightState.ui.view = 'cards';
  const cardsB = makeRoot();
  render.renderEditor(cardsB);
  check('23.10 卡片檢視的 MAWB 欄唯讀（改名請在載荷表左邊）',
    /data-item-field="mawb" value="160-00000006" readonly/.test(cardsB.innerHTML));

  // 刪除申報列 → 連同各板明細
  const removeRow = state.uldWeightState.current.mawbs[1];
  const removedCount = state.uldRemoveMawbRow(removeRow.uid);
  check('23.11 刪除申報列 → 各板明細一起刪（列數 1）',
    state.uldWeightState.current.mawbs.length === 1 && removedCount >= 1 &&
    state.uldWeightState.current.ulds.every(unit =>
      (unit.items || []).every(item => item.mawb !== '160-00000006')),
    `removed ${removedCount}`);

  // 版本比對：多一票申報列 → mawbsAdded
  const snapBase = {
    header: { terminal: 'CPSL', status: 'draft' },
    mawbs: [{ id: 1, mawb: '160-00000005', pcs: 5, declared_weight: 300, auto_alloc: 1 }],
    units: []
  };
  const snapMore = JSON.parse(JSON.stringify(snapBase));
  snapMore.mawbs.push({ id: 2, mawb: '160-00000006', pcs: 6, declared_weight: 1013, auto_alloc: 1 });
  snapMore.mawbs[0].declared_weight = 350;
  const mawbDiff = versionDiff.uldDiffSnapshots(snapBase, snapMore);
  check('23.12 版本比對有 MAWB 申報列（新增 1、修改 1）',
    mawbDiff.summary.mawbsAdded === 1 && mawbDiff.summary.mawbsChanged === 1 &&
    mawbDiff.mawbs.changed[0].fields.some(change => change.field === 'declared_weight'),
    JSON.stringify(mawbDiff.summary));

  // 局部更新（stub DOM 沒有子節點）不拋錯
  let refreshThrew = false;
  try {
    gridMod.refreshGridComputed(gridB, state.uldComputed(), state.uldWeightState.current);
  } catch (err) {
    refreshThrew = true;
    console.log(err);
  }
  check('23.13 refreshGridComputed 不拋錯（stub DOM 無子節點）', refreshThrew === false);

  // 入口：新增／刪除列與 focusin（改名同步）
  check('23.14 入口有 grid-add-row／grid-del-row／focusin／addMawbRow／deleteMawbRow',
    ['grid-add-row', 'grid-del-row'].every(action => entryText.includes(`case '${action}':`)) &&
    /onRootFocusIn/.test(entryText) && /function addMawbRow/.test(entryText) &&
    /function deleteMawbRow/.test(entryText) &&
    /addEventListener\('focusin', onRootFocusIn\)/.test(entryText));

  // ===== 24. 載荷表：鍵盤手改重量 ＋ 板欄左右拖曳（2026-11-09 重新設計）=====
  console.log('\n--- 24. 載荷表：鍵盤手改重量／板欄左右拖曳 ---');
  function detailWeightEdit() {
    const detail = apiDetail();
    detail.mawb_rows = [
      { id: 91, seq: 0, mawb: '160-00000005', dest: 'HKG', pcs: 5, declared_weight: 1000, wh_ref: '', auto_alloc: 1, is_squeeze: 0 },
      { id: 92, seq: 1, mawb: '160-00000006', dest: 'TPE', pcs: 6, declared_weight: 1013, wh_ref: '', auto_alloc: 1, is_squeeze: 1 }
    ];
    return detail;
  }
  state.uldWeightState.current = state.uldSheetFromApi(detailWeightEdit());
  state.uldWeightState.ui = {
    view: 'grid', gridSortMawb: false, more: false, advanced: false,
    expanded: {}, expandAll: false, printUnit: null
  };
  const gridW = makeRoot();
  render.renderEditor(gridW);
  const gridWHtml = gridW.innerHTML;
  check('24.1 每板都有 PCS／WT 兩個輸入框（2 列 × 2 板 = 4 格）',
    (gridWHtml.match(/data-cell-field="pcs"/g) || []).length === 4 &&
    (gridWHtml.match(/data-cell-field="wt"/g) || []).length === 4,
    `${(gridWHtml.match(/data-cell-field="pcs"/g) || []).length}／${(gridWHtml.match(/data-cell-field="wt"/g) || []).length}`);
  check('24.2 板頭可以左右拖曳（data-col-unit／draggable／⠿ 把手）',
    /data-col-unit="u11" draggable="true"/.test(gridWHtml) &&
    /data-col-unit="u12" draggable="true"/.test(gridWHtml) &&
    gridWHtml.includes('uldw-grid-grip') && gridWHtml.includes('>上數<'));

  // 手改重量：固定這一板、剩下的申報重量依件數分給其他板
  const rowW = state.uldWeightState.current.mawbs.find(row => row.mawb === '160-00000006');
  const editW = state.uldSetCellWeight(rowW.uid, 'u11', 300);
  const unitW1 = state.uldWeightState.current.ulds[0].items.find(it => it.mawb === '160-00000006');
  const unitW2 = state.uldWeightState.current.ulds[1].items.find(it => it.mawb === '160-00000006');
  check('24.3 手改第 1 板 300 → 第 2 板拿剩下的 713（合計仍 = 申報 1013）',
    editW.ok && Math.abs(unitW1.declared_weight - 300) < 1e-6 &&
    Math.abs(unitW2.declared_weight - 713) < 1e-6,
    `${unitW1.declared_weight}／${unitW2.declared_weight}`);
  check('24.4 手改重量後這一列變成手動分配（auto_alloc = 0）',
    Number(rowW.auto_alloc) === 0 && editW.clamped === false);

  const editOver = state.uldSetCellWeight(rowW.uid, 'u12', 5000);
  const unitW1b = state.uldWeightState.current.ulds[0].items.find(it => it.mawb === '160-00000006');
  check('24.5 打超過申報 WT → 夾到 1013（clamped）且其他板歸 0（不會出現負數）',
    editOver.clamped === true && Math.abs(editOver.fixed - 1013) < 1e-6 &&
    Math.abs(unitW1b.declared_weight) < 1e-6,
    JSON.stringify(editOver.weights));

  // 勾回「自動」→ 依件數重分（手動填的被蓋掉）
  rowW.auto_alloc = 1;
  const recomputedW = state.uldComputed();
  const autoW1 = recomputedW.units[0].calc.items.find(it => it.mawb === '160-00000006');
  const autoW2 = recomputedW.units[1].calc.items.find(it => it.mawb === '160-00000006');
  check('24.6 勾回「自動」→ 依件數重新分配（整數，合計 1013）',
    Math.abs((autoW1.declared + autoW2.declared) - 1013) < 1e-6 &&
    Number.isInteger(autoW1.declared) && Number.isInteger(autoW2.declared),
    `${autoW1.declared}／${autoW2.declared}`);

  // 板序左右搬（拖曳板頭 → uldMoveUnit；存檔會寫回 seq）
  const moved = state.uldMoveUnit('u12', 'u11', false);
  check('24.7 板欄可以左右搬（拖曳板頭 → uldMoveUnit 換欄序）',
    moved && state.uldWeightState.current.ulds[0].uid === 'u12');
  state.uldMoveUnit('u12', 'u11', true);

  // 存檔 payload 保留手動標記與各板重量
  state.uldSetCellWeight(state.uldWeightState.current.mawbs.find(r => r.mawb === '160-00000006').uid, 'u11', 250);
  const payloadW = state.uldSheetPayload(state.uldWeightState.current);
  const payloadRowW = payloadW.mawb_rows.find(row => row.mawb === '160-00000006');
  const payloadItemsW = payloadW.ulds.reduce((all, unit) => all.concat(unit.items), [])
    .filter(it => it.mawb === '160-00000006');
  check('24.8 存檔 payload 帶 auto_alloc = 0 與手改後的各板重量（Σ = 1013）',
    payloadRowW.auto_alloc === 0 &&
    Math.abs(payloadItemsW.reduce((sum, it) => sum + it.declared_weight, 0) - 1013) < 1e-6 &&
    payloadItemsW.some(it => Math.abs(it.declared_weight - 250) < 1e-6),
    JSON.stringify(payloadItemsW.map(it => it.declared_weight)));

  // 鎖定：板頭不可拖、WT 不可改
  state.uldWeightState.current.status = 'locked';
  const lockedWRoot = makeRoot();
  render.renderEditor(lockedWRoot);
  check('24.9 鎖定時板頭 draggable="false"、WT 輸入框 disabled',
    /data-col-unit="u11" draggable="false"/.test(lockedWRoot.innerHTML) &&
    (lockedWRoot.innerHTML.match(/data-cell-field="wt"[\s\S]{0,320}?disabled/g) || []).length === 4);
  state.uldWeightState.current.status = 'draft';

  // 入口：鍵盤導覽＋重量輸入的處理
  check('24.10 入口有鍵盤導覽（gridFocusSelector／moveGridFocus／Shift+Enter 上移）',
    /function gridFocusSelector/.test(entryText) && /function moveGridFocus/.test(entryText) &&
    /event\.shiftKey \? -1 : 1/.test(entryText));
  check('24.11 入口有「各板 WT 直接打字」路徑（applyCellWeight → uldSetCellWeight）',
    /function applyCellWeight/.test(entryText) &&
    /uldSetCellWeight\(/.test(entryText) &&
    /dataset\.cellField === 'wt'/.test(entryText));
  check('24.12 入口的拖曳支援板欄（dragKind = grid-col／clientX／data-col-unit）',
    /dragKind = 'grid-col'/.test(entryText) && /event\.clientX/.test(entryText) &&
    /closest\('\[data-col-unit\]'\)/.test(entryText) &&
    /uldMoveUnit\(from, targetUid, after\)/.test(entryText));
  check('24.13 數字格一進來就全選（打字＝覆蓋）',
    /function selectInputText/.test(entryText) && /target\.type === 'number'/.test(entryText));
  check('24.14 CSS：板頭 grab 游標／插入位置藍線／WT 輸入框底線／輸入列高亮',
    /\.uldw-grid-unit-th\[draggable="true"\]\s*\{\s*cursor:\s*grab/.test(cssText) &&
    /\.uldw-grid-unit-th\.is-drop-before\s*\{[^}]*box-shadow/.test(cssText) &&
    /\.uldw-grid-input-wt\s*\{[^}]*border-bottom-color/.test(cssText) &&
    /\.uldw-grid-table tbody tr:focus-within td\s*\{/.test(cssText));
  check('24.15 列印時不印拖曳把手（⠿）',
    /@media print[\s\S]*\.uldw-grid-grip \{ display: none !important; \}/.test(cssText));
  check('24.16 卡片檢視也能左右拖（cardDropSide 依位移較大的軸判斷）',
    /function cardDropSide/.test(entryText) && /is-drop-left/.test(entryText) &&
    /\.uldw-unit\.is-drop-left\s*\{/.test(cssText));

  // ===== 25. 新 UI：LOT 列表／① MAWB LIST／② ULD LIST／③ 合併 =====
  console.log('\n--- 25. 新 UI：LOT／MAWB LIST／ULD LIST／合併 ---');

  // LOT 列表：動態搜尋＋狀態 chips＋LOT 卡片
  state.uldWeightState.view = 'list';
  state.uldWeightState.sheets = [{
    id: 7, sheet_no: 'WGT-20261105-01', sheet_date: '2026-11-05', terminal: 'CPSL',
    flight_no: 'CX1234', uld_count: 2, bulk_count: 0, rcl_total: 1540, net_total: 1313,
    diff_total: 0, status: 'draft'
  }];
  state.uldWeightState.listFilter = { search: '', status: '' };
  const lotRoot = makeRoot();
  render.renderList(lotRoot);
  check('25.1 LOT 列表有動態搜尋／狀態 chips／LOT 卡片',
    lotRoot.innerHTML.includes('uldw-search') &&
    lotRoot.innerHTML.includes('id="uldw-list-search"') &&
    lotRoot.innerHTML.includes('data-action="list-status"') &&
    lotRoot.innerHTML.includes('uldw-lot'));
  check('25.2 LOT 卡片保留開啟／複製／刪除', ['open', 'duplicate', 'delete']
    .every(action => lotRoot.innerHTML.includes(`data-action="${action}"`)));

  // 建檔頁：① MAWB LIST ＋ ② ULD LIST（同一頁兩個 division）
  state.uldWeightState.view = 'editor';
  state.uldWeightState.current = state.uldSheetFromApi(detailWithRows());
  state.uldWeightState.ui = {
    step: 'build', view: 'cards', gridSortMawb: false, more: false, advanced: false,
    expanded: {}, expandAll: false, printUnit: null, mergePick: null
  };
  const buildRoot = makeRoot();
  render.renderEditor(buildRoot);
  const buildHtml = buildRoot.innerHTML;
  check('25.3 建檔頁有 ① MAWB LIST／② ULD LIST 兩個 division',
    buildHtml.includes('MAWB LIST') && buildHtml.includes('ULD LIST') &&
    buildHtml.includes('uldw-mawb-panel') && buildHtml.includes('uldw-uld-panel'));
  check('25.4 MAWB LIST 欄位：MAWB#／DEST／PCS／WT＋加入列',
    ['data-row-field="mawb"', 'data-row-field="dest"', 'data-row-field="pcs"',
      'data-row-field="declared_weight"', 'id="uldw-mawb-new"', 'data-action="mawb-add"']
      .every(text => buildHtml.includes(text)));
  check('25.5 建檔頁有「③ 合併／分配」入口', buildHtml.includes('data-action="open-merge"'));
  check('25.6 ULD 的 LIH 是 chips（NIL／3481／3091 可多選）',
    buildHtml.includes('data-action="toggle-lih"') && buildHtml.includes('data-lih="UN3481"') &&
    buildHtml.includes('data-lih="UN3091"') && buildHtml.includes('>NIL<'));
  check('25.7 MAWB 檢查碼不合格會標紅（data-mawb-invalid）',
    /data-mawb-invalid="1"/.test(buildHtml));

  // LIH 組合值（3481 與 3091 可同時存在）
  check('25.8 LIH 可組合 UN3481+UN3091（存檔值固定順序）',
    calc.uldLihValue(['UN3481', 'UN3091']) === 'UN3481+UN3091' &&
    calc.uldLihCodes('UN3481+UN3091').length === 2 &&
    calc.uldLihToggle('UN3481', 'UN3091') === 'UN3481+UN3091' &&
    calc.uldLihToggle('UN3481+UN3091', 'UN3481') === 'UN3091');
  const comboLih = calc.uldComputeUnit({
    kind: 'ULD', tare_weight: 0, rcl_gross_weight: 100, lih_type: 'UN3481+UN3091',
    items: [{ mawb: '160-00000001', pcs: 1, declared_weight: 100, is_squeeze: true, lih_type: 'UN3091' }]
  });
  check('25.9 板 LIH 是組合時，票只標其中一種不會誤報 LIH_UN_CODE_MISMATCH',
    !comboLih.issues.some(issue => issue.code.startsWith('LIH_')),
    JSON.stringify(comboLih.issues.map(issue => issue.code)));

  // 合併：把 MAWB 指派到 ULD（預設帶未分配件數）
  const assignRow = state.uldNewMawb({ mawb: '160-00000006', dest: 'TPE', pcs: 10, declared_weight: 600 });
  const assignU1 = state.uldNewUnit('ULD'); assignU1.uid = 'm1'; assignU1.uld_number = 'PMC0001';
  assignU1.items = [state.uldNewItem({ mawb: '160-00000006', port: 'TPE', pcs: 4, declared_weight: 240 })];
  const assignU2 = state.uldNewUnit('ULD'); assignU2.uid = 'm2'; assignU2.uld_number = 'PMC0002';
  state.uldWeightState.current = {
    id: 99, sheet_no: 'WGT-NEW', sheet_date: '2026-11-11', terminal: 'CPSL',
    flight_no: '', flight_date: '', round_px: 1, round_b: 1, tail_mode: 'adjust_largest',
    diff_warn_pct: 2, diff_warn_kg: 100, clamp_min_pct: 0, clamp_max_pct: 0,
    handler: '', remark: '', status: 'draft',
    mawbs: [assignRow], ulds: [assignU1, assignU2]
  };
  const assignResult = state.uldAssignMawbToUnit(assignRow.uid, 'm2');
  check('25.10 拖到 ULD → 自動帶入未分配件數（10 − 4 = 6）',
    assignResult.ok && assignResult.pcs === 6 && assignResult.remaining === 0 &&
    (assignU2.items || []).some(item => calc.uldMawbKey(item.mawb) === calc.uldMawbKey(assignRow.mawb)));
  const moveSourceItem = assignU2.items.find(item => calc.uldMawbKey(item.mawb) === calc.uldMawbKey(assignRow.mawb));
  const assignU3 = state.uldNewUnit('ULD'); assignU3.uid = 'm3'; assignU3.uld_number = 'PMC0003';
  state.uldWeightState.current.ulds.push(assignU3);
  const moveResult = state.uldMoveItemToUnit('m2', moveSourceItem.uid, 'm3');
  check('25.11 明細可搬到另一個 ULD（原板移除、目標板新增）',
    moveResult.ok && !(assignU2.items || []).some(item => item.uid === moveSourceItem.uid) &&
    (assignU3.items || []).some(item => item.uid === moveSourceItem.uid));

  // 合併頁渲染
  state.uldWeightState.ui = {
    step: 'merge', view: 'cards', gridSortMawb: false, more: false, advanced: false,
    expanded: {}, expandAll: false, printUnit: null, mergePick: null
  };
  const mergeRoot = makeRoot();
  render.renderEditor(mergeRoot);
  const mergeHtml = mergeRoot.innerHTML;
  check('25.12 合併頁有 MAWB 池＋可拖曳 ULD 分欄（含左右移位按鈕）',
    mergeHtml.includes('uldw-merge-board') && mergeHtml.includes('data-mawb-chip') &&
    mergeHtml.includes('data-merge-unit') && /data-merge-unit="1"[^>]*draggable="true"/.test(mergeHtml) &&
    mergeHtml.includes('data-action="merge-unit-left"') && mergeHtml.includes('data-action="merge-unit-right"'));
  check('25.13 合併頁入口支援 MAWB／明細／ULD 三種拖曳',
    /dragKind = 'merge-mawb'/.test(entryText) &&
    /dragKind = 'merge-item'/.test(entryText) &&
    /dragKind = 'merge-unit'/.test(entryText) &&
    /uldMoveUnit\(from, targetUid, after\)/.test(entryText));
  check('25.14 CSS：合併看板／MAWB chip／放置目標樣式',
    cssText.includes('.uldw-merge-board') && cssText.includes('.uldw-mawb-chip') &&
    cssText.includes('.uldw-merge-unit.is-drop-target') && cssText.includes('.uldw-lih-chip'));

  // ===== 26. 重量單位 kg／允許 0.5kg／MAWB LIST Excel 式格線 =====
  console.log('\n--- 26. 重量 kg／0.5kg 開關／Excel 式 MAWB 格線 ---');
  check('26.1 header 有「允許使用 0.5 kg」開關', buildHtml.includes('data-header="allow_half_kg"') &&
    buildHtml.includes('允許使用 0.5 kg'));
  check('26.2 未勾選時重量 step=1（只整數）、勾選時 step=0.5', (() => {
    const sheet = state.uldWeightState.current;
    const old = sheet.allow_half_kg;
    const oldStep = state.uldWeightState.ui.step;
    state.uldWeightState.ui.step = 'build';
    state.uldWeightState.ui.view = 'cards';
    sheet.allow_half_kg = 0;
    const intRoot = makeRoot();
    render.renderEditor(intRoot);
    const intHtml = intRoot.innerHTML;
    sheet.allow_half_kg = 1;
    const halfRoot = makeRoot();
    render.renderEditor(halfRoot);
    const halfHtml = halfRoot.innerHTML;
    sheet.allow_half_kg = old;
    state.uldWeightState.ui.step = oldStep;
    return intHtml.includes('data-row-field="declared_weight"') && intHtml.includes('step="1"') &&
      halfHtml.includes('step="0.5"') && halfHtml.includes('checked');
  })());
  check('26.3 合計／摘要單位一律 kg（不再用 K）',
    renderText.includes('</b> kg') && !renderText.includes('</b> K'));
  check('26.4 MAWB LIST 是 Excel 式格線（colgroup＋固定欄寬＋儲存格框線）',
    buildHtml.includes('<colgroup>') && buildHtml.includes('uldw-mawb-col-mawb') &&
    buildHtml.includes('uldw-mawb-th-dest') && buildHtml.includes('uldw-mawb-th-wt'));
  check('26.5 欄頭與內文對齊（DEST 置中、PCS／WT／最終 靠右）',
    /\.uldw-mawb-th-dest\s*\{[^}]*text-align:\s*center/.test(cssText) &&
    /\.uldw-mawb-th-pcs,[\s\S]*?text-align:\s*right/.test(cssText) &&
    /\.uldw-mawb-table td:focus-within\s*\{[^}]*box-shadow/.test(cssText));
  check('26.6 MAWB 格線可從 Excel 整塊貼上（Tab／換行 → 填入目前列）',
    /function pasteMawbGrid/.test(entryText) && /function applyMawbGridRows/.test(entryText) &&
    /closest\('#uldw-mawb-panel'\)/.test(entryText) &&
    /includes\('\\t'\)/.test(entryText) && /applyMawbGridRows/.test(entryText));
  const intOnly = calc.uldComputeUnit({
    kind: 'ULD', rcl_gross_weight: 800.3,
    items: [{ mawb: '160-00000001', pcs: 1, declared_weight: 800.3, is_squeeze: true }]
  }, { allowHalfKg: false });
  const halfKg = calc.uldComputeUnit({
    kind: 'ULD', rcl_gross_weight: 800.3,
    items: [{ mawb: '160-00000001', pcs: 1, declared_weight: 800.3, is_squeeze: true }]
  }, { allowHalfKg: true });
  check('26.7 未允許 0.5kg → 夾重後只以整數運算（801）',
    intOnly.roundInc === 1 && Math.abs(intOnly.items[0].final - 801) < 1e-9,
    JSON.stringify([intOnly.roundInc, intOnly.items[0].final]));
  check('26.8 允許 0.5kg → 夾重後可用 0.5（800.5）',
    halfKg.roundInc === 0.5 && Math.abs(halfKg.items[0].final - 800.5) < 1e-9,
    JSON.stringify([halfKg.roundInc, halfKg.items[0].final]));

  // ===== 2026-11-11：卡片明細 WT 直接打字（不用上下箭頭微調）=====
  const wtTags = buildHtml.match(/<input type="number"[^>]*class="uldw-input uldw-input-wt"[^>]*>/g) || [];
  check('26.9 卡片明細 WT 不再唯讀、帶 data-item-weight（可直接打字）',
    wtTags.length > 0 && wtTags.every(tag => tag.includes('data-item-weight="1"') && !tag.includes('readonly')),
    `${wtTags.length} 個 WT 輸入框`);
  check('26.10 卡片 WT 打字帶申報列 uid（走 uldSetCellWeight：固定這一板、其餘依件數重分）',
    /data-item-weight="1" data-weight-row="/.test(buildHtml) &&
    /function applyItemWeight/.test(entryText) &&
    /uldSetCellWeight\(row\.uid, unit\.uid, target\.value\)/.test(entryText) &&
    /applyItemWeight\(target, false\)/.test(entryText) &&
    /applyItemWeight\(target, true\)/.test(entryText));
  check('26.11 CSS：明細數字框隱藏上下箭頭（純打字）',
    /\.uldw-items input\[type="number"\]\s*\{[^}]*appearance:\s*textfield/.test(cssText) &&
    /::-webkit-inner-spin-button[^{]*\{[^}]*-webkit-appearance:\s*none/.test(cssText));
  // 前面 §25 借用 current 測合併頁，這裡換回有兩塊板＋申報列的資料
  state.uldWeightState.current = state.uldSheetFromApi(detailWithRows());
  const typedRow = state.uldWeightState.current.mawbs.find(row => row.mawb === '160-00000006');
  const typedResult = state.uldSetCellWeight(typedRow.uid, 'u11', 600);
  const typedSum = state.uldWeightState.current.ulds
    .flatMap(unit => unit.items)
    .filter(it => it.mawb === '160-00000006')
    .reduce((sum, it) => sum + Number(it.declared_weight || 0), 0);
  check('26.12 卡片 WT 打 600 → 這一板 600、其他板補 413（Σ 仍 1013、該列轉手動）',
    typedResult.ok && Math.abs(typedSum - 1013) < 1e-9 &&
    Number(typedRow.auto_alloc) === 0 &&
    Number(state.uldWeightState.current.ulds[0].items.find(it => it.mawb === '160-00000006').declared_weight) === 600,
    JSON.stringify({ sum: typedSum, auto: typedRow.auto_alloc }));

  console.log(`\n===== ${failCount === 0 ? '全部通過' : failCount + ' 項失敗'}（PASS ${passCount} / FAIL ${failCount}）=====`);

  process.exitCode = failCount === 0 ? 0 : 1;
})();
