// ===== Shipper Role Project - Report 寫入 =====
// 從 xls-workflow.js 拆出（.clinerule.md：檔案大小控制）
// 職責：將標準化記錄寫入 report 模板（依航班/日期分組，列 6 起）。

const ExcelJS = require('exceljs');


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
module.exports = {
  writeReport,
};

