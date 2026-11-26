// ===== HKIA CDP Testing Site：共用 UI 小工具 =====
export const esc = (value) => String(value === undefined || value === null ? '' : value)
  .replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

export const jsonHtml = (value) => esc(JSON.stringify(value === undefined ? null : value, null, 2));

export function toast(message, ok = true) {
  let host = document.getElementById('hkia-toast-host');
  if (!host) {
    host = document.createElement('div');
    host.id = 'hkia-toast-host';
    host.className = 'hkia-toast-host';
    document.body.appendChild(host);
  }
  const item = document.createElement('div');
  item.className = `hkia-toast ${ok ? 'is-ok' : 'is-error'}`;
  item.textContent = message;
  host.appendChild(item);
  setTimeout(() => item.classList.add('is-out'), 2600);
  setTimeout(() => item.remove(), 3200);
}

export function copyText(text, label = '已複製到剪貼簿') {
  const fallback = () => {
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.left = '-9999px';
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
      toast(label);
    } catch (err) { toast('複製失敗', false); }
  };
  if (window.copyTextToClipboard) {
    window.copyTextToClipboard(text).then((ok) => toast(ok ? label : '複製失敗', ok)).catch(fallback);
  } else fallback();
}

export function badge(text, kind = 'info') {
  return `<span class="hkia-badge hkia-badge--${esc(kind)}">${esc(text)}</span>`;
}

export function statusBadge(status, ok) {
  const kind = ok === true ? 'ok' : ok === false ? 'error' : (Number(status) >= 200 && Number(status) < 300 ? 'ok' : 'error');
  return `<span class="hkia-status hkia-status--${kind}">${esc(status === 0 || status === undefined || status === null ? '失敗' : `HTTP ${status}`)}</span>`;
}

export function lintHtml(lint) {
  if (!lint) return '<p class="hkia-muted">尚未檢查。</p>';
  const errors = Array.isArray(lint.errors) ? lint.errors : [];
  const warnings = Array.isArray(lint.warnings) ? lint.warnings : [];
  if (!errors.length && !warnings.length) {
    const sum = lint.summary || {};
    return `<div class="hkia-lint is-ok"><strong>✓ CTO 預檢通過</strong><span>（${esc(sum.cto || '-')} / ${esc(sum.cargoType || '-')}，檢查 ${esc(sum.rulesChecked || 0)} 條規則）</span></div>`;
  }
  const rows = errors.concat(warnings).map((item) => {
    const dict = window.HkiaErrorCodes ? window.HkiaErrorCodes.lookup(item.code) : null;
    const fix = item.hint || (dict && dict.fix) || '';
    return `<li class="hkia-lint-item ${item.level === 'warn' ? 'is-warn' : 'is-error'}">
      <span class="hkia-lint-code">${esc(item.code || '')}</span>
      <span class="hkia-lint-msg">${esc(item.message || '')}${item.field ? ` <code>${esc(item.field)}</code>` : ''}${fix ? `<em>${esc(fix)}</em>` : ''}</span>
    </li>`;
  }).join('');
  return `<div class="hkia-lint ${errors.length ? 'is-error' : 'is-warn'}">
    <strong>${errors.length ? `✗ ${errors.length} 項錯誤` : '⚠ 提醒'}${warnings.length ? ` ／ ⚠ ${warnings.length} 項提醒` : ''}</strong>
    <ul>${rows}</ul>
  </div>`;
}

function errorList(errors) {
  if (!Array.isArray(errors) || !errors.length) return '';
  const rows = errors.map((item) => {
    const dict = window.HkiaErrorCodes ? (window.HkiaErrorCodes.lookup(item.code) || window.HkiaErrorCodes.explainHttp(item.code)) : null;
    const msg = item.message || (dict && dict.message) || '';
    const fix = item.fix || (dict && dict.fix) || '';
    return `<li><span class="hkia-lint-code">${esc(item.code || '')}</span> ${esc(msg)}${fix ? `<em>${esc(fix)}</em>` : ''}</li>`;
  }).join('');
  return `<div class="hkia-lint is-error"><strong>錯誤解析</strong><ul>${rows}</ul></div>`;
}

// API 回應的統一呈現（不含 encodedPdf／imageBase64，避免畫面爆掉）
export function resultHtml(result, options = {}) {
  if (!result) return '<p class="hkia-muted">尚未送出。</p>';
  let resp = result.response;
  if (resp && typeof resp === 'object') {
    resp = Object.assign({}, resp);
    if (resp.encodedPdf && !options.keepPdf) resp.encodedPdf = `[base64 PDF omitted: ${String(resp.encodedPdf).length} chars]`;
  }
  const okMessage = result.ok && resp && typeof resp === 'object' && typeof resp.message === 'string' ? resp.message : '';
  let errs = Array.isArray(result.errors) ? result.errors : (result.error ? [result.error] : []);
  // 舊版後端會把成功回應最外層的 message 當成錯誤回傳；成功時忽略「無錯誤碼且與回應訊息相同」的項目
  if (result.ok && okMessage) errs = errs.filter((item) => item && (item.code || String(item.message || '') !== okMessage));
  return `<div class="hkia-result ${result.ok ? 'is-ok' : 'is-error'}">
    <div class="hkia-result-head">
      ${statusBadge(result.status, result.ok)}
      <span class="hkia-result-title">${esc(result.api || '')} ${esc(result.name || '')}</span>
      <span class="hkia-muted">${esc(result.durationMs === undefined ? '' : `${result.durationMs} ms`)}</span>
      ${result.env ? badge(String(result.env).toUpperCase(), result.env === 'prod' ? 'warn' : 'info') : ''}
    </div>
    <dl class="hkia-kv">
      ${result.url ? `<dt>URL</dt><dd><code>${esc(result.url)}</code></dd>` : ''}
      ${result.requestId ? `<dt>x-request-id</dt><dd><code>${esc(result.requestId)}</code></dd>` : ''}
      ${result.signature ? `<dt>簽章</dt><dd>${esc(result.signature.algorithm)} · <code>${esc(result.signature.hash)}</code></dd>` : ''}
    </dl>
    ${result.callback && result.callback.expected ? `<div class="hkia-note">⏳ 非同步請求已受理（HTTP ${esc(result.status)}）；Callback 會送到 <code>${esc(result.callback.url || '/api/hkia-cdp/webhook')}</code>${result.callback.delayMs ? `，約 ${esc(result.callback.delayMs)} ms 後` : ''}。source_id = <code>${esc(result.callback.sourceId || result.requestId || '')}</code></div>` : ''}
    ${errorList(errs)}
    ${okMessage ? `<div class="hkia-note is-ok">✓ ${esc(okMessage)}</div>` : ''}
    <details class="hkia-json" ${result.ok ? '' : 'open'}>
      <summary>Response JSON</summary>
      <pre>${jsonHtml(resp)}</pre>
    </details>
    <details class="hkia-json">
      <summary>Request（大檔已遮罩）</summary>
      <pre>${jsonHtml(result.request)}</pre>
    </details>
  </div>`;
}

// 程式碼片段（cURL / JavaScript / Python）
export function snippetsHtml(snippets) {
  if (!snippets) return '';
  return `<details class="hkia-snippets">
    <summary>匯出程式碼（cURL / JavaScript / Python）</summary>
    <div class="hkia-code-tabs" data-code-tabs>
      <button type="button" class="hkia-code-tab active" data-code-tab="curl">cURL</button>
      <button type="button" class="hkia-code-tab" data-code-tab="javascript">JavaScript</button>
      <button type="button" class="hkia-code-tab" data-code-tab="python">Python</button>
      <button type="button" class="hkia-mini" data-code-copy>複製</button>
    </div>
    <pre class="hkia-code" data-code-body>${esc(snippets.curl)}</pre>
    <textarea class="hkia-hidden" data-code-source>${esc(snippets.curl)}</textarea>
  </details>`;
}

export function setSnippetData(root, snippets) {
  const box = root.querySelector('.hkia-snippets');
  if (!box || !snippets) return;
  box.dataset.curl = snippets.curl;
  box.dataset.javascript = snippets.javascript;
  box.dataset.python = snippets.python;
  const body = box.querySelector('[data-code-body]');
  const source = box.querySelector('[data-code-source]');
  if (body) body.textContent = snippets.curl;
  if (source) source.value = snippets.curl;
}

export function mountSnippets(root) {
  const box = root.querySelector('.hkia-snippets');
  if (!box || box.dataset.bound === '1') return;
  box.dataset.bound = '1';
  const tabs = box.querySelectorAll('[data-code-tab]');
  const body = box.querySelector('[data-code-body]');
  const source = box.querySelector('[data-code-source]');
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      const key = tab.getAttribute('data-code-tab');
      const text = box.dataset[key] || '';
      body.textContent = text;
      source.value = text;
    });
  });
  const copyBtn = box.querySelector('[data-code-copy]');
  if (copyBtn) copyBtn.addEventListener('click', () => copyText(source.value, '程式碼已複製'));
}

// 取得／設定物件深層路徑（表單 ↔ payload）
export function getPath(obj, path) {
  return String(path).split('.').reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : undefined), obj);
}

export function setPath(obj, path, value) {
  const keys = String(path).split('.');
  let cursor = obj;
  keys.slice(0, -1).forEach((key) => {
    if (!cursor[key] || typeof cursor[key] !== 'object') cursor[key] = {};
    cursor = cursor[key];
  });
  cursor[keys[keys.length - 1]] = value;
  return obj;
}

// select 的選項可傳字串，或 { value, label }（label 用來多顯示 API 名稱／功能說明）
export function optionParts(opt) {
  if (opt && typeof opt === 'object') {
    return { value: opt.value, label: opt.label === undefined || opt.label === null ? opt.value : opt.label };
  }
  return { value: opt, label: opt };
}

export const field = (label, name, value, options = {}) => `<label class="hkia-field ${options.wide ? 'is-wide' : ''}">
  <span>${esc(label)}${options.hint ? `<em>${esc(options.hint)}</em>` : ''}</span>
  ${options.type === 'select'
    ? `<select data-field="${esc(name)}">${(options.options || []).map((raw) => {
      const opt = optionParts(raw);
      return `<option value="${esc(opt.value)}" ${String(value === undefined ? '' : value) === String(opt.value) ? 'selected' : ''}>${esc(opt.label)}</option>`;
    }).join('')}</select>`
    : options.type === 'textarea'
      ? `<textarea rows="${options.rows || 3}" data-field="${esc(name)}" placeholder="${esc(options.placeholder || '')}">${esc(value)}</textarea>`
      : options.type === 'checkbox'
        ? `<input type="checkbox" data-field="${esc(name)}" ${value ? 'checked' : ''}>`
        : `<input type="${options.type || 'text'}" data-field="${esc(name)}" value="${esc(value)}" placeholder="${esc(options.placeholder || '')}">`}
</label>`;
