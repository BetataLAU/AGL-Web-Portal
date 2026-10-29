# AGL-Web-Portal — 專案地圖（詳細版）

> 用途：供 AI Agent 快速定位功能位置，避免探索整個專案。
> 配合 `CLAUDE.md` 使用：新任務先看 CLAUDE.md 摘要，需要細節再查本檔案。
> 修改專案時請同步更新本檔案。

---

## 1. 檔案總覽

### 根目錄

| 檔案 | 說明 |
|------|------|
| `server.js` | Express 入口：靜態服務、JSON body、session、掛載 8 組 API 前綴（auth / skills / contours / orders / pallet / xls-booking / db）；Port 被佔用自動 +1 |
| `package.json` | 名稱 gemini-intro-site；依賴 express / sqlite3 / express-session / bcryptjs / connect-sqlite3 / multer / exceljs / xlsx / pdf-lib / archiver |
| `database.db` | SQLite 資料庫（自動建立，勿手動編輯） |
| `docs/design/order-system-design.md` | 訂單系統設計紀錄（原根目錄 `ORDER_SYSTEM_PLAN.md`）：欄位規格、電力分類、訂單類型邏輯、電郵總結格式（已實作，含「與現況差異」對照） |
| `docs/design/xls-pdf-parallel-prd.md` | Shipper Role「SLI/ELI PDF 多工並行」PRD（已實作，含實作結果摘要） |
| `docs/research/` | 研究抓取產物（`*-latest.txt`，不進版控） |
| `docs/README.md` | 文件索引與分類規則 |
| `README.md` | 專案說明、API 清單、常見問題 |
| `CLAUDE.md` | AI 專案記憶檔（新對話自動載入，含自動開機流程） |
| `PROJECT_MAP.md` | 本檔案：詳細專案地圖 |
| `WORKSPACE_STATE.md` | 工作狀態交接檔（最後 commit、待辦清單） |
| `FILE_INVENTORY.md` | 自動產生的檔案清單（執行 `npm run sync` 更新） |
| `.project-state.json` | 結構快照（sync 引擎比對用，勿手動編輯） |
| `.clineignore` | AI 忽略清單（node_modules、圖片、db 檔等） |
| `scripts/sync-project-state.js` | 同步引擎：掃描專案、偵測結構變更、更新 FILE_INVENTORY |
| `scripts/xls-workflow.js` | **XLS Booking 主流程**（standardizeRows + runWorkflow，re-export 歷史 API） |
| `scripts/xls-utils.js` | XLS 工具（cleanCell / normalizeMawb / 日期 / 電話 / 航班） |
| `scripts/xls-cnee.js` | CNEE 對照區抽取 + 比對 |
| `scripts/xls-report.js` | Report 模板寫入 |
| `scripts/xls-sli-eli.js` | SLI/ELI 填表、PDF 轉換/合併、ZIP 打包 |
| `scripts/xls-exceljs-guard.js` | 讀檔防護：略過異常大的 defined-name 範圍，避免 WPS 檔造成 OOM（上傳／預覽／process 必載） |
| `scripts/pdf-charset.js` | SLI/ELI 字元支援判定（第 0 層淨化＋第 1 層 WinAnsi；與 `@pdf-lib/standard-fonts` 逐筆核對） |
| `scripts/pdf-cjk-font.js` | SLI/ELI CJK 字型解析（fontkit 按需子集；`.ttc` 取單一字型、解析快取；`PDF_CJK`／`SLI_ELI_CJK_FONT`） |
| `scripts/test-xls-preview-formula.js` | 公式／複合儲存格預覽測試（② 預覽與日期顯示，免伺服器） |
| `scripts/test-xls-standard-cols.js` | ③ 標準化預覽欄寬測試（colgroup 預設值／拖曳／localStorage 記憶／寬度夾制／重設，vm stub DOM） |
| `scripts/test-xls-standard-fields.js` | ③ 雙擊修改 MAWB#／DEST／航班號測試（後端 `fieldOverrides`／勾選過濾＋前端套用與渲染，免伺服器） |

### 後端 `routes/`

| 檔案 | 說明 |
|------|------|
| `skills.js` | 技能 API（GET /api/skills） |
| `contours.js` | Contour 影像：匯出 `contoursRouter`（/api/contours）與 `contourImageRouter`（/api/contour-image） |
| `auth/auth-router.js` | 登入 / 登出 / `/me`、`PUT /me/nav-order`（側邊欄排序） |
| `auth/users-router.js` | 使用者 CRUD、重設密碼、啟用停用（admin only） |
| `auth/middleware.js` | `requireAuth` / `requireRole` / `requirePermission` |
| `orders/index.js` | 訂單 Router 入口 + ORD- → AGL- 編號一次性遷移 |
| `orders/orders-router.js` | 訂單 CRUD、搜尋、重複檢查 |
| `orders/companies.js` | 公司/地點 CRUD，`normalizeCategory` |
| `orders/note-templates.js` | 訂單備註文字範本（GET / POST） |
| `orders/utils.js` | MAWB 工具、`generateOrderNo`、`serializeOrder`、`ORDER_SELECT_SQL` |
| `pallet.js` | **打板計劃 API**：bookings / plans / spl-codes / remark-templates / sync-orders（見 §3.6） |
| `xls-booking.js` | **Shipper Role 空運單據 API**：upload / preview / cnee-preview / process（非同步 job）/ status / cancel / download / report-template / cleanup；掛載 `/layout`（版面編輯器） |
| `xls-booking-helpers.js` | xls-booking 共用：DATA_DIR 路徑、Multer、upload session / job Map、讀檔工具 |
| `xls-booking-layout.js` | **SLI/ELI 版面編輯器 API（P5）**：`GET /layout`（fieldmap／預設／樣本／備份／canEdit）、`PUT /layout`（admin/staff，驗證＋自動備份＋寫檔）、`POST /layout/reset`、`POST /layout/preview`（草稿排版＋可選測試 PDF）、`GET /layout/backups`、`GET /layout/background/:page` |
| `dbviewer.js` | 資料庫檢視器：`isAllowedTable` 白名單保護；單筆/批次編輯與刪除 |

### 前端 `public/`

| 檔案 | 說明 |
|------|------|
| `index.html` | 單一頁面結構 + Sidebar 導航 |
| `css/base.css` | 主題變數（Light/Dark/Ocean）與全域樣式 |
| `css/layout.css` | 版面與響應式 |
| `css/components.css` | 共用元件 |
| `css/animations.css` | 動畫 |
| `css/orders.css` | 訂單系統樣式（手機優先） |
| `css/dbviewer.css` | 資料庫檢視器樣式 |
| `css/utils/modal.css` | 通用 Modal 樣式 |
| `css/utils/cbm-calculator.css` | CBM 計算機樣式 |
| `css/utils/time-picker.css` | 自訂時間選擇器樣式 |
| `css/utils/autocomplete.css` | 輸入即篩選自動補全樣式 |
| `js/theme.js` | 主題切換 + Ocean 自訂色盤 |
| `js/animations.js` | 動畫效果 |
| `js/skills.js` | 技能頁邏輯 |
| `js/contours.js` | Contour 頁邏輯 |
| `js/chat.js` | AI Playground 邏輯 |
| `js/orders.js` | 訂單系統邏輯（前端主軸） |
| `js/dbviewer.js` | 資料庫檢視器邏輯 |
| `js/main.js` | 共用工具與初始化 |
| `js/xls-booking-state.js` | XLS Booking：常數/狀態/工具/上傳拖曳/初始化（第一個載入） |
| `js/xls-booking-upload.js` | XLS Booking：上傳與檔案列表 |
| `js/xls-booking-preview.js` | XLS Booking：自動偵測欄位、預覽面板、欄位指派 |
| `js/xls-booking-grid.js` | XLS Booking：預覽表格編輯（雙擊/右鍵/復原重做） |
| `js/xls-booking-assign.js` | XLS Booking：拖曳指派欄位 |
| `js/xls-booking-standard.js` | XLS Booking：標準化結果預覽、勾選、CNEE 補值、雙擊修改 MAWB#／DEST／航班號（fieldOverrides）、欄寬拖曳調整（colgroup＋localStorage） |
| `js/xls-booking-workflow.js` | XLS Booking：啟動 job、輪詢、中止、結果呈現（含 PDF 產生方式／退回筆數） |
| `js/sli-eli-layout-state.js` | SLI/ELI 版面編輯器：state／幾何（移動縮放對齊吸附）／API／預覽排程 |
| `js/sli-eli-layout-editor.js` | SLI/ELI 版面編輯器：畫布渲染、拖曳縮放、鍵盤、屬性面板、Undo/Redo |
| `js/sli-eli-layout-main.js` | SLI/ELI 版面編輯器：入口、工具列、儲存／還原／測試 PDF、PDF modal |
| `sli-eli-layout.html` | SLI/ELI 版面編輯器獨立頁（Shipper Role Project 的**子功能**，側欄縮排＋「子功能」標籤；底圖拖曳編輯） |
| `css/xls-booking.css` | XLS Booking 樣式 |
| `css/sli-eli-layout.css` | SLI/ELI 版面編輯器樣式 |
| `login.html` | 登入頁（原生 fetch 呼叫 /api/auth） |
| `users.html` | 使用者管理頁（admin only） |
| `js/utils/api.js` | 通用 API 封裝（`apiFetch`，401 自動跳登入） |
| `js/utils/datetime-utils.js` | 日期/時間工具 |
| `js/utils/mawb-utils.js` | MAWB# 驗證/格式化工具 |
| `js/utils/hawb-utils.js` | HAWB# 工具 |
| `js/utils/clipboard-utils.js` | 複製到剪貼簿工具 |
| `js/utils/modal.js` | 通用 Modal（`openModal`） |
| `js/utils/cbm-calculator.js` | CBM 計算機（`openCbmCalculator`） |
| `js/utils/time-picker.js` | 自訂時間選擇器（`setupTimePicker`） |
| `js/utils/autocomplete.js` | 輸入即篩選自動補全（`setupAutocomplete`） |
| `js/auth.js` | 登入狀態、Sidebar 鎖頭與「我的帳號」、導航排序 UI |
| `js/pallet.js` | 打板計劃進入點 |
| `js/pallet/` | api / state / bookingsController / bookingModal / plansController / planCardRenderer / planActions / planModal / planSorting / planDupUtils / dragController / formatters |
| `css/pallet.css` | 打板計劃樣式 |
| `js/loadsim.js` | **模擬裝板系統**進入點（工具列／貨物表單／待裝清單／摘要／板型設定） |
| `js/loadsim/` | units（cm↔inch，cm 整數顯示）/ geometry（6 方向・重疊・輪廓・支撐・自動疊放・可移動範圍 ±40cm・出界界線）/ uld-specs（板型規格庫）/ state（localStorage＋Undo）/ weight（重量／CBM）/ autoplace / colors / **render3d（3D 主視圖・出界引線・hover 邊長）** / render（2D 剖面＋視圖分派）/ drag（Pointer Events・視角・縮放・方向鍵微調） |
| `css/loadsim.css` | 模擬裝板樣式 |

---

## 2. 訂單系統詳解

### 資料模型

**companies 表**（公司/地點）
```
id, category ('customer'|'warehouse'|'transport' 等), name, address,
contact_person, phone, email, notes, created_at
```

**templates 表**（範本 — **已停用**：UI/API 已於 2026-08 移除，表保留供 dbviewer 與公司刪除保護）
```
id, name, company_id, cargo_desc, quantity, weight_kg, cbm,
power_type ('no'|'dry'|'lithium'), receiver_name, receiver_phone, notes, created_at
```

**orders 表**（訂單主表）
```
id, order_no, order_type, mawb, hawb, pickup_no,
pickup_company_id, delivery_company_id,   -- 公司關聯
cargo_desc, quantity, weight_kg, cbm,
power_type ('no'|'dry'|'lithium'), power_code (A67/A123/A199/ELI/ELM), power_items,
urgent ('no'|'yes'), receiver_name, receiver_phone, address, notes,
transport_company, status ('pending'|'progress'|'done'|'cancelled'),
created_at, updated_at
```
相容欄位（自動補齊）：`power_items`、`pickup_datetime`、`receiver_note`、`contact_note`

### 訂單編號格式
- 前綴：`ORDER_NO_PREFIX`（在 `utils.js`，目前為 `AGL-`）
- 格式：`AGL-YYYYMMDD-XXX`（`generateOrderNo` 產生）
- 啟動時會把舊 `ORD-` 開頭編號一次性遷移為 `AGL-`

### 電力分類（航空貨運）
| 選擇 | 代碼 |
|------|------|
| 無電 no | - |
| 乾電 dry | A67 / A123 / A199 |
| 鋰電 lithium | ELI / ELM |

### API Endpoint 總表

| Method | Path | 說明 |
|--------|------|------|
| GET | `/api/orders` | 訂單列表（`?search=` 訂單編號/公司名/提單號、`?status=`） |
| GET | `/api/orders/check-duplicate` | 重複檢查（`?mawb=&hawb=&pickup_no=&exclude_id=`） |
| GET | `/api/orders/:id` | 訂單詳情 |
| POST | `/api/orders` | 建立訂單 |
| PUT | `/api/orders/:id` | 更新訂單 |
| DELETE | `/api/orders/:id` | 刪除訂單 |
| GET | `/api/orders/companies` | 公司清單（`?search=&category=`） |
| POST | `/api/orders/companies` | 新增公司 |
| GET | `/api/orders/note-templates` | 備註文字範本（`?search=`） |
| POST | `/api/orders/note-templates` | 新增/更新備註文字範本 |

> 訂單端點皆在 `/api/orders`（`requireAuth`）之下；customer 角色僅能存取自己公司資料。
> 其他模組：`/api/pallet`（打板計劃，admin/staff）、`/api/auth`、`/api/db`（`db_view`）、
> `/api/xls-booking`（Shipper Role 空運單據，登入；`POST /process` 接受 `engine=overlay|com`）、
> `/api/xls-booking/layout`（SLI/ELI 版面編輯器：`GET /`、`PUT /`、`POST /reset`、`POST /preview`、`GET /backups`、`GET /background/:page`；**寫入需 admin/staff**）。

### 電郵總結（`mailto:` 免設定）
- 自動填收件人（運輸公司 email）、主旨、總結內容
- 支援 `複製總結內容` 用 WhatsApp 等發送
- 格式範例見 `docs/design/order-system-design.md` / `README.md`

---

## 3. 其他後端模組

### dbviewer.js（資料庫檢視器）
- `isAllowedTable(name)`：白名單檢查，防止存取非預期表格
- 支援欄位列出、編輯欄位、刪除（`doDelete`）

---

## 3.6 打板計劃（routes/pallet.js）

| Method | Path | 說明 |
|--------|------|------|
| GET/POST/PUT/DELETE | `/api/pallet/bookings[/:id]` | 板位 booking CRUD |
| GET | `/api/pallet/bookings/destinations` | 目的地清單 |
| GET/POST | `/api/pallet/plans` | 計劃卡列表 / 新增 |
| GET/PUT/DELETE | `/api/pallet/plans/:id` | 計劃卡詳情 / 更新 / 刪除 |
| PUT | `/api/pallet/plans/reorder` | 計劃卡排序 |
| POST | `/api/pallet/plans/:id/duplicate` | 複製計劃卡 |
| POST/DELETE | `/api/pallet/plans/:id/items[/:planItemId]` | 計劃項目新增 / 刪除 |
| PUT | `/api/pallet/plans/:id/items/reorder` | 計劃項目排序 |
| GET/POST | `/api/pallet/spl-codes` | SPL 代碼 |
| GET/POST | `/api/pallet/remark-templates` | 備註範本 |
| POST | `/api/pallet/sync-orders` | 由訂單同步資料至計劃 |

- 權限：`requireRole('admin', 'staff')`
- 資料表：`pallet_plans`、`pallet_plan_items`、`spl_codes`、`remark_templates`
- 前端：`public/index.html` 的 `#section-palletization` + `public/js/pallet/*`

---

## 3.7 模擬裝板系統（純前端，無 API、無資料表）

**用途**：裝板前先模擬「貨物擺進某個板型（Contour / ULD）」是否裝得下、是否超出輪廓、是否超重。

| 項目 | 說明 |
|------|------|
| 入口 | `public/index.html` 的 `#section-loadsim`（側欄「模擬裝板系統」，**免登入**） |
| 前端 | `public/js/loadsim.js` + `public/js/loadsim/*` + `public/css/loadsim.css` |
| 視圖 | 預設 **3D**（自行透視投影＋背面剔除＋由遠到近，無 Three.js）；可切「2D 剖面」＝俯視圖（寬 Z × 長 X）＋前視圖（寬 Z × 高 Y） |
| 單位 | 內部一律 cm 浮點；畫面 **cm 取整數**、inch 1 位小數；重量固定 kg（1 位小數） |
| 板型 | `js/loadsim/uld-specs.js` 內建 13 個，**全部依 HACTL 規格圖**（Q7-00 / Q7-02 / Q7-04 / Q3-00 / Q9-01 / Q6-00 / A4-00 / A2-00 / H2-00 / H3-00 / H4-00 / W2-00 / W2-03），尺寸取自 `public/image/HACTL_contour_spec` 圖上的英吋標註（1" = 2.54cm）；`CX_Contour` 的圖暫不採用 |
| 板面 vs 輪廓 | `baseL/baseW` = 輪廓上限；貼地（板面）由剖面 y=0 的底邊自動推導（`floorX0/floorX1/floorZ0/floorZ1`、`floorL/floorW`、`flared`）。H2/H3/H4/W2 系列是「底部向外斜擴」型：貼地 125"×96"，外擴 12"/18"/7.5"/30"（W2-03 為 186" 輪廓、板底 125" 置中），地板／格線／夾制／自動放置都用板面 |
| 輪廓 | 兩個剖面多邊形（`profileZ` 寬×高、`profileX` 長×高）以「凸多邊形半平面」判定；超出量＝點到該邊的距離 |
| 規則 | 不可重疊、不可懸空（可關）、3D 拖曳自動疊在下方最高支撐面；超出輪廓預設「允許但標紅＋標示超出量＋**紅色區域閃爍**」，可切嚴格模式禁止；超重只警示不阻擋 |
| 出界提示 | 出界區塊（3D 紅色半透明體積＋45° 紅色斜線網底／2D 紅色斜線）**畫在貨物本體之後**（先畫會被 0.94 不透明的貨物蓋掉），3D 端面做背面剔除，透明度隨 `overflowPhase` 弱弱地呼吸；每塊出界區都有 `+xx cm` 標籤，**標籤再用虛線引線連到「界的那一條邊」**（`geometry.loadsimOverflowBoundary()` 算出「貨物剖面 ∩ 超出平面」的線段；3D 取面向鏡頭那一面畫紅線＋圓點，2D 俯視標紅板面邊線、前視標紅輪廓剖面邊），摘要警示列出「#id 方位 +xx cm」，明細列另有「出界」欄 |
| Hover 邊長 | 滑鼠移到貨物上時，**看得見的每一條邊都標長度**：3D `render3d.drawEdgeDims()`（12 條邊中「至少一個相鄰面朝向鏡頭」者，太短 <18px 或同數字 26px 內重複會略過）；2D 俯視／前視各標四條邊（水平＝寬 Z，垂直＝長 X／高 Y，框太小就不標）。浮動 tooltip 的名稱後面帶對應的 **`| #CTN`** |
| 上貨支撐面積 | 上層貨物底面需有 ≥ **50%**（畫面可勾選／調整 0–100，`supportMinPct`，存 localStorage）落在下層頂面；**取消勾選「上貨需壓在下方貨物 X% 面積」＝只要有支撐就不看比例**（仍不可懸空）；多個支撐物以聯集計算，不足時提示「下方支撐面積只有 xx%」；自動疊高也只在合格的那一層停 |
| 單件重量上限 | 可勾選啟用（`itemMaxKg`，預設 1000kg）；取消勾選＝不檢查單件重量（摘要不再列「超過單件上限」） |
| 版面 | 畫布在上方**全寬**（`.loadsim-view`），畫布下方依序是摘要（`#loadsim-summary-top`：件數／重量 chip＋超重・出界警示）與貨物明細列；① **新增/修改貨物**（`#loadsim-dim-rows` 可「＋ 新增」多列尺寸，名稱下方是 MAWB 欄；長/寬/高輸入框只有 54px＝剛好 3 位數，重量／件數 62px；名稱／MAWB 的標籤是固定寬度的 `<span class="loadsim-form-label">`，兩個輸入框左邊對齊；點明細列會載入表單修改）與 ② 待裝在更下方並排（`.loadsim-bottom`）；選項區每項各一行（嚴格模式 → 不可懸空 → 上貨需壓 X% 面積 → 單件重量上限，後兩者可勾選啟用）；板型與單位註記留在卡片底部 `#loadsim-summary` |
| 暫存區 | 板後方（`baseL` + 30cm 起、深 130cm、寬同板寬）的虛線空地：貨物拖進去＝`staged`（不算在板上、不計重量、不做輪廓／重疊／支撐判定，3D/2D 都用虛線灰框畫） |
| 貨物明細 | 畫布下方的 `#loadsim-item-lines`：每件一行（`#id`／名稱／**MAWB**／尺寸／**CBM**／重量／**出界量**／狀態）。CBM＝單件 長×寬×高（`weight.loadsimItemCbm()`，cm³÷10⁶，顯示 3 位小數、可排序）。同一個 MAWB 有多種尺寸時，第一列是 **parent**（顯示 MAWB，右端有 🗑 刪除整個 MAWB），其餘是 **child**（名稱前 `↳` 縮排）；表頭每欄都有 FontAwesome 排序圖示（`fa-sort`／`fa-sort-up`／`fa-sort-down`，升降冪切換、同一個 MAWB 不會被拆開）；列尾 `✕` 刪除單筆尺寸。**點一行 → 該筆（或整個 MAWB）載入 ① 表單修改**，也在畫布上閃爍 1.8 秒 |
| 暫存 | `localStorage['loadsim-state-v1']`（單位／板型／貨物／板型覆寫），免登入、無 DB |
| 刪除／微調 | 明細列刪除後，上方貨物會「物理地」落下（`loadsim/settle.js`，只往下掉、由低到高重算）；選取貨物後方向鍵 ↑↓←→ 在俯視圖方向移動 **1 個顯示單位**（cm 1cm／inch 2.54cm），可移動範圍與滑鼠拖曳相同（`geometry.loadsimClampToMoveArea()`：板面 ±40cm，可以騎出板邊／輪廓），重疊或嚴格模式出界會提示不動 |
| 測試 | `node scripts/test-loadsim-geometry.js`（83 項）、`node scripts/test-loadsim-frontend.js`（122 項，DOM stub／含 3D、轉視角、拖曳 1:1、出界閃爍與引線、hover 邊長、tooltip CTN#、MAWB 群組／排序（含 CBM）／刪除＋重力、方向鍵（含騎出板邊）、表單修改與選項開關） |

---

## 4. 前端重點

### 訂單前端流程（public/js/orders.js）
1. 表單分步驟（Mobile 優先），大按鈕選擇訂單類型 🚚/📥
2. 公司選取後自動帶出地址/聯絡人/電話（可修改）
3. 帶電項目：按「無電/乾電/鋰電」加入一行，「主類別/代碼」用輸入即篩選自動補全（支援自訂代碼）
4. 列表卡片式顯示、搜尋、狀態篩選、狀態顏色標籤
5. 詳情展開、編輯、複製、刪除、狀態變更
6. 電郵總結（mailto:）與複製總結

### 主題系統
- base.css 定義 CSS 變數，`theme.js` 切換 `data-theme`（light/dark/ocean）
- Ocean 支援色盤自訂主題色

---

## 5. 開發注意事項

- **Callback 風格**：sqlite3 套件用 callback，不要改寫成 async/await
- **無 build step**：前端改完直接 refresh 即可，無需 compile
- **Port 自動 +1**：3000 被佔用會嘗試 3001、3002…
- **中文字串**：全專案以繁體中文為主要 UI 文字
- **路由掛載順序**：Express 依序匹配，`/api/orders/check-duplicate` 必須在 `/:id` 之前（目前 arrange 正確）
- **搜尋上限**：訂單列表 SQL `LIMIT 100`