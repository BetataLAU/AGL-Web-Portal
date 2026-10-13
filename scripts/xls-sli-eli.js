// ===== Shipper Role Project - SLI / ELI 填表 + PDF + ZIP =====
// 從 xls-workflow.js 拆出（.clinerule.md：檔案大小控制）
// 職責：SLI/ELI 模板填表（xlsm→xlsx）、PDF 轉換/合併、ZIP 打包與自動分割。
// 依賴：xls-utils.js（flightCompany）

const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const { execFile, execFileSync } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);
const ExcelJS = require('exceljs');
const archiver = require('archiver');
const { PDFDocument } = require('pdf-lib');
const { flightCompany } = require('./xls-utils');

// ===== Python 直譯器解析 =====
// Railway/Linux 容器常只有 python3（或 python symlink 未建立）；Windows 本地則慣用 python。
// 依序嘗試：PYTHON 環境變數 → python3 → python。結果快取，避免每次呼叫都重測。
let _cachedPython = null;
function resolvePython() {
  if (_cachedPython) return _cachedPython;
  const candidates = [];
  if (process.env.PYTHON) candidates.push(process.env.PYTHON);
  // Windows 本機：優先 python（慣用安裝通常有 pywin32 → Excel COM 最精確）
  // Linux/Railway：優先 python3（常見僅有 python3）
  if (process.platform === 'win32') {
    candidates.push('python', 'python3');
  } else {
    candidates.push('python3', 'python');
  }
  for (const c of candidates) {
    try {
      execFileSync(c, ['--version'], { stdio: 'ignore', timeout: 8000, windowsHide: true });
      _cachedPython = c;
      return c;
    } catch (e) {
      // 找不到就試下一個
    }
  }
  throw new Error(
    '找不到可用的 Python（已嘗試 PYTHON 環境變數 / python3 / python）。' +
    'Railway 部署請確認已使用根目錄 Dockerfile（含 python3、libreoffice、openpyxl、pypdf）重新部署；' +
    '或在本機設定 PYTHON 環境變數指定 python 路徑。'
  );
}


// ===== Python 模組確保（Dockerfile pip 安裝不完整時自動補裝，Railway 適用） =====
const _ensuredModules = new Set();
async function ensurePythonModule(moduleName) {
  if (_ensuredModules.has(moduleName)) return;
  const py = resolvePython();
  const check = async () => { await execFileAsync(py, ['-c', `import ${moduleName}`], { timeout: 20000 }); };
  try {
    await check();
  } catch (e) {
    // 未安裝 → 嘗試 pip 安裝（新版 pip 需 --break-system-packages，舊版不需要）
    const variants = [
      ['--break-system-packages', '--no-cache-dir'],
      ['--no-cache-dir'],
    ];
    let installed = false;
    for (const flags of variants) {
      try {
        await execFileAsync(py, ['-m', 'pip', 'install', ...flags, moduleName], { timeout: 180000 });
        installed = true;
        break;
      } catch (e2) { /* 嘗試下一種 */ }
    }
    if (!installed) {
      throw new Error(
        `Python 模組 ${moduleName} 無法安裝（已嘗試 pip install --break-system-packages）。` +
        '請確認 Dockerfile 已安裝該模組，或檢查容器 pip 是否可用。'
      );
    }
    await check(); // 安裝後再驗證
  }
  _ensuredModules.add(moduleName);
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
  const py = resolvePython();
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
  try {
    await ensurePythonModule('pypdf');
    const py = resolvePython();
    const script = path.join(__dirname, 'merge-pdf.py');
    const args = ['--out', outputPath, ...inputPaths];
    const { stdout, stderr } = await execFileAsync(py, [script, ...args], { timeout: 120000 });
    if (stderr && stderr.includes('ERROR')) throw new Error(`PDF 合併/壓縮失敗: ${stderr}`);
    return stdout;
  } catch (err) {
    // 後備：pypdf 不可用／合併失敗時，改用 Node pdf-lib 合併（不依賴 Python 套件，Railway 也適用）
    console.warn(`[mergePdfs] 改用 pdf-lib 合併（${err.message}）`);
    return mergePdfsWithPdfLib(inputPaths, outputPath);
  }
}

/** 用 Node pdf-lib 合併 PDF（無需 pypdf；最終後備，避免因 Python 套件缺失而中斷） */
async function mergePdfsWithPdfLib(inputPaths, outputPath) {
  const merged = await PDFDocument.create();
  for (const p of inputPaths) {
    const src = await PDFDocument.load(await fsp.readFile(p));
    const pages = await merged.copyPages(src, src.getPageIndices());
    for (const pg of pages) merged.addPage(pg);
  }
  const bytes = await merged.save({ useObjectStreams: true });
  await fsp.writeFile(outputPath, bytes);
  return `MERGED (pdf-lib): ${outputPath}`;
}

/**
 * 量測 PDF 每頁尺寸（pt）— 供「A4 修正」驗證用。
 * pdf-lib 已是既有依賴，不新增套件；只用來讀檔量測，不修改檔案。
 */
async function readPdfPageSizes(filePath) {
  const doc = await PDFDocument.load(await fsp.readFile(filePath), { ignoreEncryption: true });
  return doc.getPages().map((pg) => {
    const { width, height } = pg.getSize();
    return { width, height };
  });
}

// ===== A4 正規化（紙張修正） =====
// Excel 匯出的紙張尺寸由「印表機驅動的 DEVMODE」決定：實測模板工作表 PageSetup 明明是
// A4/65%，但 air sheet 仍匯出成 915.3×1295.5pt（322.8×456.9mm = A4 ÷ 0.65，也就是
// 模板原設計「A4 × 65% 縮放」所用的紙張）。改 PageSetup／存檔／FitToPage 都無法改變。
// 因此在 Node 端把非 A4 的頁面等比縮放成 A4：內容物理尺寸與列印結果不變（原本印表機
// 也是乘 0.65 縮到 A4），只是 PDF 頁面尺寸正確、不再被驅動程式二次縮放。
const A4_SIZE = { width: 595.28, height: 841.89 };

/**
 * 把 PDF 內非 A4 的頁面等比縮放成 A4（已是 A4 的頁面不動）。
 * @param {string} filePath PDF 路徑（會被就地改寫）
 * @param {number} tolerance 容差（pt）
 * @returns {Promise<number>} 被調整的頁數；0 = 全部本來就是 A4（未改寫檔案）
 */
async function normalizePdfToA4(filePath, tolerance = 1) {
  const doc = await PDFDocument.load(await fsp.readFile(filePath), { ignoreEncryption: true });
  let changed = 0;
  for (const page of doc.getPages()) {
    const { width, height } = page.getSize();
    if (!width || !height) continue;
    const isA4 = Math.abs(width - A4_SIZE.width) <= tolerance
      && Math.abs(height - A4_SIZE.height) <= tolerance;
    if (isA4) continue;
    // page.scale 會同時調整頁面尺寸、內容流與註記，等比縮放不變形
    page.scale(A4_SIZE.width / width, A4_SIZE.height / height);
    changed += 1;
  }
  if (changed) {
    await fsp.writeFile(filePath, await doc.save({ useObjectStreams: true }));
  }
  return changed;
}

/**
 * 批次就地優化 PDF 內嵌字型（PDF 瘦身）。
 * 實測（Excel 匯出 2 頁 SLI+ELI）：533.0 KB → 123.4 KB（-76.8%），150dpi 逐像素差異 0.000%。
 * 需要 Python + PyMuPDF；環境缺少時回傳 null（呼叫端據此顯示提示，不影響產出）。
 */
async function optimizePdfFontsInPlace(paths, options = {}) {
  if (!paths || !paths.length) return { files: 0, before: 0, after: 0, reductionPct: 0, items: [] };
  let py;
  try {
    py = resolvePython();
  } catch (e) {
    return null;
  }
  const script = path.join(__dirname, 'sli-eli-font-optimize.py');
  let out = '';
  try {
    const res = await execFileAsync(py, [script, '--inplace', ...paths], {
      timeout: options.timeout || 900000,
      maxBuffer: 20 * 1024 * 1024,
      windowsHide: true,
    });
    out = `${res.stdout || ''}`;
  } catch (err) {
    out = `${(err && err.stdout) || ''}\n${(err && err.stderr) || ''}`;
  }
  const m = out.match(/OPT-TOTAL: (\d+) files ([\d.]+) KB -> ([\d.]+) KB \(-([\d.]+)%\)/);
  if (!m) return null;
  return {
    files: Number(m[1]),
    before: Math.round(Number(m[2]) * 1024),
    after: Math.round(Number(m[3]) * 1024),
    reductionPct: Number(m[4]),
    items: [...out.matchAll(/^OPT: (.+?) ([\d.]+) KB -> ([\d.]+) KB$/gm)].map((x) => ({
      name: x[1], before: Math.round(Number(x[2]) * 1024), after: Math.round(Number(x[3]) * 1024),
    })),
    skipped: false,
  };
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

// ===== ZIP 分割：依總大小決定份數，平均分配檔案 =====
// 例：總 75MB → 3 份（每份 25MB）；59 個檔 → 29 + 30
function planZipParts(pdfs, maxBytes) {
  if (!pdfs.length) return [];
  const totalBytes = pdfs.reduce((s, p) => s + (fs.statSync(p).size || 0), 0);
  const numParts = Math.min(Math.max(1, Math.ceil(totalBytes / maxBytes)), pdfs.length);
  if (numParts <= 1) return [pdfs];
  const base = Math.floor(pdfs.length / numParts);
  const rem = pdfs.length % numParts;
  const chunks = [];
  let idx = 0;
  for (let pi = 0; pi < numParts; pi++) {
    const size = base + (pi >= numParts - rem ? 1 : 0);
    chunks.push(pdfs.slice(idx, idx + size));
    idx += size;
  }
  return chunks;
}
module.exports = {
  resolvePython,
  ensurePythonModule,
  loadTemplateCopy,
  makeSli,
  makeEli,
  xlsxToPdf,
  mergePdfs,
  mergePdfsWithPdfLib,
  readPdfPageSizes,
  normalizePdfToA4,
  optimizePdfFontsInPlace,
  A4_SIZE,
  zipFiles,
  planZipParts,
};

