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
| `bp3d/` | 3D ULD 裝箱引擎（geometries / uld-definitions / constraints / extreme-points / solver）＋ `bp3d/ga-lns/`（GA-LNS 啟發式） |
| `routes/` | 後端 API 模組（見下方分節） |
| `public/index.html` | 單一頁面 + Sidebar 導航（含訂單 / Shipper Role / 打板計劃 / 資料庫區塊） |
| `public/login.html`、`public/users.html` | 登入頁、使用者管理頁（admin） |
| `public/packing.html`、`public/uld-packing.html` | 3D ULD 裝箱（單 ULD）、ULD 智能裝箱（多 ULD 專案） |
| `public/css/` | base / layout / components / animations / orders / dbviewer / packing / pallet / uld-packing* / xls-booking |
| `public/css/utils/` | 通用元件樣式（modal / cbm-calculator / time-picker / autocomplete） |
| `public/js/` | theme / animations / skills / contours / chat / orders / main / dbviewer / auth / **packing/** / **pallet/** / **uld-packing/** / xls-booking-* |
| `public/js/utils/` | 通用工具（api / datetime / mawb / hawb / clipboard / modal / cbm / time-picker / autocomplete） |
| `docs/README.md` | 文件索引與分類規則（根目錄只放現役導航文件） |
| `docs/design/` | 現役設計文件：`order-system-design.md`、`xls-pdf-parallel-prd.md` |
| `docs/archive/` | 歷史規格：`uld-packing-spec-deepseek.md`、`uld-packing-prd-v2.txt` |
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
| `/api/packing` | `routes/packing.js` | 單 ULD 求解：health / ulds / pack-uld / demo（需登入） |
| `/api/packing` | `routes/packing-projects.js` | 裝箱專案 / ULD / 客戶 / 貨物項目 |
| `/api/packing` | `routes/packing-solutions.js` | 求解方案 CRUD |
| `/api/packing` | `routes/packing-solve.js` | 非同步求解 job（solve / 查詢 / 取消） |
| `/api/packing` | `routes/packing-pdf.js` | 方案 PDF 匯出 |
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

**側邊欄排序（拖曳調整目錄順序）**：`js/main.js` 的 `setupSidebarReorder()` 寫入 localStorage（立即生效）＋ `PUT /api/auth/me/nav-order`（依使用者持久化，`users.sidebar_nav_order`）。合法 key 為 `#section-*` 與 `*.html`（頁面連結如 `sli-eli-layout.html` / `uld-packing.html` / `packing.html` **不可漏**，否則存入時被過濾 → 該項目會浮回最上方，看起來像「位置沒記住」）。新增頁面時也要把 key 加進 `scripts/fix-nav-order.js` 的 `DEFAULT_ORDER`（既有使用者才不會被排到最後）。前端套用排序時，未被列到的項目一律補到最後（不浮到最上方）。修復既有資料：`node scripts/fix-nav-order.js`；API 測試：`node scripts/test-nav-order.js [port]`；前端邏輯測試（stub DOM 載入 main.js）：`node scripts/test-nav-order-frontend.js`。

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
| `scripts/sli-eli-overlay.js` | **疊字 PDF 產生器（P3）**：以 pdf-lib 把 fieldmap 的 10 欄位疊在 `sli-eli-blank.pdf` 上輸出 `{MAWB}.pdf`（不需 Excel／Python／merge） |
| `scripts/sli-eli-blank-widen-fonts.js` | **P4 前置**：把「字符集匯出 PDF」的 Arial 字型程式搬進空白（純 pdf-lib，跨文件搬移 FontFile2/Descriptor/Widths） |
| `scripts/sli-eli-diff.py` | 150dpi 逐像素比對＋文字抽取橋接（重用 `sli-eli-font-optimize.py` 的 `diff_pages`） |
| `scripts/test-sli-eli-overlay.js` | P3 驗收（頁數/A4/文字可抽取/差異 < 0.5%/檔案大小/每筆耗時/fallback 判定） |
| `scripts/test-p4-engine.js` | **P4 驗收**：`XLS_PDF_ENGINE` 解析、混合批次（疊字＋退回 COM）、背景缺失時全退回 |
| `routes/xls-booking-layout.js` | **P5 版面編輯器 API**（掛 `/api/xls-booking/layout`）：GET／PUT／reset／preview／backups／background；驗證＋推導＋自動備份 |
| `scripts/test-sli-eli-layout.js` | **P5 驗收**（自帶伺服器端對端；結束自動還原 fieldmap 並清除備份） |
| `public/sli-eli-layout.html` | **P5 版面編輯器獨立頁**（底圖拖曳編輯；側欄新項目） |
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
| `public/js/xls-booking-standard.js` | 前端：標準化結果預覽、勾選、CNEE 補值 |
| `public/js/xls-booking-workflow.js` | 前端：啟動 job、輪詢、中止、結果呈現 |
| `public/css/xls-booking.css` | 前端樣式 |

**前端載入順序**：`index.html` 依 `state → upload → preview → grid → assign → standard → workflow` 順序載入（全域函式，inline onclick 使用）。**不可調整順序**。

**測試**：`scripts/test-cnee-lookup.js`（單元 + 端對端，需先上傳 CX 來源檔）、`scripts/test-xls-preview-formula.js`（公式／複合儲存格預覽 + 日期顯示，免伺服器）、`scripts/test-pdf-a4.js`（合併後 A4 正規化驗證）、`scripts/test-a4-integration.js`（免伺服器端對端：合成 3 筆跑完 Step 1~5，驗證紙張與 ZIP）、`scripts/test-p4-engine.js`（P4 引擎分派：混合批次／背景缺失全退回）、`scripts/test-sli-eli-layout.js`（P5 版面編輯器：自帶伺服器端對端）、`scripts/test-sli-generate.py`（印出 Excel 原始匯出的頁面尺寸）。

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
- **交接文件（接續開發前請先讀）**：`docs/design/xls-sli-eli-overlay-prd.md` —— 內含 P1～P5 已完成清單與實測數據、後續選項、可直接執行的驗證指令、**25 個已踩過的陷阱**，以及給新對話的提示詞（§8）。

**疊字 PDF 產生器（P3 已完成，`scripts/sli-eli-overlay.js`）**：把 10 個欄位疊到 `data/templates/sli-eli-blank.pdf` 上直接輸出 `{MAWB}.pdf`（背景本來就是 A4 的 SLI+ELI 兩頁，**不需 merge、不需 Excel、不需 Python、不需字型優化**）。

- API：`createOverlayEngine({ blankPdf, fieldmap, fontMode, strict })` → `engine.render(rec, outPath?)`／`renderMany(records, outDir)`／`partition(records)`／`check(rec)`／`layout(rec)`／`describe()`；另有 `renderRecord()` 便利函式。`status='fallback'`（`reason='non-latin1'`）代表該筆含 Latin-1 以外字元（CNEE 偶爾有中文或全形標點）**不寫檔**，由呼叫端退回舊 Excel 引擎。
- fieldmap 語意：`origin`（依對齊的文字錨點）＋`textBaselineOffsetPt`＋`lineHeightPt`＋`align`＋`wrapWidthPt`（換行寬度）＋`maxLines`（Excel 對放不下的行**不畫**）＋`dateFormat`（Excel 日期顯示，例 `2026-10-03` → `03/Oct/2026`）。
- **baseline 用解析模型（重要）**：Excel 的垂直定位用「行盒」（Arial hhea ascent 0.9053em／descent 0.2124em），**不是墨跡**；`v=top → +ascent×size`、`v=bottom → −descent×size`、`v=center → +(ascent−descent)/2×size`。P2 用 `@` marker 墨跡校準會偏 0.3~1.4pt（`@` 的墨跡高度剛好等於 ascent），修正後與 Excel 誤差 ≤ 0.03pt。
- **fieldmap 已到 v2**（建置腳本直接產出實測校準值）：`font.sizePt`（air 頁 +2.4%）、`lineHeightPt`（1.27×size）、`wrapWidthPt`、`dateFormat`、`maxLines=floor(box.h/lineHeightPt)`、baseline 解析模型。
- 實測（5 筆真實 job）：**116.4 KB／份、每筆 45–55 ms**（冷啟動 15 ms）＝舊流程每筆 ~1.5 s 的 3%；2 頁 A4、文字可抽取、非 Latin-1 4/5 筆正確退回。
- 150dpi 逐像素差異 **0.230%(p0)／0.329%(p1)（皆 < 0.5% ✅）**；地板（把 Excel 的文字原地原字級重畫）實測 0.187~0.290%。
- `fontMode='auto'` 會優先沿用背景內嵌的 Excel Arial 子集（0 額外位元組、字形與 Excel 完全相同），逐字符檢查 cmap、未涵蓋自動退回標準字型。建置腳本的「字符集匯出 + 字型加寬」（`scripts/sli-eli-blank-widen-fonts.js`）已提升覆蓋率（並讓空白 122.3 → 114.0 KB、像素與 commit 版完全相同）；但字型優化會再剃掉未被引用的字元，故只部分生效（要全效需調整順序，代價約 +35 KB/份，暫不啟用）。
- 驗證：`node scripts/test-sli-eli-overlay.js --ref data/work/job-xxx`（**不要平行跑**，輸出目錄固定為 `data/test-p3-overlay/`）。

**PDF 產生引擎 `XLS_PDF_ENGINE`（P4 已完成）**：`runWorkflow` 可用 `XLS_PDF_ENGINE=overlay|com`（未設定＝`com`＝**100% 舊行為**）切換引擎；UI ④「執行產生」的 `.xls-run-row` **最前面**有「PDF 產生方式」選擇器（預設 Excel（舊版）），`POST /api/xls-booking/process` 接受 `engine`（白名單，非法回 400）並在結果帶 `engine` / `fallbackCount`；前端結果面板顯示產生方式／疊字份數／退回筆數／耗時。

- **overlay**：`engine.partition(recordsPayload)` 分派 —— 可疊字的記錄直接 `renderMany()` 寫出 `{MAWB}.pdf`（跳過 Step 3 Excel COM、Step 4 merge／A4 正規化、Step 4.5 字型優化）；非 Latin-1（CNEE 中文／全形標點）與任何例外（背景／fieldmap 缺失、`blankPdfSha256` 不符、`createOverlayEngine` 失敗、單筆 render 例外）都排入**同一批**的舊 COM 路徑（`result.engine.fallbackReasons` 列出 MAWB 與不支援字元）。
- **相容欄位**：`result.engine = { mode, overlay, com, fallbackCount, fallbackReasons, overlayMs }`、`result.fallbackCount`；`result.paper` 照常實測（疊字背景本來就是 A4）；`result.fontOpt` 純 overlay 時 `{files:0, skipped:true, engine:'overlay'}`，**若本次有退回 COM 的檔案則只對那些檔案瘦身**（否則會退回 ~545 KB，與 com 的 123 KB 不一致）。
- 實測（2026-10-13）：com＝3 份 **123.4 KB**／12.1 s；overlay＝3 份 **116.0 KB**／**1.1 s**（≈11× 快）；混合批次（2 疊字＋1 退回）count=3、`engine={overlay:2, com:1, fallbackCount:1}`、errors=[]；背景缺失時全退回 COM 且明確回報「疊字引擎無法使用」。
- ⚠️ `partition()` **只分類不排程**：`fallback[]` 必須自己推回 COM 佇列（`f.record`），否則會靜默少產出（PRD 陷阱 22）。
- 驗證：`node scripts/test-p4-engine.js`（引擎分派）、`$env:XLS_PDF_ENGINE='overlay'; node scripts/test-a4-integration.js`（overlay 端對端）。

**SLI/ELI 版面編輯器（P5 已完成）**：獨立頁 `public/sli-eli-layout.html`（側欄在 **HOME 之後第一位**，未登入顯示鎖頭並導向登入頁）；左＝欄位清單、中＝A4 底圖畫布、右＝屬性面板。

- 功能：拖曳移動、8 向把手縮放、方向鍵微調（Shift=10pt）、5pt 吸附＋格線、Undo/Redo（Ctrl+Z / Ctrl+Y）、對齊工具（含「置中於框」）、字級／行高／顏色／粗體／換行、單欄位還原（草稿）＋全部還原（立即寫檔）、縮放 50–150%、樣本或**真實 job 資料**即時預覽、「產生測試 PDF」（iframe＋下載）、Ctrl+S 儲存、未儲存離開警告。
- API（`routes/xls-booking-layout.js`，掛 `/api/xls-booking/layout`；上層已 `requireAuth`）：`GET /`（fieldmap＋default＋頁面／底圖／樣本／備份／`canEdit`）、`PUT /`（**admin/staff**；白名單＋邊界驗證 → 自動備份 → 寫檔）、`POST /reset`（**admin/staff**；由 `sli-eli-fieldmap.default.json` 還原，可指定 keys）、`POST /preview`（草稿排版＋可選 PDF base64）、`GET /backups`、`GET /background/:page`（底圖 PNG）。
- **推導值一律由後端計算**：前端只送 `origin / box / font / align / wrap / lineHeightPt`；後端算 `textBaselineOffsetPt`（baseline 行盒模型）、`wrapWidthPt`（原值＋框寬變動量）、`maxLines`（`floor(box.h/lineHeightPt)`），並把權威值回傳給前端同步 → **預覽文字位置全部來自 `engine.layout()`，所見即 PDF 所見**。
- 每次寫檔備份 `data/templates/sli-eli-fieldmap.bak-<ts>.json`（含毫秒；已加入 `.gitignore`）。
- ⚠️ `engine.render()` 的 `bytes` 是**位元組數**不是內容 → 要 PDF 內容必須 `render(rec, tmpPath)` 再讀檔（PRD 陷阱 23）。
- 導覽：新增頁面時除了 `index.html` 的 nav，也要把 key 加進 `scripts/fix-nav-order.js` 的 `DEFAULT_ORDER`，否則已有自訂排序的使用者會看到它被排到最後（本機 admin 已用該腳本修復）。
- 驗證：`node scripts/test-sli-eli-layout.js`（自帶伺服器端對端：GET／preview／wantPdf／PUT 400／備份／reset／幾何一致性；結束自動還原 fieldmap）。

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

## 3D ULD 裝箱（bp3d/ + routes/packing*.js）

| 路徑 | 職責 |
|------|------|
| `bp3d/geometries.js` | 半空間幾何：矩形/斜切/輪廓 ULD 一律以平面不等式建模；`boxFits` 8 頂點驗證 |
| `bp3d/uld-definitions.js` | ULD 規格庫（PMC/PAG/PAP/P1P/P6P 矩形、AKE/AKH/ALF/AMA 斜切、PMC-Q6/Q7、PAG-Q7 輪廓） |
| `bp3d/constraints.js` | 支撐率（預設 70%）、堆疊承重、總重、地面壓力、CoG ±10% |
| `bp3d/extreme-points.js` | EP 演算法：旋轉方向控制、候選點產生、貼齊與支撐收斂 |
| `bp3d/solver.js` | 主求解器：4 種排序策略、數量展開、回傳 `sequence`（前端逐步動畫用） |
| `bp3d/ga-lns/` | GA-LNS 啟發式（chromosome / fitness / init / evolve / search） |
| `scripts/solve-worker.js` | 求解 worker（子程序） |
| `public/js/packing/` | 單 ULD 裝箱前端（`packing-main.js` 頁面邏輯、`packing-viewer.js` Three.js 渲染） |
| `public/js/uld-packing/` | 多 ULD 專案前端（state / ui / viewer / viewer-controller / calc / dragger / solve-ui / project / main） |
| `routes/packing.js` | `GET /health`、`GET /ulds`、`GET /demo`、`POST /pack-uld` |
| `routes/packing-projects.js` | 專案 / ULD / 客戶 / 貨物項目 CRUD |
| `routes/packing-solutions.js` | 求解方案 CRUD（`/projects/:id/solutions`） |
| `routes/packing-solve.js` | 非同步求解 job（`POST /solve`、查詢、取消） |
| `routes/packing-pdf.js` | `POST /projects/:id/export-pdf` |

**測試**：`node scripts/test-bp3d.js`、`node scripts/test-packing-api.js [port]`、`node scripts/test-packing-projects.js`、`node scripts/test-q7-api.js`、`node scripts/test-galms.js`

## 打板計劃（routes/pallet.js）

- API（admin/staff）：`/bookings`（+ `/bookings/destinations`）、`/plans`（+ `reorder` / `duplicate` / `items`）、`/spl-codes`、`/remark-templates`、`POST /sync-orders`
- 前端：`public/index.html` 的 `#section-palletization` 區塊 + `public/js/pallet/`（api / state / bookingsController / bookingModal / plansController / planCardRenderer / planActions / planModal / planSorting / planDupUtils / dragController / formatters）+ `public/css/pallet.css`

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
| `projects` / `ulds` / `customers` / `items` / `solutions` | ULD 智能裝箱：專案 / 專案 ULD / 客戶色卡 / 貨物項目 / 求解方案 |

> 共 17 張表（`db/database.js` 建表）。REMARK：舊 `messages`（GuestBook/Forum）表已從建表移除，但舊資料庫仍留有該表，待日後 `DROP TABLE` 與 dbviewer 引用清理。

## 常見任務指引

- **改訂單功能**：後端改 `routes/orders/`，前端改 `public/js/orders.js` + `public/css/orders.css`
- **改打板計劃**：後端改 `routes/pallet.js`，前端改 `public/js/pallet/*` + `public/css/pallet.css`
- **改裝箱功能**：引擎改 `bp3d/*`，後端改 `routes/packing*.js`，前端改 `public/js/uld-packing/*` 或 `public/js/packing/*`
- **改網站內容**：`public/index.html`
- **改主題**：`public/css/base.css`（主題變數）+ `public/js/theme.js`
- **新增資料表**：`db/database.js` 加 `CREATE TABLE`，並在 `routes/` 建對應路由模組，`server.js` 掛載
- **新增文件**：先看 `docs/README.md` 的分類規則（根目錄只放現役導航文件；歷史規格放 `docs/archive/`、設計放 `docs/design/`）
- **前端無框架**：所有前端 JS 直接在 `public/js/` 用全域函式開發

## 注意事項

- 使用 sqlite3 套件的 callback 風格（非 async/await）
- 不要直接編輯 `database.db`
- 修改 `routes/orders/utils.js` 的 `ORDER_NO_PREFIX` 會影響訂單編號產生