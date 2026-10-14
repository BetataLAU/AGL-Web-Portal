// ===== Shipper Role Project - SLI/ELI 版面編輯器（入口與動作）=====
// 依賴 sli-eli-layout-state.js（state/API）與 sli-eli-layout-editor.js（DOM/互動）

function lelFlash(msg, isError) {
  const el = lelEl('lel-action-msg');
  if (!el) return;
  el.textContent = msg;
  el.className = `lel-chip ${isError ? 'lel-chip-warn' : 'lel-chip-ok'}`;
  el.style.display = '';
  clearTimeout(lelFlash._t);
  lelFlash._t = setTimeout(() => { el.style.display = 'none'; }, 4000);
}

/** 依底圖實際像素寬換算 px/pt（120dpi 匯出 → 約 1.6678） */
function lelSyncPxPerPt() {
  return new Promise((resolve) => {
    const img = document.querySelector('#lel-stage img.lel-bg');
    const page = lelPage();
    if (!img || !page.widthPt) return resolve();
    const apply = () => {
      if (img.naturalWidth) {
        lelState.pxPerPt = img.naturalWidth / page.widthPt;
        lelRenderStage();
      }
      resolve();
    };
    if (img.complete && img.naturalWidth) apply();
    else {
      img.addEventListener('load', apply, { once: true });
      img.addEventListener('error', () => resolve(), { once: true });
    }
  });
}

function lelUpdateSampleOptions() {
  const sel = lelEl('lel-sample');
  if (!sel) return;
  sel.innerHTML = lelState.samples.map((s) => (
    `<option value="${lelEsc(s.id)}"${String(s.id) === String(lelState.sampleId) ? ' selected' : ''}>`
    + `${lelEsc(s.label)}${s.latin1 ? '' : '（含非 Latin-1）'}</option>`
  )).join('');
}

function lelRenderBackups() {
  const box = lelEl('lel-backups');
  if (!box) return;
  if (!lelState.backups.length) {
    box.innerHTML = '<span class="lel-hint">尚無備份（每次儲存／還原都會自動備份）</span>';
    return;
  }
  box.innerHTML = lelState.backups.slice(0, 5).map((b) => (
    `<div class="lel-hint">${lelEsc(b.name)} · ${(b.bytes / 1024).toFixed(1)} KB · ${lelEsc(b.time || b.mtime || '')}</div>`
  )).join('');
}

function lelShowModal(html, withFrame) {
  lelCloseModal();
  const wrap = document.createElement('div');
  wrap.className = 'lel-modal-overlay';
  wrap.id = 'lel-modal';
  wrap.innerHTML = `<div class="lel-modal">
    <div class="lel-modal-head"><strong>測試 PDF 預覽</strong>
      <span><span id="lel-modal-meta" style="font-size:0.78rem;color:#64748b"></span>
      <button type="button" class="lel-btn" id="lel-modal-download" style="display:none">⬇️ 下載</button>
      <button type="button" class="lel-btn" id="lel-modal-close">關閉</button></span>
    </div>
    <div class="lel-modal-body">${withFrame ? `<iframe id="lel-modal-frame" src="${html}"></iframe>` : `<div class="lel-modal-msg">${html}</div>`}</div>
  </div>`;
  document.body.appendChild(wrap);
  const close = lelEl('lel-modal-close');
  if (close) close.addEventListener('click', lelCloseModal);
  wrap.addEventListener('click', (e) => { if (e.target === wrap) lelCloseModal(); });
}

function lelModalMeta(text) {
  const el = lelEl('lel-modal-meta');
  if (el) el.textContent = text;
}

function lelSetupModalDownload(url, name) {
  const btn = lelEl('lel-modal-download');
  if (!btn) return;
  btn.style.display = '';
  btn.addEventListener('click', () => {
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  });
}

function lelCloseModal() {
  const m = lelEl('lel-modal');
  if (m) m.remove();
}


// ===== 動作：儲存 / 還原 / 測試 PDF =====
async function lelSave() {
  if (!lelState.canEdit) {
    lelFlash('目前角色無儲存權限（需 admin 或 staff）', true);
    return;
  }
  const selected = lelState.selectedKey;
  const btn = lelEl('lel-save');
  if (btn) btn.disabled = true;
  lelFlash('儲存中…');
  try {
    const res = await lelApiSave();
    if (res.changed && res.changed.length) {
      lelFlash(`已儲存 ${res.changed.length} 個欄位${res.backup ? `（備份：${res.backup}）` : ''}`);
    } else {
      lelFlash(res.message || '沒有變更');
    }
    await lelLoadConfig();               // 重新取得權威值（含 editedAt / 備份清單）
    if (selected && lelField(selected)) lelState.selectedKey = selected;
    lelUpdateSampleOptions();
    lelRenderAll();
    lelRenderBackups();
    await lelRunPreview(false);
    lelState.dirty = false;
  } catch (err) {
    lelFlash(`儲存失敗：${err.message}`, true);
  } finally {
    lelRenderToolbarState();
  }
}

/** 還原單一欄位（只還原草稿，需再按「儲存」寫入） */
function lelResetOne(key) {
  if (!lelState.canEdit) return;
  const d = lelDefaultField(key);
  const f = lelField(key);
  if (!d || !f) { lelFlash('找不到此欄位的預設值', true); return; }
  lelPushUndo();
  Object.assign(f, lelClone(d));
  lelState.selectedKey = key;
  lelRenderAll();
  lelSchedulePreview(true);
  lelFlash('已還原此欄位（尚未儲存，請按「💾 儲存」寫入）');
}

/** 還原全部欄位（立即寫檔 + 自動備份） */
async function lelResetAll() {
  if (!lelState.canEdit) return;
  if (!window.confirm('要把所有欄位還原成 Excel 校準預設值嗎？（會立即寫檔，並自動備份目前的設定）')) return;
  try {
    const res = await lelApiReset(null);
    lelFlash(`已還原 ${res.changed.length} 個欄位${res.backup ? `（備份：${res.backup}）` : ''}`);
    await lelLoadConfig();
    lelUpdateSampleOptions();
    lelRenderAll();
    lelRenderBackups();
    await lelRunPreview(false);
  } catch (err) {
    lelFlash(`還原失敗：${err.message}`, true);
  }
}

/** 產生測試 PDF（用目前草稿 + 選定樣本）並開啟預覽 */
async function lelTestPdf() {
  const btn = lelEl('lel-test-pdf');
  if (btn) btn.disabled = true;
  lelShowModal('正在產生測試 PDF…');
  try {
    const res = await lelApiPreview(true);
    lelState.preview = res;
    lelSyncFromPreview(res);
    if (!res.renderable) {
      const chars = res.fallback ? res.fallback.unsupported.map((u) => u.sample || u.label).join('、') : '';
      const why = res.fallback && res.fallback.message ? res.fallback.message : '此樣本含無法輸出的字元。';
      lelShowModal(`${lelEsc(why)}<br>字元：${lelEsc(chars)}<br>正式流程會自動退回 Excel 引擎；請改用「內建範例資料」或其他樣本。`);
      return;
    }
    if (!res.pdf) { lelShowModal('引擎未回傳 PDF（請檢查 data/templates/sli-eli-blank.pdf）'); return; }
    const bin = atob(res.pdf.base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const blob = new Blob([bytes], { type: 'application/pdf' });
    if (lelState.pdfBlobUrl) URL.revokeObjectURL(lelState.pdfBlobUrl);
    lelState.pdfBlobUrl = URL.createObjectURL(blob);
    lelShowModal(lelState.pdfBlobUrl, true);
    lelModalMeta(`${res.sample.label} · ${(res.pdf.bytes / 1024).toFixed(1)} KB · ${res.pdf.ms} ms · ${res.usedDraft ? '使用目前編輯' : '使用已儲存設定'}`);
    lelSetupModalDownload(lelState.pdfBlobUrl, `sli-eli-layout-test-${res.sample.mawb}.pdf`);
  } catch (err) {
    lelShowModal(`產生失敗：${lelEsc(err.message)}`);
  } finally {
    if (btn) btn.disabled = false;
    lelRenderStage();
    lelRenderList();

// ===== UI 綁定 =====
function lelBindUi() {
  const tabs = lelEl('lel-page-tabs');
  if (tabs) {
    tabs.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-page]');
      if (!btn) return;
      lelState.pageIndex = Number(btn.getAttribute('data-page')) || 0;
      lelRenderAll();
      lelSyncPxPerPt();
    });
  }
  const list = lelEl('lel-field-list');
  if (list) {
    list.addEventListener('click', (e) => {
      const btn = e.target.closest('.lel-list-item');
      if (!btn) return;
      const key = btn.getAttribute('data-key');
      const f = lelField(key);
      lelSelectField(key);
      if (f && Number(f.page) !== Number(lelState.pageIndex)) {
        lelState.pageIndex = Number(f.page);
        lelRenderAll();
        lelSyncPxPerPt();
      }
    });
  }
  const stage = lelEl('lel-stage');
  if (stage) stage.addEventListener('pointerdown', lelStagePointerDown);

  const sample = lelEl('lel-sample');
  if (sample) {
    sample.addEventListener('change', () => {
      lelState.sampleId = sample.value;
      lelRunPreview(false);
    });
  }
  const zoom = lelEl('lel-zoom');
  if (zoom) {
    zoom.addEventListener('change', () => {
      lelState.zoom = Number(zoom.value) || 1;
      lelRenderStage();
      lelSyncPxPerPt();
    });
  }
  const snap = lelEl('lel-snap');
  if (snap) snap.addEventListener('click', () => { lelState.snap = !lelState.snap; lelRenderToolbarState(); });
  const grid = lelEl('lel-grid');
  if (grid) grid.addEventListener('click', () => { lelState.grid = !lelState.grid; lelRenderStage(); lelRenderToolbarState(); });
  const undo = lelEl('lel-undo');
  if (undo) undo.addEventListener('click', lelUndo);
  const redo = lelEl('lel-redo');
  if (redo) redo.addEventListener('click', lelRedo);
  const save = lelEl('lel-save');
  if (save) save.addEventListener('click', lelSave);
  const resetAll = lelEl('lel-reset-all');
  if (resetAll) resetAll.addEventListener('click', lelResetAll);
  const testPdf = lelEl('lel-test-pdf');
  if (testPdf) testPdf.addEventListener('click', lelTestPdf);

  const alignMap = {
    'lel-align-left': ['h', 'left'], 'lel-align-center': ['h', 'center'], 'lel-align-right': ['h', 'right'],
    'lel-align-top': ['v', 'top'], 'lel-align-middle': ['v', 'center'], 'lel-align-bottom': ['v', 'bottom'],
  };
  Object.keys(alignMap).forEach((id) => {
    const el = lelEl(id);
    if (el) {
      el.addEventListener('click', () => {
        const pair = alignMap[id];
        lelApplyProp((x) => lelSetAlign(x, pair[0], pair[1]));
      });
    }
  });

  document.addEventListener('keydown', lelKeydown);
  window.addEventListener('beforeunload', (e) => {
    if (!lelState.dirty) return;
    e.preventDefault();
    e.returnValue = '';
  });
}

// ===== 入口 =====
async function lelInit() {
  try {
    await lelLoadConfig();
    const zoom = lelEl('lel-zoom');
    if (zoom) lelState.zoom = Number(zoom.value) || 1;
    lelBindUi();
    lelUpdateSampleOptions();
    lelRenderAll();
    lelRenderBackups();
    if (lelState.engineIssue) lelFlash(`引擎警告：${lelState.engineIssue}`, true);
    await lelSyncPxPerPt();
    await lelRunPreview(false);
    lelRenderBackups();
  } catch (err) {
    lelFlash(`載入失敗：${err.message}`, true);
    const status = lelEl('lel-status');
    if (status) status.innerHTML = `<span class="lel-status-err">載入失敗：${lelEsc(err.message)}</span>`;
  }
}

document.addEventListener('DOMContentLoaded', lelInit);

    lelRenderProps();
    lelRenderToolbarState();
  }
}
