# ULD 夾重系統 — Phase 2 交接文件（未完成工作）

> 狀態：**Phase 1 已完成並驗證**（DB／API／前端／測試／文件）；**Phase 2 的 W1／W2／W3／W4／W5 已完成（2026-11-05）**；
> **Phase 3 的 R1／R2／R3／R4 也已完成（2026-11-05）** → **目前沒有必辦項**。
> 本檔保留 Phase 2 的歷程與陷阱；**下一輪要做的事見 §0.5 與 `docs/design/uld-weight-remaining-work.md`**。
> 設計與規則細節見 `docs/design/uld-weight-system.md`（Phase 1 設計文件）。

---

## 0. 一句話現況

側欄已有「ULD 夾重系統」（`#section-uld-weight`，admin/staff）。可建立夾重表、輸入多個收貨單位（P/X 板、B 散貨）與多票 MAWB、多票按比例夾重、取整（P/X 整數、B 0.5/1.0）、尾差吸收、檢核、鎖定、複製、匯出 Excel／複製摘要。
**MAWB 可直接搜尋打板計劃的 Booking Record 帶入**（W1：自動帶件數／重量／Port，寫 `mawb_record_id`；也可純手動輸入）。
**鎖定後可把夾重結果回寫 Booking Record**（W2：`gross_weight`，同票跨板加總、冪等、原重量留 `audit_log`；不動訂單）。
**可從 RCL 磅單（Excel／CSV）匯入收貨單位**（W3：自動找表頭＋欄位對應可調，勾選後加入草稿；只解析不寫 DB）。
**可直接列印 A4 報表／另存 PDF**（W4：`@media print` ＋ 編輯畫面「🖨 列印」按鈕，草稿／鎖定都能印；只印表頭、每板 RCL − Tare = 淨重、每票最終重量、磅差與全表合計）。
**磅差警示門檻可調**（W5：表頭「磅差警示 %／kg」，存進 `uld_weight_sheets.diff_warn_pct／diff_warn_kg`；`LIH` 檢核已細分三種代碼）。
**可下載 server 端正式 PDF**（R1：編輯畫面「⤓ PDF」→ `GET /api/uld-weight/sheets/:id/report.pdf`，固定 A4 直式排版、中文用 CJK 子集，草稿／鎖定都能下載）。
**多票夾重比例可設上下限**（R2：表頭「比例下限 %／上限 %」，0＝不限；無解時提 `CLAMP_INFEASIBLE` 警示）。
**明細以 id 做 diff 更新**（R3：儲存後 `uld_weight_ulds`／`uld_weight_items` 的 id 不再變動）。
**fresh DB 的 seed 競態已修**（R4：`companies` 建表即含 `company_code`；`server.js` 等 `db.ready` 才跑 seed）。
**多張夾重表可一次打包成 ZIP 下載**（V2：清單頁勾選 →「⤓ 批次 PDF」→ `GET /api/uld-weight/sheets/batch-pdf`，`archiver` 記憶體打包＋`manifest.txt`，上限 50 張）。
**可把夾重表上「還沒連結 Booking」的票反推回打板計劃**（V1：編輯畫面「⇧ 補建 Booking」→ `POST /sheets/:id/sync-bookings`，
**預設 dry_run 只回預覽**，確認後才寫入；打板計劃已有同號 MAWB 只連結、不重複建立；`gross_weight` = 夾重後重量；不動訂單）。
**每次異動都留版本、可比較差異**（V3：`uld_weight_versions` ＋ 編輯畫面「🕘 版本」→ `GET /sheets/:id/versions`、
`/versions/diff?from=&to=`；比對規則在共用純函式 `public/js/uldweight/version-diff.js`；每張表保留最近 30 版）。

---

## 0.5 ▶ 下一輪要做的事（新對話直接從這裡開始）

> **未完成工作的獨立交接檔**：`docs/design/uld-weight-remaining-work.md`（已完成清單、V4 量測結論、
> 待決 D3／D5／D6、新陷阱、限制、驗證指令、新對話提示詞）。以下 Phase 2 內容留作歷程參考。

> 已完成：W1（MAWB 從 Booking Record 帶入）、W2（回寫 Booking Record）、W3（RCL 磅單匯入）、
> **W4（列印／PDF 報表 —— 做法 A `@media print`）**、**W5（磅差門檻可調＋LIH 檢核細分）**、
> **R1（server 端 PDF `report.pdf`）／R2（比例上下限）／R3（明細 diff 更新）／R4（seed 競態）（皆 2026-11-05）**、
> **V2（批次 PDF 打包 ZIP）／V1（補建 Booking Record）／V3（歷史版本／異動比對）（皆 2026-11-06）**。
> **目前沒有「待做」的必辦項**；V4 已量測結案（不做節流），剩下的只有 D3／D5／D6 待決事項。
> **V4 已於 2026-11-06 量測完畢 → 不需要做**：`npm run bench:uldweight`（`scripts/bench-uld-weight-calc.js`）
> 實測 50 板 × 10 票 median **約 0.6ms**、100 板 × 20 票 **約 2.4ms**（門檻 16ms）。細節見 `uld-weight-remaining-work.md` §1.1。
> **U1／U2／U3（2026-11-06 完成）**：減法版面（工具列分組／表頭 5 欄＋⚙ 進階／卡片網格可拖曳／底部 PLAN·RCL·DIFF 以 K 顯示）、
> 輸入加速（Enter 加入、貼上多列、41 板上限）、單板 Loading Sheet PDF（`GET /sheets/:id/loading-sheet.pdf?unit=`）。

### N1（＝W4）列印／PDF 報表 — **已完成（2026-11-05，做法 A）**
- **目的**：夾重結果要交給倉庫／貨站核對，目前只有 Excel 與文字摘要。
- **做法 A（已做）**：`@media print`
  - `public/css/uld-weight.css` 檔尾新增 `@media print`：`@page { size: A4 portrait; margin: 10mm 10mm 12mm }`、
    隱藏 `.sidebar`／`.uldw-header-actions`（頁面上的新增／匯出按鈕）／`.uldw-editor-actions`／`.uldw-rcl`（匯入面板）／
    所有 `.uldw-btn`／勾選欄與列操作欄／`.uldw-item-add`（新增 MAWB 列）／`.uldw-dirty`／`.uldw-print-hide`；
    輸入框與下拉**去框線、去底色、只留值**；主內容與卡片去裝飾、`.uldw-columns` 改**單欄**；
    `.uldw-unit` 與 `.uldw-totals` `break-inside: avoid`；數字欄 `font-variant-numeric: tabular-nums`；
    `.uldw-table-wrap` 改 `overflow: visible`（不裁切）。表頭印 表號／狀態／日期／貨站／航班／航班日期／經手人／備註
    （`B 取整`、`尾差` 兩欄標 `uldw-print-hide`，紙本不需要）。
  - 編輯畫面（`render.js` 的 `.uldw-editor-actions`）加「🖨 列印」按鈕（`data-action="print"`，**草稿／鎖定都沒有 disabled**）；
    `uld-weight.js` 的 `onRootClick` → `printCurrent()` → `window.print()`。
- **做法 B（還沒做，等 D4）**：後端 `GET /api/uld-weight/sheets/:id/report.pdf`（`pdf-lib` 已在依賴內；
  中文字型參考 `scripts/pdf-cjk-font.js`、疊字／排版參考 `scripts/sli-eli-overlay.js`），回傳 `application/pdf`
- **驗收**：Chrome 列印預覽 A4 直式 → 每板區塊不跨頁、數字不截斷、看不到側欄／按鈕；
  前端測試 §14（10 項）已檢查「列印按鈕存在、鎖定時仍可用、CSS 規則齊備」；其餘測試不變動通過。
  實機列印預覽仍建議人工確認一次（本專案沒有 headless browser，無法自動驗 PDF 頁數）。

### N2（＝W5）磅差門檻可調 ＋ LIH 檢核訊息細分 — **已完成（2026-11-05）**
- **原現況（已解決）**：`calc.js` 已支援 `options.diffWarnPct／diffWarnKg`，但表頭／DB 沒有欄位（實際都用預設 2% / 100kg）；
  `LIH_MISMATCH` 只有一個代碼（`detail` 文字不同）。
- **實作結果**
  1. `db/database.js`：`uld_weight_sheets` 的 `CREATE TABLE IF NOT EXISTS` 內加 `diff_warn_pct REAL DEFAULT 2`、
     `diff_warn_kg REAL DEFAULT 100`；**既有 DB 用 `PRAGMA table_info` ＋ `ALTER TABLE` 補**（這個檔的 `ensureColumn`
     只給 `orders` 用，所以另寫一段，放在 `uld_weight_*` 建表／建索引之後）。
  2. `routes/uld-weight.js`：`normalizeHeader()` 收 `diff_warn_pct`（上限 100）／`diff_warn_kg`（上限 100000），
     **0／未填 → 回預設 2 / 100**；`serializeSheetRow()` 回傳這兩個值（清單與明細都有）；
     POST／PUT／duplicate 的 INSERT／UPDATE 都寫入；`loadSheetDetail()` 與 PUT 前的 `uldComputeSheet()` 都把它們傳進 calc。
  3. 前端：表頭新增「磅差警示 %」「磅差警示 kg」兩個數字輸入（`data-header="diff_warn_pct"`／`diff_warn_kg`，
     標 `uldw-print-hide` 不印）；`state.js` 的 `uldSheetFromApi()`（舊資料預設 2/100）／`uldSheetPayload()` 帶欄位；
     `uld-weight.js` 的 `onRootInput` 用 `NUMERIC_HEADER_FIELDS` 存成**數字**並只 `refreshComputed()`（不重畫、不失焦）。
  4. 檢核細分：`LIH_MISMATCH` 拆成 `LIH_UNIT_MISSING`（票有 UN、單位標 N）／`LIH_UNIT_ONLY`（單位標 UN、票都沒有）／
     `LIH_UN_CODE_MISMATCH`（兩邊都有但號碼不同），`detail` 會帶票的 UN 編號；`DIFF_TOO_BIG` 的 `detail` 也帶出門檻文字。
     `uldComputeUnit()` 回傳 `diffWarnPct／diffWarnKg`（實際使用的門檻），方便前端／測試檢查。
- **驗收（已通過）**：calc 新增 11 項（3 種 LIH＋門檻放寬／收緊／表頭帶入）、frontend 新增 §15（10 項）、
  API 新增 8 項（PUT／GET 往返、`unit.calc.diffWarnPct`、duplicate 帶門檻、2%/100kg 與 40%/1000kg 的行為差異、未帶欄位回預設）。

### 選用（有時間再做）
- **W4 做法 B**：server 端正式 PDF 檔（`GET /sheets/:id/report.pdf`，pdf-lib；等 D4）
- **W6**：多票夾重比例上下限（`calc.js` 是純函式，加 clamp 後補 CASE 測試）
- **W8**：只在大表真的變慢時才把「明細整批重建」改成 diff 更新

---

## 1. Phase 1 已完成（勿重做）

| 項目 | 位置 |
|---|---|
| 計算核心（前後端共用、純函式 ESM） | `public/js/uldweight/calc.js` |
| 前端狀態／渲染／API 層 | `public/js/uldweight/{state,render,api}.js` |
| **MAWB 從打板計劃帶入（W1）** | `public/js/uldweight/booking-search.js`（前端）＋ `GET /api/uld-weight/bookings`（後端） |
| **回寫 Booking Record（W2）** | `calc.js` 的 `uldBookingTotals()` ＋ `POST /api/uld-weight/sheets/:id/apply` ＋ 前端「套用到 Booking」按鈕 |
| **RCL 磅單匯入（W3）** | `public/js/uldweight/{rcl-parse,rcl-import}.js` ＋ `POST /api/uld-weight/sheets/:id/import-rcl` ＋ 前端「⇪ 匯入 RCL」面板 |
| **列印／PDF 報表（W4）** | `public/css/uld-weight.css` 的 `@media print` ＋ `render.js` 的「🖨 列印」（`data-action="print"`）＋ `uld-weight.js` 的 `printCurrent()` → `window.print()` |
| **磅差門檻可調＋LIH 細分（W5）** | `uld_weight_sheets.diff_warn_pct／diff_warn_kg`（`db/database.js`）＋ `routes/uld-weight.js` 的 `normalizeHeader()`／`loadSheetDetail()` ＋ 表頭「磅差警示 %／kg」（`render.js`）＋ `calc.js` 的 `LIH_UNIT_MISSING／LIH_UNIT_ONLY／LIH_UN_CODE_MISMATCH` |
| 入口與事件委派、Excel／摘要匯出 | `public/js/uld-weight.js`（`window.setupUldWeightSection`） |
| 樣式 | `public/css/uld-weight.css` |
| 後端 API（admin/staff） | `routes/uld-weight.js`（`/api/uld-weight`，掛在 `server.js`） |
| 資料表 3 張 | `db/database.js`：`uld_weight_sheets` / `uld_weight_ulds` / `uld_weight_items` |
| 側欄與權限 | `public/index.html`（`#section-uld-weight`）、`public/js/main.js`（admin/staff 才初始化）、`public/js/auth.js`（鎖頭）、`scripts/fix-nav-order.js`（`DEFAULT_ORDER`） |
| 測試 | `scripts/test-uld-weight-calc.js`（101 項）、`test-uld-weight-rcl.js`（28 項）、`test-uld-weight-frontend.js`（131 項，§14＝W4 列印、§15＝W5 門檻／LIH、§16＝R2 上下限、§17＝R3／R1、§18＝V2 批次勾選、§19＝V1 補建按鈕、§20＝V3 版本比對）、`test-uld-weight-api.js`（端對端，含 W5 門檻往返、R1／R2／R3／R4、V2 批次 ZIP、V1 補建 Booking、V3 版本清單／diff） |
| npm scripts | `test:uldweight`、`test:uldweight-api` |

**已定案的業務規則（不要自行改掉）**
- ~~`目標淨重 R = RCL Gross − Tare`；**B（散貨）Tare 一律 0**~~
  → **2026-11-07 改為 `目標淨重 R = RCL WT`（RCL 欄填的就是淨重，不扣 Tare；Tare 只顯示參考）**，
  見 `docs/design/uld-weight-remaining-work.md` §0.2
- 磅差 `D = R − Σ 申報重量`；**未勾選夾重的票重量不變**
- 取整：**P/X 一律正整數（1.0）**；**B 可選 0.5 或 1.0**（表頭 `round_b`）
- 尾差預設由「申報重量最大的夾重票」吸收（`tail_mode = adjust_largest | equal | none`）
- **不檢核 Port**（ULD 可與各票不同、同板各票可不同＝MIX 混裝）
- **Pre-decl Type 完全手動**（1 板 1 MAWB 也可能是 X，不做自動判定）
- 物料重量只作「磅差說明」，仍全額由夾重票吸收
- 磅差警示門檻：**`%` 與 `kg` 需「同時」超過**才提示 `DIFF_TOO_BIG`（預設 2% / 100kg，表頭可調；0 或空白＝用預設）

---

## 2. 未完成工作（依建議順序）

### ✅ W1. MAWB 從「打板計劃」帶入（**已完成 2026-11-05**）
- **後端**：`routes/uld-weight.js` 新增 `GET /api/uld-weight/bookings?search=&dest=&limit=`
  - 讀 `mawb_records`（`BOOKING_SELECT_SQL` + `serializeBooking()`，比照 `routes/pallet.js`；只讀不寫）
  - `search` 比對 MAWB／HAWB／客戶／DEST／SPL；`dest` 精確比對；`limit` 預設 50、上限 500
  - 回 `{ data: [...] }`（`id`／`mawb`／`dest`／`pcs`／`gross_weight`…），權限與其他 `/api/uld-weight` 相同（未登入 401）
- **前端**：`public/js/uldweight/booking-search.js`（新檔）＋ `api.js` 的 `fetchBookings()`
  - `render.js` 的「新增 MAWB」列把 MAWB 輸入框包進 `.uldw-ac-field`，`renderEditor()` 尾端呼叫
    `wireBookingPickers(root)` → 接 `window.setupAutocomplete`（**每次重畫都重綁**，沒有 autocomplete 就退回純手動輸入）
  - 下拉顯示 `MAWB ｜ DEST ｜ 件數 ｜ 重量`；選到後 `input.value` 只留 MAWB，並帶入
    `draft.pcs`（`mawb_records.pcs`）／`draft.declared_weight`（`gross_weight`）／`draft.port`（`dest`，使用者已填就不覆蓋）
    與 `draft.mawb_record_id`，下方顯示「已帶入 Booking #N…」提示
  - `addItem()` 把 `mawb_record_id` 寫進 item（`uldSheetPayload` 既有欄位），明細列的 MAWB 輸入框會顯示 `title="已連結打板計劃 Booking Record #N"`
  - **手動輸入仍可用**：手動改字會即時把 `mawb_record_id` 清成 `null`（重量／件數保留）
  - 候選清單快取：先抓最近 200 筆（60 秒），本機比對不到才打 `search`（30 秒），避免每打一個字就打一次 API；
    「重新整理」會呼叫 `resetBookingCache()`
- **驗收（已通過）**：`npm run test:uldweight`（59 項，含 W1 的 18 項）＋ `npm run test:uldweight-api`
  （新增 Booking → `GET /bookings` 帶回 12 件／345.5kg／DEST=LAX → 存夾重表後 `mawb_record_id` 有落庫）

### ✅ W2. 夾重後重量回寫 Booking Record（**已完成 2026-11-05**，D1 已決）
- **D1 決定**：僅 `status = 'locked'` 可套用；只更新 `mawb_records.gross_weight`（同票跨板加總）；
  原重量與新重量寫進 `audit_log.detail`（不改 schema）；**不動 `orders.weight_kg`**（避免夾重結果覆蓋訂單申報重量）。
- **算法**：新增 `calc.js` 的 `uldBookingTotals(computed)`（純函式，前後端共用）——依 `mawb_record_id` 彙總
  `final`，回 `{ entries, unlinked, conflicts }`；**沒有另寫第二份算法**。
  - `unlinked`：明細沒有 `mawb_record_id`（手動輸入的 MAWB）→ 不回寫
  - `conflicts`：`duplicate_booking`（同一 MAWB 對到多個 Booking）／`mawb_mismatch`（同一 Booking 有多個 MAWB 號碼）→ 不回寫
- **後端**：`POST /api/uld-weight/sheets/:id/apply`
  - 未鎖定 → **409**（訊息「夾重表尚未鎖定…」）；找不到表 → 404
  - 逐票 `UPDATE mawb_records SET gross_weight = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`（絕對值覆寫，**冪等**）
  - 重量相同 → `skipped(unchanged)`（不重複寫入、audit_log 不長噪音）；`booking_not_found` → `skipped`
  - 有實際變更才寫 `audit_log`（action `uld_weight.apply`，`detail` 為 JSON：sheet_no／applied（before→after）／skipped／conflicts）
  - 回 `{ data: { applied, skipped, conflicts }, sheet: <明細（即時重算）> }`
- **前端**：`api.js` 的 `applySheet(id)`；`render.js` 編輯畫面新增「套用到 Booking」按鈕（**草稿時 disabled**、鎖定後可按）；
  `uld-weight.js` 的 `applyToBookings()` → confirm → 依 applied／skipped／conflicts 產生報告（原因代碼已翻成中文）並 toast
- **驗收（已通過）**：CASE 4 鎖定後套用 → Booking a 維持 300、Booking b **1000 → 1013**、
  重複套用 0 票變更（不累加）、`audit_log` 留有 before/after

### ✅ W3. RCL 磅單匯入（**已完成 2026-11-05**；D2 未提供樣本 → 採通用欄位對應）
- **做法（不寫死三家欄位位置）**：`POST /api/uld-weight/sheets/:id/import-rcl`（multer 記憶體上傳，10MB 上限）
  - 只解析、**不寫 DB**：回 `{ data: { file_name, sheet_name, sheets, header_row, header, columns, grid, rows, skipped } }`
  - 支援 `.xlsx`／`.xlsm`（ExcelJS，已挂 `scripts/xls-exceljs-guard` 防 OOM）、`.csv`／`.tsv`（自寫 parser，支援引號／BOM／Tab）；
    舊版 `.xls` 直接回 400「請另存為 .xlsx 或 .csv」
  - **解析邏輯是前後端共用的純函式** `public/js/uldweight/rcl-parse.js`（後端以 `import()` 載入）：
    `rclFindHeaderRow()`（前 20 列找表頭）、`rclDetectColumns()`（中英關鍵字猜 ULD／Tare／Gross／件數）、
    `rclRowsFromGrid()`（略過空列／無 ULD／無磅重，重複 ULD 只取第一筆，磅重 < Tare 給警告，上限 200 筆）
  - 可帶 `sheet`（工作表名稱）與 `col_uld/col_tare/col_gross/col_pcs`（0-based 欄位覆寫，`-1` = 不使用）
  - 未鎖定才可匯入（鎖定 → **409**）、找不到表 → 404、沒檔案／格式不支援 → 400、未登入 → 401
  - **保留空白列**：`grid` 不壓縮空列，畫面的「列」= Excel 實際列號（方便對照紙本）
- **前端**：`public/js/uldweight/rcl-import.js`（`pickRclFile()`／`loadRclPreview()`／`applyRclColumns()`／`selectedRclRows()`／`rclUldKey()`）
  + `render.js` 的匯入面板（檔名／工作表切換／4 個欄位對應下拉／可勾選的單位表／略過原因）
  - 「① 收貨單位」標題列新增 **⇪ 匯入 RCL**（鎖定時 disabled）→ 選檔 → 面板出現 → 調欄位／勾選 → **加入選取的單位**
  - 加入時建立草稿單位（`kind=ULD`、`predecl_type` 預設 **P**、`lih_type` 預設 N），並略過夾重表已存在的 ULD#；
    加入後仍需按「儲存」（未填 MAWB 會有 `NO_SQUEEZE` 錯誤，這是刻意的）
  - 改欄位對應／勾選只重畫面板（`refreshRclImport()`），不整份重畫
- **驗收（已通過）**：API 測試自建 xlsx（標題列＋空列＋表頭在第 3 列）→ 表頭列 3、欄位 0/1/2/3、
  2 筆可建立、重複與 0 磅重被略過、`col_pcs=-1` 生效、CSV 可解析、匯入不寫 DB、鎖定 409。
  前端測試：面板渲染／勾選狀態／欄位重算／鎖定時按鈕 disabled。

### W4. 列印／PDF 報表 → **做法 A（`@media print`）已完成；做法 B（server PDF）也已完成（R1，2026-11-05）**
- 目的：夾重結果交給倉庫／貨站核對（Excel／文字摘要之外，可直接印 A4 或另存 PDF）。
- 已做：`@media print`（A4 直式、單欄、每板不跨頁）＋「🖨 列印」按鈕（草稿／鎖定都可印）。
- 已做（R1）：server 端正式 PDF `GET /sheets/:id/report.pdf`（`scripts/uld-weight-report-pdf.js`，
  `pdf-lib` ＋ `scripts/pdf-cjk-font.js` 的 CJK 子集）＋編輯畫面「⤓ PDF」按鈕（`fetchReportPdfBlob()`）。
  與 `@media print` **並存**（列印照舊，不受影響）。

### W5. 檢核與參數可調 → **已完成（2026-11-05）**
- 已做：`diff_warn_pct`／`diff_warn_kg` 做成夾重表欄位（表頭可調，DB＋API＋前端往返）；
  `LIH_MISMATCH` 細分為 `LIH_UNIT_MISSING`／`LIH_UNIT_ONLY`／`LIH_UN_CODE_MISMATCH`。
- 詳見 §0.5 N2。

### W6. 多票夾重的進階分配 → **已完成（R2，2026-11-05：比例上下限）**
- **現況**：重量／件數／平均／手動 %；**另有比例上下限**（表頭「比例下限 %／上限 %」，0＝不限）。
- **做法**：`calc.uldApplyRatioClamp()`（water-filling，超出界線的票固定在界線、其餘按原始比例重分配），
  ≥2 票才生效；無解（例：3 票各最少 50%）→ 忽略上下限 ＋ `CLAMP_INFEASIBLE`（warn）。
- **未做**：按「kg」限額（目前是 %）、「排除某票不吸收負磅差」。

### W7. 已知 bug（與本功能無關，但測試時踩到，建議順手修）→ **已修（R4，2026-11-05）**
- **現象**：**全新資料庫**第一次啟動時，`server.js` 立刻 `execFile(scripts/seed-admin.js)`，但 `companies.company_code` 是稍後由 `db/database.js` 的 `PRAGMA`/`ALTER TABLE` 補上 → seed 失敗（`no such column: company_code`）→ **沒有預設 admin 帳號**。
- **實際修法（兩招都做）**：① `db/database.js` 的 `CREATE TABLE companies` 直接包含 `company_code TEXT`；
  ② `db/database.js` 匯出 `db.ready`（`initTasks` 全部完成才 resolve），`server.js` 等它才跑 `seed-admin.js`。
- **測試**：`scripts/test-uld-weight-api.js` 啟動後先直接查 DB 確認 admin 存在（`waitForAdmin()`），才補跑 idempotent seed。

### W8. 資料量與效能 → **已完成（R3，2026-11-05：明細 diff 更新）**
- **現況**：清單 `LIMIT 200`；單表上限 100 個單位 × 每單位 300 票；
  **儲存改為以 id 比對**（UPDATE 既有列／INSERT 新列／DELETE 缺的列），儲存後 id 不再變動。
- **相容**：沒帶 id 的 payload（舊前端／外部呼叫）仍可存 —— 會整批重建（舊行為）。
- **待做（僅在真的變慢時）**：加複合索引、或把 `loadSheetDetail()` 的明細查詢改成單一 JOIN。

---

## 3. 需要使用者先決定的事（D = Decision）

| 編號 | 問題 | 影響 |
|---|---|---|
| **D1** | ~~夾重後重量要不要回寫 `mawb_records.gross_weight`？要在「鎖定後」才可套用嗎？要不要保留原重量？~~ **已決（2026-11-05）**：僅鎖定後可套用、只改 `mawb_records.gross_weight`、原重量寫 `audit_log.detail`、**不動 `orders`** | W2 已完成 |
| **D2** | ~~需要 RCL 磅單匯入嗎？請提供 HACTL / AAT / CPSL 的磅單樣本~~ **已決（2026-11-05）**：先做**通用欄位對應**（無樣本也能用）；日後若提供樣本，可再加「貨站 preset」（記住欄位組合） | W3 已完成 |
| **D3** | 交散貨（B）是否要「批號／RCL 號」對應？目前只有 `bulk_ref` 自由欄位 | W3 / 報表欄位 |
| **D4** | ~~報表要列印（A4 PDF）還是只要 Excel 更好看？~~ **已決（2026-11-05）**：先做瀏覽器列印／另存 PDF（`@media print`，W4）；**並確定要做 server 端 `report.pdf`（固定排版、可批次寄送）→ R1 已完成（2026-11-05，`scripts/uld-weight-report-pdf.js`）** | W4／R1 完成 |
| **D5** | 取整是否需要支援 0.1（少數航司）？ | calc.js 的 `roundInc`（目前已支援任意值，只缺 UI 選項） |
| **D6** | 「同一 MAWB 跨板」目前要手動按 `⇄` 依件數拆分，是否要改成存檔時自動拆？ | 影響是否會覆蓋使用者手改的重量 |

---

## 4. 陷阱（實作時踩過，別再重試）

1. **ESM 的計算核心不能 `require`**：`public/js/uldweight/calc.js` 是 ESM，後端是用
   `const calcReady = import(pathToFileURL(...).href)` → 每個 route 內 `const calc = await calcReady;`。
   專案 `package.json` 沒有 `"type": "module"`，所以 Node 會噴 `MODULE_TYPELESS_PACKAGE_JSON` 警告（正常）。
2. **算法只能有一份**：前端與後端都必須走 `calc.js`。若在後端另寫一份，會出現「畫面算一套、DB 存另一套」。
3. **前端輸入框不要整份重畫**：`render.js` 的 `refreshComputed()` 只更新計算結果（`data-calc` 區塊），
   輸入事件（`onRootInput`）走它；只有「下拉／勾選／結構變更」才 `render()` 整份重畫。否則打字會失焦。
4. **422 與 409 不同**：422 = 資料語意錯（有 error 級檢核）；409 = 已鎖定不可修改。前端要分別提示。
5. **`apiFetch` 遇 401 會直接跳登入頁**：任何新增的 API 呼叫都要走 `apiFetch`（`public/js/utils/api.js`），不要用原生 fetch。
6. **新增側欄項目要改 3 個地方**：`index.html` 的 nav、`scripts/fix-nav-order.js` 的 `DEFAULT_ORDER`、
   `scripts/test-nav-order-frontend.js` 的 `NAV_ITEM_HREFS`；改完跑 `node scripts/fix-nav-order.js`（修既有使用者的排序）。
7. **`database.db` 的 schema 變更**：只在 `db/database.js` 加 `CREATE TABLE IF NOT EXISTS`（或 `ensureColumn`），
   不要手改 DB；跑一次伺服器就會建表。
8. **測試要自帶暫存 DB**：`scripts/test-uld-weight-api.js` 用 `DB_PATH` 指到 `data/test-uld-weight-*.db`（跑完刪除），
   別直接對正式 `database.db` 做寫入測試。
9. **編輯器插入位置**：這個 repo 的 large edit 容易插錯位置（我踩過一次把整段插進陣列裡），
   編輯後**先 `node --check <file>`**（CJS）或 `node -e "import('file:///…')"`（ESM）確認語法。
10. **W1 的 autocomplete 字串陷阱**：`setupAutocomplete` 的 `onSelect(value)` 拿到的是「顯示字串」，
    而它會先把 `input.value` 設成整串。所以下拉字串第一段必須是 MAWB（用 ` ｜ ` 分隔），
    `onSelect` 內一定要再 `input.value = mawb`，否則 MAWB 欄位會變成「160-… ｜ LAX ｜ 12件 ｜ 345.5kg」。
11. **W1 的綁定時機**：autocomplete 是「每個 DOM 元素一份」，所以 `renderEditor()` 尾端每次都要
    呼叫 `wireBookingPickers(root)`（`render()` 會在切換下拉／勾選時整份重畫）。`refreshComputed()` 不重畫，
    不需要重綁。沒載入 `utils/autocomplete.js` 時 `wireBookingPickers()` 會直接 return（純手動輸入照常可用）。
12. **`POST /api/pallet/bookings` 回 200（不是 201）**：寫 API 測試時別斷言 201。
13. **`refreshComputed()` 只管計算**：新增 Booking 帶入的是「草稿」（`unit.draft`），不進計算、不改 payload，
    要按「加入」才會變成 item（`mawb_record_id` 在那時才寫入）。
14. **`409` 同時有兩種意思**：`PUT/DELETE` 已鎖定不可改 → 409；**apply 尚未鎖定不可套用 → 也是 409**。
    前端要靠 `error` 訊息分辨（不可只依 status code 判斷）。
15. **套用是「絕對值覆寫」不是累加**：`UPDATE mawb_records SET gross_weight = ?`（用重算後的最終重量），
    重量相同時走 `skipped(unchanged)`；**不要改成 `gross_weight = gross_weight + diff`**，否則每按一次就多一次磅差。
16. **`audit_log.detail` 是 JSON 字串**：要檢查時 `JSON.parse`（例：`GET /api/db/tables/audit_log` 找 action `uld_weight.apply`）。
17. **回寫刻意不動訂單**：`mawb_records` 有 `order_id` 時，打板計劃的 `PUT /bookings/:id` 會反向同步 `orders`；
    W2 **不同步**（D1 決定：夾重結果不覆蓋訂單申報重量）。若日後要同步，請在 apply 內另外處理並重新確認規則。
18. **`uldBookingTotals()` 的衝突保護**：同一 MAWB 對到多個 Booking（`duplicate_booking`）、或同一 Booking 有多個
    MAWB 號碼（`mawb_mismatch`）時**一律不回寫**，只在回傳的 `conflicts` 列出——別為了「全都要寫」而拿掉。
19. **W3 的 grid 不壓縮空白列**：`sheetToGrid()`／`csvToGrid()` 都保留空白列，畫面的「列」才會等於 Excel 實際列號
    （`headerRow + row.row`）。若為了縮小 payload 而濾掉空列，使用者會對不上紙本 RCL 的列號。
20. **W3 只解析、不寫 DB**：`import-rcl` 回傳候選清單，真正的寫入是前端併進 `unit.draft`／`ulds` 後按「儲存」走原本的
    `PUT /sheets/:id`（422/409 規則不變）。**不要**在 import 端點裡直接 INSERT `uld_weight_ulds`（會繞過重算與檢核）。
21. **W3 的 ExcelJS 需先掛 OOM 防護**：`routes/uld-weight.js` 最上方 `require('../scripts/xls-exceljs-guard')`
    必須早於 `require('exceljs')`；上傳用 `multer.memoryStorage()`（10MB）並限制 400 列 × 30 欄，不回寫磁碟。
22. **舊版 `.xls` 不支援**：ExcelJS 讀不了，端點直接回 400 請使用者另存 `.xlsx`／`.csv`（不要偷偷用 xlsx 套件硬讀，
    欄位型別會不一致）。
23. **列印要覆寫主題變數**：`@media print` 內要用 `html, html[data-theme]` 重新定義 `--text-main` 等變數（並加 `!important`）。
    只寫 `:root` 會被 `[data-theme="dark"]` 蓋掉（特異度相同、後載入者勝），深色主題會「白字印白紙」。
24. **鎖定（disabled）的輸入框會印成灰字**：Chrome 是用 `-webkit-text-fill-color` 上色，只設 `color` 沒用；
    列印區塊一定要 `-webkit-text-fill-color: #000 !important`（否則紙本看不到重量）。
25. **`.uldw-table-wrap` 有 `overflow: auto`**：列印時會被裁掉，`@media print` 內要改成 `overflow: visible`；
    同時保留 `white-space: nowrap` + `tabular-nums`，數字才不會換行或截斷。
26. **列印按鈕不能 disabled**：草稿也要能印（只有「儲存／套用／匯入 RCL／刪除」在鎖定時才 disabled）。
    前端測試 §14 會檢查 `data-action="print"` 沒有 disabled，別「順手」統一加 `dis`。
27. **列印不要另開視窗、也不要重畫 DOM**：`printCurrent()` 只呼叫 `window.print()`（先確認 `view === 'editor'`）。
    重畫（`render()`）會讓輸入中的欄位失焦；input 的值本來就會直接印出來，不需要另做一份報表 HTML。
28. **列印只留結果**：`B 取整`／`尾差` 這兩個操作型表頭欄位在 `render.js` 標了 `uldw-print-hide`；
    新增表頭欄位時要一起考慮「紙本需不需要」，不需要就加這個 class。
29. **磅差門檻是「AND」不是「OR」**：`DIFF_TOO_BIG` 要 `|diff| > warnKg` **且** `|diffPct| > warnPct` 才會提示；
    只調其中一個常常「看起來沒變」（測試／驗收要把兩個條件都算進去，別把條件改成 OR）。
30. **門檻 0／空白 = 用預設**：`calc.js`、`normalizeHeader()`、`state.js` 三處都把 `0` 視為「未設定」→ 2% / 100kg。
    要「幾乎不警示」請設很大的值（例如 100% / 100000kg），不要設 0。
31. **既有 DB 補欄位不能靠 `ensureColumn`**：`db/database.js` 的 `ensureColumn` 是 `orders` 那段 `db.serialize` 內的區域函式；
    `uld_weight_sheets` 要自己寫 `PRAGMA table_info(uld_weight_sheets)` ＋ `ALTER TABLE`，且**放在建表之後**
    （否則 PRAGMA 看不到表 → 永遠不加）。驗證方式：拿一份舊 DB 複本設 `DB_PATH` 跑一次 `db/database.js`，看有沒有印
    `Added diff_warn_* column`。
32. **表頭數字欄要存數字並即時重算**：`uld-weight.js` 的 `NUMERIC_HEADER_FIELDS` 若漏加，門檻會被存成字串，
    而且改了門檻不會立刻看到檢核變化 → 記得走 `refreshComputed()`（**不要** `render()`，會失焦）。
33. **LIH 代碼改名前先搜全部引用**：`LIH_MISMATCH` 已經不存在（拆成 3 個）；若別處還寫死舊代碼，
    畫面會直接顯示英文代碼（`ULD_ISSUE_LABELS` 查不到就退回 `issue.code`）。
34. **`pdf-lib` 的 `.ttc` 一定要走 `CustomFontSubsetEmbedder` ＋ `PDFFont.of` ＋ `doc.fonts.push()`**
    （R1 實作照 `scripts/sli-eli-overlay.js` 的 `embedCjkFontInto()`）。少了 `doc.fonts.push()` 檔案只有 ~2 KB、中文全空白；
    含中文的正常約 37 KB。CJK 是否有真的內嵌，看檔案大小最快。
35. **PDF 內不要放 emoji／箭頭**（`→`、`⛔`、`⚠️`）：字型缺字會讓 `drawText` 丟錯。
    `scripts/uld-weight-report-pdf.js` 用 `hasGlyph()` 逐字過濾、缺字以 `?` 取代，並用 `[錯誤]`／`[警示]` 當前置字。
36. **比例上下限只管「分攤比例」且在 ≥2 票時才生效**：1 票必然 100%，硬套上限會變成「無解」；
    `uldApplyRatioClamp()` 對 `n < 2` 直接放行，無解時回原比例 ＋ `CLAMP_INFEASIBLE`（warn）。
37. **diff 更新的 payload 一定要帶 `id`**：`state.uldSheetPayload()` 少帶 id 就會退回「整批重建」（id 每次變）。
    item 的比對要加 `uld_id` 範圍（`WHERE id = ? AND uld_id = ?`），否則會改到別的板的明細。
38. **`db.ready` 只保證有登記進 `initTasks` 的相容性工作完成**：新增表的 `ALTER TABLE` 若要給 seed／啟動流程用，
    記得 push 進 `initTasks`（目前有 `companies.company_code` 與 `uld_weight_sheets` 的 4 個欄位）。
39. **V2 批次 ZIP：`archiver.append()` 只吃 `Buffer`／`Stream`**。`pdf-lib` 的 `doc.save()` 回傳 `Uint8Array`
    → 直接 append 會丟 `input source must be valid Stream or Buffer instance`（整批 500）；要先 `Buffer.from()`。
40. **V2 的 `/sheets/batch-pdf` 一定要宣告在 `GET /sheets/:id` 之前**（同一層路徑，`batch-pdf` 會被當成 `:id`）。
    `/sheets/:id/report.pdf` 不受影響（路徑段數不同）。
41. **V2 的勾選狀態不要靠重畫**（只更新計數／按鈕／列底色／全選框）；清單重新載入時要把已不存在的 id 剔除，
    否則會下載到清單上看不到的表。
42. **V1 補建 Booking 會寫進打板計劃**：API 端**預設 dry_run**（只有明確 `{ dry_run: false }` 才寫），前端一定要
    「預覽 → confirm → 再寫」；UI 要講清楚只會新增／連結 Booking、不動訂單與夾重表重量。
43. **V1 的 MAWB 比對要正規化**：`160 00000006`／`160-00000006` 都要對得上 → SQL 用
    `REPLACE(REPLACE(UPPER(IFNULL(mawb,'')), '-', ''), ' ', '') = ?`；回填連結則撈出該表明細用 `calc.uldMawbKey()` 比對後逐筆 UPDATE。
44. **V1 同號 MAWB 已存在就只連結**；同號多筆 → `skipped(duplicate_booking)`（不猜哪一筆）；
    `gross_weight` 一律取 `calc.uldBookingTotals().final`（與 W2 `/apply` 同源，不在 route 內自己加總）。
45. **V3 版本比對要有「欄位級」規則**（`version-diff.js` 的 `HEADER_FIELDS`／`UNIT_FIELDS`／`ITEM_FIELDS`），
    不能只比 JSON 字串；配對鍵用 **DB id**（R3 之後 id 穩定），沒有 id 的新列才退回「MAWB + 序」。
46. **`/versions/diff` 必須宣告在 `/versions/:versionId` 之前**（同層路徑，`diff` 會被當成 versionId → 400）。
47. **不帶 id 的舊格式 payload 每次儲存都會重建列 → id 全變 → 版本內容也跟著變**（會誤以為一直有新版本）；
    前端一律帶 id，API 測試重複儲存前要用 `withIds()` 補回 id。內容相同的 `save` 不留新版本，其他事件（lock／unlock／apply／sync_bookings）照留。

---

## 5. 驗證指令（改完必跑，全部應通過）

```bash
npm run sync                                  # 更新 FILE_INVENTORY.md／結構快照
npm run test:uldweight                        # calc 101 項 + rcl 28 項 + frontend 131 項（§14 列印、§15 W5、§16 比例上下限、§17 diff／PDF、§18 批次 ZIP、§19 補建 Booking、§20 版本比對）
npm run test:uldweight-api                    # API 端對端（141 項，自帶伺服器 + 暫存 DB，port 3157；含 /bookings、/apply、/import-rcl、report.pdf、batch-pdf、sync-bookings、versions、上下限、明細 id、fresh DB seed）
node scripts/test-nav-order-frontend.js       # 側欄排序
node scripts/test-nav-hierarchy.js            # 側欄主/子層級
npm run test:loadsim                          # 模擬裝板（避免動到共用模組）
node scripts/uld-weight-report-pdf.js --selftest   # 免伺服器產 PDF（%PDF- 檔頭／大小）
```

手動驗收（CASE 4）：登入 admin → ULD 夾重系統 → 新增 → 兩板（540/115、1000/112）＋兩票（300 不夾、125+888 夾）→
右側應顯示 MAWB a = 300、MAWB b = **1013**。

手動驗收（W1）：打板計劃 → 新增 Booking（MAWB `160-00000777`／DEST `LAX`／12 件／345.5kg）→
ULD 夾重系統 → 新增夾重表 → ＋新增 ULD → 在「新增 MAWB」的 MAWB 欄輸入 `160` →
下拉選到該票 → 件數 12／重量 345.5／Port LAX 自動帶入、下方顯示「已帶入 Booking #N」→
按「加入」後明細列的 MAWB 欄 hover 會顯示「已連結打板計劃 Booking Record #N」。
（直接手動打字也能加入，只是 `mawb_record_id` 為 null。）

手動驗收（W2）：CASE 4 存檔 → 「鎖定」→ 按「套用到 Booking」→ 對話框顯示
「已套用 1 票：160-00000006：1000 → 1013 kg／未更新 1 票：160-00000005：重量相同」→
打板計劃該 Booking 的 Gross 變 **1013**（a 仍 300）→ 再按一次應全部顯示「重量相同（先前已套用過）」。
未鎖定時按鈕是 disabled；直接打 API 會回 **409**。

手動驗收（W3）：新增夾重表 → 「⇪ 匯入 RCL」→ 選一份 RCL 檔（或自己用 Excel 做：第 1 列標題、第 3 列
`ULD No／Tare／Gross Weight／Pcs`、下方幾列資料）→ 面板應自動找到表頭並帶出單位 →
把「件數」欄位對應改成「（不使用）」→ 該欄變 0 → 換回原本欄位 → 勾掉其中一列 → 按「加入選取的單位」→
收貨單位卡出現該 ULD（Tare／RCL Gross／件數已填、Pre-decl 為 P）→ 補 MAWB 後儲存。
鎖定後「匯入 RCL」應為 disabled（直接打 API 回 409）。

手動驗收（W4，列印）：開一張有 3～5 板（每板 1～2 票）的夾重表 → 按「🖨 列印」（草稿與鎖定都要能按）→
Chrome 列印預覽選 **A4 直式**、邊界「預設」→ 應看到：
- 看不到側欄、頁面上方的「新增夾重表／重新整理／匯出 Excel／複製摘要」、`.uldw-editor-actions` 整排按鈕、
  「⇪ 匯入 RCL」面板、明細表的勾選欄與 ⇄／✕ 按鈕、每張卡底部的「新增 MAWB」列
- 表頭有 表號／狀態／日期／貨站／航班／經手人／備註（沒有「B 取整」「尾差」）
- 每板一行 `RCL xx − Tare xx → 淨重 xx kg`、明細每票有 MAWB／件數／申報重量／比例／最終重量／磅差
- 數字欄等寬對齊、不換行不截斷；板與板之間**不跨頁**（一張 A4 放得下 3～5 板）
- 深色主題下也應該印成**黑字白底**（切到 Dark 主題再印一次確認）

手動驗收（W5，門檻／LIH）：新增夾重表 → 表頭可見「磅差警示 %」「磅差警示 kg」（預設 2／100）→
1. 做出一板「RCL 1000／Tare 0／申報 980（單票、勾夾重）」→ 沒有「磅差過大」→ 把門檻改成 **1% / 10kg** →
   檢核立刻出現「磅差過大：磅差 20 kg（2.00%），超過警示門檻 1% / 10 kg」（不用離開輸入框、不會失焦）
2. 存檔 → 重新整理／重開 → 門檻仍是 1 / 10（PUT／GET 往返）
3. 把門檻改回 2 / 100 → 警示消失 → 存檔
4. LIH 三種情境：板 LIH 標 N、票標 UN3481 → 「票載有鋰電池但收貨單位標示 N：有 1 票載有 UN3481…」；
   板標 UN3481、票都 N → 「收貨單位標示鋰電池但沒有任何票標示」；板 UN3481、票 UN3091 → 「收貨單位與票的 UN 編號不一致」
5. 列印預覽**不會**出現「磅差警示 %／kg」這兩欄（`uldw-print-hide`）

手動驗收（R1，server 端 PDF）：開一張 3～5 板的夾重表 → 按「⤓ PDF」→ 下載 `<sheet_no>.pdf` →
用 PDF 閱讀器開：A4 直式、中文正常（不是 `?`）、每板區塊不跨頁、數字右對齊、頁尾有「第 N / M 頁」；
鎖定後再下載一次也要成功（草稿／鎖定都能下）。

手動驗收（R2，比例上下限）：一板 3 票夾重（900／50／50、RCL 2000）→ 表頭「比例上限 %」填 **40** →
最大票比例由 90% 變 **40%（數字後多一個 `*`）**、最終重量 **1300／350／350**（合計 2000）；
把上限改成 30%（只剩 2 票時）→ 檢核出現「夾重比例上下限無解」；存檔重開仍保留；列印不顯示這兩個欄位。

手動驗收（R3，明細 id 不變）：同一張表按「儲存」兩次 → 資料庫檢視器看 `uld_weight_items`／`uld_weight_ulds`
的 `id` 完全不變；改一列的申報重量再存 → 同一 id、`declared_weight` 已更新。

手動驗收（R4，fresh DB）：把 `database.db` 改名（或設 `DB_PATH` 指到新檔）→ `npm start` →
日誌應出現「已建立預設管理員：AGL / admin / admin123」→ 直接用該帳密登入成功。

手動驗收（V2，批次 PDF）：清單頁勾 2～3 張夾重表（草稿／已鎖定各一）→「⤓ 批次 PDF」→
下載 `uld-weight-batch-YYYYMMDD-HHmm.zip` → 解開應有 `manifest.txt` ＋每張一個 `<sheet_no>.pdf`
（PDF 與單張「⤓ PDF」內容一致）；`manifest.txt` 用記事本開中文不亂碼、列出表號／狀態／RCL／淨重／磅差；
「已選 N 張」與全選框會跟著勾選變化；切換狀態篩選或搜尋後，勾選只保留還看得到的表。

手動驗收（V1，補建 Booking）：做一張夾重表，其中一票是**手動輸入的 MAWB（沒連結 Booking）** → 按「⇧ 補建 Booking」→
出現預覽對話框（將建立 N 筆／將連結 M 筆／略過 K 票）→ 確定後到「打板計劃」看：
新 Booking 的 Gross 就是夾重後重量、DEST 是該票 Port、備註有「由夾重表 WGT-… 建立」；
原本就存在的同號 MAWB **不會**多一筆（只有夾重表的明細被連結）；再按一次「⇧ 補建 Booking」應顯示「不需要補建」。
夾重表有錯誤（未勾夾重…）時按下去應直接回錯誤訊息（422）。

手動驗收（V3，歷史版本）：開一張存過 2～3 次的夾重表 → 按「🕘 版本」→ 面板列出 v1…vN
（時間／動作：建立、儲存、鎖定、解鎖、套用 Booking、補建 Booking／狀態／單位·明細數／淨重／建立者）→
改一個申報重量後儲存 → 面板多一版 → 在舊版按「與前一版比」→ 下方列出「表頭／改票 申報重量 125 → 130」；
按「對目前」→ 與目前內容比較；沒改內容連按兩次儲存 → 版數不變；按「關閉」面板消失；列印預覽看不到版本面板。

---

## 6. 新對話提示詞（直接複製）

```text
延續 AGL-Web-Portal 的「ULD 夾重系統」（Phase 1 ＋ W1～W5 ＋ R1～R4 已完成）。

請先：
1) npm run sync
2) 讀 docs/design/uld-weight-remaining-work.md（已完成／V3／V4 選用項／新陷阱／驗證指令）、
   docs/design/uld-weight-phase2-handoff.md（陷阱 §4、驗證 §5）、
   docs/design/uld-weight-system.md（規則與算法）、
   CLAUDE.md 的「ULD 夾重系統」段落、WORKSPACE_STATE.md 的待辦清單。

本次目標（remaining-work §1 的選用項挑一項，或由使用者指定）：
A. V4 — 只在大表（>50 板 × 10 票）實測真的卡頓時，做即時重算節流。
B. D3／D5／D6 有答案才動（散貨批號對應／0.1 取整／跨板自動拆）。
註：W1～W5、R1（server 端 report.pdf）、R2（比例上下限）、R3（明細 diff 更新）、
R4（fresh DB seed 競態）、V2（批次 PDF 打包 ZIP）、V1（補建 Booking，預設 dry_run）、
V3（歷史版本／異動比對）都已完成，可直接沿用。

限制（不可改動的既定規則）：
- 算法只能有一份（public/js/uldweight/calc.js，前後端共用；後端用 import() 載入）；
  磅單解析也是共用純函式（public/js/uldweight/rcl-parse.js）；PDF 只吃 loadSheetDetail() 的結果。
- P/X 取整一律正整數、B 可選 0.5/1.0；未勾夾重的票重量不變；Port 不檢核；Pre-decl Type 手動。
- 磅差警示是「% 與 kg 同時超過」才算（預設 2% / 100kg；0 或空白＝用預設）。
- 比例上下限只管分攤比例、0＝不限、無解時提 CLAMP_INFEASIBLE（warn）。
- 明細以 id 做 diff 更新（前端 payload 要帶 id，新列 null）。
- 前端輸入事件只做局部重算（refreshComputed），不要整份重畫（會失焦）。
- 回寫 Booking Record 只改 mawb_records.gross_weight，不動 orders（D1 已決）。

完成後：跑 §5 全部驗證指令、更新 docs/design/uld-weight-remaining-work.md 與
docs/design/uld-weight-phase2-handoff.md（補新發現／新陷阱）、
CLAUDE.md／PROJECT_MAP.md／WORKSPACE_STATE.md，最後 npm run sync。
```

> 若 D3／D5／D6 還沒決定，先問使用者再做，不要自己假設。

