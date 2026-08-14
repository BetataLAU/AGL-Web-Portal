// ===== Shipper Role Project - XLS 工作流程引擎 =====
// 功能：標準化資料 → report 寫入 → SLI/ELI 填表 → PDF → merge → zip
// 依賴：exceljs / pdf-lib / archiver / child_process

const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);
const ExcelJS = require('exceljs');
const { PDFDocument } = require('pdf-lib');
const archiver = require('archiver');

// ===== 路徑設定 =====
const PROJECT_ROOT = path.resolve(__dirname, '..');
const TEMPLATE_DIR = path.join(PROJECT_ROOT, 'data', 'templates');
const WORK_DIR = path.join(PROJECT_ROOT, 'data', 'work');

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

// ===== 工具函式 =====

/** 等待 ms 毫秒 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 過濾非必要字元（移除 xlsx 常見的 _x000D_ 控制字元） */
function cleanCell(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object' && v instanceof Date) return v;
  let s = String(v);
  s = s.replace(/_x000D_/g, ' ').replace(/\r/g, ' ').replace(/\u00a0/g, ' ');
  return s.trim();
}

/** 抽取 MAWB#（標準化 000-00000000 或 00000000000） */
function normalizeMawb(v) {
  const s = cleanCell(v);
  const m = s.match(/(\d{3})[-\s]?(\d{8})/);
  return m ? `${m[1]}-${m[2]}` : s.replace(/[^0-9]/g, '');
}

/** 抽取航班公司代碼（航班號頭 2 個字元，如 CX257→CX、QR8409→QR、5Y8230→5Y） */
function flightCompany(flight) {
  const s = cleanCell(flight).toUpperCase();
  const m = s.match(/^([A-Z0-9]{2})/);
  return m ? m[1] : s.slice(0, 2);
}

/** 日期正規化：回傳 Date 或 null */
function normalizeDate(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  const s = cleanCell(v);
  if (!s) return null;
  // 嘗試常見格式
  const patterns = [
    /^(\d{4})-(\d{2})-(\d{2})/,             // 2026-08-03
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})/,       // 03/08/2026 or 08/03/2026
    /^(\d{1,2})-([A-Za-z]{3})-(\d{4})/,     // 03-Aug-2026
    /^(\d{1,2})[A-Za-z]{2}\s*([A-Za-z]{3})\s*(\d{4})/, // 3rd Aug 2026
    /^(\d{4})(\d{2})(\d{2})/,               // 20260803
  ];
  for (const p of patterns) {
    const m = s.match(p);
    if (!m) continue;
    if (p === patterns[0]) {
      const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      if (!isNaN(d)) return d;
    } else if (p === patterns[1]) {
      const [_, a, b, y] = m;
      // 月份在 1-12 才視為月
      if (Number(a) >= 1 && Number(a) <= 12) {
        const d = new Date(Number(y), Number(a) - 1, Number(b));
        if (!isNaN(d)) return d;
      }
    } else if (p === patterns[2] || p === patterns[3]) {
      const monthMap = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
      const mon = m[2].toUpperCase();
      if (mon in monthMap) {
        const d = new Date(Number(m[3]), monthMap[mon], Number(m[1]));
        if (!isNaN(d)) return d;
      }
    } else if (p === patterns[4]) {
      const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      if (!isNaN(d)) return d;
    }
  }
  // Excel serialize number
  const n = Number(s);
  if (!isNaN(n) && n > 20000 && n < 80000) {
    return excelSerialToDate(n);
  }
  return null;
}

function excelSerialToDate(serial) {
  const utcDays = Math.floor(serial - 25569);
  const d = new Date(utcDays * 86400 * 1000);
  return isNaN(d.getTime()) ? null : d;
}

/** 格式化日為 DDMMM（如 03AUG） */
function formatDdmmyyyy(d) {
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  return `${String(d.getDate()).padStart(2, '0')}${months[d.getMonth()]}`;
}

/** 從 CNEE 內容抽取電話號碼 */
function extractTel(text) {
  const s = cleanCell(text);
  if (!s) return '';
  // 優先匹配 TEL:/電話/PHONE 之後的號碼
  const labeled = s.match(/(?:TEL|TELE|PHONE|電話|TEL:|電話)[:\s]*([+\d][\d\s\-()/]{6,20})/i);
  if (labeled) return labeled[1].trim();
  // 備援：抓取一般電話格式
  const generic = s.match(/[+()\d][\d\s\-()/]{7,18}/);
  return generic ? generic[0].trim() : '';
}

/** 保留巨集移除，xlsm → xlsx 格式 */
function workbookToXlsx(wb, targetPath) {
  // exceljs 讀取 xlsm 後無法直接存 xlsx 且保留所有樣式，因此採用「讀取模板 + 逐格覆寫」方式：
  // 在 makeSli / makeEli 中實作（讀 xlsm → 改 cell → save 為 xlsx）
  throw new Error('workbookToXlsx: 請改用 fillSli / fillEli');
}

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
    cneeLookup = null,  // { enabled, destCol, remarkCol, cneeCol, startRow, endRow }
  } = def;

  const records = [];

  // 解析 CNEE 對照區
  let lookupEntries = [];
  if (cneeLookup && cneeLookup.enabled) {
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

    if (!rec.mawb) continue; // 無 MAWB 視為非資料列
    records.push(rec);
  }

  return records;
}

// ===== Report 寫入 =====

/**
 * 將記錄寫入 report 模板。
 * 格式：列6 起；同一航班只在首列填 A(日期)/B(航班)，其餘列只填 C-H。
 * @returns {Promise<{filePath:string}>}
 */
async function writeReport(reportPath, records) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(reportPath);

  // 依航班日期決定月份 sheet
  const monthSheetName = records.length
    ? `${records[0].flightDate.getFullYear()}${String(records[0].flightDate.getMonth() + 1).padStart(2, '0')}`
    : null;
  let ws = monthSheetName ? wb.getWorksheet(monthSheetName) : null;
  if (!ws) {
    ws = wb.addWorksheet(monthSheetName || '202608');
  }

  // 找資料起始列：從列6開始往下找第一個完全空列
  let row = 6;
  while (row <= ws.rowCount) {
    const a = ws.getCell(row, 1);
    const c = ws.getCell(row, 3);
    if (!a.value && !c.value) break;
    row++;
  }

  // 群組：同一航班號 + 同日期 視為同一組
  let lastFlight = null;
  let lastDate = null;
  for (const rec of records) {
    const isSameGroup = rec.flight === lastFlight &&
      lastDate && rec.flightDate && rec.flightDate.toDateString() === lastDate.toDateString();
    if (!isSameGroup) {
      ws.getCell(row, 1).value = rec.flightDate || null;
      ws.getCell(row, 2).value = rec.flight || null;
      lastFlight = rec.flight;
      lastDate = rec.flightDate ? new Date(rec.flightDate) : null;
    }
    ws.getCell(row, 3).value = rec.mawb;
    ws.getCell(row, 4).value = rec.dest || null;
    ws.getCell(row, 5).value = rec.pcs || null;
    ws.getCell(row, 6).value = rec.weight || null;
    ws.getCell(row, 7).value = rec.flightDate || null;
    row++;
  }

  await wb.xlsx.writeFile(reportPath);
  return { filePath: reportPath };
}

// ===== SLI / ELI 填表 =====

/** 將 xlsm 模板複製並轉為可編輯副本（去掉巨集） */
async function loadTemplateCopy(templatePath) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(templatePath); // exceljs 可直接讀 xlsm（XML 結構）
  return wb;
}

/**
 * 產生 SLI xlsx（依模板 air sheet 填值）。
 */
async function makeSli(templatePath, rec, outPath) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await fsp.readFile(templatePath));
  const ws = wb.getWorksheet('air');
  if (!ws) throw new Error('SLI 模板缺少 air sheet');

  ws.getCell('D23').value = rec.mawb || '';
  ws.getCell('D25').value = rec.flight ? flightCompany(rec.flight) : '';
  ws.getCell('D27').value = rec.dest || '';
  ws.getCell('D9').value = rec.cnee || '';
  ws.getCell('D72').value = rec.flightDate || new Date();

  await wb.xlsx.writeFile(outPath);
}

/**
 * 產生 ELI xlsx（依模板 ELI LETTER sheet 填值）。
 */
async function makeEli(templatePath, rec, outPath) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await fsp.readFile(templatePath));
  const ws = wb.getWorksheet('ELI LETTER');
  if (!ws) throw new Error('ELI 模板缺少 ELI LETTER sheet');

  ws.getCell('F8').value = rec.mawb || '';        // Master Air Waybill Number
  ws.getCell('P11').value = rec.dest || '';       // Destination
  ws.getCell('M16').value = rec.cnee || '';       // Consignee Name/Address
  ws.getCell('N21').value = rec.cneeTel || '';    // Consignee Contact Number
  ws.getCell('N57').value = rec.flightDate || new Date();  // Date

  await wb.xlsx.writeFile(outPath);
}

// ===== PDF 轉換 =====

/** 呼叫 Python 橋接腳本，將 xlsx 轉 PDF */
async function xlsxToPdf(inputPath, outputPath, sheet = null) {
  const py = process.env.PYTHON || 'python';
  const args = [path.join(__dirname, 'excel-to-pdf.py'), inputPath, outputPath];
  if (sheet !== null) args.push(String(sheet));
  const { stdout, stderr } = await execFileAsync(py, args, { timeout: 120000 });
  if (stderr && stderr.includes('ERROR')) {
    throw new Error(`PDF 轉換失敗: ${stderr}`);
  }
  return stdout;
}

// ===== PDF 合併 =====

/** 合併多個 PDF 檔為一個並壓縮（用 pypdf 重寫，可顯著縮小大小） */
async function mergePdfs(inputPaths, outputPath) {
  const py = process.env.PYTHON || 'python';
  const script = path.join(__dirname, 'merge-pdf.py');
  const args = ['--out', outputPath, ...inputPaths];
  const { stdout, stderr } = await execFileAsync(py, [script, ...args], { timeout: 120000 });
  if (stderr && stderr.includes('ERROR')) {
    throw new Error(`PDF 合併/壓縮失敗: ${stderr}`);
  }
  return stdout;
}

// ===== ZIP 打包 =====

/** 將一批檔案打包成 zip */
async function zipFiles(files, zipPath, zipRootName = '') {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', resolve);
    output.on('error', reject);
    archive.on('error', reject);
    archive.pipe(output);
    for (const f of files) {
      const base = path.basename(f);
      const entry = zipRootName ? path.join(zipRootName, base) : base;
      archive.file(f, { name: entry });
    }
    archive.finalize();
  });
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
  const { files, defs, reportTemplate, sliTemplate, onProgress } = opts;

  const results = [];
  const errors = [];
  const allRecords = [];
  const reportProgress = (pct, msg) => {
    if (typeof onProgress === 'function') onProgress(pct, msg);
  };

  // Step 1: 讀取每個檔案，依定義標準化
  reportProgress(3, '開始解析檔案...');
  for (const [i, def] of defs.entries()) {
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
    const rows = [];
    ws.eachRow((row, rn) => {
      const vals = [];
      for (let c = 1; c <= row.cellCount; c++) {
        vals.push(row.getCell(c).value);
      }
      rows.push(vals);
    });
    const recs = standardizeRows(rows, {
      headerRow: def.headerRow,
      firstDataRow: def.firstDataRow,
      fieldMap: def.fieldMap,
      cneeLookup: def.cneeLookup,
    });

    // 從 CNEE 內容抽取電話
    recs.forEach((r) => {
      if (r.cnee) {
        r.cneeTel = extractTel(r.cnee);
        r.cnee = r.cnee.replace(/\n+/g, '\n');
      } else {
        r.cneeTel = '';
      }
    });

    recs.forEach((r) => r.sourceFile = file.originalName);
    allRecords.push(...recs);
    results.push({ file: file.originalName, records: recs.length });
  }

  // Step 2: Report 寫入
  reportProgress(15, `解析完成，共 ${allRecords.length} 筆，寫入 Report...`);
  let reportOut = reportTemplate;
  if (allRecords.length) {
    await writeReport(reportTemplate, allRecords);
  }

  // Step 3: SLI / ELI xlsx + PDF
  await fsp.mkdir(WORK_DIR, { recursive: true });
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
      reportProgress(25, `產生 ${recordsPayload.length} 份 SLI/ELI PDF（Excel 轉檔中）...`);
      const payloadFile = path.join(workDir, 'sli-eli-payload.json');
      await fsp.writeFile(payloadFile, JSON.stringify({ template: sliTemplate, work_dir: workDir, records: recordsPayload }), 'utf-8');
      const py = process.env.PYTHON || 'python';
      const { stdout, stderr } = await execFileAsync(py, [path.join(__dirname, 'sli-eli-generate.py'), '--payload', payloadFile], {
        timeout: 600000, // 10 分鐘（大量 MAWB 時）
        maxBuffer: 10 * 1024 * 1024,
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
  const groups = new Map();
  for (const rec of allRecords) {
    if (!rec.flight) continue;
    if (!groups.has(rec.flight)) groups.set(rec.flight, []);
    const merged = mergedPdfs.find((p) => path.basename(p).startsWith(rec.mawb));
    if (merged) groups.get(rec.flight).push(merged);
  }

  const zipPaths = [];
  for (const [flight, pdfs] of groups.entries()) {
    if (!pdfs.length) continue;
    const d = allRecords.find((r) => r.flight === flight && r.flightDate);
    const day = d ? formatDdmmyyyy(d.flightDate) : '';
    const zipName = `${flight}-${day} x ${pdfs.length}.zip`;
    const zipPath = path.join(workDir, zipName);
    await zipFiles(pdfs, zipPath);
    zipPaths.push(zipPath);
  }

  reportProgress(100, '完成！');
  return {
    zipPaths,
    reportPath: reportOut,
    count: pdfCount,
    errors,
    workDir,
  };
}

module.exports = {
  runWorkflow,
  standardizeRows,
  writeReport,
  makeSli,
  makeEli,
  mergePdfs,
  zipFiles,
  extractTel,
  normalizeMawb,
  normalizeDate,
  flightCompany,
  FIELD_TYPES,
};