// ===== 模擬裝板：存檔 / 載入模組測試（本機 ＋ 匯出／匯入 ＋ 雲端 API）=====
// 載入 public/js/loadsim/plans.js（純資料邏輯）與 state.js（快照 / 還原），
// 用 stub 的 localStorage / fetch / apiFetch，不需要瀏覽器與伺服器。
// 用法：node scripts/test-loadsim-plans.js
const path = require('path');
const { pathToFileURL } = require('url');

let passCount = 0;
let failCount = 0;

function check(name, ok, extra = '') {
  if (ok) passCount += 1; else failCount += 1;
  console.log(`${ok ? '✅' : '❌'} ${name}${extra ? ' ' + extra : ''}`);
}

// ===== stub：localStorage（failWrites 模擬瀏覽器空間已滿）=====
const storage = new Map();
let failWrites = false;
globalThis.localStorage = {
  getItem: key => (storage.has(key) ? storage.get(key) : null),
  setItem: (key, value) => {
    if (failWrites) throw new Error('QuotaExceededError');
    storage.set(key, String(value));
  },
  removeItem: key => storage.delete(key)
};

// ===== stub：apiFetch（雲端 API）與 fetch（/api/auth/me）=====
const calls = [];
let apiResponse = null;
let apiError = null;
globalThis.apiFetch = async (url, options = {}) => {
  calls.push({
    url,
    method: options.method || 'GET',
    body: options.body ? JSON.parse(options.body) : null
  });
  if (apiError) throw new Error(apiError);
  return apiResponse;
};

let sessionUser = null;
globalThis.fetch = async () => ({
  ok: !!sessionUser,
  json: async () => ({ user: sessionUser })
});

// ===== 測試資料 =====
function makeItem(over) {
  return Object.assign({
    id: 1, name: 'Ctn', mawb: '', dims: { l: 120, w: 100, h: 100 }, weight: 100,
    color: '#2563eb', orient: 0, x: 0, y: 0, z: 0, placed: true, staged: false
  }, over || {});
}

const BOARD_SNAPSHOT = {
  app: 'agl-loadsim',
  version: 1,
  savedAt: '2026-11-07T07:30:00.000Z',
  unit: 'cm',
  uldCode: 'Q7-00',
  plateType: 'thin',
  items: [
    makeItem({ id: 1, name: 'A', weight: 1000, x: 0, y: 0, z: 0 }),
    makeItem({ id: 2, name: 'B', weight: 500, x: 120, y: 0, z: 0 }),
    makeItem({ id: 3, name: 'C', weight: 300, staged: true }),
    makeItem({ id: 4, name: 'D', weight: 200, placed: false })
  ],
  allowOverhang: true,
  requireSupport: true,
  supportMinPct: 50,
  supportAreaEnabled: true,
  itemMaxKg: 1000,
  itemMaxEnabled: true,
  specOverrides: {},
  seq: 5
};

(async () => {
  console.log('===== 模擬裝板系統：存檔 / 載入模組測試 =====\n');

  const baseUrl = pathToFileURL(path.join(__dirname, '..', 'public', 'js')).href;
  const plans = await import(`${baseUrl}/loadsim/plans.js`);
  const stateModule = await import(`${baseUrl}/loadsim/state.js`);
  const specModule = await import(`${baseUrl}/loadsim/uld-specs.js`);
  const state = stateModule.loadsimState;

  // ===== 1. 快照 / 還原（state.js）=====
  state.items = BOARD_SNAPSHOT.items.map(item => Object.assign({}, item, { dims: Object.assign({}, item.dims) }));
  state.unit = 'in';
  state.uldCode = 'Q7-00';
  state.plateType = 'thick';
  state.specOverrides = { 'Q7-00': { baseL: 320, baseW: 245, heightCm: 300, maxGrossKg: 6804, tareKg: 120 } };
  state.seq = 5;

  const snapshot = stateModule.loadsimSnapshot();
  check('1.1 快照帶 app / version / savedAt',
    snapshot.app === 'agl-loadsim' && snapshot.version === 1 && !!snapshot.savedAt);
  check('1.2 快照包含板型、板底、單位與 4 筆貨物',
    snapshot.uldCode === 'Q7-00' && snapshot.plateType === 'thick' && snapshot.unit === 'in' && snapshot.items.length === 4);

  snapshot.items[0].weight = 9999;
  check('1.3 快照是深拷貝（改快照不影響目前狀態）', state.items[0].weight === 1000);
  snapshot.items[0].weight = 1000;

  state.items = [];
  state.unit = 'cm';
  state.uldCode = 'A1';
  state.plateType = 'thin';
  state.specOverrides = {};
  const applied = stateModule.loadsimApplySnapshot(snapshot);
  check('1.4 套用快照 → 板型 / 板底 / 單位還原',
    applied === true && state.uldCode === 'Q7-00' && state.plateType === 'thick' && state.unit === 'in');
  check('1.5 貨物尺寸與擺位完整還原',
    state.items.length === 4 && state.items[1].x === 120 && state.items[2].staged === true && state.items[3].placed === false);
  check('1.6 板型設定覆蓋值（specOverrides）也還原',
    !!state.specOverrides['Q7-00'] && state.specOverrides['Q7-00'].heightCm === 300);
  check('1.7 seq 大於最大 id（新增貨物不會撞號）', state.seq >= 5, String(state.seq));

  stateModule.loadsimApplySnapshot({
    uldCode: 'Q7-00',
    items: [
      { name: 'X', dims: { l: 10, w: 10, h: 10 }, weight: 1 },
      { name: 'Y', dims: { l: 10, w: 10, h: 10 }, weight: 1 },
      { id: 1, name: 'Z', dims: { l: 10, w: 10, h: 10 }, weight: 1 }
    ]
  });
  const repairedIds = state.items.map(item => item.id);
  check('1.8 缺 id / 重複 id → 自動重新配號',
    repairedIds.length === 3 && new Set(repairedIds).size === 3 && repairedIds.every(id => id > 0),
    repairedIds.join(','));

  // ===== 2. 彙總 / 名稱 / 清單說明 =====
  const summary = plans.loadsimPlanSummary(BOARD_SNAPSHOT);
  const q7Spec = specModule.loadsimGetSpec('Q7-00', {}, { plateType: 'thin' });
  check('2.1 彙總：板上 2 件、總筆數 4、暫存 1、待裝 1',
    summary.boardCount === 2 && summary.itemCount === 4 && summary.stagedCount === 1 && summary.pendingCount === 1,
    `${summary.boardCount}/${summary.itemCount}/${summary.stagedCount}/${summary.pendingCount}`);
  check('2.2 重量只算板上的貨（1000 + 500）', summary.totalKg === 1500, String(summary.totalKg));
  check('2.3 總重＝板上重量 + 板重（tare）',
    summary.grossKg === 1500 + (Number(q7Spec.tareKg) || 0),
    `gross=${summary.grossKg} tare=${q7Spec.tareKg}`);
  check('2.4 容積利用率 > 0', summary.utilizationPct > 0, `${summary.utilizationPct}%`);

  const defaultName = plans.loadsimPlanDefaultName(BOARD_SNAPSHOT);
  check('2.5 預設名稱＝板型＋儲存時間', /^Q7-00 \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(defaultName), defaultName);
  check('2.6 名稱收斂空白並截到 60 字',
    plans.loadsimNormalizePlanName('  板   A  ') === '板 A' &&
    plans.loadsimNormalizePlanName('x'.repeat(80)).length === 60);

  const meta = plans.loadsimPlanMetaText({
    uldCode: 'Q7-00', boardCount: 2, totalKg: 1500, utilizationPct: 59.4, savedAt: '2026-11-07T07:30:00.000Z'
  });
  check('2.7 清單說明含板型 / 件數 / 重量 / 利用率 / 時間',
    meta.includes('Q7-00') && meta.includes('2 件') && meta.includes('1500.0 kg') && meta.includes('利用率 59%'),
    meta);

  // ===== 3. 本機存檔（localStorage）=====
  storage.delete(plans.LOADSIM_PLANS_KEY);
  const savedA = plans.loadsimLocalSavePlan('板 A', BOARD_SNAPSHOT);
  check('3.1 存到本機 → 回傳紀錄（id / name / summary）',
    !!savedA && savedA.name === '板 A' && savedA.id === 1 && savedA.summary.boardCount === 2,
    savedA ? `id=${savedA.id}` : 'null');
  check('3.2 本機清單 1 筆', plans.loadsimLocalPlans().length === 1);

  savedA.snapshot.items[0].weight = 7777;
  check('3.3 本機存檔是深拷貝（改回傳值不影響已存的）',
    plans.loadsimLocalPlans()[0].snapshot.items[0].weight === 1000);

  const savedA2 = plans.loadsimLocalSavePlan('板 A', Object.assign({}, BOARD_SNAPSHOT, { uldCode: 'A1' }));
  const afterOverwrite = plans.loadsimLocalPlans();
  check('3.4 同名存檔＝覆蓋（仍 1 筆、id 不變、板型更新）',
    afterOverwrite.length === 1 && afterOverwrite[0].id === savedA.id && afterOverwrite[0].summary.uldCode === 'A1',
    afterOverwrite.map(p => p.name).join(','));

  plans.loadsimLocalSavePlan('板 B', Object.assign({}, BOARD_SNAPSHOT, { savedAt: '2026-11-07T08:00:00.000Z' }));
  const twoPlans = plans.loadsimLocalPlans();
  check('3.5 不同名稱 → 2 筆，新的排前面', twoPlans.length === 2 && twoPlans[0].name === '板 B',
    twoPlans.map(p => p.name).join(','));

  const gotA = plans.loadsimLocalGetPlan(savedA.id);
  check('3.6 取得單筆（含 snapshot）', !!gotA && gotA.snapshot.items.length === 4);
  check('3.7 改名（會去頭尾空白）',
    plans.loadsimLocalRenamePlan(savedA.id, '  板 A 改  ') &&
    plans.loadsimLocalPlans().some(plan => plan.id === savedA.id && plan.name === '板 A 改'));
  check('3.8 刪除', plans.loadsimLocalDeletePlan(savedA.id) && plans.loadsimLocalPlans().length === 1);
  check('3.9 刪除不存在的 id → false', plans.loadsimLocalDeletePlan(9999) === false);

  storage.delete(plans.LOADSIM_PLANS_KEY);
  const origWarn = console.warn;
  console.warn = () => {};
  for (let i = 0; i < 35; i += 1) {
    plans.loadsimLocalSavePlan(`P${i}`, Object.assign({}, BOARD_SNAPSHOT, {
      savedAt: new Date(Date.UTC(2026, 10, 1, 0, i)).toISOString()
    }));
  }
  const capped = plans.loadsimLocalPlans();
  check('3.10 超過上限 30 份 → 只留最新 30（最舊的 P0–P4 被丟掉）',
    capped.length === 30 && !capped.some(plan => plan.name === 'P0'), `${capped.length} 筆`);

  failWrites = true;
  check('3.11 瀏覽器空間已滿 → 回傳 null（不拋錯）', plans.loadsimLocalSavePlan('滿了', BOARD_SNAPSHOT) === null);
  failWrites = false;
  console.warn = origWarn;

  // ===== 4. 匯出 / 匯入 JSON =====
  const exportFile = plans.loadsimBuildExportFile('板 A', BOARD_SNAPSHOT);
  check('4.1 匯出檔名 loadsim-<板型>-<時間>.json',
    /^loadsim-Q7-00-\d{12}\.json$/.test(exportFile.fileName), exportFile.fileName);
  check('4.2 匯出內容含 app / name / summary / snapshot',
    exportFile.payload.app === 'agl-loadsim' && exportFile.payload.name === '板 A' &&
    exportFile.payload.snapshot.items.length === 4 && exportFile.payload.summary.boardCount === 2);

  const imported = plans.loadsimParseImport(JSON.stringify(exportFile.payload));
  check('4.3 匯入匯出檔 → 還原 snapshot 與名稱',
    imported.snapshot.items.length === 4 && imported.name === '板 A');

  const bareImported = plans.loadsimParseImport(JSON.stringify(BOARD_SNAPSHOT));
  check('4.4 直接匯入 snapshot（沒有外層包裝）也接受',
    bareImported.snapshot.items.length === 4 && bareImported.name.startsWith('Q7-00'), bareImported.name);

  let badJson = false;
  try { plans.loadsimParseImport('not json'); } catch (err) { badJson = /JSON/.test(err.message); }
  check('4.5 非 JSON 檔 → 拋錯（訊息含 JSON）', badJson);

  let noItems = false;
  try { plans.loadsimParseImport('{"hello":"world"}'); } catch (err) { noItems = /貨物清單/.test(err.message); }
  check('4.6 沒有 items → 拋錯（訊息說明缺少貨物清單）', noItems);

  // ===== 5. 雲端存檔（API 呼叫；不連伺服器）=====
  sessionUser = null;
  check('5.1 未登入 → loadsimFetchSession 回 null', (await plans.loadsimFetchSession()) === null);

  sessionUser = { user_id: 'admin', role: 'admin', display_name: '系統管理員' };
  const session = await plans.loadsimFetchSession();
  check('5.2 已登入 → 回傳使用者', !!session && session.user_id === 'admin');
  check('5.3 admin / staff 可用雲端，customer 與未登入不行',
    plans.loadsimCanUseCloud(session) &&
    plans.loadsimCanUseCloud({ role: 'staff' }) &&
    !plans.loadsimCanUseCloud({ role: 'customer' }) &&
    !plans.loadsimCanUseCloud(null));

  calls.length = 0;
  apiResponse = {
    data: [{
      id: 7, name: '雲端板', uld_code: 'Q7-00', plate_type: 'thick', item_count: 4, board_count: 2,
      total_kg: 1500, gross_kg: 1620, utilization_pct: 59.4, saved_at: '2026-11-07T07:30:00.000Z',
      created_by: 'admin'
    }]
  };
  const cloudList = await plans.loadsimCloudList();
  check('5.4 雲端清單 → 轉成前端欄位（板型 / 件數 / 重量）',
    cloudList.length === 1 && cloudList[0].uldCode === 'Q7-00' &&
    cloudList[0].boardCount === 2 && cloudList[0].totalKg === 1500,
    cloudList.length ? `${cloudList[0].uldCode}/${cloudList[0].boardCount}` : 'empty');
  check('5.5 雲端清單＝GET /api/loadsim/plans',
    calls[0] && calls[0].url === '/api/loadsim/plans' && calls[0].method === 'GET',
    calls[0] ? `${calls[0].method} ${calls[0].url}` : 'no call');

  calls.length = 0;
  apiResponse = { data: { id: 7, name: '雲端板', saved_at: '2026-11-07T07:30:00.000Z', snapshot: BOARD_SNAPSHOT } };
  const cloudOne = await plans.loadsimCloudGet(7);
  check('5.6 雲端單筆帶回 snapshot', !!cloudOne && cloudOne.snapshot.items.length === 4 && calls[0].url === '/api/loadsim/plans/7');

  calls.length = 0;
  apiResponse = { data: { id: 9, name: '板 A', uld_code: 'Q7-00', plate_type: 'thin', item_count: 4, board_count: 2, total_kg: 1500, gross_kg: 1620, utilization_pct: 59.4, saved_at: '2026-11-07T07:30:00.000Z' } };
  await plans.loadsimCloudSave({ name: '板 A', snapshot: BOARD_SNAPSHOT });
  check('5.7 沒有 id → POST 新增（自動帶 summary）',
    calls[0] && calls[0].method === 'POST' && calls[0].url === '/api/loadsim/plans' &&
    calls[0].body.name === '板 A' && calls[0].body.summary.boardCount === 2,
    calls[0] ? `${calls[0].method} ${calls[0].url}` : 'no call');

  calls.length = 0;
  await plans.loadsimCloudSave({ id: 7, name: '板 A', snapshot: BOARD_SNAPSHOT });
  check('5.8 有 id → PUT 覆蓋',
    calls[0] && calls[0].method === 'PUT' && calls[0].url === '/api/loadsim/plans/7',
    calls[0] ? `${calls[0].method} ${calls[0].url}` : 'no call');

  calls.length = 0;
  await plans.loadsimCloudRename(7, '改名後');
  check('5.9 雲端改名只送 name（不重傳 snapshot）',
    calls[0] && calls[0].method === 'PUT' && calls[0].body.name === '改名後' && calls[0].body.snapshot === undefined);

  calls.length = 0;
  await plans.loadsimCloudDelete(7);
  check('5.10 雲端刪除＝DELETE /api/loadsim/plans/7',
    calls[0] && calls[0].method === 'DELETE' && calls[0].url === '/api/loadsim/plans/7');

  apiError = '請先登入';
  let cloudThrew = false;
  try { await plans.loadsimCloudList(); } catch (err) { cloudThrew = /請先登入/.test(err.message); }
  check('5.11 雲端 API 失敗 → 錯誤往上拋（UI 顯示訊息）', cloudThrew);
  apiError = null;

  // ===== 6. 靜態檢查（HTML 按鈕 / CSS / 後端掛載 / 資料表）=====
  const fs = require('fs');
  const root = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'public', 'css', 'loadsim.css'), 'utf8');
  const serverSrc = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  const dbSrc = fs.readFileSync(path.join(root, 'db', 'database.js'), 'utf8');
  const loadsimSrc = fs.readFileSync(path.join(root, 'public', 'js', 'loadsim.js'), 'utf8');
  check('6.1 index.html 有「存檔 / 我的存檔」按鈕',
    html.includes('id="loadsim-btn-plan-save"') && html.includes('id="loadsim-btn-plan-open"'));
  check('6.2 loadsim.js 有綁定兩個按鈕的事件',
    loadsimSrc.includes("document.getElementById('loadsim-btn-plan-save')") &&
    loadsimSrc.includes("document.getElementById('loadsim-btn-plan-open')") &&
    loadsimSrc.includes('openSavePlanModal') && loadsimSrc.includes('openPlanListModal'));
  check('6.3 loadsim.css 有存檔清單樣式',
    css.includes('.loadsim-plan-list') && css.includes('.loadsim-plan-row') && css.includes('.loadsim-plan-empty'));
  check('6.4 server.js 掛載 /api/loadsim（admin / staff）',
    /app\.use\('\/api\/loadsim',\s*requireRole\('admin', 'staff'\)/.test(serverSrc));
  check('6.5 database.js 建 loadsim_plans 表（含 snapshot 與 saved_at）',
    /CREATE TABLE IF NOT EXISTS loadsim_plans/.test(dbSrc) && dbSrc.includes('snapshot TEXT') && dbSrc.includes('saved_at TEXT'));

  console.log(`\n===== 完成：PASS ${passCount} / FAIL ${failCount} =====`);
  if (failCount > 0) process.exitCode = 1;
})().catch((err) => {
  console.error('測試執行失敗：', err);
  process.exitCode = 1;
});

