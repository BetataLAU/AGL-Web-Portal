// ===== Shipper Role Project - SLI/ELI 版面編輯器（state / 幾何 / API）=====
// 供 sli-eli-layout-editor.js 與 sli-eli-layout-main.js 共用（全域函式，載入順序見 sli-eli-layout.html）
// 座標系與 PDF 相同：pt、原點左上（x 右 / y 下）；底圖為 120dpi 匯出（px = pt × 120/72）

const LEL_API = '/api/xls-booking/layout';

// 與 routes/xls-booking-layout.js 相同的邊界（前端先擋，避免送出後才被退件）
const LEL_LIMITS = {
  boxMinPt: 2, fontMinPt: 4, fontMaxPt: 72, pageTolPt: 2,
  moveStepPt: 0.5, moveStepShiftPt: 10, snapStepPt: 5,
  undoMax: 60,
};

let lelState = {
  loaded: false,
  canEdit: false,
  role: '',
  fieldmap: null,
  defaultFieldmap: null,
  fields: [],            // 工作副本（含未儲存編輯）
  pages: [],
  baseline: { ascentEm: 0.9053, descentEm: 0.2124 },
  samples: [],
  sampleId: 'sample',
  backups: [],
  engineIssue: null,
  updatedAt: null,
  selectedKey: null,
  pageIndex: 0,
  zoom: 1,
  snap: false,
  grid: true,
  pxPerPt: 120 / 72,
  undo: [],
  redo: [],
  dirty: false,
  preview: null,         // 最近一次 /preview 結果（伺服器算的排版）
  previewLoading: false,
  previewError: null,
  pdfBlobUrl: null,
};

// ===== 小工具 =====
function lelClone(o) { return JSON.parse(JSON.stringify(o)); }
function lelRound(v) { return Math.round(v * 100) / 100; }
function lelClamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
function lelEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (m) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]
  ));
}
function lelPage() {
  return lelState.pages[lelState.pageIndex] || lelState.pages[0] || { index: 0, label: 'SLI', widthPt: 595.28, heightPt: 841.89 };
}
function lelFieldsOfPage(i) { return lelState.fields.filter((f) => Number(f.page) === Number(i)); }
function lelField(key) { return lelState.fields.find((f) => f.key === key) || null; }
function lelDefaultField(key) {
  const list = (lelState.defaultFieldmap && lelState.defaultFieldmap.fields) || [];
  return list.find((f) => f.key === key) || null;
}
function lelFieldByPreview(key) {
  const list = (lelState.preview && lelState.preview.fields) || [];
  return list.find((f) => f.key === key) || null;
}

// ===== 推導值（與 routes/xls-booking-layout.js 同一套模型；預覽回來後以伺服器值為準）=====
function lelBaselineOffset(alignV, sizePt) {
  const size = Number(sizePt) > 0 ? Number(sizePt) : 8;
  const { ascentEm, descentEm } = lelState.baseline;
  if (alignV === 'bottom') return lelRound(-descentEm * size);
  if (alignV === 'center') return lelRound(((ascentEm - descentEm) / 2) * size);
  return lelRound(ascentEm * size);
}
function lelLineHeightOf(f) {
  const size = Number(f.font && f.font.sizePt) > 0 ? Number(f.font.sizePt) : 8;
  const lh = Number(f.lineHeightPt);
  return lh > 0 ? lh : lelRound(size * 1.2);
}
/** 本地推導（僅供畫面即時顯示；權威值以 /preview 回傳為準） */
function lelApplyDerived(f) {
  const lh = lelLineHeightOf(f);
  f.lineHeightPt = lh;
  f.textBaselineOffsetPt = lelBaselineOffset(f.align && f.align.v, f.font && f.font.sizePt);
  f.maxLines = f.wrap ? Math.max(1, Math.floor(f.box.h / lh)) : 1;
  return f;
}

// ===== 編輯操作（undo/redo、移動、縮放、對齊）=====
function lelSnapshot() { return JSON.stringify(lelState.fields); }
function lelPushUndo() {
  lelState.undo.push(lelSnapshot());
  if (lelState.undo.length > LEL_LIMITS.undoMax) lelState.undo.shift();
  lelState.redo.length = 0;
  lelState.dirty = true;
}
function lelRestoreSnapshot(snap) {
  if (!snap) return;
  lelState.fields = JSON.parse(snap);
  lelState.dirty = true;
}
function lelUndo() {
  if (!lelState.undo.length) return;
  lelState.redo.push(lelSnapshot());
  lelRestoreSnapshot(lelState.undo.pop());
  lelSchedulePreview(true);
  lelRenderAll();
}
function lelRedo() {
  if (!lelState.redo.length) return;
  lelState.undo.push(lelSnapshot());
  lelRestoreSnapshot(lelState.redo.pop());
  lelSchedulePreview(true);
  lelRenderAll();
}

/** 平移（拖曳）：文字框與文字錨點一起移動 */
function lelMoveField(f, dx, dy) {
  f.box.x = lelRound(f.box.x + dx);
  f.box.y = lelRound(f.box.y + dy);
  f.origin.x = lelRound(f.origin.x + dx);
  f.origin.y = lelRound(f.origin.y + dy);
}

/** 縮放（把手）：調整文字框；文字錨點依對齊比例跟著對應邊移動 */
function lelResizeField(f, dir, dx, dy) {
  const b = f.box;
  let nx = b.x; let ny = b.y; let nw = b.w; let nh = b.h;
  if (dir.indexOf('w') >= 0) { nx = b.x + dx; nw = b.w - dx; }
  if (dir.indexOf('e') >= 0) { nw = b.w + dx; }
  if (dir.indexOf('n') >= 0) { ny = b.y + dy; nh = b.h - dy; }
  if (dir.indexOf('s') >= 0) { nh = b.h + dy; }
  if (nw < LEL_LIMITS.boxMinPt) {
    nw = LEL_LIMITS.boxMinPt;
    if (dir.indexOf('w') >= 0) nx = b.x + b.w - nw;
  }
  if (nh < LEL_LIMITS.boxMinPt) {
    nh = LEL_LIMITS.boxMinPt;
    if (dir.indexOf('n') >= 0) ny = b.y + b.h - nh;
  }
  const ah = f.align.h === 'left' ? 0 : f.align.h === 'center' ? 0.5 : 1;
  const av = f.align.v === 'top' ? 0 : f.align.v === 'center' ? 0.5 : 1;
  f.origin.x = lelRound(f.origin.x + (nx - b.x) + ah * (nw - b.w));
  f.origin.y = lelRound(f.origin.y + (ny - b.y) + av * (nh - b.h));
  const wrapBase = Number.isFinite(f.wrapWidthPt) ? f.wrapWidthPt : b.w;
  f.wrapWidthPt = lelRound(Math.max(1, wrapBase + (nw - b.w)));
  f.box = { x: lelRound(nx), y: lelRound(ny), w: lelRound(nw), h: lelRound(nh) };
  lelApplyDerived(f);
}

/** 對齊工具：重設 origin 在文字框內的水平／垂直錨點位置 */
function lelSetAlign(f, axis, value) {
  if (axis === 'h') {
    const old = f.align.h === 'left' ? 0 : f.align.h === 'center' ? 0.5 : 1;
    const next = value === 'left' ? 0 : value === 'center' ? 0.5 : 1;
    f.align.h = value;
    f.origin.x = lelRound(f.origin.x + (next - old) * f.box.w);
  } else {
    const old = f.align.v === 'top' ? 0 : f.align.v === 'center' ? 0.5 : 1;
    const next = value === 'top' ? 0 : value === 'center' ? 0.5 : 1;
    f.align.v = value;
    f.origin.y = lelRound(f.origin.y + (next - old) * f.box.h);
  }
  lelApplyDerived(f);
}

function lelSnapTo(pt) {
  return lelState.snap ? Math.round(pt / LEL_LIMITS.snapStepPt) * LEL_LIMITS.snapStepPt : pt;
}

/** 前端邊界檢查（與後端規則一致；只做提示，實際以 PUT 回傳為準） */
function lelFieldWarning(f) {
  const p = lelState.pages.find((x) => Number(x.index) === Number(f.page)) || lelPage();
  const tol = LEL_LIMITS.pageTolPt;
  const b = f.box;
  if (b.x < -tol || b.y < -tol || b.x + b.w > p.widthPt + tol || b.y + b.h > p.heightPt + tol) {
    return `文字框超出頁面（${p.label} ${p.widthPt}×${p.heightPt}pt）`;
  }
  if (f.origin.x < -tol || f.origin.y < -tol || f.origin.x > p.widthPt + tol || f.origin.y > p.heightPt + tol) {
    return '文字錨點超出頁面';
  }
  return null;
}

// ===== API =====
/** 送給後端的欄位 patch（只含可編輯屬性；推導值由後端算） */
function lelDraftPatches() {
  return lelState.fields.map((f) => ({
    key: f.key,
    origin: { x: f.origin.x, y: f.origin.y },
    box: { x: f.box.x, y: f.box.y, w: f.box.w, h: f.box.h },
    font: { sizePt: f.font.sizePt, bold: !!f.font.bold, color: f.font.color },
    align: { h: f.align.h, v: f.align.v },
    wrap: !!f.wrap,
    lineHeightPt: f.lineHeightPt,
  }));
}

async function lelLoadConfig() {
  const data = await apiFetch(LEL_API);
  lelState.canEdit = !!data.canEdit;
  lelState.role = data.role || '';
  lelState.fieldmap = data.fieldmap;
  lelState.defaultFieldmap = data.defaultFieldmap || null;
  lelState.fields = lelClone((data.fieldmap && data.fieldmap.fields) || []);
  lelState.pages = (data.fieldmap && data.fieldmap.pages) || [];
  if (data.baselineModel) lelState.baseline = Object.assign({}, lelState.baseline, data.baselineModel);
  lelState.samples = data.samples || [];
  lelState.backups = data.backups || [];
  lelState.engineIssue = data.engineIssue || null;
  lelState.updatedAt = data.updatedAt || null;
  lelState.selectedKey = lelState.fields.length ? lelState.fields[0].key : null;
  lelState.loaded = true;
  return data;
}

async function lelApiSave(keys) {
  const patches = lelDraftPatches().filter((p) => !keys || keys.indexOf(p.key) >= 0);
  return apiFetch(LEL_API, { method: 'PUT', body: JSON.stringify({ fields: patches }) });
}

async function lelApiReset(keys) {
  return apiFetch(`${LEL_API}/reset`, {
    method: 'POST',
    body: JSON.stringify(keys && keys.length ? { keys: keys } : {}),
  });
}

async function lelApiPreview(wantPdf) {
  return apiFetch(`${LEL_API}/preview`, {
    method: 'POST',
    body: JSON.stringify({ fields: lelDraftPatches(), sampleId: lelState.sampleId, wantPdf: !!wantPdf }),
  });
}

/** 把伺服器回傳的權威推導值同步回本地（確保「編輯器看到什麼 == PDF 長什麼」） */
function lelSyncFromPreview(res) {
  if (!res || !Array.isArray(res.fields)) return false;
  let changed = false;
  for (const pf of res.fields) {
    const f = lelField(pf.key);
    if (!f) continue;
    const box = pf.box || f.box;
    const origin = pf.origin || f.origin;
    const same = JSON.stringify([f.box, f.origin, f.lineHeightPt, f.wrapWidthPt, f.maxLines, f.textBaselineOffsetPt, f.font.sizePt])
      === JSON.stringify([box, origin, pf.lineHeightPt, pf.wrapWidthPt, pf.maxLines, pf.textBaselineOffsetPt, pf.sizePt]);
    if (same) continue;
    f.box = { x: box.x, y: box.y, w: box.w, h: box.h };
    f.origin = { x: origin.x, y: origin.y };
    f.lineHeightPt = pf.lineHeightPt;
    f.wrapWidthPt = pf.wrapWidthPt;
    f.maxLines = pf.maxLines;
    f.textBaselineOffsetPt = pf.textBaselineOffsetPt;
    f.font.sizePt = pf.sizePt;
    changed = true;
  }
  return changed;
}

let lelPreviewTimer = null;
/** 排程重新預覽（編輯後 450ms 內合併；immediate=true 立即） */
function lelSchedulePreview(immediate) {
  if (lelPreviewTimer) clearTimeout(lelPreviewTimer);
  lelPreviewTimer = setTimeout(() => {
    lelPreviewTimer = null;
    lelRunPreview(false);
  }, immediate ? 0 : 450);
}

async function lelRunPreview(wantPdf) {
  if (!lelState.loaded) return null;
  lelState.previewLoading = true;
  lelState.previewError = null;
  lelRenderStatus();
  try {
    const res = await lelApiPreview(wantPdf);
    lelState.preview = res;
    lelSyncFromPreview(res);
    return res;
  } catch (err) {
    lelState.previewError = err.message || String(err);
    return null;
  } finally {
    lelState.previewLoading = false;
    lelRenderStatus();
    lelRenderStage();
    lelRenderList();
    lelRenderProps();
  }
}
