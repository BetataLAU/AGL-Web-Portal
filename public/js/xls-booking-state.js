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
  // 點擊其他位置關閉右鍵選單
  document.addEventListener('click', xlsCloseContextMenu);
}
