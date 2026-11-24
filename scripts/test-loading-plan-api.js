// ===== 執 PLAN：API 端對端測試（自帶伺服器 ＋ 暫存資料庫）=====
// 驗證：權限（未登入 401）→ 存貨自動建立 → 新增 plan → 貼上 bulk（含 cu.ft 換算）
//       → KPI → 跨 plan 搬移（Move，不是複製）→ 搬回存貨 → 就地編輯（VOL→CBM）
//       → 複製（重複 MAWB 409）→ bookings/placements（hover 標籤）→ 事件流 → 刪除保護 → 審計
// 用法：node scripts/test-loading-plan-api.js
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 3162);
const BASE = `http://127.0.0.1:${PORT}`;
const DB_PATH = path.join(ROOT, 'data', `test-loadingplan-${Date.now()}.db`);
const CREDS = {
  companyCode: process.env.TEST_COMPANY || 'AGL',
  userId: process.env.TEST_USER || 'admin',
  password: process.env.TEST_PASSWORD || 'admin123'
};

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

function queryDb(sql, params = []) {
  return new Promise((resolve) => {
    const db = new sqlite3.Database(DB_PATH);
    db.get(sql, params, (err, row) => {
      db.close();
      if (err || !row) return resolve(null);
      const values = Object.values(row);
      return resolve(values.length === 1 ? values[0] : row);
    });
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

const near = (a, b, tol = 0.011) => Math.abs(Number(a) - Number(b)) <= tol;

// ===== SSE 讀取（Node 內建 fetch 的 web stream）=====
async function readSse(url, predicate, timeoutMs = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  let res;
  try {
    res = await fetch(BASE + url, { headers, signal: controller.signal });
  } catch (err) {
    clearTimeout(timer);
    return { status: 0, events: [], error: err.message };
  }
  if (!res.ok) { clearTimeout(timer); return { status: res.status, events: [] }; }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const events = [];
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let cut = buffer.indexOf('\n\n');
      while (cut >= 0) {
        const chunk = buffer.slice(0, cut);
        buffer = buffer.slice(cut + 2);
        const dataLine = chunk.split('\n').find(line => line.startsWith('data:'));
        if (dataLine) {
          try { events.push(JSON.parse(dataLine.slice(5).trim())); } catch (err) { /* ignore */ }
        }
        if (predicate(events)) {
          clearTimeout(timer);
          try { controller.abort(); } catch (err) { /* ignore */ }
          return { status: res.status, events, contentType: res.headers.get('content-type') || '' };
        }
        cut = buffer.indexOf('\n\n');
      }
    }
  } catch (err) { /* abort / 斷線 */ }
  clearTimeout(timer);
  return { status: res.status, events, contentType: res.headers.get('content-type') || '' };
}


(async () => {
  console.log('===== 執 PLAN：API 測試 =====');
  const child = spawn('node', ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, { PORT: String(PORT), DB_PATH }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stderr.on('data', (d) => process.stderr.write(String(d)));

  let plan1 = null;
  let plan2 = null;
  let stock = null;
  let item1 = null;
  try {
    check('伺服器啟動', await waitUp(child), `port ${PORT}`);
    check('全新 DB 自動 seed admin', await waitForAdmin(8000));

    // ---- 權限 ----
    check('未登入 GET /api/loading-plan/plans → 401', (await req('GET', '/api/loading-plan/plans')).status === 401);
    check('未登入 GET /api/loading-plan/events → 401', (await req('GET', '/api/loading-plan/events')).status === 401);
    const login = await req('POST', '/api/auth/login', CREDS);
    check('登入 admin → 200', login.status === 200, String(login.status));

    // ---- 存貨自動建立 ----
    const stockRes = await req('GET', '/api/loading-plan/stock');
    stock = stockRes.body && stockRes.body.data;
    check('GET /stock → 自動建立 type=stock', stockRes.status === 200 && stock && stock.type === 'stock', String(stockRes.status));
    check('存貨一開始是空的', Array.isArray(stockRes.body.items) && stockRes.body.items.length === 0);

    // ---- 新增 plan ----
    const created = await req('POST', '/api/loading-plan/plans', {
      day_code: 'D7', flight_no: 'EK9859', flight_date: '2026-11-14', owner_company: 'SKY DRAGON',
      contour_text: '1 X Q5', max_gross_weight: 9000, max_cbm: 65
    });
    plan1 = created.body && created.body.data;
    check('POST /plans → 201', created.status === 201 && !!plan1, String(created.status));
    check('回傳 flight / date / owner（label 由前端組合）',
      plan1.flight_no === 'EK9859' && plan1.flight_date === '2026-11-14' && plan1.owner_company === 'SKY DRAGON');
    check('contour 解析出 Q5', plan1.contour_code === 'Q5', String(plan1.contour_code));
    check('plan_no 自動產生', /^LP-D7-EK9859-/.test(plan1.plan_no), String(plan1.plan_no));

    // ---- bulk（Excel 貼上；含 cu.ft）----
    const bulk = await req('POST', `/api/loading-plan/plans/${plan1.id}/items/bulk`, {
      rows: [
        { mawb: '176-6985 5240', client: 'MAERSK', dest: 'DWC', pkgs_text: '17+7P', gross_weight: 1302, cbm: 6.82 },
        { mawb: '176-6840 0640', client: 'MAERSK', dest: 'DWC', pkgs_text: '3+4P', gross_weight: 220, cuft: 240.85, volume_input_unit: 'cuft' }
      ]
    });
    check('bulk → 201 並建立 2 筆', bulk.status === 201 && bulk.body.items && bulk.body.items.length === 2, String(bulk.status));
    const t1 = bulk.body.data.totals || {};
    check('KPI 票數 2 / 件數 31', t1.tickets === 2 && t1.pcs === 31, `${t1.tickets}/${t1.pcs}`);
    check('KPI G.W 1,522', near(t1.grossWeight, 1522), String(t1.grossWeight));
    check('KPI CBM 13.64（cu.ft 換算回來）', near(t1.cbm, 13.64), String(t1.cbm));
    check('KPI VOL 2,273.34（逐列換算）', near(t1.vol, 2273.34), String(t1.vol));
    check('KPI cu.ft 481.7', near(t1.cuft, 481.7), String(t1.cuft));
    check('G.W 使用率 16.9%（上限 9,000）', near(t1.gwPct, 16.9, 0.05), String(t1.gwPct));
    item1 = bulk.body.items[0];
    check('明細帶三種體積表示', item1.volume && near(item1.volume.cbm, 6.82) && near(item1.volume.vol, 1136.67),
      JSON.stringify(item1.volume));

    // ---- 清單 / 單筆 ----
    const flights = await req('GET', '/api/loading-plan/plans?type=flight');
    check('GET /plans?type=flight → 1 張', flights.body.data.length === 1, String(flights.body.data.length));
    const detail = await req('GET', `/api/loading-plan/plans/${plan1.id}`);
    check('GET /plans/:id → 2 筆明細', detail.status === 200 && detail.body.items.length === 2, String(detail.status));
    check('GET 不存在 plan → 404', (await req('GET', '/api/loading-plan/plans/999999')).status === 404);

    // ---- 第二張 plan ----
    const created2 = await req('POST', '/api/loading-plan/plans', {
      day_code: 'D6', flight_no: 'EK9845', owner_company: 'SKY DRAGON'
    });
    plan2 = created2.body.data;
    check('第二張 plan → 201', created2.status === 201 && !!plan2, String(created2.status));

    // ---- 搬移（Move）：用 MAWB 搜尋拿到 record id ----
    const search = await req('GET', '/api/loading-plan/bookings?search=17669855240');
    const rec = (search.body.data || [])[0];
    check('動態搜尋支援「無空白 MAWB」', !!rec && rec.mawb === '176-6985 5240', rec ? rec.mawb : 'null');
    check('搜尋結果帶 placements', !!rec && rec.placements.length === 1 && rec.placements[0].plan_id === plan1.id);

    const moved = await req('POST', `/api/loading-plan/plans/${plan2.id}/items`, { mawb_record_ids: [rec.id] });
    check('搬移 → moved 1 / added 0',
      moved.status === 200 && moved.body.moved.length === 1 && moved.body.added.length === 0,
      JSON.stringify({ m: moved.body.moved && moved.body.moved.length, a: moved.body.added && moved.body.added.length }));
    check('來源 plan 少一筆（不是複製）', (await req('GET', `/api/loading-plan/plans/${plan1.id}`)).body.items.length === 1);
    check('存貨沒有多一筆', (await req('GET', '/api/loading-plan/stock')).body.items.length === 0);

    // ---- 搬回存貨 ----
    const plan2Detail = await req('GET', `/api/loading-plan/plans/${plan2.id}`);
    const movedItemId = plan2Detail.body.items[0].id;
    const toStock = await req('DELETE', `/api/loading-plan/items/${movedItemId}`);
    check('DELETE /items/:id → 搬回存貨', toStock.status === 200 && toStock.body.moved_to_stock === true, String(toStock.status));
    const stock2 = await req('GET', '/api/loading-plan/stock');
    check('存貨出現該票', stock2.body.items.length === 1 && stock2.body.items[0].mawb === '176-6985 5240');

    // ---- 存貨 → plan（用 item_ids）----
    const fromStock = await req('POST', `/api/loading-plan/plans/${plan2.id}/items`, {
      item_ids: [stock2.body.items[0].id]
    });
    check('存貨明細 → plan（from_plan_id 為存貨）',
      fromStock.status === 200 && fromStock.body.moved.length === 1 && fromStock.body.moved[0].from_plan_id === stock.id);

    // ---- 就地編輯：只送 VOL → 反算 CBM ----
    const patched = await req('PATCH', `/api/loading-plan/items/${movedItemId}`, { volume_weight: 1200 });
    check('PATCH volume_weight=1200 → CBM 7.2',
      patched.status === 200 && near(patched.body.data.cbm, 7.2), patched.body.data && String(patched.body.data.cbm));
    check('cu.ft 同步（≈254.27）', patched.body.data && near(patched.body.data.cuft, 254.27, 0.05),
      patched.body.data && String(patched.body.data.cuft));
    check('plan KPI 同步更新', patched.body.plan && near(patched.body.plan.totals.cbm, 7.2),
      patched.body.plan && String(patched.body.plan.totals.cbm));

    const patchedPkgs = await req('PATCH', `/api/loading-plan/items/${movedItemId}`, { pkgs_text: '10+2P' });
    check('PATCH pkgs_text → cartons 10 / pallets 2 / pcs 12',
      patchedPkgs.body.data.cartons === 10 && patchedPkgs.body.data.pallets === 2 && patchedPkgs.body.data.pcs_total === 12,
      JSON.stringify({ c: patchedPkgs.body.data.cartons, p: patchedPkgs.body.data.pallets }));

    // REMARK（tag）自由文字：DIM 一組一行 → 換行必須保留
    const dimText = '4 / D6\n60 x 40 x 50 / 10\n30 x 20 x 10 / 5';
    const patchedTag = await req('PATCH', `/api/loading-plan/items/${movedItemId}`, { tag: dimText });
    check('PATCH tag（畫面 REMARK）保留 DIM 換行',
      patchedTag.status === 200 && patchedTag.body.data.tag === dimText,
      JSON.stringify(patchedTag.body.data && patchedTag.body.data.tag));

    // ---- CRD（Cargo Ready Date）：DDMMM → ISO；不可遲於 Flight Date ----
    // 注意：item1 已被 Move 到 plan2（沒有 Flight Date）→ 用還在 plan1 的明細測檢核
    const plan1Now = await req('GET', `/api/loading-plan/plans/${plan1.id}`);
    const crdItem = plan1Now.body.items.find(i => i.id !== item1.id) || plan1Now.body.items[0];
    check('plan1 還有明細可測 CRD', !!crdItem, JSON.stringify(plan1Now.body.items.map(i => i.id)));
    const crdOk = await req('PATCH', `/api/loading-plan/items/${crdItem.id}`, { cargo_receipt: '14NOV' });
    check('PATCH cargo_receipt=14NOV → 存成 ISO 2026-11-14',
      crdOk.status === 200 && crdOk.body.data.cargo_receipt === '2026-11-14',
      JSON.stringify(crdOk.body.data && crdOk.body.data.cargo_receipt));
    const crdLate = await req('PATCH', `/api/loading-plan/items/${crdItem.id}`, { cargo_receipt: '2026-11-15' });
    check('CRD 比 Flight Date 遲 → 422（crd_after_flight）',
      crdLate.status === 422 && crdLate.body.data && crdLate.body.data.code === 'crd_after_flight',
      `${crdLate.status} ${crdLate.body.error}`);
    const crdBad = await req('PATCH', `/api/loading-plan/items/${crdItem.id}`, { cargo_receipt: 'ABC' });
    check('CRD 格式錯誤 → 422（crd_invalid）',
      crdBad.status === 422 && crdBad.body.data && crdBad.body.data.code === 'crd_invalid',
      `${crdBad.status} ${crdBad.body.error}`);
    const crdAfter = await req('GET', `/api/loading-plan/plans/${plan1.id}`);
    check('422 不會寫入錯誤日期（仍是 2026-11-14）',
      crdAfter.body.items.find(i => i.id === crdItem.id).cargo_receipt === '2026-11-14');
    const crdClear = await req('PATCH', `/api/loading-plan/items/${crdItem.id}`, { cargo_receipt: '' });
    check('CRD 可清除（空字串）', crdClear.status === 200 && crdClear.body.data.cargo_receipt === '',
      JSON.stringify(crdClear.body.data && crdClear.body.data.cargo_receipt));

    // ---- 複製 ----
    const copySame = await req('POST', `/api/loading-plan/items/${movedItemId}/copy`, { plan_id: plan2.id });
    check('複製到同一張 plan → 409（請用搬移）', copySame.status === 409, String(copySame.status));
    const copyOther = await req('POST', `/api/loading-plan/items/${movedItemId}/copy`, { plan_id: plan1.id });
    check('複製到另一張 plan → 201 並標 duplicated',
      copyOther.status === 201 && copyOther.body.duplicated === true, String(copyOther.status));
    const plan1Detail = await req('GET', `/api/loading-plan/plans/${plan1.id}`);
    check('複製後 plan 1 有 2 筆且 split_of_item_id 有值',
      plan1Detail.body.items.length === 2 && plan1Detail.body.items.some(i => i.split_of_item_id),
      String(plan1Detail.body.items.length));

    // ---- 重複 MAWB：所有 plan 的同一票都要被標記（不能只有複製出來的那列）----
    const plan1Dup = plan1Detail.body.items.find(i => i.mawb === '176-6985 5240');
    check('重複 MAWB：來源 plan 的同一票也標 duplicate_mawb',
      !!plan1Dup && plan1Dup.duplicate_mawb === true &&
      plan1Dup.duplicate_places.some(p => p.plan_id === plan2.id),
      JSON.stringify(plan1Dup && plan1Dup.duplicate_places));
    const plan2AfterCopy = await req('GET', `/api/loading-plan/plans/${plan2.id}`);
    const plan2Dup = plan2AfterCopy.body.items.find(i => i.mawb === '176-6985 5240');
    check('重複 MAWB：另一張 plan 的同一票也標 duplicate_mawb',
      !!plan2Dup && plan2Dup.duplicate_mawb === true &&
      plan2Dup.duplicate_places.some(p => p.plan_id === plan1.id));
    check('duplicate_places 使用 Flight / Date / Owner 標籤',
      plan2Dup.duplicate_places.some(p => p.label === 'EK9859 / 14NOV / SKY DRAGON'),
      JSON.stringify(plan2Dup.duplicate_places.map(p => p.label)));
    const plan1Normal = plan1Detail.body.items.find(i => i.mawb === '176-6840 0640');
    check('未重複的明細 duplicate_mawb = false',
      !!plan1Normal && plan1Normal.duplicate_mawb === false);

    // ---- placements / hover ----
    const placements = await req('GET', '/api/loading-plan/placements?mawb=176-6985%205240');
    check('GET /placements → 2 處', placements.status === 200 && placements.body.data.length === 2, String(placements.status));
    check('位置標籤 = Flight / Date / Owner',
      placements.body.data.some(p => p.label === 'EK9859 / 14NOV / SKY DRAGON') &&
      placements.body.data.some(p => p.label === 'EK9845 / — / SKY DRAGON'),
      JSON.stringify(placements.body.data.map(p => p.label)));

    const search2 = await req('GET', '/api/loading-plan/bookings?search=5240');
    const rec2 = (search2.body.data || [])[0];
    check('bookings 搜尋結果 placements 也是 2 處', rec2 && rec2.placements.length === 2);

    // ---- 事件流（SSE 補送會用）----
    const events = await req('GET', `/api/loading-plan/plans/${plan1.id}/events?since=0`);
    check('GET /plans/:id/events → 有事件', events.status === 200 && events.body.data.length >= 3,
      events.body.data ? String(events.body.data.length) : 'null');
    check('事件帶操作者（實名）', events.body.data.some(e => e.actor_user_id === 'admin'));

    // ---- 刪除保護 ----
    check('刪除有明細的 plan → 409', (await req('DELETE', `/api/loading-plan/plans/${plan1.id}`)).status === 409);
    check('刪除存貨 plan → 409', (await req('DELETE', `/api/loading-plan/plans/${stock.id}`)).status === 409);

    // ---- 422 / 404 ----
    check('加入明細沒帶 ids → 422', (await req('POST', `/api/loading-plan/plans/${plan1.id}/items`, {})).status === 422);
    check('PATCH plan 沒有欄位 → 422', (await req('PATCH', `/api/loading-plan/plans/${plan1.id}`, {})).status === 422);
    check('reorder 沒帶 item_ids → 422', (await req('POST', `/api/loading-plan/plans/${plan1.id}/reorder`, {})).status === 422);
    check('PATCH 不存在明細 → 404', (await req('PATCH', '/api/loading-plan/items/999999', { gross_weight: 1 })).status === 404);
    check('DELETE 不存在明細 → 404', (await req('DELETE', '/api/loading-plan/items/999999')).status === 404);

    // ---- reorder ----
    const reorderIds = plan1Detail.body.items.map(i => i.id).reverse();
    const reordered = await req('POST', `/api/loading-plan/plans/${plan1.id}/reorder`, { item_ids: reorderIds });
    check('reorder → 200 且順序反轉', reordered.status === 200 &&
      reordered.body.items[0].id === reorderIds[0], String(reordered.status));

    // ---- Presence ----
    const presencePost = await req('POST', '/api/loading-plan/presence', {
      conn_id: 'test-conn-1', plan_id: plan1.id, editing_item_id: movedItemId
    });
    check('POST /presence → 200', presencePost.status === 200, String(presencePost.status));
    const presenceList = await req('GET', `/api/loading-plan/presence?plan_id=${plan1.id}`);
    const mine = (presenceList.body.data || []).find(p => p.conn_id === 'test-conn-1');
    check('GET /presence 看到自己＋正在編輯哪一格',
      !!mine && Number(mine.editing_item_id) === Number(movedItemId), JSON.stringify(mine));
    check('presence 帶實名', !!mine && mine.user_id === 'admin');

    // ---- SSE ----
    const before = await req('GET', '/api/loading-plan/events.json?since=0');
    const maxId = (before.body.events || []).reduce((max, e) => Math.max(max, Number(e.id) || 0), 0);
    check('/events.json 先取得目前最大 event id', maxId > 0, String(maxId));

    const ssePromise = readSse(
      `/api/loading-plan/events?since=${maxId}`,
      (events) => events.some(e => e.action === 'item.patch')
    );
    await new Promise((r) => setTimeout(r, 350));
    const patchForSse = await req('PATCH', `/api/loading-plan/items/${movedItemId}`, { gross_weight: 1234 });
    check('（觸發一次 PATCH 讓 SSE 有新事件）', patchForSse.status === 200, String(patchForSse.status));

    const sse = await ssePromise;
    check('SSE Content-Type 是 text/event-stream',
      String(sse.contentType).includes('text/event-stream'), String(sse.contentType));
    check('SSE 有 presence.snapshot（連上就送）',
      sse.events.some(e => e.action === 'presence.snapshot'));
    check('SSE 收到即時 item.patch', sse.events.some(e => e.action === 'item.patch'),
      JSON.stringify(sse.events.map(e => e.action)));

    // ---- 斷線補送（Last-Event-ID / since）----
    const replay = await readSse(
      `/api/loading-plan/events?since=${maxId}`,
      (events) => events.some(e => e.action === 'item.patch'),
      3000
    );
    check('重連 since=舊 id → 補送漏掉的 item.patch',
      replay.events.some(e => e.action === 'item.patch'),
      JSON.stringify(replay.events.map(e => e.action)));

    // ---- 輪詢降級 ----
    const polled = await req('GET', `/api/loading-plan/events.json?since=${maxId}`);
    check('/events.json 回傳 events ＋ presence',
      Array.isArray(polled.body.events) && Array.isArray(polled.body.presence));

    // ---- 離開 ----
    const presenceDel = await req('DELETE', '/api/loading-plan/presence/test-conn-1');
    check('DELETE /presence/:connId → 200', presenceDel.status === 200, String(presenceDel.status));
    const afterDel = await req('GET', `/api/loading-plan/presence?plan_id=${plan1.id}`);
    check('離開後 presence 不再有自己',
      !(afterDel.body.data || []).some(p => p.conn_id === 'test-conn-1'));

    // ---- 匯出 Excel（xlsx）----
    const exportRes = await fetch(`${BASE}/api/loading-plan/plans/${plan1.id}/export.xlsx`, {
      headers: cookie ? { Cookie: cookie } : {}
    });
    const exportBuf = Buffer.from(await exportRes.arrayBuffer());
    check('匯出 xlsx → 200 ＋ spreadsheet Content-Type',
      exportRes.status === 200 && String(exportRes.headers.get('content-type')).includes('spreadsheetml'),
      String(exportRes.status));
    check('xlsx 檔頭是 ZIP（PK）且內容非空',
      exportBuf.length > 1000 && exportBuf[0] === 0x50 && exportBuf[1] === 0x4b,
      `${exportBuf.length} bytes`);
    check('未登入匯出 → 401',
      (await fetch(`${BASE}/api/loading-plan/plans/${plan1.id}/export.xlsx`)).status === 401);
    check('匯出不存在的 plan → 404',
      (await fetch(`${BASE}/api/loading-plan/plans/999999/export.xlsx`, { headers: cookie ? { Cookie: cookie } : {} })).status === 404);

    // ---- 新增 Booking（「找 Booking」modal 的「＋ 新增」分頁）----
    const newBooking = await req('POST', '/api/loading-plan/bookings', {
      mawb: '176-9999 8883', client: 'NEW CLIENT', dest: 'nrt',
      hawb: 'h123', pkgs_text: '2C+1P', gross_weight: 345.5, cbm: 1.5, tag: '直單',
      cargo_receipt: '14NOV'
    });
    check('POST /bookings → 201', newBooking.status === 201, String(newBooking.status));
    const newRecordId = newBooking.body && newBooking.body.data && newBooking.body.data.id;
    check('回傳 Booking record id', Number(newRecordId) > 0, String(newRecordId));
    const stockAfterNew = await req('GET', '/api/loading-plan/stock');
    const newStockItem = (stockAfterNew.body.items || []).find(i => i.mawb === '176-9999 8883');
    check('建立後直接加入存貨',
      !!newStockItem, JSON.stringify((stockAfterNew.body.items || []).map(i => i.mawb)));
    check('存貨明細連結 mawb_record_id',
      !!newStockItem && Number(newStockItem.mawb_record_id) === Number(newRecordId));
    check('PKGS 2C+1P → 件數 3', !!newStockItem && newStockItem.pcs_total === 3,
      newStockItem && String(newStockItem.pcs_total));
    check('DEST 自動轉大寫 NRT', !!newStockItem && newStockItem.dest === 'NRT', newStockItem && newStockItem.dest);
    check('CBM 1.5 → VOL 250（自動換算）',
      !!newStockItem && near(newStockItem.volume.vol, 250), newStockItem && JSON.stringify(newStockItem.volume));
    check('Booking 的 REMARK 存在 tag（PLAN 表顯示那一欄）',
      !!newStockItem && newStockItem.tag === '直單', newStockItem && String(newStockItem.tag));
    check('Booking 的 CRD（DDMMM）→ 存成 ISO',
      !!newStockItem && /^\d{4}-11-14$/.test(String(newStockItem.cargo_receipt)),
      newStockItem && String(newStockItem.cargo_receipt));
    const newRecordHawb = await queryDb("SELECT hawb FROM mawb_records WHERE mawb = '176-9999 8883'");
    check('Booking 主檔寫入 HAWB（大寫）', newRecordHawb === 'H123', String(newRecordHawb));

    const dupBooking = await req('POST', '/api/loading-plan/bookings', {
      mawb: '17699998883', client: 'DUP'
    });
    check('同號 MAWB（正規化）→ 409', dupBooking.status === 409, String(dupBooking.status));
    check('409 帶既有 Booking id', !!(dupBooking.body && dupBooking.body.data && dupBooking.body.data.id));
    // ---- MAWB# 嚴格驗證（格式＋prefix＋檢查碼；後補MAWB# 例外）----
    const shortMawb = await req('POST', '/api/loading-plan/bookings', { mawb: '176-9999' });
    check('MAWB 位數不足 → 422', shortMawb.status === 422, `${shortMawb.status} ${shortMawb.body && shortMawb.body.error}`);
    const badCheckDigit = await req('POST', '/api/loading-plan/bookings', { mawb: '176-9999 8888' });
    check('MAWB 檢查碼不符 → 422',
      badCheckDigit.status === 422 && /問題|檢查碼|格式/.test(String(badCheckDigit.body && badCheckDigit.body.error)),
      `${badCheckDigit.status} ${badCheckDigit.body && badCheckDigit.body.error}`);
    const badPrefix = await req('POST', '/api/loading-plan/bookings', { mawb: '000-1234 5679' });
    check('MAWB prefix 000 → 422',
      badPrefix.status === 422 && /prefix/.test(String(badPrefix.body && badPrefix.body.error)),
      `${badPrefix.status} ${badPrefix.body && badPrefix.body.error}`);
    const late1 = await req('POST', '/api/loading-plan/bookings', { mawb: '後補MAWB#', client: 'LATE-1' });
    check('「後補MAWB#」允許建立 → 201', late1.status === 201, String(late1.status));
    const late2 = await req('POST', '/api/loading-plan/bookings', { mawb: '後補MAWB#', client: 'LATE-2' });
    check('第二筆「後補MAWB#」不算重複 → 201', late2.status === 201, String(late2.status));
    const formattedMawb = await queryDb("SELECT mawb FROM mawb_records WHERE client = 'NEW CLIENT'");
    check('MAWB 自動格式化後存入（176-9999 8883）', formattedMawb === '176-9999 8883', String(formattedMawb));
    const lateMawb = await queryDb("SELECT mawb FROM mawb_records WHERE client = 'LATE-1'");
    check('後補 Booking 主檔保留「後補MAWB#」', lateMawb === '後補MAWB#', String(lateMawb));
    const stockLate = await req('GET', '/api/loading-plan/stock');
    const lateItems = (stockLate.body.items || []).filter(i => i.mawb === '後補MAWB#');
    check('後補MAWB# 不列入重複 MAWB 判定',
      lateItems.length === 2 && lateItems.every(i => i.duplicate_mawb === false),
      JSON.stringify(lateItems.map(i => i.duplicate_mawb)));
    check('MAWB 空白 → 422',
      (await req('POST', '/api/loading-plan/bookings', { mawb: '' })).status === 422);
    check('未登入 POST /bookings → 401',
      (await fetch(`${BASE}/api/loading-plan/bookings`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mawb: '176-0000 0001' })
      })).status === 401);
    const bookingAudit = await queryDb("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'loading_plan.booking.create'");
    check('新增 Booking（含後補 2 筆）寫 audit_log', Number(bookingAudit) === 3, String(bookingAudit));

    // ---- 封存（ARCHIVE）／RECALL ----
    // USER 認為無用的 PLAN → 封存（離開清單、不列入統計與重複 MAWB 檢核）；封存的可 RECALL 取回。
    const archiveStock = await req('POST', `/api/loading-plan/plans/${stock.id}/archive`);
    check('存貨不能封存 → 409',
      archiveStock.status === 409 && /存貨/.test(String(archiveStock.body && archiveStock.body.error)),
      `${archiveStock.status} ${archiveStock.body && archiveStock.body.error}`);

    const archivePlan2 = await req('POST', `/api/loading-plan/plans/${plan2.id}/archive`);
    check('POST /plans/:id/archive → 200 ＋ archived_at',
      archivePlan2.status === 200 && !!archivePlan2.body.data.archived_at,
      JSON.stringify(archivePlan2.body && archivePlan2.body.data && archivePlan2.body.data.archived_at));
    check('封存者記實名（archived_by 有值）',
      !!archivePlan2.body.data.archived_by, String(archivePlan2.body.data.archived_by));

    const plansAfterArchive = await req('GET', '/api/loading-plan/plans');
    check('封存後不再出現在 PLAN 列表',
      !plansAfterArchive.body.data.some(p => p.id === plan2.id),
      JSON.stringify(plansAfterArchive.body.data.map(p => p.id)));
    const archivedList = await req('GET', '/api/loading-plan/plans?archived=1');
    check('GET /plans?archived=1 找得到封存的 PLAN',
      archivedList.status === 200 && archivedList.body.data.some(p => p.id === plan2.id),
      archivedList.body.data ? JSON.stringify(archivedList.body.data.map(p => p.id)) : 'null');
    const allPlans = await req('GET', '/api/loading-plan/plans?archived=all');
    check('?archived=all 同時包含正常與封存',
      allPlans.body.data.some(p => p.id === plan1.id) && allPlans.body.data.some(p => p.id === plan2.id));

    const plan1AfterArchive = await req('GET', `/api/loading-plan/plans/${plan1.id}`);
    const p1ItemAfterArchive = plan1AfterArchive.body.items.find(i => i.mawb === '176-6985 5240');
    check('封存的 PLAN 不列入重複 MAWB 檢核',
      !!p1ItemAfterArchive && p1ItemAfterArchive.duplicate_mawb === false,
      JSON.stringify(p1ItemAfterArchive && p1ItemAfterArchive.duplicate_places));
    const placementsArchived = await req('GET', '/api/loading-plan/placements?mawb=176-6985%205240');
    check('placements 帶 archived_at（位置清單可標示已封存）',
      placementsArchived.body.data.some(p => p.plan_id === plan2.id && !!p.archived_at),
      JSON.stringify(placementsArchived.body.data.map(p => ({ plan: p.plan_id, archived: p.archived_at }))));

    const addToArchived = await req('POST', `/api/loading-plan/plans/${plan2.id}/items`, { item_ids: [item1.id] });
    check('已封存不能加入明細 → 409', addToArchived.status === 409, String(addToArchived.status));
    const bulkArchived = await req('POST', `/api/loading-plan/plans/${plan2.id}/items/bulk`, {
      rows: [{ mawb: '176-0000 0006', client: 'X' }]
    });
    check('已封存不能貼上 Excel → 409', bulkArchived.status === 409, String(bulkArchived.status));
    const reorderArchived = await req('POST', `/api/loading-plan/plans/${plan2.id}/reorder`, { item_ids: [plan2Dup.id] });
    check('已封存不能拖曳排序 → 409', reorderArchived.status === 409, String(reorderArchived.status));
    const patchArchivedItem = await req('PATCH', `/api/loading-plan/items/${plan2Dup.id}`, { client: 'CHANGED' });
    check('已封存不能就地編輯明細 → 409', patchArchivedItem.status === 409, String(patchArchivedItem.status));
    const patchArchivedPlan = await req('PATCH', `/api/loading-plan/plans/${plan2.id}`, { owner_company: 'CHANGED' });
    check('已封存不能修改表頭 → 409', patchArchivedPlan.status === 409, String(patchArchivedPlan.status));

    const archiveEvent = await queryDb(
      "SELECT COUNT(*) AS n FROM loading_plan_events WHERE action = 'plan.archive' AND plan_id = ?", [plan2.id]
    );
    check('封存寫事件流（plan.archive）', Number(archiveEvent) === 1, String(archiveEvent));
    const archiveAudit = await queryDb("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'loading_plan.archive'");
    check('封存寫 audit_log（loading_plan.archive）', Number(archiveAudit) === 1, String(archiveAudit));

    // ---- RECALL（取回）----
    const recall = await req('POST', `/api/loading-plan/plans/${plan2.id}/recall`);
    check('RECALL → 200 ＋ archived_at 清空',
      recall.status === 200 && !recall.body.data.archived_at,
      JSON.stringify(recall.body.data && recall.body.data.archived_at));
    const plansAfterRecall = await req('GET', '/api/loading-plan/plans');
    check('RECALL 後回到 PLAN 列表', plansAfterRecall.body.data.some(p => p.id === plan2.id));
    const archivedEmpty = await req('GET', '/api/loading-plan/plans?archived=1');
    check('RECALL 後封存清單是空的', archivedEmpty.body.data.length === 0, String(archivedEmpty.body.data.length));
    const plan1AfterRecall = await req('GET', `/api/loading-plan/plans/${plan1.id}`);
    const p1ItemAfterRecall = plan1AfterRecall.body.items.find(i => i.mawb === '176-6985 5240');
    check('RECALL 後重複 MAWB 檢核恢復',
      !!p1ItemAfterRecall && p1ItemAfterRecall.duplicate_mawb === true,
      JSON.stringify(p1ItemAfterRecall && p1ItemAfterRecall.duplicate_places));
    const recallAgain = await req('POST', `/api/loading-plan/plans/${plan2.id}/recall`);
    check('重複 RECALL 不報錯（idempotent）',
      recallAgain.status === 200 && recallAgain.body.already === true, String(recallAgain.status));
    const recallAudit = await queryDb("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'loading_plan.recall'");
    check('RECALL 寫 audit_log（loading_plan.recall）', Number(recallAudit) === 1, String(recallAudit));
    check('封存不存在的 plan → 404',
      (await req('POST', '/api/loading-plan/plans/999999/archive')).status === 404);
    check('RECALL 不存在的 plan → 404',
      (await req('POST', '/api/loading-plan/plans/999999/recall')).status === 404);

    // ---- 審計 ----
    const auditCount = await queryDb("SELECT COUNT(*) AS n FROM audit_log WHERE action LIKE 'loading_plan.%'");
    check('audit_log 有 loading_plan.* 紀錄', Number(auditCount) > 0, String(auditCount));
    const recordCount = await queryDb('SELECT COUNT(*) AS n FROM mawb_records');
    check('bulk 2＋新增 Booking 1＋後補 2 → mawb_records 5 筆', Number(recordCount) === 5, String(recordCount));

    console.log(`\n===== 測試結束：${failures === 0 ? '全部通過' : failures + ' 項失敗'} =====`);
  } catch (err) {
    failures += 1;
    console.error('測試例外：', err && err.stack ? err.stack : err);
  } finally {
    child.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 500));
    [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`].forEach((file) => {
      try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch (e) { /* ignore */ }
    });
    process.exitCode = failures ? 1 : 0;
    setTimeout(() => process.exit(process.exitCode), 200);
  }
})();
