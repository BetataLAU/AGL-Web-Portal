# AGL Web Portal

航空貨運作業入口網站（內部使用），以 **Node.js + Express + SQLite** 打造，前端為原生 JavaScript / HTML / CSS（無框架、無 build step）。

## 這個網站包含什麼

| 模組 | 入口 | 說明 |
|------|------|------|
| 🔐 登入 / 權限 | `login.html`、`users.html` | Session 登入（Company Code + User ID + Password）；角色 `admin` / `staff` / `customer`，Sidebar 依權限顯示鎖頭 |
| 📦 訂單系統 | Sidebar「訂單系統」 | 收貨/送貨落 ORDER、公司/地點資料庫、電力分類、趕機、電郵總結 |
| ✈️ Shipper Role Project | Sidebar「Shipper Role Project」 | 上傳 XLS 配對表 → 產生 Report + SLI/ELI PDF + ZIP |
| 🛰️ HKIA CDP | Sidebar「HKIA CDP」 | 香港機場貨運數據平台 API v1.27 測試平台（Local Mock / SIT、Full / Lite Flow、CTO 預檢、#409 簽章、Callback 監控、互動教學） |
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
- 紙張：預設輸出 **A4**（`PDF_PAPER=a4`）。Excel 的匯出紙張由印表機驅動決定，因此 A4 由 Node 端 `normalizePdfToA4()` 在合併後等比正規化（＝模板原設計的 A4 × 65%）；`PDF_PAPER=custom` 可還原舊的自訂紙張（322.8×456.9mm）
- PDF 瘦身：預設開啟字型優化（`PDF_FONT_OPT=on`，需 Python + `pymupdf`）——移除 PDF 用不到的 `name`/hinting 表與 glyf 指令，實測 **533 KB → 123 KB（-77%）**，150dpi 逐像素差異 0.000%；`off` 可停用
- 字元處理（疊字引擎，三層）：①**無損淨化**（移除零寬／BOM／控制字元）②**WinAnsi 放寬**（`–` `’` `“”` `€`… 共 27 個特殊字不再誤判為「不支援」）③**CJK 字型子集**（`@pdf-lib/fontkit` 按需內嵌中文／全形字元，只有該筆用到才 **+4~7 KB**）。`PDF_CJK=off` 可一鍵回滾成「含 CJK 的記錄退回 Excel」；`SLI_ELI_CJK_FONT` 可指定字型檔。**不做任何可見字元替換**（例：`：`→`:` 會改動報關文件內容與折行）。實測含 `：` 的記錄：**119 KB／74 ms**（Excel 退回版 131 KB／~4 s）

## 📁 專案目錄結構

```text
AGL-Web-Portal/
├── server.js                # Express 入口：靜態服務、session、掛載全部 API 路由
├── database.db              # SQLite 資料庫（自動建立；用 npm run db:export / db:import 同步）
├── db/
│   ├── database.js          # 建表 + 相容欄位補齊 + seed
│   └── db-dump.sql          # 資料庫匯出（版本控管用）
├── docs/                    # 設計 / 歷史 / 研究文件（分類規則見 docs/README.md）
├── routes/
│   ├── auth/                # 登入、使用者管理、權限 middleware
│   ├── orders/              # 訂單 CRUD、公司/地點、備註範本、工具
│   └── xls-booking*.js      # Shipper Role 單據工具
├── public/
│   ├── index.html           # 主站單頁 + Sidebar
│   ├── login.html           # 登入頁
│   ├── users.html           # 使用者管理（admin）
│   ├── css/                 # base / layout / components / animations / orders / dbviewer …
│   │   └── utils/           # modal / cbm-calculator / time-picker / autocomplete
│   └── js/                  # 主站邏輯 + utils/
├── scripts/                 # XLS 流程、DB 匯出/匯入、測試與維運腳本
└── data/templates/          # Shipper Role 模板（SLI/ELI 母版、年度 Report 工作檔）
```

## 🔐 登入與權限

- 登入方式：`Company Code` + `User ID` + `Password`（`express-session` + `bcryptjs`）

角色與權限：

| 角色 | 權限 |
|------|------|
| `admin` | 全部，含使用者管理（`users.html`）與資料庫 |
| `staff` | 內部員工：訂單、Shipper Role、ULD 夾重、HKIA CDP、資料庫 |
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
3. **標準化結果預覽**：即時顯示整理後的資料（日期/航班/MAWB/DEST/件數/重量/REMARK/**CNEE**）供核對；CNEE 欄會依「DEST + REMARK」自動由對照區比對，缺漏的顯示 🔴 並可直接點擊補值（不需重新上傳檔案）。**可修改內容**：雙擊 **MAWB#／DEST／航班號** 即可修改（Enter 儲存、Esc 取消），修改值以「原 MAWB」識別該列並帶入執行產生，DEST 改動會自動重新比對 CNEE；改回原值即取消修改。**欄寬可調整**：拖曳表頭右緣即可加寬/縮窄單一欄（其他欄不會被壓縮，必要時表格出現橫向捲軸），欄寬會記在瀏覽器（localStorage）；雙擊該邊界只恢復該欄，或按「重設全部欄寬」回到預設。
4. **執行產生**：一次完成下列全部動作
   - Report 寫入 `Shipper role service - Summary 2026` 的對應月份 sheet（月份 sheet 不存在時自動複製 `template` 產生並放到最左）；新批次插入第 4 行，組首列填 A/B/G，其餘列填 C-F，每批尾留 1 空行分隔
   - SLI 填表（MAWB#、航班公司碼、DEST、CNEE、日期）→ `{MAWB#} SLI.pdf`
   - ELI 填表（MAWB#、DEST、CNEE、CNEE 電話、日期）→ `{MAWB#} ELI.pdf`
   - 合併同名 SLI+ELI → `{MAWB#}.pdf`（SLI/ELI 單獨檔自動刪除）
   - 依「航班日期」分組打包（同一天的所有航班合併）；單一航班 → `{YYYYMMDD} - {航班號} SLI x {份數}.zip`，同日多個航班 → `{YYYYMMDD} - 多航班 SLI x {份數}.zip`；超過 30MB 自動拆 `(Part x of y)`

> **缺 CNEE 處理**：缺 CNEE 的 MAWB **一律不制作**（Report／SLI／ELI／ZIP 全部跳過，不會產生 CNEE 留空的檔案），並在執行結果列出「缺 CNEE 警告清單」；請回③點擊紅色 CNEE 格補值後重跑。
>
> **重覆 MAWB 處理**：同一批執行中若同一個 MAWB 出現 2 次以上（例如來源檔拆成主列＋「留倉」列），輸出檔名固定是 `{MAWB}.pdf`，**每張 MAWB 只保留 1 筆制作**（優先有 CNEE、其次航班日期／航班號／DEST／件數／重量較完整的那一列），避免後面的列覆蓋前面的檔案；執行結果仍會列出「重覆 MAWB 清單」（MAWB / 出現次數 / 來源檔案）供人手核對來源資料。

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
| A4 紙張 | 產出一律 A4（`PDF_PAPER=a4`，預設）：合併後以 pdf-lib 等比正規化（＝模板原設計 A4 × 65%）；`custom` 可還原舊的印表機自訂紙張。執行結果會顯示實測頁面尺寸 |
| PDF 瘦身 | 預設 `PDF_FONT_OPT=on`：移除 PDF 用不到的 `name`/hinting 表與 glyf 指令（純 Python + PyMuPDF，免 Ghostscript），實測 **533 KB → 123 KB（-77%）**、逐像素差異 0.000%，文字仍可搜尋 |
| 疊字背景 | `python scripts/build-sli-eli-blank.py` 產生 A4 空白背景（114 KB）、編輯器底圖與 `sli-eli-fieldmap.json`（10 欄位座標，實測校準殘差 0.00 pt） |
| PDF 產生方式 | ④ 執行產生最前面的選擇器：`Excel（舊版）`（預設）或 `疊字（新版）`；`XLS_PDF_ENGINE=overlay\|com` 可設預設值。真正無法疊字的記錄（`PDF_CJK=off`／環境無 CJK 字型／emoji 等缺字）自動退回 Excel（同批可混合），結果面板會列出退回的 MAWB 與字元 |
| 中文／全形字元 | 疊字引擎內嵌 CJK 字型子集（fontkit，按需）：含中文 CNEE 的記錄不再整筆退回 Excel；`PDF_CJK=off` 可回滾 |
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

## 📦 模擬裝板系統（`#section-loadsim`，模擬免登入；存檔分本機／雲端）

裝板前先在瀏覽器模擬「貨物放進哪個板型（Contour / ULD）」，確認裝得下、沒有超出輪廓、沒有超重。

- 板型：內建 26 個 HACTL contour code（Q7-00 / Q7-02 / Q7-04 / Q3-00 / Q9-01 / Q6-00 / A4-00 / A2-00 / H2-00 / H3-00 / H4-00 / W2-00 / W2-03 / ZA / ZB / ZC / **A1 / A3 / XJ / ZJ / ZQ / ZR / Z2 / Z3 / Z4 / Z5**），來源為站內 Contour 圖（`public/image/HACTL_contour_spec`）上的英吋標註；板型欄位可直接**輸入代碼搜尋**（動態篩選），也可「板型設定」即時改尺寸與重量上限
- 輸入長 / 寬 / 高 / 重量（kg）/ 件數 → 產生貨物 → 拖進板內（或點一下自動放置）
- 預設 **3D 立體視圖**：拖曳移動（自動疊在下方貨物上）、空白處或右鍵拖曳轉視角、滾輪縮放；可切「2D 剖面」精確核對 Contour 收角
- 每件貨物可 6 個方向 90° 旋轉（`R` 或雙擊）、不可重疊、不可懸空；hover 顯示當前方向的長闊高；長度 cm 以整數顯示、inch 1 位小數
- 超出輪廓以紅色半透明體積標示並顯示超出量（cm 整數）；總重（貨重＋板重）超過上限會即時警示
- 純前端：狀態存 `localStorage`，換頁 / 重新整理後仍保留
- **存檔（2026-11）**：工具列「💾 存檔」把排好的板存到**本機**（`localStorage`，可命名多份、上限 30 份、免登入）或**雲端**（`/api/loadsim`，admin / staff 登入後才能用，換電腦也載入得到）；「📂 我的存檔」可載入 / 改名 / 刪除，也能「⬇ 匯出目前這塊板 / ⬆ 匯入 JSON」帶檔備份或傳給同事。載入後按 `Ctrl+Z` 可回到載入前的樣子
- 檔案：`public/js/loadsim.js` + `public/js/loadsim/*`（存檔邏輯在 `loadsim/plans.js`）、`public/css/loadsim.css`；雲端存檔後端：`routes/loadsim.js`（`loadsim_plans` 表）

## ⚖️ ULD 夾重系統（`/api/uld-weight`，admin/staff）

貨站（HACTL / AAT / CPSL）出 RCL 後，把「RCL 磅重 − 倉庫申報」的差額回填到指定 MAWB，算出每票最終重量。

- 目標淨重 `R = RCL Gross − Tare`（散貨 B 的 Tare = 0）；磅差 `D = R − Σ 申報重量`
- 夾重票**可多票**（重量比例／件數比例／平均／手動 %），未勾選的票重量不變
- 取整：**P / X（交板）一律正整數**、**B（交散貨）可選 0.5 / 1.0**；尾差預設由申報重量最大的夾重票吸收
- 不檢核 Port（可混裝）；Pre-decl Type 完全手動（1 板 1 MAWB 也可能是 X）
- 磅差警示門檻表頭可調（`diff_warn_pct`／`diff_warn_kg`，預設 2% / 100kg；% 與 kg 需同時超過）；LIH 檢核細分為「單位缺標／只有單位標／UN 號不一致」
- 夾重表 CRUD、複製、鎖定；匯出 Excel（3 個工作表）、複製文字摘要、**A4 列印／另存 PDF**（草稿／鎖定都能印）
- **server 端正式 PDF**（⤓ PDF，A4 直式固定排版）；清單可勾選多張 → **批次下載 ZIP**（每張 `<sheet_no>.pdf` ＋ `manifest.txt`，上限 50 張）
- **歷史版本**（🕘 版本）：每次建立／儲存／鎖定／解鎖／套用／補建 Booking 都留一份快照（每表保留 30 版），可比較兩版差異
- 鎖定後可把結果套用到 Booking Record（`mawb_records.gross_weight`，不動訂單）；
  也可以反向「**⇧ 補建 Booking**」：把夾重表上還沒連結 Booking 的票補進 Booking Record（預設先預覽、確認後才寫；同號 MAWB 只連結不重建）；RCL 磅單（Excel／CSV）可整批匯入收貨單位
- 前端：`#section-uld-weight`、`public/js/uld-weight.js`、`public/js/uldweight/*`、`public/css/uld-weight.css`；設計文件 `docs/design/uld-weight-system.md`

```bash
GET    /api/uld-weight/sheets?status=&search=   # 夾重表清單
POST   /api/uld-weight/sheets                   # 新增（WGT-YYYYMMDD-XX）
GET    /api/uld-weight/sheets/:id               # 明細 + 即時重算 + 檢核
PUT    /api/uld-weight/sheets/:id               # 整份儲存（error → 422、鎖定 → 409）
DELETE /api/uld-weight/sheets/:id               # 刪除
POST   /api/uld-weight/sheets/:id/duplicate     # 複製
POST   /api/uld-weight/sheets/:id/lock|unlock   # 鎖定／解鎖
GET    /api/uld-weight/sheets/:id/report.pdf    # 單張 A4 PDF
GET    /api/uld-weight/sheets/batch-pdf?ids=…   # 多張打包 ZIP（+ manifest.txt，上限 50 張）
POST   /api/uld-weight/sheets/:id/sync-bookings # 補建 Booking（預設 dry_run 只回預覽）
GET    /api/uld-weight/sheets/:id/versions       # 歷史版本清單
GET    /api/uld-weight/sheets/:id/versions/diff  # 版本差異（from 必填；to 省略＝對目前）
```

## 🛰️ HKIA CDP 測試平台（`/api/hkia-cdp`，admin / staff）

香港國際機場 **Cargo Data Platform — RA / RACSF / TP Integration Service API v1.27** 的測試工作台
（Sidebar「HKIA CDP」）。因為瀏覽器不能做 mTLS、也收不到 server-to-server Webhook，本平台以 **BFF** 代為處理。

- **環境**：`Local Mock`（免憑證，202 + 延遲 Callback）／`SIT`／`Production`（切換與每次送出都要二次確認）。
- **流程**：Full Flow `#405 Create Export Order → #409 Screening Image → #401 Pre-Declaration`；
  Lite Flow `#415 Lite Pre-Declaration`／`#416 Delete MAWB`。表單模式與 JSON 模式共用同一份 payload。
- **CTO 預檢**：AAT／CPSL／HACTL 差異規則（小數位、ASI 長度與全大寫、車牌、Seal 格式、鋰電池 PI、LH/CX 條件…），
  前端即時提示、後端 `/proxy` 也會回同一份 `lint`。
- **#409 簽章**：後端用設定的 `.key` 做 `SHA-256 + RSA-SHA256` 自動填入 `imageHash` / `imageSignature`（亦可單獨 `POST /sign`）。
- **Callback**：`POST /api/hkia-cdp/webhook`（公開，可選 Basic Auth）比對 `source_id`（＝`x-request-id`），
  以 SSE 即時推到「Callback 監控」頁並高亮 `cto_errors`。
- **憑證**：設定頁可填路徑或上傳 `.pem` / `.key`，存 `data/hkia-cdp/certs/`（`data/hkia-cdp/` 已列入 `.gitignore`）；
  `clientSecret` / `apiKey` / `webhookPass` 回傳時一律遮罩。
- **歷史**：`data/hkia-cdp/history.json`（上限 300 筆；不存大檔 base64 本體）。
- **SIT（Air Global）已預填**：`data/hkia-cdp/config.json`（gitignored）已設 `env=sit`、`role=RA` 與 Client ID；
  憑證 `data/hkia-cdp/certs/air_global_sit_2026.pem` 已放置（AAHK 簽發，有效至 2027-11-17），
  **私鑰 `air_global_sit_2026.key` 仍需補上**（申請 CSR 時產生的那一把）。設定頁會顯示 mTLS 狀態與憑證資訊，
  上傳時會檢查「CSR／憑證／私鑰」不可混用；若是「憑證＋私鑰」合併的 `.pem` 也可直接使用。

```text
GET/PUT /api/hkia-cdp/config              # 設定（遮罩 secret）
POST    /api/hkia-cdp/certs               # 上傳 .pem / .key
POST    /api/hkia-cdp/auth/test           # #001 Token（Mock / mTLS）
POST    /api/hkia-cdp/lint                # CTO 預檢
POST    /api/hkia-cdp/sign                # #409 簽章
POST    /api/hkia-cdp/proxy               # #401–#416（Mock / SIT / Prod）
GET     /api/hkia-cdp/refs | /history | /pending | /health
GET     /api/hkia-cdp/events              # SSE（Callback / 歷史）
POST    /api/hkia-cdp/webhook             # 公開：HKIA → 本平台 Callback
```

- 詳細實作與限制：`docs/design/hkia-cdp-testing-site.md`；PRD：`hkia_cdp_testing_site_prd.md`
- 測試：`npm run test:hkia-cdp`、`npm run test:hkia-cdp-api`、`npm run test:hkia-cdp-ui`（需 Chrome/Edge，找不到會 SKIP）

## 🗄️ 資料庫檢視器（`/api/db`）

- 以白名單（`isAllowedTable`）限制可存取的資料表，避免誤改系統表
- 支援列出資料表 / 欄位、單筆與批次編輯、單筆與批次刪除、外鍵下拉與刪除關聯保護
- 需 `db_view` 權限（admin / staff）；前端為 `public/index.html` 的「資料庫」區塊 + `public/js/dbviewer.js`

## 🔧 主要技術

- Node.js + Express 4 + SQLite3（callback 風格，非 async/await）
- express-session + bcryptjs（登入與角色）
- exceljs / xlsx（Excel 讀寫）、pdf-lib（PDF 合併後備）、archiver（ZIP）
- multer（上傳）
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
| `/api/uld-weight` | ULD 夾重系統：sheets CRUD / duplicate / lock | admin / staff |
| `/api/xls-booking` | Shipper Role：upload / preview / cnee-preview / process / status / cancel / download / cleanup | 登入 |
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
| 模擬裝板系統 | `public/js/loadsim/*`、`public/css/loadsim.css`（純前端；板型規格在 `js/loadsim/uld-specs.js`） |
| Shipper Role 後端 | `routes/xls-booking.js`、`routes/xls-booking-helpers.js`、`scripts/xls-*.js` |
| Shipper Role 前端 | `public/js/xls-booking-*.js`、`public/css/xls-booking.css` |
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



