// ===== 側邊欄導航排序 API 測試腳本 =====
// 驗證重點：
//   1. 未登入 → 401
//   2. 頁面連結型目錄（uld-packing.html / packing.html）能被寫入並取回
//      （舊版白名單只允許 #section-* 與 users.html，這兩個會被過濾掉 → 前端位置記不住）
//   3. 非法 key（evil.js）會被過濾、重複項目會去重
//   4. 非陣列格式 → 400
// 用法：node scripts/test-nav-order.js [port]（預設 3001）
const PORT = Number(process.argv[2] || 3001);
const BASE = `http://127.0.0.1:${PORT}`;

let cookie = '';

async function request(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (cookie) headers['Cookie'] = cookie;
  if (options.body) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${BASE}${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];

  let data = null;
  try { data = await res.json(); } catch (e) { /* no json */ }
  return { status: res.status, data };
}

function log(name, ok, extra = '') {
  console.log(`${ok ? '✅' : '❌'} ${name}${extra ? ' ' + extra : ''}`);
}

(async () => {
  console.log(`===== 側邊欄導航排序 API 測試（port ${PORT}）=====\n`);

  // 1. 未登入 → 401
  const unAuth = await request('/api/auth/me/nav-order');
  log('未登入 GET /api/auth/me/nav-order → 401', unAuth.status === 401, `(HTTP ${unAuth.status})`);

  // 2. 登入 admin
  const login = await request('/api/auth/login', {
    method: 'POST',
    body: { companyCode: 'AGL', userId: 'admin', password: 'admin123' }
  });
  log('登入 admin → 200', login.status === 200, `(HTTP ${login.status})`);
  if (login.status !== 200) {
    console.error('  無法登入，測試中止');
    process.exitCode = 1;
    return;
  }

  // 3. 讀取既有排序
  const before = await request('/api/auth/me/nav-order');
  const originalOrder = Array.isArray(before.data && before.data.order) ? before.data.order : [];
  log('GET 既有排序 → 200', before.status === 200);
  console.log(`   目前排序（${originalOrder.length} 項）：${JSON.stringify(originalOrder)}`);

  // 4. 寫入完整排序（含頁面連結 + 非法 key + 重複項目）
  const payload = ['packing.html', ...originalOrder, 'uld-packing.html', 'evil.js', 'packing.html'];
  const put = await request('/api/auth/me/nav-order', { method: 'PUT', body: { order: payload } });
  const savedOrder = Array.isArray(put.data && put.data.order) ? put.data.order : [];
  log('PUT 含頁面連結的排序 → 200', put.status === 200, `(HTTP ${put.status})`);
  log('  packing.html 已存入', savedOrder.includes('packing.html'));
  log('  uld-packing.html 已存入', savedOrder.includes('uld-packing.html'));
  log('  非法 key (evil.js) 已被過濾', !savedOrder.includes('evil.js'));
  log('  重複項目已去重', savedOrder.length === new Set(savedOrder).size);
  console.log(`   寫入結果（${savedOrder.length} 項）：${JSON.stringify(savedOrder)}`);

  // 5. 重新讀取，確認真的持久化（跨請求一致）
  const after = await request('/api/auth/me/nav-order');
  const readBack = Array.isArray(after.data && after.data.order) ? after.data.order : [];
  log('GET 重新讀取與寫入一致', JSON.stringify(readBack) === JSON.stringify(savedOrder), `(${JSON.stringify(readBack)})`);

  // 6. 非陣列 → 400
  const badType = await request('/api/auth/me/nav-order', { method: 'PUT', body: { order: 'not-an-array' } });
  log('PUT 非陣列 → 400', badType.status === 400, `(HTTP ${badType.status})`);

  // 7. 還原測試前的排序
  const restore = await request('/api/auth/me/nav-order', { method: 'PUT', body: { order: originalOrder } });
  const restored = Array.isArray(restore.data && restore.data.order) ? restore.data.order : [];
  log('還原測試前排序 → 200', restore.status === 200);
  log('  還原結果一致', JSON.stringify(restored) === JSON.stringify(originalOrder));

  console.log('\n===== 測試結束 =====');
  process.exit(0);
})().catch(err => {
  console.error('測試失敗：', err.message);
  process.exit(1);
});
