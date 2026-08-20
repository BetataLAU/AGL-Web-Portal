/**
 * scripts/test-packing-api.js
 * 3D ULD Packing API 整合測試：
 *   1. 登入（AGL/admin/admin123）
 *   2. GET /api/packing/health
 *   3. GET /api/packing/ulds
 *   4. GET /api/packing/demo
 *   5. POST /api/packing/pack-uld（AKE 斜切容器）
 *
 * 用法：node scripts/test-packing-api.js [port]
 */
const http = require('http');

const BASE_PORT = Number(process.argv[2] || 3005);
const BASE_URL = `http://127.0.0.1:${BASE_PORT}`;

let cookie = '';

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = {
      'Content-Type': 'application/json',
    };
    if (cookie) headers.Cookie = cookie;

    const req = http.request(
      {
        host: '127.0.0.1',
        port: BASE_PORT,
        path,
        method,
        headers,
      },
      (res) => {
        // 抓 set-cookie
        const setCookies = res.headers['set-cookie'];
        if (setCookies && setCookies.length) {
          cookie = setCookies.map((c) => c.split(';')[0]).join('; ');
        }
        let raw = '';
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => {
          let json = null;
          try {
            json = JSON.parse(raw);
          } catch {
            /* not JSON */
          }
          resolve({ status: res.statusCode, json, raw: raw.slice(0, 300) });
        });
      }
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

let passed = 0;
let failed = 0;

function check(name, cond, detail = '') {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ ${name} ${detail}`);
  }
}

async function main() {
  console.log(`=== Packing API Integration Tests (port ${BASE_PORT}) ===`);

  // 1. 未登入 → 401
  console.log('\n--- 1. Auth ---');
  const unauth = await request('GET', '/api/packing/health');
  check('health without login returns 401', unauth.status === 401, `got ${unauth.status}`);

  // 2. 登入
  const login = await request('POST', '/api/auth/login', {
    companyCode: 'AGL',
    userId: 'admin',
    password: 'admin123',
  });
  check('login succeeds', login.status === 200, `got ${login.status}: ${login.raw}`);
  check('login returns user', login.json && login.json.user, '');

  // 3. health
  console.log('\n--- 2. Health & ULD list ---');
  const health = await request('GET', '/api/packing/health');
  check('health 200', health.status === 200, `got ${health.status}`);
  check('health lists ULD types', health.json && Array.isArray(health.json.uldTypes) && health.json.uldTypes.length >= 10,
    `got ${health.json && health.json.uldTypes && health.json.uldTypes.length}`);

  const ulds = await request('GET', '/api/packing/ulds');
  check('ulds 200', ulds.status === 200, `got ${ulds.status}`);
  check('ulds include AKE', Array.isArray(ulds.json.data) && ulds.json.data.some((u) => u.code === 'AKE'), 'AKE missing');
  check('ulds include PMC-Q6', Array.isArray(ulds.json.data) && ulds.json.data.some((u) => u.code === 'PMC-Q6'), 'PMC-Q6 missing');

  // 4. Demo（PMC）
  console.log('\n--- 3. Demo (PMC) ---');
  const demo = await request('GET', '/api/packing/demo');
  check('demo 200', demo.status === 200, `got ${demo.status}: ${demo.raw}`);
  check('demo has sequence', Array.isArray(demo.json.sequence) && demo.json.sequence.length > 0, 'sequence empty');
  check('demo summary ok', demo.json.summary && demo.json.summary.placedCount > 0, `placed ${demo.json.summary && demo.json.summary.placedCount}`);
  if (demo.json.summary) {
    console.log(`    → placed ${demo.json.summary.placedCount}/${demo.json.summary.totalItems}, util ${demo.json.summary.volumeUtilizationPct}%, strategy ${demo.json.strategy}`);
  }

  // 5. POST pack-uld（AKE）
  console.log('\n--- 4. POST pack-uld (AKE) ---');
  const ake = await request('POST', '/api/packing/pack-uld', {
    uld_spec: {
      type: 'AKE',
      net_clearance_mm: 20,
    },
    cargo_list: [
      { id: 'SML', length_mm: 400, width_mm: 300, height_mm: 250, weight_kg: 12, quantity: 20, is_stackable: true },
      { id: 'MED', length_mm: 600, width_mm: 400, height_mm: 350, weight_kg: 35, quantity: 10, is_stackable: true },
      { id: 'BIG', length_mm: 900, width_mm: 600, height_mm: 500, weight_kg: 90, quantity: 2, is_stackable: false },
    ],
    options: { min_support_ratio: 0.7 },
  });
  check('AKE pack 200', ake.status === 200, `got ${ake.status}: ${ake.raw}`);
  check('AKE ULD type correct', ake.json && ake.json.uld && ake.json.uld.type === 'AKE', `got ${ake.json && ake.json.uld && ake.json.uld.type}`);
  check('AKE has placed items', ake.json && ake.json.summary && ake.json.summary.placedCount > 0,
    `placed ${ake.json && ake.json.summary && ake.json.summary.placedCount}`);

  // 6. 錯誤輸入
  console.log('\n--- 5. Error handling ---');
  const bad = await request('POST', '/api/packing/pack-uld', {
    uld_spec: { type: 'BOGUS' },
    cargo_list: [{ id: 'A', length_mm: 100, width_mm: 100, height_mm: 100, weight_kg: 1 }],
  });
  check('unknown ULD returns 400', bad.status === 400, `got ${bad.status}: ${bad.raw}`);

  const noCargo = await request('POST', '/api/packing/pack-uld', { uld_spec: { type: 'AKE' } });
  check('empty cargo returns 400', noCargo.status === 400, `got ${noCargo.status}: ${noCargo.raw}`);

  console.log(`\n==================================`);
  console.log(`API Tests: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Integration test crashed:', err.message);
  process.exit(1);
});