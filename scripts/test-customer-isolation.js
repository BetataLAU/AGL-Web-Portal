// ===== 客戶角色資料隔離測試 =====
// 目的：驗證 customer 角色登入後只能看到「自己公司」的訂單
// 前置：先建立兩間測試客戶公司（TSTC1 / TSTC2），各建一筆訂單，再以客戶身份驗證
const bcrypt = require('bcryptjs');
const db = require('../db/database');
const PORT = Number(process.argv[2] || 3001);
const BASE = `http://127.0.0.1:${PORT}`;

let cookie = '';

function sqlRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this.lastID);
    });
  });
}

function sqlGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

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

function log(name, ok, detail = '') {
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' ' + detail : ''}`);
}

(async () => {
  console.log(`===== 客戶資料隔離測試（port ${PORT}） =====\n`);

  // ===== 前置：建立兩間測試客戶公司 =====
  const c1Id = await sqlRun(
    "INSERT INTO companies (category, name, company_code) VALUES ('customer', '隔離測試客戶一', 'TSTC1')"
  );
  const c2Id = await sqlRun(
    "INSERT INTO companies (category, name, company_code) VALUES ('customer', '隔離測試客戶二', 'TSTC2')"
  );

  // 建立客戶帳號（兩間公司各一個）
  const hashPwd = (pwd) => new Promise((resolve, reject) => {
    bcrypt.hash(pwd, 10, (err, h) => err ? reject(err) : resolve(h));
  });
  const hash1 = await hashPwd('test1234');
  const hash2 = await hashPwd('test1234');
  const c1UserId = await sqlRun(
    "INSERT INTO users (company_id, user_id, password_hash, display_name, role, is_active) VALUES (?, 'cust1', ?, '客戶一', 'customer', 1)",
    [c1Id, hash1]
  );
  const c2UserId = await sqlRun(
    "INSERT INTO users (company_id, user_id, password_hash, display_name, role, is_active) VALUES (?, 'cust2', ?, '客戶二', 'customer', 1)",
    [c2Id, hash2]
  );

  // 建立兩筆訂單（分別屬於兩間公司）
  const orderNo1 = `TST-${Date.now()}-1`;
  const orderNo2 = `TST-${Date.now()}-2`;
  await sqlRun(
    `INSERT INTO orders (order_no, order_type, pickup_no, customer_company_id, cargo_desc, quantity, weight_kg, cbm, power_type, urgent, status)
     VALUES (?, 'pickup', 'P-1001', ?, '測試貨物一', 1, 1.5, 0.1, 'no', 'no', 'pending')`,
    [orderNo1, c1Id]
  );
  await sqlRun(
    `INSERT INTO orders (order_no, order_type, pickup_no, customer_company_id, cargo_desc, quantity, weight_kg, cbm, power_type, urgent, status)
     VALUES (?, 'pickup', 'P-2001', ?, '測試貨物二', 2, 2.5, 0.2, 'no', 'no', 'pending')`,
    [orderNo2, c2Id]
  );
  console.log(`前置：已建立客戶一(id=${c1Id})、客戶二(id=${c2Id})，各一筆訂單\n`);

  // ===== 測試 1：客戶一登入 =====
  const login1 = await request('/api/auth/login', {
    method: 'POST',
    body: { companyCode: 'TSTC1', userId: 'cust1', password: 'test1234' }
  });
  log('客戶一登入', login1.status === 200, login1.data?.user ? `（${login1.data.user.role}）` : '');

  // 客戶一取訂單 → 應只能看到自己公司的（1 筆）
  const orders1 = await request('/api/orders');
  const orderCount1 = orders1.data?.data?.length || 0;
  log('客戶一訂單列表只含自己公司的 1 筆', orderCount1 === 1, `（實際 ${orderCount1} 筆）`);

  // 客戶一看別家訂單（客戶二的 order id）→ 應 404
  const c2Order = await sqlGet("SELECT id FROM orders WHERE order_no = ?", [orderNo2]);
  const forbiddenView = await request(`/api/orders/${c2Order.id}`);
  log('客戶一查看別家訂單被拒', forbiddenView.status === 404, `（HTTP ${forbiddenView.status}）`);

  // 客戶一更新別家訂單 → 應 404
  const forbiddenUpdate = await request(`/api/orders/${c2Order.id}`, {
    method: 'PUT',
    body: { status: 'completed' }
  });
  log('客戶一更新別家訂單被拒', forbiddenUpdate.status === 404, `（HTTP ${forbiddenUpdate.status}）`);

  // 客戶一刪除別家訂單 → 應 404
  const forbiddenDelete = await request(`/api/orders/${c2Order.id}`, { method: 'DELETE' });
  log('客戶一刪除別家訂單被拒', forbiddenDelete.status === 404, `（HTTP ${forbiddenDelete.status}）`);

  // 客戶一存取資料庫檢視器 → 應 403（customer 無權）
  const dbAccess = await request('/api/db/tables');
  log('客戶一存取資料庫檢視器被拒', dbAccess.status === 403, `（HTTP ${dbAccess.status}）`);

  // 客戶一存取使用者管理 → 應 403
  const usersAccess = await request('/api/auth/users');
  log('客戶一存取使用者管理被拒', usersAccess.status === 403, `（HTTP ${usersAccess.status}）`);

  // 客戶一新增訂單 → 客戶公司應被強制設為自己公司
  const newOrder = await request('/api/orders', {
    method: 'POST',
    body: {
      order_type: 'pickup', pickup_no: 'P-NEW1',
      customer_company_id: c2Id, // 故意指定別家公司 → 應被強制蓋回自己公司
      pickup_company_id: c1Id,
      cargo_desc: '新貨物', quantity: 1, weight_kg: 1, cbm: 0.01,
      power_type: 'no', urgent: 'no'
    }
  });
  log('客戶一新增訂單成功', newOrder.status === 200, `（HTTP ${newOrder.status}）`);
  const inserted = await sqlGet("SELECT customer_company_id FROM orders WHERE order_no = ?", [newOrder.data?.order_no || '']);
  log('客戶一新增訂單公司被強制為自己公司', inserted && inserted.customer_company_id === c1Id,
    `（實際 customer_company_id=${inserted ? inserted.customer_company_id : '?'}，期望 ${c1Id}）`);

  // 登出客戶一
  await request('/api/auth/logout', { method: 'POST' });

  // ===== 測試 2：客戶二登入（確認看不見客戶一的訂單） =====
  const login2 = await request('/api/auth/login', {
    method: 'POST',
    body: { companyCode: 'TSTC2', userId: 'cust2', password: 'test1234' }
  });
  log('客戶二登入', login2.status === 200);

  const orders2 = await request('/api/orders');
  const orderCount2 = orders2.data?.data?.length || 0;
  log('客戶二訂單列表只含自己公司的 1 筆', orderCount2 === 1, `（實際 ${orderCount2} 筆，未見客戶一訂單）`);

  console.log('\n===== 客戶資料隔離測試完成 =====');
  process.exit(0);
})().catch(err => {
  console.error('測試失敗：', err.message);
  process.exit(1);
});