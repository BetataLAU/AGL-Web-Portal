// ===== HKIA CDP：查詢／追蹤（#402 / #406 / #410 / #411 / #412）=====
import { esc, field, resultHtml, badge } from './ui.js';

export const QUERY_APIS = [
  { api: '#402', label: '#402 Retrieve Pre-Declaration', params: ['ra_reference_id', 'cto_predeclaration_num'] },
  { api: '#406', label: '#406 Retrieve Export Order', params: ['export_order_reference_num'] },
  { api: '#410', label: '#410 Retrieve Truck Arrival', params: ['ra_reference_id', 'cto_predeclaration_num'] },
  { api: '#411', label: '#411 Retrieve RCL（含 PDF）', params: ['ra_reference_id', 'cto_predeclaration_num'] },
  { api: '#412', label: '#412 Retrieve Flight Departure', params: ['ra_reference_id', 'cto_predeclaration_num', 'waybill_num'] }
];

const PARAM_LABEL = {
  ra_reference_id: 'ra_reference_id',
  cto_predeclaration_num: 'cto_predeclaration_num',
  export_order_reference_num: 'export_order_reference_num',
  waybill_num: 'waybill_num（MAWB）'
};

export function createQueryState() {
  return {
    api: '#402',
    values: { ra_reference_id: '', cto_predeclaration_num: '', export_order_reference_num: '', waybill_num: '' },
    result: null,
    maintApi: '#403',
    maintRef: '',
    maintBody: '{}',
    maintResult: null
  };
}

function refOptions(state, refs) {
  const list = state.api === '#406'
    ? (refs.exportOrders || []).map((o) => ({ value: o.reference, label: `${o.reference}（${o.ctoCode || '-'} / ${o.mawb || '-'}）` }))
    : (refs.preDeclarations || []).map((p) => ({ value: p.reference, label: `${p.reference}（${p.status || '-'}）` }));
  return `<option value="">— 從已建立的單號選擇 —</option>` + list.map((o) => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('');
}

export function renderQuery(state, refs) {
  const def = QUERY_APIS.find((q) => q.api === state.api) || QUERY_APIS[0];
  return `<div class="hkia-query" data-scope="query">
    <div class="hkia-flow-head">
      <div>
        <h3>查詢 / 單號關聯追蹤</h3>
        <p class="hkia-muted">#405 / #401 / #415 建立的單號會自動出現在下方下拉選單（Mock 與 Callback 都會更新）。</p>
      </div>
      ${badge(`已建立 ${(refs.exportOrders || []).length} 張 Export Order / ${(refs.preDeclarations || []).length} 張 Pre-Declaration`, 'info')}
    </div>
    <div class="hkia-query-bar">
      ${field('API', 'queryApi', state.api, { type: 'select', options: QUERY_APIS.map((q) => q.api) })}
      <label class="hkia-field is-wide"><span>快速帶入單號</span>
        <select data-ref-picker>${refOptions(state, refs)}</select>
      </label>
    </div>
    <div class="hkia-formgrid">
      ${def.params.map((key) => field(PARAM_LABEL[key] || key, `q.${key}`, state.values[key] || '', { placeholder: key === 'waybill_num' ? '160-1234 5678' : '' })).join('')}
    </div>
    <p class="hkia-muted">提示：${esc(def.api)} 只需要其中一組參數即可；本平台會自動選擇符合的 Endpoint 形式。</p>
    <div class="hkia-actions">
      <button type="button" class="pill btn-primary" data-action="query-send">送出查詢</button>
      <button type="button" class="pill" data-action="query-clear">清除</button>
    </div>
    <div data-result="query">${resultHtml(state.result)}</div>
    <div data-pdf-viewer></div>

    <details class="hkia-more">
      <summary>更新 / 刪除（#403 · #404 · #407 · #408）</summary>
      <p class="hkia-muted">#403 / #404 用 ra_reference_id；#407 / #408 用 export_order_reference_num。DELETE 可留空 body。</p>
      <div class="hkia-formgrid">
        <label class="hkia-field"><span>API</span><select data-maint-api>
          ${['#403', '#404', '#407', '#408'].map((api) => `<option value="${api}" ${state.maintApi === api ? 'selected' : ''}>${api}</option>`).join('')}
        </select></label>
        <label class="hkia-field is-wide"><span>參考單號</span><input type="text" data-maint-ref value="${esc(state.maintRef)}" placeholder="ra_reference_id 或 export_order_reference_num"></label>
        <label class="hkia-field is-wide"><span>Request body（JSON）</span><textarea rows="4" data-maint-body>${esc(state.maintBody)}</textarea></label>
      </div>
      <div class="hkia-actions"><button type="button" class="pill" data-action="maint-send">送出 ${esc(state.maintApi)}</button></div>
      <div data-result="maint">${resultHtml(state.maintResult)}</div>
    </details>
  </div>`;
}

function pdfViewer(container, base64, name) {
  if (!container) return;
  if (!base64) { container.innerHTML = ''; return; }
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const previous = container.getAttribute('data-blob-url');
    if (previous) { try { URL.revokeObjectURL(previous); } catch (err) { /* ignore */ } }
    container.setAttribute('data-blob-url', url);
    container.innerHTML = `<div class="hkia-pdf-head">
        <strong>#411 RCL PDF 預覽</strong>
        <a class="hkia-mini" href="${url}" download="${esc(name || 'rcl.pdf')}">⤓ 下載 PDF</a>
      </div>
      <iframe class="hkia-pdf" src="${url}" title="RCL PDF"></iframe>`;
  } catch (err) {
    container.innerHTML = `<p class="hkia-muted">PDF 解碼失敗：${esc(err.message)}</p>`;
  }
}

export function mountQuery(root, ctx) {
  const scope = root.querySelector('[data-scope="query"]');
  if (!scope) return;
  const state = ctx.state.query;

  scope.addEventListener('change', (event) => {
    const target = event.target;
    if (!target || !target.matches) return;
    if (target.matches('[data-field="queryApi"]')) {
      state.api = target.value;
      ctx.rerender();
      return;
    }
    if (target.matches('[data-ref-picker]')) {
      const value = target.value;
      if (!value) return;
      const key = state.api === '#406' ? 'export_order_reference_num' : 'ra_reference_id';
      state.values[key] = value;
      const input = scope.querySelector(`[data-field="q.${key}"]`);
      if (input) input.value = value;
      return;
    }
    if (target.matches('[data-maint-api]')) {
      state.maintApi = target.value;
      const button = scope.querySelector('[data-action="maint-send"]');
      if (button) button.textContent = `送出 ${state.maintApi}`;
      return;
    }
    if (target.hasAttribute && target.hasAttribute('data-field')) {
      const name = target.getAttribute('data-field');
      if (name.indexOf('q.') === 0) state.values[name.slice(2)] = target.value;
    }
  });

  scope.addEventListener('input', (event) => {
    const target = event.target;
    if (!target || !target.hasAttribute) return;
    if (target.hasAttribute('data-maint-ref')) { state.maintRef = target.value; return; }
    if (target.hasAttribute('data-maint-body')) { state.maintBody = target.value; return; }
    const name = target.getAttribute('data-field') || '';
    if (name.indexOf('q.') === 0) state.values[name.slice(2)] = target.value;
  });

  scope.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const action = button.getAttribute('data-action');
    if (action === 'query-clear') {
      state.values = { ra_reference_id: '', cto_predeclaration_num: '', export_order_reference_num: '', waybill_num: '' };
      state.result = null;
      ctx.rerender();
      return;
    }
    if (action === 'maint-send') {
      const api = state.maintApi;
      const refInput = scope.querySelector('[data-maint-ref]');
      const ref = String((refInput && refInput.value) || '').trim();
      if (!ref) { ctx.toast('請填參考單號', false); return; }
      state.maintRef = ref;
      let body;
      const raw = String((scope.querySelector('[data-maint-body]') || {}).value || '').trim();
      state.maintBody = raw || '{}';
      if (raw) {
        try { body = JSON.parse(raw); } catch (err) { ctx.toast(`body JSON 解析失敗：${err.message}`, false); return; }
      }
      const params = (api === '#407' || api === '#408')
        ? { export_order_reference_num: ref }
        : { ra_reference_id: ref };
      const old = button.textContent;
      button.disabled = true;
      button.textContent = '送出中…';
      try {
        const result = await ctx.proxy({ api, params, body });
        state.maintResult = result;
        const slot = scope.querySelector('[data-result="maint"]');
        if (slot) slot.innerHTML = resultHtml(result);
        ctx.toast(result.ok ? `${api} 成功（HTTP ${result.status}）` : `${api} 失敗（HTTP ${result.status || '-'}）`, result.ok);
        ctx.refreshRefs();
      } finally {
        button.disabled = false;
        button.textContent = old;
      }
      return;
    }
    if (action !== 'query-send') return;
    const def = QUERY_APIS.find((q) => q.api === state.api) || QUERY_APIS[0];
    const params = {};
    def.params.forEach((key) => {
      const value = String(state.values[key] || '').trim();
      if (value) params[key] = value;
    });
    if (!Object.keys(params).length) { ctx.toast('請至少填一組查詢參數', false); return; }
    const old = button.textContent;
    button.disabled = true;
    button.textContent = '查詢中…';
    try {
      const result = await ctx.proxy({ api: def.api, params });
      state.result = result;
      const slot = scope.querySelector('[data-result="query"]');
      if (slot) slot.innerHTML = resultHtml(result);
      const pdfBox = scope.querySelector('[data-pdf-viewer]');
      const encoded = result.ok && result.response ? result.response.encodedPdf : '';
      pdfViewer(pdfBox, encoded, `${params.ra_reference_id || params.cto_predeclaration_num || 'rcl'}.pdf`);
      ctx.toast(result.ok ? `查詢成功（HTTP ${result.status}）` : `查詢失敗（HTTP ${result.status || '-'}）`, result.ok);
    } finally {
      button.disabled = false;
      button.textContent = old;
    }
  });
}
