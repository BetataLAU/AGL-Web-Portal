# 收/送貨落 ORDER 系統 — 設計紀錄

> 最後更新：2026-01-08
> 狀態：設計已確認，待開發

## 一、需求摘要

- 建立「收貨/送貨」落 Order 系統
- 在網站左邊 Sidebar 新增「訂單系統」入口
- 介面簡約、易用、低學習成本、手機優先
- 公司/地點存於 SQLite DB，不用每次重新輸入
- 有 Template 範本，同地點訂單可一鍵複製
- 支援手機操作/翻查（響應式）
- 每筆訂單可生成總結，用 Email 發送給運輸公司

## 二、訂單欄位（最終確認版）

| 欄位 | 說明 | 必填 |
|------|------|-----|
| 訂單類型 | 🚚 送貨 / 📥 收貨（大按鈕選擇） | ✅ |
| MAWB# | Master Air Waybill（主提單號） | ✅ |
| HAWB# | House Air Waybill（分提單號） | ✅ |
| 客戶提貨號 | 客戶提供的提貨/取貨編號 | ✅ |
| 取貨/收貨地點 | 送貨=攞貨公司；收貨=客戶公司（DB 下拉） | ✅ |
| 送貨目的地 | 僅「送貨」顯示（DB 下拉） | ✅ |
| 交回/轉交地點 | 僅「收貨」顯示：收完貨轉交到邊度（DB 下拉） | ✅ |
| 收貨人/聯絡人 | 自動從公司帶出，可修改 | ✅ |
| 聯絡電話 | 自動從公司帶出，可修改 | ✅ |
| 地址 | 自動從公司帶出，可修改 | ✅ |
| 貨品描述 | 貨物內容 | ✅ |
| 件數 | 數量 | ✅ |
| 重量 (KG) | 總重量 | ✅ |
| CBM（方數） | 體積 | ✅ |
| ⚡ 電力分類 | 無電 / 乾電 / 鋰電（三選一，必填） | ✅ |
| 🚨 是否趕機 | 🔴 趕機 / ⚪ 普通 | ✅ |
| 備註 | 其他特殊指示 | 選填 |
| 運輸公司 | DB 下拉 | ✅ |
| 狀態 | 待處理/進行中/已完成/已取消（預設待處理） | ✅ |

## 三、電力分類設計（重要）

⚠️ 意思 = 貨物是否含電池/電力設備（航空貨運分類），無電都要註明。

| 選擇 | 顯示欄位 | 代碼 |
|------|---------|------|
| 無電 | 自動標示「⚡ 無電」 | - |
| 乾電 | 下拉選擇 | A67 / A123 / A199 |
| 鋰電 | 下拉選擇 | ELI / ELM |

- 三選一大按鈕，一目了然
- 無電也要強制標示，不可留空
- 代碼用下拉避免打錯字，但可自訂
- 訂單列表卡片 + 電郵總結都要顯示

## 四、訂單類型邏輯

```
🚚 送貨訂單：
   取貨地點（倉庫/公司）→ 送到 → 客戶公司

📥 收貨訂單：
   去客戶公司收貨 → 交回/轉交到 → 指定地點
```

## 五、資料庫設計（SQLite）

```
companies 表：
  id, name, address, contact_person, phone, email, notes, created_at

templates 表（範本）：
  id, name, company_id, cargo_desc, quantity, weight, cbm,
  power_type, receiver_name, receiver_phone, notes, created_at

orders 表：
  id, order_no, order_type (delivery/pickup),
  mawb, hawb, pickup_no,
  pickup_company_id, delivery_company_id,
  cargo_desc, quantity, weight_kg, cbm,
  power_type (no/dry/lithium), power_code (A67/A123/A199/ELI/ELM),
  urgent (yes/no),
  receiver_name, receiver_phone, address, notes,
  transport_company, status (pending/in_progress/completed/cancelled),
  created_at, updated_at
```

## 六、頁面設計

### Sidebar 新增
```
📦 訂單系統（新項目）
```

### 頁面分 3 個 Tab
```
[＋ 新建訂單] [📋 訂單列表] [⭐ 範本]
```

### Tab 1：新建訂單（分步驟大按鈕表單）
1. 訂單類型：🚚 送貨 / 📥 收貨
2. 提單資訊：MAWB# / HAWB# / 客戶提貨號
3. 收/送貨公司：DB 搜尋下拉（自動帶出地址/聯絡人/電話）
   - 送貨：揀取貨地點 + 送貨目的地
   - 收貨：揀收貨地點 + 交回/轉交地點
4. 貨物資料：貨品描述 / 件數 / 重量KG / CBM
5. 電力分類：無電 / 乾電(代碼) / 鋰電(代碼)
6. 是否趕機：🔴 趕機 / ⚪ 普通（大按鈕）
7. 收貨人 / 聯絡電話 / 地址（自動帶出可修改）
8. 運輸公司（DB 下拉）+ 備註
9. 提交 → 成功頁面 +「📧 電郵總結發送」按鈕

### Tab 2：訂單列表（手機翻查用）
- 卡片式列表，搜尋欄（訂單編號/公司名/日期）
- 每張卡顯示：
  - 訂單編號 + 日期
  - 🚚/📥 圖示 + 公司名稱
  - MAWB# / HAWB# / 提貨號
  - ⚡ 電力標籤 + 🚨 趕機標籤
  - 狀態顏色標籤（待處理=黃、進行中=藍、已完成=綠、已取消=灰）
- 點擊 → 展開詳情 + 編輯 + 「複製此訂單」+「📧 電郵總結」
- 電郵總結格式示範見下方

### Tab 3：範本管理
- 按公司分類顯示範本
- 新增/刪除範本
- 範本內容：貨品描述 + 件數 + 重量 + CBM + 收貨人 + 電話 + 備註（綁定公司）
- 新建訂單時可一鍵載入範本

## 七、電郵總結方案

- 使用 `mailto:` 連結（零設定，手機原生 Email App）
  - 收件人：運輸公司 email（自動填）
  - 主旨：訂單編號 + 類型 + 公司名
  - 內容：完整訂單總結
- 另提供「複製總結內容」按鈕（可用 WhatsApp 等其他方式發送）

### 電郵總結示範
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📦 訂單總結 ORD-20260108-001
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

## 八、API 設計

```
GET    /api/orders/companies          → 公司/地點清單（自動補全）
POST   /api/orders/companies          → 新增公司（落單時順手儲存）
GET    /api/orders/templates          → 範本清單（可按公司過濾）
POST   /api/orders/templates          → 新增範本
DELETE /api/orders/templates/:id      → 刪除範本
GET    /api/orders                    → 訂單列表（可搜尋）
POST   /api/orders                    → 建立訂單
GET    /api/orders/:id                → 訂單詳情
PUT    /api/orders/:id                → 更新訂單（狀態/修改）
DELETE /api/orders/:id                → 刪除訂單
```

## 九、檔案結構規劃

```
db/database.js          ← 新增 3 張表（companies, templates, orders）
routes/orders.js        ← 新增 API 路由
server.js               ← 掛載新路由
public/index.html       ← Sidebar 新增「📦 訂單系統」+ 新 Section
public/css/orders.css   ← 訂單系統樣式（簡約大按鈕、手機優先）
public/js/orders.js     ← 前端訂單系統邏輯
```

## 十、手機操作體驗

- 大按鈕（高度 ≥ 48px）
- 表單欄位少、分步驟
- 公司自動帶出資料，不用重複打字
- 訂單列表快速搜尋
- 響應式：手機 Sidebar 自動收窄至頂部

## 十一、待確認 / 開放問題

- [ ] 送貨訂單的「取貨地點」：是否固定自家倉庫？（如是可設預設值）
- [ ] 運輸公司清單：存入 DB 可日後新增/修改（已建議 ✅）
- [ ] 電郵方案：mailto: 已建議 ✅（不需 SMTP）
- [ ] 登入權限：暫定不需登入（內部使用）

## 十二、開發步驟

1. 更新 db/database.js 建立 3 張新資料表
2. 新增 routes/orders.js 實作全部 API
3. 更新 server.js 掛載新路由
4. 在 index.html 新增 Sidebar 項目 + 新 Section
5. 新增 public/css/orders.css
6. 新增 public/js/orders.js
7. 完整測試：新增公司 → 建範本 → 建訂單 → 搜尋 → 複製 → 電郵總結