// ===== HKIA CDP：互動式教學（Learning Hub）=====
import { esc, lintHtml, copyText } from './ui.js';
import { getPreset } from './presets.js';

const FLOW_STEPS = {
  full: [
    { api: '#405', title: 'Create Export Order', desc: '把貨物、ULD、安檢方式送給 CTO；同步回傳 export_order_reference_num。' },
    { api: '#409', title: 'Upload Screening Image', desc: '上傳 X-ray 影像；必須附 SHA-256 + RSA 簽章（本平台自動產生）。' },
    { api: '#401', title: 'Create Pre-Declaration', desc: '建立預報關單（非同步 202）；CTO 處理完會用 Webhook 回調。' },
    { api: '#402', title: 'Retrieve / 追蹤', desc: '用 ra_reference_id 或 cto_predeclaration_num 查詢最新狀態。' }
  ],
  lite: [
    { api: '#415', title: 'Create Lite Pre-Declaration', desc: '精簡版預報關單（非同步 202）；適合已有 CTO 資料的補登。' },
    { api: '#416', title: 'Delete MAWB', desc: '同步刪除 MAWB；成功後 CTO 不再保留該票。' },
    { api: '#402', title: 'Retrieve / 追蹤', desc: '以單號查詢 Lite 預報關單狀態。' }
  ]
};

function flowDiagram(kind) {
  const steps = FLOW_STEPS[kind];
  return `<div class="hkia-flow-diagram">${steps.map((s, idx) => `
    <button type="button" class="hkia-flow-node" data-learn-step="${esc(kind)}-${idx}">
      <span class="hkia-flow-api">${esc(s.api)}</span>
      <strong>${esc(s.title)}</strong>
    </button>${idx < steps.length - 1 ? '<span class="hkia-flow-arrow">→</span>' : ''}`).join('')}</div>
    <div class="hkia-learn-detail" data-learn-detail="${esc(kind)}">點一下流程節點，看該步驟的 API 與業務意義。</div>`;
}

function archHtml() {
  return `<section class="hkia-learn-card">
    <h4>① 架構圖解：為什麼需要 BFF？</h4>
    <div class="hkia-arch">
      <div class="hkia-arch-box"><strong>瀏覽器</strong><small>本測試平台 UI</small></div>
      <span class="hkia-flow-arrow">→</span>
      <div class="hkia-arch-box is-primary"><strong>BFF Proxy</strong><small>Node.js（本專案後端）<br>mTLS／Token／簽章／Webhook</small></div>
      <span class="hkia-flow-arrow">→</span>
      <div class="hkia-arch-box"><strong>HKIA API Gateway</strong><small>TLS 1.2＋x-api-key<br>OAuth2 Token</small></div>
      <span class="hkia-flow-arrow">→</span>
      <div class="hkia-arch-box"><strong>CTO</strong><small>AAT / CPSL / HACTL<br>（SIT 由 Mock Server 模擬）</small></div>
    </div>
    <p class="hkia-muted">瀏覽器<strong>不能</strong>直接做 mTLS（無法安全保管 .key），也<strong>收不到</strong> server-to-server Webhook，所以一定要有一層後端代理。</p>
  </section>`;
}

function authHtml() {
  return `<section class="hkia-learn-card">
    <h4>② 安全認證順序（mTLS → x-api-key → OAuth2 → Bearer）</h4>
    <ol class="hkia-auth-order">
      <li><span>1</span><div><strong>TLS 1.2 雙向憑證</strong><p>連線時先出示客戶端 .pem/.key；Gateway 驗證來源 IP 與憑證。</p></div></li>
      <li><span>2</span><div><strong>x-api-key</strong><p>每個 API 都要帶；由 AAHK 核發，與角色／公司綁定。</p></div></li>
      <li><span>3</span><div><strong>#001 OAuth2 client_credentials</strong><p>用 client_id / client_secret 換 access_token（約 300 秒）。</p></div></li>
      <li><span>4</span><div><strong>Authorization: bearer</strong><p>其餘 12 支 API 都帶 Token；本平台會在過期前自動續期。</p></div></li>
    </ol>
    <div class="hkia-note">本機 Mock 模式會跳過 1～3（產生假 JWT），讓你不用憑證也能先練流程。</div>
  </section>`;
}

export function renderLearn() {
  return `<div class="hkia-learn" data-scope="learn">
    ${archHtml()}
    ${authHtml()}
    ${flowHtml()}
    ${asyncHtml()}
    ${sandboxHtml()}
    ${errorsHtml()}
  </div>`;
}

function flowHtml() {
  return `<section class="hkia-learn-card">
    <h4>③ Full Flow vs Lite Flow</h4>
    ${flowDiagram('full')}
    ${flowDiagram('lite')}
    <table class="hkia-table">
      <thead><tr><th>比較</th><th>Full Flow</th><th>Lite Flow</th></tr></thead>
      <tbody>
        <tr><td>適用</td><td>RA 需完整建檔＋安檢影像</td><td>資料已在 CTO，只需補送摘要</td></tr>
        <tr><td>API</td><td>#405 → #409 → #401</td><td>#415 / #416</td></tr>
        <tr><td>非同步</td><td>#401 回 202，等 Callback</td><td>#415 回 202，等 Callback</td></tr>
        <tr><td>安檢影像</td><td>必備（#409）</td><td>不需要</td></tr>
      </tbody>
    </table>
  </section>`;
}

function asyncHtml() {
  return `<section class="hkia-learn-card">
    <h4>④ 非同步：202 / Polling / Webhook 有什麼不同？</h4>
    <div class="hkia-three">
      <div><strong>202 Accepted</strong><p>代表「已受理、還沒處理完」。不是失敗，也不代表 CTO 已接受。</p></div>
      <div><strong>Polling（#402）</strong><p>你主動每隔幾秒查一次；實作簡單，但有延遲與多餘請求。</p></div>
      <div><strong>Webhook Callback</strong><p>CTO 處理完主動 POST 回來；即時、省請求，但後端必須是公開可達的 URL。</p></div>
    </div>
    <p class="hkia-muted">本平台把 Callback 記在 <code>POST /api/hkia-cdp/webhook</code>，並用 SSE 即時推到「Callback 監控」頁；Mock 模式會在設定的延遲後自動模擬一次。</p>
  </section>`;
}

function sandboxHtml() {
  const sample = getPreset('bulk_hactl').build();
  return `<section class="hkia-learn-card">
    <h4>⑤ JSON 動手砌（即時 CTO 規則提示）</h4>
    <div class="hkia-formgrid">
      <label class="hkia-field"><span>CTO</span><select data-learn-cto>
        <option value="AAT">AAT</option><option value="CPSL">CPSL</option><option value="HACTL" selected>HACTL</option>
      </select></label>
      <label class="hkia-field"><span>Cargo Type</span><select data-learn-cargo>
        <option value="BUK" selected>BUK</option><option value="PPK">PPK</option><option value="MIX">MIX</option>
      </select></label>
    </div>
    <textarea class="hkia-json-editor" rows="14" data-learn-json>${esc(JSON.stringify(sample, null, 2))}</textarea>
    <div class="hkia-lint" data-learn-lint>${lintHtml(null)}</div>
    <div class="hkia-actions">
      <button type="button" class="pill" data-action="learn-lint">重新檢查</button>
      <button type="button" class="pill" data-action="learn-copy">複製 JSON</button>
      <button type="button" class="pill" data-action="learn-copy-curl">複製 cURL 範例</button>
    </div>
  </section>`;
}

function errorsHtml() {
  return `<section class="hkia-learn-card">
    <h4>⑥ 錯誤碼速查</h4>
    <input type="search" class="hkia-search" data-learn-search placeholder="輸入錯誤碼或關鍵字（例：108717、mTLS、Rate Limit）">
    <div class="hkia-error-list" data-learn-errors></div>
  </section>`;
}

function renderErrorRows(query) {
  const dict = window.HkiaErrorCodes ? window.HkiaErrorCodes.DICTIONARY : {};
  const q = String(query || '').trim().toLowerCase();
  const rows = Object.keys(dict)
    .filter((code) => !q || code.toLowerCase().indexOf(q) !== -1 || JSON.stringify(dict[code]).toLowerCase().indexOf(q) !== -1)
    .slice(0, 60)
    .map((code) => `<div class="hkia-error-row"><code>${esc(code)}</code><div><strong>${esc(dict[code].message)}</strong><p>${esc(dict[code].fix || '')}</p></div></div>`)
    .join('');
  return rows || '<p class="hkia-muted">沒有符合的錯誤碼。</p>';
}

export function mountLearn(root) {
  const scope = root.querySelector('[data-scope="learn"]');
  if (!scope) return;
  const jsonArea = scope.querySelector('[data-learn-json]');
  const ctoSelect = scope.querySelector('[data-learn-cto]');
  const cargoSelect = scope.querySelector('[data-learn-cargo]');
  const lintBox = scope.querySelector('[data-learn-lint]');
  const errorBox = scope.querySelector('[data-learn-errors]');
  const search = scope.querySelector('[data-learn-search]');
  if (!jsonArea) return;

  const validate = () => {
    try {
      const payload = JSON.parse(jsonArea.value);
      const lint = window.HkiaCtoValidator.validate(payload, {
        cto: ctoSelect.value, cargoType: cargoSelect.value, api: '#405'
      });
      lintBox.innerHTML = lintHtml(lint);
    } catch (err) {
      lintBox.innerHTML = `<div class="hkia-lint is-error"><strong>JSON 解析失敗</strong><ul><li>${esc(err.message)}</li></ul></div>`;
    }
  };

  jsonArea.addEventListener('input', validate);
  ctoSelect.addEventListener('change', validate);
  cargoSelect.addEventListener('change', validate);
  validate();
  errorBox.innerHTML = renderErrorRows('');

  search.addEventListener('input', () => { errorBox.innerHTML = renderErrorRows(search.value); });

  scope.addEventListener('click', (event) => {
    const node = event.target.closest('[data-learn-step]');
    if (node) {
      const [kind, idx] = node.getAttribute('data-learn-step').split('-');
      const step = FLOW_STEPS[kind] && FLOW_STEPS[kind][Number(idx)];
      const detail = scope.querySelector(`[data-learn-detail="${kind}"]`);
      if (step && detail) detail.innerHTML = `<strong>${esc(step.api)} ${esc(step.title)}</strong><p>${esc(step.desc)}</p>`;
      return;
    }
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const action = button.getAttribute('data-action');
    if (action === 'learn-lint') validate();
    if (action === 'learn-copy') copyText(jsonArea.value, 'JSON 已複製');
    if (action === 'learn-copy-curl') {
      copyText(`curl -X POST 'https://api-external.sit.hkiacargo.com/export/external/v1/ra/export-orders' \\
  --cert './certs/client.pem' --key './certs/client.key' --tlsv1.2 \\
  -H 'x-api-key: <x-api-key>' \\
  -H 'Authorization: Bearer <access_token>' \\
  -H 'Content-Type: application/json' \\
  -d @payload.json`, 'cURL 已複製');
    }
  });
}
