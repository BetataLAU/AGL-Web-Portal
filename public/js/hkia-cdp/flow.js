// ===== HKIA CDP：Full Flow / Lite Flow 引導式測試 =====
// 表單模式與 JSON 模式共用同一個 payload；每次輸入即時跑 CTO 預檢（window.HkiaCtoValidator）。
import { esc, field, lintHtml, resultHtml, snippetsHtml, mountSnippets, setSnippetData, badge } from './ui.js';
import { PRESETS, getPreset, formatUldLines, parseUldLines, uuid, buildPreDeclarationPayload, buildScreeningImagePayload } from './presets.js';
import { buildAll } from './snippets.js';
import { fileToBase64 } from './api.js';

const Val = () => window.HkiaCtoValidator;
const numOrBlank = (value) => {
  const s = String(value === undefined || value === null ? '' : value).trim();
  if (!s) return '';
  const n = Number(s);
  return Number.isFinite(n) ? n : s;
};
const listOf = (value) => String(value || '').split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);

export function createFullState() {
  const preset = getPreset('bulk_aat');
  const payload = preset.build();
  return {
    presetId: preset.id, mode: 'form', payload, jsonText: JSON.stringify(payload, null, 2),
    step1: null, step2: null, step3: null, query: null,
    exportRef: '', image: null, snippetApi: '#405'
  };
}

export function createLiteState() {
  const preset = getPreset('lite_aat_cto');
  const payload = preset.build();
  return {
    presetId: preset.id, mode: 'form', payload, jsonText: JSON.stringify(payload, null, 2),
    result415: null, result416: null, raRef: '', deleteMawb: '', snippetApi: '#415'
  };
}

function presetOptions(active) {
  return PRESETS.map((p) => `<option value="${esc(p.id)}" ${p.id === active ? 'selected' : ''}>${esc(p.label)}（${esc(p.api)}·${esc(p.cto)}）</option>`).join('');
}

function formFields(p, options = {}) {
  const V = Val();
  const ctoOptions = V ? V.CTOS : ['AAT', 'CPSL', 'HACTL'];
  const cargoOptions = V ? V.CARGO_TYPES : ['BUK', 'PPK', 'MIX'];
  const sealOptions = [''].concat(V ? V.SEAL_TYPES : []);
  const piOptions = ['', 'PI966(II)', 'PI967(II)', 'PI969(II)', 'PI970(II)'];
  const emails = (p.receipt && Array.isArray(p.receipt.emails) ? p.receipt.emails : []).join(', ');
  const uldText = formatUldLines(p.ulds || []);
  return `
    ${field('CTO', 'ctoCode', p.ctoCode, { type: 'select', options: ctoOptions })}
    ${field('Cargo Type', 'cargoType', p.cargoType, { type: 'select', options: cargoOptions })}
    ${field('Airline', 'airlineCode', p.airlineCode, { placeholder: 'CX / LH / …' })}
    ${field('Screening Method', 'screeningMethod', p.screeningMethod, { type: 'select', options: ['RACSF', 'CTO', 'INTEGRATOR'] })}
    ${field('Security Status', 'securityStatus.statusCode', p.securityStatus && p.securityStatus.statusCode, { type: 'select', options: V ? V.SECURITY_STATUS_CODES : ['SPX', 'SCO', 'UNK'] })}
    ${field('MAWB#', 'mawbNumber', p.mawbNumber, { placeholder: '160-1234 5678' })}
    ${field('HAWB#', 'hawbNumber', p.hawbNumber)}
    ${field('Destination', 'destination', p.destination)}
    ${field('Flight No.', 'flightNumber', p.flightNumber)}
    ${field('RA Code', 'raCode', p.raCode)}
    ${field('RF Code', 'rfCode', p.rfCode)}
    ${field('車牌 vehicleRegistration', 'vehicleRegistration', p.vehicleRegistration)}
    ${field('Seal Type', 'sealType', p.sealType, { type: 'select', options: sealOptions })}
    ${field('Seal Number', 'seal', p.seal, { hint: '多 Seal 類型可用逗號分隔' })}
    ${field('件數 pieceCount', 'cargo.pieceCount', p.cargo && p.cargo.pieceCount, { type: 'number' })}
    ${field('重量 KG', 'cargo.weight.value', p.cargo && p.cargo.weight && p.cargo.weight.value, { type: 'number' })}
    ${field('體積 CBM', 'cargo.volume.value', p.cargo && p.cargo.volume && p.cargo.volume.value, { type: 'number' })}
    ${field('PI Code', 'piCode', p.piCode, { type: 'select', options: piOptions })}
    ${field('PI Code Booking', 'piCodeBooking', p.piCodeBooking, { type: 'select', options: piOptions })}
    ${field('BU User Name', 'buUserName', p.buUserName)}
    ${field('discNoticeYn', 'discNoticeYn', !!p.discNoticeYn, { type: 'checkbox' })}
    ${field('Nature of Goods', 'natureOfGoods', p.natureOfGoods, { hint: 'AAT #415 專用' })}
    ${field('Special Handling Codes', 'specialHandlingCodesText', (p.specialHandlingCodes || []).join(', '), { hint: '例如 ELI, ELM' })}
    ${field('收件電郵', 'receiptEmails', emails, { hint: '最多 3 個（AAT）' })}
    ${field('additionalSecurityInformation', 'additionalSecurityInformation', p.additionalSecurityInformation, { type: 'textarea', rows: 2, wide: true })}
    ${options.hideUlds ? '' : field('ULD 清單', 'uldLines', uldText, { type: 'textarea', rows: 4, wide: true, hint: '每行：ULD#｜CONTOUR｜SUB｜CBM｜KG' })}`;
}

function jsonEditor(text) {
  return `<label class="hkia-field is-wide"><span>JSON（可直接編輯；送出以此為準）</span>
    <textarea rows="18" class="hkia-json-editor" data-field="__jsonText">${esc(text)}</textarea></label>`;
}

function modeSwitch(mode, scope) {
  return `<div class="hkia-mode">
    <button type="button" class="${mode === 'form' ? 'active' : ''}" data-action="${scope}-mode-form">表單模式</button>
    <button type="button" class="${mode === 'json' ? 'active' : ''}" data-action="${scope}-mode-json">JSON 模式</button>
  </div>`;
}

function stepBadge(result) {
  if (!result) return badge('待執行', 'idle');
  return result.ok ? badge(`HTTP ${result.status}`, 'ok') : badge(`HTTP ${result.status || '失敗'}`, 'error');
}

export function renderFull(state) {
  const p = state.payload;
  const preset = getPreset(state.presetId);
  return `<div class="hkia-wizard" data-scope="full">
    <div class="hkia-flow-head">
      <div>
        <h3>Full Flow：Export Order → 安檢影像 → 預報關單</h3>
        <p class="hkia-muted">依序完成 <code>#405 → #409 → #401</code>；成功後單號會自動帶入下一步與查詢頁。</p>
      </div>
      <label class="hkia-inline">範本 <select data-preset="full">${presetOptions(state.presetId)}</select></label>
      ${modeSwitch(state.mode, 'full')}
      <button type="button" class="pill" data-action="full-gen-uuid">↻ 新 UUID</button>
    </div>
    <p class="hkia-note">${esc(preset.note || '')}</p>

    <article class="hkia-stepcard" data-step="1">
      <header><span class="hkia-step-no">①</span> <strong>#405 Create Export Order</strong> <span data-step-badge="1">${stepBadge(state.step1)}</span></header>
      <div class="hkia-formgrid">${state.mode === 'form' ? formFields(p) : jsonEditor(state.jsonText)}</div>
      <div class="hkia-lint" data-lint="full">${lintHtml(null)}</div>
      <div class="hkia-actions">
        <button type="button" class="pill btn-primary" data-action="full-send-405">送出 #405</button>
        <button type="button" class="pill" data-action="full-lint">重新預檢</button>
      </div>
      <div data-result="full-405">${resultHtml(state.step1)}</div>
      <div class="hkia-ref-row">
        <label class="hkia-inline">Export Order Ref. <input type="text" data-export-ref value="${esc(state.exportRef)}" placeholder="送出 #405 後自動填入"></label>
        <button type="button" class="hkia-mini" data-action="full-query-406">查詢 #406</button>
      </div>
      <div data-result="full-406">${resultHtml(state.query)}</div>
    </article>

    <article class="hkia-stepcard" data-step="2">
      <header><span class="hkia-step-no">②</span> <strong>#409 Upload Screening Image</strong> <span data-step-badge="2">${stepBadge(state.step2)}</span></header>
      <p class="hkia-muted">單張 ≤ 4 MB；後端會自動做 SHA-256 + RSA 簽章（Local Mock 未設 .key 時使用臨時金鑰）。</p>
      <div class="hkia-upload">
        <input type="file" accept="image/*" data-image-input>
        <div class="hkia-upload-preview" data-image-preview>
          ${state.image && state.image.preview ? `<img src="${esc(state.image.preview)}" alt="screening preview">` : '<span class="hkia-muted">尚未選擇圖片</span>'}
        </div>
        <div class="hkia-muted" data-image-meta>${state.image ? `${esc(state.image.name)} · ${(state.image.size / 1024).toFixed(1)} KB` : ''}</div>
      </div>
      <div class="hkia-actions">
        <button type="button" class="pill btn-primary" data-action="full-send-409">簽章並上傳 #409</button>
      </div>
      <div data-result="full-409">${resultHtml(state.step2)}</div>
    </article>

    <article class="hkia-stepcard" data-step="3">
      <header><span class="hkia-step-no">③</span> <strong>#401 Create Pre-Declaration（Async 202）</strong> <span data-step-badge="3">${stepBadge(state.step3)}</span></header>
      <p class="hkia-muted">會沿用 ① 的貨物資料與 Export Order 單號；送出後請到「Callback 監控」看 CTO 回覆。</p>
      <div class="hkia-inline-row">
        <label class="hkia-inline">Export Order Ref. <input type="text" data-predecl-ref value="${esc(state.exportRef)}" placeholder="同上"></label>
      </div>
      <div class="hkia-actions">
        <button type="button" class="pill btn-primary" data-action="full-send-401">送出 #401</button>
      </div>
      <div data-result="full-401">${resultHtml(state.step3)}</div>
    </article>

    <div class="hkia-snippets-wrap">
      <label class="hkia-inline">程式碼片段 API
        <select data-snippet-api>
          ${['#405', '#409', '#401'].map((api) => `<option value="${api}" ${state.snippetApi === api ? 'selected' : ''}>${api}</option>`).join('')}
        </select>
      </label>
      ${snippetsHtml({ curl: '', javascript: '', python: '' })}
    </div>
  </div>`;
}

// ---------- 表單讀取／驗證／片段 ----------
export function readFullPayload(root, state) {
  if (state.mode === 'json') {
    const area = root.querySelector('[data-field="__jsonText"]');
    const text = area ? area.value : state.jsonText;
    state.jsonText = text;
    if (!text.trim()) throw new Error('JSON 不可為空');
    const parsed = JSON.parse(text);
    state.payload = parsed;
    return parsed;
  }
  const base = Object.assign({}, state.payload);
  const get = (name) => {
    const el = root.querySelector(`[data-field="${name}"]`);
    if (!el) return undefined;
    return el.type === 'checkbox' ? el.checked : el.value;
  };
  const payload = Object.assign({}, base, {
    ctoCode: get('ctoCode'),
    cargoType: get('cargoType'),
    airlineCode: String(get('airlineCode') || '').toUpperCase(),
    screeningMethod: get('screeningMethod'),
    securityStatus: Object.assign({}, base.securityStatus, {
      statusCode: String(get('securityStatus.statusCode') || '').toUpperCase(),
      screeningMethod: get('screeningMethod')
    }),
    mawbNumber: get('mawbNumber'),
    hawbNumber: get('hawbNumber'),
    destination: get('destination'),
    flightNumber: get('flightNumber'),
    raCode: get('raCode'),
    rfCode: get('rfCode'),
    vehicleRegistration: get('vehicleRegistration'),
    sealType: get('sealType'),
    seal: get('seal'),
    additionalSecurityInformation: get('additionalSecurityInformation'),
    natureOfGoods: get('natureOfGoods'),
    piCode: get('piCode'),
    piCodeBooking: get('piCodeBooking'),
    buUserName: get('buUserName'),
    discNoticeYn: !!get('discNoticeYn'),
    specialHandlingCodes: listOf(get('specialHandlingCodesText')).map((s) => s.toUpperCase()),
    receipt: { emails: listOf(get('receiptEmails')) },
    cargo: {
      pieceCount: numOrBlank(get('cargo.pieceCount')),
      weight: { value: numOrBlank(get('cargo.weight.value')), unit: 'KG' },
      volume: { value: numOrBlank(get('cargo.volume.value')), unit: 'CBM' }
    }
  });
  const uldEl = root.querySelector('[data-field="uldLines"]');
  if (uldEl) payload.ulds = parseUldLines(uldEl.value);
  payload.documentId = base.documentId || uuid();
  state.payload = payload;
  return payload;
}

function updateLint(root, state, api, scopeName = 'full') {
  const box = root.querySelector(`[data-lint="${scopeName}"]`);
  if (!box) return;
  let payload;
  try {
    payload = readFullPayload(root, state);
  } catch (err) {
    box.innerHTML = `<div class="hkia-lint is-error"><strong>JSON 解析失敗</strong><ul><li>${esc(err.message)}</li></ul></div>`;
    return;
  }
  const lint = Val().validate(payload, { api, cto: payload.ctoCode, cargoType: payload.cargoType });
  box.innerHTML = lintHtml(lint);
  return lint;
}

function updateSnippets(root, state, config) {
  const select = root.querySelector('[data-snippet-api]');
  const api = select ? select.value : (state.snippetApi || '#405');
  state.snippetApi = api;
  const env = config && config.env === 'prod' ? '' : 'sit.';
  const path = api === '#405'
    ? '/export/external/v1/ra/export-orders'
    : api === '#409'
      ? `/export/external/v1/ra/export-orders/${state.exportRef || '{export_order_reference_num}'}/screening-images`
      : api === '#415'
        ? '/export/external/v1/ra/lite-pre-declarations'
        : api === '#416'
          ? `/export/external/v1/ra/mawb/${state.deleteMawb || '{mawb_num}'}`
          : '/export/external/v1/ra/pre-declarations';
  const method = api === '#416' ? 'DELETE' : 'POST';
  const body = api === '#401'
    ? buildPreDeclarationPayload(state.payload, { exportOrderReferenceNum: state.exportRef })
    : api === '#409'
      ? { exportOrderReferenceNum: state.exportRef, imageBase64: '<base64>', imageHash: '<hash>', imageSignature: '<signature>' }
      : api === '#416' ? null : state.payload;
  const snippets = buildAll({
    method,
    url: `https://api-external.${env}hkiacargo.com${path}`,
    headers: { 'x-api-key': '<x-api-key>', Authorization: 'Bearer <access_token>', 'x-request-id': (api === '#401' || api === '#415') ? '<uuid-v4>' : '' },
    body,
    certPath: config && config.certPath ? config.certPath : './certs/client.pem',
    keyPath: config && config.keyPath ? config.keyPath : './certs/client.key'
  });
  setSnippetData(root, snippets);
}

function applyPreset(state, presetId) {
  const preset = getPreset(presetId);
  state.presetId = preset.id;
  state.payload = preset.build();
  state.jsonText = JSON.stringify(state.payload, null, 2);
  if (state.mode === 'json') return;
}

function resultSlot(root, key) {
  return root.querySelector(`[data-result="${key}"]`);
}

function setExportRef(root, state, ref) {
  state.exportRef = ref;
  root.querySelectorAll('[data-export-ref], [data-predecl-ref]').forEach((input) => { input.value = ref; });
}

function debounce(fn, delay = 180) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), delay); };
}

async function withBusy(button, fn) {
  if (!button) return fn();
  const label = button.textContent;
  button.disabled = true;
  button.textContent = '處理中…';
  try { return await fn(); } finally { button.disabled = false; button.textContent = label; }
}

function updateStepBadge(root, step, result) {
  const el = root.querySelector(`[data-step-badge="${step}"]`);
  if (el) el.innerHTML = stepBadge(result);
}

async function handleImage(input, scope, state, toast) {
  const file = input.files && input.files[0];
  if (!file) return;
  if (file.size > 4 * 1024 * 1024) {
    input.value = '';
    toast('圖片超過 4 MB（#409 限制）', false);
    return;
  }
  const base64 = await fileToBase64(file);
  const preview = `data:${file.type || 'image/jpeg'};base64,${base64}`;
  state.image = { name: file.name, contentType: file.type || 'image/jpeg', size: file.size, base64, preview };
  const box = scope.querySelector('[data-image-preview]');
  if (box) box.innerHTML = `<img src="${preview}" alt="screening preview">`;
  const meta = scope.querySelector('[data-image-meta]');
  if (meta) meta.textContent = `${file.name} · ${(file.size / 1024).toFixed(1)} KB · base64 ${base64.length.toLocaleString()} chars`;
}

export function mountFull(root, ctx) {
  const scope = root.querySelector('[data-scope="full"]');
  if (!scope) return;
  const state = ctx.state.full;
  const scheduleLint = debounce(() => updateLint(scope, state, '#405', 'full'), 180);

  updateLint(scope, state, '#405', 'full');
  updateSnippets(scope, state, ctx.state.config);
  mountSnippets(scope);

  scope.addEventListener('input', (event) => {
    const target = event.target;
    if (!target || !target.hasAttribute || !target.hasAttribute('data-field')) return;
    if (state.mode === 'form') { try { readFullPayload(scope, state); } catch (err) { /* 錯誤由 lint 顯示 */ } }
    else state.jsonText = target.value;
    scheduleLint();
  });

  scope.addEventListener('change', async (event) => {
    const target = event.target;
    if (!target || !target.matches) return;
    if (target.matches('[data-preset="full"]')) {
      applyPreset(state, target.value);
      ctx.rerender();
      return;
    }
    if (target.matches('[data-image-input]')) { await handleImage(target, scope, state, ctx.toast); return; }
    if (target.matches('[data-export-ref]')) {
      state.exportRef = target.value.trim();
      const pre = scope.querySelector('[data-predecl-ref]');
      if (pre) pre.value = state.exportRef;
      updateSnippets(scope, state, ctx.state.config);
      return;
    }
    if (target.matches('[data-snippet-api]')) { updateSnippets(scope, state, ctx.state.config); return; }
    if (target.hasAttribute && target.hasAttribute('data-field')) {
      updateLint(scope, state, '#405', 'full');
      updateSnippets(scope, state, ctx.state.config);
    }
  });

  installFullActions(scope, ctx, state);
}

function installFullActions(scope, ctx, state) {
  scope.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const action = button.getAttribute('data-action');
    if (!action || action.indexOf('full-') !== 0) return;

    if (action === 'full-mode-form' || action === 'full-mode-json') {
      if (state.mode === 'json') {
        try { state.payload = readFullPayload(scope, state); } catch (err) {
          ctx.toast(`JSON 無法解析：${err.message}`, false);
          return;
        }
      } else {
        try { state.payload = readFullPayload(scope, state); } catch (err) { /* keep */ }
      }
      state.mode = action === 'full-mode-form' ? 'form' : 'json';
      state.jsonText = JSON.stringify(state.payload, null, 2);
      ctx.rerender();
      return;
    }

    if (action === 'full-gen-uuid') {
      state.payload.documentId = uuid();
      state.jsonText = JSON.stringify(state.payload, null, 2);
      ctx.rerender();
      return;
    }

    if (action === 'full-lint') {
      const lint = updateLint(scope, state, '#405', 'full');
      ctx.toast(lint && lint.ok ? 'CTO 預檢通過' : `預檢發現 ${lint ? lint.errors.length : 0} 項錯誤`, !!(lint && lint.ok));
      return;
    }

    if (action === 'full-send-405') {
      await withBusy(button, async () => {
        let payload;
        try { payload = readFullPayload(scope, state); } catch (err) { ctx.toast(`payload 無法解析：${err.message}`, false); return; }
        const result = await ctx.proxy({ api: '#405', body: payload });
        state.step1 = result;
        updateStepBadge(scope, 1, result);
        const slot = scope.querySelector('[data-result="full-405"]');
        if (slot) slot.innerHTML = resultHtml(result);
        const ref = result.ok && result.response ? result.response.export_order_reference_num : '';
        if (ref) {
          setExportRef(scope, state, ref);
          updateSnippets(scope, state, ctx.state.config);
          ctx.toast(`#405 成功：${ref}`);
        } else {
          ctx.toast(`#405 失敗（HTTP ${result.status || '-'}）`, false);
        }
        ctx.refreshRefs();
      });
      return;
    }

    if (action === 'full-query-406') {
      await withBusy(button, async () => {
        const ref = (scope.querySelector('[data-export-ref]') || {}).value || state.exportRef;
        if (!ref) { ctx.toast('請先填 Export Order Ref.', false); return; }
        const result = await ctx.proxy({ api: '#406', params: { export_order_reference_num: ref } });
        state.query = result;
        const slot = scope.querySelector('[data-result="full-406"]');
        if (slot) slot.innerHTML = resultHtml(result);
      });
      return;
    }

    if (action === 'full-send-409') {
      await withBusy(button, async () => {
        const ref = (scope.querySelector('[data-export-ref]') || {}).value || state.exportRef;
        if (!ref) { ctx.toast('請先完成 #405 或填入 Export Order Ref.', false); return; }
        if (!state.image) { ctx.toast('請先選擇安檢圖片', false); return; }
        const body = buildScreeningImagePayload(state.payload, state.image, { exportOrderReferenceNum: ref });
        const result = await ctx.proxy({ api: '#409', params: { export_order_reference_num: ref, role: 'ra' }, body });
        state.step2 = result;
        updateStepBadge(scope, 2, result);
        const slot = scope.querySelector('[data-result="full-409"]');
        if (slot) slot.innerHTML = resultHtml(result);
        ctx.toast(result.ok ? '#409 安檢影像已上傳（含簽章）' : `#409 失敗（HTTP ${result.status || '-'}）`, result.ok);
      });
      return;
    }

    if (action === 'full-send-401') {
      await withBusy(button, async () => {
        const ref = (scope.querySelector('[data-predecl-ref]') || {}).value || state.exportRef;
        if (!ref) { ctx.toast('請先完成 #405 或填入 Export Order Ref.', false); return; }
        try { state.payload = readFullPayload(scope, state); } catch (err) { ctx.toast(`payload 無法解析：${err.message}`, false); return; }
        const body = buildPreDeclarationPayload(state.payload, { exportOrderReferenceNum: ref });
        const result = await ctx.proxy({ api: '#401', body });
        state.step3 = result;
        updateStepBadge(scope, 3, result);
        const slot = scope.querySelector('[data-result="full-401"]');
        if (slot) slot.innerHTML = resultHtml(result);
        ctx.toast(result.ok ? '#401 已受理（202），請到 Callback 監控看結果' : `#401 失敗（HTTP ${result.status || '-'}）`, result.ok);
        ctx.refreshRefs();
      });
    }
  });
}

export function renderLite(state) {
  const p = state.payload;
  const preset = getPreset(state.presetId);
  return `<div class="hkia-wizard" data-scope="lite">
    <div class="hkia-flow-head">
      <div>
        <h3>Lite Flow：Lite Pre-Declaration ＋ 刪除 MAWB</h3>
        <p class="hkia-muted">適用於已在 CTO 系統有資料、只需補送安檢摘要的情境：<code>#415</code>（Async 202）與 <code>#416</code>。</p>
      </div>
      <label class="hkia-inline">範本 <select data-preset="lite">${presetOptions(state.presetId)}</select></label>
      ${modeSwitch(state.mode, 'lite')}
      <button type="button" class="pill" data-action="lite-gen-uuid">↻ 新 UUID</button>
    </div>
    <p class="hkia-note">${esc(preset.note || '')}</p>

    <article class="hkia-stepcard">
      <header><span class="hkia-step-no">①</span> <strong>#415 Create Lite Pre-Declaration（Async 202）</strong>
        <span data-lite-badge="415">${state.result415 ? (state.result415.ok ? badge(`HTTP ${state.result415.status}`, 'ok') : badge(`HTTP ${state.result415.status || '失敗'}`, 'error')) : badge('待執行', 'idle')}</span>
      </header>
      <div class="hkia-formgrid">${state.mode === 'form' ? formFields(p, { hideUlds: true }) : jsonEditor(state.jsonText)}</div>
      <div class="hkia-lint" data-lint="lite">${lintHtml(null)}</div>
      <div class="hkia-actions">
        <button type="button" class="pill btn-primary" data-action="lite-send-415">送出 #415</button>
        <button type="button" class="pill" data-action="lite-lint">重新預檢</button>
      </div>
      <div data-result="lite-415">${resultHtml(state.result415)}</div>
    </article>

    <article class="hkia-stepcard">
      <header><span class="hkia-step-no">②</span> <strong>#416 Delete MAWB</strong>
        <span data-lite-badge="416">${state.result416 ? (state.result416.ok ? badge(`HTTP ${state.result416.status}`, 'ok') : badge(`HTTP ${state.result416.status || '失敗'}`, 'error')) : badge('待執行', 'idle')}</span>
      </header>
      <p class="hkia-muted">同步 API；成功後該 MAWB 會從 CTO 移除（Mock 會同步清掉單號清單）。</p>
      <div class="hkia-inline-row">
        <label class="hkia-inline">MAWB# <input type="text" data-delete-mawb value="${esc(state.deleteMawb || p.mawbNumber || '')}" placeholder="160-1234 5678"></label>
        <button type="button" class="pill" data-action="lite-send-416">刪除 MAWB</button>
      </div>
      <div data-result="lite-416">${resultHtml(state.result416)}</div>
    </article>

    <div class="hkia-snippets-wrap">
      <label class="hkia-inline">程式碼片段 API
        <select data-snippet-api>
          ${['#415', '#416'].map((api) => `<option value="${api}" ${state.snippetApi === api ? 'selected' : ''}>${api}</option>`).join('')}
        </select>
      </label>
      ${snippetsHtml({ curl: '', javascript: '', python: '' })}
    </div>
  </div>`;
}

function updateLiteBadge(root, code, result) {
  const el = root.querySelector(`[data-lite-badge="${code}"]`);
  if (el) el.innerHTML = result ? (result.ok ? badge(`HTTP ${result.status}`, 'ok') : badge(`HTTP ${result.status || '失敗'}`, 'error')) : badge('待執行', 'idle');
}

export function mountLite(root, ctx) {
  const scope = root.querySelector('[data-scope="lite"]');
  if (!scope) return;
  const state = ctx.state.lite;
  const scheduleLint = debounce(() => updateLint(scope, state, '#415', 'lite'), 180);

  updateLint(scope, state, '#415', 'lite');
  updateSnippets(scope, state, ctx.state.config);
  mountSnippets(scope);

  scope.addEventListener('input', (event) => {
    const target = event.target;
    if (!target || !target.hasAttribute) return;
    if (target.hasAttribute('data-delete-mawb')) { state.deleteMawb = target.value; return; }
    if (!target.hasAttribute('data-field')) return;
    if (state.mode === 'form') { try { readFullPayload(scope, state); } catch (err) { /* lint 會顯示 */ } }
    else state.jsonText = target.value;
    scheduleLint();
  });

  scope.addEventListener('change', (event) => {
    const target = event.target;
    if (!target || !target.matches) return;
    if (target.matches('[data-preset="lite"]')) {
      applyPreset(state, target.value);
      ctx.rerender();
      return;
    }
    if (target.matches('[data-delete-mawb]')) { state.deleteMawb = target.value.trim(); updateSnippets(scope, state, ctx.state.config); return; }
    if (target.matches('[data-snippet-api]')) { updateSnippets(scope, state, ctx.state.config); return; }
    if (target.hasAttribute && target.hasAttribute('data-field')) {
      updateLint(scope, state, '#415', 'lite');
      updateSnippets(scope, state, ctx.state.config);
    }
  });

  scope.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const action = button.getAttribute('data-action');
    if (!action || action.indexOf('lite-') !== 0) return;

    if (action === 'lite-mode-form' || action === 'lite-mode-json') {
      if (state.mode === 'json') {
        try { state.payload = readFullPayload(scope, state); } catch (err) { ctx.toast(`JSON 無法解析：${err.message}`, false); return; }
      } else {
        try { state.payload = readFullPayload(scope, state); } catch (err) { /* keep */ }
      }
      state.mode = action === 'lite-mode-form' ? 'form' : 'json';
      state.jsonText = JSON.stringify(state.payload, null, 2);
      ctx.rerender();
      return;
    }

    if (action === 'lite-gen-uuid') {
      state.payload.documentId = uuid();
      state.jsonText = JSON.stringify(state.payload, null, 2);
      ctx.rerender();
      return;
    }

    if (action === 'lite-lint') {
      const lint = updateLint(scope, state, '#415', 'lite');
      ctx.toast(lint && lint.ok ? 'CTO 預檢通過' : `預檢發現 ${lint ? lint.errors.length : 0} 項錯誤`, !!(lint && lint.ok));
      return;
    }

    if (action === 'lite-send-415') {
      await withBusy(button, async () => {
        let payload;
        try { payload = readFullPayload(scope, state); } catch (err) { ctx.toast(`payload 無法解析：${err.message}`, false); return; }
        const result = await ctx.proxy({ api: '#415', body: payload });
        state.result415 = result;
        updateLiteBadge(scope, '415', result);
        const slot = scope.querySelector('[data-result="lite-415"]');
        if (slot) slot.innerHTML = resultHtml(result);
        if (result.ok && result.response && result.response.ra_reference_id) state.raRef = result.response.ra_reference_id;
        ctx.toast(result.ok ? '#415 已受理（202），請到 Callback 監控看結果' : `#415 失敗（HTTP ${result.status || '-'}）`, result.ok);
        ctx.refreshRefs();
      });
      return;
    }

    if (action === 'lite-send-416') {
      await withBusy(button, async () => {
        const input = scope.querySelector('[data-delete-mawb]');
        const mawb = String((input && input.value) || state.deleteMawb || '').trim();
        if (!mawb) { ctx.toast('請填 MAWB#', false); return; }
        state.deleteMawb = mawb;
        const result = await ctx.proxy({ api: '#416', params: { mawb_num: mawb } });
        state.result416 = result;
        updateLiteBadge(scope, '416', result);
        const slot = scope.querySelector('[data-result="lite-416"]');
        if (slot) slot.innerHTML = resultHtml(result);
        ctx.toast(result.ok ? `#416 已刪除 ${mawb}` : `#416 失敗（HTTP ${result.status || '-'}）`, result.ok);
        ctx.refreshRefs();
      });
    }
  });
}
