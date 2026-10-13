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
// OOM 防護：須早於任何 ExcelJS 讀檔載入（WPS 檔的 defined-name 巨量範圍會吃爆記憶體，詳見模組註解）
require('./xls-exceljs-guard');
const ExcelJS = require('exceljs');
const {
  sleep,
  cleanCell,
  normalizeMawb,
  flightCompany,
  normalizeDate,
  excelSerialToDate,
  formatDdmmyyyy,
  formatYyyymmdd,
  extractTel,
  workbookToXlsx,
  sanitizeFileLabel,
} = require('./xls-utils');
const { extractCneeLookupArea, matchCnee, normalizeLookupKey, DEST_COUNTRY_KEYWORDS } = require('./xls-cnee');
const { writeReport } = require('./xls-report');
const {
  resolvePython,
  ensurePythonModule,
  loadTemplateCopy,
  makeSli,
  makeEli,
  xlsxToPdf,
  mergePdfs,
  readPdfPageSizes,
  normalizePdfToA4,
  optimizePdfFontsInPlace,
  zipFiles,
  planZipParts,
} = require('./xls-sli-eli');

// ===== 路徑設定 =====
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DATA_DIR = process.env.DATA_DIR || path.join(PROJECT_ROOT, 'data');
const TEMPLATE_DIR = path.join(DATA_DIR, 'templates');
const WORK_DIR = path.join(DATA_DIR, 'work');

function getPdfConcurrency(recordCount, configuredValue = null) {
  const configured = Number(configuredValue || process.env.XLS_PDF_CONCURRENCY || 2);
  const requested = Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : 2;
  return Math.min(Math.max(1, requested), 4, recordCount);
}

// ===== PDF 產生引擎（P4）=====
// XLS_PDF_ENGINE=overlay|com；未設定＝com（＝100% 舊行為）。呼叫端亦可用 opts.pdfEngine 覆寫。
//   com     ：Step 3（Excel COM 產生 SLI/ELI PDF）→ Step 4（merge／A4 正規化）→ Step 4.5（字型優化）
//   overlay ：可疊字的記錄用 sli-eli-overlay 直接寫出 {MAWB}.pdf（跳過 Step 3/4/4.5）；
//             非 Latin-1 或任何例外（背景／fieldmap 缺失、sha 不符、render 失敗）退回該筆的 com 路徑。
function resolvePdfEngineMode(requested) {
  const raw = String(requested || process.env.XLS_PDF_ENGINE || 'com').trim().toLowerCase();
  return raw === 'overlay' ? 'overlay' : 'com';
}

function terminatePdfWorker(child) {
  if (!child || child.killed) return;
  // 子程序已結束就不要再 taskkill（PID 可能已被系統回收給其他程序，誤殺會更嚴重）
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32' && child.pid) {
    execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {});
  } else {
    child.kill('SIGTERM');
  }
}

/**
 * 併行執行 PDF worker（依 shard 切分）。
 * 回傳 { outputs, failures }：
 *   - outputs：每個成功 worker 的 stdout（含 `OK: {MAWB}` / `PROGRESS: i/N` / `FAIL: …`）
 *   - failures：仍失敗的 worker（保留 stdout，避免已產出的 PDF 被整批丟棄）
 * 設計：單一 worker 失敗不再中斷其他 worker；失敗的 shard 會自動再排一次（換新 Excel 實例重試）。
 */
async function runPdfWorkers({ py, script, payloadFile, workDir, recordCount, concurrency, signal, onProgress, paperMode }) {
  const workerCount = getPdfConcurrency(recordCount, concurrency);
  const children = new Set();
  const outputs = [];
  const failures = [];
  let completed = 0;
  let aborted = false;
  const abortHandler = () => {
    aborted = true;
    for (const child of children) terminatePdfWorker(child);
  };
  if (signal) signal.addEventListener('abort', abortHandler, { once: true });

  const runWorker = (shardIndex) => new Promise((resolve, reject) => {
    const child = execFile(py, [
      script,
      '--payload', payloadFile,
      '--shard-index', String(shardIndex),
      '--shard-total', String(workerCount),
      '--lo-profile', path.join(workDir, `lo-profile-${shardIndex}`),
      '--paper', paperMode || 'a4',
    ], {
      timeout: 600000,
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true,
    }, (err, stdout, stderr) => {
      if (err) terminatePdfWorker(child);
      children.delete(child);
      const attach = (failure) => {
        failure.stdout = stdout || '';
        failure.stderr = stderr || '';
        failure.shardIndex = shardIndex;
        return failure;
      };
      if (err) {
        const details = [
          stderr && stderr.trim(),
          `exitCode=${err.code == null ? 'null' : err.code}`,
          `signal=${err.signal || 'none'}`,
          stdout && stdout.trim() ? `workerOutput=${stdout.trim().slice(-600)}` : '',
        ].filter(Boolean).join(' | ');
        reject(attach(new Error(details || err.message)));
        return;
      }
      if (stderr && stderr.includes('ERROR')) {
        reject(attach(new Error(`SLI/ELI 產生失敗: ${stderr.trim()}`)));
        return;
      }
      resolve(stdout);
    });
    children.add(child);

    let buffer = '';
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        const text = line.trim();
        if (!text.startsWith('PROGRESS: ')) continue;
        const parts = text.slice('PROGRESS: '.length).split('/');
        const done = Number(parts[0]);
        const total = Number(parts[1]);
        if (done >= 0 && total > 0) {
          const shardCompleted = Math.min(done, total);
          const overall = completed + shardCompleted;
          onProgress(
            Math.round(25 + 55 * (Math.min(overall, recordCount) / recordCount)),
            `產生 SLI/ELI PDF（${Math.min(overall, recordCount)}/${recordCount}，${workerCount} workers）...`
          );
        }
      }
    });
  });

  // 每個 shard 先排一次；失敗的 shard 再排一次（換新的 Python/Excel 實例重試）
  const MAX_SHARD_ATTEMPTS = 2;
  const queue = [];
  for (let i = 1; i <= workerCount; i++) queue.push({ shardIndex: i, attempt: 1 });

  const workerLoop = async () => {
    while (queue.length) {
      if (aborted || (signal && signal.aborted)) throw new Error('已中止');
      const task = queue.shift();
      const shardRecords = Math.floor((recordCount - task.shardIndex) / workerCount) + 1;
      try {
        outputs.push(await runWorker(task.shardIndex));
      } catch (err) {
        if (aborted || (signal && signal.aborted)) throw err;
        if (err.stdout) outputs.push(err.stdout); // 保留該 worker 已產出的 OK 行
        if (task.attempt < MAX_SHARD_ATTEMPTS) {
          queue.push({ shardIndex: task.shardIndex, attempt: task.attempt + 1 });
        } else {
          failures.push({ shardIndex: task.shardIndex, attempt: task.attempt, message: err.message });
        }
      }
      if (task.attempt === 1) {
        completed += shardRecords;
        onProgress(
          Math.round(25 + 55 * (Math.min(completed, recordCount) / recordCount)),
          `產生 SLI/ELI PDF（${Math.min(completed, recordCount)}/${recordCount}，${workerCount} workers）...`
        );
      }
    }
  };

  try {
    await Promise.all(Array.from({ length: workerCount }, () => workerLoop()));
  } finally {
    if (signal) signal.removeEventListener('abort', abortHandler);
  }
  return { outputs, failures };
}

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

/**
 * 偵測一批標準化記錄中的重覆 MAWB（同一 MAWB 出現 2 次或以上）。
 * 只偵測、不阻斷：回傳警告清單供前端顯示，資料照樣處理。
 * @param {Array<{mawb?:string, dest?:string, sourceFile?:string}>} records
 * @returns {Array<{mawb:string, dest:string, count:number, files:string[]}>}
 */
function findDuplicateMawbs(records) {
  const dupMap = new Map(); // mawb -> { mawb, dest, count, files:Set }
  for (const rec of records || []) {
    if (!rec || !rec.mawb) continue;
    const m = normalizeMawb(rec.mawb) || rec.mawb;
    if (!dupMap.has(m)) dupMap.set(m, { mawb: m, dest: rec.dest || '', count: 0, files: new Set() });
    const entry = dupMap.get(m);
    entry.count += 1;
    if (rec.sourceFile) entry.files.add(rec.sourceFile);
  }
  const duplicates = [];
  for (const entry of dupMap.values()) {
    if (entry.count > 1) {
      duplicates.push({ mawb: entry.mawb, dest: entry.dest, count: entry.count, files: Array.from(entry.files) });
    }
  }
  return duplicates;
}

/**
 * 依「航班日期」把合併好的 PDF 分組（同一天所有航班合併為一組；超過 30MB 才由呼叫端拆 Part）。
 * 缺航班日期的記錄退回以單一航班自成一群。
 * @param {Array<{flight?:string, flightDate?:Date, mawb?:string}>} allRecords
 * @param {string[]} mergedPdfs 已合併的 {MAWB}.pdf 路徑清單
 * @returns {Array<{day:string, flights:Set<string>, pdfs:string[]}>}
 */
function planDateGroups(allRecords, mergedPdfs) {
  const groups = new Map(); // key -> { day, flights:Set, pdfs:[] }
  for (const rec of allRecords || []) {
    if (!rec || !rec.flight) continue;
    const merged = (mergedPdfs || []).find((p) => path.basename(p).startsWith(rec.mawb));
    if (!merged) continue;
    let key;
    let day = '';
    if (rec.flightDate) {
      day = formatYyyymmdd(rec.flightDate);
      key = `d:${day}`;
    } else {
      key = `f:${rec.flight}`;
    }
    if (!groups.has(key)) groups.set(key, { day, flights: new Set(), flightCompanies: new Set(), pdfs: [] });
    const grp = groups.get(key);
    grp.flights.add(rec.flight);
    grp.flightCompanies.add(flightCompany(rec.flight));
    grp.pdfs.push(merged);
  }
  return Array.from(groups.values());
}

/**
 * 由分組決定 ZIP 檔名的「基礎」（不含 `SLI x N.zip` 後綴）。
 * 檔名一律經過 sanitizeFileLabel：來源的航班欄位常是 `5Y8050/ 13th Oct`，
 * 內含 `/`（Windows 非法且會被當路徑分隔）→ 直接組檔名會 ENOENT（實測案例見 xls-utils 註解）。
 * @param {{day?:string, flights:Set<string>, flightCompanies?:Set<string>}} grp
 * @returns {string} 例：`20261013 - 5Y8050- 13th Oct`／`20260803 - CX257`／`CX+5Y多航班`
 */
function zipBaseName(grp) {
  const flights = grp && grp.flights ? grp.flights : new Set();
  const companies = (grp && grp.flightCompanies) || new Set();
  const single = flights.size === 1;
  const multiLabel = Array.from(companies).sort().join('+');
  const label = single
    ? flights.values().next().value
    : `${multiLabel}多航班`;
  const safe = sanitizeFileLabel(label, { fallback: '航班未定' });
  return grp && grp.day ? `${grp.day} - ${safe}` : safe;
}

// ===== 主流程 =====

/**
 * 執行完整工作流程。
 * @param {Object} opts
 *   - files: Array<{ originalName, path }>
 *   - defs: Array<{ fileIndex, sheetIndex, headerRow, firstDataRow, fieldMap, cneeLookup }>
 *   - reportTemplate: string (report xlsx 路徑)
 *   - sliTemplate: string (模板 xlsm 路徑)
 *   - pdfEngine: 'overlay' | 'com'（選填；未給則用 XLS_PDF_ENGINE 環境變數，再無則 'com'）
 * @returns {Promise<{zipPath, reportPath, count, errors, engine, fallbackCount}>}
 */
async function runWorkflow(opts) {
  const { files, defs, reportTemplate, sliTemplate, concurrency, onProgress, signal } = opts;

  // ===== P4：PDF 產生引擎分派 =====
  // overlay 模式：可疊字的記錄直接 engine.render() 寫出 {MAWB}.pdf（跳過 Step 3/4/4.5）；
  // 非 Latin-1（CNEE 中文／全形標點）或任何例外的記錄自動退回舊 Excel COM 路徑（同批可混合）。
  const engineMode = resolvePdfEngineMode(opts.pdfEngine);
  const engineReport = {
    mode: engineMode,      // 本次實際使用的引擎（'overlay' | 'com'）
    overlay: 0,            // 疊字引擎成功產出的份數
    com: 0,                // 走 Excel COM 路徑的份數（含退回）
    fallbackCount: 0,      // 因故退回舊引擎的份數
    fallbackReasons: [],   // [{ mawb, chars }]（非 Latin-1 或引擎不可用）
    overlayMs: 0,          // 疊字渲染總耗時
  };

  // ===== 紙張設定（A4 修正）=====
  // 預設 a4：Python 端強制 A4 直式 + FitToPage；custom：維持模板原設定（＝舊行為）。
  // 產出後以 pdf-lib 實測每頁尺寸回報（量測失敗不影響產出；不符只警示不中斷）。
  const paperMode = String(process.env.PDF_PAPER || 'a4').toLowerCase() === 'custom' ? 'custom' : 'a4';
  const A4_SIZE = { width: 595.28, height: 841.89 };
  const PAPER_TOLERANCE_PT = 2;
  const paperReport = { mode: paperMode, measured: null, ok: true, issues: [] };
  const describeSizes = (sizes) => sizes.map((s) => `${s.width.toFixed(1)}x${s.height.toFixed(1)}`).join(' / ');
  const verifyMergedPaper = async (filePath, mawb) => {
    try {
      const sizes = await readPdfPageSizes(filePath);
      if (!paperReport.measured) paperReport.measured = describeSizes(sizes);
      if (paperMode !== 'a4') return;
      const offSpec = sizes.filter((s) => Math.abs(s.width - A4_SIZE.width) > PAPER_TOLERANCE_PT
        || Math.abs(s.height - A4_SIZE.height) > PAPER_TOLERANCE_PT);
      if (sizes.length !== 2 || offSpec.length) {
        paperReport.ok = false;
        const msg = `MAWB ${mawb} 紙張非 A4（實測 ${describeSizes(sizes)}，頁數 ${sizes.length}）`;
        if (!paperReport.issues.includes(msg)) paperReport.issues.push(msg);
      }
    } catch (e) {
      // 量測失敗不影響產出（僅無法驗證紙張）
    }
  };

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

  // Step 1.5: 偵測重覆 MAWB（不阻斷執行；供執行結果顯示警告清單）
  const duplicates = findDuplicateMawbs(allRecords);

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
  const pdfPairs = []; // [{ mawb, sli, eli }]（依 MAWB 配對，避免任何一筆缺檔造成後續全部錯位）
  const mergedPdfs = []; // 最終 {MAWB}.pdf（overlay 直接寫入；com 由 Step 4 合併寫入）
  const overlayPdfPaths = new Set(); // 由疊字引擎產出的檔案（Step 4.5 只對「退回舊引擎」的檔案瘦身）
  let pdfCount = 0;

  // 逐筆 payload（兩條引擎共用同一份格式：overlay 依 sli/eli 格號疊字，com 交給 Python 填表）
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

  // ===== 引擎分派（P4）：overlay 先直接疊字，其餘（含任何例外）走舊 COM =====
  // com 模式：comPayload === recordsPayload（後續 Step 3/4/4.5 與現況完全相同）
  let comPayload = recordsPayload;
  if (engineMode === 'overlay' && recordsPayload.length) {
    let engine = null;
    try {
      // strict：背景 PDF／fieldmap 缺失或 blankPdfSha256 不符 → 丟例外 → 全部退回舊引擎
      engine = await require('./sli-eli-overlay').createOverlayEngine({ strict: true });
    } catch (e) {
      errors.push(`疊字引擎無法使用，已全部改用 Excel 引擎：${e.message}`);
    }
    if (!engine) {
      comPayload = recordsPayload.slice(0, recordsPayload.length);
      engineReport.fallbackCount = recordsPayload.length;
    } else {
      const { renderable, fallback } = engine.partition(recordsPayload);
      comPayload = [];
      engineReport.fallbackCount = fallback.length;
      engineReport.fallbackReasons = fallback.map((f) => ({
        mawb: f.mawb,
        chars: (f.unsupported || []).flatMap((u) => u.chars.map((c) => c.ch)).slice(0, 30).join(''),
      }));
      // 非 Latin-1 → 該筆直接排入舊 COM 路徑（與可疊字的記錄混在同一批執行）
      for (const f of fallback) if (f.record) comPayload.push(f.record);
      const byMawb = new Map(recordsPayload.map((r) => [String(r.mawb), r]));
      if (renderable.length) {
        reportProgress(25, `疊字產生 SLI/ELI PDF（0/${renderable.length}）...`);
        const tOverlay = Date.now();
        const batch = await engine.renderMany(renderable, workDir, {
          onRecord: (r, i, n) => reportProgress(25 + Math.round(40 * (i / n)), `疊字產生 PDF（${i}/${n}）...`),
        });
        engineReport.overlayMs = Date.now() - tOverlay;
        engineReport.overlay += batch.ok.length;
        // 單筆失敗或仍判定不可疊字 → 該筆退回舊引擎（不中斷其他筆）
        const needCom = new Set();
        for (const item of batch.fallback) needCom.add(String(item.mawb));
        for (const item of batch.errors) {
          needCom.add(String(item.mawb));
          errors.push(`MAWB ${item.mawb} 疊字產生失敗（已改用 Excel 引擎）：${item.message}`);
        }
        for (const item of batch.ok) {
          // 背景本來就是 A4（此處僅量測回報紙張尺寸，不符只警示不中斷）
          await verifyMergedPaper(item.file, item.mawb);
          mergedPdfs.push(item.file);
          overlayPdfPaths.add(item.file);
        }
        for (const mawb of needCom) {
          const rec = byMawb.get(mawb);
          if (rec) comPayload.push(rec);
        }
      }
    }
  }
  engineReport.com = comPayload.length;

  if (comPayload.length) {
    try {
      // 將 payload 寫入暫存 JSON 檔（execFileAsync 不支援 stdin input，改用檔案參數）
      reportProgress(25, `產生 ${comPayload.length} 份 SLI/ELI PDF（Excel 轉檔中，0/${comPayload.length}）...`);
      const payloadFile = path.join(workDir, 'sli-eli-payload.json');
      await fsp.writeFile(payloadFile, JSON.stringify({ template: sliTemplate, work_dir: workDir, records: comPayload }), 'utf-8');
      const py = resolvePython();
      // 確保 openpyxl 可用（Dockerfile pip 安裝不完整時自動補裝）
      await ensurePythonModule('openpyxl');
      const script = path.join(__dirname, 'sli-eli-generate.py');
      const { outputs, failures } = await runPdfWorkers({
        py,
        script,
        payloadFile,
        workDir,
        recordCount: comPayload.length,
        concurrency,
        signal,
        onProgress: reportProgress,
        paperMode,
      });
      // 逐行解析 worker 輸出（失敗的 worker 也保留了 stdout，故已產出的 PDF 不會白做）
      const outputLines = outputs.flatMap((stdout) => stdout.split('\n')).map((l) => l.trim());
      const pushError = (msg) => { if (!errors.includes(msg)) errors.push(msg); };
      for (const failure of failures) {
        pushError(`SLI/ELI 產生失敗（worker #${failure.shardIndex}，已重試）: ${failure.message}`);
      }
      for (const line of outputLines) {
        if (line.startsWith('FAIL: ')) pushError(`SLI/ELI 產生失敗：${line.slice('FAIL: '.length)}`);
      }
      // 收集產出的 PDF：以 MAWB 為索引（重試／重覆 MAWB 皆自動去重）
      const okMawbs = new Set();
      for (const line of outputLines) {
        if (line.startsWith('OK: ')) {
          const mawb = line.slice('OK: '.length).trim();
          if (mawb) okMawbs.add(mawb);
        }
      }
      for (const mawb of okMawbs) {
        const sliPdf = path.join(workDir, `${mawb} SLI.pdf`);
        const eliPdf = path.join(workDir, `${mawb} ELI.pdf`);
        const hasSli = fs.existsSync(sliPdf);
        const hasEli = fs.existsSync(eliPdf);
        if (!hasSli && !hasEli) {
          errors.push(`MAWB ${mawb} 找不到產出的 SLI/ELI PDF（未合併）`);
          continue;
        }
        if (!hasSli || !hasEli) {
          errors.push(`MAWB ${mawb} 只產生 ${hasSli ? 'SLI' : 'ELI'} PDF，缺少 ${hasSli ? 'ELI' : 'SLI'}（未合併）`);
        }
        pdfPairs.push({ mawb, sli: hasSli ? sliPdf : null, eli: hasEli ? eliPdf : null });
      }
    } catch (e) {
      errors.push(`SLI/ELI 批次產生失敗: ${e.message}`);
    }
  }

  // Step 4: 合併 SLI+ELI → {MAWB}.pdf，刪除單獨檔
  const mergeTargets = pdfPairs.filter((p) => p.sli && p.eli);
  reportProgress(80, `合併 ${mergeTargets.length} 組 SLI + ELI PDF...`);
  assertActive();
  let nextMerge = 0;
  const mergeWorkerCount = Math.min(getPdfConcurrency(mergeTargets.length, concurrency), 4);
  const mergeWorker = async () => {
    while (true) {
      assertActive();
      const i = nextMerge++;
      if (i >= mergeTargets.length) return;
      const { mawb, sli, eli } = mergeTargets[i];
      const mergedPath = path.join(workDir, `${mawb}.pdf`);
      try {
        await mergePdfs([sli, eli], mergedPath);
        // A4 修正：Excel 匯出的紙張由印表機驅動決定（air 實測 322.8×456.9mm），
        // 這裡把非 A4 頁等比縮成 A4（＝模板原設計的 A4 × 65%），PDF_PAPER=custom 時跳過。
        if (paperMode === 'a4') await normalizePdfToA4(mergedPath);
        await verifyMergedPaper(mergedPath, mawb); // A4 驗證（不符只警示，不中斷）
        mergedPdfs.push(mergedPath);
        await fsp.unlink(sli).catch(() => {});
        await fsp.unlink(eli).catch(() => {});
        await fsp.unlink(path.join(workDir, `${mawb} SLI.xlsx`)).catch(() => {});
        await fsp.unlink(path.join(workDir, `${mawb} ELI.xlsx`)).catch(() => {});
      } catch (e) {
        errors.push(`MAWB ${mawb} 合併 PDF 失敗: ${e.message}`);
      }
    }
  };
  if (mergeWorkerCount) {
    await Promise.all(Array.from({ length: mergeWorkerCount }, () => mergeWorker()));
  }
  // 成功產出的份數 = 實際合併完成的 PDF 數（避免把失敗/缺檔的也算進去）
  pdfCount = mergedPdfs.length;

  // ===== Step 4.5：PDF 字型優化（瘦身）=====
  // 實測 533 KB -> 123 KB（-77%），渲染逐像素差異 0.000%（移除 PDF 用不到的
  // name／hinting 表與 glyf 指令）。環境缺 Python/PyMuPDF 時自動略過、不影響產出。
  // overlay 模式：疊字輸出的背景已是「已優化」字型（＋標準字型 0 byte 內嵌），無需再瘦身；
  // 但本次若有「退回舊引擎」的檔案（非 Latin-1 等），那些是未優化的 Excel 輸出 → 只對它們瘦身，
  // 否則會退回 ~545KB（與 com 模式的 123KB 不一致）。
  const fontOptEnabled = String(process.env.PDF_FONT_OPT || 'on').toLowerCase() !== 'off';
  let fontOpt = null;
  if (engineMode === 'overlay') {
    const comPdfs = mergedPdfs.filter((p) => !overlayPdfPaths.has(p));
    if (fontOptEnabled && comPdfs.length) {
      reportProgress(87, `PDF 瘦身中（退回舊引擎的 ${comPdfs.length} 份）...`);
      fontOpt = await optimizePdfFontsInPlace(comPdfs);
      if (!fontOpt) fontOpt = { files: 0, before: 0, after: 0, reductionPct: 0, items: [], skipped: true, engine: 'overlay' };
      else fontOpt.engine = 'overlay';
    } else {
      fontOpt = { files: 0, before: 0, after: 0, reductionPct: 0, items: [], skipped: true, engine: 'overlay' };
    }
  } else if (fontOptEnabled && mergedPdfs.length) {
    reportProgress(87, `PDF 瘦身中（字型優化 ${mergedPdfs.length} 份）...`);
    fontOpt = await optimizePdfFontsInPlace(mergedPdfs);
    if (!fontOpt) fontOpt = { files: 0, before: 0, after: 0, reductionPct: 0, items: [], skipped: true };
  } else if (!fontOptEnabled) {
    fontOpt = { files: 0, before: 0, after: 0, reductionPct: 0, items: [], disabled: true };
  }
  // 紙張驗證未通過：不阻斷（檔案仍可下載），但明確列出實測尺寸避免靜默產出不符規格
  if (!paperReport.ok && paperReport.issues.length) {
    errors.push(
      `紙張驗證未通過（PDF_PAPER=${paperReport.mode}）：${paperReport.issues.slice(0, 3).join('；')}` +
      (paperReport.issues.length > 3 ? `（共 ${paperReport.issues.length} 筆）` : '')
    );
  }
  for (let i = 1; i <= getPdfConcurrency(comPayload.length, concurrency); i++) {
    await fsp.rm(path.join(workDir, `lo-profile-${i}`), { recursive: true, force: true }).catch(() => {});
  }

  // Step 5: 依「航班日期」分組 zip（同一天的所有航班放同一 zip；超過 30MB 才拆 Part）
  // 檔名：單一航班 → {YYYYMMDD} - {航班號} SLI x {N}.zip
  //       同一天多個航班 → {YYYYMMDD} - 多航班 SLI x {N}.zip
  // 註：航班欄位可能含 `/` 等非法字元（例：`5Y8050/ 13th Oct`）→ 一律經 zipBaseName() 過濾，避免 ENOENT。
  reportProgress(90, '依航班日期打包 ZIP...');
  assertActive();
  const groups = planDateGroups(allRecords, mergedPdfs);

  const zipPaths = [];
  const MAX_ZIP_BYTES = 30 * 1024 * 1024; // 每個 ZIP 上限 30MB
  for (const grp of groups) {
    const pdfs = grp.pdfs;
    if (!pdfs.length) continue;
    const prefix = zipBaseName(grp);
    // 依總大小拆份（超過 30MB 自動多拆），並平均分配檔案
    const chunks = planZipParts(pdfs, MAX_ZIP_BYTES);
    if (chunks.length === 1) {
      const zipName = `${prefix} SLI x ${pdfs.length}.zip`;
      const zipPath = path.join(workDir, zipName);
      // 防禦：清完非法字元後檔名必須仍落在 workDir 內（否則寧可換一個安全名）
      const safeName = path.basename(zipPath) === zipName ? zipName : `${sanitizeFileLabel(prefix)} SLI x ${pdfs.length}.zip`;
      const finalPath = path.join(workDir, safeName);
      await zipFiles(pdfs, finalPath);
      zipPaths.push(finalPath);
      continue;
    }
    for (let pi = 0; pi < chunks.length; pi++) {
      const partPdfs = chunks[pi];
      const zipName = `${prefix} SLI x ${partPdfs.length} (Part ${pi + 1} of ${chunks.length}).zip`;
      const zipPath = path.join(workDir, zipName);
      const safeName = path.basename(zipPath) === zipName ? zipName : `${sanitizeFileLabel(prefix)} SLI x ${partPdfs.length} (Part ${pi + 1} of ${chunks.length}).zip`;
      const finalPath = path.join(workDir, safeName);
      reportProgress(Math.min(99, 90 + Math.round(9 * ((pi + 1) / chunks.length))), `打包 ZIP（Part ${pi + 1} of ${chunks.length}）...`);
      await zipFiles(partPdfs, finalPath);
      zipPaths.push(finalPath);
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
    duplicates, // 重覆 MAWB 警告清單（不阻斷；同一 MAWB 出現 2 次或以上）
    paper: paperReport, // 紙張驗證結果（mode / measured / ok / issues）
    fontOpt, // PDF 字型優化結果（files / before / after / reductionPct / skipped）
    engine: engineReport, // PDF 產生引擎（mode / overlay / com / fallbackCount / fallbackReasons / overlayMs）
    fallbackCount: engineReport.fallbackCount, // 退回舊 Excel 引擎的份數（相容欄位，P4）
    workDir,
  };
}

module.exports = {
  // 歷史 API（保持 require('../scripts/xls-workflow') 相容，含測試與路由）
  runWorkflow,
  standardizeRows,
  findDuplicateMawbs,
  planDateGroups,
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
  resolvePdfEngineMode,
  zipBaseName,
  sanitizeFileLabel,
  sleep,
  cleanCell,
  excelSerialToDate,
  formatDdmmyyyy,
  formatYyyymmdd,
  loadTemplateCopy,
  resolvePython,
  ensurePythonModule,
  xlsxToPdf,
  workbookToXlsx,
};

