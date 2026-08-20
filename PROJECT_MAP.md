# AGL-Web-Portal — 專案地圖（詳細版）

> 用途：供 AI Agent 快速定位功能位置，避免探索整個專案。
> 配合 `CLAUDE.md` 使用：新任務先看 CLAUDE.md 摘要，需要細節再查本檔案。
> 修改專案時請同步更新本檔案。

---

## 1. 檔案總覽

### 根目錄

| 檔案 | 說明 |
|------|------|
| `server.js` | Express 入口：靜態服務、JSON body、掛載 8 組 API 路由；Port 被佔用自動 +1 |
| `bp3d/` | **3D ULD 裝箱引擎**（`geometries.js` 半空間幾何、`uld-definitions.js` ULD 規格庫、`constraints.js` 約束、`extreme-points.js` EP 演算法、`solver.js` 主求解器） |
| `package.json` | 名稱 gemini-intro-site；依賴僅 express ^4.18.2、sqlite3 ^5.1.6 |
| `database.db` | SQLite 資料庫（自動建立，勿手動編輯） |
| `ORDER_SYSTEM_PLAN.md` | 訂單系統設計紀錄：欄位規格、電力分類、訂單類型邏輯、電郵總結格式 |
| `README.md` | 專案說明、API 清單、常見問題 |
| `CLAUDE.md` | AI 專案記憶檔（新對話自動載入，含自動開機流程） |
| `PROJECT_MAP.md` | 本檔案：詳細專案地圖 |
| `WORKSPACE_STATE.md` | 工作狀態交接檔（最後 commit、待辦清單） |
| `FILE_INVENTORY.md` | 自動產生的檔案清單（執行 `npm run sync` 更新） |
| `.project-state.json` | 結構快照（sync 引擎比對用，勿手動編輯） |
| `.clineignore` | AI 忽略清單（node_modules、圖片、db 檔等） |
| `scripts/sync-project-state.js` | 同步引擎：掃描專案、偵測結構變更、更新 FILE_INVENTORY |

### 後端 `routes/`

| 檔案 | 說明 |
|------|------|
| `skills.js` | 技能 API（GET /api/skills） |
| `contours.js` | Contour 影像：匯出 `contoursRouter`（/api/contours）與 `contourImageRouter`（/api/contour-image） |
| `dbviewer.js` | 資料庫檢視器：`isAllowedTable` 白名單保護；含 `doDelete` 刪除邏輯 |
| `orders/index.js` | 訂單 Router 入口 + ORD- → AGL- 編號一次性遷移 |
| `orders/orders-router.js` | 訂單 CRUD |
| `orders/companies.js` | 公司/地點 CRUD，`normalizeCategory` |
| `orders/utils.js` | MAWB 工具、`generateOrderNo`、`serializeOrder`、`ORDER_SELECT_SQL` |
| `packing.js` | **3D ULD 裝箱 API**（POST /api/packing/pack-uld 求解、GET /ulds、GET /demo、GET /health） |

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
| `js/utils/api.js` | 通用 API 封裝（`apiFetch`） |
| `js/utils/datetime-utils.js` | 日期/時間工具 |
| `js/utils/mawb-utils.js` | MAWB# 驗證/格式化工具 |
| `js/utils/modal.js` | 通用 Modal（`openModal`） |
| `js/utils/cbm-calculator.js` | CBM 計算機（`openCbmCalculator`） |
| `js/utils/time-picker.js` | 自訂時間選擇器（`setupTimePicker`） |
| `js/utils/autocomplete.js` | 輸入即篩選自動補全（`setupAutocomplete`） |
| `packing.html` | **3D ULD 裝箱頁面**（ULD 選擇、貨物編輯、3D 視圖、逐步動畫控制） |
| `css/packing.css` | 3D 裝箱系統樣式（含深色主題） |
| `js/packing/packing-viewer.js` | Three.js 渲染器（ULD 線框、貨物 Box、逐步飛入動畫、點擊資訊） |
| `js/packing/packing-main.js` | 頁面邏輯（ULD 載入、貨物 CRUD、API 求解、結果顯示、動畫控制） |

---

## 2. 訂單系統詳解

### 資料模型

**companies 表**（公司/地點）
```
id, category ('customer'|'warehouse'|'transport' 等), name, address,
contact_person, phone, email, notes, created_at
```

**templates 表**（範本，按公司分類）
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

### 電郵總結（`mailto:` 免設定）
- 自動填收件人（運輸公司 email）、主旨、總結內容
- 支援 `複製總結內容` 用 WhatsApp 等發送
- 格式範例見 `ORDER_SYSTEM_PLAN.md` / `README.md`

---

## 3. 其他後端模組

### dbviewer.js（資料庫檢視器）
- `isAllowedTable(name)`：白名單檢查，防止存取非預期表格
- 支援欄位列出、編輯欄位、刪除（`doDelete`）

---

## 3.5 3D ULD 裝箱系統（bp3d）

### 引擎模組 `bp3d/`
| 檔案 | 說明 |
|------|------|
| `geometries.js` | 半空間幾何引擎：矩形/斜切（Extruded Profile）/輪廓 ULD 統一以平面不等式建模；`boxFits`（8 頂點驗證） |
| `uld-definitions.js` | ULD 規格庫：PMC/PAG/PAP/P1P/P6P 矩形、AKE/AKH/ALF/AMA 斜切、PMC-Q6/PMC-Q7/PAG-Q7 輪廓 |
| `constraints.js` | 約束：支撐率 ≥70%、堆疊承重、總重量、地面壓力、CoG ±10% |
| `extreme-points.js` | EP 演算法：旋轉方向控制、候選點產生、貼齊與支撐收斂 |
| `solver.js` | 主求解器：4 種排序策略（density/large/weight/footprint）、數量展開、回傳 sequence |

### API
| Method | Path | 說明 |
|--------|------|------|
| GET | `/api/packing/health` | 健康檢查（需登入） |
| GET | `/api/packing/ulds` | ULD 清單（含渲染資訊） |
| GET | `/api/packing/demo` | 內建示範求解（PMC 托盤） |
| POST | `/api/packing/pack-uld` | 主求解 API（ULD spec + 貨物清單 + 選項） |

### 測試
- `scripts/test-bp3d.js` — 引擎單元測試（16 項：幾何/斜切/方向/支撐/求解/重量）
- `scripts/test-packing-api.js [port]` — API 整合測試（登入 + ULD + 求解 + 錯誤處理，16 項）

### 空運特殊約束
- **斜切幾何**：AKE/LD3 以 Y-Z 剖面多邊形擠出 + 8 頂點平面不等式驗證
- **支撐率**：預設 70%（API options.min_support_ratio 可調）
- **CoG**：X/Y 偏移需在幾何中心 ±10% 內（options.cog_tolerance_ratio 可調）
- **Net Clearance**：預設 30mm（ULD 內部空間向內縮）
- **逐步動畫**：solver 回傳 `sequence[]`，前端 Three.js 依序播放

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