// ===== Shipper Role Project - Report 寫入 =====
// 從 xls-workflow.js 拆出（.clinerule.md：檔案大小控制）
// 職責：將標準化記錄寫入 report 模板。
//
// 新版規則（配合 data/templates/shipper-role-summary-2026.xlsx）：
//   - 每個月份一個 worksheet（YYYYMM，例 202609 = 2026-09）。
//   - 月份 sheet 不存在時，自動複製名為「template」的 worksheet（保留表頭/欄寬/樣式）
//     產生新月份 sheet，並放到 workbook 最左邊；template 本身不動。
//   - 記錄依「航班日期」決定所屬月份 sheet。
//   - 每次執行（每個月份 sheet）把新批次「插到第 4 行」：有多少 MAWB 就插入多少列
//     + 1 個空行作分隔，舊記錄與結算列（no. of MAWB / est WT）一起往下移，
//     最新批次永遠在最上面。
//   - 同一「航班 + 日期」為一組；每組第一列才填 A(Date of shipment=航班日期)
//     /B(Flight#)/G(Exe date=執行當日)，其餘列只填 C(MAWB#)/D(Dest)/E(PCS)/F(est WT)。
//   - 寫完後重寫「結算列」公式（COUNTA/SUM）的範圍與快取值，令總計正確涵蓋全部記錄。

const ExcelJS = require('exceljs');

// ===== Report 寫入 =====

const TEMPLATE_SHEET = 'template'; // 版面母版 worksheet 名稱
const DATA_START_ROW = 4;          // 資料起始列
const DATE_FMT = 'dd/mmm/yyyy';    // 日期顯示格式（與模板自訂格式一致）

function pad2(n) {
  return String(n).padStart(2, '0');
}

function monthKeyOf(d) {
  return d ? `${d.getFullYear()}${pad2(d.getMonth() + 1)}` : '';
}

function sameDate(a, b) {
  return !!a && !!b && a.toDateString() === b.toDateString();
}

/**
 * 轉成適合寫入 Excel 的 Date：以「該曆日的 UTC 午夜」表示。
 * ExcelJS 寫入時以 UTC（d.getTime()）換算序列值；若存「本地午夜」（+08:00 會變成
 * 前一日 16:00Z，序列值帶小數），Excel 顯示會少一天，故先轉成 UTC 午夜使序列為整數。
 */
function toExcelDate(d) {
  if (!d || !(d instanceof Date) || isNaN(d.getTime())) return null;
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

/** 資料列 cell 樣式：與既有月份 sheet 的資料列一致（Calibri 10；日期欄套 dd/mmm/yyyy）。 */
function applyDataCellStyle(cell, isDate) {
  cell.font = { name: 'Calibri', size: 10 };
  if (isDate) cell.numFmt = DATE_FMT;
}

/**
 * 確認月份 sheet 存在；不存在時從 template 複製產生並移到 workbook 最左邊。
 * @returns {import('exceljs').Worksheet}
 */
function ensureMonthSheet(wb, key) {
  let ws = wb.getWorksheet(key);
  if (ws) return ws;

  const tpl = wb.getWorksheet(TEMPLATE_SHEET);
  if (!tpl) {
    throw new Error(`Report 模板缺少「${TEMPLATE_SHEET}」worksheet，無法建立 ${key} 月份 sheet`);
  }
  ws = wb.addWorksheet(key);

  // 欄寬
  for (const col of tpl.columns) {
    if (col.width) {
      const dstCol = ws.getColumn(col.number);
      dstCol.width = col.width;
      if (col.hidden) dstCol.hidden = true;
    }
  }

  // 版面內容（值 + 樣式）：複製 template 的全部既有列（表頭等靜態內容）
  tpl.eachRow({ includeEmpty: false }, (srcRow, rowNumber) => {
    const dstRow = ws.getRow(rowNumber);
    srcRow.eachCell((cell, colNumber) => {
      const dstCell = dstRow.getCell(colNumber);
      dstCell.value = cell.value; // 值（含結算列公式）與樣式一併複製
      if (cell.style) {
        try {
          dstCell.style = JSON.parse(JSON.stringify(cell.style));
        } catch (e) {
          dstCell.font = cell.font;
          dstCell.fill = cell.fill;
          dstCell.alignment = cell.alignment;
        }
      }
    });
    if (srcRow.height) dstRow.height = srcRow.height;
  });

  // 合併格（若有）
  const tplMerges = (tpl.model && tpl.model.merges) || [];
  for (const range of tplMerges) ws.mergeCells(range);

  // 列印版面（若有）
  if (tpl.pageSetup) {
    Object.keys(tpl.pageSetup).forEach((k) => {
      if (k === 'margins' && tpl.pageSetup.margins) {
        ws.pageSetup.margins = Object.assign({}, ws.pageSetup.margins, tpl.pageSetup.margins);
      } else if (tpl.pageSetup[k] !== undefined) {
        ws.pageSetup[k] = tpl.pageSetup[k];
      }
    });
  }

  // 移到最左邊：ExcelJS 以 worksheet.orderNo 排序輸出，重設序號即可
  const sheets = wb.worksheets.filter((s) => s.id !== ws.id);
  [ws].concat(sheets).forEach((s, i) => { s.orderNo = i + 1; });

  return ws;
}

/** 找出結算列（B 欄文字為「no. of MAWB:」的那一列）。 */
function findTotalsRow(ws) {
  let totalsRow = null;
  ws.eachRow({ includeEmpty: false }, (row, rn) => {
    if (totalsRow) return;
    const b = row.getCell(2).value;
    if (typeof b === 'string' && b.trim() === 'no. of MAWB:') totalsRow = rn;
  });
  return totalsRow;
}

/**
 * 重寫結算列公式範圍與快取值（spliceRows 移動列後公式文字不會自動更新，
 * 因此依最新資料重設 COUNTA(C3:Cx) / SUM(F3:Fx) / Fx*0.04）。
 */
function updateTotals(ws) {
  const T = findTotalsRow(ws);
  if (!T) return;
  let count = 0;
  let sumW = 0;
  ws.eachRow({ includeEmpty: false }, (row, rn) => {
    if (rn < DATA_START_ROW || rn >= T) return;
    const c = row.getCell(3).value;
    if (c !== null && c !== undefined && c !== '') count += 1;
    const f = row.getCell(6).value;
    if (typeof f === 'number' && isFinite(f)) sumW += f;
  });
  ws.getCell(T, 3).value = { formula: `COUNTA(C3:C${T - 1})`, result: count };
  ws.getCell(T, 6).value = { formula: `SUM(F3:F${T - 1})`, result: sumW };
  ws.getCell(T, 8).value = { formula: `F${T}*0.04`, result: sumW * 0.04 };
}

/** 寫一列記錄；組首列同時填 A/B/G。 */
function writeRecordRow(ws, rowNumber, g, rec, isFirst, execDate) {
  const row = ws.getRow(rowNumber);
  if (isFirst) {
    applyDataCellStyle(row.getCell(1), true);
    row.getCell(1).value = toExcelDate(g.date); // 航班日期（UTC 午夜）
    applyDataCellStyle(row.getCell(2), false);
    row.getCell(2).value = g.flight || null;
    applyDataCellStyle(row.getCell(7), true);
    row.getCell(7).value = execDate; // 執行日期（今天，UTC 午夜）
  }
  applyDataCellStyle(row.getCell(3), false);
  row.getCell(3).value = rec.mawb || null;
  applyDataCellStyle(row.getCell(4), false);
  row.getCell(4).value = rec.dest || null;
  applyDataCellStyle(row.getCell(5), false);
  row.getCell(5).value = (typeof rec.pcs === 'number' && isFinite(rec.pcs)) ? rec.pcs : null;
  applyDataCellStyle(row.getCell(6), false);
  row.getCell(6).value = (typeof rec.weight === 'number' && isFinite(rec.weight)) ? rec.weight : null;
}

/**
 * 將標準化記錄寫入 report 模板。
 * 每個月份 sheet：將新批次（N 筆 MAWB + 1 空行）插入第 4 行，舊內容（含結算列）下移；
 * 每組（航班+日期）首列填 A/B/G，其餘列填 C-F；最後重寫結算列公式。
 * @returns {Promise<{filePath:string}>}
 */
async function writeReport(reportPath, records) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(reportPath);

  const execDate = toExcelDate(new Date()); // G 執行日期 = 今天（轉 UTC 午夜，避免 Excel 少一天）

  // 依序分組：同「航班號 + 日期」的連續記錄為同一組
  const groups = [];
  let cur = null;
  for (const rec of records) {
    if (!cur || cur.flight !== rec.flight || !sameDate(cur.date, rec.flightDate)) {
      cur = { flight: rec.flight, date: rec.flightDate, recs: [] };
      groups.push(cur);
    }
    cur.recs.push(rec);
  }

  // 依月份歸組（無航班日期的記錄無法決定月份 → 不寫入 Report）
  const bySheet = new Map();
  const sheetOrder = [];
  for (const g of groups) {
    if (!g.date) continue;
    const key = monthKeyOf(g.date);
    if (!bySheet.has(key)) {
      bySheet.set(key, []);
      sheetOrder.push(key);
    }
    bySheet.get(key).push(g);
  }

  let written = 0;
  for (const key of sheetOrder) {
    const groupList = bySheet.get(key);
    const ws = ensureMonthSheet(wb, key);
    const n = groupList.reduce((sum, g) => sum + g.recs.length, 0);
    if (!n) continue;

    // 在第 4 行插入 N 列資料 + 1 個空行（分隔用）；舊內容（含結算列）自動下移
    const blanks = new Array(n + 1).fill([]);
    ws.spliceRows(DATA_START_ROW, 0, ...blanks);

    // 寫入新批次（第 4 行起；每組首列填 A/B/G）
    let rowNumber = DATA_START_ROW;
    for (const g of groupList) {
      g.recs.forEach((rec, i) => {
        writeRecordRow(ws, rowNumber, g, rec, i === 0, execDate);
        rowNumber += 1;
        written += 1;
      });
    }

    // 重寫結算列公式（範圍涵蓋全部記錄）
    updateTotals(ws);
  }

  if (written) {
    await wb.xlsx.writeFile(reportPath);
  }
  return { filePath: reportPath, count: written };
}

module.exports = {
  writeReport,
};

