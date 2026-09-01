// ===== Shipper Role Project - SLI / ELI 填表 + PDF + ZIP =====
// 從 xls-workflow.js 拆出（.clinerule.md：檔案大小控制）
// 職責：SLI/ELI 模板填表（xlsm→xlsx）、PDF 轉換/合併、ZIP 打包與自動分割。
// 依賴：xls-utils.js（flightCompany）

const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);
const ExcelJS = require('exceljs');
const archiver = require('archiver');
const { flightCompany } = require('./xls-utils');


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
  loadTemplateCopy,
  makeSli,
  makeEli,
  xlsxToPdf,
  mergePdfs,
  zipFiles,
  planZipParts,
};

