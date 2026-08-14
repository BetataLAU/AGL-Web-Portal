// ===== Shipper Role Project - XLS Booking API 路由 =====
// POST /api/xls-booking/upload                       - 上傳 source xls（多檔）
// GET  /api/xls-booking/preview/:uploadId/:fileId/:sheetIndex  - 預覽 sheet
// POST /api/xls-booking/process                      - 啟動非同步工作流程（回傳 jobId）
// GET  /api/xls-booking/status/:jobId                - 輪詢進度（progress % / message / 結果）
// GET  /api/xls-booking/download/:type/:jobId/:name  - 下載產出檔案（report / zip）
// GET  /api/xls-booking/templates                    - 模板狀態檢查

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const crypto = require('crypto');
const ExcelJS = require('exceljs');
const { runWorkflow } = require('../scripts/xls-workflow');

const router = express.Router();

// ===== 路徑設定 =====
const DATA_DIR = path.join(__dirname, '..', 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const WORK_DIR = path.join(DATA_DIR, 'work');
const TEMPLATES_DIR = path.join(DATA_DIR, 'templates');

// 確保目錄存在
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(WORK_DIR, { recursive: true });
fs.mkdirSync(TEMPLATES_DIR, { recursive: true });

// ===== Multer 設定（上傳到 uploads/，保留原檔名） =====
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

// ===== API: 上傳 =====
router.post('/upload', upload.array('files', 20), async (req, res) => {
  try {
    const files = req.files || [];
    if (!files.length) {
      return res.status(400).json({ error: '請上傳至少一個檔案' });
    }
    const uploadId = crypto.randomBytes(8).toString('hex');
    const fileInfos = [];
    for (const f of files) {
      let sheets = [];
      try {
        const { sheets: s } = await parseWorkbook(f.path);
        sheets = s;
      } catch (e) {
        sheets = [];
      }
      fileInfos.push({
        id: f.filename,
        originalName: f.originalname,
        path: f.path,
        sheets,
        parseError: sheets.length ? null : '無法解析（可能不是有效的 Excel 檔案）',
      });
    }
    uploadSessions.set(uploadId, { files: fileInfos });
    res.json({ uploadId, files: fileInfos.map((f) => ({ id: f.id, originalName: f.originalName, sheets: f.sheets, parseError: f.parseError })) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== API: 預覽 sheet =====
router.get('/preview/:uploadId/:fileId/:sheetIndex', async (req, res) => {
  try {
    const { uploadId, fileId, sheetIndex } = req.params;
    const session = uploadSessions.get(uploadId);
    if (!session) return res.status(404).json({ error: '上傳工作階段已過期，請重新上傳' });
    const file = session.files.find((f) => f.id === fileId);
    if (!file) return res.status(404).json({ error: '找不到檔案' });
    const idx = Number(sheetIndex) || 0;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(file.path);
    const ws = wb.worksheets[idx];
    if (!ws) return res.status(404).json({ error: '找不到 sheet' });
    const rows = sheetPreview(ws);
    res.json({ fileName: file.originalName, sheetName: ws.name, rows, rowCount: ws.rowCount, columnCount: ws.columnCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== API: 啟動非同步工作流程 =====
router.post('/process', async (req, res) => {
  try {
    const { uploadId, defs } = req.body || {};
    if (!uploadId || !Array.isArray(defs) || !defs.length) {
      return res.status(400).json({ error: '缺少 uploadId 或欄位定義 defs' });
    }
    const session = uploadSessions.get(uploadId);
    if (!session) return res.status(404).json({ error: '上傳工作階段已過期，請重新上傳' });

    const jobId = crypto.randomBytes(8).toString('hex');
    jobs.set(jobId, { progress: 0, message: '排隊中...', status: 'running', result: null, error: null });

    // 非同步執行，不阻塞回應
    (async () => {
      try {
        const reportTemplate = path.join(TEMPLATES_DIR, 'shipper-role-summary-202608.xlsx');
        const sliTemplate = path.join(TEMPLATES_DIR, 'cainiao-sli-eli-template.xlsm');
        const reportCopy = path.join(WORK_DIR, `report-${crypto.randomBytes(4).toString('hex')}.xlsx`);
        await fsp.copyFile(reportTemplate, reportCopy);

        const result = await runWorkflow({
          files: session.files,
          defs,
          reportTemplate: reportCopy,
          sliTemplate,
          onProgress: (pct, msg) => {
            const job = jobs.get(jobId);
            if (job) { job.progress = pct; job.message = msg; }
          },
        });

        jobs.set(jobId, {
          progress: 100,
          message: '完成！',
          status: 'done',
          result: {
            jobId,
            count: result.count,
            zipPaths: result.zipPaths.map((p) => ({ name: path.basename(p), path: p })),
            reportPath: result.reportPath,
            errors: result.errors,
            fileResults: result.results || [],
          },
          error: null,
        });
      } catch (err) {
        jobs.set(jobId, { progress: -1, message: err.message, status: 'error', result: null, error: err.message });
      }
    })();

    res.json({ jobId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== API: 輪詢進度 =====
router.get('/status/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: '找不到 job' });
  res.json({ progress: job.progress, message: job.message, status: job.status, result: job.result, error: job.error });
});

// ===== API: 下載產出檔案 =====
// /download/:type/:jobId/:name  type = report | zip
router.get('/download/:type/:jobId/:name', async (req, res) => {
  try {
    const { type, jobId, name } = req.params;
    let filePath;
    if (type === 'zip') {
      filePath = path.join(WORK_DIR, jobId, name);
    } else if (type === 'report') {
      filePath = path.join(WORK_DIR, name);
    } else {
      return res.status(400).json({ error: '未知下載類型' });
    }
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: '檔案不存在或已清理' });
    }
    res.download(filePath, path.basename(filePath));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== API: 取得模板資訊 =====
router.get('/templates', async (req, res) => {
  try {
    const reportPath = path.join(TEMPLATES_DIR, 'shipper-role-summary-202608.xlsx');
    const sliPath = path.join(TEMPLATES_DIR, 'cainiao-sli-eli-template.xlsm');
    res.json({
      reportTemplate: { name: 'Shipper role service - Summary 202608.xlsx', exists: fs.existsSync(reportPath) },
      sliEliTemplate: { name: 'Cainiao Booking Template (SI).xlsm', exists: fs.existsSync(sliPath) },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;