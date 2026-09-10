// ===== Shipper Role Project - XLS Booking 前端（state） =====
// 從 xls-booking.js 拆出（.clinerule.md：檔案大小控制）
// 職責：全域常數、狀態（xlsState / xlsCurrentJobId）、通用工具、拖曳上傳與初始化。
// 註：本系列為全域函式（inline onclick 使用），script 載入順序見 index.html。

const XLS_FIELD_TYPES = [
  { value: 'ignore', label: '忽略' },
  { value: 'mawb', label: 'MAWB#' },
  { value: 'dest', label: 'DEST' },
  { value: 'pcs', label: '件數' },
  { value: 'weight', label: '重量' },
  { value: 'battery', label: '帶電件數' },
  { value: 'flight', label: '航班號' },
  { value: 'flight_date', label: '航班日期' },
  { value: 'remark', label: 'REMARK' },
  { value: 'cnee_name', label: 'CNEE 名稱' },
];

let xlsState = {
  uploadId: null,
  files: [],
  defs: [], // 每個檔案一個欄位定義
  selections: {}, // fileIndex -> { all: [mawbKey], selected: Set<mawbKey> }（標準化預覽勾選）
  cneeOverrides: {}, // fileIndex -> { mawbKey: cnee }（③ 標準化預覽點擊填入，不需重新上傳）
  lastRunFiles: [], // 最近一次 ④ 執行涉及的 fileIndex（供「處理下一個檔案」判斷）
  pdfConcurrency: 1, // 每個 job 的 PDF worker 數（1–4；Windows COM 預設穩定模式）
};

let xlsCurrentJobId = null; // 目前執行中的 job（供中止）

// ===== 工具 =====
function xlsEscapeHtml(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, (m) => (
    { '&': '&', '<': '<', '>': '>', '"': '"', "'": '&#39;' }[m]
  ));
}

function xlsCellDisplay(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object' && v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object' && v.richText) return v.richText.map((t) => t.text).join('');
  return String(v);
}

// 標準化 MAWB#（與後端 normalizeMawb 一致，供勾選比對）
function xlsNormMawb(v) {
  const s = String(v == null ? '' : v).trim();
  const m = s.match(/(\d{3})[- ]?(\d{8})/);
  return m ? `${m[1]}-${m[2]}` : s.replace(/[^0-9]/g, '');
}

// ===== Shipper Role 快速捲動操作 =====
// 桌面版實際捲動容器是 .app-layout、手機版是視窗；scrollIntoView 會自動捲動
// 真正可捲動的祖先，因此同一寫法跨裝置通用。
// 注意：.xls-step-nav 是 sticky（top:10px），若目標直接貼齊捲動視窗頂端，
// 標題會被導覽列蓋住。故跳轉前先量測導覽列「實際高度」並設 scroll-margin-top，
// 偏移 = 導覽列高 + 頂距 10px + 間隙 12px（窄螢幕 wrap 成兩行時會自動變大）。
function xlsStickyNavClearance() {
  const nav = document.querySelector('.xls-step-nav');
  const navH = nav ? nav.getBoundingClientRect().height : 0;
  return navH + 10 + 12;
}

// 把指定 element 捲到步驟區（自動避開 sticky 導覽列）；el 傳 DOM element
function xlsScrollToEl(el) {
  if (el && typeof el.scrollIntoView === 'function') {
    el.style.scrollMarginTop = `${xlsStickyNavClearance()}px`;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function xlsScrollToStep(id) {
  xlsScrollToEl(document.getElementById(id));
}

// 找到「上一步未處理」的下一個檔案卡片（跳過本次已執行的與解析失敗的）
function xlsFindNextFileIndex() {
  const files = xlsState.files || [];
  const done = xlsState.lastRunFiles || [];
  for (let i = 0; i < files.length; i++) {
    if (!files[i] || files[i].parseError) continue;
    if (done.indexOf(i) >= 0) continue;
    return i;
  }
  return -1;
}

// 跳到指定檔案的卡片並短暫高亮
function xlsGoToNextFile(index) {
  const i = Number(index);
  const card = document.getElementById(`xls-file-card-${i}`);
  if (card) {
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    card.classList.add('xls-file-card-flash');
    setTimeout(() => card.classList.remove('xls-file-card-flash'), 1600);
  } else {
    xlsScrollToStep('xls-step-1');
  }
}
function setupXlsDropZone() {
  const zone = document.getElementById('xls-drop-zone');
  const input = document.getElementById('xls-file-input');
  if (!zone || !input) return;

  zone.addEventListener('click', () => input.click());
  input.addEventListener('change', () => {
    if (input.files.length) uploadFiles([...input.files]);
    input.value = '';
  });
  ['dragenter', 'dragover'].forEach((evt) => {
    zone.addEventListener(evt, (e) => {
      e.preventDefault();
      zone.classList.add('xls-dragging');
    });
  });
  ['dragleave', 'drop'].forEach((evt) => {
    zone.addEventListener(evt, (e) => {
      e.preventDefault();
      zone.classList.remove('xls-dragging');
    });
  });
  zone.addEventListener('drop', (e) => {
    if (e.dataTransfer.files.length) uploadFiles([...e.dataTransfer.files]);
  });
}

// ===== 初始化 =====
function setupXlsBookingSection() {
  setupXlsDropZone();
  const runBtn = document.getElementById('xls-run-btn');
  if (runBtn) runBtn.addEventListener('click', runXlsWorkflow);
  const concurrency = document.getElementById('xls-concurrency');
  if (concurrency) {
    concurrency.value = String(xlsState.pdfConcurrency);
    concurrency.addEventListener('change', () => {
      xlsState.pdfConcurrency = Math.min(4, Math.max(1, Number(concurrency.value) || 2));
    });
  }
  const cleanupPreviewBtn = document.getElementById('xls-cleanup-preview-btn');
  if (cleanupPreviewBtn) cleanupPreviewBtn.addEventListener('click', () => xlsCleanupResources(true));
  const cleanupRunBtn = document.getElementById('xls-cleanup-run-btn');
  if (cleanupRunBtn) cleanupRunBtn.addEventListener('click', () => xlsCleanupResources(false));
  // 點擊其他位置關閉右鍵選單
  document.addEventListener('click', xlsCloseContextMenu);
}
