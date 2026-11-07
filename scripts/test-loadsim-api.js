// ===== 模擬裝板：雲端存檔 API 端對端測試（自帶伺服器 ＋ 暫存資料庫）=====
// 驗證：權限（未登入 401 / customer 403）→ 新增（422 驗證）→ 清單（不含 snapshot）
//       → 單筆（含 snapshot）→ 改名（只送 name）→ 覆蓋（snapshot ＋ summary）→ 刪除 → 404 → 審計日誌
// 用法：node scripts/test-loadsim-api.js
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 3161);
const BASE = `http://127.0.0.1:${PORT}`;
const DB_PATH = path.join(ROOT, 'data', `test-loadsim-${Date.now()}.db`);
const CREDS = {
  companyCode: process.env.TEST_COMPANY || 'AGL',
  userId: process.env.TEST_USER || 'admin',
  password: process.env.TEST_PASSWORD || 'admin123'
};
const CUSTOMER_PASSWORD = 'cust1234';

let failures = 0;
let cookie = '';

function check(label, ok, detail) {
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

async function req(method, url, body) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  let payload;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(BASE + url, { method, headers, body: payload });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('json')) return { status: res.status, body: await res.json() };
  return { status: res.status, text: await res.text() };
}

// 直接查 DB（檢查 seed 與審計日誌；不經 API）
function queryDb(sql, params = []) {
  return new Promise((resolve) => {
    const db = new sqlite3.Database(DB_PATH);
    db.get(sql, params, (err, row) => {
      db.close();
      if (err) return resolve(null);
      if (!row) return resolve(null);
      const values = Object.values(row);
      return resolve(values.length === 1 ? values[0] : row);
    });
  });
}

function runSeed() {
  return new Promise((resolve) => {
    const child = spawn('node', [path.join(ROOT, 'scripts', 'seed-admin.js')], {
      cwd: ROOT,
      env: Object.assign({}, process.env, { DB_PATH }),
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let out = '';
    child.stdout.on('data', (d) => { out += String(d); });
    child.on('exit', () => resolve(out));
  });
}

function waitForAdmin(timeoutMs = 8000) {
  const started = Date.now();
  return new Promise((resolve) => {
    const tick = async () => {
      const n = await queryDb("SELECT COUNT(*) AS n FROM users WHERE user_id = 'admin'");
      if (Number(n) > 0) return resolve(true);
      if (Date.now() - started > timeoutMs) return resolve(false);
      setTimeout(tick, 300);
    };
    tick();
  });
}

async function waitUp(child) {
  let log = '';
  child.stdout.on('data', (d) => { log += String(d); });
  for (let i = 0; i < 60; i += 1) {
    try {
      await fetch(`${BASE}/api/auth/me`);
      return true;
    } catch (err) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  console.log(log);
  return false;
}

// 測試用存檔：2 件在板上（1000 + 500 kg）、1 件待裝
const SNAPSHOT = {
  app: 'agl-loadsim',
  version: 1,
  savedAt: '2026-11-07T07:30:00.000Z',
  unit: 'cm',
  uldCode: 'Q7-00',
  plateType: 'thin',
  items: [
    { id: 1, name: 'A', dims: { l: 120, w: 100, h: 100 }, weight: 1000, color: '#2563eb', orient: 0, x: 0, y: 0, z: 0, placed: true, staged: false },
    { id: 2, name: 'B', dims: { l: 120, w: 100, h: 100 }, weight: 500, color: '#0ea5e9', orient: 0, x: 120, y: 0, z: 0, placed: true, staged: false },
    { id: 3, name: 'C', dims: { l: 120, w: 100, h: 100 }, weight: 300, color: '#16a34a', orient: 0, x: 0, y: 0, z: 0, placed: false, staged: false }
  ],
  specOverrides: {},
  seq: 4
};

(async () => {
  console.log('===== 模擬裝板：雲端存檔 API 測試 =====');
  const child = spawn('node', ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, { PORT: String(PORT), DB_PATH }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stderr.on('data', (d) => process.stderr.write(String(d)));

  let planId = null;
  let badId = null;
  try {
    check('伺服器啟動', await waitUp(child), `port ${PORT}`);
    check('R4 伺服器自己就完成 seed（全新 DB 也有預設 admin）', await waitForAdmin(8000));
    await runSeed();

    // ---- 權限：未登入 401 ----
    check('未登入 GET /api/loadsim/plans → 401', (await req('GET', '/api/loadsim/plans')).status === 401);

    const login = await req('POST', '/api/auth/login', CREDS);
    check('登入成功（admin）', login.status === 200, String(login.status));

    const emptyList = await req('GET', '/api/loadsim/plans');
    check('清單一開始是空的',
      emptyList.status === 200 && Array.isArray(emptyList.body.data) && emptyList.body.data.length === 0,
      String(emptyList.status));

    // ---- 422 驗證 ----
    check('POST 沒有名稱 → 422', (await req('POST', '/api/loadsim/plans', { snapshot: SNAPSHOT })).status === 422);
    check('POST 沒有 snapshot → 422', (await req('POST', '/api/loadsim/plans', { name: 'X' })).status === 422);
    check('POST items 不是陣列 → 422',
      (await req('POST', '/api/loadsim/plans', { name: 'X', snapshot: { items: 'nope' } })).status === 422);

    // ---- 新增（不送 summary → 伺服器自己算）----
    const created = await req('POST', '/api/loadsim/plans', { name: '  11/07 板 A  ', snapshot: SNAPSHOT });
    planId = created.body && created.body.data ? created.body.data.id : null;
    check('POST → 201 並回傳 id', created.status === 201 && !!planId, String(created.status));
    check('名稱去頭尾空白', created.body.data.name === '11/07 板 A', created.body.data.name);
    check('伺服器自己算彙總：item 3 / board 2 / total 1500 kg',
      created.body.data.item_count === 3 && created.body.data.board_count === 2 &&
      Number(created.body.data.total_kg) === 1500,
      `${created.body.data.item_count}/${created.body.data.board_count}/${created.body.data.total_kg}`);
    check('板型 / 板底寫入欄位',
      created.body.data.uld_code === 'Q7-00' && created.body.data.plate_type === 'thin');
    check('單筆回傳帶 snapshot（3 件）',
      !!created.body.data.snapshot && created.body.data.snapshot.items.length === 3);
    check('created_by 記錄操作者', created.body.data.created_by === 'admin', String(created.body.data.created_by));

    // ---- 清單 / 單筆 ----
    const list1 = await req('GET', '/api/loadsim/plans');
    const row1 = list1.body.data[0] || {};
    check('清單 1 筆且不含 snapshot（清單不抓大檔）',
      list1.body.data.length === 1 && row1.snapshot === undefined);
    check('清單帶 saved_at（前端顯示使用者當地時間）', !!row1.saved_at, String(row1.saved_at));

    const one = await req('GET', `/api/loadsim/plans/${planId}`);
    check('GET 單筆 → 200 且 snapshot 完整',
      one.status === 200 && one.body.data.snapshot.items.length === 3, String(one.status));
    check('GET 不存在 → 404', (await req('GET', '/api/loadsim/plans/999999')).status === 404);

    // ---- 改名（只送 name，不重傳 snapshot）----
    const renamed = await req('PUT', `/api/loadsim/plans/${planId}`, { name: '改名後' });
    check('PUT 只送 name → 改名且 snapshot 保留',
      renamed.status === 200 && renamed.body.data.name === '改名後' &&
      renamed.body.data.snapshot.items.length === 3, String(renamed.status));
    check('PUT 空名稱 → 422',
      (await req('PUT', `/api/loadsim/plans/${planId}`, { name: '   ' })).status === 422);
    check('PUT 不存在 → 404',
      (await req('PUT', '/api/loadsim/plans/999999', { name: 'x' })).status === 404);

    // ---- 覆蓋內容（snapshot ＋ summary）----
    const bigger = Object.assign({}, SNAPSHOT, {
      items: SNAPSHOT.items.concat([
        { id: 4, name: 'D', dims: { l: 60, w: 50, h: 40 }, weight: 200, placed: true, staged: false }
      ])
    });
    const updated = await req('PUT', `/api/loadsim/plans/${planId}`, {
      name: '改名後',
      snapshot: bigger,
      summary: { itemCount: 4, boardCount: 3, totalKg: 1700, grossKg: 1820, utilizationPct: 59.4 }
    });
    check('PUT 覆蓋內容 → 件數 / 重量 / 利用率更新',
      updated.status === 200 && updated.body.data.item_count === 4 && updated.body.data.board_count === 3 &&
      Number(updated.body.data.total_kg) === 1700 && Number(updated.body.data.utilization_pct) === 59.4,
      `${updated.body.data.item_count}/${updated.body.data.board_count}/${updated.body.data.total_kg}/${updated.body.data.utilization_pct}`);
    // ---- 壞貨物（尺寸 0）會被略過，不讓整份存檔失敗 ----
    const withBad = Object.assign({}, SNAPSHOT, {
      items: SNAPSHOT.items.concat([
        { id: 9, name: 'bad', dims: { l: 0, w: 0, h: 0 }, weight: 999, placed: true, staged: false }
      ])
    });
    const badRow = await req('POST', '/api/loadsim/plans', { name: '壞貨物', snapshot: withBad });
    badId = badRow.body && badRow.body.data ? badRow.body.data.id : null;
    check('尺寸 0 的貨物會被略過（仍然 201、只算 3 件）',
      badRow.status === 201 && badRow.body.data.snapshot.items.length === 3 &&
      badRow.body.data.board_count === 2,
      badRow.status === 201 ? `${badRow.body.data.snapshot.items.length} 件` : String(badRow.status));

    // ---- 刪除 ----
    check('DELETE → 200', (await req('DELETE', `/api/loadsim/plans/${badId}`)).status === 200);
    check('DELETE 不存在 → 404', (await req('DELETE', '/api/loadsim/plans/999999')).status === 404);
    const list2 = await req('GET', '/api/loadsim/plans');
    check('刪除後清單剩 1 筆（就是剛才覆蓋的那份）',
      list2.body.data.length === 1 && list2.body.data[0].id === planId);

    // ---- 審計日誌 ----
    await new Promise((r) => setTimeout(r, 300));
    const auditCount = await queryDb("SELECT COUNT(*) AS n FROM audit_log WHERE action LIKE 'loadsim.plan.%'");
    check('寫入審計日誌（loadsim.plan.create / update / remove）',
      Number(auditCount) >= 3, `${auditCount} 筆`);

    // ---- 權限：customer → 403 ----
    const companyRow = await queryDb('SELECT id, company_code FROM companies ORDER BY id LIMIT 1');
    const companyId = companyRow && companyRow.id;
    const companyCode = (companyRow && companyRow.company_code) || CREDS.companyCode;
    const newUser = await req('POST', '/api/auth/users', {
      company_id: companyId,
      user_id: 'loadsimcust',
      password: CUSTOMER_PASSWORD,
      display_name: '模擬裝板測試客戶',
      role: 'customer'
    });
    check('建立 customer 帳號（測 requireRole 403）',
      newUser.status === 200 || newUser.status === 201, String(newUser.status));

    const adminCookie = cookie;
    cookie = '';
    const custLogin = await req('POST', '/api/auth/login', {
      companyCode,
      userId: 'loadsimcust',
      password: CUSTOMER_PASSWORD
    });
    check('customer 登入', custLogin.status === 200, String(custLogin.status));
    check('customer GET /api/loadsim/plans → 403',
      (await req('GET', '/api/loadsim/plans')).status === 403);
    check('customer POST /api/loadsim/plans → 403',
      (await req('POST', '/api/loadsim/plans', { name: 'x', snapshot: SNAPSHOT })).status === 403);
    cookie = adminCookie;
  } catch (err) {
    console.error('測試執行失敗：', err);
    failures += 1;
  } finally {
    child.kill();
    try { fs.unlinkSync(DB_PATH); } catch (e) { /* 檔案仍被佔用時就算了 */ }
  }

  console.log(`\n===== 完成：${failures === 0 ? '全部 PASS' : `FAIL ${failures} 項`} =====`);
  if (failures > 0) process.exitCode = 1;
})();

