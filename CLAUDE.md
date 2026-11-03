# AGL-Web-Portal — AI 專案記憶檔

> 本檔案供 AI Agent 在每次新對話自動載入，避免重讀整個專案。
> 修改專案結構時請同步更新本檔案、`PROJECT_MAP.md`、`FILE_INVENTORY.md` 與 `WORKSPACE_STATE.md`。
> 文件分類規則見 `docs/README.md`：根目錄只放現役導航文件（README / CLAUDE / PROJECT_MAP / WORKSPACE_STATE / FILE_INVENTORY），其餘歸入 `docs/design|archive|research`。

## 🚀 新對話自動開機流程（必讀，強制執行）

> 每次新對話開始，**第一步就執行以下流程**，確保站在同一條跑線上。完成後才處理用戶問題。

1. **執行 `npm run sync`**
   - 自動更新檔案清單 + 偵測結構變更（新增/修改/刪除檔案）
   - 若輸出顯示有結構變更，先閱讀本檔案與 `PROJECT_MAP.md` 是否有對應內容，有需要就更新
2. **讀取 `WORKSPACE_STATE.md`**
   - 了解最後 commit、最近完成事項、待辦清單
3. **查詢 git 狀態**（若上一步輸出的 Git 變更狀態不清/不存在）：
   ```bash
   git status --short
   git --no-pager log --oneline -5
   ```
4. 對照 `WORKSPACE_STATE.md` 的待辦清單，確認用戶任務是哪一項（或新任務），再開始工作

## 🤖 同步與維護機制

### 結構變更自動偵測（半自動）

本檔案本身**不會自動更新**，靠以下機制保持新鮮：

1. **每次新對話開頭**：執行 `npm run sync`（見上方自動開機流程）
2. **任務中發生結構性變更時**：完成任務後**必須執行 `npm run sync`**，並同步更新本檔案、`PROJECT_MAP.md` 與 `WORKSPACE_STATE.md`
3. **執行 `npm run sync`**：掃描專案 → 取得最新結構變更 → 更新 `FILE_INVENTORY.md` → 保存 `.project-state.json` 快照

### 同步引擎（scripts/sync-project-state.js）

| 產物 | 說明 |
|------|------|
| `FILE_INVENTORY.md` | 自動產生的檔案清單（含大小、Git 變更狀態） |
| `.project-state.json` | 結構快照（hash 比對用，勿手動編輯） |
| 控制台輸出 | 列出 自上次同步以來 新增/修改/刪除 的檔案，提醒更新職責描述 |

### 結構性變更觸發表

| 觸發事件 | 例子 |
|----------|------|
| 新增/刪除/改名檔案 | 新增 `routes/xxx.js`、移動 `public/js/...` |
| 新增/移除 API 路由 | `server.js` 或任一 router 掛載新路徑 |
| 資料表變更 | `db/database.js` 新增/修改 `CREATE TABLE` |
| 依賴變更 | `package.json` 新增套件 |
| 核心邏輯變更 | `ORDER_NO_PREFIX` 改動、狀態值/電力分類代碼新增 |

---

## 專案概覽

個人全棧介紹網站（gemini-intro-site），含「訂單系統」子專案。

- **技術棧**：Node.js + Express 4 + SQLite3，前端純 Vanilla JS + HTML + CSS（無框架、無 build step）
- **啟動**：`npm start`（node server.js）；PORT 被佔用會自動 +1；資料庫首次啟動自動建檔建表
- **資料庫檔案**：根目錄 `database.db`（程式自動維護，勿直接編輯）

## 目錄地圖（摘要）

| 路徑 | 職責 |
|------|------|
| `server.js` | Express 入口，掛載全部 API 路由 |
| `db/database.js` | SQLite 建表（含 orders 相容欄位自動補齊）、skills seed |
| `routes/` | 後端 API 模組（見下方分節） |
| `public/index.html` | 單一頁面 + Sidebar 導航（含訂單 / Shipper Role / 打板計劃 / 資料庫區塊） |
| `public/login.html`、`public/users.html` | 登入頁、使用者管理頁（admin） |
| `public/css/` | base / layout / components / animations / orders / dbviewer / pallet / **loadsim** / xls-booking |
| `public/css/utils/` | 通用元件樣式（modal / cbm-calculator / time-picker / autocomplete） |
| `public/js/` | theme / animations / skills / contours / chat / orders / main / dbviewer / auth / **pallet/** / **loadsim（含 loadsim/）** / xls-booking-* |
| `public/js/utils/` | 通用工具（api / datetime / mawb / hawb / clipboard / modal / cbm / time-picker / autocomplete） |
| `docs/README.md` | 文件索引與分類規則（根目錄只放現役導航文件） |
| `docs/design/` | 現役設計文件：`order-system-design.md`、`xls-pdf-parallel-prd.md` |
| `docs/research/` | 研究抓取產物（`*-latest.txt` 不進版控） |
| `README.md` | 專案說明與 API 概覽 |
| `PROJECT_MAP.md` | 詳細專案地圖（資料模型、API 總表） |
| `FILE_INVENTORY.md` | 自動產生的檔案清單（執行 `npm run sync` 更新） |

## API 路由掛載（server.js）

| 路徑前綴 | 模組 | 說明 |
|----------|------|------|
| `/api/auth` | `routes/auth/auth-router.js` | 登入/登出/目前登入者（公開） |
| `/api/auth/users` | `routes/auth/users-router.js` | 使用者管理（admin only） |
| `/api/skills` | `routes/skills.js` | 技能 API |
| `/api/contours` | `routes/contours.js` | Contour 影像 |
| `/api/contour-image` | `routes/contours.js` | 舊路徑的 Contour 影像 |
| `/api/orders` | `routes/orders/index.js` | 訂單系統（需登入，見下） |
| `/api/pallet` | `routes/pallet.js` | 打板計劃：bookings / plans / SPL 代碼 / 備註範本 / sync-orders（admin+staff） |
| `/api/xls-booking` | `routes/xls-booking.js` | Shipper Role 空運單據工具（需登入，見下） |
| `/api/db` | `routes/dbviewer.js` | 資料庫檢視器（admin/staff only） |

## 登入系統（routes/auth/）

Session-based 認證（express-session + bcryptjs），保護訂單系統與資料庫檢視器。

| 檔名 | 職責 |
|------|------|
| `auth-router.js` | 登入（Company Code + User ID + Password）、登出、`/me` 查詢登入狀態 |
| `users-router.js` | 使用者 CRUD（admin only）、重設密碼、啟用/停用 |
| `middleware.js` | `requireAuth` / `requireRole` 權限檢查 |

**角色**：`admin`（使用者管理/資料庫）、`staff`（內部員工，含資料庫）、`customer`（客戶，只能看自己公司的訂單）。

**資料隔離**：`routes/orders/orders-router.js` 對 customer 角色強制 `AND o.customer_company_id = session.company_id` 過濾；單筆操作（GET/PUT/DELETE）先驗證訂單屬於自己的公司；新增訂單時 `customer_company_id` 強制為 session 內的公司。

**資料表**：`users`（company_id, user_id, password_hash, display_name, role, is_active）；`companies` 新增 `company_code` 欄位（登入用公司短碼）。

**預設管理員**：`scripts/seed-admin.js` 啟動時自動建立 `AGL / admin / admin123`（僅全新環境）。

**前端**：`login.html`（獨立登入頁）、`users.html`（使用者管理，admin only）、`js/auth.js`（Sidebar 登入狀態與鎖頭控制）、`js/utils/api.js`（401 自動跳轉登入頁）、`main.js`（受保護區塊僅登入後初始化）。

**側邊欄排序（拖曳調整目錄順序）**：`js/main.js` 的 `setupSidebarReorder()` 寫入 localStorage（立即生效）＋ `PUT /api/auth/me/nav-order`（依使用者持久化，`users.sidebar_nav_order`）。合法 key 為 `#section-*` 與 `*.html`（頁面連結如 `sli-eli-layout.html` / `users.html` **不可漏**，否則存入時被過濾 → 該項目會浮回最上方，看起來像「位置沒記住」）。新增頁面時也要把 key 加進 `scripts/fix-nav-order.js` 的 `DEFAULT_ORDER`（既有使用者才不會被排到最後）。前端套用排序時，未被列到的項目一律補到最後（不浮到最上方）。修復既有資料：`node scripts/fix-nav-order.js`；API 測試：`node scripts/test-nav-order.js [port]`；前端邏輯測試（stub DOM 載入 main.js）：`node scripts/test-nav-order-frontend.js`。

**側邊欄「主 / 子功能」層級**：主功能加 `.nav-parent`、子功能加 `.nav-child`（樣式在 `public/css/layout.css`：主項加粗＋左緣漸層強調條；子項縮排 14px＋縮小字級＋L 型樹狀連接線＋「子功能」`nav-badge` 標籤）。**子項必須排在主項的下一個**（`index.html` DOM 順序與 `fix-nav-order.js` 的 `DEFAULT_ORDER` 要一致），否則縮排層級看起來會相反；`fix-nav-order.js` 的 `CHILD_AFTER_PARENT` ＋ `moveChildrenAfterParents()` 會在修復時把子項搬回主項之後。靜態驗證：`node scripts/test-nav-hierarchy.js`（HTML 標記／DOM 順序／CSS 規則／修復腳本／測試 stub 一致性）。

**注意**：
- `auth.js` 的 `fetchCurrentUser` 不可用 `apiFetch`（401 會跳轉）；需用原生 fetch 且 401 回 null
- `login.html` 不可引入 `api.js`（登入失敗 401 會造成無限跳轉），用原生 fetch
- Session 使用 MemoryStore（僅適合單機開發）；正式部署多 process 需換 store
- `users.html` 內 `escapeHtml` 須用 `\x26` 跳脫 `&` 避免 XML/HTML 解碼問題

## Shipper Role Project（routes/xls-booking.js）

空運單據工具：上傳 CX source xls → 預覽/編輯 → 定義欄位 → 標準化預覽（含 CNEE 對照區自動比對）→ 產生 Report + SLI/ELI PDF + ZIP。

| 路徑 | 職責 |
|------|------|
| `routes/xls-booking.js` | API 路由（upload / preview / cnee-preview / process / status / cancel / download / report-template / templates） |
| `routes/xls-booking-helpers.js` | 路由共用：DATA_DIR 路徑、Multer 設定、upload session / job Map、讀檔與預覽工具 |
| `scripts/xls-workflow.js` | 主流程（standardizeRows + runWorkflow），re-export 全部歷史 API；`XLS_PDF_ENGINE` 引擎分派（P4） |
| `scripts/xls-utils.js` | 純工具：cleanCell / normalizeMawb / 日期 / 電話 / 航班 |
| `scripts/xls-cnee.js` | CNEE 對照區自動抽取 + DEST/REMARK 加權比對 |
| `scripts/xls-report.js` | Report 模板寫入 |
| `scripts/xls-sli-eli.js` | SLI/ELI 填表、PDF 轉換/合併、ZIP 打包與分割 |
| `scripts/sli-eli-overlay.js` | **疊字 PDF 產生器（P3）**：以 pdf-lib 把 fieldmap 的 10 欄位疊在 `sli-eli-blank.pdf` 上輸出 `{MAWB}.pdf`（不需 Excel／Python／merge）；字元三層判定（見下） |
| `scripts/pdf-charset.js` | **字元支援判定（共用）**：第 0 層 `sanitizeText`（無損淨化）＋第 1 層 WinAnsi 可編碼集合／`winAnsiByte`／`winAnsiHex`（與 `@pdf-lib/standard-fonts` 逐筆核對） |
| `scripts/pdf-cjk-font.js` | **CJK 字型解析（fontkit）**：平台候選鏈、`.ttc` 集合取單一字型、覆蓋率判定、公制量測、解析快取（`SLI_ELI_CJK_FONT`／`PDF_CJK`） |
| `scripts/sli-eli-blank-widen-fonts.js` | **P4 前置**：把「字符集匯出 PDF」的 Arial 字型程式搬進空白（純 pdf-lib，跨文件搬移 FontFile2/Descriptor/Widths；`REQUIRED` 由 `pdf-charset` 提供） |
| `scripts/sli-eli-diff.py` | 150dpi 逐像素比對＋文字抽取橋接（重用 `sli-eli-font-optimize.py` 的 `diff_pages`） |
| `scripts/test-sli-eli-overlay.js` | P3 驗收（頁數/A4/文字可抽取/差異 < 0.5%/檔案大小/每筆耗時/fallback 判定） |
| `scripts/test-sli-eli-charset.js` | **字元處理驗收**：第 0/1/2 層逐項（含與官方 WinAnsi 表核對）＋實筆 KB/ms＋與 Excel 參考的 150dpi 差異＋`PDF_CJK=off` 回滾 |
| `scripts/test-p4-engine.js` | **P4 驗收**：`XLS_PDF_ENGINE` 解析、混合批次（疊字＋退回 COM）、背景缺失時全退回 |
| `routes/xls-booking-layout.js` | **P5 版面編輯器 API**（掛 `/api/xls-booking/layout`）：GET／PUT／reset／preview／backups／background；驗證＋推導＋自動備份 |
| `scripts/test-sli-eli-layout.js` | **P5 驗收**（自帶伺服器端對端；結束自動還原 fieldmap 並清除備份） |
| `scripts/test-zip-naming.js` | **ZIP 檔名安全化驗收**：`sanitizeFileLabel`／`zipBaseName` 單元＋端到端 `zipFiles()`（含舊寫法 ENOENT 對照組） |
| `public/sli-eli-layout.html` | **P5 版面編輯器獨立頁**（底圖拖曳編輯；側欄為 Shipper Role Project 的**子功能**：`.nav-child` 縮排＋「子功能」標籤） |
| `public/js/sli-eli-layout-state.js` | 編輯器：state／幾何（移動縮放對齊吸附）／API／預覽排程 |
| `public/js/sli-eli-layout-editor.js` | 編輯器：畫布渲染、拖曳縮放、鍵盤、屬性面板、Undo/Redo |
| `public/js/sli-eli-layout-main.js` | 編輯器：入口、工具列、儲存／還原／測試 PDF、PDF modal |
| `public/css/sli-eli-layout.css` | 編輯器樣式 |
| `scripts/xls-exceljs-guard.js` | 讀檔防護：略過異常大的 defined-name 範圍，避免 WPS 檔造成 OOM（上傳／預覽／process 皆載入） |
| `public/js/xls-booking-state.js` | 前端：常數/狀態/工具/上傳拖曳/初始化 |
| `public/js/xls-booking-upload.js` | 前端：上傳與檔案列表 |
| `public/js/xls-booking-preview.js` | 前端：自動偵測欄位、預覽面板、欄位指派 |
| `public/js/xls-booking-grid.js` | 前端：預覽表格編輯（雙擊/右鍵/復原重做） |
| `public/js/xls-booking-assign.js` | 前端：拖曳指派欄位 |
| `public/js/xls-booking-standard.js` | 前端：標準化結果預覽、勾選、CNEE 補值、**雙擊修改 MAWB#／DEST／航班號**（`fieldOverrides`，同步到 ④）、**欄寬拖曳調整**（colgroup＋localStorage 記憶） |
| `public/js/xls-booking-workflow.js` | 前端：啟動 job、輪詢、中止、結果呈現 |
| `public/css/xls-booking.css` | 前端樣式 |

**前端載入順序**：`index.html` 依 `state → upload → preview → grid → assign → standard → workflow` 順序載入（全域函式，inline onclick 使用）。**不可調整順序**。

**測試**：`scripts/test-cnee-lookup.js`（單元 + 端對端，需先上傳 CX 來源檔）、`scripts/test-xls-preview-formula.js`（公式／複合儲存格預覽 + 日期顯示，免伺服器）、`scripts/test-xls-standard-cols.js`（③ 標準化預覽欄寬：colgroup／拖曳／記憶／夾制／重設，vm stub DOM 免伺服器）、`scripts/test-xls-standard-fields.js`（③ 雙擊修改 MAWB#／DEST／航班號：後端 `fieldOverrides`／勾選過濾＋前端套用與渲染，免伺服器）、`scripts/test-pdf-a4.js`（合併後 A4 正規化驗證）、`scripts/test-a4-integration.js`（免伺服器端對端：合成 3 筆跑完 Step 1~5，驗證紙張與 ZIP）、`scripts/test-p4-engine.js`（P4 引擎分派：混合批次／背景缺失全退回）、`scripts/test-sli-eli-layout.js`（P5 版面編輯器：自帶伺服器端對端）、`scripts/test-zip-naming.js`（ZIP 檔名安全化，hermetic）、`scripts/test-sli-generate.py`（印出 Excel 原始匯出的頁面尺寸）。

**公式儲存格（重要）**：來源檔常整欄是公式（如 `VLOOKUP` 參照外部活頁簿 `[1]Sheet1`），ExcelJS 讀出來是 `{ formula, result }` 物件。
- 一律取 Excel 快取的計算結果（`result`）；若 Excel 未快取（外部連結失效且原值空白）則視為空字串。
- 共用解析入口：`scripts/xls-utils.js` 的 `resolveCellValue()`（② `sheetPreview()`、③ `cleanCell()` 都靠它）；**不可直接輸出 ExcelJS 儲存格物件**，否則前端 `String(v)` 會變成 `[object Object]`。
- 前端對應：`public/js/xls-booking-state.js` 的 `xlsCellDisplay()`（含 `richText` / 超連結 / 錯誤值 / 公式）。
- 日期顯示一律用本地時區（`formatLocalDateTime()` / `xlsDateDisplay()`）：`toISOString()` 在 UTC+8 會少一天。

**PDF 產生並行度**：Shipper Role 第 ④ 步可在頁面選擇 `1`–`4` 個 worker；Windows Excel COM 建議先用 `1`，`2`–`4` 為較高負載實驗模式；未指定時使用 `XLS_PDF_CONCURRENCY`（預設 `2`）。每個 worker 使用獨立 Python/Excel 實例與資料 shard，取消時會終止子程序。

**紙張＝A4（重要）**：Excel 匯出的 PDF 紙張尺寸由「印表機驅動的 DEVMODE ＋ 模板內嵌 `xl/printerSettings/*.bin`」決定，**不是**由工作表 `PageSetup` 決定。實測模板 `air` 的 PageSetup 已是 A4／直式／65%，Excel 16.0 仍匯出 915.3×1295.5pt（322.8×456.9mm = A4 ÷ 0.65）；改 `PaperSize`、存檔後重新開啟、改 `FitToPagesWide/Tall` 全部無效（實測紀錄見 `sli-eli-generate.py` 註解）。
- 修正：A4 由 Node 端 `scripts/xls-sli-eli.js` 的 `normalizePdfToA4()` 保證——合併後把非 A4 的頁面以 `page.scale()` 等比縮成 A4（實際是在內容流前後包一層 `q` + `cm` + `Q`，**原始內容逐位元保留**），等同模板原設計的「A4 × 65%」→ 列印結果不變、頁面尺寸正確。
- 開關：`PDF_PAPER=a4`（預設）| `PDF_PAPER=custom`（不做正規化，＝舊行為，可一鍵回滾）；`--paper a4|custom`、`--a4-zoom <百分比>`（或 `PDF_A4_ZOOM`）可覆寫。
- `scripts/sli-eli-generate.py` 仍會寫入 A4 頁面設定（對 openpyxl + LibreOffice 路徑有效），但**不可依賴**它（Excel 會忽略）。
- 回報：`runWorkflow` 會以 pdf-lib 實測每份 `{MAWB}.pdf` 的頁數與尺寸，結果放在 `result.paper = { mode, measured, ok, issues }`；非 A4 會列入 `errors`（**不中斷**、檔案仍可下載），前端「執行結果」顯示實測尺寸與警示。

**PDF 瘦身＝字型優化（重要）**：Excel 匯出的 PDF 約 **80% 是內嵌字型**，而字型程式內含大量 PDF 完全不需要的資料。實測（2 頁 SLI+ELI）：

| 項目 | 優化前 | 優化後 |
|---|---|---|
| 字型（11 個程式） | 418.8 KB | 45.4 KB |
| 影像 | 11.6 KB | 11.6 KB |
| 內容流 | 49.9 KB | 49.9 KB |
| **檔案** | **533.0 KB** | **123.4 KB（-76.8%）** |

- 做法（`scripts/sli-eli-font-optimize.py`，純 Python + PyMuPDF，**不需 Ghostscript**）：
  1. `doc.subset_fonts()` 子集化（只保留實際用到的字符）
  2. 移除 `name`（9–12 KB／字型，純元資料）、`prep`/`fpgm`/`cvt `（hinting，4.6–14 KB／字型）等表格
  3. 移除 `glyf` 內每個字符的 hinting 指令（simple + composite 都處理）；**保留 GID 編號**，故內容流完全不用修改
  4. 以 `/Length1` 掃描全檔字型程式——`page.get_fonts()` 抓不到 Excel 產出的部分隱藏字型程式（實測漏掉一個 213 KB 的 CJK 字型）
- **保真度**：150dpi 逐像素差異 **0.000%**；文字仍可抽取／搜尋（MAWB、CNEE、地址、日期皆已驗證）。
- 串接位置：`runWorkflow` **Step 4.5**（合併 → A4 正規化 → 字型優化 → ZIP），以單一 Python 程序批次就地優化（`--inplace`），避免每檔一次啟動成本。
- 開關：`PDF_FONT_OPT=on`（預設）| `off`。環境缺 PyMuPDF 時**自動略過**並在前端提示，不影響產出。
- 回報：`result.fontOpt = { files, before, after, reductionPct, skipped }`，前端「執行結果」顯示壓縮幅度。
- 單獨使用：`python scripts/sli-eli-font-optimize.py in.pdf out.pdf --diff`（含逐像素差異）、`--report`（組成報告）、`--inplace a.pdf b.pdf …`（批次就地）。
- 剩下的瓶頸：內容流 49.9 KB（Excel 繪製的表單線條／控件）。要再往下必須簡化模板（減少字型家族與繪圖物件數）。

**疊字背景與欄位座標（建置期產物）**：`python scripts/build-sli-eli-blank.py`（Windows + Excel COM + PyMuPDF，**免 Ghostscript**）產生：

| 產物（`data/templates/`） | 內容 |
|---|---|
| `sli-eli-blank.pdf` | A4、2 頁（p0 = SLI/`air`、p1 = ELI/`ELI LETTER`）；10 個動態格已清空、字型已優化 → **122 KB** |
| `sli-eli-blank-p1.png` / `-p2.png` | 版面編輯器底圖（120 dpi 灰階） |
| `sli-eli-fieldmap.default.json` | Excel 校準基準（供「還原成預設」） |
| `sli-eli-fieldmap.json` | 作用中欄位座標（編輯器修改的就是這份） |
| `sli-eli-blank-meta.json` | sha256／頁面尺寸／轉換參數／校準結果 |

流程：清空動態格匯出空白 → 填入 marker 匯出短／長兩份 → 讀 Excel 幾何與頁面設定 → A4 正規化 → 字型優化 → 以 marker 實測位置錨定 `origin` 與 `box` → **自我校準 baseline**（把 marker 畫回背景、與 Excel 逐欄比對後修正，反覆 2 輪）。

- 座標系：**pt、原點在頁面左上**；`origin` = Excel 實際繪製的文字錨點（依對齊取對應邊界）；`textBaselineOffsetPt` = baseline 相對 `origin.y` 的偏移；`box` = 編輯器顯示／換行範圍；另有 `source`（mawb/dest/flightCompany/flightDate/cnee/cneeTel）、`align`、`wrap`、`lineHeightPt`、`calibrationResidual`。
- **實測精度：錨定邊殘差 0.00 pt**；非錨定邊 1–3 pt 的差來自 Helvetica 與 Arial 的 `@` 字形高度不同（與真實資料定位無關）。
- ⚠️ **不要用「頁面設定解析式」算座標**：Excel 的紙張／FitToPage 會讓推算偏差 40 pt 以上（`analyticDeltaMaxPt` 即為此診斷值），一律以 marker 實測為準。
- 模板變更後必須重跑；`fieldmap.templateSha256` 用來偵測過期（`--force` 可覆寫作用中的 fieldmap）。
- **交接文件（接續開發前請先讀）**：`docs/design/xls-sli-eli-overlay-prd.md` —— 內含 P1～P5 已完成清單與實測數據、後續選項、可直接執行的驗證指令、**31 個已踩過的陷阱**，以及給新對話的提示詞（§8）。

**疊字 PDF 產生器（P3 已完成，`scripts/sli-eli-overlay.js`）**：把 10 個欄位疊到 `data/templates/sli-eli-blank.pdf` 上直接輸出 `{MAWB}.pdf`（背景本來就是 A4 的 SLI+ELI 兩頁，**不需 merge、不需 Excel、不需 Python、不需字型優化**）。

- API：`createOverlayEngine({ blankPdf, fieldmap, fontMode, strict, cjkMode, cjkFont, cjkStrict })` → `engine.render(rec, outPath?)`／`renderMany(records, outDir)`／`partition(records)`／`check(rec)`／`layout(rec)`／`describe()`；另有 `renderRecord()` 便利函式。`status='fallback'`（`reason='non-latin1'`）代表該筆含「標準字型與 CJK 字型都無法輸出」的字元（或 `PDF_CJK=off`／環境沒有 CJK 字型）**不寫檔**，由呼叫端退回舊 Excel 引擎；`check()` 另回 `unsupported[].reason`（`no-cjk-font`｜`no-glyph`｜`cjk-disabled`）與 `usesCjk`（該筆是否需要 CJK 子集）。

**字元處理政策（三層，不做任何可見字元替換）**：`scripts/pdf-charset.js`（第 0／1 層）＋`scripts/pdf-cjk-font.js`（第 2 層）。

| 層 | 內容 | 效果（實測 178 個歷史 job、2789 筆） |
|---|---|---|
| 0 | `sanitizeText`：移除零寬（U+200B–200F／U+FEFF）／C0 控制字元／變體選擇器；U+2028/2029/U+0085 → `\n`。**不**觸碰 U+00AD、U+00A0、U+3000 | 無損（Excel 也不會畫），減少無謂退回 |
| 1 | WinAnsi 可編碼集合（ASCII＋Latin-1＋0x80–0x9F 的 27 個特殊字：`–` `—` `’` `“”` `•` `…` `€` `™`…）＋ `winAnsiByte/Hex` | **122 筆（4.4%）原本因 `–` 退回** → 現在直接疊字（116.5 KB／~50 ms，與純 ASCII 記錄同級） |
| 2 | CJK／全形字元 → fontkit **按需子集**內嵌（`@pdf-lib/fontkit`；只有該筆真的用到才內嵌） | 340 筆（12.2%）從「退回 COM 123~131 KB／~4 s」→ 疊字 **+4~7 KB／~50 ms** |

- **第 2 層實測**：`msjh.ttc`（微軟正黑體）解析 **24 ms**（結果快取，第 2 次 0.15 ms）；1 個全形字元 +4.1 KB、11 個漢字 +6.9 KB；真實記錄 `160-17592201`（含 `：`）＝**119.4 KB／74 ms**、150dpi 差異 **0.244%／0.396%**、文字可搜尋；P4 混合批次 3 筆（含中文 CNEE）全疊字＝**123.7 KB**（Excel 是 131.3 KB）。
- **`.ttc` 陷阱**：`@pdf-lib/fontkit` 對 `.ttc` 回傳 `TrueTypeCollection`（沒有 `createSubset`）→ `doc.embedFont(ttcBytes)` 直接爆錯。`pdf-cjk-font.js` 會挑出 collection 內的單一字型（如 `MicrosoftJhengHeiRegular`），並用 `new CustomFontSubsetEmbedder(fontkitFont, raw)` 建立 PDFFont（已解析的字型可跨文件重用）。
- **候選鏈**（`SLI_ELI_CJK_FONT` 可覆寫，逗號分隔；`cjkStrict:true` 只用手上清單）：Windows `msjh.ttc` → `mingliu.ttc` → `msyh.ttc` → `simsun.ttc` → `kaiu.ttf`；Linux（Docker 已裝 `fonts-noto-cjk`＋`fonts-droid-fallback`）`NotoSansCJK-Regular.ttc` → `DroidSansFallbackFull.ttf` → `NotoSerifCJK-Regular.ttc`。可變字型（VF，如 `NotoSansTC-VF.ttf` 預設是 Thin）預設跳過。
- **開關**：`PDF_CJK=auto`（預設）｜`off`（＝舊行為：含 CJK 的記錄整筆退回 Excel）。找不到字型／字型缺該字形時仍自動退回，**不會讓流程失敗**。
- 折行／對齊：同一欄位可能「英文＋全形」混排，`makeMeasure()` 會逐段用實際字型累加寬度（全形字寬 = 1em，與 Excel／Calibri 相同 → 不會造成整行位移）。
- fieldmap 語意：`origin`（依對齊的文字錨點）＋`textBaselineOffsetPt`＋`lineHeightPt`＋`align`＋`wrapWidthPt`（換行寬度）＋`maxLines`（Excel 對放不下的行**不畫**）＋`dateFormat`（Excel 日期顯示，例 `2026-10-03` → `03/Oct/2026`）。
- **baseline 用解析模型（重要）**：Excel 的垂直定位用「行盒」（Arial hhea ascent 0.9053em／descent 0.2124em），**不是墨跡**；`v=top → +ascent×size`、`v=bottom → −descent×size`、`v=center → +(ascent−descent)/2×size`。P2 用 `@` marker 墨跡校準會偏 0.3~1.4pt（`@` 的墨跡高度剛好等於 ascent），修正後與 Excel 誤差 ≤ 0.03pt。
- **fieldmap 已到 v2**（建置腳本直接產出實測校準值）：`font.sizePt`（air 頁 +2.4%）、`lineHeightPt`（1.27×size）、`wrapWidthPt`、`dateFormat`、`maxLines=floor(box.h/lineHeightPt)`、baseline 解析模型。
- 實測（5 筆真實 job）：**116.4 KB／份、每筆 45–55 ms**（冷啟動 15 ms）＝舊流程每筆 ~1.5 s 的 3%；2 頁 A4、文字可抽取；含 `–`／CJK 的記錄現在也能疊字（三層字元政策見下）。
- 150dpi 逐像素差異 **0.230%(p0)／0.329%(p1)（皆 < 0.5% ✅）**；地板（把 Excel 的文字原地原字級重畫）實測 0.187~0.290%。
- `fontMode='auto'` 會優先沿用背景內嵌的 Excel Arial 子集（0 額外位元組、字形與 Excel 完全相同），逐字符檢查 cmap、未涵蓋自動退回標準字型。建置腳本的「字符集匯出 + 字型加寬」（`scripts/sli-eli-blank-widen-fonts.js`）已提升覆蓋率（並讓空白 122.3 → 114.0 KB、像素與 commit 版完全相同）；但字型優化會再剃掉未被引用的字元，故只部分生效（要全效需調整順序，代價約 +35 KB/份，暫不啟用）。
- 驗證：`node scripts/test-sli-eli-overlay.js --ref data/work/job-xxx`（**不要平行跑**，輸出目錄固定為 `data/test-p3-overlay/`）。

**PDF 產生引擎 `XLS_PDF_ENGINE`（P4 已完成）**：`runWorkflow` 可用 `XLS_PDF_ENGINE=overlay|com`（未設定＝`com`＝**100% 舊行為**）切換引擎；UI ④「執行產生」的 `.xls-run-row` **最前面**有「PDF 產生方式」選擇器（預設 Excel（舊版）），`POST /api/xls-booking/process` 接受 `engine`（白名單，非法回 400）並在結果帶 `engine` / `fallbackCount`；前端結果面板顯示產生方式／疊字份數／退回筆數／耗時。

- **overlay**：`engine.partition(recordsPayload)` 分派 —— 可疊字的記錄直接 `renderMany()` 寫出 `{MAWB}.pdf`（跳過 Step 3 Excel COM、Step 4 merge／A4 正規化、Step 4.5 字型優化）；**真正無法疊字**的情況（`PDF_CJK=off`／環境無 CJK 字型／字型缺該字形／emoji 等超範圍字元）與任何例外（背景／fieldmap 缺失、`blankPdfSha256` 不符、`createOverlayEngine` 失敗、單筆 render 例外）才排入**同一批**的舊 COM 路徑（`result.engine.fallbackReasons` 列出 MAWB、字元與 `reason`）。
- **相容欄位**：`result.engine = { mode, overlay, com, fallbackCount, fallbackReasons, overlayMs, cjkFont }`、`result.fallbackCount`；`result.paper` 照常實測（疊字背景本來就是 A4）；`result.fontOpt` 純 overlay 時 `{files:0, skipped:true, engine:'overlay'}`，**若本次有退回 COM 的檔案則只對那些檔案瘦身**（否則會退回 ~545 KB，與 com 的 123 KB 不一致）。
- 實測（2026-10-13）：com＝3 份 **123.4 KB**／12.1 s；overlay＝3 份 **116.0 KB**／**1.1 s**（≈11× 快）；混合批次（2 疊字＋1 退回）count=3、`engine={overlay:2, com:1, fallbackCount:1}`、errors=[]；背景缺失時全退回 COM 且明確回報「疊字引擎無法使用」。
- 實測（2026-10-14，字元政策後）：同一混合批次 `PDF_CJK=off` → overlay=2／com=1（`reason='cjk-disabled'`）；`PDF_CJK=auto` → **overlay=3／com=0**、`cjkFont='msjh.ttc'`、CJK 份 **123.7 KB**（Excel 退回版是 131.3 KB），overlayMs 159 ms。
- ⚠️ `partition()` **只分類不排程**：`fallback[]` 必須自己推回 COM 佇列（`f.record`），否則會靜默少產出（PRD 陷阱 22）。
- 驗證：`node scripts/test-p4-engine.js`（引擎分派）、`node scripts/test-sli-eli-charset.js`（字元三層）、`$env:XLS_PDF_ENGINE='overlay'; node scripts/test-a4-integration.js`（overlay 端對端）。

**SLI/ELI 版面編輯器（P5 已完成）**：獨立頁 `public/sli-eli-layout.html`（側欄位置＝**主功能 `Shipper Role Project` 之後**，以 `.nav-child` 縮排＋樹狀連接線＋「子功能」標籤標示隸屬關係；未登入顯示鎖頭並導向登入頁）；左＝欄位清單、中＝A4 底圖畫布、右＝屬性面板。

- 功能：拖曳移動、8 向把手縮放、方向鍵微調（Shift=10pt）、5pt 吸附＋格線、Undo/Redo（Ctrl+Z / Ctrl+Y）、對齊工具（含「置中於框」）、字級／行高／顏色／粗體／換行、單欄位還原（草稿）＋全部還原（立即寫檔）、縮放 50–150%、樣本或**真實 job 資料**即時預覽、「產生測試 PDF」（iframe＋下載）、Ctrl+S 儲存、未儲存離開警告。
- API（`routes/xls-booking-layout.js`，掛 `/api/xls-booking/layout`；上層已 `requireAuth`）：`GET /`（fieldmap＋default＋頁面／底圖／樣本／備份／`canEdit`）、`PUT /`（**admin/staff**；白名單＋邊界驗證 → 自動備份 → 寫檔）、`POST /reset`（**admin/staff**；由 `sli-eli-fieldmap.default.json` 還原，可指定 keys）、`POST /preview`（草稿排版＋可選 PDF base64）、`GET /backups`、`GET /background/:page`（底圖 PNG）。
- **推導值一律由後端計算**：前端只送 `origin / box / font / align / wrap / lineHeightPt`；後端算 `textBaselineOffsetPt`（baseline 行盒模型）、`wrapWidthPt`（原值＋框寬變動量）、`maxLines`（`floor(box.h/lineHeightPt)`），並把權威值回傳給前端同步 → **預覽文字位置全部來自 `engine.layout()`，所見即 PDF 所見**。
- 每次寫檔備份 `data/templates/sli-eli-fieldmap.bak-<ts>.json`（含毫秒；已加入 `.gitignore`）。
- ⚠️ `engine.render()` 的 `bytes` 是**位元組數**不是內容 → 要 PDF 內容必須 `render(rec, tmpPath)` 再讀檔（PRD 陷阱 23）。
- 導覽：新增頁面時除了 `index.html` 的 nav，也要把 key 加進 `scripts/fix-nav-order.js` 的 `DEFAULT_ORDER`，否則已有自訂排序的使用者會看到它被排到最後（本機 admin 已用該腳本修復）。
- 驗證：`node scripts/test-sli-eli-layout.js`（自帶伺服器端對端：GET／preview／wantPdf／PUT 400／備份／reset／幾何一致性；結束自動還原 fieldmap）。

**檔名安全化（重要）**：來源試算表的值會直接進檔名，客戶的「航班號」欄位常是 `5Y8050/ 13th Oct`（航班號＋日期）。**凡是用資料組檔名／資料夾名，一律先過 `sanitizeFileLabel()`**（`scripts/xls-utils.js`）：非法字元 `\ / : * ? " < > |`（連同前後空白）→ `-`、控制字元→空白、去頭尾空白與句點、長度上限 80、Windows 保留名稱（CON/NUL/COM1…）加 `_`、空字串→fallback。
- ZIP 命名集中在 `scripts/xls-workflow.js` 的 `zipBaseName(grp)`（Step 5），另加 `path.basename()` 防禦（檔名若仍被拆成子路徑就改用安全名）。
- 歷史問題：舊版直接 `path.join(workDir, '20261013 - 5Y8050/ 13th Oct SLI x 13.zip')` → Windows 把 `/` 當路徑 → `ENOENT`，PDF 已產出但 ZIP 失敗（詳見 PRD 陷阱 26）。
- **不可改動既有命名慣例**：`20260803 - CX257 SLI x 3.zip` 必須維持（過濾規則綁定非法字元本身，不可合併所有 `- `）。
- 驗證：`node scripts/test-zip-naming.js`。

**Excel 匯出容錯（重要）**：`ExportAsFixedFormat` 會偶發失敗 `-2147352567 / 'Document not saved…'`（輸出目錄不存在、目標 PDF 被防毒／索引／同步程序短暫鎖住，或該 Excel 實例狀態異常）。因此：
- Python 端 `scripts/sli-eli-generate.py` 的 `export_sheet_pdf()` 會「先刪殘檔 → 重試」最多 3 次，並驗證 PDF 真的產出（存在且 > 0 byte）。
- 單筆最終失敗**不再中斷整批**：印出 `FAIL: {MAWB} …` 後繼續其餘筆，最後印 `ERROR: …` 並以 exit code 1 結束。
- Node 端 `runPdfWorkers()` 回傳 `{ outputs, failures }`：worker 失敗仍保留其 stdout（已產出的 PDF 不會白做），失敗的 shard 會自動再排一次；`runWorkflow` 仍會合併／打包已成功者，並在結果面板以紅字列出失敗 MAWB（不會靜默產生不完整 ZIP）。
- SLI／ELI 一律以 **MAWB 為索引配對**（不可用陣列順序，任何一筆缺檔都會造成後續全部錯位）。
- Excel 清理一律用 `taskkill`（`Quit()` 實測常無法真正結束行程）：以 `excel_pid_state()` 確認 PID 是否仍為 `EXCEL.EXE`，**確定已不是（PID 被回收／行程已結束）才跳過**，查詢失敗時仍照殺，避免殘留 Excel 實例累積。

**資源清理**：`POST /api/xls-booking/cleanup`（admin/staff）可清理超過 24 小時的 job/report 與超過 7 天的上傳檔；先傳 `{ "dryRun": true }` 可只列出清單。PDF 合併後會自動刪除中間 SLI/ELI xlsx 與 LibreOffice profile。

**注意**：資料夾層使用 `data/templates/`（報告與 SLI/ELI 模板）、`data/uploads/`、`data/work/`（job 產出），皆可被 `DATA_DIR` 環境變數覆寫。

**上傳 OOM／「Failed to fetch」（重要）**：WPS（金山）產出的 xlsx 常把 defined name 寫成整張表範圍，例如
`_xlnm._FilterDatabase = 配舱计划!$A$3:$XFB$1048462`（16384 欄 × 1048460 列 ≈ 171 億格）。ExcelJS 解析 defined name 時會
把範圍「逐格展開」成物件（`DefinedNames.set model` → `CellMatrix.addCellEx`），瞬間吃爆約 4GB heap → **Node 直接崩潰**，
伺服器一死前端 fetch 連線失敗，只顯示「上傳失敗：Failed to fetch」（與檔案大小無關，88KB 也會發生）。
- 修正：`scripts/xls-exceljs-guard.js` 以 prototype patch 讓 `CellMatrix.addCellEx` 略過超過 `MAX_DEFINED_NAME_CELLS`（1,000,000 格）的範圍。
- **凡讀取「使用者上傳檔案」的模組，最上方必須 `require` 本防護且早於 `require('exceljs')`**（目前：`routes/xls-booking.js`、`routes/xls-booking-helpers.js`、`scripts/xls-workflow.js`、`scripts/test-cnee-lookup.js`）。新增讀檔入口時請一併載入。
- 實測同一檔案：4GB+（OOM）→ 約 22MB；工作表內容／欄列數不變。SLI/ELI 模板的 `Print_Area`（數百格）不受影響。

## 訂單系統（routes/orders/）

入口 `index.js` 掛載兩個子路由，並執行一次性的 ORD- → AGL- 訂單編號遷移。

| 檔名 | 職責 |
|------|------|
| `index.js` | Router 入口 + 訂單編號遷移 |
| `orders-router.js` | 訂單 CRUD、搜尋（編號/公司/提單號）、狀態篩選、`/check-duplicate` |
| `companies.js` | 公司/地點 CRUD（客戶/倉庫/運輸公司），`normalizeCategory` |
| `utils.js` | MAWB 正規化/驗證、`generateOrderNo`、`serializeOrder`、`ORDER_SELECT_SQL` 共用查詢 |

**訂單資料模型重點**：`orders` 表有 `power_type`（no/dry/lithium 電力分類）、`urgent`（趕機）、`status`（pending/progress/done/cancelled）；公司以 `company_id` 關聯。

**前端對應**：`public/js/orders.js`（邏輯）、`public/css/orders.css`（手機優先樣式）
**已移除**：範本功能（2026-08 移除 UI + API，資料庫 templates 表保留供 dbviewer/公司刪除保護）

## 通用工具（public/js/utils/ 與 public/css/utils/）

> 與業務無關、可跨頁面重用的工具。**新頁面需要類似功能時，優先呼叫這裡，勿在頁面 JS 內重寫。**

| 檔案 | 全域函式/常數 | 用途 | 呼叫範例 |
|------|--------------|------|---------|
| `api.js` | `apiFetch(url, options)` | 統一 fetch 封裝（JSON header、錯誤拋出） | `await apiFetch('/api/orders')` |
| `datetime-utils.js` | `getTodayDateStr` / `getNowTimeStr` / `formatPickupDatetime` / `formatDateTime` | 日期/時間格式化 | `getTodayDateStr()` |
| `mawb-utils.js` | `MAWB_LATE_LABEL` / `normalizeMawb` / `formatMawb` / `validateMawb` / `isLateMawb` / `displayMawb` | MAWB# 驗證/格式化 | `validateMawb('157-1234 5678')` |
| `modal.js` | `openModal({ title, body, actions, className })` | 通用浮動卡片/Modal | `openModal({ title:'提示', body:'...' })` |
| `cbm-calculator.js` | `openCbmCalculator({ targetInput })` | CBM 計算浮動視窗，結果填回指定 input | `openCbmCalculator({ targetInput: el })` |
| `time-picker.js` | `setupTimePicker({ input, clockBtn, popup })` | 自訂時間選擇器（鍵盤 ±15 分鐘 + 小時/分鐘彈出） | `setupTimePicker({ input, clockBtn, popup })` |
| `autocomplete.js` | `setupAutocomplete({ input, suggestions, onSelect })` | 輸入即篩選下拉自動補全（可輸入自訂值；`suggestions` 可為函數動態產生） | `setupAutocomplete({ input, suggestions: ['A67','A123'], onSelect })` |

**樣式對應**：`public/css/utils/modal.css`、`cbm-calculator.css`、`time-picker.css`、`autocomplete.css`（已在 `index.html` 引入）

**注意**：這些是全域函式（無模組/namespace 包裝），引入順序必須在 `orders.js` 等使用方之前（`index.html` 已排好）

## 打板計劃（routes/pallet.js）

- API（admin/staff）：`/bookings`（+ `/bookings/destinations`）、`/plans`（+ `reorder` / `duplicate` / `items`）、`/spl-codes`、`/remark-templates`、`POST /sync-orders`
- 前端：`public/index.html` 的 `#section-palletization` 區塊 + `public/js/pallet/`（api / state / bookingsController / bookingModal / plansController / planCardRenderer / planActions / planModal / planSorting / planDupUtils / dragController / formatters）+ `public/css/pallet.css`

## 模擬裝板系統（public/js/loadsim/，純前端）

- **入口**：`public/index.html` 的 `#section-loadsim`＋`public/js/loadsim.js`（`type="module"`，`window.setupLoadsimSection` 由 `main.js` 的 `DOMContentLoaded` 呼叫，**免登入**）
- **模組**：`loadsim/units.js`（cm↔inch，內部一律 cm；**cm 顯示取整數、inch 1 位小數**）、`geometry.js`（6 方向／AABB 重疊／輪廓半平面＋凹多邊形／支撐／自動疊放高度）、`uld-specs.js`（26 個 **HACTL** 板型規格＋覆寫）、`state.js`（貨物清單／localStorage／Undo）、`weight.js`（重量與利用率）、`autoplace.js`（自動放置）、`colors.js`（主題色／rgba／明暗）、`render3d.js`（**3D 主視圖**：自行透視投影＋背面剔除＋由遠到近）、`render.js`（2D 剖面視圖＋視圖分派 facade）、`drag.js`（Pointer Events／視角旋轉／縮放）
- **視圖**：預設 **3D**（`render3d.js`，Canvas 2D 自行投影、無 Three.js）；可切「2D 剖面」＝俯視圖（寬 Z × 長 X）＋前視圖（寬 Z × 高 Y）
- **3D 互動**：拖曳貨物＝水平面移動並**自動疊在下方最高的合格支撐面**；拖到板後方的**暫存區**＝暫時移出板外（`staged`，不計重量、不做輪廓／重疊判定）；空白處／右鍵拖曳＝轉視角（yaw/pitch）；滾輪＝縮放 0.55–3×；雙擊或 `R`＝6 方向旋轉；選取後 ↑↓←→＝往**螢幕方向**移動（3D 依目前視角換算，見下方「方向鍵微調」）；`Del`＝移出；`Ctrl+Z`＝復原
- **上貨支撐面積（2026-10，預設 ≥ 50%）**：上層貨物底面必須有 **≥ `supportMinPct`%**（畫面「上貨需壓在下方貨物 ▢% 面積」可調 0–100，存 localStorage）落在下層貨物頂面，才算「有支撐」。`geometry.loadsimSupportRatio()` 用「邊界切格」算多個支撐物的**聯集**面積（重疊的支撐物不會重複計算）；`loadsimEvaluatePlacement` 回傳 `supportRatio/supportMin`，不足時的訊息是「下方支撐面積只有 xx%（需 ≥ yy%）」。`loadsimSupportHeight(ext, others, minRatio)` 也只在**合格的那一層**停下（不合格就落地面），避免「疊上去又被彈回」。
- **超出輪廓閃爍**：`renderSummary()` 統計出界件數 → `setOverflowPulse()` 開一個 60ms 的 `setInterval` 只做 `scheduleRender()`（沒出界就停、拖曳中與非本區塊不跑）；`overflowPhase` 傳給 `loadsimDraw`，3D 的紅色出界體積（`drawOverflowSlabs`）與 2D 的紅色斜線（`drawTopOverflow`／`drawProfileOverflow`）透明度在 40%~100% 之間呼吸。
- **出界提示（2026-10 修正：一定要畫在貨物之後）**：3D 貨物填色 `fillAlpha 0.94`、2D 約 0.4，出界區塊若「先畫」會被自己的貨物整塊蓋掉（症狀：看不到紅色區塊、也看不到 `+xx cm`）→ `render3d.js` 改成 box → 編號 → `drawOverflowSlabs`，`render.js` 改成 `drawItemTop/drawItemFront` → `drawTopOverflow/drawProfileOverflow`（preview 一樣）。因為改成疊在貨物上，3D 端面要做**背面剔除**（`faceTowardCamera()`），否則會看到一片不該出現的紅色斷面；紅色半透明填色疊在有色貨物上幾乎看不出來，所以端面再加 **45° 紅色斜線網底**（`hatchPolygon()`，alpha 隨 phase 0.43~0.7 呼吸）。`+xx cm` 標籤（`drawTag`）只在非 LOD 時畫。摘要警示會列出「哪一件、哪一側、出界多少」（`overflowDetailText()`，最多列 3 件、其餘「等 N 件」），明細列另有「出界」欄（`is-overflow`＋紅字 `+xx cm`）。
- **收角斜面（2026-10）**：`render3d.drawEnvelope()` 把 `profileZ`（沿 X 擠出）與 `profileX`（沿 Z 擠出）的**斜邊**畫成半透明面，收角／外擴看得到「面」而不只是線；另一方向的剖面是矩形時才補端面填色（`isRectProfile()` 判斷），避免外擴板型畫出不存在的高牆。
- **貨物明細列**：`#loadsim-item-lines`（畫布下方，每件一行：`#id`／名稱／MAWB／尺寸／重量／出界量／狀態）。點一行 → `highlightItem()` 讓該件在畫布上**閃爍 1.8 秒**（琥珀色外框，`highlightId`＋`highlightPhase` 傳給 `loadsimDraw`）；待裝的貨物只閃那一行並提示。
- **① 新增/修改貨物（2026-10）**：標題「① 新增/修改貨物」。`#loadsim-dim-rows` 可放多個 `.loadsim-dim-row`（每列＝長/寬/高/重量/件數），列尾「＋ 新增」＝`addDimRow()`（複製第一列、清掉 `id` 與數值）、「✕」＝`removeDimRow()`（至少留一列）。`readFormRows()` 讀完所有列 → `state.loadsimCreateItemsBatch(rows, { name, mawb })`（**只寫一筆復原紀錄**）；名稱下方是 `#loadsim-item-mawb`（MAWB）。`setUnit()`／`applyUnitLabels()` 會走訪**每一列**換算與更新 step/min。
- **點明細列 → 載入表單修改（2026-10）**：`loadCargoGroupIntoForm(id)` 會把該筆（有 MAWB 就是**整個 MAWB 的所有尺寸**）載入 ①（`loadCargoIntoForm()`：依貨物數補足尺寸列、填入值與名稱／MAWB），`editing.ids` 記錄正在修改的貨物，按鈕變「✔ 儲存修改」、跑出「取消修改」與 `#loadsim-edit-hint`。送出時走 `state.loadsimUpdateCargo()`：依列序更新既有貨物（多出的列＝新增、沒有對應列的舊貨物＝刪除），完成後 `loadsimSettleBoard()` 讓上方貨物重新落下；`exitEditMode(true)` 清空表單回到新增模式。`syncEditingState()`（`refreshUi()` 內）會在貨物被刪掉時自動離開修改模式。
- **選項開關（2026-10）**：`.loadsim-options` 改成 `flex-direction: column`（每項各一行：嚴格模式 → 不可懸空 → 上貨需壓 X% 面積 → 單件重量上限）。新增 `#loadsim-support-area-enabled`（`state.supportAreaEnabled`）：取消勾選＝**只要有支撐就不看面積比例**（`geometry.loadsimSupportMinRatio()` 回 0，但仍要求 `supportRatio > 0`，所以「不可懸空」照樣生效）；`#loadsim-item-max-enabled`（`state.itemMaxEnabled`）：取消勾選＝`weight.js` 不再列 `heavy`。取消勾選時對應的數字框會 `disabled`（`syncOptionInputs()`）。
- **明細列表頭排序圖示**：改用 FontAwesome（`fa-sort`／`fa-sort-up`／`fa-sort-down`＋`.loadsim-sort-icon`），比文字箭頭好懂。
- **明細列：MAWB 群組／排序／刪除（2026-10）**：`lineGroups()` 以 `item.mawb` 分組（同一個 MAWB 的多種尺寸排在一起），第一列 `is-parent`（顯示 MAWB、有 🗑 刪除整個 MAWB），其餘 `is-child`（名稱前加 `↳`）。表頭每個欄位都有 `[data-sort]` 小圖示（`lineSort`，再點同一欄切換升降冪；排序時群組不會被拆開）。列尾 `✕`＝刪除該筆尺寸、`🗑`＝`loadsimDeleteItems()` 刪除整個 MAWB。
- **刪除後重力落下（2026-10）**：`loadsim/settle.js` 的 `loadsimFallHeight()` 只考慮「目前底面以下（含）」的支撐面（不會往上跳），`loadsimSettleBoard()` 由低到高逐件重算 y；明細列刪除後呼叫 `settleAfterRemoval()`，上方貨物會掉到下方貨物的頂面或地面。
- **方向鍵微調（2026-10，2026-11 改為跟隨螢幕方向）**：`drag.js` 的 `handleKeyDown()` 支援 ↑↓←→＝把**選取中**的貨物移動 1 個顯示單位（`unit === 'in' ? 2.54 : 1` cm）。**2D 剖面**固定用俯視圖方向（↑＝+X、↓＝-X、←＝-Z、→＝+Z）；**3D** 由 `screenRelativeMove()` 依 `render.loadsimGetCamera().yaw` 把「螢幕上／右」投影到板面（螢幕右方＝`(cos yaw, 0, −sin yaw)`、螢幕上方＝`(−sin yaw, 0, −cos yaw)`，與 `render3d.buildView()` 的 `right = cross(forward, up)` 一致），所以轉過視角後 ↑ 仍然是使用者看到的「螢幕往上」、→ 仍然是「螢幕往右」；視角沒轉（yaw 40° 預設）時 ↑ 會是 `(−sin40, −cos40)` 的斜向位移，不是板子的 +X。可移動範圍與滑鼠拖曳**共用** `geometry.loadsimClampToMoveArea()`（板面 ∪ 輪廓 ±40cm → 可以騎出板邊／輪廓；滑鼠另外用 `extraMaxX/extraMaxZ` 再放寬到暫存區），所以鍵盤與滑鼠的限制一致；之後用 `loadsimSupportHeight()` 落到下方最高合格支撐面，再以 `loadsimEvaluatePlacement()` 判合法性（重疊或嚴格模式下的出界都只提示不動）。
- **摘要位置與 ① 表單（2026-10）**：`renderSummary()` 把件數／重量 chip（`loadsim-summary-row`）與超重・出界警示（`loadsim-banner`）寫進 `#loadsim-summary-top`（`index.html` 的 `.loadsim-view` 內、`#loadsim-canvas` 與 `#loadsim-item-lines` 之間），板型說明與單位註記留在卡片底部 `#loadsim-summary`；HTML 沒有 `#loadsim-summary-top` 時會全部退回底部（舊頁面不會壞）。① 新增貨物 是單列精簡表單：`.loadsim-form` 用 `flex`＋`flex-wrap`、標籤與輸入框同一行、輸入框預設 62px（**長/寬/高 `.loadsim-dim-l/-w/-h` 只有 54px**：剛好放得下 3 位數＋Chrome 數字微調箭頭，實測 50px 會裁字；重量 `25.5` 需要 62px），名稱欄 `.loadsim-form-name` 吃掉剩餘寬度、按鈕 `.loadsim-form-add` 靠右；名稱／MAWB 的標籤文字包在 `<span class="loadsim-form-label">`（`min-width: 3.4em`）裡，兩個輸入框左邊才會對齊；不要在窄螢幕把 grid 三欄加回來（會讓區塊長回原本的高度）。
- **暫存區（三個，2026-11）**：`geometry.loadsimStageRect()`＝**暫存區① 板後方**（x = baseL + 30cm 起、深 130cm、寬同板寬）、`loadsimStageRect2()`＝**暫存區② 板前方**（z = 板寬/2 + 30cm 起、深 110cm、長同板長）、`loadsimStageRect3()`＝**暫存區③**（① 與 ② 延伸出去的重疊角落：x 同 ①、z 同 ②），三者都貼地；`loadsimStageRects()` 回 `[back, front, corner]`（各帶 `id`／`label`）、`loadsimStageAt(ext, spec)` 用「貨物中心」判斷落在哪一區（都不在回 `null`）、`loadsimClampToStage()` 夾在該區內貼地、`loadsimStageMaxExtent(spec, dims)` 給拖曳用的 extraMaxX／extraMaxZ。3D/2D 都畫出三個虛線暫存區並標「暫存區①②③」；取景（3D `framePoints`、2D `layout.sceneZ0/sceneZ1/sceneL`）一併納入，拖出去才看得到落點。2D 俯視圖的 z→px 換算改成看 `panel.z0`（俯視圖＝場景左緣、前視圖＝−板寬/2），改動 `zToPx()/pxToZ()/loadsimComputeLayout()` 時別把這個偏移弄丟。
- **板底 ring track（厚板／薄板，2026-11）**：板底四邊有 ring track，**最底層（貼地 y≈0）貨物不能壓在 ring 上，第二層以上不受限**。**處理方式與「超出輪廓」完全相同**：預設允許但標紅（紅色斜線＋粗紅框＋`ring +xx cm` 標籤＋閃爍）＋摘要警示＋明細列「出界」欄顯示 `ring +xx`，**只有嚴格模式（`allowOverhang === false`，即「嚴格模式：超出輪廓就不能放」勾起來）才真的擋下**（報告的 `ringBlocked`）。`geometry.LOADSIM_PLATE_TYPES`：`thin` 薄板＝四邊內縮 2.5"(長)／3"(寬) → 內側 120"×90"；`thick` 厚板＝3.5"／4" → 118"×88"（預設 **thin**）。`loadsimRingRect(spec, plateType)` 以「板面（貼地）」往內縮算內框（附 `widthCm/depthCm/insetX/insetZ/disabled`），`loadsimNormalizeSpec(base, override, { plateType })` 會把它掛成 `spec.ringRect`（`spec.plateType/plateLabel` 也在這裡），所以 `loadsimGetSpec(code, overrides, { plateType })` 要帶板底類型。`loadsimEvaluatePlacement()` 回傳 `onRing/ringBlocked/ringOverlap/ring`；`loadsimRingHitRects(ext, spec)` 算「被壓到的 ring 帶」（已裁在板面內，最多 4 條）給 3D `drawRingSlabs()`／2D `drawTopRingOverlap()` 畫紅色斜線；`loadsimPlacementReason()` 的 ring 訊息只在嚴格模式被擋時出現。`autoplace.js` 的 y=0 候選仍優先用 ring 內框。UI：「板底 薄板／厚板」切換在工具列（`.loadsim-plate-btn`／`state.plateType`，存 localStorage），切換時 toast 顯示第一層可用範圍，摘要註記多一行板底／第一層可裝範圍。
- **拖曳可移動範圍＝輪廓（2026-11 修正「第二層推不到 OVERHANG」）**：`loadsimClampToMoveArea()` 的基準改成「板面 ∪ 輪廓」（`loadsimContourBounds(spec)` 取 `profileX/profileZ` 的最大範圍）再外擴 40cm。外擴型板型（H2/H3/H4/W2，輪廓可到板面外 18"～30"）的第二層貨物以前被「板面 + 40cm」卡住、推不到輪廓末端，現在推得到；一般板型（輪廓＝板面）行為不變。另外 `drag.js` 的 3D 拖曳與方向鍵都加了「**原本在高處且目前高度還有部分接觸 → 維持高度**」的規則（`keepY = loadsimSupportRatio(...) > 0`）：以前支撐比例一掉到門檻下就整件掉到地面、壓到下方貨物，訊息變成「與其他貨物重疊」看不出原因；現在會停在原高度並提示「下方支撐面積只有 xx%（需 ≥ yy%）」。
- **3D Contour 邊長標註（2026-11）**：`render3d.envelopeEdges(spec)` 把 envelope 真正畫出來的邊（兩個端面的多邊形邊＋擠出方向的邊，座標去重）交給 `drawEnvelopeDims()`，每條邊在中點往畫面外側 11px 畫白底 pill 標長度（`loadsimFormatNumber`，投影 <16px、與已畫標籤 <18px／同數字 <24px 的略過）；只在非 LOD 時畫。改 `drawEnvelope()` 的擠出邏輯時要一起維護 `envelopeEdges()`。
- **版面：標題列與畫布高度（2026-11）**：`.loadsim-title-row` 讓 `card-desc`（`.loadsim-desc`，0.72rem）接在 `<h2>` 後面同一行（flex＋baseline＋wrap，`h2{margin:0}`），不要再把它放回標題下面。畫布高度**兩段式**：CSS `.loadsim-stage { height: clamp(420px, calc(100vh - 220px), 1100px) }` 當後備，`loadsim.js` 的 `syncStageHeight()` 再補正成「剛好填滿視窗、摘要列貼底」。**算式一定要用捲動容器的內容座標**：`scrollContainerOf(stage)` 往上找第一個 `overflow-y:auto|scroll` 且真的可捲動的祖先（本專案是 `.app-layout`），`stageTop = rect.top − scrollerRect.top + scroller.scrollTop`，`height = clamp(360, scroller.clientHeight − stageTop − 摘要列高 − 18, 1600)`；沒有可捲動祖先時才退回 `window.innerHeight/pageYOffset`。**不要再用 `innerHeight − rect.bottom`**（視窗座標）：使用者往下捲去按 ① 表單的「產生貨物」後，`refreshUi()` 會呼叫 `syncStageHeight()`，此時 `rect.bottom` 已經往上跑，算出來的高度會暴增到上限 1600px（2026-11 已修正，測試 32.1–32.3）。呼叫點＝`refreshUi()`、ResizeObserver（畫布容器＋`.card-header-flex`＋`#loadsim-summary-top`）、nav 點擊、`resize`（120ms debounce）；另外 nav 點擊後 700ms、區塊切成 active 後 180ms／700ms 各再校正一次（卡片 `.fade-in-up` 有 0.6s 的 `translateY` 進場動畫，動畫期間量到的上緣會偏低約 20px），`document.fonts.ready` 後也校正（字型／圖示載入可能讓工具列換行）。摘要列貼在視窗底部，明細列與 ①／② 表單在下方。
- **拖曳 1:1（2026-10 修正）**：`drag.js` 用「**命中點高度**」當移動平面（`loadsimHitTest3D()` 回傳命中點），抓取偏移在第一次移動時才用「按下時的像素」換算，套用公式是 `item = world + offset`（**加號**）。用底面平面或減號都會讓貨物「只拉一點點就噴很遠」；位移 <3px 視為「點一下選取」，不移動也不寫復原紀錄。
- **輪廓判定**：`profileZ`（寬×高）＋`profileX`（長×高）兩個凸多邊形，內側＝`dot(p,n) >= c`；超出量＝`c - dot(p,n)` 最大值（cm 整數，<1cm 顯示「<1」）；3D 以「剖面矩形 ∩ 該邊外側 → 沿第三軸擠出」畫紅色半透明體積＋`+xx cm` 標籤
- **板型資料**：**只採用** `public/image/HACTL_contour_spec` 圖上的英吋標註（1"=2.54cm），code 沿用 HACTL 的 contour code（`Q7-00`／`Q3-00`／`Q9-01`…）。`CX_Contour` 的圖**暫不採用**（尺寸／收角與 HACTL 標註有出入，尤其有 OVERHANG 的輪廓）。重量為業界常用值，UI 可改（`specOverrides` 存 localStorage）。**改長/寬/高後輪廓會退回矩形**（原廠斜切不再可信）
- **方位名稱門檻（2026-10 修正）**：`geometry.loadsimPlaneLabel()` 的「上方／底部」與「前端／後端」「左側／右側」門檻統一用 `LOADSIM_FLAT_NORMAL_COS` = 0.94（表面與水平／垂直面夾角 ≤ 20°），更斜的一律算「前/後/左/右上斜角」。舊門檻 0.8（≈37°）會把 36° 左右的斜切（Q9-01 的 30"×22"、ZA 的 48"×35"）標成「上方」、把 61° 的 ZB 斜切（15.5"×29"）標成「前端／後端」，出界訊息（「上方超出 xx cm」）與紅色出界體積的方位都會指錯。
- **ZA / ZB / ZC 板型（2026-10 新增）**：B747-400 主艙「前後端收角」型，收角在**長 × 高剖面**（`profileX`），寬 × 高（`profileZ`）仍是 88"/96" × 總高的矩形。**判斷方法**：圖上底部「前端」標的是 **125"**（而不是 88"/96"）就代表白面是「長×高」，收角尺寸要放 `profileX`（Q7-00／Q3-00 的前端標 88"/96" → 收角在 `profileZ`）。三者皆貼地 125" × 96"、總高 96"：**ZA** 前後端各收 48"×35"（垂直壁 61"、頂長 29"）、**ZB** 前後端各收 15.5"×29"（壁 67"、頂長 94"）、**ZC** 只收後端 12"×12"（壁 84"、頂長 113"，`chamferTopOneEndX()`）。HACTL 圖只標一端，另一端與頂面長度用 `CX_Contour` 同型圖交叉驗證（48"+29"+48"、15.5"+94"+15.5"、113"+12" 都剛好等於 125"）；同系列 ZA-02（壁 51"、收角 28"×45"、頂 69"）與 ZA-03（總高 86"、壁 61"、收角 35"×25"、頂 55"）寫在 `note`，可在板型設定調整。
- **A1 / A3 / XJ / ZJ / ZQ / ZR / Z2–Z5 板型（2026-11 新增，規格庫 16 → 26）**：同樣只讀 HACTL 圖上的英吋標註，而且每張圖的標註都能自我驗證（**總高 = 側壁 + 收角(垂直)**、**板寬/板長 = 頂寬/頂長 + 收角(水平)**）。**A1**（B747F 1st Pos）125"×96"×94.5" 是**階梯型**（後端降為 63"、先留 20" 平台，垂直落差 31.5" 標在 A1-01）→ 新增 `stepDownOneEndX()`；**A3**（B757-200F Pos 1-12）125"×96"×81"，前後端各 29"×36"（壁 45"、頂長 67"）；**XJ** 125"×96"×96"，前後端各 20"×12"（壁 84"、頂長 85"）；**ZJ**（B747-400SF Pos A）125"×96"×86"，左右各 14"×14"（壁 72"、頂寬 68"，`chamferTopBothSidesZ()`）；**ZQ** 118"／壁 75"／48"×43"、**ZR** 116"／壁 51"／55"×65"、**Z2** 116"／壁 72"／48"×44"、**Z3** 96"／壁 76"／16"×20"、**Z4** 114"／壁 51"／55"×63"、**Z5** 96"／壁 52.5"／30"×43.5"（單側收角，頂寬 = 96" − 收角；`chamferTopOneSideZ()`）。重量沿用主艙板 6804kg／板重 120kg。
- **凹多邊形輪廓（2026-11，A1 階梯必需）**：`profileX/profileZ` 不再假設凸多邊形。`geometry.loadsimPolyIsConvex()`／`loadsimPointInPolygon()`（射線法＋邊界視為在內）；`loadsimBuildPlanes()` 把逆時針多邊形掛在回傳陣列的 `.poly`；`loadsimTestRectInPolygon()` 遇到凹多邊形時，**只有「真的落在多邊形外的角」才算超出**（否則「所有邊的半平面交集」＝凸包，會把階梯上方的合法空間誤判成出界）。凸多邊形的行為與回傳完全不變，呼叫端不用改。
- **板型欄位＝動態搜尋（2026-11）**：`#loadsim-uld-select` 由 `<select>` 改成 `<input>`（外層 `.loadsim-select-field` 給共用 autocomplete 定位），`loadsim.js` 的 `wireUldSearch()` 接 `utils/autocomplete.js` 的 `setupAutocomplete`（沒載入時自動跳過）：輸入即時篩選（代碼或尺寸都可比對）、Enter／Tab／點選套用、`change`／`blur` 無法辨識就還原；`uldCodeFromText()` 依「完全符合 → 唯一前綴 → 唯一包含」對應代碼，`buildUldSelect()` 只負責把輸入框同步成「代碼　板面尺寸（輪廓 …）」。

- **貼地（板面）vs 輪廓上限（2026-10 修正）**：`baseL/baseW` 是**輪廓上限**；下艙 H2/H3/H4/W2 系列的輪廓是「底部向外斜擴」型（圖上 125" 是**貼地**長度，往上 12"/18"/22"/30" 的這段兩端各往外擴同樣的距離 → 輪廓 149"/161"/140"/185"）。因此 `loadsimNormalizeSpec()` 會由 `profileX`／`profileZ` 在 **y = 0 的底邊**推導出 `floorX0/floorX1/floorZ0/floorZ1`＋`floorL/floorW`＋`flared`：地板與格線（`render3d.drawFloor/drawGrid`）、2D 俯視圖板面框（實線＝板面、虛線＝輪廓）、拖曳夾制與吸附（`drag.js`）、自動放置（`autoplace.js`）、`loadsimClampToBase()`／拖曳與方向鍵共用的 `loadsimClampToMoveArea()`（板面再外 40cm，讓貨物可以騎出板邊）全部改用板面；下拉選單與摘要顯示「板面 125×96×64（輪廓 161×96）」。**貼地以外的外擴區必須疊高才能使用**（由輪廓半平面判定）。
- **相機不入場景（2026-10 修正）**：`buildView()` 會用「板子＋貨物所有角點在視線方向的最大投影」算出 `minDistance`，`distance/zoom` 不得小於它。否則放大到 3× 再轉視角時相機會跑到板子裡面，近平面把整個貨物判定成「在相機背後」→ 貨物整塊消失（縮放一下才回來）。另外 `loadsimGetPreview()` 在非貨物 session（轉視角）回傳 `null`，`render3d.js` 也對 `preview.item` 做防呆——原本轉視角時 `preview.item.id` 會丟錯，畫布清空後貨物全部不畫。
- **出界標籤連到「界的那一條邊」（2026-10）**：`geometry.loadsimOverflowBoundary(ext, entry)` 算出「貨物剖面（axis z → z-y；axis x → x-y）∩ 超出平面」的線段；3D `drawOverflowSlabs()` 取**面向鏡頭那一側**把界線畫成紅色實線，`+xx cm` 標籤移到界線外側 26px 並用虛線引線＋小圓點連回界線中點（界線投影 <6px 時不外推，避免方向亂跳）；2D `drawTopOverflow()` 把板面邊線標紅＋引線，`drawProfileOverflow()` 用同一支 helper 畫輪廓剖面邊＋引線。三處都畫在紅色斜線之後、標籤之前。
- **Hover 邊長（2026-10）**：3D `render3d.drawEdgeDims()` 只標「至少一個相鄰面朝向鏡頭」的邊（12 條中最典型 9 條），標籤畫在邊中點往外 13px（深色 pill＋白字 10px）；投影 <18px 的邊與「同數字 26px 內重複」會略過避免疊字，只在 `hoverId` 且 `!lod` 時畫。2D `drawRectEdgeDims()` 標四條邊（俯視：水平＝寬 Z、垂直＝長 X；前視：水平＝寬 Z、垂直＝高 Y），框太小（w<46 / h<26 等）就不標。
- **Hover tooltip 帶 CTN#（2026-10）**：`updateTooltip()` 的名稱後面加 `<span class="loadsim-tooltip-id">| #id</span>`（跟明細列的 `#id` 對照），並用 `.loadsim-tooltip-head` 讓名稱與編號同列基線對齊。
- **明細列 CBM 欄（2026-10）**：`weight.loadsimItemCbm(item)`＝目前方向 長×寬×高（cm³）÷10⁶；明細列在「尺寸」右側新增 `CBM` 欄（`toFixed(3)`，表頭可排序 `data-sort="cbm"`），`.loadsim-line` 的 `grid-template-columns` 多一欄 58px。
- **預設行為**：重疊＝禁止；懸空＝禁止（可關）；超出輪廓＝允許但標紅（嚴格模式可禁止）；超重＝只警示
- **效能（拖曳流暢度）**：`loadsim.js` 的畫布拖曳容易受下列事情拖累，改動時請維持這些設定
  - `public/css/loadsim.css` 開頭關閉 `.loadsim-card` 的 `backdrop-filter:blur(18px)` 與 hover 光暈（比照 `.xls-card`），並給 `.loadsim-stage` `contain:layout paint`；**不要為了美觀把 backdrop-filter 加回去**（Canvas 每幀重繪 → 整張卡反覆重做 backdrop 模糊，拖曳會頓）
  - 拖曳期間 `drag.js` 會呼叫 `window.fxBeginBusy('loadsim')`／`fxEndBusy('loadsim')`（`public/js/animations.js`），暫停全螢幕粒子、游標拖尾與卡片光暈追蹤；`body.fx-busy` 也會暫停背景光暈漂移（`public/css/animations.css`）
  - `render3d.js` 的 `sceneKeyOf()/analyzeScene()` 以「貨物座標＋板型＋模式開關」簽章快取重疊／超出／取景角點，轉視角與縮放不再重算 O(n²)；命中測試沿用快取的 `extents`
  - **取景穩定化（2026-10 追加，最關鍵）**：`buildView()` 不再每幀重算最小可視距離。原本每幀重算會讓整張板子在拖曳／轉視角時**來回縮放**（實測取景距離在 464↔577 之間跳），且拖曳中的預覽也算進取景 → 鏡頭縮放又改變「指標→世界座標」→ 回饋抖動。現在：`frameKey`（板型＋畫布尺寸）變更才 snap 重算；搬貨物時 `freezeFrame` 只允許拉遠不拉近；**轉視角時 `snapFrame`（每幀重算含平移）**，否則平移量停在舊角度會把板子與貨物推出畫布外；閒置時以 28%/幀平滑收合，`loadsimIsFrameSettling()` 為 true 時 `loadsim.js` 會再排一次 rAF。取景第二階段會把「板子＋貨物」整組**置中＋必要時拉遠**（舊版只拉遠不平移 → 疊高／超出板邊的貨物被畫布邊緣切掉）。**拖曳預覽不列入取景**
  - **互動 LOD**：`lod:true`（拖曳／轉視角時）只省略「貨物編號、超出量標籤、板邊尺寸標註」等文字類繪製（文字是 Canvas 2D 最貴的操作；格線／輪廓／方塊描邊保留，避免拖曳時視覺元素突然消失），並把 DPR 上限降到 1.25；放開後補畫完整細節
  - **pointermove 合併**：`drag.js` 以 rAF 合併指標事件（每幀最多處理一次），放開前 `flushMove()` 套用最後位置，避免高刷新率裝置重複做吸附／合法性判定
  - **診斷 HUD**：網址加 `?loadsim-debug=1`（或 `localStorage.setItem('loadsim-debug','1')`）會在畫布右下角顯示「FPS／繪製毫秒／件數」，用來分辨是「FPS 低」還是「畫面在抖」
  - 畫布尺寸由 `ResizeObserver` 快取（不再每幀 `getBoundingClientRect()`）、tooltip 走 rAF 節流且內容沒變不重建 DOM
- **測試**：`npm run test:loadsim`＝`node scripts/test-loadsim-geometry.js`（幾何/重量/單位 **136 項**）＋`node scripts/test-loadsim-frontend.js`（DOM stub **153 項**，含 3D 投影／命中／視角／縮放、方向鍵螢幕方向、畫布高度與捲動無關）。Node 會出現 `MODULE_TYPELESS_PACKAGE_JSON` 警告屬正常（專案 package.json 非 ESM）
- **注意**：`loadsim.js` 的模組層有 `window.setupLoadsimSection` 與 `MutationObserver`，Node 測試需先 stub `window`/`document`/`canvas`（見 `scripts/test-loadsim-frontend.js`）

## 資料表（db/database.js）

| 表 | 用途 |
|----|------|
| `skills` | 技能展示（自動 seed） |
| `companies` | 公司/地點（客戶、倉庫、運輸公司；`company_code` 供登入） |
| `users` | 帳號（company_id, user_id, password_hash, display_name, role, is_active, sidebar_nav_order） |
| `orders` | 訂單主表（含電郵總結所需欄位） |
| `note_templates` | 訂單備註文字範本 |
| `mawb_records` | MAWB# 主檔記錄（後補/查詢用） |
| `audit_log` | 操作稽核紀錄 |
| `templates` | 訂單範本（**已停用**：UI/API 已移除，僅保留供 dbviewer 與公司刪除保護） |
| `pallet_plans` / `pallet_plan_items` | 打板計劃卡與項目 |
| `spl_codes` / `remark_templates` | 打板 SPL 代碼與備註範本 |

> 共 12 張表（`db/database.js` 建表）。REMARK：舊 `messages`（GuestBook/Forum）表已從建表移除，但舊資料庫仍留有該表，待日後 `DROP TABLE` 與 dbviewer 引用清理。

## 常見任務指引

- **改訂單功能**：後端改 `routes/orders/`，前端改 `public/js/orders.js` + `public/css/orders.css`
- **改打板計劃**：後端改 `routes/pallet.js`，前端改 `public/js/pallet/*` + `public/css/pallet.css`
- **改模擬裝板**：前端改 `public/js/loadsim/*` + `public/css/loadsim.css`；板型尺寸/收角改 `loadsim/uld-specs.js`（無後端、無資料表）
- **改網站內容**：`public/index.html`
- **改主題**：`public/css/base.css`（主題變數）+ `public/js/theme.js`
- **新增資料表**：`db/database.js` 加 `CREATE TABLE`，並在 `routes/` 建對應路由模組，`server.js` 掛載
- **新增文件**：先看 `docs/README.md` 的分類規則（根目錄只放現役導航文件；歷史規格放 `docs/archive/`、設計放 `docs/design/`）
- **前端無框架**：所有前端 JS 直接在 `public/js/` 用全域函式開發

## 注意事項

- 使用 sqlite3 套件的 callback 風格（非 async/await）
- 不要直接編輯 `database.db`
- 修改 `routes/orders/utils.js` 的 `ORDER_NO_PREFIX` 會影響訂單編號產生