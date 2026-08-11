// ===== 登入系統 API 測試腳本 =====
// 測試：未登入 401 → 登入成功 → 登入後可取訂單 → 錯誤密碼 401 → 登出
// 用法：node scripts/test-auth.js [port]（預設 3001）
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

  // 擷取 set-cookie（登入後保存 session cookie）
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) {
    cookie = setCookie.split(';')[0];
  }

  let data = null;
  try { data = await res.json(); } catch (e) { /* no json */ }
  return { status: res.status, data };
}

function log(name, status, expected, extra = '') {
  const ok = status === expected;
  console.log(`${ok ? '✅' : '❌'} ${name} → HTTP ${status}${ok ? '' : `（期望 ${expected}）`}${extra ? ' ' + extra : ''}`);
}

(async () => {
  console.log(`===== 登入系統 API 測試（port ${PORT}） =====\n`);

  // 1. 未登入取訂單 → 401
  const unAuthOrders = await request('/api/orders');
  log('未登入 GET /api/orders', unAuthOrders.status, 401);

  // 2. 未登入取資料庫 → 401
  const unAuthDb = await request('/api/db/tables');
  log('未登入 GET /api/db/tables', unAuthDb.status, 401);

  // 3. 錯誤密碼登入 → 401
  const badLogin = await request('/api/auth/login', {
    method: 'POST',
    body: { companyCode: 'AGL', userId: 'admin', password: 'wrongpass' }
  });
  log('錯誤密碼登入', badLogin.status, 401);

  // 4. 正確登入 → 200
  const login = await request('/api/auth/login', {
    method: 'POST',
    body: { companyCode: 'AGL', userId: 'admin', password: 'admin123' }
  });
  log('正確登入', login.status, 200, login.data?.user ? `（${login.data.user.company_name} / ${login.data.user.role}）` : '');

  // 5. 登入後 GET /api/auth/me → 200
  const me = await request('/api/auth/me');
  log('GET /api/auth/me', me.status, 200);

  // 6. 登入後取訂單 → 200
  const authOrders = await request('/api/orders');
  log('登入後 GET /api/orders', authOrders.status, 200);

  // 7. 登入後取資料庫（admin）→ 200
  const authDb = await request('/api/db/tables');
  log('登入後 GET /api/db/tables（admin）', authDb.status, 200);

  // 8. 登入後取使用者清單（admin）→ 200
  const authUsers = await request('/api/auth/users');
  log('登入後 GET /api/auth/users（admin）', authUsers.status, 200);

  // 9. 登出 → 200
  const logout = await request('/api/auth/logout', { method: 'POST' });
  log('登出', logout.status, 200);

  // 10. 登出後取訂單 → 401
  const afterLogout = await request('/api/orders');
  log('登出後 GET /api/orders', afterLogout.status, 401);

  console.log('\n===== 測試完成 =====');
})();