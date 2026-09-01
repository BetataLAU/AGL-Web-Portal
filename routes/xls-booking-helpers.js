// ===== Shipper Role Project - XLS Booking 路由共用輔助 =====
// 從 routes/xls-booking.js 拆出（.clinerule.md：檔案大小控制）
// 職責：路徑設定、Multer 上傳設定、upload session / job 記憶體儲存、Excel 讀檔與預覽工具。

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const ExcelJS = require('exceljs');

// ===== 路徑設定 =====
// DATA_DIR 可由環境變數覆寫（Railway：指向持久 Volume），本地維持 data/ 路徑
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const WORK_DIR = path.join(DATA_DIR, 'work');
const TEMPLATES_DIR = path.join(DATA_DIR, 'templates');

// 確保目錄存在
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(WORK_DIR, { recursive: true });
fs.mkdirSync(TEMPLATES_DIR, { recursive: true });

// ===== Multer 設定（上傳到 uploads/，隨機檔名保留副檔名） =====
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const id = crypto.randomBytes(6).toString('hex');
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${id}${ext}`);
  },
});
const upload = multer({
  storage,
  defParamCharset: 'utf8', // 正確解碼中文（簡體/繁體）檔名，避免亂碼
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.xls', '.xlsx', '.xlsm'].includes(ext)) cb(null, true);
    else cb(new Error('只支援 .xls / .xlsx / .xlsm 檔案'));
  },
});

// 記憶 upload session（簡單記憶體暫存，重啟即清空）
const uploadSessions = new Map(); // uploadId -> { files: [{id, originalName, path, sheets}] }
// 非同步 job 狀態（jobId -> { progress, message, status, result, error }）
const jobs = new Map();

// ===== 讀取 xls 檔案的 sheet 清單與預覽 =====
async function parseWorkbook(filePath) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const sheets = wb.worksheets.map((ws, idx) => ({
    index: idx,
    name: ws.name,
    rowCount: ws.rowCount,
    columnCount: ws.columnCount,
  }));
  return { wb, sheets };
}

// 預覽最多顯示 100 欄（涵蓋 CX 檔案的 AH/AI/AJ/AK 等後段欄位；實際欄數上限為 16384）
function sheetPreview(ws, maxRows = 100, maxCols = 100) {
  const rows = [];
  ws.eachRow((row, rn) => {
    if (rn > maxRows) return;
    const vals = [];
    for (let c = 1; c <= Math.min(row.cellCount, maxCols); c++) {
      let v = row.getCell(c).value;
      if (v && typeof v === 'object' && v instanceof Date) {
        v = v.toISOString().slice(0, 10);
      } else if (v && typeof v === 'object' && v.richText) {
        v = v.richText.map((t) => t.text).join('');
      }
      vals.push(v);
    }
    rows.push(vals);
  });
  return rows;
}

module.exports = {
  DATA_DIR,
  UPLOAD_DIR,
  WORK_DIR,
  TEMPLATES_DIR,
  upload,
  uploadSessions,
  jobs,
  parseWorkbook,
  sheetPreview,
};
