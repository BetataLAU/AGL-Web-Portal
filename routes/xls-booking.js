// ===== Shipper Role Project - XLS Booking API 路由 =====
// POST /api/xls-booking/upload                       - 上傳 source xls（多檔）
// GET  /api/xls-booking/preview/:uploadId/:fileId/:sheetIndex  - 預覽 sheet
// POST /api/xls-booking/cnee-preview                 - CNEE 對照區自動抽取 + 比對結果（供 ③ 標準化預覽）
// POST /api/xls-booking/process                      - 啟動非同步工作流程（回傳 jobId）
// GET  /api/xls-booking/status/:jobId                - 輪詢進度（progress % / message / 結果）
// GET  /api/xls-booking/download/:type/:jobId/:name  - 下載產出檔案（report / zip）
// GET  /api/xls-booking/templates                    - 模板狀態檢查
//
// 註：路徑/Multer/session 儲存/讀檔工具已拆至 xls-booking-helpers.js（.clinerule.md：檔案大小控制）

const express = require('express');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const crypto = require('crypto');
const ExcelJS = require('exceljs');
const {
  WORK_DIR,
  TEMPLATES_DIR,
  upload,
  uploadSessions,
  jobs,
  parseWorkbook,
  sheetPreview,
} = require('./xls-booking-helpers');
const { runWorkflow, standardizeRows, extractCneeLookupArea } = require('../scripts/xls-workflow');

const router = express.Router();

// ===== Multer 錯誤統一轉 JSON（預設 Express 錯誤處理回傳 HTML） =====
function uploadFilesMiddleware(req, res, next) {
  upload.array('files', 20)(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: '檔案超過 50MB 上限' });
      }
      return res.status(400).json({ error: err.message || '上傳失敗' });
    }
    next();
  });
}

// ===== API: 上傳 =====
router.post('/upload', uploadFilesMiddleware, async (req, res) => {
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

// ===== API: CNEE 對照區預覽（自動抽取 + 比對結果，供 ③ 標準化預覽顯示） =====
// body: { uploadId, defs }  defs 同 /process 的欄位定義（含 cneeLookup.auto）
// 回傳每檔：{ fileIndex, fileName, blocks, entries:[{mawb, dest, remark, cnee}] }
router.post('/cnee-preview', async (req, res) => {
  try {
    const { uploadId, defs } = req.body || {};
    if (!uploadId || !Array.isArray(defs) || !defs.length) {
      return res.status(400).json({ error: '缺少 uploadId 或欄位定義 defs' });
    }
    const session = uploadSessions.get(uploadId);
    if (!session) return res.status(404).json({ error: '上傳工作階段已過期，請重新上傳' });

    const results = [];
    for (const def of defs) {
      const file = session.files[def.fileIndex];
      if (!file) continue;
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.readFile(file.path);
      const ws = wb.worksheets[def.sheetIndex || 0];
      if (!ws) continue;
      let rows;
      if (Array.isArray(def.editedRows)) {
        // 前端 ② 預覽已編輯的資料（雙擊修改／刪除 CNEE 等），與 ④ 執行時一致
        rows = def.editedRows;
      } else {
        rows = [];
        ws.eachRow((row) => {
          const vals = [];
          for (let c = 1; c <= row.cellCount; c++) vals.push(row.getCell(c).value);
          rows.push(vals);
        });
      }
      const recs = standardizeRows(rows, {
        headerRow: def.headerRow,
        firstDataRow: def.firstDataRow,
        fieldMap: def.fieldMap,
        cneeLookup: def.cneeLookup,
        cneeOverrides: def.cneeOverrides,
      });
      const blocks = extractCneeLookupArea(rows).filter((b) => b.cnee);
      results.push({
        fileIndex: def.fileIndex,
        fileName: file.originalName,
        blocks: blocks.map((b) => ({ key: b.key, cnee: b.cnee })),
        entries: recs.map((r) => ({
          mawb: r.mawb,
          dest: r.dest || '',
          remark: r.remark || '',
          cnee: r.cnee || '',
        })),
      });
    }
    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== API: 啟動非同步工作流程 =====
// 簡單 job 佇列：序列化執行，避免兩個 job 同時改 master 檔而互相覆蓋
let processQueue = Promise.resolve();
function enqueueProcess(task) {
  const run = processQueue.catch(() => {}).then(task);
  processQueue = run.catch(() => {});
  return run;
}

router.post('/process', async (req, res) => {
  try {
    const { uploadId, defs } = req.body || {};
    if (!uploadId || !Array.isArray(defs) || !defs.length) {
      return res.status(400).json({ error: '缺少 uploadId 或欄位定義 defs' });
    }
    const session = uploadSessions.get(uploadId);
    if (!session) return res.status(404).json({ error: '上傳工作階段已過期，請重新上傳' });

    const jobId = crypto.randomBytes(8).toString('hex');
    const controller = new AbortController();
    jobs.set(jobId, { progress: 0, message: '排隊中...', status: 'running', result: null, error: null, controller });

    // 非同步執行，不阻塞回應（以佇列序列化，避免同時改動 master 互相覆蓋）
    enqueueProcess(async () => {
      try {
        const reportTemplate = path.join(TEMPLATES_DIR, 'shipper-role-summary-2026.xlsx');
        const sliTemplate = path.join(TEMPLATES_DIR, 'cainiao-sli-eli-template.xlsm');
        const reportCopy = path.join(WORK_DIR, `report-${crypto.randomBytes(4).toString('hex')}.xlsx`);
        await fsp.copyFile(reportTemplate, reportCopy);

        const result = await runWorkflow({
          files: session.files,
          defs,
          reportTemplate: reportCopy,
          sliTemplate,
          signal: controller.signal,
          onProgress: (pct, msg) => {
            const job = jobs.get(jobId);
            if (job) { job.progress = pct; job.message = msg; }
          },
        });

        // ===== 自動同步：把最新 report 覆寫回 master（下次 run 會包含舊記錄）=====
        let syncWarning = null;
        try {
          if (result.reportPath) {
            await fsp.copyFile(result.reportPath, reportTemplate);
          }
        } catch (syncErr) {
          syncWarning = `Report 已產生，但自動同步回模板失敗：${syncErr.message}。` +
            '請關閉 Excel 中的「shipper-role-summary-2026.xlsx」後再執行，或手動用下載檔取代模板。';
        }

        jobs.set(jobId, {
          progress: 100,
          message: syncWarning ? '完成（但模板同步失敗）' : '完成！',
          status: 'done',
          result: {
            jobId,
            count: result.count,
            zipPaths: result.zipPaths.map((p) => ({ name: path.basename(p), path: p })),
            reportPath: result.reportPath,
            errors: result.errors,
            warnings: result.warnings || [],
            duplicates: result.duplicates || [],
            syncWarning,
            fileResults: result.results || [],
            workDir: result.workDir,
          },
          error: null,
        });
      } catch (err) {
        const aborted = controller.signal.aborted;
        jobs.set(jobId, {
          progress: -1,
          message: aborted ? '已中止' : err.message,
          status: aborted ? 'cancelled' : 'error',
          result: null,
          error: aborted ? '已中止' : err.message,
        });
      }
    });

    res.json({ jobId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ===== API: 中止 job =====
router.post('/cancel/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: '找不到 job' });
  if (job.controller) job.controller.abort();
  job.status = 'cancelled';
  job.message = '已中止';
  job.progress = -1;
  res.json({ ok: true });
});

// ===== API: 輪詢進度 =====
router.get('/status/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: '找不到 job' });
  res.json({ progress: job.progress, message: job.message, status: job.status, result: job.result, error: job.error });
});

// ===== API: 下載產出檔案 =====
// /download/:type/:jobId/:name  type = report | zip
// 安全設計：一律從該 job 的結果中解析實際路徑（擋掉路徑穿越，且 jobId 不可省略）
router.get('/download/:type/:jobId/:name', async (req, res) => {
  try {
    const { type, jobId, name } = req.params;
    const job = jobs.get(jobId);
    let filePath;
    if (type === 'zip') {
      // ZIP 存放在 workflow 建立的 job-XXXXXX 目錄（不是 jobId 目錄），
      // 從 job 結果的 zipPaths 查詢實際路徑
      const zipInfo = ((job && job.result && job.result.zipPaths) || []).find((z) => z.name === name);
      if (zipInfo) filePath = zipInfo.path;
    } else if (type === 'report') {
      // Report 只允許下載該 job 實際產出的 reportPath（basename 必須相符）
      if (job && job.result && job.result.reportPath && path.basename(job.result.reportPath) === name) {
        filePath = job.result.reportPath;
      }
    } else {
      return res.status(400).json({ error: '未知下載類型' });
    }
    if (!filePath || !fs.existsSync(filePath)) {
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
    const reportPath = path.join(TEMPLATES_DIR, 'shipper-role-summary-2026.xlsx');
    const sliPath = path.join(TEMPLATES_DIR, 'cainiao-sli-eli-template.xlsm');
    res.json({
      reportTemplate: { name: 'Shipper role service - Summary 2026.xlsx', exists: fs.existsSync(reportPath) },
      sliEliTemplate: { name: 'Cainiao Booking Template (SI).xlsm', exists: fs.existsSync(sliPath) },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

