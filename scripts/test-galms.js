/**
 * scripts/test-galms.js
 * 驗證 GA-LNS 非同步求解 API（Phase C）：
 *   1. 建立專案（Q7-00 + PMC）與貨物
 *   2. POST /api/packing/solve 開始求解
 *   3. 輪詢進度直到 completed
 *   4. 驗證方案：數量、放置數、無重疊、無超界
 *   5. 驗證取消功能
 *
 * 用法：node scripts/test-galms.js
 * 依賴：伺服器在 127.0.0.1:3000 運行且已登入可用。
 */
const http = require('http');

const BASE = 'http://127.0.0.1:3000';
let cookie = '';
let projectId = null;

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
      headers: { 'Content-Type': 'application/json' },
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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** 檢查兩盒子是否重疊（mm，含 1e-6 容差消除浮點誤差） */
function overlaps(a, b) {
  const EPS = 1e-6;
  return (
    a.x + EPS < b.x + b.l && a.x + a.l > b.x + EPS &&
    a.y + EPS < b.y + b.w && a.y + a.w > b.y + EPS &&
    a.z + EPS < b.z + b.h && a.z + a.h > b.z + EPS
  );
}

// ===== 主流程 =====
async function main() {
  console.log('=== GA-LNS 非同步求解 API 測試 ===\n');

  // 0. 登入
  const login = await request('POST', '/api/auth/login', { companyCode: 'AGL', userId: 'admin', password: 'admin123' });
  if (login.status !== 200) {
    console.error('⚠️ 無法登入:', login.raw);
    process.exit(1);
  }
  console.log('✅ 登入成功\n');

  // 1. 建立專案
  const create = await request('POST', '/api/packing/projects', {
    mawb: 'GA-LNS-TEST',
    dest: 'HKG',
    ulds: [
      { uld_type: 'Q7-00', quantity: 1 },
      { uld_type: 'PMC', quantity: 1 },
    ],
  });
  assert(create.status === 201, `建立測試專案 → ${create.status}`);
  projectId = create.json.id;

  // 新增客戶
  const cust = await request('POST', `/api/packing/projects/${projectId}/customers`, { hawb: 'TEST123456', customer_name: 'GA Test' });

  // 新增多樣貨物
  const items = [
    { length_cm: 60, width_cm: 40, height_cm: 40, pcs: 8, weight_kg: 15, is_stackable: true, pack_type: 'CTN' },
    { length_cm: 120, width_cm: 100, height_cm: 150, pcs: 2, weight_kg: 400, is_stackable: false, pack_type: 'PLT' },
    { length_cm: 80, width_cm: 60, height_cm: 50, pcs: 10, weight_kg: 25, is_stackable: true, pack_type: 'CTN' },
    { length_cm: 200, width_cm: 100, height_cm: 80, pcs: 2, weight_kg: 300, is_stackable: true, pack_type: 'PLT' },
    { length_cm: 40, width_cm: 30, height_cm: 25, pcs: 20, weight_kg: 5, is_stackable: true, pack_type: 'CTN' },
  ];
  let itemsAdded = 0;
  for (const it of items) {
    const r = await request('POST', `/api/packing/projects/${projectId}/items`, { ...it, customer_id: cust.json.id });
    if (r.status === 201) itemsAdded++;
  }
  assert(itemsAdded === 5, `新增 5 組貨物（${itemsAdded}/5）`);

  // 2. 開始求解（小參數加速測試）
  const solve = await request('POST', '/api/packing/solve', {
    project_id: projectId,
    options: {
      populationSize: 8,
      maxGenerations: 5,
      lnsIterations: 2,
      solutionCount: 3,
      seed: 42,
    },
  });
  assert(solve.status === 202 && solve.json.jobId > 0, `開始求解 → jobId=${solve.json.jobId}`);
  const jobId = solve.json.jobId;

  // 3. 輪詢進度
  let jobState = null;
  for (let i = 0; i < 100; i++) {
    await sleep(300);
    const st = await request('GET', `/api/packing/solve/${jobId}`);
    if (st.status === 200) {
      jobState = st.json;
      process.stdout.write(`\r  進度: ${jobState.progress}% (${jobState.status})        `);
      if (jobState.status === 'completed' || jobState.status === 'failed' || jobState.status === 'cancelled') break;
    } else {
      break;
    }
  }
  console.log('\n');
  assert(jobState && jobState.status === 'completed', `求解完成（status=${jobState && jobState.status}）`);
  assert(jobState.progress === 100, '進度達 100%');

  // 4. 驗證方案
  const result = jobState.result;
  assert(result && result.success === true, '結果 success=true');
  assert(result.solutions.length >= 1 && result.solutions.length <= 3, `方案數 ${result.solutions.length}（1~3）`);

  const best = result.solutions[0];
  assert(best.stats.placedCount > 0, `最優方案放置 ${best.stats.placedCount} 件`);
  assert(best.stats.volumeUtilization > 0, `體積利用率 ${best.stats.volumeUtilization}% > 0`);
  assert(best.stats.totalWeightKg > 0, `總重量 ${best.stats.totalWeightKg}kg > 0`);
  assert(best.stats.totalWeightKg <= best.stats.totalWeightCapacityKg, `總重量未超限（${best.stats.totalWeightKg} ≤ ${best.stats.totalWeightCapacityKg}）`);

  // 無重疊檢查
  const placed = best.placedItems;
  let overlapFound = false;
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      if (placed[i].uldId === placed[j].uldId && overlaps(placed[i], placed[j])) {
        overlapFound = true;
        console.error(`  重疊：${placed[i].id} 與 ${placed[j].id}`);
      }
    }
  }
  assert(!overlapFound, `無貨物重疊（共 ${placed.length} 件）`);

  // 座標在 ULD 內檢查（mm 原點 = ULD 底部中心）
  const uldMap = {};
  best.ulds.forEach((u) => { uldMap[u.id] = u; });
  let outOfBounds = 0;
  placed.forEach((p) => {
    const u = uldMap[p.uldId];
    if (!u) { outOfBounds++; return; }
    if (Math.abs(p.x) > u.l / 2 + 1 || Math.abs(p.y) > u.w / 2 + 1 || p.z < -1 || p.z + p.h > u.h + 1) {
      outOfBounds++;
    }
  });
  assert(outOfBounds === 0, `全部貨物在 ULD 邊界內（逾界 ${outOfBounds} 件）`);

  // 5. 取消功能測試（用較大參數使 job 執行數秒，確保取消能中斷）
  const solve2 = await request('POST', '/api/packing/solve', {
    project_id: projectId,
    options: { populationSize: 20, maxGenerations: 200, lnsIterations: 5, solutionCount: 3, seed: 7 },
  });
  assert(solve2.status === 202, `建立第二個 job → ${solve2.json.jobId}`);
  const cancel = await request('POST', `/api/packing/solve/${solve2.json.jobId}/cancel`);
  assert(cancel.status === 200, '取消成功');
  await sleep(300);
  const st2 = await request('GET', `/api/packing/solve/${solve2.json.jobId}`);
  assert(st2.json.cancelled === true, `取消旗標生效（status=${st2.json.status}）`);
  if (st2.json.status === 'running') {
    await sleep(800);
    const st2b = await request('GET', `/api/packing/solve/${solve2.json.jobId}`);
    assert(['cancelled', 'completed'].includes(st2b.json.status), `取消後終態（status=${st2b.json.status}）`);
  }

  // 6. 清理：刪除測試專案
  const del = await request('DELETE', `/api/packing/projects/${projectId}`);
  assert(del.status === 200, '刪除測試專案');

  console.log('\n=== 測試完成 ===');
}

main().catch((err) => {
  console.error('測試執行失敗:', err.message);
  process.exitCode = 1;
});