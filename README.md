# AGL Web Portal

航空貨運作業入口網站（內部使用），以 **Node.js + Express + SQLite** 打造，前端為原生 JavaScript / HTML / CSS（無框架、無 build step）。

## 這個網站包含什麼

| 模組 | 入口 | 說明 |
|------|------|------|
| 🔐 登入 / 權限 | `login.html`、`users.html` | Session 登入（Company Code + User ID + Password）；角色 `admin` / `staff` / `customer`，Sidebar 依權限顯示鎖頭 |
| 📦 訂單系統 | Sidebar「訂單系統」 | 收貨/送貨落 ORDER、公司/地點資料庫、電力分類、趕機、電郵總結 |
| ✈️ Shipper Role Project | Sidebar「Shipper Role Project」 | 上傳 XLS 配對表 → 產生 Report + SLI/ELI PDF + ZIP |
| 📥 打板計劃 | Sidebar「打板計劃」 | 板位 booking、SPL 代碼、計劃卡（可從訂單同步）、拖曳排序（需 admin/staff） |
| 🧊 ULD 智能裝箱 | `uld-packing.html` | 多 ULD 專案配載：貨物清單、3D 互動拖拽、GA-LNS 自動求解、方案管理與 PDF 匯出 |
| 🧊 3D ULD 裝箱 | `packing.html` | 單 ULD 求解：ULD 選擇、貨物編輯、Three.js 逐步裝載動畫 |
| 🗄️ 資料庫檢視器 | Sidebar「資料庫」 | 白名單保護的資料表瀏覽 / 編輯 / 刪除（需 `db_view` 權限） |
| 其他 | HOME / AI Playground / Capabilities / Contour | 首頁、聊天示範、技能展示、ULD 斷面圖資 |

### 介面與主題

- 主題：Light / Dark / Ocean（Ocean 支援自訂色盤）
- Sidebar 目錄可拖曳排序：`localStorage` 立即生效 + `PUT /api/auth/me/nav-order` 依使用者持久化
- 訂單系統手機優先（大按鈕 ≥ 48px、響應式 Sidebar、分步驟表單）
- 匯出：CSV / XLSX；彈窗支援 ESC 關閉

## 🚀 快速啟動

```bash
npm install
npm start        # 或 node server.js
```

- 開啟 <http://localhost:3000>（Port 被佔用會自動 +1）
- 內網其他裝置：`http://<本機內網IP>:3000`
- 首次啟動會自動建立 `database.db` 與全部資料表，並建立預設管理員：
  **Company Code `AGL` / User ID `admin` / Password `admin123`**（僅全新環境，登入後請立即改密碼）
- Docker / Railway 部署：見 `Dockerfile`（已含 Python + LibreOffice + 中文字型）

### Shipper Role PDF 產生的環境需求

- **Windows**：安裝 Office（走 Excel COM / pywin32）
- **Linux / Docker**：Python 3 + `openpyxl` + `pypdf` + LibreOffice（`Dockerfile` 已備）
- 並行度：預設 `XLS_PDF_CONCURRENCY=2`，可在介面選 1–4；單機 Windows Excel COM 建議用 `1`

## 📁 專案目錄結構

```text
AGL-Web-Portal/
├── server.js                # Express 入口：靜態服務、session、掛載全部 API 路由
├── database.db              # SQLite 資料庫（自動建立；用 npm run db:export / db:import 同步）
├── bp3d/                    # 3D ULD 裝箱引擎（幾何、ULD 規格、約束、EP 演算法、solver）
│   └── ga-lns/              # GA-LNS 啟發式（chromosome / fitness / evolve / search）
├── db/
│   ├── database.js          # 建表 + 相容欄位補齊 + seed
│   └── db-dump.sql          # 資料庫匯出（版本控管用）
├── docs/                    # 設計 / 歷史 / 研究文件（分類規則見 docs/README.md）
├── routes/
│   ├── auth/                # 登入、使用者管理、權限 middleware
│   ├── orders/              # 訂單 CRUD、公司/地點、備註範本、工具
│   ├── pallet.js            # 打板計劃 API
│   ├── packing*.js          # 裝箱求解 / 專案 / 方案 / PDF
│   └── xls-booking*.js      # Shipper Role 單據工具
├── public/
│   ├── index.html           # 主站單頁 + Sidebar
│   ├── login.html           # 登入頁
│   ├── users.html           # 使用者管理（admin）
│   ├── packing.html         # 單 ULD 3D 裝箱
│   ├── uld-packing.html     # ULD 智能裝箱（多 ULD 專案）
│   ├── css/                 # base / layout / components / animations / orders / dbviewer …
│   │   └── utils/           # modal / cbm-calculator / time-picker / autocomplete
│   └── js/                  # 主站邏輯 + utils/ + packing/ + pallet/ + uld-packing/
├── scripts/                 # XLS 流程、DB 匯出/匯入、測試與維運腳本
└── data/templates/          # Shipper Role 模板（SLI/ELI 母版、年度 Report 工作檔）
```

## 🔐 登入與權限

- 登入方式：`Company Code` + `User ID` + `Password`（`express-session` + `bcryptjs`）

角色與權限：

| 角色 | 權限 |
|------|------|
| `admin` | 全部，含使用者管理（`users.html`）與資料庫 |
| `staff` | 內部員工：訂單、Shipper Role、打板計劃、裝箱、資料庫 |
| `customer` | 客戶：只能看自己公司（`customer_company_id`）的訂單 |

- 相關腳本：`node scripts/test-auth.js`、`node scripts/test-login-lockout.js`、`node scripts/test-customer-isolation.js`、`node scripts/seed-admin.js`
- 注意：Session 使用 MemoryStore（適合單機開發）；多 process 部署需更換 store

## 📦 訂單系統（收/送貨落 ORDER）

手機優先的「收貨/送貨」訂單管理系統，整合在網站左側 Sidebar 的「訂單系統」入口（需登入）。

### 功能特色

| 功能 | 說明 |
|------|------|
| 🚚 / 📥 訂單類型 | 送貨（取貨→送到客戶）／收貨（客戶收貨→交回/轉交）大按鈕選擇 |
| 提單資訊 | MAWB# / HAWB#（非必填）/ 客戶提貨號 |
| 公司資料庫 | 客戶公司、倉庫/自家地點、運輸公司統一存入 SQLite，自動帶出地址/聯絡人/電話（可修改） |
| 電力分類 | ⚡ 無電 / 🔋 乾電 (A67/A123/A199) / 🔋 鋰電 (ELI/ELM) 累積新增，可混用並各自輸入件數 |
| 🚨 趕機 | 🔴 趕機 / ⚪ 普通 大按鈕 |
| 訂單列表 | 卡片式列表、搜尋（訂單編號/公司名/提單號）、狀態篩選、狀態顏色標籤 |
| 訂單操作 | 詳情展開、編輯、複製此訂單、刪除、狀態變更（待處理/進行中/已完成/已取消） |
| 備註範本 | 常用備註文字可存成範本，落單時一鍵套用（`/api/orders/note-templates`） |
| 📧 電郵總結 | `mailto:` 零設定，自動填收件人（運輸公司 email）、主旨、完整總結；另可「複製總結內容」用 WhatsApp 等發送 |
| 手機優先 | 大按鈕（≥48px）、響應式 Sidebar、分步驟表單 |

> 範本（templates）功能的 UI 與 API 已於 2026-08 移除；`templates` 表保留供資料庫檢視器與公司刪除保護。原始設計見 `docs/design/order-system-design.md`。

### 訂單編號

- 格式 `AGL-YYYYMMDD-XXX`（前綴由 `routes/orders/utils.js` 的 `ORDER_NO_PREFIX` 決定）
- 啟動時會把舊 `ORD-` 開頭編號一次性遷移為 `AGL-`

### 訂單電郵總結格式

```text
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📦 訂單總結 AGL-20260108-001
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
類型    ：🚚 送貨
MAWB#   ：157-12345678
HAWB#   ：HKG-987654
提貨號  ：PU-20260108-001
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
收貨公司：XX物流（香港）有限公司
地址    ：香港新界葵涌...
聯絡人  ：陳大文
電話    ：9123 4567
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
貨品    ：電子零件
件數    ：3 箱
重量    ：45 KG
CBM     ：0.52
⚡ 電力  ：有鋰電 (ELI)
🚨 趕機  ：🔴 是 - 需優先處理
備註    ：送貨前請致電
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
運輸公司：XX速運
狀態    ：待處理
建立日期：2026-01-08 15:00
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## ✈️ Shipper Role Project（空運單據工具）

整合於 Sidebar 的「Shipper Role Project」入口（需登入）。用於將客戶提供的 XLS 配對表轉成一系列出貨單據。

### 使用流程

1. **上傳 XLS**：拖曳 XLS/XLSX/XLSM 檔案（可多個）
2. **預覽與定義欄位**：系統顯示表頭與資料，點選每一欄上方下拉選單指定類型（MAWB# / DEST / 件數 / 重量 / 帶電件數 / 航班號 / 航班日期 / REMARK / CNEE 名稱）。支援資料起始列設定。**多工作表檔案（含上傳後再切換 worksheet）時，每個工作表各自的欄位定義（TAG）、資料起始列與預覽狀態會分開記憶，切換不會遺失。**
3. **標準化結果預覽**：即時顯示整理後的資料（日期/航班/MAWB/DEST/件數/重量/REMARK/**CNEE**）供核對；CNEE 欄會依「DEST + REMARK」自動由對照區比對，缺漏的顯示 🔴 並可直接點擊補值（不需重新上傳檔案）
4. **執行產生**：一次完成下列全部動作
   - Report 寫入 `Shipper role service - Summary 2026` 的對應月份 sheet（月份 sheet 不存在時自動複製 `template` 產生並放到最左）；新批次插入第 4 行，組首列填 A/B/G，其餘列填 C-F，每批尾留 1 空行分隔
   - SLI 填表（MAWB#、航班公司碼、DEST、CNEE、日期）→ `{MAWB#} SLI.pdf`
   - ELI 填表（MAWB#、DEST、CNEE、CNEE 電話、日期）→ `{MAWB#} ELI.pdf`
   - 合併同名 SLI+ELI → `{MAWB#}.pdf`（SLI/ELI 單獨檔自動刪除）
   - 依「航班日期」分組打包（同一天的所有航班合併）；單一航班 → `{YYYYMMDD} - {航班號} SLI x {份數}.zip`，同日多個航班 → `{YYYYMMDD} - 多航班 SLI x {份數}.zip`；超過 30MB 自動拆 `(Part x of y)`

> **缺 CNEE 處理**：執行時若仍有 MAWB 對不到 CNEE，會照常產生但 SLI/ELI 的 CNEE 留空，並在執行結果列出「缺 CNEE 警告清單」；請回③點擊紅色 CNEE 格補值後重跑。
>
> **重覆 MAWB 警告**：同一批執行中若偵測到相同 MAWB 出現 2 次以上，會**照常處理不自動刪除**，但在結果列出「重覆 MAWB 清單」（MAWB / 出現次數 / 來源檔案）供人手判斷。

### 功能特色

| 功能 | 說明 |
|------|------|
| 格式彈性 | 不限欄位順序，透過介面「定義欄位」適用各種來源格式 |
| CNEE 對照區 | 自動掃描 sheet 的 A/B/C 欄（A=區塊 key、B=`CNEE:`、C=值）建立「DEST → CNEE」對照表，依 DEST + REMARK 加權比對（含國家關鍵字）；REMARK 空白時取純 DEST 預設區塊 |
| CNEE 手動補值 | 標準化預覽的 CNEE 格點擊即可填寫（存為 overrides，執行時優先於自動對照） |
| CNEE 電話 | 從 CNEE 文字內容自動抽取 TEL（如 `TEL: +44 208 897 0490`）填入 ELI N21 |
| 快速操作 | ①~④ 步驟跳轉列（捲動時固定在頂部）；完成後提供「回① / ▶ 處理下一個檔案」快捷按鈕 |
| 巨集相容 | 直接以 Excel COM 開啟模板（Windows），避開 openpyxl/exceljs 轉檔不相容 |
| PDF 並行 | 介面可選 1–4 個 worker（`XLS_PDF_CONCURRENCY` 為預設值；Windows Excel COM 建議 1），取消時終止全部子程序 |
| 資源清理 | `POST /api/xls-booking/cleanup`（admin/staff）清理逾 24 小時的 job/report、逾 7 天的上傳檔；先傳 `{ "dryRun": true }` 只列清單 |
| 權限 | 需登入，登入後 Sidebar 解鎖 |

### 模板位置（`data/templates/`）

- `cainiao-sli-eli-template.xlsx`（SLI = `air` sheet、ELI = `ELI LETTER` sheet）；另有 `.xlsm` 巨集版
- `shipper-role-summary-2026.xlsx`：年度 Report 工作檔（各月份 sheet + `template` 版面母版）
- 每次執行成功會把最新 Report 同步回工作檔；**執行期間請勿在 Excel 開啟該檔**
- 產出暫存於 `data/work/`（已被 `.gitignore` 忽略），可透過下載連結取得

### API

```http
POST /api/xls-booking/upload                                  # 上傳 XLS（multipart，欄位名 files）
GET  /api/xls-booking/preview/:uploadId/:fileId/:sheetIndex    # 預覽 sheet
POST /api/xls-booking/cnee-preview                             # CNEE 對照區自動抽取 + 比對
POST /api/xls-booking/process                                  # 執行完整工作流程（非同步 job）
GET  /api/xls-booking/status/:jobId                            # 查詢進度
POST /api/xls-booking/cancel/:jobId                            # 中止
GET  /api/xls-booking/download/:type/:jobId/:name              # 下載產出（report / zip）
GET  /api/xls-booking/report-template                          # 下載 Report 模板
POST /api/xls-booking/cleanup                                  # 清理過期產出（admin/staff）
```

## 🧊 3D ULD 裝箱系統

### 引擎（`bp3d/`）

| 檔案 | 說明 |
|------|------|
| `geometries.js` | 半空間幾何：矩形 / 斜切（Extruded Profile）/ 輪廓 ULD 統一以平面不等式建模；`boxFits` 8 頂點驗證 |
| `uld-definitions.js` | ULD 規格庫：PMC/PAG/PAP/P1P/P6P 矩形、AKE/AKH/ALF/AMA 斜切、PMC-Q6/PMC-Q7/PAG-Q7 輪廓 |
| `constraints.js` | 約束：支撐率 ≥70%、堆疊承重、總重量、地面壓力、CoG ±10% |
| `extreme-points.js` | EP 演算法：旋轉方向控制、候選點產生、貼齊與支撐收斂 |
| `solver.js` | 主求解器：4 種排序策略、數量展開、回傳 `sequence`（逐步動畫用） |
| `ga-lns/` | GA-LNS 啟發式（染色體 / 適應度 / 演化 / 搜尋） |

### 頁面

- `uld-packing.html`（ULD 智能裝箱）：多 ULD 專案、貨物清單、3D 互動拖拽、自動求解、方案比較、PDF 匯出
- `packing.html`（3D ULD 裝箱）：單 ULD 求解示範 + Three.js 逐步裝載動畫

### 空運特殊約束

- 斜切幾何：AKE/LD3 以 Y-Z 剖面多邊形擠出 + 8 頂點平面不等式驗證
- 支撐率預設 70%、CoG ±10%、Net Clearance 預設 30mm（皆可用 API options 調整）
- 總重 ≤ ULD payload、地面壓力 ≤ 限值

### 測試

- `node scripts/test-bp3d.js` — 引擎單元測試（幾何/斜切/方向/支撐/求解/重量）
- `node scripts/test-packing-api.js [port]` — API 整合測試（登入 + ULD + 求解 + 錯誤處理）
- `node scripts/test-packing-projects.js`、`node scripts/test-q7-api.js`、`node scripts/test-galms.js`

## 📥 打板計劃（`/api/pallet`，admin/staff）

- 板位 booking（`/bookings`）與目的地清單、SPL 代碼維護、備註範本
- 計劃卡（`/plans`）：新增 / 修改 / 刪除 / 複製、項目排序（拖曳）、可 `POST /plans/sync-orders` 由訂單同步資料
- 前端：`public/index.html` 的「打板計劃」區塊、`public/js/pallet/`、`public/css/pallet.css`

## 🗄️ 資料庫檢視器（`/api/db`）

- 以白名單（`isAllowedTable`）限制可存取的資料表，避免誤改系統表
- 支援列出資料表 / 欄位、單筆與批次編輯、單筆與批次刪除、外鍵下拉與刪除關聯保護
- 需 `db_view` 權限（admin / staff）；前端為 `public/index.html` 的「資料庫」區塊 + `public/js/dbviewer.js`

## 🔧 主要技術

- Node.js + Express 4 + SQLite3（callback 風格，非 async/await）
- express-session + bcryptjs（登入與角色）
- exceljs / xlsx（Excel 讀寫）、pdf-lib（PDF 合併後備）、archiver（ZIP）
- multer（上傳）、Three.js（3D，前端 CDN）
- Python：`scripts/sli-eli-generate.py`（Excel COM / openpyxl 填表）、`merge-pdf.py`（pypdf 合併）
- 前端：Vanilla JavaScript、HTML、CSS（無框架、無 build step）

## 🔗 API 概覽

| 前綴 | 說明 | 權限 |
|------|------|------|
| `/api/auth` | 登入 / 登出 / 目前登入者 | 公開 |
| `/api/auth/users` | 使用者管理、重設密碼、啟用停用 | admin |
| `/api/skills` | 技能清單 | 公開 |
| `/api/contours`、`/api/contour-image` | Contour 影像 | 公開 |
| `/api/orders` | 訂單 CRUD、重複檢查、公司/地點、備註範本 | 登入（customer 僅自己公司） |
| `/api/pallet` | 打板計劃：bookings / plans / SPL 代碼 / 備註範本 / sync-orders | admin / staff |
| `/api/xls-booking` | Shipper Role：upload / preview / cnee-preview / process / status / cancel / download / cleanup | 登入 |
| `/api/packing` | 裝箱：health / ulds / pack-uld / demo / projects / solutions / solve / export-pdf | 登入 |
| `/api/db` | 資料庫檢視器 | `db_view` |

<details>
<summary>訂單系統主要端點</summary>

```http
GET    /api/orders/companies          # 公司/地點清單（?search= & ?category=）
POST   /api/orders/companies          # 新增公司（落單時順手儲存）
GET    /api/orders/note-templates     # 備註範本（?search=）
POST   /api/orders/note-templates     # 新增/更新備註範本
GET    /api/orders                    # 訂單列表（?search= 編號/公司/提單號、?status=）
GET    /api/orders/check-duplicate    # 重複檢查（?mawb=&hawb=&pickup_no=&exclude_id=）
GET    /api/orders/:id                # 訂單詳情
POST   /api/orders                    # 建立訂單（自動產生 AGL-YYYYMMDD-XXX）
PUT    /api/orders/:id                # 更新訂單
DELETE /api/orders/:id                # 刪除訂單
```

</details>

## 🧩 常用指令

```bash
npm start                 # 啟動服務（node server.js）
npm run sync              # 更新 FILE_INVENTORY.md + 結構快照（結構變更後必跑）
npm run db:export         # 匯出 database.db → db/db-dump.sql
npm run db:import         # 由 db/db-dump.sql 重建 database.db
npm run hooks:install     # 安裝 git hooks
```

## 📌 常見修改位置

| 想改什麼 | 檔案 |
|----------|------|
| 主站頁面 / Sidebar | `public/index.html` |
| 主題 | `public/css/base.css`（變數）+ `public/js/theme.js` |
| 訂單系統後端 | `routes/orders/*` |
| 訂單系統前端 | `public/js/orders.js`、`public/css/orders.css` |
| 打板計劃 | `routes/pallet.js`、`public/js/pallet/*`、`public/css/pallet.css` |
| Shipper Role 後端 | `routes/xls-booking.js`、`routes/xls-booking-helpers.js`、`scripts/xls-*.js` |
| Shipper Role 前端 | `public/js/xls-booking-*.js`、`public/css/xls-booking.css` |
| 3D ULD 引擎 | `bp3d/*`（求解邏輯）、`public/js/uld-packing/*`（前端） |
| 裝箱 API | `routes/packing*.js` |
| 資料庫結構 | `db/database.js`（新增表要同步 `server.js` 掛載路由） |
| 通用前端工具 | `public/js/utils/*`（api / datetime / mawb / hawb / modal / cbm / time-picker / autocomplete / clipboard） |

## 📚 文件位置

| 位置 | 內容 |
|------|------|
| `README.md`（本檔） | 對外說明：功能、啟動、API 概覽 |
| `CLAUDE.md` | AI 專案記憶檔（新對話自動載入） |
| `PROJECT_MAP.md` | 詳細專案地圖（資料模型、API 總表） |
| `WORKSPACE_STATE.md` | 工作狀態交接（最後 commit、里程碑、待辦） |
| `FILE_INVENTORY.md` | 自動產生的檔案清單（`npm run sync`） |
| `docs/README.md` | 文件索引與分類規則 |
| `docs/design/` | 現役設計文件（訂單系統設計、PDF 並行 PRD） |
| `docs/archive/` | 歷史規格（DeepSeek ULD PRD / prompt） |
| `docs/research/` | 研究抓取產物 |

## 🛠️ 常見問題

### 1. 啟動後打開空白頁
- 確認 Node.js 已安裝、已執行 `npm install`、伺服器已啟動

### 2. 內網其他裝置無法開啟
- 確認防火牆允許 Node / 3000 Port，改用 `http://<本機內網IP>:3000`

### 3. 資料庫無法使用
- 檢查根目錄是否有 `database.db`；重新啟動服務會自動初始化
- 需要重建時：`npm run db:import`（會依 `db/db-dump.sql` 重建）

### 4. 無法登入 / 忘記密碼
- 全新環境預設 `AGL / admin / admin123`（由 `scripts/seed-admin.js` 建立）
- 可用 admin 於「使用者管理」重設，或執行 `node scripts/seed-admin.js`

### 5. Shipper Role 執行失敗（Report 同步）
- 執行期間請勿在 Excel 開啟 `shipper-role-summary-2026.xlsx`
- Linux 環境需有 LibreOffice；Windows 需有 Excel（COM）
- 卡住或殘留檔案：`POST /api/xls-booking/cleanup`

## 💡 日後可擴展方向

- 把後端 service 層抽出、Session store 換成 SQLite/Redis 以支援多 process
- 訂單系統批次列印 / PDF 匯出、日期範圍統計報表
- ULD 裝箱：多 ULD 自動分配（跨箱最佳化）、即時重量平衡提示



