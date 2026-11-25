// ===== HKIA CDP：UI 煙霧測試（Chrome DevTools Protocol，自帶伺服器）=====
// 實際開 Chrome：登入 → 側欄 HKIA CDP → Full Flow #405 → Lite Flow #415 → SSE Callback →
// 查詢下拉 → 設定 → 教學，並檢查 JavaScript 例外 / Console 錯誤。
// 需求：本機安裝 Chrome 或 Edge（或用 CHROME_PATH 指定）；找不到會自動 SKIP（exit 0）。
// 用法：npm run test:hkia-cdp-ui
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const WORK = path.join(ROOT, 'data', 'work');
const STAMP = Date.now();
const PORT = Number(process.env.HKIA_UI_PORT || 3299);
const CDP_PORT = Number(process.env.HKIA_CDP_PORT || 9333);
const DB = path.join(WORK, `test-hkia-ui-${STAMP}.db`);
const DATA = path.join(WORK, `test-hkia-ui-${STAMP}-data`);
const PROFILE = path.join(WORK, `test-hkia-ui-${STAMP}-profile`);
const BASE = `http://127.0.0.1:${PORT}`;

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
].filter(Boolean);
const CHROME = CHROME_CANDIDATES.find((p) => { try { return fs.existsSync(p); } catch (e) { return false; } });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
function check(label, ok, detail) {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

function cleanup() {
  [DATA, PROFILE].forEach((dir) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* ignore */ } });
  [DB, `${DB}-wal`, `${DB}-shm`].forEach((f) => { try { fs.rmSync(f, { force: true }); } catch (e) { /* ignore */ } });
}

if (!CHROME) {
  console.log('SKIP：找不到 Chrome / Edge（可用 CHROME_PATH 指定瀏覽器路徑）');
  process.exit(0);
}

(async () => {
  cleanup();
  fs.mkdirSync(WORK, { recursive: true });
  fs.mkdirSync(path.join(DATA, 'db'), { recursive: true });
  fs.mkdirSync(PROFILE, { recursive: true });

  const server = spawn('node', ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, { PORT: String(PORT), DB_PATH: DB, HKIA_DATA_DIR: DATA, SESSIONS_DIR: path.join(DATA, 'db') }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  server.stderr.on('data', (d) => process.stderr.write(String(d)));

  async function login() {
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companyCode: 'AGL', userId: 'admin', password: 'admin123' })
    });
    if (!res.ok) return null;
    const first = String(res.headers.get('set-cookie') || '').split(';')[0];
    const idx = first.indexOf('=');
    return idx === -1 ? null : { name: first.slice(0, idx), value: first.slice(idx + 1) };
  }

  let cookie = null;
  for (let i = 0; i < 40 && !cookie; i += 1) {
    try { cookie = await login(); } catch (err) { /* wait */ }
    if (!cookie) await sleep(500);
  }
  check('伺服器啟動並可登入', !!cookie);

  const chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${PROFILE}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--disable-extensions',
    '--window-size=1440,1000', 'about:blank'
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  chrome.stderr.on('data', () => { /* ignore chrome noise */ });

  let version = null;
  for (let i = 0; i < 40 && !version; i += 1) {
    try { version = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).json(); } catch (err) { await sleep(300); }
  }
  check('Chrome 遠端偵錯就緒', !!version);

  const target = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });

  let seq = 0;
  const pending = new Map();
  const events = [];
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message)); else resolve(msg.result);
      return;
    }
    if (msg.method) events.push(msg);
  };
  const cdp = (method, params) => new Promise((resolve, reject) => {
    seq += 1;
    pending.set(seq, { resolve, reject });
    ws.send(JSON.stringify({ id: seq, method, params: params || {} }));
  });
  const evaluate = async (expression) => {
    const res = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (res.exceptionDetails) throw new Error(res.exceptionDetails.text || 'evaluate failed');
    return res.result ? res.result.value : undefined;
  };
  const waitFor = async (expression, timeoutMs = 15000) => {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      try { if (await evaluate(expression)) return true; } catch (err) { /* retry */ }
      await sleep(200);
    }
    return false;
  };

  try {
    await cdp('Page.enable');
    await cdp('Runtime.enable');
    await cdp('Log.enable');
    await cdp('Network.enable');
    await cdp('Network.setCookie', { name: cookie.name, value: cookie.value, url: `${BASE}/` });
    await cdp('Page.navigate', { url: `${BASE}/index.html#section-hkia-cdp` });

    check('頁面載入後 #hkia-root 有內容', await waitFor('!!document.querySelector("#hkia-root .hkia-shell")', 20000));
    check('環境徽章顯示 Local Mock', /Mock/i.test(String(await evaluate('document.querySelector(".hkia-env") && document.querySelector(".hkia-env").textContent'))));
    check('API 覆蓋清單 15 項', Number(await evaluate('document.querySelectorAll(".hkia-api-chip").length')) === 15);
    check('側欄有 HKIA CDP 且鎖頭已解鎖',
      await evaluate('!!document.querySelector("#nav-hkia-cdp") && (document.querySelector("#nav-hkia-cdp-lock").style.display === "none")'));

    await evaluate('document.querySelector(\'[data-tab="full"]\').click()');
    check('切到 Full Flow 顯示 3 個步驟卡', await waitFor('document.querySelectorAll(\'[data-scope="full"] .hkia-stepcard\').length === 3'));
    check('Full Flow 預設範本＝Bulk → AAT', (await evaluate('document.querySelector(\'[data-preset="full"]\').value')) === 'bulk_aat');
    check('CTO 預檢已執行（顯示通過）', /預檢通過/.test(String(await evaluate('document.querySelector(\'[data-lint="full"]\').textContent'))));

    await evaluate('document.querySelector(\'[data-action="full-send-405"]\').click()');
    check('#405 送出後顯示結果', await waitFor('!!document.querySelector(\'[data-result="full-405"] .hkia-result\')', 15000));
    const ref = String(await evaluate('document.querySelector("[data-export-ref]").value'));
    check('#405 成功並自動填入 Export Order Ref.', /^EO-/.test(ref), ref);
    check('#405 前方回傳 HTTP 200', /HTTP 200/.test(String(await evaluate('document.querySelector(\'[data-result="full-405"]\').textContent'))));
    const okText = String(await evaluate('document.querySelector(\'[data-result="full-405"]\').textContent'));
    check('#405 成功訊息不顯示「錯誤解析」', !/錯誤解析/.test(okText) && /Export order created/.test(okText));
    const staleHtml = String(await evaluate([
      'import("./js/hkia-cdp/ui.js").then((m) => m.resultHtml({',
      'ok: true, status: 200, api: "#416", name: "Delete MAWB",',
      'response: { status: "DELETED", message: "MAWB deleted（mock）" },',
      'errors: [{ code: "", message: "MAWB deleted（mock）", fix: "" }]',
      '}))'
    ].join('')));
    check('成功回應即使帶舊格式 errors 也不顯示「錯誤解析」',
      !/錯誤解析/.test(staleHtml) && /MAWB deleted/.test(staleHtml));

    await evaluate('document.querySelector(\'[data-tab="lite"]\').click()');
    check('切到 Lite Flow', await waitFor('!!document.querySelector(\'[data-scope="lite"]\')'));
    await evaluate('document.querySelector(\'[data-action="lite-send-415"]\').click()');
    check('#415 送出後顯示結果', await waitFor('!!document.querySelector(\'[data-result="lite-415"] .hkia-result\')', 15000));
    check('#415 回 HTTP 202（非同步受理）', /HTTP 202/.test(String(await evaluate('document.querySelector(\'[data-result="lite-415"]\').textContent'))));

    await evaluate('document.querySelector(\'[data-tab="callback"]\').click()');
    check('切到 Callback 監控台', await waitFor('!!document.querySelector(\'[data-scope="callback"]\')'));
    check('SSE 即時收到 Callback 並顯示卡片', await waitFor('document.querySelectorAll(".hkia-cb").length > 0', 12000));

    await evaluate('document.querySelector(\'[data-tab="query"]\').click()');
    check('切到查詢頁且有單號下拉', await waitFor('!!document.querySelector(\'[data-scope="query"] [data-ref-picker]\')'));
    await evaluate(`(() => { const s = document.querySelector('[data-field="queryApi"]'); s.value = '#406'; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    await waitFor('document.querySelector(\'[data-field="queryApi"]\').value === "#406"');
    check('查詢頁（#406）下拉已帶入剛才的 Export Order',
      await waitFor(`String(document.querySelector('[data-ref-picker]').innerHTML).indexOf('${ref}') !== -1`, 5000));
    check('查詢頁有「更新 / 刪除（#403 #404 #407 #408）」面板', await waitFor('!!document.querySelector(\'[data-action="maint-send"]\')'));
    await evaluate(`(() => {
      const sel = document.querySelector('[data-field="queryApi"]');
      sel.value = '#402';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    await waitFor('!!document.querySelector(\'[data-ref-picker]\') && String(document.querySelector(\'[data-ref-picker]\').innerHTML).indexOf("RA-") !== -1', 5000);
    const raRef = String(await evaluate(`(() => { const sel = document.querySelector('[data-ref-picker]'); const opt = sel ? Array.from(sel.options).find((o) => o.value) : null; return opt ? opt.value : ''; })()`));
    check('取得可更新 / 刪除的 Pre-Declaration 單號', /^RA/.test(raRef), raRef);
    await evaluate(`(() => {
      const input = document.querySelector('[data-maint-ref]');
      input.value = '${raRef}';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('[data-action="maint-send"]').click();
      return true;
    })()`);
    check('#403 更新（查詢頁面板）→ HTTP 202', await waitFor('/HTTP 202/.test(String((document.querySelector(\'[data-result="maint"]\') || {}).textContent))', 12000));

    await evaluate('document.querySelector(\'[data-tab="settings"]\').click()');
    check('設定頁顯示環境 / 憑證 / OpenSSL 指令',
      await waitFor('!!document.querySelector(\'[data-setting="env"]\') && !!document.querySelector(".hkia-openssl")'));
    await evaluate('document.querySelector(\'[data-tab="learn"]\').click()');
    check('教學頁有流程圖與錯誤碼清單',
      await waitFor('!!document.querySelector(".hkia-flow-diagram") && document.querySelectorAll(".hkia-error-row").length > 0'));

    const exceptions = events.filter((e) => e.method === 'Runtime.exceptionThrown');
    const consoleErrors = events.filter((e) => e.method === 'Log.entryAdded' && e.params.entry.level === 'error'
      && !/Failed to load resource/i.test(e.params.entry.text || ''));
    check('沒有 JavaScript 例外', exceptions.length === 0, exceptions.map((e) => e.params.exceptionDetails.text).join(' | '));
    check('沒有 Console 錯誤（忽略資源載入失敗）', consoleErrors.length === 0, consoleErrors.map((e) => e.params.entry.text).join(' | '));
  } catch (err) {
    check(`UI 煙霧測試例外：${err.message}`, false);
  } finally {
    try { ws.close(); } catch (e) { /* ignore */ }
    try { chrome.kill(); } catch (e) { /* ignore */ }
    try { server.kill(); } catch (e) { /* ignore */ }
    await sleep(600);
    cleanup();
    console.log(`\n===== ${failures === 0 ? '全部通過' : `${failures} 項失敗`} =====`);
    process.exit(failures === 0 ? 0 : 1);
  }
})();
