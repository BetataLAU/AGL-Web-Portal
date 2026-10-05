// ===== Shipper Role Project - ExcelJS 讀檔防護（避免 defined-name 巨量範圍造成 OOM） =====
//
// 背景（實際案例）：
//   使用者上傳 WPS（金山）產出的 xlsx 後，伺服器直接崩潰：
//     FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory
//   伺服器一死，前端 fetch 連線失敗，只看到「上傳失敗：Failed to fetch」。
//
//   該檔（僅 88KB）的 xl/workbook.xml 帶有 WPS 自動寫入的 defined name：
//     <definedName name="_xlnm._FilterDatabase" hidden="1">配舱计划!$A$3:$XFB$1048462</definedName>
//   → 16384 欄 × 1048460 列 ≈ 171 億格。ExcelJS 解析 defined name 時
//     （DefinedNames.set model → CellMatrix.addCellEx）會把整個範圍「逐格展開」成物件，
//     171 億格會瞬間吃爆約 4GB heap（Node 預設上限）→ 程序崩潰。
//   實測：即使把範圍縮小到 $A$3:$XFB$351（571 萬格）仍佔用約 500MB，
//         證明記憶體用量正比於「defined name 的範圍格數」（同一檔案使用 SheetJS 讀取僅約 18MB）。
//
// 對策：
//   在 ExcelJS 內部 CellMatrix.addCellEx 加上「超大範圍直接略過」的防護。
//   - 實測同一檔案：4GB+（OOM）→ 約 22MB。
//   - 只略過 defined name 索引，不動工作表內容／欄列數／樣式（讀取結果完全一致）。
//   - 一般合法 defined name（如 SLI/ELI 模板的 Print_Area：air!$A$1:$I$74，僅 666 格）
//     遠小於門檻，不受影響（已用 cainiao-sli-eli-template.xlsm/.xlsx 驗證）。
//
// 設計：
//   - 只做 prototype patch、不修改 node_modules 檔案：npm install / 重新部署後依然有效。
//   - prototype patch 為全 process 生效（ExcelJS 內部與外部 require 到的是同一份模組實例）。
//   - 在「會讀取使用者上傳檔案」的模組最上方 require 本檔即可（須早於任何 xlsx readFile / load）。

// 單一 defined name 範圍可展開的最大格數。正常 Print_Area / _FilterDatabase 只有數百～數千格；
// 超過此值視為異常（WPS 常見的整表範圍），直接略過以免 OOM。
const MAX_DEFINED_NAME_CELLS = 1000000;

function install() {
  let CellMatrix;
  try {
    // ExcelJS 內部模組；與 defined-names.js 使用的是同一份 require 快取，patch prototype 即對其生效
    CellMatrix = require('exceljs/lib/utils/cell-matrix');
  } catch (err) {
    // 未來 ExcelJS 升版若改變內部路徑，僅失去本防護，不應讓整個服務起不來
    console.warn('[xls-exceljs-guard] 無法載入 ExcelJS 內部模組，略過 OOM 防護：', err.message);
    return false;
  }

  if (CellMatrix.prototype.__aglDefinedNameRangeGuard) return true;

  const originalAddCellEx = CellMatrix.prototype.addCellEx;
  CellMatrix.prototype.addCellEx = function addCellEx(address) {
    if (address && address.top !== undefined) {
      const area = (address.bottom - address.top + 1) * (address.right - address.left + 1);
      if (area > MAX_DEFINED_NAME_CELLS) {
        // 略過：不逐格展開（不佔記憶體；defined name 非本專案使用範圍）
        return;
      }
    }
    return originalAddCellEx.call(this, address);
  };
  CellMatrix.prototype.__aglDefinedNameRangeGuard = true;
  return true;
}

const installed = install();

module.exports = { MAX_DEFINED_NAME_CELLS, installed };
