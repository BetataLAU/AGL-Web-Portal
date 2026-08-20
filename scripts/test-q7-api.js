/**
 * scripts/test-q7-api.js
 * 端到端驗證 Q7-00 ULD：
 *   1. 登入
 *   2. GET /api/packing/ulds → 確認含 Q7-00
 *   3. POST /api/packing/pack-uld → Q7-00 求解
 * 用法：node scripts/test-q7-api.js 3002
 */
const http = require('http');
const PORT = Number(process.argv[2] || 3002);
let cookie = '';

function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = { 'Content-Type': 'application/json' };
    if (cookie) headers.Cookie = cookie;
    const r = http.request({ host: '127.0.0.1', port: PORT, path, method, headers }, (res) => {
      const sc = res.headers['set-cookie'];
      if (sc && sc.length) cookie = sc.map((c) => c.split(';')[0]).join('; ');
      let raw = '';
      res.on('data', (c) => (raw += c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, json: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, json: null }); }
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

(async () => {
  const login = await req('POST', '/api/auth/login', { companyCode: 'AGL', userId: 'admin', password: 'admin123' });
  console.log('1) 登入:', login.status === 200 ? 'OK' : `FAIL(${login.status})`);

  const ulds = await req('GET', '/api/packing/ulds');
  const allUlds = Array.isArray(ulds.json && ulds.json.data) ? ulds.json.data : [];
  const hasQ7 = allUlds.some((u) => u.code === 'Q7-00');
  console.log(`2) ULD 清單: ${allUlds.length} 種, 含 Q7-00: ${hasQ7}`);
  if (!hasQ7) { console.log('  FAIL: Q7-00 不在清單'); process.exit(1); }

  const pack = await req('POST', '/api/packing/pack-uld', {
    uld_spec: { type: 'Q7-00', net_clearance_mm: 20 },
    cargo_list: [
      { id: 'A', length_mm: 800, width_mm: 600, height_mm: 500, weight_kg: 80, quantity: 10, is_stackable: true },
      { id: 'B', length_mm: 1200, width_mm: 800, height_mm: 600, weight_kg: 200, quantity: 4, is_stackable: true },
      { id: 'C', length_mm: 2000, width_mm: 1000, height_mm: 800, weight_kg: 500, quantity: 2, is_stackable: false },
    ],
  });
  const s = pack.json && pack.json.summary;
  console.log(`3) Q7-00 求解: ${pack.status}, placed ${s ? s.placedCount : '-'}/${s ? s.totalItems : '-'}, util ${s ? s.volumeUtilizationPct : '-'}%, weight ${s ? s.totalWeightKg : '-'}kg`);
  if (pack.status !== 200 || !s || s.placedCount === 0) { console.log('  FAIL: Q7-00 求解異常'); process.exit(1); }

  console.log('\n✅ Q7-00 端到端驗證全部通過');
})();