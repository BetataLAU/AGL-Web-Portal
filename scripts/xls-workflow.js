// ===== Shipper Role Project - XLS 工作流程引擎（主流程） =====
// 功能：標準化資料（standardizeRows）→ 呼叫 report / SLI-ELI / PDF / ZIP 模組 → runWorkflow 主流程
// 依賴（.clinerule.md 拆分後）：
//   xls-utils.js（cleanCell/normalizeMawb/日期/電話/航班）/
//   xls-cnee.js（CNEE 對照區抽取 + 比對）/
//   xls-report.js（writeReport）/
//   xls-sli-eli.js（makeSli/makeEli/xlsxToPdf/mergePdfs/zipFiles/planZipParts）
// 此檔同時 re-export 所有歷史 API，保持 require('../scripts/xls-workflow') 相容。

const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const { execFile } = require('child_process');
const ExcelJS = require('exceljs');
const {
  sleep,
  cleanCell,
  normalizeMawb,
  flightCompany,
  normalizeDate,
  excelSerialToDate,
  formatDdmmyyyy,
  extractTel,
  workbookToXlsx,
} = require('./xls-utils');
const { extractCneeLookupArea, matchCnee, normalizeLookupKey, DEST_COUNTRY_KEYWORDS } = require('./xls-cnee');
const { writeReport } = require('./xls-report');
const {
  loadTemplateCopy,
  makeSli,
  makeEli,
  xlsxToPdf,
  mergePdfs,
  zipFiles,
  planZipParts,
} = require('./xls-sli-eli');

// ===== 路徑設定 =====
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DATA_DIR = process.env.DATA_DIR || path.join(PROJECT_ROOT, 'data');
const TEMPLATE_DIR = path.join(DATA_DIR, 'templates');
const WORK_DIR = path.join(DATA_DIR, 'work');

// 欄位類型定義
const FIELD_TYPES = {
  IGNORE: 'ignore',
  MAWB: 'mawb',
  DEST: 'dest',
  PCS: 'pcs',
  WEIGHT: 'weight',
  BATTERY: 'battery',
  FLIGHT: 'flight',
  FLIGHT_DATE: 'flight_date',
  REMARK: 'remark',
  CNEE_NAME: 'cnee_name',
};

// ===== 標準化資料：依欄位定義抽取 =====

/**
 * 將上傳檔案的 sheet 資料 + 欄位定義轉為標準 MAWB 記錄清單。
 * @param {Array<Array>} rows - sheet 資料（含 header）
 * @param {Object} def - 欄位定義
 */
function standardizeRows(rows, def) {
  const {
    headerRow = 1,
    firstDataRow = 2,
    fieldMap = {},      // { 欄索引(0-based): FIELD_TYPES 值 }
    cneeLookup = null,  // 新版 { enabled, auto } 或舊版 { enabled, destCol, remarkCol, cneeCol, startRow, endRow }
    cneeOverrides = {}, // { mawb: 手動補值 }（前端 ③ 標準化預覽點擊填入）
  } = def;

  const records = [];

  // 解析 CNEE 對照區
  let lookupEntries = [];
  let lookupAuto = false;
  if (cneeLookup && cneeLookup.enabled) {
    if (cneeLookup.auto) {
      // 新版：自動掃描 A/B/C 欄找出 CNEE 對照區
      lookupAuto = true;
      lookupEntries = extractCneeLookupArea(rows).filter((b) => b.cnee);
    } else if (cneeLookup.destCol !== undefined) {
      // 舊版手動模式（保留相容）
      const { destCol, remarkCol, cneeCol, startRow, endRow } = cneeLookup;
      // 掃描對照區，將每列 dest + remark + cnee 收集起來；遇到同 dest 重複時以 remark 標記
      let current = null;
      for (let r = startRow; r <= endRow; r++) {
        const dest = cleanCell(rows[r - 1]?.[destCol]);
        const rem = cleanCell(rows[r - 1]?.[remarkCol]);
        const cnee = cleanCell(rows[r - 1]?.[cneeCol]);
        if (dest) {
          current = { dest: dest.toUpperCase(), remark: rem || '', cnee };
          lookupEntries.push(current);
        } else if (current && current.dest && cnee) {
          // 同一區塊多行 CNEE（如地址續行）→ 累加
          current.cnee = current.cnee ? `${current.cnee}\n${cnee}` : cnee;
        }
      }
    }
  }

  // 主單資料
  for (let r = firstDataRow; r <= rows.length; r++) {
    const row = rows[r - 1];
    if (!row) continue;
    const rec = {};
    let hasAny = false;

    for (const [colIdx, type] of Object.entries(fieldMap)) {
      const ci = Number(colIdx);
      const val = row[ci];
      if (val === null || val === undefined || val === '') continue;
      switch (type) {
        case FIELD_TYPES.MAWB: {
          const m = normalizeMawb(val);
          if (m && /\d{3}-?\d{8}/.test(m)) { rec.mawb = m; hasAny = true; }
          break;
        }
        case FIELD_TYPES.DEST:
          rec.dest = cleanCell(val).toUpperCase();
          break;
        case FIELD_TYPES.PCS: {
          const n = Number(String(val).replace(/[^0-9.]/g, ''));
          if (!isNaN(n) && /[0-9]/.test(String(val))) { rec.pcs = Math.round(n); hasAny = true; }
          break;
        }
        case FIELD_TYPES.WEIGHT: {
          const n = Number(String(val).replace(/[^0-9.]/g, ''));
          if (!isNaN(n) && /[0-9]/.test(String(val))) { rec.weight = Math.round(n * 100) / 100; hasAny = true; }
          break;
        }
        case FIELD_TYPES.BATTERY: {
          const n = Number(String(val).replace(/[^0-9.]/g, ''));
          if (!isNaN(n) && /[0-9]/.test(String(val))) rec.battery = Math.round(n);
          else if (String(cleanCell(val)).toLowerCase().includes('带') || String(cleanCell(val)).toLowerCase().includes('電')) rec.battery = 0;
          break;
        }
        case FIELD_TYPES.FLIGHT:
          rec.flight = cleanCell(val).toUpperCase();
          break;
        case FIELD_TYPES.FLIGHT_DATE: {
          const d = normalizeDate(val);
          if (d) { rec.flightDate = d; hasAny = true; }
          break;
        }
        case FIELD_TYPES.REMARK:
          rec.remark = cleanCell(val);
          break;
        case FIELD_TYPES.CNEE_NAME:
          rec.cnee = cleanCell(val);
          break;
        case FIELD_TYPES.IGNORE:
        default:
          break;
      }
    }

    // 套用 CNEE 對照區（若該列沒有直接 CNEE 欄）
    if (!rec.cnee && lookupEntries.length) {
      if (lookupAuto) {
        // 新版自動模式：REMARK + DEST 加權比對（含國家關鍵字輔助）
        rec.cnee = matchCnee(rec.dest, rec.remark, lookupEntries);
      } else {
        const dest = (rec.dest || '').toUpperCase();
        const remark = (rec.remark || '').toUpperCase();
        // 1) dest 相同 + remark 包含
        let matched = lookupEntries.find((e) => e.dest === dest && remark && e.remark && remark.includes(e.remark.toUpperCase()));
        // 2) dest 相同（第一個，無 remark 優先）
        if (!matched) {
          matched = lookupEntries.find((e) => e.dest === dest && !e.remark);
        }
        if (!matched) {
          matched = lookupEntries.find((e) => e.dest === dest);
        }
        if (matched) rec.cnee = matched.cnee;
      }
    }

    // 套用前端手動補值（③ 標準化預覽點擊填入的 CNEE，優先於對照結果）
    if (rec.mawb && cneeOverrides && cneeOverrides[rec.mawb]) {
      rec.cnee = cneeOverrides[rec.mawb];
    }

    if (!rec.mawb) continue; // 無 MAWB 視為非資料列
    records.push(rec);
  }

  return records;
}

// ===== 主流程 =====

/**
 * 執行完整工作流程。
 * @param {Object} opts
 *   - files: Array<{ originalName, path }>
 *   - defs: Array<{ fileIndex, sheetIndex, headerRow, firstDataRow, fieldMap, cneeLookup }>
 *   - reportTemplate: string (report xlsx 路徑)
 *   - sliTemplate: string (模板 xlsm 路徑)
 * @returns {Promise<{zipPath, reportPath, count, errors}>}
 */
async function runWorkflow(opts) {
  const { files, defs, reportTemplate, sliTemplate, onProgress, signal } = opts;

  const assertActive = () => {
    if (signal && signal.aborted) {
      const e = new Error('已中止');
      e.aborted = true;
      throw e;
    }
  };

  const results = [];
  const errors = [];
  const allRecords = [];
  const cneeWarnings = []; // 缺 CNEE 的 MAWB 警告清單（不阻斷執行）
  const reportProgress = (pct, msg) => {
    if (typeof onProgress === 'function') onProgress(pct, msg);
  };

  // Step 1: 讀取每個檔案，依定義標準化
  reportProgress(3, '開始解析檔案...');
  for (const [i, def] of defs.entries()) {
    assertActive();
    const file = files[def.fileIndex];
    if (!file) {
      errors.push(`檔案索引 ${def.fileIndex} 不存在`);
      continue;
    }
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(file.path);
    const ws = wb.worksheets[def.sheetIndex || 0];
    if (!ws) {
      errors.push(`檔案「${file.originalName}」缺少 sheet ${def.sheetIndex}`);
      continue;
    }
    let rows;
    if (Array.isArray(def.editedRows)) {
      // 前端預覽已編輯的格子資料（含雙擊修改 / 新增刪除平移）
      rows = def.editedRows;
    } else {
      rows = [];
      ws.eachRow((row, rn) => {
        const vals = [];
        for (let c = 1; c <= row.cellCount; c++) {
          vals.push(row.getCell(c).value);
        }
        rows.push(vals);
      });
    }
    let recs = standardizeRows(rows, {
      headerRow: def.headerRow,
      firstDataRow: def.firstDataRow,
      fieldMap: def.fieldMap,
      cneeLookup: def.cneeLookup,
      cneeOverrides: def.cneeOverrides,
    });
    // 只處理「標準化預覽」中被勾選的 MAWB（有 TICK 的才會執行操作）
    if (Array.isArray(def.selectedMawbs)) {
      const sel = new Set(def.selectedMawbs.map((m) => normalizeMawb(m)));
      recs = recs.filter((r) => r.mawb && sel.has(r.mawb));
    }

    // 從 CNEE 內容抽取電話
    recs.forEach((r) => {
      if (r.cnee) {
        r.cneeTel = extractTel(r.cnee);
        r.cnee = r.cnee.replace(/\n+/g, '\n');
      } else {
        r.cneeTel = '';
      }
    });

    // 收集缺 CNEE 的 MAWB（警告清單；SLI/ELI 仍照常產生，CNEE 留空）
    recs.forEach((r) => {
      if (r.mawb && !r.cnee) {
        cneeWarnings.push({ file: file.originalName, mawb: r.mawb, dest: r.dest || '', remark: r.remark || '' });
      }
    });

    recs.forEach((r) => r.sourceFile = file.originalName);
    allRecords.push(...recs);
    results.push({ file: file.originalName, records: recs.length });
  }

  // Step 2: Report 寫入
  reportProgress(15, `解析完成，共 ${allRecords.length} 筆，寫入 Report...`);
  assertActive();
  let reportOut = reportTemplate;
  if (allRecords.length) {
    await writeReport(reportTemplate, allRecords);
  }

  // Step 3: SLI / ELI xlsx + PDF
  await fsp.mkdir(WORK_DIR, { recursive: true });
  assertActive();
  const workDir = await fsp.mkdtemp(path.join(WORK_DIR, 'job-'));
  const sliPdfs = [];
  const eliPdfs = [];
  let pdfCount = 0;

  // 批次呼叫 Excel COM 腳本（一次開工作簿，逐筆填 SLI/ELI 並產出 PDF/xlsx）
  const recordsPayload = [];
  for (const rec of allRecords) {
    if (!rec.mawb) continue;
    const dateStr = rec.flightDate
      ? `${rec.flightDate.getFullYear()}-${String(rec.flightDate.getMonth() + 1).padStart(2, '0')}-${String(rec.flightDate.getDate()).padStart(2, '0')}`
      : '';
    recordsPayload.push({
      mawb: rec.mawb,
      sli: {
        D23: rec.mawb,
        D25: rec.flight ? flightCompany(rec.flight) : '',
        D27: rec.dest || '',
        D9: rec.cnee || '',
        D72: dateStr || new Date().toISOString().slice(0, 10),
      },
      eli: {
        F8: rec.mawb,
        P11: rec.dest || '',
        M16: rec.cnee || '',
        N21: rec.cneeTel || '',
        N57: dateStr || new Date().toISOString().slice(0, 10),
      },
    });
  }

  if (recordsPayload.length) {
    try {
      // 將 payload 寫入暫存 JSON 檔（execFileAsync 不支援 stdin input，改用檔案參數）
      reportProgress(25, `產生 ${recordsPayload.length} 份 SLI/ELI PDF（Excel 轉檔中，0/${recordsPayload.length}）...`);
      const payloadFile = path.join(workDir, 'sli-eli-payload.json');
      await fsp.writeFile(payloadFile, JSON.stringify({ template: sliTemplate, work_dir: workDir, records: recordsPayload }), 'utf-8');
      const py = process.env.PYTHON || 'python';
      const script = path.join(__dirname, 'sli-eli-generate.py');
      // 改用 execFile 即時讀取 Python 的 PROGRESS 輸出，逐筆 MAWB 更新進度條（25% → 80%）
      const NL = String.fromCharCode(10);
      const { stdout, stderr } = await new Promise((resolve, reject) => {
        const child = execFile(py, [script, '--payload', payloadFile], {
          timeout: 600000, // 10 分鐘（大量 MAWB 時）
          maxBuffer: 10 * 1024 * 1024,
        }, (err, so, se) => {
          if (err) {
            reject(new Error((se && se.trim()) ? se.trim() : err.message));
          } else {
            resolve({ stdout: so, stderr: se });
          }
        });
        let buf = '';
        child.stdout.on('data', (chunk) => {
          buf += chunk;
          const lines = buf.split(NL);
          buf = lines.pop();
          for (const line of lines) {
            const lt = line.trim(); // Windows Python 輸出為 CRLF，需去除 \r
            if (lt.indexOf('PROGRESS: ') === 0) {
              const parts = lt.slice('PROGRESS: '.length).split('/');
              const done = Number(parts[0]);
              const tot = Number(parts[1]);
              if (done >= 0 && tot > 0) {
                reportProgress(Math.round(25 + 55 * (done / tot)), `產生 SLI/ELI PDF（${done}/${tot}）...`);
              }
            }
          }
        });
      });
      if (stderr && stderr.includes('ERROR')) {
        throw new Error(`SLI/ELI 產生失敗: ${stderr}`);
      }
      // 收集產出的 PDF
      const okLines = stdout.split('\n').filter((l) => l.startsWith('OK: '));
      pdfCount = okLines.length;
      for (const line of okLines) {
        const mawb = line.replace('OK: ', '').trim();
        const sliPdf = path.join(workDir, `${mawb} SLI.pdf`);
        const eliPdf = path.join(workDir, `${mawb} ELI.pdf`);
        if (fs.existsSync(sliPdf)) sliPdfs.push(sliPdf);
        if (fs.existsSync(eliPdf)) eliPdfs.push(eliPdf);
      }
    } catch (e) {
      errors.push(`SLI/ELI 批次產生失敗: ${e.message}`);
    }
  }

  // Step 4: 合併 SLI+ELI → {MAWB}.pdf，刪除單獨檔
  reportProgress(80, `合併 ${sliPdfs.length} 組 SLI + ELI PDF...`);
  assertActive();
  const mergedPdfs = [];
  for (let i = 0; i < sliPdfs.length; i++) {
    // 依 sliPdfs 檔名取 MAWB
    const m = path.basename(sliPdfs[i]).match(/^(\d{3}-\d{8}) SLI\.pdf$/);
    if (!m) continue;
    const mawb = m[1];
    const mergedPath = path.join(workDir, `${mawb}.pdf`);
    try {
      await mergePdfs([sliPdfs[i], eliPdfs[i]], mergedPath);
      mergedPdfs.push(mergedPath);
      await fsp.unlink(sliPdfs[i]).catch(() => {});
      await fsp.unlink(eliPdfs[i]).catch(() => {});
    } catch (e) {
      errors.push(`MAWB ${mawb} 合併 PDF 失敗: ${e.message}`);
    }
  }

  // Step 5: 依航班分組 zip
  reportProgress(90, '依航班打包 ZIP...');
  assertActive();
  const groups = new Map();
  for (const rec of allRecords) {
    if (!rec.flight) continue;
    if (!groups.has(rec.flight)) groups.set(rec.flight, []);
    const merged = mergedPdfs.find((p) => path.basename(p).startsWith(rec.mawb));
    if (merged) groups.get(rec.flight).push(merged);
  }

  const zipPaths = [];
  const MAX_ZIP_BYTES = 30 * 1024 * 1024; // 每個 ZIP 上限 30MB
  for (const [flight, pdfs] of groups.entries()) {
    if (!pdfs.length) continue;
    const d = allRecords.find((r) => r.flight === flight && r.flightDate);
    const day = d ? formatDdmmyyyy(d.flightDate) : '';
    // 依總大小拆份（超過 30MB 自動多拆），並平均分配檔案
    const chunks = planZipParts(pdfs, MAX_ZIP_BYTES);
    if (chunks.length === 1) {
      const zipName = `${flight}-${day} x ${pdfs.length}.zip`;
      const zipPath = path.join(workDir, zipName);
      await zipFiles(pdfs, zipPath);
      zipPaths.push(zipPath);
      continue;
    }
    for (let pi = 0; pi < chunks.length; pi++) {
      const partPdfs = chunks[pi];
      const zipName = `${flight}-${day} x ${partPdfs.length} (Part ${pi + 1} of ${chunks.length}).zip`;
      const zipPath = path.join(workDir, zipName);
      reportProgress(Math.min(99, 90 + Math.round(9 * ((pi + 1) / chunks.length))), `打包 ZIP（Part ${pi + 1} of ${chunks.length}）...`);
      await zipFiles(partPdfs, zipPath);
      zipPaths.push(zipPath);
    }
  }

  reportProgress(100, '完成！');
  return {
    zipPaths,
    reportPath: reportOut,
    count: pdfCount,
    errors,
    results,   // 每個檔案的處理筆數（套用勾選過濾後）
    warnings: cneeWarnings, // 缺 CNEE 的 MAWB 警告清單
    workDir,
  };
}

module.exports = {
  // 歷史 API（保持 require('../scripts/xls-workflow') 相容，含測試與路由）
  runWorkflow,
  standardizeRows,
  extractCneeLookupArea,
  matchCnee,
  normalizeLookupKey,
  DEST_COUNTRY_KEYWORDS,
  writeReport,
  makeSli,
  makeEli,
  mergePdfs,
  zipFiles,
  planZipParts,
  extractTel,
  normalizeMawb,
  normalizeDate,
  flightCompany,
  FIELD_TYPES,
  // 子模組共用函式（一併 re-export，供外部使用）
  sleep,
  cleanCell,
  excelSerialToDate,
  formatDdmmyyyy,
  loadTemplateCopy,
  xlsxToPdf,
  workbookToXlsx,
};

