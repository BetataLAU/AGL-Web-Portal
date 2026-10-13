// ===== Shipper Role Project - SLI/ELI 版面編輯器（DOM / 互動）=====
// 依賴 sli-eli-layout-state.js（state 與幾何）；載入順序見 sli-eli-layout.html
// 顯示原則：所有文字位置都來自 /preview（engine.layout()）→ 與 PDF 完全一致。

const LEL_HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

function lelEl(id) { return document.getElementById(id); }

function lelRenderAll() {
  lelRenderPageTabs();
  lelRenderList();
  lelRenderStage();
  lelRenderProps();
  lelRenderStatus();
  lelRenderToolbarState();
}

function lelRenderPageTabs() {
  const box = lelEl('lel-page-tabs');
  if (!box) return;
  box.innerHTML = lelState.pages.map((p) => (
    `<button type="button" class="lel-btn ${Number(p.index) === Number(lelState.pageIndex) ? 'active' : ''}" data-page="${p.index}">`
    + `${lelEsc(p.label)}（${Number(p.index) + 1}）</button>`
  )).join('');
}

function lelRenderList() {
  const box = lelEl('lel-field-list');
  if (!box) return;
  box.innerHTML = lelState.fields.map((f) => {
    const warn = lelFieldWarning(f);
    const other = Number(f.page) !== Number(lelState.pageIndex);
    return `<button type="button" class="lel-list-item ${f.key === lelState.selectedKey ? 'selected' : ''} ${other ? 'lel-on-other-page' : ''}"`
      + ` data-key="${lelEsc(f.key)}" title="${warn ? lelEsc(warn) : lelEsc(f.key)}">`
      + `<span>${warn ? '⚠️ ' : ''}${lelEsc(f.label || f.key)}</span>`
      + `<span class="lel-key">${lelEsc(f.cell || '')}</span></button>`;
  }).join('');
}

function lelRenderStatus() {
  const box = lelEl('lel-status');
  if (!box) return;
  const parts = [];
  parts.push(lelState.canEdit
    ? `<span class="lel-chip lel-chip-ok">可編輯（${lelEsc(lelState.role)}）</span>`
    : `<span class="lel-chip lel-chip-warn">唯讀（${lelEsc(lelState.role || '-')} 無儲存權限）</span>`);
  parts.push(lelState.dirty ? '<span class="lel-status-warn">● 有未儲存的變更</span>' : '<span>已同步</span>');
  if (lelState.previewLoading) parts.push('排版計算中…');
  if (lelState.previewError) parts.push(`<span class="lel-status-err">預覽失敗：${lelEsc(lelState.previewError)}</span>`);
  const pv = lelState.preview;
  if (pv) {
    parts.push(`樣本：<b>${lelEsc(pv.sample ? pv.sample.label : '')}</b>${pv.ms != null ? `（${pv.ms} ms）` : ''}`);
    if (pv.fallback) parts.push(`<span class="lel-status-warn">⚠️ ${lelEsc(pv.fallback.message)}</span>`);
  }
  if (lelState.engineIssue) parts.push(`<span class="lel-status-warn">⚠️ 引擎：${lelEsc(lelState.engineIssue)}</span>`);
  if (lelState.updatedAt) parts.push(`上次儲存：${lelEsc(String(lelState.updatedAt).replace('T', ' ').slice(0, 19))}`);
  box.innerHTML = parts.join(' · ');
}

function lelRenderToolbarState() {
  const undo = lelEl('lel-undo');
  const redo = lelEl('lel-redo');
  if (undo) undo.disabled = !lelState.undo.length;
  if (redo) redo.disabled = !lelState.redo.length;
  const snap = lelEl('lel-snap');
  if (snap) snap.classList.toggle('active', lelState.snap);
  const grid = lelEl('lel-grid');
  if (grid) grid.classList.toggle('active', lelState.grid);
  const save = lelEl('lel-save');
  if (save) save.disabled = !lelState.canEdit || !lelState.dirty;
  const resetAll = lelEl('lel-reset-all');
  if (resetAll) resetAll.disabled = !lelState.canEdit;
  ['lel-align-left', 'lel-align-center', 'lel-align-right', 'lel-align-top', 'lel-align-middle', 'lel-align-bottom'].forEach((id) => {
    const b = lelEl(id);
    if (b) b.disabled = !lelState.canEdit || !lelState.selectedKey;
  });
}

/** 單一欄位方塊（含文字行；文字行座標由 /preview 的位置換算，與 PDF 同一套數學） */
function lelFieldHtml(f, k) {
  const b = f.box;
  const sel = f.key === lelState.selectedKey;
  const pv = lelFieldByPreview(f.key);
  let lines = '';
  if (pv && Array.isArray(pv.positions) && pv.positions.length) {
    const size = (Number(pv.sizePt) || 8);
    const lhPx = (lelState.baseline.ascentEm + lelState.baseline.descentEm) * size * k;
    const ascPx = lelState.baseline.ascentEm * size * k;
    lines = pv.positions.map((pos) => {
      const left = (pos.x - b.x) * k;
      const top = (pos.baseline - b.y) * k - ascPx;
      return `<span class="lel-line" style="left:${left.toFixed(2)}px;top:${top.toFixed(2)}px;`
        + `font-size:${(size * k).toFixed(2)}px;line-height:${lhPx.toFixed(2)}px;color:${lelEsc(pv.color || '#000000')};`
        + `${pv.bold ? 'font-weight:700;' : ''}">${lelEsc(pos.text)}</span>`;
    }).join('');
  }
  const handles = sel ? LEL_HANDLES.map((d) => `<span class="lel-handle" data-dir="${d}"></span>`).join('') : '';
  const warn = lelFieldWarning(f);
  const tag = `${lelEsc(f.label || f.key)} ${b.w}×${b.h}${warn ? ' ⚠️' : ''}`;
  return `<div class="lel-field ${sel ? 'selected' : ''}" data-key="${lelEsc(f.key)}" `
    + `style="left:${(b.x * k).toFixed(2)}px;top:${(b.y * k).toFixed(2)}px;width:${(b.w * k).toFixed(2)}px;height:${(b.h * k).toFixed(2)}px">`
    + `<span class="lel-field-tag">${tag}</span>${lines}${handles}</div>`;
}

function lelRenderStage() {
  const stage = lelEl('lel-stage');
  if (!stage || !lelState.loaded) return;
  const page = lelPage();
  const k = lelState.pxPerPt * lelState.zoom;
  stage.style.width = `${Math.round(page.widthPt * k)}px`;
  stage.style.height = `${Math.round(page.heightPt * k)}px`;
  const html = [`<img class="lel-bg" src="${LEL_API}/background/${page.index}" alt="${lelEsc(page.label)} 底圖" draggable="false">`];
  if (lelState.grid) {
    const step = Math.max(6, Math.round(LEL_LIMITS.snapStepPt * k));
    html.push(`<div class="lel-grid-overlay" style="background-size:${step}px ${step}px"></div>`);
  }
  for (const f of lelFieldsOfPage(page.index)) html.push(lelFieldHtml(f, k));
  stage.innerHTML = html.join('');
}

function lelSelectField(key, silent) {
  if (key && !lelField(key)) return;
  lelState.selectedKey = key || null;
  if (!silent) {
    lelRenderList();
    lelRenderStage();
    lelRenderProps();
    lelRenderToolbarState();
  }
}


// ===== 拖曳移動 / 把手縮放 =====
let lelDrag = null;

function lelStagePointerDown(e) {
  const fieldEl = e.target.closest ? e.target.closest('.lel-field') : null;
  if (!fieldEl) return;
  const key = fieldEl.getAttribute('data-key');
  const f = lelField(key);
  if (!f) return;
  lelSelectField(key);
  if (!lelState.canEdit) return; // 唯讀：只能選取檢視
  const handle = e.target.closest('.lel-handle');
  lelDrag = {
    mode: handle ? 'resize' : 'move',
    dir: handle ? handle.getAttribute('data-dir') : '',
    key: key,
    startX: e.clientX,
    startY: e.clientY,
    moved: false,
    base: { box: Object.assign({}, f.box), origin: Object.assign({}, f.origin), wrapWidthPt: f.wrapWidthPt },
  };
  fieldEl.classList.add('lel-field-dragging');
  e.preventDefault();
  window.addEventListener('pointermove', lelStagePointerMove);
  window.addEventListener('pointerup', lelStagePointerUp, { once: true });
}

function lelStagePointerMove(e) {
  if (!lelDrag) return;
  const f = lelField(lelDrag.key);
  if (!f) return;
  const k = lelState.pxPerPt * lelState.zoom;
  let dx = (e.clientX - lelDrag.startX) / k;
  let dy = (e.clientY - lelDrag.startY) / k;
  if (!lelDrag.moved && Math.abs(dx) < 0.3 && Math.abs(dy) < 0.3) return;
  if (!lelDrag.moved) { lelPushUndo(); lelDrag.moved = true; }
  if (lelState.snap) {
    dx = Math.round(dx / LEL_LIMITS.snapStepPt) * LEL_LIMITS.snapStepPt;
    dy = Math.round(dy / LEL_LIMITS.snapStepPt) * LEL_LIMITS.snapStepPt;
  }
  // 每次都由「按下時的基準」重算，避免累積誤差
  f.box = Object.assign({}, lelDrag.base.box);
  f.origin = Object.assign({}, lelDrag.base.origin);
  f.wrapWidthPt = lelDrag.base.wrapWidthPt;
  if (lelDrag.mode === 'move') lelMoveField(f, dx, dy);
  else lelResizeField(f, lelDrag.dir, dx, dy);
  const el = document.querySelector(`.lel-field[data-key="${f.key}"]`);
  if (el) {
    el.style.left = `${(f.box.x * k).toFixed(2)}px`;
    el.style.top = `${(f.box.y * k).toFixed(2)}px`;
    el.style.width = `${(f.box.w * k).toFixed(2)}px`;
    el.style.height = `${(f.box.h * k).toFixed(2)}px`;
    const tag = el.querySelector('.lel-field-tag');
    if (tag) tag.textContent = `${f.label || f.key} ${f.box.w}×${f.box.h}${lelFieldWarning(f) ? ' ⚠️' : ''}`;
  }
}

function lelStagePointerUp() {
  window.removeEventListener('pointermove', lelStagePointerMove);
  const drag = lelDrag;
  lelDrag = null;
  if (!drag) return;
  const f = lelField(drag.key);
  if (!f || !drag.moved) return; // 只是點選，不需要重算
  lelApplyDerived(f);
  lelRenderStage();
  lelRenderList();
  lelRenderProps();
  lelRenderToolbarState();
  lelSchedulePreview(true);
}

// ===== 鍵盤：方向鍵微調（Shift = 10pt）／Ctrl+Z／Ctrl+Y =====
function lelKeydown(e) {
  const tag = (e.target && e.target.tagName) || '';
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  const mod = e.ctrlKey || e.metaKey;
  const key = String(e.key || '').toLowerCase();
  if (mod && key === 'z') {
    e.preventDefault();
    if (e.shiftKey) lelRedo(); else lelUndo();
    return;
  }
  if (mod && key === 'y') { e.preventDefault(); lelRedo(); return; }
  if (mod && key === 's') { e.preventDefault(); if (typeof lelSave === 'function') lelSave(); return; }
  const map = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] };
  const dir = map[key];
  if (!dir || !lelState.canEdit || !lelState.selectedKey) return;
  const f = lelField(lelState.selectedKey);
  if (!f) return;
  e.preventDefault();
  const step = e.shiftKey ? LEL_LIMITS.moveStepShiftPt : LEL_LIMITS.moveStepPt;
  lelPushUndo();
  lelMoveField(f, dir[0] * step, dir[1] * step);

// ===== 屬性面板 =====
function lelNumInput(id, label, value, step) {
  return `<div class="lel-prop-row"><label for="${id}">${label}</label>`
    + `<input type="number" id="${id}" value="${value}" step="${step || 0.5}"></div>`;
}

function lelRenderProps() {
  const box = lelEl('lel-props');
  if (!box) return;
  const f = lelState.selectedKey ? lelField(lelState.selectedKey) : null;
  if (!f) {
    box.innerHTML = '<p class="lel-hint">請從左側清單或畫布選擇一個欄位。</p>';
    return;
  }
  const warn = lelFieldWarning(f);
  const pv = lelFieldByPreview(f.key);
  const dis = lelState.canEdit ? '' : ' disabled';
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const hLabels = { left: '左', center: '置中', right: '右' };
  const vLabels = { top: '上', center: '置中', bottom: '下' };
  box.innerHTML = `
    <div class="lel-panel-title"><h3>欄位屬性</h3><span class="lel-chip lel-chip-muted">${lelEsc(f.key)}</span></div>
    ${warn ? `<p class="lel-status-err" style="font-size:0.78rem;margin:0 0 8px">⚠️ ${lelEsc(warn)}</p>` : ''}
    <div class="lel-prop-row"><label>來源</label><span class="lel-hint">${lelEsc(f.source || '')} ／ ${lelEsc(f.cell || '')}</span></div>
    ${lelNumInput('lel-prop-ox', '錨點 X', num(f.origin.x), 0.5)}
    ${lelNumInput('lel-prop-oy', '錨點 Y', num(f.origin.y), 0.5)}
    <div class="lel-prop-row"><label>框 X／W</label><div class="lel-prop-pair">
      <input type="number" id="lel-prop-bx" value="${num(f.box.x)}" step="0.5">
      <input type="number" id="lel-prop-bw" value="${num(f.box.w)}" step="0.5">
    </div></div>
    <div class="lel-prop-row"><label>框 Y／H</label><div class="lel-prop-pair">
      <input type="number" id="lel-prop-by" value="${num(f.box.y)}" step="0.5">
      <input type="number" id="lel-prop-bh" value="${num(f.box.h)}" step="0.5">
    </div></div>
    ${lelNumInput('lel-prop-size', '字級 pt', num(f.font.sizePt), 0.5)}
    ${lelNumInput('lel-prop-lh', '行高 pt', num(f.lineHeightPt), 0.5)}
    <div class="lel-prop-row"><label>水平</label><select id="lel-prop-ah"${dis}>
      ${['left', 'center', 'right'].map((v) => `<option value="${v}" ${f.align.h === v ? 'selected' : ''}>${hLabels[v]}</option>`).join('')}
    </select></div>
    <div class="lel-prop-row"><label>垂直</label><select id="lel-prop-av"${dis}>
      ${['top', 'center', 'bottom'].map((v) => `<option value="${v}" ${f.align.v === v ? 'selected' : ''}>${vLabels[v]}</option>`).join('')}
    </select></div>
    <div class="lel-prop-row"><label>字型</label>
      <input type="color" id="lel-prop-color" value="${lelEsc(f.font.color || '#000000')}"${dis} style="max-width:52px">
      <label style="width:auto;display:flex;gap:6px;align-items:center"><input type="checkbox" id="lel-prop-bold" ${f.font.bold ? 'checked' : ''}${dis}> 粗體</label>
    </div>
    <div class="lel-prop-row"><label>換行</label>
      <label style="width:auto;display:flex;gap:6px;align-items:center"><input type="checkbox" id="lel-prop-wrap" ${f.wrap ? 'checked' : ''}${dis}> 自動折行（依框寬）</label>
    </div>
    <div class="lel-prop-meta">
      推導值：行高 ${num(f.lineHeightPt)}pt ／ 換行寬 ${num(f.wrapWidthPt)}pt ／ 最多 ${num(f.maxLines)} 行 ／ baseline 偏移 ${num(f.textBaselineOffsetPt)}pt<br>
      樣本文字：${pv ? `${(pv.lines || []).length} 行` : '（尚未預覽）'}
    </div>
    <div class="lel-prop-actions">
      <button type="button" class="lel-btn" id="lel-prop-reset"${dis}>♻️ 還原此欄位</button>
      <button type="button" class="lel-btn" id="lel-prop-center"${dis}>⊕ 置中於框</button>
      <button type="button" class="lel-btn" id="lel-prop-center-h"${dis}>↔ 水平置中</button>
      <button type="button" class="lel-btn" id="lel-prop-center-v"${dis}>↕ 垂直置中</button>
    </div>`;
  lelBindProps(f);
}


/** 套用「屬性面板」變更（每次 change 只推一次 undo） */
function lelApplyProp(fn) {
  const f = lelField(lelState.selectedKey);
  if (!f || !lelState.canEdit) return;
  lelPushUndo();
  fn(f);
  lelApplyDerived(f);
  lelRenderStage();
  lelRenderList();
  lelRenderToolbarState();
  lelSchedulePreview(true);
}

function lelBindProps(f) {
  const on = (id, handler) => {
    const el = lelEl(id);
    if (el) el.addEventListener('change', handler);
  };
  const numOf = (id) => {
    const el = lelEl(id);
    const v = el ? Number(el.value) : NaN;
    return Number.isFinite(v) ? v : null;
  };
  on('lel-prop-ox', () => { const v = numOf('lel-prop-ox'); if (v !== null) lelApplyProp((x) => { x.origin.x = lelRound(v); }); });
  on('lel-prop-oy', () => { const v = numOf('lel-prop-oy'); if (v !== null) lelApplyProp((x) => { x.origin.y = lelRound(v); }); });
  on('lel-prop-bx', () => { const v = numOf('lel-prop-bx'); if (v !== null) lelApplyProp((x) => { x.box.x = lelRound(v); }); });
  on('lel-prop-by', () => { const v = numOf('lel-prop-by'); if (v !== null) lelApplyProp((x) => { x.box.y = lelRound(v); }); });
  on('lel-prop-bw', () => {
    const v = numOf('lel-prop-bw');
    if (v === null) return;
    lelApplyProp((x) => {
      const next = lelRound(Math.max(LEL_LIMITS.boxMinPt, v));
      const base = Number.isFinite(x.wrapWidthPt) ? x.wrapWidthPt : x.box.w;
      x.wrapWidthPt = lelRound(Math.max(1, base + (next - x.box.w)));
      x.box.w = next;
    });
  });
  on('lel-prop-bh', () => { const v = numOf('lel-prop-bh'); if (v !== null) lelApplyProp((x) => { x.box.h = lelRound(Math.max(LEL_LIMITS.boxMinPt, v)); }); });
  on('lel-prop-size', () => {
    const v = numOf('lel-prop-size');
    if (v !== null) lelApplyProp((x) => { x.font.sizePt = lelClamp(v, LEL_LIMITS.fontMinPt, LEL_LIMITS.fontMaxPt); });
  });
  on('lel-prop-lh', () => { const v = numOf('lel-prop-lh'); if (v !== null) lelApplyProp((x) => { x.lineHeightPt = Math.max(1, v); }); });
  on('lel-prop-ah', () => { const el = lelEl('lel-prop-ah'); if (el) lelApplyProp((x) => lelSetAlign(x, 'h', el.value)); });
  on('lel-prop-av', () => { const el = lelEl('lel-prop-av'); if (el) lelApplyProp((x) => lelSetAlign(x, 'v', el.value)); });
  on('lel-prop-color', () => { const el = lelEl('lel-prop-color'); if (el) lelApplyProp((x) => { x.font.color = String(el.value).toUpperCase(); }); });
  on('lel-prop-bold', () => { const el = lelEl('lel-prop-bold'); if (el) lelApplyProp((x) => { x.font.bold = !!el.checked; }); });
  on('lel-prop-wrap', () => { const el = lelEl('lel-prop-wrap'); if (el) lelApplyProp((x) => { x.wrap = !!el.checked; }); });

  const bind = (id, fn) => { const el = lelEl(id); if (el) el.addEventListener('click', fn); };
  bind('lel-prop-reset', () => { if (typeof lelResetOne === 'function') lelResetOne(f.key); });
  bind('lel-prop-center-h', () => lelApplyProp((x) => lelSetAlign(x, 'h', 'center')));
  bind('lel-prop-center-v', () => lelApplyProp((x) => lelSetAlign(x, 'v', 'center')));
  bind('lel-prop-center', () => lelApplyProp((x) => { lelSetAlign(x, 'h', 'center'); lelSetAlign(x, 'v', 'center'); }));
}

  lelRenderStage();
  lelRenderList();
  lelRenderProps();
  lelRenderToolbarState();
  lelSchedulePreview(true);
}
