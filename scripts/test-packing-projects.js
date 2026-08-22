/**
 * scripts/test-packing-projects.js
 * 驗證 ULD 裝箱專案管理 API（Phase A）：
 *   1. 建立專案（含 ULD 明細）
 *   2. 專案列表
 *   3. 新增客戶（自動分配色卡）
 *   4. 新增貨物
 *   5. 專案詳情
 *   6. 追加 ULD / 更新貨物指派 / 刪除專案
 *
 * 用法：node scripts/test-packing-projects.js
 * 依賴：伺服器需在 http://127.0.0.1:3000 運行，且需先登入取得 session cookie。
 */
const http = require('http');

const BASE = 'http://127.0.0.1:3000';
let cookie = '';

// ===== 工具 =====
function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const url = new URL(BASE + path);
    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json',
      },
    };
    if (cookie) options.headers.Cookie = cookie;
    if (data) options.headers['Content-Length'] = Buffer.byteLength(data);

    const req = http.request(options, (res) => {
      let raw = '';
      res.on('data', (chunk) => (raw += chunk));
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(raw); } catch (e) { /* ignore */ }
        const setCookie = res.headers['set-cookie'];
        if (setCookie && setCookie.length) cookie = setCookie[0].split(';')[0];
        resolve({ status: res.statusCode, json, raw });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function assert(cond, label) {
  if (!cond) {
    console.error(`❌ FAIL: ${label}`);
    process.exitCode = 1;
  } else {
    console.log(`✅ PASS: ${label}`);
  }
}

// ===== 測試主流程 =====
async function main() {
  console.log('=== ULD 裝箱專案 API 測試 ===\n');

  // 0. 登入（admin）— 預設：Company Code = AGL / User ID = admin / Password = admin123
  const login = await request('POST', '/api/auth/login', { companyCode: 'AGL', userId: 'admin', password: 'admin123' });
  if (login.status !== 200) {
    console.error('⚠️ 無法登入（預設帳號可能不同）。請確認測試環境的登入帳號。');
    console.error('   Response:', login.raw);
    process.exit(1);
  }
  console.log('✅ 登入成功（已取得 session cookie）\n');

  // 1. 建立專案（含 2 個 Q7-00 + 1 個 PMC）
  const create = await request('POST', '/api/packing/projects', {
    mawb: '999-12345678',
    dest: 'LAX',
    ulds: [
      { uld_type: 'Q7-00', quantity: 2 },
      { uld_type: 'PMC', quantity: 1 },
    ],
  });
  assert(create.status === 201, `建立專案（含 3 個 ULD）→ ${create.status}`);
  const projectId = create.json && create.json.id;
  assert(projectId > 0, `專案 ID = ${projectId}`);

  // 2. 專案列表
  const list = await request('GET', '/api/packing/projects');
  assert(list.status === 200 && Array.isArray(list.json.data), '取得專案列表');
  const proj = list.json.data.find((p) => p.id === projectId);
  assert(proj && proj.uld_count === 3, `專案 ULD 數量 = ${proj && proj.uld_count}（預期 3）`);

  // 3. 新增客戶（自動色卡）
  const cust1 = await request('POST', `/api/packing/projects/${projectId}/customers`, { hawb: 'HKGLX123456', customer_name: 'ABC Logistics' });
  assert(cust1.status === 201 && cust1.json.color_code, `新增客戶 ABC → 色卡 ${cust1.json && cust1.json.color_code}`);

  const cust2 = await request('POST', `/api/packing/projects/${projectId}/customers`, { hawb: 'HKGLX789012', customer_name: 'XYZ Trading' });
  assert(cust2.status === 201 && cust2.json.color_code !== cust1.json.color_code, `新增客戶 XYZ → 色卡 ${cust2.json && cust2.json.color_code}（不同於 ABC）`);

  // 4. 新增貨物
  const item1 = await request('POST', `/api/packing/projects/${projectId}/items`, {
    customer_id: cust1.json.id,
    assigned_uld_id: null,
    pack_type: 'CTN',
    length_cm: 60,
    width_cm: 40,
    height_cm: 40,
    pcs: 10,
    weight_kg: 15,
    is_stackable: true,
  });
  assert(item1.status === 201, `新增貨物 CTN（ABC）→ ${item1.status}`);

  const item2 = await request('POST', `/api/packing/projects/${projectId}/items`, {
    customer_id: cust2.json.id,
    pack_type: 'PLT',
    length_cm: 120,
    width_cm: 100,
    height_cm: 150,
    pcs: 1,
    weight_kg: 400,
    is_stackable: false,
    actual_type: 'Drum',
  });
  assert(item2.status === 201, `新增貨物 PLT（XYZ）→ ${item2.status}`);

  // 5. 專案詳情
  const detail = await request('GET', `/api/packing/projects/${projectId}`);
  assert(detail.status === 200, '取得專案詳情');
  const d = detail.json.data;
  assert(d.ulds && d.ulds.length === 3, `詳情 ULD 數 = ${d.ulds && d.ulds.length}`);
  assert(d.customers && d.customers.length === 2, `詳情客戶數 = ${d.customers && d.customers.length}`);
  assert(d.items && d.items.length === 2, `詳情貨物數 = ${d.items && d.items.length}`);
  assert(d.items[0].color_code === d.customers[0].color_code || d.items[0].color_code === cust1.json.color_code, '貨物帶有客戶色卡');
  assert(d.ulds[0].contour_config && d.ulds[0].contour_config.profileKey === 'Q7_00', 'ULD 輪廓 config 正確（Q7_00）');

  // 6. 追加 ULD
  const addUld = await request('POST', `/api/packing/projects/${projectId}/ulds`, { uld_type: 'AKE', quantity: 2 });
  assert(addUld.status === 201 && addUld.json.inserted === 2, '追加 2 個 AKE ULD');
  const detail2 = await request('GET', `/api/packing/projects/${projectId}`);
  assert(detail2.json.data.ulds.length === 5, `追加後 ULD 數 = ${detail2.json.data.ulds.length}`);

  // 7. 更新貨物指派到 ULD
  const uldId = detail2.json.data.ulds[0].id;
  const patch = await request('PATCH', `/api/packing/projects/${projectId}/items/${item1.json.id}`, { assigned_uld_id: uldId });
  assert(patch.status === 200, `指派貨物到 ULD-${uldId}`);
  const detail3 = await request('GET', `/api/packing/projects/${projectId}`);
  const patchedItem = detail3.json.data.items.find((i) => i.id === item1.json.id);
  assert(patchedItem.assigned_uld_id === uldId, '貨物 ULD 指派已更新');

  // 7b. 刪除單一貨物（item2）
  const delItem = await request('DELETE', `/api/packing/projects/${projectId}/items/${item2.json.id}`);
  assert(delItem.status === 200, '刪除單一貨物');
  const detail3b = await request('GET', `/api/packing/projects/${projectId}`);
  assert(detail3b.json.data.items.length === 1, `刪除後剩餘貨物數 = ${detail3b.json.data.items.length}`);
  assert(!detail3b.json.data.items.some((i) => i.id === item2.json.id), '被刪貨物已不存在');

  // 8. 刪除專案
  const del = await request('DELETE', `/api/packing/projects/${projectId}`);
  assert(del.status === 200, '刪除專案');
  const detail4 = await request('GET', `/api/packing/projects/${projectId}`);
  assert(detail4.status === 404, '刪除後查詢回 404');

  console.log('\n=== 測試完成 ===');
}

main().catch((err) => {
  console.error('測試執行失敗:', err.message);
  process.exitCode = 1;
});