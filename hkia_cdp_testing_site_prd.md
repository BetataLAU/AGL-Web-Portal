# Product Requirements Document (PRD): HKIA Cargo Data Platform (CDP) API Testing Site & Interactive Learning Portal

> **文件用途**：本 PRD 專為 **VS Code + Cline (DeepSeek)** 開發工作流程設計，旨在建立一個**方便易用、視覺化、支援 Mock 與 SIT 真實環境切換**的 **HKIA CDP (RA / RACSF / TP) API 測試平台**，並內建**互動式 API 開發教學模組**，協助開發者與業務人員由零開始理解、操作及對接 HKIA CDP Integration Service API (v1.27)。 **規格基準**：`HKIA - Cargo Data Platform – RA, RACSF, TP Integration Service API Specification v1.27` (27-Aug-2026)

## 1. 項目背景與核心目標

### 1.1 項目背景

香港國際機場貨運數據平台（HKIA Cargo Data Platform, CDP）透過 **RA Integration Service (RAIS)** 提供標準化 RESTful API，讓受管制空運代理（RA）、受管制空運貨物安檢設施（RACSF / RF）及技術合作夥伴（TP）將貨運出口訂單（Export Order）、預報關單（Pre-declaration）、安檢影像（Screening Image）及貨站狀態（Truck Arrival / RCL / Flight Departure）與三大貨站營運商（CTO：**AAT**、**CPSL**、**HACTL**）進行對接。

然而，HKIA CDP API 涉及 **mTLS 雙向憑證（TLS 1.2）**、**OAuth2 短效 Token（5 分鐘）**、**非同步回調（Async Callback）**、**三大 CTO 欄位差異驗證**，以及 **Full Flow 與 Lite Flow 雙流程**，直接使用 Postman 或手寫腳本測試門檻高且容易出錯。

### 1.2 核心目標

1. **方便易用的 Testing Site（測試平台）**：

   * 提供表單式與 JSON 雙模式介面，無需手寫複雜 JSON 即可完成測試。

   * 內建 **Local Mock Mode（本地模擬模式）** 與 **HKIA SIT Mode（官方測試環境）** 一鍵切換，未取得 AAHK 正式憑證前亦可完整測試流程與 Webhook Callback。

   * 自動處理 **mTLS 憑證載入**、**#001 Token 自動續期**、**x-request-id UUID 生成**、**#409 圖片 SHA-256 + RSA 數位簽章**，以及 **CTO 欄位即時預檢（Linter）**。

2. **全程教學導向（Interactive Learning Portal）**：

   * 平台內建教學專區，結合實際 API 呼叫與視覺化圖解，讓使用者在開發與測試過程中同步學會 REST API、mTLS、OAuth2、非同步 Webhook 及除錯技巧。

## 2. 系統架構與技術棧建議（給 Cline / DeepSeek 的實作藍圖）

由於瀏覽器端無法直接進行 **mTLS（雙向 SSL 客戶端憑證 `.pem` + `.key`）** 握手，亦無法直接接收來自 HKIA 的 **Server-to-Server Webhook Callback**，本系統必須採用 **前後端分離 / BFF（Backend-for-Frontend）架構**：

### 2.1 推薦技術棧

* **前端（Frontend）**：React + TypeScript + Vite + Tailwind CSS + Lucide Icons（或 Next.js App Router）

* **後端 / BFF Proxy（Backend）**：Node.js (Express / Fastify + TypeScript) **或** Python (FastAPI)

  * *註：建議使用 **Node.js (Express + TypeScript)** 或 **Python (FastAPI)**，兩者皆可原生支援 `https.Agent` / `httpx` 載入 `.pem` 憑證與 `.key` 私鑰，並使用內建 `crypto` / `cryptography` 模組計算 `#409` 的 `SHA-256 + RSA` 簽章。*

* **資料儲存（Local Persistence）**：SQLite（如 `better-sqlite3` 或 `sqlite3`）或本地 JSON 檔案，用於儲存：

  * API 呼叫歷史紀錄（Request / Response / Latency / Status）

  * 非同步 Callback 接收紀錄

  * 已建立的 Export Order 與 Pre-declaration 參考編號（`ra_reference_id` / `waybillNumber` / `ctoReferenceNum`）

* **即時推播（Real-time Updates）**：Server-Sent Events (SSE) 或 WebSocket，將後端 Webhook 接收到的 Callback 即時推送至前端 UI 顯示。

### 2.2 建議專案目錄結構

```
hkia-cdp-testing-site/
├── backend/
│   ├── src/
│   │   ├── config/          # 環境變數、SIT/Prod Base URL、CTO 驗證規則表
│   │   ├── services/
│   │   │   ├── mtlsClient.ts    # 載入 .pem/.key 與 TLS 1.2 HTTPS Client
│   │   │   ├── authService.ts   # #001 OAuth2 Token 取得與 4.5 分鐘自動快取續期
│   │   │   ├── signature.ts     # #409 圖片 SHA-256 + RSA 私鑰簽章工具
│   │   │   ├── rateLimiter.ts   # 15 req/sec 限流保護
│   │   │   └── mockServer.ts    # 本地 Mock Server（模擬 202 + 延遲 Callback + 410/411/412）
│   │   ├── routes/
│   │   │   ├── proxy.ts         # 轉發 #401-#416 至 HKIA SIT/Prod 或 Mock Server
│   │   │   └── webhook.ts       # 接收 HKIA Async Callback (支援 Basic Auth 驗證)
│   │   └── db/                  # SQLite 歷史紀錄與狀態追蹤
│   └── certs/                   # 存放測試用 .pem 與 .key（須加入 .gitignore）
├── frontend/
│   ├── src/
│   │   ├── pages/
│   │   │   ├── Dashboard.tsx        # 總覽與快速連線狀態 (Token / mTLS / Webhook)
│   │   │   ├── Settings.tsx         # 憑證、API Key、Client ID/Secret、Mock/SIT 切換
│   │   │   ├── FullFlowWizard.tsx   # Full Flow 引導式測試 (#405 -> #409 -> #401)
│   │   │   ├── LiteFlowWizard.tsx   # Lite Flow 引導式測試 (#415 -> #416)
│   │   │   ├── QueryTracker.tsx     # #402 / #406 / #410 / #411(PDF預覽) / #412
│   │   │   ├── CallbackMonitor.tsx  # 即時 Webhook Callback 監控台
│   │   │   └── LearningHub.tsx      # 互動式 API 教學網頁模組
│   │   └── utils/
│   │       └── ctoValidator.ts      # AAT / CPSL / HACTL 前端欄位預檢引擎
└── .env.example

```

## 3. HKIA CDP API 核心規範與認證設計

### 3.1 環境與端點設定（Section 3.2）

| 環境 | Base URL | 備註 | 
| ----- | ----- | ----- | 
| **SIT (Testing)** | `https://api-external.sit.hkiacargo.com` | 連接 HKIA Cargo Mock Server（模擬 CTO 環境），Port 443 | 
| **UAT** | `https://api-external.uat.hkiacargo.com` | **不適用於 RAIS API**（UI 應標示不可用） | 
| **Production** | `https://api-external.hkiacargo.com` | 正式環境（UI 切換至 Prod 時須彈出二次確認警告） | 
| **Local Mock** | `http://localhost:<PORT>/mock` | 本專案內建模擬器，無需憑證與白名單 IP 即可開發測試 | 

### 3.2 認證與安全機制（Section 3.1, 4.1）

1. **mTLS 雙向 SSL（TLS 1.2）**：

   * 所有連往 HKIA 的請求必須使用 TLS 1.2，並附加客戶端 SSL 憑證（`.pem`）及私鑰（PKCS#8 RSA 2048-bit `.key`）。

   * *v1.27 重要變更*：已移除 AES 加密與 Trucker HKID 欄位要求，無需實作 AES 加解密。

2. **共同 Request Headers**：

   * `x-api-key`: AAHK 提供的 API Key（所有 API 必帶）

   * `Authorization`: `bearer {access_token}`（除 `#001` 外所有 API 必帶）

   * `x-request-id`: UUID v4（非同步 API `#401`, `#403`, `#404`, `#415` 必帶，Callback 會以 `source_id` 原樣回傳）

3. **Authentication API (`#001`)**：

   * 依角色呼叫不同 URI：

     * RA: `POST /profile/public/external/v1/ra/auth/token`

     * RF: `POST /profile/public/external/v1/rf/auth/token`

     * TP: `POST /profile/public/external/v1/tp/auth/token`

   * `Content-Type: application/x-www-form-urlencoded`

   * Body: `grant_type=client_credentials&client_id=...&client_secret=...`（RF/TP 代理 RA 時加帶 `ra_code`）

   * Token 有效期約 **300 秒（5 分鐘）**，後端須實作自動快取與過期前自動續期機制。

4. **限流與逾時（Section 3.4）**：

   * Rate Limit：**15 requests/second per RA**（超過回傳 `429`）。後端應內建簡單排隊或提示機制。

   * Timeout：**30 seconds**（超過回傳 `504 Gateway Timeout`）。

## 4. 全 API 覆蓋清單（Section 2 & 4）

Testing Site 必須完整支援以下 **13 支 API**（含 Sync 與 Async 處理）：

| API # | 名稱 | Method | Endpoint Path | 模式 | 成功狀態碼 | 
| ----- | ----- | ----- | ----- | ----- | ----- | 
| **#001** | Authentication | `POST` | `/profile/public/external/v1/{ra|rf|tp}/auth/token` | Sync | `200` | 
| **#401** | Create Pre-Declaration | `POST` | `/export/external/v1/ra/pre-declarations` | Async | `202` | 
| **#402** | Retrieve Pre-Declaration | `GET` | `/export/external/v1/ra/pre-declarations/{ra_reference_id}` 或 `?cto_predeclaration_num={num}` | Sync | `200` | 
| **#403** | Update Pre-Declaration | `PUT` | `/export/external/v1/ra/pre-declarations/{ra_reference_id}` | Async | `202` | 
| **#404** | Delete Pre-Declaration | `DELETE` | `/export/external/v1/ra/pre-declarations/{ra_reference_id}` | Async | `202` | 
| **#405** | Create Export Order | `POST` | `/export/external/v1/ra/export-orders` | Sync | `200` | 
| **#406** | Retrieve Export Order | `GET` | `/export/external/v1/ra/export-orders/{export_order_reference_num}` | Sync | `200` | 
| **#407** | Update Export Order | `PUT` | `/export/external/v1/ra/export-orders/{export_order_reference_num}` | Sync | `200` | 
| **#408** | Delete Export Order | `DELETE` | `/export/external/v1/ra/export-orders/{export_order_reference_num}` | Sync | `200` | 
| **#409** | Upload Screening Image | `POST` | `/export/external/v1/{ra|rf}/export-orders/{export_order_reference_num}/screening-images` | Sync | `200` | 
| **#410** | Retrieve Truck Arrival | `GET` | `/export/external/v1/ra/pre-declarations/{ra_reference_id}/truck-arrival` 或 `/export/external/v1/ra/truck-arrival?cto_predeclaration_num={num}` | Sync | `200` | 
| **#411** | Retrieve RCL | `GET` | `/export/external/v1/ra/pre-declarations/{ra_reference_id}/rcl` 或 `/export/external/v1/ra/rcl?cto_predeclaration_num={num}` | Sync | `200` | 
| **#412** | Retrieve Flight Departure | `GET` | `/export/external/v1/ra/pre-declarations/{ra_reference_id}/flight-departure` 或 `/export/external/v1/ra/flight-departure?cto_predeclaration_num={num}` / `?waybill_num={num}` | Sync | `200` | 
| **#415** | Create Lite Pre-Declaration | `POST` | `/export/external/v1/ra/lite-pre-declarations` | Async | `202` | 
| **#416** | Delete MAWB | `DELETE` | `/export/external/v1/ra/mawb/{mawb_num}` | Sync | `200` | 

## 5. 詳細功能需求（Functional Requirements）

### 5.1 F1：環境設定與連線診斷中心

* **環境切換**：支援 `Local Mock`、`SIT`、`Production` 三種模式。

* **憑證與金鑰管理**：

  * 輸入 `Role`（`RA` / `RF` / `TP`）、`Client ID`、`Client Secret`、`API Key (x-api-key)`、`RA Code`（RF/TP 必填）、`RACSF Code`。

  * 支援上傳或指定本地路徑載入 `SSL Certificate (.pem)` 與 `Private Key (.key)`。

  * **OpenSSL 憑證產生小幫手**：介面直接提供一鍵複製的 OpenSSL 指令（PKCS#8 RSA 2048-bit + CSR），方便使用者申請憑證。

* **一鍵測試連線**：點擊「測試認證 (#001)」即時顯示 mTLS 握手狀態、JWT `access_token` 預覽及倒數計時器（300 秒）。

### 5.2 F2：方便易用的引導式測試工作台（Full Flow & Lite Flow）

為了讓操作「方便易用」，UI 不應只給一個空白 JSON 編輯器，而必須提供 **「表單模式 + 即時 JSON 同步預覽」**：

1. **一鍵範本填充（Preset Scenarios）**：

   * 內建官方 Spec 的測試情境範本：`Bulk -> AAT`、`Bulk -> CPSL`、`Bulk -> HACTL`、`Prepack (多 ULD)`、`Mix-prepack (多 MAWB + ULD)`。

   * 一鍵自動產生唯一 `documentId`（UUID v4）、`x-request-id`（UUID v4）及未來時間戳記（RFC 3339 `+08:00`）。

2. **動態表單與 CTO 差異預檢引擎（CTO Variance Linter）**：
   在送出請求前，前端與後端即時依據選擇的 **CTO (`AAT`/`CPSL`/`HACTL`)** 與 **Cargo Type (`BUK`/`PPK`/`MIX`)** 進行規則檢查與提示：

   * **HACTL 規則**：

     * 體積（Volume）最多 2 位小數，重量（Weight）最多 1 位小數（否則觸發 `108785` / `108717`）。

     * `additionalSecurityInformation` 限 60 字元且**必須全大寫英文**（否則 `122090`）。

     * `vehicleRegistration` 必填且限 8 字元；`seal` 限 15 字元；`raCode` 與 `rfCode` 必填。

     * `PPK` 模式且 `screeningMethod = RACSF` 時僅限 1 個 ULD；特定 `contour` 必須填寫 `subcontour`。

   * **CPSL 規則**：

     * 當含鋰電池 SPL（`ELI`, `ELM` 等）且 `piCode` 為 `PI966(II)`, `PI967(II)`, `PI969(II)`, `PI970(II)` 時，`pieceCount` 與 `weight.value` 必填；若為 `PPK`/`MIX` 還須填 `piCodeBooking`。

     * 若 `airlineCode = LH`（漢莎）且為 `PPK`/`MIX`，必須填寫 `buUserName` 與勾選 `discNoticeYn = true`。

     * 若 `airlineCode = CX`（國泰）且為 `BUK`/`PPK`，`raCode` 必填；`rfCode` 必填。

     * `additionalSecurityInformation` 限 30 字元；`seal` 限 30 字元；`vehicleRegistration` 限 12 字元。

   * **AAT 規則**：

     * `securityStatus.statusCode`（`SPX`/`SCO`/`UNK`）必填；`vehicleRegistration` 必填。

     * `#415` Lite Flow 若 `screeningMethod` 為 `CTO` 或 `INTEGRATOR`，`natureOfGoods` 必填（僅限 `0-9, A-Z, -, ., 空格`）。

     * `receipt` 電郵最多 3 個；`additionalSecurityInformation` 限 256 字元。

   * **Seal Number 格式檢查（Section 4.21）**：

     * `BOX_TRUCK_V2`、`ULD_METAL_DOOR_V2`、`SMARTSECNET_LD3` 支援逗號分隔多個 Seal。

     * `SECURENET_V2`（`CX` + 7位英數 + `-` + 2位數字）、`SMARTSECNET_V2`（`HK`...）、`EASYPACK_V2`（`EP`...）、`AERO_NET`（`AN`...）、`ADVANCE_PACK_SECURITY_SYSTEM`（`AP`...）自動提示格式規範。

3. **#409 安檢圖片上傳與自動簽章**：

   * 支援拖放上傳圖片（限制 <= 4MB，單一 Export Order 最多 20 張）。

   * 後端自動將圖片轉為 Base64，並使用設定的 **RF Private Key (`.key`)** 執行 `SHA-256` 雜湊與 RSA 簽章，自動填入 `imageSignature`，免除額外執行 C# 程式的麻煩。

### 5.3 F3：狀態查詢、RCL PDF 預覽與單號關聯追蹤

* **自動關聯**：成功送出 `#405` 或 `#401`/`#415` 後，自動將 `export_order_reference_num`、`ra_reference_id` 及 Callback 收到的 `cto_predeclaration_num` 存入本地紀錄，在查詢頁面（`#402`, `#406`, `#410`, `#411`, `#412`）提供下拉選單一鍵帶入。

* **RCL PDF 檢視器（#411）**：當 `#411` 回傳 `encodedPdf`（Base64）時，前端自動解碼並提供內嵌 PDF 預覽與一鍵下載按鈕。

### 5.4 F4：異步 Webhook Callback 接收器與模擬器

* 後端提供 `POST /api/webhook/hkia-callback` 端點（支援可選的 HTTP Basic Authentication 驗證，符合 Section 3.5）。

* 前端「Callback 監控台」透過 SSE 即時顯示收到的回調 JSON，並自動比對 `source_id`（即請求時的 `x-request-id`），將對應預報關單狀態更新為 `ACCEPTED_FROM_CTO` 或 `REJECTED_FROM_CTO`（並高亮顯示 `cto_errors`）。

* **Mock 模式模擬**：在 Local Mock 模式下，呼叫 `#401` / `#403` / `#404` / `#415` 會先立即回傳 `202 Accepted`，並在 2–3 秒後由後端 Mock Server 自動觸發真實格式的 Callback POST 到本地 Webhook，讓使用者完整體驗非同步流程。

### 5.5 F5：開發者除錯與匯出工具

* **Code Snippet 匯出**：任何表單組裝的請求，皆可一鍵複製為 **cURL**、**JavaScript (fetch/axios)** 或 **Python (requests)** 程式碼（含憑證掛載範例）。

* **錯誤碼智能解析（Section 3.6 & 4.23）**：當收到 `400`/`422`/CTO 錯誤（如 `CDP_001`–`CDP_095`、`GLS_001`–`GLS_050`、HACTL `108004`–`122319`）時，UI 自動比對內建錯誤字典並顯示中文原因與修正建議。

## 6. 互動式教學網頁模組需求（Learning Hub）

為實現「在整個開發過程中都能透過教學網頁了解、懂、操作與製作 API」，系統須包含一個 `/learn` 互動式教學頁面，涵蓋：

1. **API 基礎與 HKIA 架構圖解**：用白話與互動圖表解釋 Client / BFF Proxy / API Gateway / CTO Mock Server 的角色。

2. **安全認證互動教室**：拆解 mTLS（為何瀏覽器不能直接連）、OAuth2 `client_credentials` 與 `x-api-key` 的運作順序。

3. **Full Flow vs Lite Flow 業務對照**：互動式流程圖，點擊每個節點即可看該步驟對應的 API、必填欄位與業務意義。

4. **JSON Payload 動手砌（Interactive Sandbox）**：提供欄位註解與即時 CTO 規則提示，讓使用者邊改欄位邊看錯誤提示與 JSON 結構變化。

5. **非同步（Async）與 Webhook 原理解析**：圖解為何 `#401`/`#415` 回傳 `202` 而不是 `200`，以及 Polling（`#402`）與 Callback（Webhook）的區別。

## 7. 給 VS Code + Cline (DeepSeek) 的分階段開發計畫

請將本 PRD 交給 Cline 後，按以下 **4 個階段（Milestones）** 逐步實作，每完成一個階段即可運行測試：

* **Phase 1：專案初始化與後端核心（mTLS + Auth + Mock Server）**

  * 建立 `backend/` 與 `frontend/` 骨架。

  * 實作 `mtlsClient.ts`、`authService.ts`（`#001` Token 快取）、`rateLimiter.ts` 及 `mockServer.ts`。

  * 建立 `GET /api/health` 與 `POST /api/auth/test`。

* **Phase 2：全 API Proxy、#409 簽章與 Webhook Callback 接收器**

  * 實作 `#401`–`#416` 代理路由與 SQLite 紀錄儲存。

  * 實作 `#409` SHA-256 + RSA 簽章工具。

  * 實作 `/api/webhook/hkia-callback` 與 SSE 即時推播。

* **Phase 3：前端 Testing Site UI（設定、引導式表單、CTO 驗證器、RCL 預覽）**

  * 建立設定頁、Full Flow / Lite Flow 雙模式表單 + JSON 編輯器。

  * 實作 `ctoValidator.ts`（AAT / CPSL / HACTL 規則檢查）與錯誤碼中文解析字典。

  * 建立 Callback 監控台與 `#411` RCL Base64 PDF 預覽器。

* **Phase 4：互動式教學模組（Learning Hub）與打包測試**

  * 建立 `/learn` 互動式教學專區，整合系統內的真實範例與 cURL 匯出。

  * 編寫 `README.md` 說明如何啟動、設定 `.env` 與切換 Mock / SIT 環境。