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
- **資料庫檔案**：根目錄 `database.db`（程式自動維護，勿直接編輯）；**不進版控**（`.gitignore` 已列，2026-11-06 起以 `git rm --cached` 停止追蹤，實體檔案保留）。跨機同步一律走 `npm run db:export`／`db:import` → 版控的 `db/db-dump.sql`（pre-commit hook 每次提交都會自動匯出）。

## 頂部工作列與目錄抽屜（public/js/topbar.js + public/css/topbar.css）

原本常駐左側的 `.sidebar`（308px）改為**從頂部工作列往下展開的抽屜**，主內容因此吃滿整個寬度。

- **生效範圍**：只有 `<body class="has-topbar">` 的頁面（`index.html`、`sli-eli-layout.html`）會被改寫成抽屜；`users.html`／`login.html` 沒有這個 class，完全不受影響（`layout.css` 的 `.sidebar` 原樣保留）。
- **DOM**：`<header class="topbar" id="topbar">`（工作列）＋ `<div class="topbar-scrim" id="topbar-scrim">`（遮罩）放在 `.app-layout` 之前；原本的 `<aside class="sidebar">` 只加 `id="app-sidebar"`，內部結構（`.sidebar-nav` / `.nav-item` / 鎖頭 / 拖曳把手 / 登入卡 / 主題切換）完全沒動 → 拖曳排序（`main.js`）與權限鎖頭（`auth.js`）不受影響。
- **最左邊是「☰ 目錄 ＋ 目錄搜尋」一個圓角膠囊**（`<div class="topbar-nav-search" id="topbar-nav-search">`）：左段 `#topbar-menu-btn`（☰ 目錄）→ `.topbar-nav-search-sep`（1px 中線）→ 右段 `#topbar-search`（內含放大鏡圖示與 `#topbar-search-input`，placeholder＝**搜尋目錄**，`Ctrl+K` 提示放在 `title`）。兩者本來就是同一組功能，**不要**再把搜尋框搬回 `.topbar-right`（`scripts/test-topbar.js` 的 A12／C13 會擋）。外框是 `overflow:hidden`，所以**焦點光環畫在外框**（`.topbar-nav-search:focus-within`），左段按鈕的鍵盤焦點用 `inset` 內環，否則往外擴的 `box-shadow` 會被裁掉。
- **互動**（`public/js/topbar.js`）：
  - 最左邊 ☰（`#topbar-menu-btn`）點一下 → `.sidebar.is-open`（CSS `translateY` 動畫往下展開）；再點一下收起。`Alt+M` 亦可切換。
  - **游標離開抽屜 → 自動收合**（`mouseleave` + 260ms 延遲；游標回到抽屜、或搜尋框有內容時取消）。點目錄項目／點抽屜外／`ESC` 也會收合；拖曳排序中（`draggingNav`）不收合。因為 ☰ 與搜尋框是同一個膠囊，**游標停在整組（`#topbar-nav-search`）或點組內任何位置（含放大鏡圖示）都不收合**，點放大鏡會聚焦輸入框。
  - 收合是 `transform: translateY(-100% - --topbar-h)` 往上捲回工作列後面，**不會影響主內容捲動位置**；`body.topbar-nav-open` 會讓工作列轉為近不透明，避免抽屜滑動時從半透明處透出。
  - **內容不會滑到工作列底下（關鍵，2026-11-07 二次修正）**：用 `body.has-topbar { padding-top: var(--topbar-h); height: 100vh/100dvh; min-height: 0; overflow: hidden }` ＋ `body.has-topbar .app-layout { margin-top: 0; height: 100%; overflow-y: auto }`（`--topbar-h: 56px`）。
    **絕對不要改回 `.app-layout { margin-top: var(--topbar-h) }`**：子元素的 `margin-top` 會與 body 上外邊界**合併（margin collapsing）**，margin 被推到 body 外面 → `html` 文件高度變成 `100dvh + 56px`，也就是**視窗本身還能再捲 56px**（實測 `documentElement.scrollHeight - innerHeight = 56`）。一旦視窗被捲動（`#anchor` 連結、`scrollIntoView`（`xlsScrollToEl()` 就是用它）、`window.scrollTo`、PageDown…），整個 `.app-layout` 連同內容與 sticky 的 ①②③④ 步驟列都會往上滑到固定工作列底下 → 看起來就是「工作列和內容重疊」（步驟列只剩一小條從 bar 下面露出來）。改用 body `padding-top`（padding 不合併）＋固定高度＋`overflow:hidden` 後，捲動只發生在 `.app-layout` 內，視窗永遠不會移動（實測 `maxWindowScroll = 0`）。`scripts/test-topbar.js` 的 C5／C12 會擋住這個回歸。
- **工作列右側工具**：（1）目錄搜尋 `#topbar-search-input`（**在左側、與 ☰ 同一個膠囊**，placeholder「搜尋目錄」）：輸入即過濾目錄並展開抽屜（`Ctrl/Cmd+K` 聚焦、`Enter` 跳到第一個符合項目；無結果顯示 `.nav-empty`；`display:none` 的無權限項目不列入過濾）；（2）主題循環切換 light→dark→ocean（有 `theme.js` 時走 `applyTheme()`，沒有時直接改 `data-theme` 並寫入 `localStorage['site-theme']`）；（3）全螢幕；（4）回到頁頂；（5）香港時間（`Asia/Hong_Kong`，每 20 秒對時）。
- **目前位置**：`main.js` 的 `showSection()` 會呼叫 `window.topbarSetSection(sectionId)` 更新 `#topbar-crumb-text`（沒有工作列的頁面不會有此函式，故有 `typeof` 檢查）。
- **滿版對齊與 sticky 偏移（2026-11-07 修正）**：內容區變寬後，`public/css/xls-booking.css` 原本 `.xls-card { max-width: min(1200px, 100%) }` 會讓卡片右側留一大片空白、和滿版的 `.xls-step-nav` 不齊 → 改為 `max-width: none`（日後若要限制閱讀寬度，步驟列與卡片要**一起**限制）。`.topbar` 左右 padding 也改成與 `.main-content` 一致（桌面 24px、≤900px 16px），內容邊界才會齊一。
- **① ② ③ ④ 步驟列貼在工作列下方（純 CSS sticky，2026-11-07 二次修正）**：`.xls-step-nav` 是 `position: sticky; top: 10px`（`xls-booking.css`），`body.has-topbar` 版由 `topbar.css` 覆寫成 `top: 8px` 並給**不透明底色**＋陰影（避免下方卡片文字透出）。因為 `.app-layout` 的上緣＝工作列下緣（見上一條「內容不會滑到工作列底下」），sticky `top: 8px` 就等於「緊貼工作列下方」，不需要 JS 釘位置。跳到某一步時由 `xlsStickyNavClearance()` 量測「nav 高度 + CSS `top` + 12px」寫入目標的 `scroll-margin-top`，避免標題被步驟列蓋住（`scrollIntoView` 只會捲動真正可捲動的祖先 = `.app-layout`）。**先前文件提到的 `xlsUpdateStepNavPin()`／`.xls-step-nav-spacer`／`--xls-step-nav-gap`／`xls-section-fade-in` 在程式碼中並不存在，別再找**；區塊進場動畫仍是 `animations.css` 的 `.content-section.section-enter`。
- **新增工作列功能**：`index.html`／`sli-eli-layout.html` 的 `.topbar-right` 加按鈕 → `topbar.js` 的 `setupTopbar()` 內加一個 `setupXxx()`（沿用 `byId()`），並在 `scripts/test-topbar.js` 補一條驗收。
- **測試**：`npm run test:topbar` ＝ `node scripts/test-topbar.js`（HTML／CSS／JS 靜態檢查 45 項，含 A12／C13「☰ 與搜尋同一個膠囊」、C5／C12「body padding-top＋視窗不可捲」回歸）＋ `node scripts/test-topbar-behavior.js`（以 DOM stub 載入 `topbar.js`，驗證開合／自動收合／ESC／搜尋過濾／主題循環 28 項）。另有 `node scripts/test-nav-hierarchy.js`、`node scripts/test-nav-order-frontend.js` 確保目錄層級與拖曳排序未被破壞。

## 目錄地圖（摘要）

| 路徑 | 職責 |
|------|------|
| `server.js` | Express 入口，掛載全部 API 路由 |
| `db/database.js` | SQLite 建表（含 orders 相容欄位自動補齊）、skills seed |
| `routes/` | 後端 API 模組（見下方分節） |
| `routes/hkia-cdp/` | **HKIA CDP 測試平台 BFF**：設定／`#001` Token／mTLS Proxy／Local Mock／`#409` 簽章／Webhook／SSE（見下方分節） |
| `public/index.html` | 單一頁面 + 頂部工作列／目錄抽屜（含訂單 / Shipper Role / 模擬裝板 / ULD 夾重 / 資料庫區塊） |
| `public/login.html`、`public/users.html` | 登入頁、使用者管理頁（admin） |
| `public/css/` | base / layout / **topbar** / components / animations / orders / dbviewer / **loadsim** / **uld-weight** / **loading-plan** / xls-booking |
| `public/css/utils/` | 通用元件樣式（modal / cbm-calculator / time-picker / autocomplete） |
| `public/js/` | theme / animations / **topbar** / skills / contours / chat / orders / main / dbviewer / auth / **loadsim（含 loadsim/）** / **uld-weight（含 uldweight/）** / **loading-plan（含 loading-plan/）** / xls-booking-* / **hkia-cdp.js** |
| `public/js/hkia-cdp/` | **HKIA CDP 前端模組**：`cto-validator`／`error-codes`（前後端共用 UMD）、`presets`／`snippets`／`api`／`ui`／`flow`（Full/Lite Flow）／`query`／`learn` |
| `public/js/utils/` | 通用工具（api / datetime / mawb / hawb / clipboard / modal / cbm / time-picker / autocomplete） |
| `docs/README.md` | 文件索引與分類規則（根目錄只放現役導航文件） |
| `docs/design/` | 現役設計文件：`order-system-design.md`、`xls-pdf-parallel-prd.md`、`uld-weight-system.md` |
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
| `/api/uld-weight` | `routes/uld-weight.js` | ULD 夾重系統：bookings（Booking Record）/ sheets CRUD / duplicate / lock / apply（回寫 Booking）/ sync-bookings（補建 Booking，預設 dry_run）/ versions（歷史版本／異動比對）/ import-rcl（RCL 磅單）/ report.pdf（單張 A4 PDF）/ loading-sheet.pdf（單板 Loading Sheet，A4／MAWB·DEST·PCS·WT）/ batch-pdf（多張打包 ZIP，admin+staff，見下） |
| `/api/xls-booking` | `routes/xls-booking.js` | Shipper Role 空運單據工具（需登入，見下） |
| `/api/hkia-cdp` | `routes/hkia-cdp/index.js` | HKIA CDP 測試平台（**admin / staff**）：config／auth/test／lint／sign／proxy／history／refs／pending／mock/reset／health／events（SSE）／simulate-callback |
| `/api/hkia-cdp/webhook` | `routes/hkia-cdp/index.js`（`webhookRouter`） | **公開**（可選 Basic Auth）：HKIA → 本平台的非同步 Callback（必須掛在受保護路由之前） |
| `/api/loadsim` | `routes/loadsim.js` | 模擬裝板「雲端存檔」：plans CRUD（snapshot JSON ＋ 件數／重量／利用率彙總；admin+staff。模擬裝板本身免登入，存本機不需要這支 API） |
| `/api/loading-plan` | `routes/loading-plan/index.js` | 執 PLAN：plans CRUD（＋PATCH 表頭）、**封存 `/plans/:id/archive`／RECALL `/plans/:id/recall`（`GET /plans?archived=1` 看封存清單）**、items 加入／搬移（Move 語意）／就地編輯／搬回存貨／複製／bulk（Excel 貼上）／reorder、`/stock`、`/bookings`＋placements、`/placements`、`/plans/:id/events`、**SSE `/events`**、`/events.json`（輪詢降級）、`/presence`（心跳／軟鎖）。**只需登入、不設角色**（實名登記） |
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

**資料表**：`users`（company_id, user_id, password_hash, display_name, role, is_active）；`companies` 的 `company_code`（登入用公司短碼）**建表時就有**（`CREATE TABLE companies` 內含；舊 DB 由 `PRAGMA`＋`ALTER TABLE` 補）。

**預設管理員**：`scripts/seed-admin.js` 啟動時自動建立 `AGL / admin / admin123`（僅全新環境）。`server.js` **必須等 `db.ready`**（`db/database.js` 匯出的 Promise，代表建表與相容性 `ALTER TABLE` 都完成）才 `execFile` 這支，否則全新 DB 會因 `companies.company_code` 還不存在而 seed 失敗（→ 沒有 admin）。

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
| `scripts/uld-weight-report-pdf.js` | **ULD 夾重表 PDF**：`buildUldWeightReportPdf(detail, { issueText })` 產整張 A4 直式報表（表頭／每板 RCL−Tare=淨重＋明細／MAWB 彙總／檢核／全表合計／頁碼）；**`buildUldWeightLoadingSheetPdf(detail, { unitId })`（U3）** 產單板 Loading Sheet（一板一頁、`MAWB／DEST／PCS／WT`、固定 16 列、`To:` 取航班前兩碼）；中文走 `pdf-cjk-font` 子集、缺字以 `?` 取代；`--selftest` 可免伺服器自檢（兩種 PDF 都產一次） |
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
| `public/js/xls-booking-standard.js` | 前端：標準化結果預覽、勾選（**Shift+點擊整段勾選／取消**）、CNEE 補值、**雙擊修改 MAWB#／DEST／航班號**（`fieldOverrides`，同步到 ④）、**欄寬拖曳調整**（colgroup＋localStorage 記憶） |
| `public/js/xls-booking-workflow.js` | 前端：啟動 job、輪詢、中止、結果呈現 |
| `public/css/xls-booking.css` | 前端樣式 |

**前端載入順序**：`index.html` 依 `state → upload → preview → grid → assign → standard → workflow` 順序載入（全域函式，inline onclick 使用）。**不可調整順序**。

**缺 CNEE → 不制作（2026-11-21）**：`runWorkflow()` 在 Step 1（`filterSelectedRecords()` 之後）直接排除「CNEE 空白／只有空白」的記錄 → **Report／SLI／ELI／PDF／ZIP 全部不含該 MAWB**（不再產生 CNEE 留空的檔案），只回報 `warnings`（清單，含 file／mawb／dest／remark）與 `skippedNoCnee`（筆數）；`results[]` 每檔多了 `skipped` 欄（前端顯示「略過 n 筆」）。重覆 MAWB 偵測仍用「勾選到的全部列」（`dupRecords`）→ 即使該列因缺 CNEE 被跳過，來源資料重覆仍會提醒。③ 會標示「執行時不會製作」並加紅字說明。驗證：`node scripts/test-xls-skip-no-cnee.js`。

**同 MAWB 只留 1 筆制作（Step 1.6，2026-11-21）**：輸出檔名固定 `{MAWB}.pdf`（SLI/ELI 每張 MAWB 一份）→ 同一 MAWB 有多列時後面的會**覆蓋**前面的（實測：`157-36504591` 有 CNEE 的主列被後面「EHUB留倉」無 CNEE 的列蓋掉，最後 PDF 沒有 CNEE）。Step 1.6 以 `dedupeRecordsByMawb()` 去重：保留 `recordCompleteness()` 分數較高者（**CNEE 32 分 > 航班日期 8 > 航班號 4 > DEST 2 > 件數／重量各 1**），同分保留先出現者；`results[]` 多了 `deduped`、回傳多了 `deduped`（略過筆數）。Report 也同步只寫 1 筆。重覆警告文案改為「每張 MAWB 只保留 1 筆制作」。

**② 預覽表格兩列表頭（sticky，2026-11-07 修正）**：預覽表 `thead` 有兩列（上＝欄位標籤＋Excel 欄字母／下＝原始欄名），兩列 `th` 都是 `position: sticky`。若兩列都寫 `top: 0`，往下捲時**第 2 列會整片蓋在第 1 列上**（看起來像「吃掉一行」）。現在 `public/css/xls-booking.css` 以 `.xls-preview-table thead tr:nth-child(1) th { top: 0; z-index: 4 }` 與 `tr:nth-child(2) th { top: var(--xls-head-h, 0px); z-index: 3 }` 分層；第 1 列高度不固定（標籤換行）→ 由 `public/js/xls-booking-preview.js` 的 `xlsSyncStickyHeadHeight()`（在 `renderPreviewPanel()` 面板顯示後、`resize`／`orientationchange`、`document.fonts.ready` 時）量測寫入 `--xls-head-h`。③ 標準化表格只有一列 thead，函式會移除變數維持 `top:0`。**不要改回兩列都 `top:0`**。

**測試**：`scripts/test-xls-preview-formula.js`（公式／複合儲存格預覽 + 日期顯示，免伺服器）、`scripts/test-xls-preview-head.js`（② 兩列表頭 sticky 不重疊：CSS 分層／JS 量測／單列表不受影響，含 vm stub 執行期檢查）、`scripts/test-xls-standard-cols.js`（③ 標準化預覽欄寬：colgroup／拖曳／記憶／夾制／重設，vm stub DOM 免伺服器）、`scripts/test-xls-standard-fields.js`（③ 雙擊修改 MAWB#／DEST／航班號：後端 `fieldOverrides`／勾選過濾＋前端套用與渲染，免伺服器）、`scripts/test-xls-std-range-select.js`（③ Shift+點擊整段勾選：錨點／正向反向／整段取消／跨檔／label 留白／錨點清空時機，vm stub 免伺服器）、`scripts/test-xls-skip-no-cnee.js`（缺 CNEE 的 MAWB 不制作：Report／PDF／ZIP 全排除＋重覆 MAWB 仍提醒，免伺服器）、`scripts/test-a4-integration.js`（免伺服器端對端：合成 3 筆跑完 Step 1~5，驗證紙張與 ZIP）、`scripts/test-p4-engine.js`（P4 引擎分派：混合批次／背景缺失全退回）、`scripts/test-sli-eli-layout.js`（P5 版面編輯器：自帶伺服器端對端）、`scripts/test-zip-naming.js`（ZIP 檔名安全化，hermetic）。

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
- **凡讀取「使用者上傳檔案」的模組，最上方必須 `require` 本防護且早於 `require('exceljs')`**（目前：`routes/xls-booking.js`、`routes/xls-booking-helpers.js`、`scripts/xls-workflow.js`）。新增讀檔入口時請一併載入。
- 實測同一檔案：4GB+（OOM）→ 約 22MB；工作表內容／欄列數不變。SLI/ELI 模板的 `Print_Area`（數百格）不受影響。

## HKIA CDP 測試平台（routes/hkia-cdp/ + public/js/hkia-cdp/）

香港機場貨運數據平台（CDP）RA / RACSF / TP Integration Service API v1.27 的測試工作台（PRD：根目錄
`hkia_cdp_testing_site_prd.md`；實作紀錄：`docs/design/hkia-cdp-testing-site.md`）。側欄「HKIA CDP」 →
`#section-hkia-cdp` + `#hkia-root`，**僅 admin / staff**（會用到公司憑證與 API Key；`main.js` 與 `auth.js` 都有限制）。

- **BFF 是必要的**：瀏覽器不能做 mTLS、收不到 server-to-server Webhook。前端一律打 `/api/hkia-cdp/*`。
- **後端**：`routes/hkia-cdp/{index,store,http-client,mock,signature}.js`
  - `index.js`：config（遮罩 secret）／`/auth/test`（#001）／`/lint`／`/sign`（#409）／`/proxy`（#401–#416）／
    history／refs／pending／mock-reset／health／events（SSE）／simulate-callback；另匯出 `webhookRouter`（公開）。
  - `store.js`：`data/hkia-cdp/*.json`（config／history 上限 300／mock-state）＋ pending Map ＋ SSE clients；
    **`HKIA_DATA_DIR`** 可完全隔離（測試用）；`clientSecret`／`webhookPass` 空字串＝維持原值、`null`＝清除。
  - `http-client.js`：15 支 API 定義（#001、#401–#412、#415、#416）、`buildPath()` 自動選 `{ra_reference_id}` 或
    `?cto_predeclaration_num=`／`?waybill_num=`、TLS 1.2 Agent、30 秒逾時、`#001` Token 快取（270 秒）、15 req/s 限流。
  - `mock.js`：Local Mock（202 + 延遲 Callback；#411 用 pdf-lib 產真 PDF）；`scenario` 可模擬 `cto_reject` 等。
  - `signature.js`：圖片 Base64 → SHA-256 → RSA-SHA256（`crypto.sign`）；> 4 MB 回 `IMAGE_TOO_LARGE`。
- **前端**：`public/js/hkia-cdp.js`（入口 / 分頁 / 總覽 / 設定 / Callback 監控 / SSE）＋ `public/js/hkia-cdp/`
  `cto-validator.js`、`error-codes.js`（**前後端共用 UMD**，後端 `require` 同一支）、`presets.js`、`snippets.js`、
  `api.js`、`ui.js`、`flow.js`、`query.js`、`learn.js`。分頁：總覽 / Full Flow / Lite Flow / 查詢（#402／#406／#410／#411 PDF／#412
  ＋ #403・#404・#407・#408 更新刪除）/ Callback 監控 / 設定 / 教學。
- **#409 自動簽章**：`/proxy` 收到 `imageBase64` 且未帶 `imageSignature` → 用設定的 `.key` 簽章（SIT/Prod）；
  Local Mock 沒 `.key` 時用**臨時金鑰**（僅為讓流程可跑）。也可單獨呼叫 `POST /sign`。
- **Callback**：`POST /api/hkia-cdp/webhook`（公開，可選 Basic Auth）→ `invokeCallback()` 比對 `source_id`
  ＝送出時的 `x-request-id`，寫歷史＋`broadcast('callback')` → 前端 SSE 即時顯示並高亮 `cto_errors`。
  **路由順序**：`app.use('/api/hkia-cdp/webhook', …)` 必須在 `app.use('/api/hkia-cdp', requireAuth, …)` 之前。
- **Production 保護**：`/proxy` 要 `confirmProd: true`；前端另有一次 `confirm`；環境切換到 prod 也會二次確認。
- **歷史**：只存遮罩後的大檔（`imageBase64` / `encodedPdf` → `[omitted: n chars]`）；不污染主 SQLite。
- **SIT（Air Global）已預填**：`data/hkia-cdp/config.json`（gitignored）＝ `env=sit`、`role=RA`、`clientId=hkiacargo-ra-ra020371`；
  憑證 `data/hkia-cdp/certs/air_global_sit_2026.pem`（AAHK 簽發：`O=Air Global Limited`、`CN=61.238.133.218`，有效至 2027-11-17）；
  **私鑰仍需放入 `air_global_sit_2026.key`**（申請 CSR 時產生的那一把）。`GET /config` 的 `mtls` 與 `GET /health` 的
  `mTlsRequired / mTlsConfigured / mTlsIssues / mTlsCombinedPem` 會列出缺少的檔案；憑證資訊用 `crypto.X509Certificate` 解析。
- **上傳防呆**：`POST /certs` 會檢查 PEM 內容（CSR ≠ 憑證、憑證 ≠ 私鑰）→ `CERT_FILE_INVALID` / `KEY_FILE_INVALID`；
  合併式 `.pem`（CERTIFICATE ＋ PRIVATE KEY）可同時當 cert 與 key（未設 keyPath 時自動偵測）。
  `.dockerignore` 已排除 `data/hkia-cdp`，避免把本機憑證／Secret 打進 Docker image。
- **驗證**：`npm run test:hkia-cdp`（靜態＋validator／presets／錯誤碼／簽章／路徑／設定遮罩）、
  `npm run test:hkia-cdp-api`（端對端：靜態資源、#001、#405、#401 202＋延遲 Callback、#409 簽章、#411 PDF、
  Webhook Basic Auth、Prod 未確認 400、SIT 缺憑證 `CERT_REQUIRED`）、`npm run test:hkia-cdp-ui`（Chrome CDP 實際登入→
  分頁→#405/#415→SSE Callback；找不到 Chrome/Edge 會 SKIP）；回歸 `test-nav-hierarchy`、`test-nav-order-frontend`、`test-topbar`。
- **陷阱**：① 新增 `<script type="module">` 的頁面功能時，`setupXxxSection` 要在 `initProtectedSections` 之前完成註冊
  （module 在 DOMContentLoaded 前執行，auth.js 的 fetch 是 async）；② 測試若設 `DATA_DIR` 會觸發 server.js 複製
  `data/templates`（其中含檔名結尾空白的檔案，Windows 會 `EPERM`）→ 測試請用 `HKIA_DATA_DIR` 而不是 `DATA_DIR`；
  ③ `EventSource` 不能處理 401 轉址，故 `/events` 維持受保護、SSE 失敗時 UI 顯示離線。

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

## Contour 頁搜尋欄位（`index.html` 的 `#section-contour`）

- **輸入框＋Search 按鈕合成「同一個圓角欄位」**（2026-11-07）：`form#contour-search-form` 就是膠囊外框（`public/css/components.css` 的 `.contour-search-form`：`display:flex`、`border-radius:999px`、`overflow:hidden`）；`input#contour-search-input` 無框線／透明底、`flex:1 1 auto` 佔左側；`button.contour-search-btn` 貼在右側、用 `border-left` 當分隔線（hover 才上淡藍底）。**不要**把按鈕改回 `pill btn-primary`（會變回獨立膠囊並掉到搜尋框下面一行）。
- **placeholder 要短**：`Search code or model…`（原本 `Type to search contour code or model…` 在 360px 欄位裡會被 `type="search"` 的原生清除鈕擠掉、尾端被截斷）。完整說明放 `title` 屬性（滑鼠移上去可看）。
- **覆寫注意**：`base.css` 另有一條 `.contour-search-form input { width:100%; border; border-radius:12px }`，改樣式要在 `components.css` 覆寫（後載入、`.contour-search-form input` 同特異度即可蓋過）。
- **`.contour-controls`**：`flex:1 1 auto; justify-content:flex-end; flex-wrap:nowrap` → 搜尋欄位與 `Show All` 永遠同一行且整組靠右；真的放不下時由外層 `.card-header-flex` 的 `flex-wrap` 整組換行。
- **焦點藍框要畫在「外框」上（2026-11-07 修正，別改回）**：曾經用 `input:focus-visible { outline: 2px solid var(--primary); outline-offset:-2px }`，但 input 自己是 `border-radius:0`（方框），外框是 `999px` 膠囊＋`overflow:hidden` → **左端（左上／左下）的藍邊被圓角切掉，看起來就是「藍邊在圓角處出現缺口」**。現改為 `.contour-search-form:focus-within { border-color: var(--primary); box-shadow: 0 0 0 3px var(--surface-glow), inset 0 1px 2px rgba(15,23,42,0.05) }`（沿用 `topbar.css` 的 `.topbar-search:focus-within` 做法，圓角光環會跟著膠囊走，滑鼠點進來也會顯示），input 的 `:focus`／`:focus-visible` 一律 `outline:none; box-shadow:none`；`button.contour-search-btn` 另給 `border-radius: 0 999px 999px 0`，鍵盤焦點環與 hover 淡藍底才會貼合右端圓角。

## ULD 夾重系統（routes/uld-weight.js，admin/staff）

- **目的**：輸入貨站（HACTL / AAT / CPSL）RCL 磅重 → 選夾重 MAWB（可多票按比例）→ 算出每票 MAWB 的最終重量。
  目標淨重 `R = RCL WT`（**RCL 欄填的就是淨重；Tare 只顯示參考，不從 RCL 扣除**）；磅差 `D = R − Σ 申報重量`。
- **取整**：P / X（交板）一律 **正整數（1.0）**；B（交散貨）可用 **0.5 / 1.0**（表頭可選）。尾差預設由「申報重量最大的夾重票」吸收（`tail_mode = adjust_largest | equal | none`）。
- **不檢核**：ULD Port 可與各票不同、同板各票 Port 也可不同（MIX 混裝）；**Pre-decl Type 完全手動**（1 板 1 MAWB 也可能是 X，不自動判定）。
- **計算核心**：`public/js/uldweight/calc.js`（純函式 ESM，**前後端共用**；後端以動態 `import()` 載入重算後寫回 `final_weight` / `net_weight` / `diff_weight`）。
- **前端**：`#section-uld-weight` + `public/js/uld-weight.js`（入口、事件委派、Excel／摘要匯出）+ `public/js/uldweight/{state,render,api,booking-search,rcl-parse,rcl-import,version-diff,paste-parse}.js` + `public/css/uld-weight.css`；admin/staff 才能用（`main.js` 的 `initProtectedSections`）。
- **MAWB 從 Booking Record 帶入（W1，2026-11 完成）**：`GET /api/uld-weight/bookings?search=&dest=&limit=`（只讀 `mawb_records`）＋ `public/js/uldweight/booking-search.js`。每張收貨單位卡底部的「新增 MAWB」列是**輸入即篩選**（`window.setupAutocomplete`；`renderEditor()` 尾端 `wireBookingPickers(root)`，每次重畫都重綁）：選到後自動帶入件數（`pcs`）／重量（`gross_weight`）／Port（`dest`），並把 `mawb_record_id` 寫進 item（手動改字會清成 null，**手動輸入仍可用**）。候選清單先快取最近 200 筆（60 秒），查不到才打 `search`。
- **回寫 Booking Record（W2，2026-11 完成，D1 已決）**：`POST /api/uld-weight/sheets/:id/apply`（僅 `status='locked'`，未鎖定回 **409**）。以 `calc.js` 的 `uldBookingTotals()` 依 `mawb_record_id` 彙總每票最終重量（同票跨板加總）→ **絕對值覆寫** `mawb_records.gross_weight`（冪等，重量相同走 `skipped(unchanged)`），原重量／新重量寫進 `audit_log.detail`（JSON）。**不動 `orders.weight_kg`**；未連結 Booking、`duplicate_booking`／`mawb_mismatch` 一律不回寫（列在 `conflicts`）。前端編輯畫面在鎖定後才會啟用「套用到 Booking」按鈕。
- **RCL 磅單匯入（W3，2026-11 完成）**：`POST /api/uld-weight/sheets/:id/import-rcl`（multer 記憶體上傳 10MB，`.xlsx`／`.xlsm`／`.csv`；ExcelJS 前先掛 `scripts/xls-exceljs-guard`）。**只解析不寫 DB**（鎖定回 409），回傳 `header_row`／`header`／`columns`／`grid`／`rows`／`skipped`；`sheet` 與 `col_uld/col_tare/col_gross/col_pcs` 可覆寫。解析邏輯是**前後端共用純函式** `public/js/uldweight/rcl-parse.js`（`rclFindHeaderRow`／`rclDetectColumns`／`rclRowsFromGrid`）；前端 `rcl-import.js` ＋ `render.js` 的匯入面板（欄位對應可改、可勾選、只重畫面板），加入後建立草稿單位（Pre-decl 預設 P，需自行確認 P/X）再按「儲存」。**grid 保留空白列**（列號 = Excel 列號）。
- **列印／另存 PDF（W4，2026-11-05 完成）**：`public/css/uld-weight.css` 檔尾 `@media print`（`@page A4 portrait`、單欄、隱藏側欄／`.uldw-header-actions`／`.uldw-editor-actions`／`.uldw-rcl`／所有按鈕與勾選欄／`.uldw-item-add`；輸入框去框線只留值；`.uldw-unit`／`.uldw-totals` `break-inside: avoid`；數字 `tabular-nums`；`.uldw-table-wrap` 改 `overflow: visible`）。前端編輯畫面加「🖨 列印」（`data-action="print"`，**草稿／鎖定都沒有 disabled**）→ `uld-weight.js` 的 `printCurrent()` → `window.print()`。列印區塊用 `html, html[data-theme]` 重設 CSS 變數＋`-webkit-text-fill-color: #000` 強制黑字白底（深色主題／鎖定灰字也能印）。`B 取整`／`尾差` 表頭欄位標 `uldw-print-hide`（紙本不印）。
- **server 端正式 PDF（R1，2026-11-05 完成，D4 已決「要做」）**：`GET /api/uld-weight/sheets/:id/report.pdf`（admin/staff；草稿／鎖定都能下載）→ `scripts/uld-weight-report-pdf.js` 的 `buildUldWeightReportPdf(detail, { issueText })`。資料一律來自 `loadSheetDetail()`（**不在 PDF 內另寫算法**），A4 直式、邊界約 10mm、每板區塊不跨頁、數字右對齊、頁尾「第 N / M 頁」。中文字型沿用 `scripts/pdf-cjk-font.js` 的 fontkit 按需子集（`CustomFontSubsetEmbedder` ＋ `PDFFont.of` ＋ `doc.fonts.push()`；含中文 ≈37 KB、`PDF_CJK=off` ≈2 KB）；字串先用 `scripts/pdf-charset.js` 的 `isStdFont()` 判斷走 Helvetica 或 CJK，缺字以 `?` 取代。前端編輯畫面「⤓ PDF」（`data-action="pdf"`，草稿／鎖定都沒有 disabled）→ `api.js` 的 `fetchReportPdfBlob()`（**不能用 `apiFetch`**，它固定解析 JSON）→ Blob 下載。自我檢查：`node scripts/uld-weight-report-pdf.js --selftest`。
- **磅差門檻可調＋LIH 檢核細分（W5，2026-11-05 完成）**：`uld_weight_sheets` 新增 `diff_warn_pct REAL DEFAULT 2`／`diff_warn_kg REAL DEFAULT 100`（新 DB 在 `CREATE TABLE` 內；既有 DB 由 `db/database.js` 的 `PRAGMA table_info(uld_weight_sheets)` ＋ `ALTER TABLE` 補）。`routes/uld-weight.js` 的 `normalizeHeader()`／`serializeSheetRow()`／INSERT／UPDATE／duplicate 與 `loadSheetDetail()`、PUT 前的 `uldComputeSheet()` 都帶這兩個值（**0／未填 → 預設 2 / 100**）。前端表頭多了「磅差警示 %／kg」兩個數字輸入（`data-header="diff_warn_pct"`／`diff_warn_kg`，`uld-weight.js` 的 `NUMERIC_HEADER_FIELDS` 存數字並只 `refreshComputed()`）。檢核：`LIH_MISMATCH` 拆成 `LIH_UNIT_MISSING`（票有 UN、單位標 N）／`LIH_UNIT_ONLY`（單位標 UN、票都沒有）／`LIH_UN_CODE_MISMATCH`（號碼不一致）；`DIFF_TOO_BIG` 的判定維持 **`|diff| > kg` 且 `|diff%| > pct`**（AND），`detail` 會印出門檻。
- **多票比例上下限（R2，2026-11-05 完成）**：`uld_weight_sheets` 新增 `clamp_min_pct REAL DEFAULT 0`／`clamp_max_pct REAL DEFAULT 0`（**0 = 不限**；既有 DB 用同一段 `PRAGMA`＋`ALTER TABLE` 補）。表頭「比例下限 %／上限 %」（`data-header="clamp_min_pct"`／`clamp_max_pct`，標 `uldw-print-hide`，`NUMERIC_HEADER_FIELDS` 一併處理）。算法：`calc.uldApplyRatioClamp(ratios, minPct, maxPct)`（water-filling：超出界線的票固定在界線，其餘按原始比例重分配；**≥2 票才生效**）；無解（例：3 票各最少 50%、2 票各最多 30%）→ 忽略上下限 ＋ `CLAMP_INFEASIBLE`（warn，不擋存檔）。被限制的票 `item.ratioClamped = true`，畫面比例後面多一個 `*`；`calc.uldComputeUnit()` 回傳 `clampMinPct`／`clampMaxPct`。
- **明細 diff 更新（R3，2026-11-05 完成）**：`PUT /sheets/:id` 不再「先刪後插」，改成以 id 比對（payload 有 id 且在該表／該單位內 → **UPDATE**；沒有 → **INSERT**；DB 有但 payload 沒有 → **DELETE**）。前端 `state.uldSheetPayload()` 會帶 `unit.id`／`item.id`（新列為 `null`）；item 比對加 `uld_id` 範圍避免誤改別板。**不帶 id 的舊格式 payload 仍可存**（退回整批重建，id 會變）。`saveCurrent()` 用回應的 detail 覆蓋 `state.current`，所以下一次儲存自然帶得到新 id。
- **fresh DB 的 seed 競態修正（R4，2026-11-05 完成）**：`db/database.js` 的 `CREATE TABLE companies` 直接含 `company_code TEXT`；同時把相容性工作登記進 `initTasks` 並匯出 **`db.ready`**（Promise），`server.js` 改成 `Promise.resolve(database.ready).then(() => execFile(seed-admin.js))`。API 測試用 `waitForAdmin()` 直接查 DB，確認「伺服器自己」就完成 seed。
- **模組載入**：`index.html` 以 `type="module"` 載入 `js/uld-weight.js`；`public/js/uld-weight.js` 會動態 `import('./loadsim/uld-specs.js')` 取板型代碼當 Contour 建議清單（失敗也照常運作）。
- **批次 PDF 打包 ZIP（V2，2026-11-06 完成）**：`GET /api/uld-weight/sheets/batch-pdf?ids=1,2,3`（也可只給 `status=`／`search=`，**上限 50 張**，超過 400、沒有符合 404）。逐張 `loadSheetDetail()` → `buildReportPdfBytes()`（與單張 `report.pdf` 共用同一段，**不在這裡另寫算法**）→ `archiver('zip')` **在記憶體**打包（`on('data')` 收到 `on('end')` → `Buffer.concat`，不落暫存檔）→ `application/zip`、檔名 `uld-weight-batch-YYYYMMDD-HHmm.zip`。ZIP 內是每張 `<sheet_no>.pdf`（`sanitizeFileLabel()` 去非法字元、同名補 `-2`）＋ `manifest.txt`（UTF-8 **BOM**、`\r\n`，列出表號／狀態／RCL／淨重／磅差與失敗清單）。單張失敗不讓整批失敗，成功／失敗張數放在 `X-Uld-Weight-Pdf-Count`／`X-Uld-Weight-Pdf-Failed`。前端：清單頁每列勾選框＋表頭全選，工具列「⤓ 批次 PDF」→ `api.js` 的 `fetchBatchPdfBlob({ ids })`；勾選狀態存 `state.batchSelected`，只更新計數／按鈕／列底色（**不整份重畫**），清單重新載入會剔除已不存在的 id。**陷阱**：`archiver.append()` 只吃 `Buffer`／`Stream`（pdf-lib 的 `doc.save()` 是 `Uint8Array`，要先 `Buffer.from()`）；路由必須宣告在 `GET /sheets/:id` **之前**，否則 `batch-pdf` 會被當成 `:id`。
- **補建 Booking Record（V1，2026-11-06 完成）**：`POST /api/uld-weight/sheets/:id/sync-bookings`。把**沒有 `mawb_record_id`** 的票（`calc.uldBookingTotals().unlinked`）反推回 Booking Record：已有同號 MAWB（**正規化比對**：SQL `REPLACE(REPLACE(UPPER(IFNULL(mawb,'')),'-',''),' ','') = ?`，與 `calc.uldMawbKey()` 一致）→ **只連結、不重複建立**；沒有 → `INSERT mawb_records`（`gross_weight` = 夾重後重量加總、`pcs`、`dest` = 該票 Port、`remark` = 「由夾重表 &lt;sheet_no&gt; 建立」）。**預設 `dry_run`（只回預覽、不寫 DB）**，要寫入必須明確傳 `{ "dry_run": false }`；**不動 `orders`**（D1）、**不動夾重表重量**（只更新 `uld_weight_items.mawb_record_id`，鎖定中也能執行）；同號 MAWB 在 Booking Record 有多筆 → `skipped(duplicate_booking)`（不猜）；夾重表有 `error` → **422**；寫入記 `audit_log`（`uld_weight.sync_bookings`）、回應同時帶回重讀的 `sheet`。前端編輯畫面「⇧ 補建 Booking」（`data-action="sync-bookings"`）固定走「`dryRun:true` 預覽 → confirm 列出將建立／連結／略過 → `dryRun:false` 寫入」。
- **歷史版本／異動比對（V3，2026-11-06 完成）**：新表 `uld_weight_versions`（`id, sheet_id, version_no, action, status, note, snapshot(JSON), summary(JSON), created_by, created_at`；新 DB 由 `CREATE TABLE IF NOT EXISTS` 建立）。留版時機：**create／save／lock／unlock／apply／sync_bookings／duplicate**（`saveSheetVersion()`）；**內容相同的 `save` 不重複留**，其他事件照留；每張表保留最近 **30** 版（`VERSION_KEEP`，超過刪舊）。快照只存**輸入值**（`buildSnapshot()` 挑欄位，不含 calc 重算結果）。API：`GET /sheets/:id/versions`（新到舊清單）、`GET /sheets/:id/versions/:versionId`（含 snapshot）、`GET /sheets/:id/versions/diff?from=&to=`（`from` 必填；`to` 省略＝與**目前內容**比較；**必須宣告在 `/versions/:versionId` 之前**）。比對規則只有一份：**`public/js/uldweight/version-diff.js`**（`uldDiffSnapshots()`／`uldSnapshotSummary()`，欄位級 `HEADER_FIELDS`／`UNIT_FIELDS`／`ITEM_FIELDS`，配對用 **DB id**、沒有 id 的新列才退回「MAWB + 序」；後端 `import()` 載入）。前端：編輯畫面「🕘 版本」（`data-action="versions"`）→ 面板 `#uldw-versions`（`refreshVersions()` 只重畫面板），每列「與前一版比／對目前」；列印時整個面板隱藏。
- **直觀版 UI（U1／U2／U3，2026-11-06 完成）**：目標是「業界第一眼看就懂、少操作」。
  - **U1 減法版面**：編輯工具列只留 `← 列表／儲存／鎖定·解鎖／⋯ 更多`（`data-action="toggle-more"`），套用／補建／版本／列印／PDF／複製／刪除收進 `.uldw-more-menu`；表頭只留 5 欄＋`⚙ 進階`（`data-action="toggle-adv"`，內含 `round_b`／`tail_mode`／`diff_warn_*`／`clamp_*`，預設收起、值照送、列印自動展開）；收貨單位改成**網格**（`.uldw-unit-list` `auto-fill minmax(380px)`）、板序代號 `01/A`…`41/AO`（`render.unitCode()`）、卡片預設精簡（次要欄位在 `.uldw-unit-more`，`data-compact="1"` 時隱藏）；底部合計改 **`PLAN TTL`／`RCL TTL`／`DIFF`**（單位一律 **K**）；色碼紅＝夾重、橙＝WT 被改（`.uldw-items tr.is-squeeze`／`tr.is-changed`）；**LIH 下拉與報表只顯示短碼 `N`／`3481`／`3091`**（`calc.uldLihLabel()`；存檔值仍是 `UN3481`／`UN3091`）。**顯示狀態一律放 `state.ui`（more／advanced／expanded／allCompact／printUnit），不進 payload、不進版本快照**。
  - **U2 輸入加速**：MAWB 欄 **Enter 直接加入**（`onRootKeydown` → `addItem`）；**貼上多列**（`onRootPaste`＋「⧉ 貼上」按鈕 → `addPastedRows()`；**只攔 MAWB 欄位**——`uldPasteIsMawbField()` 判斷 `data-draft／data-item-field／data-row-field = 'mawb'`，ULD#／Contour／RCL#／Port／件數／重量等欄位照瀏覽器正常貼上，貼在卡片空白處仍當「貼 MAWB 清單」捷徑）；解析用共用純函式 **`public/js/uldweight/paste-parse.js`**（`uldParsePastedRows()`：Tab／逗號／多空白；4 欄 MAWB·DEST·PCS·WT、3／2／1 欄也可；表頭列略過；MAWB 可含空白）。**ULD#／Contour／RCL#／Port／MAWB 自動轉大寫**（CSS `text-transform`＋input/change 轉值＋`uldSheetPayload()` 再轉；`bulk_ref` 不轉）。卡片可**拖曳排序**（`pointerdown` 在 `[data-drag-handle]` 才 `draggable=true`；`uldMoveUnit()` 只改 `seq`）；**上限 41 板**（`ULD_MAX_UNITS`，`state.js`）。
  - **MAWB 格式化與檢查碼（2026-11-06 追加）**：共用純函式 **`public/js/uldweight/mawb-format.js`**（`uldMawbDigits()`／`uldNormalizeMawbDigits()`／`uldFormatMawb()`／`uldValidateMawb()`／`uldMawbCheckDigit()`）。規則：**11 位數字**＝左 3 位航空公司（不足左補 0）＋右 8 位序號（前 7 位＋第 8 位檢查碼＝**前 7 位 mod 7**）；顯示 `000-0000 0000`。行為：輸入框**失焦自動格式化**（輸入中不動，游標不跳）；按 Enter／加入時驗證，不合格用 `confirm` 提示（可選擇仍加入，既有資料不被擋）；貼上多列時**逐筆驗證、不合格列出略過**；明細列不合格的 MAWB 標紅（`data-mawb-invalid`）＋title 說明。另：`addItem()` 會擋「MAWB 與同卡 ULD# 相同」（值被帶到下一格的誤填）。自動完成（`utils/autocomplete.js`）新增 `tabSelects` 選項，夾重表傳 **false**（Tab 只關清單、不選取候選）。
  - **U3 單板 Loading Sheet**：`GET /sheets/:id/loading-sheet.pdf?unit=<uld_id>`（`buildUldWeightLoadingSheetPdf()`；A4 直式一板一頁、`MAWB／DEST／PCS／WT`、固定 16 列含空白列、右上角板序、`To:` = 航班號前兩碼、`Date` = `6 Nov 2026`、`Unit: ULD# / Contour`、`Dest:` = unit port；WT 取 `calc.items[].final`、表內只寫數字）。前端卡片 `⤓`（`data-action="pdf-unit"`）下載單板、`🖨`（`print-unit`）只印該卡（`@media print` 的 `.uldw-print-single` / `.is-print-target`）。
- **U4 載荷表（CHARTER LOADING SHEET）＋方案 B（2026-11-07）**：編輯畫面兩種版面 `state.ui.view = 'grid' | 'cards'`（**預設 grid**；工具列「▤ 卡片檢視／▦ 載荷表」切換，動作 `view-grid`／`view-cards`；切換表時 `resetUiState()` 重設為 grid）。**方案 B 的資料關係**：一票一列的「申報列」放新表 **`uld_weight_mawbs`**（`sheet_id, seq, mawb, mawb_record_id, dest, pcs, declared_weight, wh_ref, auto_alloc, is_squeeze`），各板明細只記**件數**；重量由共用純函式 **`calc.uldAllocateByPcs()`／`calc.uldApplyMawbAllocation()`** 依件數把申報 WT 分到各板（Σ = 申報 WT、尾差給件數最多的板），在 `state.uldComputed()`（前端）與 `loadSheetDetail()`／PUT（後端）都先跑，兩邊數字一致。`auto_alloc = 0`＝保留各板自填重量（**舊資料沒有申報列時，後端 `synthesizeMawbRows()` 用明細彙總自動長出列並設 0**，升級不會偷改重量；前端 `legacyRows()` 再保險一層）。前端新模組 **`public/js/uldweight/sheet-grid.js`**：`uldGridModel()`（純函式）、`uldGridHtml()`（可編輯矩陣）、`uldGridSortRows()`、`refreshGridComputed()`（輸入時只改數字／顏色，不重畫→游標不跳）。版面：左 `SEQ／MAWB／DEST／申報 PCS／申報 WT／W/H or Booking／自動／夾重／上數（Σ 件數｜Σ final；2026-11-09 起兩欄合併成一欄）`，右邊一板一組 `PCS`（手動）＋`WT`（**2026-11-09 起可直接打字改重量**，見下一條），板頭 `01/A`＋`ULD#/Contour`；底部各板 `板合計`／`RCL Gross ／ 磅差`＋`PLAN TTL／RCL TTL／DIFF`（K）。色碼：紅＝夾重、橙＝上數−申報 > 0.5kg、標頭「要自己入」黃底／「會自動計」藍底。操作：最下面一列輸入 MAWB# Enter 新增、`＋ 列`、每列 `✕` 刪除（連同各板件數）、`Clear Content`、`Check & format MAWB#`（列改 MAWB 會同步各板明細）、`Sort by MAWB#`（只改顯示）。卡片檢視改板資料（ULD#／Contour／Tare／RCL／LIH／Pre-decl／夾重方式），卡片內 MAWB 唯讀；**WT（kg）可直接打字**（2026-11-11：與載荷表同一套 `state.uldSetCellWeight()`，固定這一板、其餘依件數重分，輸入框不再 readonly、也隱藏上下箭頭）。API：`GET /sheets/:id` 回 **`mawb_rows`**（申報列；`mawbs` 仍是 calc 的 MAWB 彙總）、PUT 接受 `mawb_rows`（帶 id 做 diff 更新；**不帶＝舊格式，保留 DB 既有列**）、複製會一併複製申報列；版本快照含 `mawbs`，`version-diff.js` 新增 `MAWB_FIELDS` 與 `mawbs` 差異（前端版本面板會列「新增／刪除／改 MAWB」）。列印：`@page uld-grid { size: A4 landscape }`（只有載荷表橫向，卡片仍直式）、`thead` 每頁重印、`tr` 不跨頁、紙上隱藏新增列／自動／夾重／刪除欄。**版面預覽**：`npm run preview:uldweight`（`scripts/uld-weight-grid-preview.js`）用假資料（5 票 × 3 板）產出 `data/work/uldw-grid-preview.html`（`data/work` 不進版控）。
- **載荷表重新設計（2026-11-09：簡潔版面 ＋ 鍵盤手改重量 ＋ 板欄左右拖曳）**：
  - **版面減法**：左邊固定欄 11 → **10 欄**（「MAWB 上數 PCS／WT」兩欄合併成一格 **上數**＝`件數｜重量（夾重後）`，`data-calc-row="upPcs"`／`upWt` 兩個 span 放在同一個 `td`）；工具列左邊（＋列／＋ULD／＋散貨／⇪ 匯入 RCL）右邊（Check & format／Sort by MAWB#／▤ 卡片檢視），圖例下面直接寫鍵盤提示；斑馬紋＋`tr:focus-within` 整列淡藍底。
  - **各板 WT 可直接打字（keyboard 手改重量）**：`<input type="number" data-cell-field="wt" data-cell-unit="<uid>">`，值＝**申報（分到這一板）的重量**，夾重後重量放 `title`。規則集中在 **`state.uldSetCellWeight()`** ＋新純函式 **`calc.uldAllocateWithFixed()`**：打的那一板固定，**剩下的申報 WT 依件數分給其他板（Σ 仍等於申報 WT）**，並把該列 `auto_alloc` 設 **0**（＝手動，畫面上的「自動」勾選同步取消，不重畫）；打超過申報 WT → **夾到申報 WT** 並 toast（否則其他板會被清成 0）；申報 WT 還是 0 → 用打進來的值當申報 WT；該板沒有明細 → `uldEnsureItem()` 自動建。把「自動」勾回來才會依件數重分（toast 說明）。
  - **局部更新**：`refreshGridComputed()` 同步更新其他格的 input value，但**跳過 `document.activeElement`（正在打字的那一格）**，游標不會跳。
  - **鍵盤動線**：`onRootKeydown` → `moveGridFocus()`（`gridFocusSelector()` 用 `data-cell-field`＋`data-cell-unit`／`data-row-field` 找同一欄）：**Enter＝下一列、Shift+Enter＝上一列**（最後一列再往下跳「輸入 MAWB# 新增一票」那格）；Tab 照瀏覽器順序橫向走；`onRootFocusIn()` → `selectInputText()` 讓數字格一進來就全選（打字＝覆蓋，不用先刪 0）。
  - **板欄左右拖曳**：板頭 `<th data-col-unit="<uid>" draggable="true">`（`⠿` 把手；**鎖定時 `draggable="false"`**）→ `onRootDragStart/DragOver/Drop` 用 **`dragKind = 'grid-col'`** 與卡片（`unit-card`）區分，比 **`clientX`** 與欄寬中點決定插在前／後，drop 後 `uldMoveUnit()` ＋ `render()` ＋ toast（改的是 `seq`，存檔才寫回）。樣式 `.uldw-grid-unit-th.is-drop-before/after`（內陰影藍線）、拖曳中 `opacity:.45`。**卡片檢視也支援左右拖**：`cardDropSide()` 依「位移較大的軸」判斷（水平→`is-drop-left/right`、垂直→`is-drop-before/after`）。
  - **列印**：`@media print` 不印 `⠿`；WT 改成 input 之後紅／橙字要**另外指定**（`.uldw-grid-input{color:#000 !important}` 會蓋掉 `td` 的顏色）。
  - **驗證**：`npm run test:uldweight`（calc **121**＋rcl 28＋mawb 33＋frontend **221**；新增 §19 手動指定單板重量 6 項、§24 鍵盤／拖曳 15 項）、`npm run test:uldweight-api`（全通過）、`npm run preview:uldweight`（預覽現在一併載入 `base.css`／`components.css`，畫面與站上一致）；另用 headless Chrome＋臨時 harness（`data/work/`，不進版控）實測「打字分配／Enter·Shift+Enter 換列／拖曳換板序」11 項全過。
- **③ 合併／分配頁重建（2026-11-13）**：`mergeViewHtml()` 全面改版（照概念圖：左 ① MAWB LIST × 右 ② ULD LIST 卡片牆）。
  - **版面＝矩陣（一列一票 MAWB × 一欄一塊 ULD）**：`.uldw-merge-matrix` 是 CSS grid（`grid-template-columns: 296px repeat(N, 198px)`，每格用 inline `grid-row/column` 定位）→ **同一票在所有欄都是同一橫行**；該板沒上這票就留**空白格**（正常，不是錯誤）。左邊 MAWB 欄 `position: sticky; left: 0`（另有 `.uldw-mx-leftbg` 鋪滿整欄底色＋右側陰影，水平捲動時後面的欄不會透出來）；面板 `max-height: 62vh; overflow: auto`，38 票＋37 板都在面板內捲動（水平捲軸固定在面板底）。不在 MAWB LIST 的孤兒票會補一列（「不在 MAWB LIST」）。
  - **欄頭**：`⠿ 01/A [ULD#] ← → ✕` 同一行（tools 14px、ULD# 0.7rem）→ `CONTOUR｜ULD DEST`（2 欄）→ `RCL 淨重` 一行（標籤＋輸入＋kg；未填時同列標「未過磅」）→ LIH chips → 點選 MAWB 後才出現的全寬「＋ 加入（n 件）」。欄底 `.uldw-mx-foot`：`n 票｜n PCS` ＋ `夾重後 n kg`（有 error 紅字）。
  - **格子**：每一票 × 每一板一格；**沒有這票＝空白格**（`.uldw-mx-cell.is-empty`，仍是拖放目標）。有貨的格子 `件數（input）｜重量 kg（input）｜LIH｜✕`（`.uldw-merge-item`，**不顯示 MAWB#**，靠橫向對齊＋左欄 sticky 對應）；分隔線是格子本身的 1px 左右／下框線（低調）；夾重票左側 2px 紅線（inset shadow）、被改重橙字。
  - **件數／重量都可直接打字**：重量欄 `data-item-weight="1"`＋`data-weight-row="<申報列 uid>"`，走既有 `applyItemWeight()` → `uldSetCellWeight()`（**這一板固定、其他板依件數重分，Σ = 申報 WT**，該列轉手動），`refreshComputed()` 會同步其他格子的重量輸入（跳過打字中的那格）、左邊 chip 的「餘 n 件／已分配」，MAWB LIST（①）與 ULD LIST（②）共用同一份 state 所以也同步。輸入框 `appearance: textfield`＋隱藏 `::-webkit-*-spin-button` → **純打字，沒有上下箭頭**；聚焦自動全選。
  - **error 直接顯示**：`#uldw-merge-issues`（`<details>` 可收合，**預設只顯示一行**「⛔ n 項錯誤 ｜ ⚠️ n 項提醒（點開看內容）」），改完即時更新；有 error 的欄頭（`.uldw-mx-head.uldw-merge-unit`）加 `is-error` 紅框、欄底紅字。
  - **十字高亮**：`data-mawb-key` 同時掛在 MAWB chip 與每一格上；`onRootMouseOver()`（`mouseover` 委派）→ hover 一票＝**整行**（`is-xh-row`）、hover 一欄（欄頭／任一格）＝**整欄**（`is-xh-col`，含欄頭／所有格子／欄底），交集顏色更深；拖曳 MAWB／明細時整欄也會亮（`applyMergeHighlight('', uid)`）；`mouseleave` 清除、`render()` 歸零。
  - **MAWB 欄**（矩陣第一欄、sticky）：淡灰序號細字＋MAWB（格式化）＋`DEST｜PCS｜kg` **單行不斷行**＋右側狀態純文字（`已分配` 綠／`餘 n 件` 橙／`未填件數` 灰）；板數與夾重後放 tooltip（不佔行高）；`已分件數 x / y PCS` 進度條（分完轉綠）；底部「← 回 ①② 補資料」。全表合計 `#uldw-merge-totals` 在面板最下方。
  - **拖曳**：MAWB／明細可拖到任何一格（含空白格）；**欄位排序只能拖欄頭**（`.uldw-mx-head`，避免拖格子時誤搬整欄）；`onRootDragStart()` 先擋 `input／textarea／select`（在輸入框拖文字不會拖動整票）。
  - **預覽**：新增 `npm run preview:uldweight:merge`（`scripts/uld-weight-merge-preview.js` → `data/work/uldw-merge-preview.html`；`--picked` 多產「已點選 MAWB」、`--demo-hover` 產十字高亮示意，同一次也產 37 板壓測 `uldw-merge-preview-37.html`）。測試：`npm run test:uldweight` frontend **269** 項（新增 §27 合併頁重建 22 項）。
- **測試**：`npm run test:uldweight`（calc **121** 項＋rcl 28 項＋mawb 33＋frontend **221** 項；§14 列印、§15 門檻／LIH、§16 比例上下限、§17 diff／PDF、§18 批次勾選、§19 補建 Booking、§20 版本比對、§22 載荷表 21 項、§23 方案 B 申報列 14 項、**§24 載荷表重新設計 16 項**）、`npm run test:uldweight-api`（端對端（含 B1～B11 申報列），自帶伺服器 + 暫存 DB，含 `/bookings`、`/apply`、`/import-rcl`、`report.pdf`、`loading-sheet.pdf`（單板／全板／unit 不存在 404）、`batch-pdf`（ZIP 結構／`manifest.txt`／PDF 檔頭，測試自行解析 ZIP 中央目錄）、`sync-bookings`（dry_run 預覽不寫 DB／寫入後回填連結／同號 MAWB 只連結／冪等／audit_log）、`versions`（清單排序／單版快照／diff 增量／`to` 省略對目前／相同內容不增版／lock·unlock 各留一版）、上下限往返、明細 id 不變、fresh DB seed）、`node scripts/uld-weight-report-pdf.js --selftest`、`npm run bench:uldweight`（V4 效能基準，見下）、設計文件 `docs/design/uld-weight-system.md`。
- **效能（V4 量測，2026-11-06 完成 → 不做節流）**：`scripts/bench-uld-weight-calc.js`（`npm run bench:uldweight`）只呼叫 `calc.uldComputeSheet()` 量單次耗時（暖機 10 次、量 60 次、取 median）；實測 **50 板 × 10 票 median 約 0.6ms**（0.58～0.68ms，p95 約 1.5ms）、**100 板 × 20 票 約 2.4ms**，遠低於 16ms（一個 frame）→ **維持每次輸入整表重算，不加 debounce／rAF 節流**。前端輸入事件仍只做 `refreshComputed()` 局部更新（不可整份 `render()`）。日後若真的卡頓：先重跑 `npm run bench:uldweight`，仍 > 16ms 才依 `docs/design/uld-weight-remaining-work.md` §1.1 做輸入節流（30～60ms debounce，`change`／存檔前必須立即重算）。
  量測注意：① 首次呼叫含 JIT，單次 `console.time` 不可信，要看 median；② 本工具只量 calc，DOM 更新（500 列 `textContent`）不在內，要用 Chrome DevTools Performance 才看得到；③ PowerShell 會把 node 的 `MODULE_TYPELESS_PACKAGE_JSON` stderr 警告顯示成 `exit code 1`，腳本其實成功。
- **進度**：Phase 1 ＋ W1～W5 ＋ **R1（server 端 PDF）／R2（比例上下限）／R3（明細 diff 更新）／R4（seed 競態）** ＋ **V2（批次 PDF ZIP）／V1（補建 Booking Record）／V3（歷史版本）** 全部完成（V1／V2／V3 為 2026-11-06）；**已無必辦項**，剩下的是選用（V4 大表節流，實測卡頓才做）與 D3／D5／D6 待決。**未完成工作清單與新對話提示詞見 `docs/design/uld-weight-remaining-work.md`**（歷程與陷阱見 `docs/design/uld-weight-phase2-handoff.md`）。
- **UI/UX 重製（2026-11-11）**：流程改成三頁——**LOT 列表**（`renderList()`：`#uldw-list-search` 即時本機篩選＋300ms debounce 打 `GET /sheets?search=`（含 LOT／航班／貨站／經手人／日期）、狀態 chips `data-action="list-status"`、LOT 卡片／批次勾選）→ **建檔頁**（`renderEditor()`，`ui.step='build'` 預設）：**① MAWB LIST**（`mawbListPanelHtml()`，MAWB#／DEST／PCS／WT，**Excel 式格線**：`<colgroup>` 固定欄寬、`table-layout:fixed`、欄頭 sticky、儲存格框線與 focus ring；欄頭與內文對齊（DEST 置中、PCS／WT／最終靠右）；在任一格 Ctrl+V 貼上 Tab／換行分隔的 xls 區塊 → `pasteMawbGrid()`／`applyMawbGridRows()` 從目前列往下填、列不夠自動新增；`data-row-field` 沿用既有事件；加入列 `#uldw-mawb-new`、`mawb-add`、`paste-mawbs`、`grid-check-mawb`；MAWB 檢查碼不合格標紅 `data-mawb-invalid`／`is-invalid`，存檔前 `invalidMawbs()` 會列出並 confirm）＋ **② ULD LIST**（沿用 `.uldw-unit` 卡片；每塊 ULD 自帶 MAWB 明細，LIH 改成 chips `data-action="toggle-lih"`）→ **③ 合併／分配**（`ui.step='merge'`、`mergeViewHtml()`：左 MAWB 池 `data-mawb-chip`、右 ULD 分欄 `data-merge-unit` 可左右拖曳；MAWB 可拖到 ULD（`uldAssignMawbToUnit()`，預設帶未分配件數）或點選後按「＋ 加入」；明細可跨 ULD 搬移 `uldMoveItemToUnit()`）。拖曳種類在入口以 `dragKind = 'merge-mawb' | 'merge-item' | 'merge-unit'` 區分，`onRootDragEnd()` 會清乾淨。**LIH 多選**：存檔仍是單欄 `lih_type`，組合值 `UN3481+UN3091`（`calc.uldLihCodes/uldLihValue/uldLihToggle`；後端 `lihValue()` 正規化），檢核改成集合比較（3481 與 3091 可並存，不再誤報 `LIH_UN_CODE_MISMATCH`）。**重量單位一律 kg＋「允許使用 0.5 kg」**：`uld_weight_sheets.allow_half_kg`（0/1，舊 DB 由 `ALTER TABLE` 補上，預設 0）；勾選＝所有重量可 0.5（P/X 0.5、B 用 `round_b`，預設切換時自動設 0.5），未勾選＝`calc.uldComputeUnit` 一律 `roundInc=1`、payload／後端 `weightValue()`／前端 `roundWeight()` 全部四捨五入成整數；重量輸入 `step` 由 `weightStep()` 統一（1／0.5）。CSS 新增 `.uldw-lot-*`／`.uldw-panel`／`.uldw-mawb-*`（Excel 格線）／`.uldw-half-kg`／`.uldw-lih-chip`／`.uldw-merge-*`（深色主題與列印都有對應）。測試：`npm run test:uldweight` calc **122**＋frontend **243** 項（新增 §25 新 UI 14 項、§26 重量 kg／0.5kg／Excel 格線 8 項）、`npm run test:uldweight-api`（新增 LIH 組合往返、ULD WT 選填、allow_half_kg 0／1 往返共 5 項）。



## 模擬裝板系統（public/js/loadsim/；模擬免登入、存檔分本機／雲端）

- **入口**：`public/index.html` 的 `#section-loadsim`＋`public/js/loadsim.js`（`type="module"`，`window.setupLoadsimSection` 由 `main.js` 的 `DOMContentLoaded` 呼叫，**免登入**）
- **模組**：`loadsim/units.js`（cm↔inch，內部一律 cm；**cm 顯示取整數、inch 1 位小數**）、`geometry.js`（6 方向／AABB 重疊／輪廓半平面＋凹多邊形／支撐／自動疊放高度）、`uld-specs.js`（26 個 **HACTL** 板型規格＋覆寫）、`state.js`（貨物清單／localStorage／Undo／**快照 `loadsimSnapshot()`＋`loadsimApplySnapshot()`**）、`plans.js`（**存檔：本機多份／雲端 API／匯出・匯入 JSON**）、`weight.js`（重量與利用率）、`autoplace.js`（自動放置）、`colors.js`（主題色／rgba／明暗）、`render3d.js`（**3D 主視圖**：自行透視投影＋背面剔除＋由遠到近）、`render.js`（2D 剖面視圖＋視圖分派 facade）、`drag.js`（Pointer Events／視角旋轉／縮放）
- **存檔 / 載入（2026-11）**：工具列「💾 存檔」＝填名稱後「存到本機」（`localStorage['loadsim-plans-v1']`，可命名多份、上限 30 份、同名覆蓋、免登入）或「存到雲端」（`/api/loadsim/plans`，**admin / staff 登入後才能用**，換電腦／同事共用）；「📂 我的存檔」＝本機＋雲端清單（載入／改名／刪除）＋「⬇ 匯出目前這塊板」／「⬆ 匯入 JSON」（帶檔備份、可傳給同事）。三種位置存的是**同一份 snapshot**（`state.loadsimSnapshot()`：`unit / uldCode / plateType / items(尺寸・重量・擺位・旋轉・MAWB) / 檢查選項 / specOverrides / seq / savedAt`；重量・CBM・利用率載入後重算）。載入前會 `loadsimPushHistory()`，所以 **Ctrl+Z 可回到載入前**；`loadsimApplySnapshot()` 會驗證板型、修復缺號／重複的貨物 id、重算 `seq`。板型設定覆蓋值（`specOverrides`）一定要一起存，否則載入後板型尺寸會跑掉
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
- **暫存區（三個，2026-11；2026-11 面積加倍）**：`geometry.loadsimStageRect()`＝**暫存區① 板後方**（x = baseL + 30cm 起、深 **260cm**、寬同板寬）、`loadsimStageRect2()`＝**暫存區② 板前方**（z = 板寬/2 + 30cm 起、深 **220cm**、長同板長）、`loadsimStageRect3()`＝**暫存區③**（① 與 ② 延伸出去的重疊角落：x 同 ①、z 同 ②）；深度＝基準深度（130／110）× `LOADSIM_STAGE_AREA_SCALE`（預設 2＝面積加倍，改成 1 就回到原尺寸），所以 ① ② 面積都是原本 2 倍、③ 兩邊都加倍＝4 倍。三者都貼地；`loadsimStageRects()` 回 `[back, front, corner]`（各帶 `id`／`label`）、`loadsimStageAt(ext, spec)` 用「貨物中心」判斷落在哪一區（都不在回 `null`）、`loadsimClampToStage()` 夾在該區內貼地、`loadsimStageMaxExtent(spec, dims)` 給拖曳用的 extraMaxX／extraMaxZ。3D/2D 都畫出三個虛線暫存區並標「暫存區①②③」；取景（3D `framePoints`、2D `layout.sceneZ0/sceneZ1/sceneL`）一併納入，拖出去才看得到落點。2D 俯視圖的 z→px 換算改成看 `panel.z0`（俯視圖＝場景左緣、前視圖＝−板寬/2），改動 `zToPx()/pxToZ()/loadsimComputeLayout()` 時別把這個偏移弄丟。
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
- **測試**：`npm run test:loadsim`＝`node scripts/test-loadsim-geometry.js`（幾何/重量/單位 **136 項**）＋`node scripts/test-loadsim-frontend.js`（DOM stub **159 項**，含 3D 投影／命中／視角／縮放、方向鍵螢幕方向、畫布高度與捲動無關、存檔 modal 與「存到本機」）＋`node scripts/test-loadsim-plans.js`（存檔模組 **48 項**：快照還原、本機多份／同名覆蓋／30 份上限／空間不足、匯出匯入 JSON、雲端 API 呼叫、HTML・CSS・路由・資料表靜態檢查）；另 `npm run test:loadsim-api`（`scripts/test-loadsim-api.js`：自帶伺服器＋暫存 DB，驗 401／403／422／404、CRUD、彙總與審計日誌）。Node 會出現 `MODULE_TYPELESS_PACKAGE_JSON` 警告屬正常（專案 package.json 非 ESM）
- **注意**：`loadsim.js` 的模組層有 `window.setupLoadsimSection` 與 `MutationObserver`，Node 測試需先 stub `window`/`document`/`canvas`（見 `scripts/test-loadsim-frontend.js`）

## 執 PLAN（Loading Plan；Phase 0：計算核心＋資料表＋Excel 匯入）

目標：把 `Yat Loading Plan/AGL執PLAN.xlsx` 的 copy/paste 工作流搬到 Web（多人同時操作、KPI 自動檢核）。
**已確認的業務規則（2026-11）**：存貨重複 → Move 時從存貨移除；`P` = Pallet、`C`/`CTNS` = Carton；
owner（SKY DRAGON／SPACE…）= 板位實際 owner；Plan 識別名固定 `Flight# / Flight Date / Owner`；實名登記（`requireAuth`）。

- **計算核心**：`public/js/loading-plan/calc.js`（ESM 純函式，前後端共用；比照 `uldweight/calc.js`）
  - `VOL = CBM ÷ 0.006`、`CBM = VOL × 0.006`；`cu.ft ↔ CBM`（1 cu.ft = `0.028316846592` m³）
  - `lpParsePkgs()`：`17+7P` → cartons 17 + pallets 7 = 24；`CTNS` → **件數未填**（不亂猜 1）
  - **合計一律「逐列四捨五入再加總」**：用總 CBM 回算會與 Excel 差 0.9～2.8 kg（DAY 1/DAY 7 已驗證）
  - `lpPlanLabel()` → `EK9859 / 14NOV / SKY DRAGON`（缺值顯示 `—`）
  - `lpContourParse()` 容忍表頭雜訊：`1 X Q5 '新BSA` → Q5、`1 X Q5 / /半板` → Q5、`CO-LOAD` → 空代碼
  - `lpFormatCrd()`／`lpCrdToIso()`／`lpShiftIsoDate()`／`lpCrdIssue()`：CRD 的 `DDMMM` 顯示、年份推斷、±N 日（跨月／跨年）、`CRD ≤ Flight Date` 檢核（前後端共用）
  - `lpResolveContourCode(code, knownCodes)`：需傳入 `LOADSIM_ULD_SPECS.map(s => s.code)`；**`Q5` 目前不在規格庫**（known=false，UI 顯示「未收錄」TAG）
- **資料表**：`loading_plans`（一個 Excel 區塊＝一張 flight plan；`type='stock'`＝存貨）、`loading_plan_items`、`loading_plan_events`（SSE 補送）、`loading_plan_presence`
  - 一票 booking 同時只屬於一個 plan（Move = 改 `plan_id`）；Copy 會寫 `split_of_item_id`。**重複 MAWB 由後端全域判定**（正規化 MAWB 出現在 >1 筆明細，含跨 PLAN、同 PLAN、存貨）：每一筆都回傳 `duplicate_mawb`＋`duplicate_places`，畫面所有相關列都標色＋hover 顯示「重複 MAWB（也在 …）」
  - `UNIQUE(plan_id, mawb_record_id)`；`mawb_record_id` 允許 NULL（Excel 有「有重量但沒 MAWB」的列，仍要計入 KPI）
  - 已開 `PRAGMA journal_mode = WAL` ＋ `busy_timeout = 5000`（多人同時寫入）
- **Excel 匯入**：`npm run import:loadingplan`（dry-run）／`...:apply`（寫入）／`--apply --reset`
  - `DAY 1..7 / OTH`：每個 `FLIGHT NO.:` 表頭＝一張 plan。**表頭佔連續兩列，只取第一列**（否則同一區塊解析兩次）；E = 日碼、H:J = 航班、O:R = CONTOUR、S:X = owner
  - 「存貨」→ `type='stock'`；**與航班重複的 MAWB 一律從存貨移除**；跨航班重複保留第一處＋列 conflict
  - **VOL 有原值就保留**（Excel 是人手微調），空白才由 CBM 回算 → 這樣 KPI 才與 Excel SUM 完全一致
  - 實跑驗收：13 張 plan／71 筆；`EK9859` = 4,304 / 5,934 / 35.62（＝Excel P19/Q19/R19）；存貨 49 → 移除 29 → 保留 20（有 MAWB 15、無 MAWB 5）
- **測試**：`npm run test:loadingplan`（`scripts/test-loading-plan-calc.js`，**90 項**：換算往返、逐列捨入、PKGS、planLabel、contour 雜訊、KPI／MAWB 去重、CRD（DDMMM／跨月跨年／Flight Date 檢核）；＋ `scripts/test-loading-plan-crd.js`，**22 項**：鍵盤 ↑↓ ±1 日（30NOV ↑→01DEC、01DEC ↓→30NOV、跨年／閏年）、Flight Date 檢核、手動輸入（DD／DDMMM／DD-MM／ISO／清除／錯誤）；＋ `scripts/test-loading-plan-dim.js`，**39 項**：DIM 格式、驗證（缺欄／尺寸／PCS）、`DIM(CM):` 標題／區塊（不重複、不跨備註）、附加 REMARK 與長度上限；＋ `scripts/test-loading-plan-frontend.js`，**202 項**：HTML/CSS 掛載點、ESM 模組載入、欄位順序（MAWB→DEST→CLIENT）／固定欄寬、TAG／明細列／存貨列（含 VOL 右側圓角 CRD 按鈕）／卡片與合計列渲染、hover 閃爍／Active PLAN 脈動、state、API 路徑、位置清單「現在的位置」、REMARK 展開／DIM 輸入器（含 Booking modal 備註欄）、Booking 的 MAWB 嚴格驗證、新增 Booking（CRD／TAG 已與 REMARK 合併）、CRD 欄（DDMMM／↑↓ ±1 日／不可遲於 Flight Date／表頭與日期一起靠右／與 REMARK 加大欄距）、**封存／RECALL（卡片按鈕、封存清單切換、API 路徑、後端路由與防護、位置清單標示）**）
  ＋ `npm run test:loadingplan-api`（`scripts/test-loading-plan-api.js`，**126 項**：自帶伺服器＋暫存 DB，驗 401、存貨自動建立、plans CRUD、bulk（cu.ft→CBM）、Move（不是複製）、搬回存貨、PATCH（VOL→CBM、REMARK 保留換行、CRD → ISO／422 `crd_after_flight`／`crd_invalid`）、複製 409、跨 PLAN 重複 MAWB 標記、placements 標籤、事件流、刪除保護、422/404、audit、新增 Booking 的 MAWB 嚴格驗證（位數／檢查碼／prefix → 422、自動格式化、後補MAWB# 例外）與 CRD（DDMMM→ISO）、**封存／RECALL（存貨 409、清單過濾、重複 MAWB 排除、封存期間不可加入／貼上／排序／編輯、placements 標示、事件＋audit、idempotent）**）
- **API（Phase 1 完成）**：`routes/loading-plan/index.js`，掛在 `/api/loading-plan`（`requireAuth`，不設角色）
  - `GET /plans?type=&search=&archived=`（**預設排除封存**；`archived=1` 只回封存清單、`archived=all` 全部）｜`GET /plans/:id`｜`POST /plans`｜`PATCH /plans/:id`｜`DELETE /plans/:id`（有明細 409、存貨不可刪）
  - **`POST /plans/:id/archive`（封存）／`POST /plans/:id/recall`（RECALL 取回）**：只改 `loading_plans.archived_at`／`archived_by`（明細完整保留）；存貨不可封存（409）、重複呼叫 idempotent（回 `already:true`）、寫 `plan.archive`／`plan.recall` 事件與 `audit_log`。封存期間該 PLAN 不可加明細／貼上／排序／改明細／改表頭（皆 409），拖入也一併擋；**封存的 PLAN 不列入重複 MAWB 判定**
  - `POST /plans/:id/items`（`mawb_record_ids` 或 `item_ids`；**一票只在一處 → Move**）｜`POST /plans/:id/items/bulk`（貼上，最多 500 列）｜`POST /plans/:id/reorder`
  - `PATCH /items/:id`（只送 `volume_weight`/`cuft`/`cbm` 其中一個，後端重算另外兩個）｜`DELETE /items/:id`（預設搬回存貨，`?hard=1` 真刪）｜`POST /items/:id/copy`（同 plan 重複 MAWB → 409）
  - `GET /stock`｜`GET /bookings?search=`（含 `placements`，MAWB 去空白比對）｜`POST /bookings`（**新增 Booking Record 並直接加入存貨**；登入即可，MAWB 正規化重複 → 409）｜`GET /placements?mawb=|mawb_record_id=`｜`GET /plans/:id/events?since=`
- **UI（Phase 2 完成）**：`public/js/loading-plan.js`（入口）＋ `public/js/loading-plan/{api,state,dom,render,interactions,dim,crd,contour}.js` ＋ `public/css/loading-plan.css`
  - NAV：`#nav-loading-plan` → `#section-loading-plan`（**不顯示鎖頭、不設角色**；由 `main.js` 的 `initProtectedSections` 初始化）
  - 雙欄：左＝存貨（即時過濾、多選；**兩行式列：完整 MAWB／客戶名，第二行 DEST／PKGS／G.W／VOL／CRD，不用省略號截斷**）、右＝PLAN 卡片（`Flight / Date / Owner` ＋ day／contour／owner TAG，展開＝明細表）；**所有操作按鈕集中在頂部公用工具列**（加入所選／移出到存貨／複製到…／配艙建議／Excel／列印／編輯 PLAN／Undo／重新整理／新 PLAN，另含 `VOL/CBM` ↔ `cu.ft/CBM` 切換）
  - 操作：拖曳（存貨→PLAN、PLAN→PLAN、PLAN→存貨，多選整批）、右鍵（剪下／複製／貼上／移出到存貨／刪除／編輯／查看位置）、雙擊格子就地編輯、`Ctrl+Z` Undo（最多 30 步）、`Delete` 移出
  - **checkbox 連續選取**：先 check 第 2 列 → 按住 `Shift` → 再 check 第 6 列＝第 2~6 列整段選取（取消勾選則整段取消）；同一張 PLAN 或同一份存貨清單內有效（`applyRangeSelection()`＋`rangeAnchor`）
  - **編輯 PLAN 的 Flight Date＝`<input type="date">`**（點一下即開系統日曆；舊資料 `2026/11/14` 會先正規化成 `2026-11-14`）
  - **拖曳插入位置**：拖到某一列的**上半／下半** → 插到該列前／後（藍色插入線）；同一張 PLAN 內拖曳＝排序（`public/js/loading-plan/order.js` 的 `lpMoveOrder()` 純函式）；跨 PLAN 先 Move 再 reorder；兩者都可 `Ctrl+Z` 復原
  - **`Ctrl+V` 貼上 Excel**：監聽掛在 `document`（不必先點輸入框），但只在「執 PLAN」區塊可見、沒有 modal、焦點不在輸入框時才攔截
  - 複製規則：`Copy` 走 `/items/:id/copy`（同 plan 有其他 plan 已有同一票 → 409，前端提示改用搬移）；Move 一律 `POST /plans/:id/items`
  - 表頭 G.W／VOL／CBM 與下方數值同為右對齊（`num` class）；**明細欄位順序＝MAWB → DEST → CLIENT**（MAWB 104px／DEST 42px 固定寬度，CLIENT 保留約 15 個英文字寬 116px → 三欄間距縮短）；**明細列／存貨列／找 Booking 清單 hover 會底色閃爍高亮**（`@keyframes lpRowHoverFlash`，1 秒循環、`rgba(37,99,235,.10)↔.26`；表頭列與合計列不算 record → 不閃）；`prefers-reduced-motion` 時改靜態藍底
  - **作用中（Active）PLAN 的藍框會脈動**（`.lp-plan.is-active` ＋ `@keyframes lpPlanActivePulse`，1.6 秒循環、外光暈 2px ↔ 4px）；拖曳中（`is-drop`）暫停避免蓋掉插入提示，列印時關閉
  - **明細最下方固定一列合計**（`.lp-row-total`，在最後一個 MAWB 之後）：MAWB 欄＝`TOTAL n MAWB`（`lpTotals().mawbs` **去重**、空白不算）、再依序 PKGS（Σ `pcs_total`，有未填加 ⚠）／Σ G.W／Σ VOL 或 cu.ft（跟隨檢視切換）／Σ CBM；沿用同一組 `lp-c-*` 欄位 class → 與上方明細逐欄對齊
  - **KPI 上限一律標 `max`**（例：`8,229 / max 9,000 kg`、`49.78 / max 65.00 m³`）；`cu.ft / CBM` 檢視時體積 KPI 改顯示 `cu.ft`（上限由 `max_cbm` 換算），避免「目前用量／上限」混淆
  - **TAG 欄標題＝REMARK（`lp-c-tag` class 不變，資料仍存 `tag`）＝自由文字**：雙擊用 textarea 就地編輯（Enter 換行、Ctrl+Enter 或失焦完成）；滑鼠移入格子 160ms 後**向下浮出完整內容**（`.lp-remark-pop`，fixed 定位、不被 PLAN 容器裁切），右側「📐 DIM」按鈕（右鍵選單也有「📐 輸入 DIM」入口）開啟 DIM 輸入器（`.lp-dim-editor`）：`L × W × H / PCS` 四格、**Tab 換下一格、最後一格 PCS 再 Tab 自動新增一列、Enter 完成**（Esc 取消）；完成後把 `L x W x H / PCS` **一行一組**附加到 REMARK，且 DIM 上方自動有一行 **`DIM(CM):`**（重複附加會接在同一區塊、不重複標題，也不會跨到其他備註；舊資料只有 DIM 行時會自動補標題）。格式／驗證在 `public/js/loading-plan/dim.js` 純函式；後端 `strMultiline()` 保留換行、`tag`／`remark` 上限 500 字
  - **CRD 欄＝Cargo Ready Date（2026-11-24 新增）**：明細表在 **CBM 與 REMARK 之間**多一欄 `CRD`（`.lp-c-crd`／`.lp-crd-input`；表頭與下方日期**一起靠右**、與 REMARK 之間**加大欄距**；資料存 `loading_plan_items.cargo_receipt`，DB 一律 ISO `YYYY-MM-DD`，畫面只顯示 **`DDMMM`**；按鍵／輸入解析抽在 `public/js/loading-plan/crd.js`：`lpCrdStep()`／`lpCrdParseInput()`）。游標進入格子會自動選取 **DD（前 2 碼）**，空白時先帶入今天（尚未變更就離開會還原，不會誤存）；`↑` = +1 日、`↓` = −1 日（例：30NOV ↑ → 01DEC、01DEC ↓ → 30NOV；跨月／跨年由 `lpShiftIsoDate()` 以 UTC 計算），`Enter` 存檔、`Esc` 還原；也可手動輸入 `DD`／`DDMMM`／`DD/MM`／`YYYY-MM-DD`（`lpCrdToIso()` 以 Flight Date 推最近年份）。**邏輯決策：CRD 不可遲於 Flight Date** → 前端立即 toast＋紅框（`.lp-crd-input.is-invalid`＋列 `data-hover-error`）且**不寫入**；後端 `PATCH /items/:id` 同步檢核（格式錯 → 422 `crd_invalid`、比 Flight Date 遲 → 422 `crd_after_flight`）。只有真的改過（`crdDirty`）才 PATCH；SSE 重新載入時若焦點在 CRD 輸入框會延後（不中斷打字）。**存貨列**也在 `VOL` 右邊以**圓角按鈕**顯示 `CRD 14NOV`（`render.js` 的 `stockRow()`：`button.lp-stock-crd`，pill 邊框／淡藍底；空白顯示 `CRD —`，唯讀）。
  - **體積顯示切換＝緊貼分段按鈕**（`.lp-view-toggle` ＋ 兩個相鄰 `.lp-view-btn`，內側直角、只有最外側小圓角，第二個按鈕用左邊框當分隔線；未選中 `.66rem`、選中 `.78rem`（字級放大）；`VOL / CBM` 藍、`cu.ft / CBM` 青綠，選中＝實心白字＋`aria-pressed="true"`）；有作用中的航班 PLAN → 只切該張，沒有 → 套用全部（含存貨）；先樂觀更新畫面＋toast，再 `PATCH /plans/:id`（失敗還原）
  - **封存（ARCHIVE）／RECALL（2026-11-24 新增）**：USER 認為無用的 PLAN → 卡片標題列右上「封存」文字按鈕（`.lp-btn.lp-archive-btn`，琥珀色系；右鍵選單也有「🗄 封存 PLAN（可 RECALL）」）；PLAN 欄表頭右側「🗄 封存 n」可切到封存清單（同一顆按鈕再按＝「← 回到 PLAN 列表」），封存卡片淡化＋虛線、**不展開明細也不接受拖入**，只顯示 KPI 與「🗄 已封存 2026/11/24 14:30（封存者）」＋綠色「♻ RECALL」按鈕。RECALL 後自動回到正常清單並設為作用中 PLAN。封存只標記 `loading_plans.archived_at`／`archived_by`，明細完整保留；封存中的 PLAN 不列入 PLAN 統計與重複 MAWB 檢核（`duplicateMawbMap()` 加 `WHERE p.archived_at IS NULL`）；「📍 查看所有位置」的 placements 會帶 `archived_at` → 該列標「（已封存）」且點擊只切到封存清單（不展開，需 RECALL）。前端：`state.archivedPlans`／`state.showArchived`＋`archivedFlightPlans()`／`archivedPlanById()`（`state.js`）、`render.js` 的 `planCard()`／`archivedStamp()`／`renderPlans()`、`interactions.js` 的 `archivePlan()`／`recallPlan()`（封存前 `confirm`）；CSS `.lp-plan.is-archived`／`.lp-recall-btn`／`.lp-archived-hint`／`.lp-archive-toggle`／`.lp-archived-place-tag`（列印隱藏切換鈕）。
  - **「🔍 找/新增Booking」modal 兩個分頁**：`找現有 Booking`（搜尋 `mawb_records`＋加入存貨／指定 PLAN，沿用 Move 語意）／`＋ 新增 Booking`（MAWB／HAWB／CLIENT／DEST／PKGS／G.W／CBM／**CRD**／**REMARK** → `POST /api/loading-plan/bookings` 建 `mawb_records` 後**直接加入存貨**）。**TAG 欄已移除（2026-11-24）：PLAN 表顯示的「REMARK」原本就是 `tag` 欄，所以 modal 只留一個 `REMARK（顯示在 PLAN 表）`**，建立時同時寫入 `tag`（PLAN 表／DIM 用）與 `remark`（Excel 匯出用），避免同一件事要填兩次。**CRD（選填）**：`#lp-bk-crd`，DDMMM（游標進入先帶入今天、`↑` +1 日／`↓` −1 日，沿用 `crd.js`），送出前一律轉 ISO（`YYYY-MM-DD`）；空白＝不填、格式錯 → `.lp-input.is-invalid`＋不送出。MAWB 正規化重複 → **409**，前端自動切回「找現有」並帶入該 MAWB 搜尋。`apiFetch` 的錯誤會帶 `error.status`（供 409 分支）。**REMARK 是多行 textarea（`#lp-bk-remark`），右側「📐 輸入 DIM」沿用 PLAN 的 DIM 輸入器**（`openDimPanel()` 共用；PLAN 走 `openDimEditor()` → PATCH `tag`，Booking 走 `openBookingDimEditor()` → 只寫回 textarea，按「建立並加入存貨」才送出；後端 `fieldsFromRow()` 的 `tag`／`remark` 用 `strMultiline()` 保留換行，`cargo_receipt` 會正規化成 ISO）。**MAWB# 走嚴格驗證**（後端直接重用 `routes/orders/utils.js` 的 `validateMawb()`）：11 位數字＋prefix 001-999＋檢查碼（suffix 前 7 位 mod 7），不合格 → **422**；通過後自動格式化成 `176-6525 7360` 再寫入 `mawb_records`／明細；`後補MAWB#` 視為合法（可多筆，且不列入 `duplicate_mawb` 判定）；前端在輸入框失焦／按建立時即時驗證（`.lp-input.is-invalid` 紅框＋`title` 錯誤訊息），格式正確會自動改寫成標準格式
  - Hover 規則：**正常列不出任何 tooltip**；只有該列有錯誤（缺 MAWB／重複 MAWB／件數未填，`data-hover-error`）才顯示錯誤訊息。**重複 MAWB 是全域判定**：跨 PLAN／同 PLAN 只要同一正規化 MAWB 出現 >1 次，所有相關列都會 `is-dup` 上色（紫字＋⧉）並在 hover 列出其他位置（例如「重複 MAWB（也在 EK9845 / — / SKY DRAGON）」）。要查「同一票的所有位置」也可用右鍵「📍 查看所有位置」：清單每一列（`.lp-find-row.lp-place-row`）可點擊／Enter → 自動切到該 PLAN、展開明細、捲到該列並 `is-flash` 閃爍 highlight 約 3 秒（`@keyframes lpRowJumpFlash`）；清單會把「右鍵開啟時所在的那一列」標成 **「📍 現在的位置」**（`.lp-place-row.is-current`：綠底＋左側綠線、`aria-current="true"`，最後一欄取代「前往」；hover 不會被藍底蓋掉）
  - Contour TAG：認得 → 綠 chip（點開用 `loadsimGetSpec` 帶尺寸／皮重／上限＋HACTL 圖）；`Q5` 未收錄 → 虛線 chip
  - 預覽：`npm run preview:loadingplan` → `data/work/loading-plan-preview.html`（假資料、免登入，可先看版面）
- **即時同步（Phase 3 完成）**：`public/js/loading-plan/realtime.js` ＋ `routes/loading-plan/bus.js`
  - SSE：`GET /api/loading-plan/events`（`requireAuth`、`X-Accel-Buffering: no`、25 秒心跳、`Last-Event-ID`／`since` 從 `loading_plan_events` 補送）
  - 寫入時 `logEvent()` 會同時寫 DB 與 `bus.publish()`；前端任何非 presence 事件 → debounce 350ms 重新載入（**打字中會延後**，不中斷輸入）
  - Presence：`POST /presence`（心跳 15 秒，TTL 40 秒）、`DELETE /presence/:connId`（`beforeunload` 用 `keepalive`）、`GET /presence`
  - 軟鎖：正在編輯的格子 → 別人看到 `.lp-row.is-locked`（淡黃底＋左側橙線＋`title`「XXX 正在編輯」）；**不硬鎖**
  - 連線狀態：`● 即時連線`（綠）／`● 重連中…`（紅）／`● 輪詢中`（橙）；SSE 失敗自動退回 5 秒 `/events.json` 輪詢，切回前景立即補一次
  - 線上人數：工具列 `#lp-online`（`👥 n`，hover 看名字）
- **測試（Phase 3）**：API 測試再加 SSE（Content-Type、`presence.snapshot`、即時 `item.patch`、`since` 補送、`/events.json`、presence CRUD、未登入 401）；前端測試加 10 項（樣式／啟動／心跳／補送／輪詢降級）
- **Excel 整合（Phase 4 完成）**：`public/js/loading-plan/paste.js`（TSV 純函式）＋ `GET /api/loading-plan/plans/:id/export.xlsx`（exceljs）
  - **貼上**：`Ctrl+V` 或右鍵「📥 貼上 Excel（TSV）」→ 先跳預覽 modal（可選目標 plan）→ `POST /plans/:id/items/bulk`
    - 有標題列（≥2 個認得的欄名）→ 自動對欄（支援 `MAWB NUMBER`／`SHIPPER`／`G.W`／`HAWB`／`備註`…與中文）
    - 無標題列 → 用 AGL執PLAN 固定順序（CLIENT, MAWB, HAWB, DEST, PKGS, G.W, VOL, CBM, CARGO RECEIPT, REMARK）
    - 千分位逗號、空白 VOL（不會變 0）、CRLF、空白列都會處理
  - **複製**：`Ctrl+C` 或右鍵「📤 複製到 Excel」→ TSV（含標題列）可直接貼回 Excel；cu.ft 模式輸出 cu.ft 欄
  - **匯出**：頂部工具列「⬇ Excel」→ 依原 `AGL執PLAN` 版面（表頭／欄位順序／TOTAL SUM 公式／凍結窗格）
  - **列印**：頂部工具列「🖨 列印」→ 自動展開全部 plan → `window.print()`（`@media print` 只印 PLAN 明細、隱藏勾選欄）
- **測試（Phase 4）**：`scripts/test-loading-plan-paste.js`（**29 項**：往返、Excel 直貼、標題別名、中文標題、邊界）；API 測試加匯出（Content-Type／PK 檔頭／未登入 401／404）；前端測試加 10 項
- **一鍵配艙建議（Phase 5 完成）**：`public/js/loading-plan/suggest.js`（純函式）＋ 頂部工具列「🧮 配艙建議」
  - 流程：輸入上限（G.W／CBM **可只填一個**）→ **TRY 試算**（純前端、不寫 DB）→ 勾選要的票 → 「套用勾選的 n 票」才真的 Move
  - **固定條件**：勾「保留現有明細」＝只補剩餘容量（不動既有明細）；取消勾選＝套用時先把現有明細移回存貨再放新建議
  - 模式：平衡（G.W+CBM）／重量優先／CBM 優先；「同 DEST 優先」（固定明細有 DEST 就沿用，否則每個 DEST 試一次取利用率最高）
  - 單票已超出剩餘容量 → 列 `skipped` 並說明原因；現有明細本身已超標 → 警告且不再建議加入
  - 同一輸入永遠同一結果（tie-break 用 `id`），方便現場對數
  - 測試：`scripts/test-loading-plan-suggest.js`（**33 項**：上限、固定條件、已超標、單票過大、無上限、空存貨、三種模式、同 DEST、穩定性／不變性、單維度）
- **DUMMY 資料**：`npm run seed:loadingplan`（`scripts/seed-loading-plan-demo.js`；`--reset` 可覆蓋）
  - 3 張 PLAN／20 票 MAWB：`EK9859 / 14NOV / SKY DRAGON`（7 票 7,803 kg＝86.7%）、`EK9845 / 15NOV / SPACE`（7 票 4,401 kg＝48.9%）、`CX840 / 16NOV / SKY DRAGON`（6 票 **8,542 kg 超重 542**，示範紅色警示）
  - 另加 7 票存貨（3,540 kg／21.79 m³）給「配艙建議」試玩；MAWB 檢查碼全部合法且不重複
  - 只動 `loading_plan_*`，缺的 `mawb_records` 會補建；已有 plan 時會拒絕（要覆蓋加 `--reset`）；會先清掉 UI 自動建立的「空存貨」
  - 測試：`scripts/test-loading-plan-demo-data.js`（9 項，防止 fixture 走鐘）
- **尚未完成（選配）**：版本快照 diff、欄位級 delta patch、平板版面微調、多板（多 ULD）配艙

## 資料表（db/database.js）

| 表 | 用途 |
|----|------|
| `skills` | 技能展示（自動 seed） |
| `companies` | 公司/地點（客戶、倉庫、運輸公司；`company_code` 供登入） |
| `users` | 帳號（company_id, user_id, password_hash, display_name, role, is_active, sidebar_nav_order） |
| `orders` | 訂單主表（含電郵總結所需欄位） |
| `note_templates` | 訂單備註文字範本 |
| `mawb_records` | Booking Record／MAWB# 主檔（後補查詢；「執 PLAN」與「ULD 夾重」共用） |
| `audit_log` | 操作稽核紀錄 |
| `templates` | 訂單範本（**已停用**：UI/API 已移除，僅保留供 dbviewer 與公司刪除保護） |
| `uld_weight_sheets` / `uld_weight_ulds` / `uld_weight_items` | ULD 夾重表／收貨單位（ULD 或散貨）／明細（每板 × 每 MAWB 的重量分攤） |
| `uld_weight_versions` | ULD 夾重表歷史版本（V3：`sheet_id, version_no, action, status, note, snapshot(JSON), summary(JSON), created_by, created_at`；每張表保留最近 30 版） |
| `loadsim_plans` | 模擬裝板雲端存檔（`name, uld_code, plate_type, item_count, board_count, total_kg, gross_kg, utilization_pct, saved_at, snapshot(JSON), created_by/updated_by`；模擬裝板本身免登入，這張表只給「存到雲端」用） |
| `loading_plans` | 執 PLAN 的 plan（`type` flight/stock、`day_code`、`flight_no`、`flight_date`、`owner_company`、`contour_code/qty`、`max_gross_weight`、`max_cbm`、`volume_view`、`version`、**`archived_at`／`archived_by`（封存；NULL＝正常）**） |
| `loading_plan_items` | 執 PLAN 明細（MAWB、`cartons`/`pallets`/`pcs_total`、`gross_weight`、`volume_weight`＋`volume_source`、`cbm`/`cuft`、DG 與 handling flags、`split_of_item_id`） |
| `loading_plan_events` | 執 PLAN 事件流（`plan_id, actor, action, payload(JSON)`；SSE 以 `id` 補送斷線期間的變更） |
| `loading_plan_presence` | 執 PLAN 線上狀態（`conn_id, plan_id, user_id, display, editing_item_id`；斷線即移除） |

> 共 **18 張表**（`db/database.js` 建表；14 張原有 ＋ 4 張 `loading_plan_*`，都有 `id … AUTOINCREMENT`）。
> REMARK：舊 `messages`（GuestBook/Forum）**已完全清除（2026-11-06）**：建表移除、本機 DB 已無此表，
> `routes/dbviewer.js` 的 `READONLY_COLUMNS`、`public/js/dbviewer.js` 的中文標籤（`messages` 與 3 個孤兒欄位
> `user_name`／`title`／`parent_id`）皆已刪除。僅 `public/css/components.css` 的 `.forum-*`／`.guestbook-form`
> 樣式仍留著（已無 HTML 引用，可日後清理）。

## 常見任務指引

- **改訂單功能**：後端改 `routes/orders/`，前端改 `public/js/orders.js` + `public/css/orders.css`
- **改執 PLAN**：計算／換算改 `public/js/loading-plan/calc.js`（前後端共用）；Excel 匯入改 `scripts/import-loading-plan-xlsx.js`；資料表 `loading_plan_*`
- **改模擬裝板**：前端改 `public/js/loadsim/*` + `public/css/loadsim.css`；板型尺寸/收角改 `loadsim/uld-specs.js`；存檔（本機／雲端／JSON）改 `loadsim/plans.js` + `loadsim/state.js`（快照）＋後端 `routes/loadsim.js`／`loadsim_plans` 表
- **改網站內容**：`public/index.html`
- **改頂部工作列／目錄抽屜**：`public/css/topbar.css` + `public/js/topbar.js`（只影響 `body.has-topbar` 的頁面；目錄的 DOM 仍由 `index.html` 的 `.sidebar` 決定，別把 `.nav-empty` 之類的非 `.nav-item` 放進 `<nav class="sidebar-nav">`）
- **改主題**：`public/css/base.css`（主題變數）+ `public/js/theme.js`
- **新增資料表**：`db/database.js` 加 `CREATE TABLE`，並在 `routes/` 建對應路由模組，`server.js` 掛載
- **新增文件**：先看 `docs/README.md` 的分類規則（根目錄只放現役導航文件；歷史規格放 `docs/archive/`、設計放 `docs/design/`）
- **前端無框架**：所有前端 JS 直接在 `public/js/` 用全域函式開發

## 注意事項

- 使用 sqlite3 套件的 callback 風格（非 async/await）
- 不要直接編輯 `database.db`
- 修改 `routes/orders/utils.js` 的 `ORDER_NO_PREFIX` 會影響訂單編號產生
