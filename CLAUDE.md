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

**側邊欄排序（拖曳調整目錄順序）**：`js/main.js` 的 `setupSidebarReorder()` 寫入 localStorage（立即生效）＋ `PUT /api/auth/me/nav-order`（依使用者持久化，`users.sidebar_nav_order`）。合法 key 為 `#section-*` 與 `*.html`（頁面連結如 `uld-packing.html` / `packing.html` **不可漏**，否則存入時被過濾 → 該項目會浮回最上方，看起來像「位置沒記住」）。前端套用排序時，未被列到的項目一律補到最後（不浮到最上方）。修復既有資料：`node scripts/fix-nav-order.js`；API 測試：`node scripts/test-nav-order.js [port]`；前端邏輯測試（stub DOM 載入 main.js）：`node scripts/test-nav-order-frontend.js`。

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
| `scripts/xls-workflow.js` | 主流程（standardizeRows + runWorkflow），re-export 全部歷史 API |
| `scripts/xls-utils.js` | 純工具：cleanCell / normalizeMawb / 日期 / 電話 / 航班 |
| `scripts/xls-cnee.js` | CNEE 對照區自動抽取 + DEST/REMARK 加權比對 |
| `scripts/xls-report.js` | Report 模板寫入 |
| `scripts/xls-sli-eli.js` | SLI/ELI 填表、PDF 轉換/合併、ZIP 打包與分割 |
| `public/js/xls-booking-state.js` | 前端：常數/狀態/工具/上傳拖曳/初始化 |
| `public/js/xls-booking-upload.js` | 前端：上傳與檔案列表 |
| `public/js/xls-booking-preview.js` | 前端：自動偵測欄位、預覽面板、欄位指派 |
| `public/js/xls-booking-grid.js` | 前端：預覽表格編輯（雙擊/右鍵/復原重做） |
| `public/js/xls-booking-assign.js` | 前端：拖曳指派欄位 |
| `public/js/xls-booking-standard.js` | 前端：標準化結果預覽、勾選、CNEE 補值 |
| `public/js/xls-booking-workflow.js` | 前端：啟動 job、輪詢、中止、結果呈現 |
| `public/css/xls-booking.css` | 前端樣式 |

**前端載入順序**：`index.html` 依 `state → upload → preview → grid → assign → standard → workflow` 順序載入（全域函式，inline onclick 使用）。**不可調整順序**。

**測試**：`scripts/test-cnee-lookup.js`（單元 + 端對端，需先上傳 CX 來源檔）。

**PDF 產生並行度**：Shipper Role 第 ④ 步可在頁面選擇 `1`–`4` 個 worker；Windows Excel COM 建議先用 `1`，`2`–`4` 為較高負載實驗模式；未指定時使用 `XLS_PDF_CONCURRENCY`（預設 `2`）。每個 worker 使用獨立 Python/Excel 實例與資料 shard，取消時會終止子程序。

**資源清理**：`POST /api/xls-booking/cleanup`（admin/staff）可清理超過 24 小時的 job/report 與超過 7 天的上傳檔；先傳 `{ "dryRun": true }` 可只列出清單。PDF 合併後會自動刪除中間 SLI/ELI xlsx 與 LibreOffice profile。

**注意**：資料夾層使用 `data/templates/`（報告與 SLI/ELI 模板）、`data/uploads/`、`data/work/`（job 產出），皆可被 `DATA_DIR` 環境變數覆寫。

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