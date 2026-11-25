# HKIA CDP API Testing Site（實作紀錄）

> 對應 PRD：根目錄 `hkia_cdp_testing_site_prd.md`（RA / RACSF / TP Integration Service API v1.27）
> 本文件記錄 **實際落地在這個 AGL-Web-Portal 專案** 的做法、檔案、API、限制與驗證方式。

## 1. 與 PRD 的差異（重要）

PRD 假設獨立新專案（React + Vite + Node/Python BFF）。**本專案是 Vanilla JS + Express + SQLite、無 build step**，
因此改為「同一個 Portal 內新增一個側欄模組」，並保留 PRD 的所有功能目標：

| PRD | 本專案實作 |
|---|---|
| React 前端 | `public/index.html` 的 `#section-hkia-cdp` + `public/js/hkia-cdp/*`（ESM 模組，無 build） |
| SQLite 歷史 | `data/hkia-cdp/history.json`（測試工具狀態可重建，避免污染主 DB；上限 300 筆） |
| Postman 式測試 | 表單模式＝引導式精靈（Full / Lite Flow） |
| 憑證載入 | 設定頁可填路徑或上傳 `.pem` / `.key`（存 `data/hkia-cdp/certs/`，已 gitignore） |
| `#409` C# 簽章程式 | Node `crypto.sign('sha256', …)`（RSA-SHA256） |
| Webhook | 公開端點 `POST /api/hkia-cdp/webhook`（可選 Basic Auth）＋ SSE `/api/hkia-cdp/events` |

## 2. 檔案地圖

### 後端（`routes/hkia-cdp/`）

| 檔案 | 職責 |
|---|---|
| `index.js` | Router：`GET/PUT /config`、`POST /auth/test`、`/lint`、`/sign`、`/proxy`、`/history`、`/refs`、`/pending`、`/mock/reset`、`/health`、`/events`（SSE）、`/simulate-callback`；另匯出 `webhookRouter`（公開）與 `invokeCallback()` |
| `store.js` | 設定／歷史／Mock 狀態 JSON 持久化、機密遮罩、pending Map、SSE clients；`HKIA_DATA_DIR` 可完全隔離（測試用） |
| `http-client.js` | 15 支 API 定義表、`buildPath()`、mTLS Agent（TLS 1.2）、30 秒逾時、`#001` Token 快取（270 秒）、15 req/s 限流 |
| `mock.js` | Local Mock：#401/#402/#403/#404/#405/#406/#407/#408/#409/#410/#411（含真實 PDF）/#412/#415/#416；`scenario` 支援 `cto_reject` / `validation_error` / `not_found` / `timeout` / `rate_limit` |
| `signature.js` | Base64 解碼（含 data URI）→ SHA-256 → RSA-SHA256 簽章；> 4 MB 回 `IMAGE_TOO_LARGE` |

### 前端（`public/js/hkia-cdp/`）

| 檔案 | 職責 |
|---|---|
| `../hkia-cdp.js` | 入口（ESM）：分頁框架、總覽、設定（含上傳／OpenSSL 指令）、Callback 監控、SSE、Token 倒數、Production 二次確認 |
| `cto-validator.js` | **前後端共用**（UMD）：AAT / CPSL / HACTL 規則 ＋ Seal 格式；錯誤代碼沿用 Spec（108717/108785/122090…） |
| `error-codes.js` | 錯誤碼字典（CDP_ / GLS_ / HACTL 數字碼 / HTTP 狀態）＋前綴規則＋`extract()` |
| `presets.js` | 8 個測試情境（Bulk→AAT/CPSL/HACTL、Prepack、Mix-prepack、Lite×3）、UUID / RFC 3339、ULD 文字解析 |
| `snippets.js` | cURL / JavaScript / Python 片段（含 `--cert` / `--key` / `tlsv1.2`） |
| `api.js` | 前端 API 層（`window.apiFetch`）＋檔案轉 Base64 |
| `ui.js` | 共用 UI（esc／lint／result／snippets／toast／field） |
| `flow.js` | Full Flow（#405 → #409 → #401）與 Lite Flow（#415 / #416）精靈；表單／JSON 雙模式、即時預檢 |
| `query.js` | #402 / #406 / #410 / #411 / #412 查詢、單號下拉、RCL Base64 PDF 預覽＋下載；另附 #403／#404／#407／#408 更新／刪除面板 |
| `learn.js` | 互動教學：架構圖、認證順序、Flow 對照、Async 說明、JSON 沙盒（即時預檢）、錯誤碼搜尋 |

### 其他

| 檔案 | 變更 |
|---|---|
| `public/index.html` | 側欄 `#nav-hkia-cdp`、`#section-hkia-cdp`、`css/hkia-cdp.css`、兩個 classic 共用腳本＋ESM 入口 |
| `public/js/auth.js` | 登入後解鎖鎖頭（僅 admin/staff）；未登入／非員工攔截（非員工提示「僅限內部員工」） |
| `public/js/main.js` | `initProtectedSections()` 呼叫 `window.setupHkiaCdpSection()` |
| `scripts/fix-nav-order.js` | `DEFAULT_ORDER` 加 `#section-hkia-cdp`（並補上原本漏掉的 `#section-loading-plan`） |
| `server.js` | `/api/hkia-cdp/webhook`（公開）掛在 `/api/hkia-cdp`（`requireAuth`）**之前** |

## 3. API 一覽

| Method | Path | 說明 |
|---|---|---|
| GET | `/api/hkia-cdp/config` | 遮罩後的設定＋環境／API 定義／OpenSSL 指令／限流狀態 |
| PUT | `/api/hkia-cdp/config` | 儲存（`clientSecret` / `webhookPass` 空字串＝維持原值、`null`＝清除） |
| POST | `/api/hkia-cdp/certs` | `multipart/form-data`（`kind=cert|key`）→ 寫入 `data/hkia-cdp/certs/` |
| POST | `/api/hkia-cdp/auth/test` | #001（Mock 回假 JWT；SIT/Prod 走 mTLS） |
| POST | `/api/hkia-cdp/lint` | 後端 CTO 預檢（與前端同一支 validator） |
| POST | `/api/hkia-cdp/sign` | #409 簽章（可用已存 `.key` 或請求帶 `privateKeyPem`） |
| POST | `/api/hkia-cdp/proxy` | `{ api, params, body, env?, scenario?, autoSign?, confirmProd? }` → `{ok,status,response,lint,callback,errors}` |
| GET/DELETE | `/api/hkia-cdp/history` | 歷史（`?type=api|callback|auth`；DELETE 清空） |
| GET | `/api/hkia-cdp/refs` | 已建立的 Export Order / Pre-Declaration / MAWB（查詢頁下拉） |
| GET | `/api/hkia-cdp/pending` | 等待 Callback 的非同步請求 |
| POST | `/api/hkia-cdp/mock/reset` | 清空 Mock 單號／影像 |
| GET | `/api/hkia-cdp/health` | 環境／mTLS／Token／pending／SSE／限流 |
| GET | `/api/hkia-cdp/events` | SSE：`history` / `callback` / `token` / `mock-reset` |
| POST | `/api/hkia-cdp/simulate-callback` | 手動模擬 Callback（admin/staff） |
| POST | `/api/hkia-cdp/webhook` | **公開**（可選 Basic Auth）；HKIA → 本平台；回 `{received, matched}` |

## 4. 安全與限制

- `clientSecret` / `webhookPass` / `apiKey` 在 `GET /config` 一律遮罩；前端儲存時留空＝不變更。
- 憑證只存路徑；檔案在 `data/hkia-cdp/certs/`（`.gitignore` 已排除整個 `data/hkia-cdp/`）。
- SIT / Production 沒有 `.pem` + `.key` → 直接回 `CERT_REQUIRED`（不會嘗試連外）。
- Production 一定需要 `confirmProd: true`（前端另有一次 `confirm`）。
- Local Mock 的 `#409` 若沒設定 `.key`，會使用**臨時金鑰**（只為讓流程可跑，重啟後失效）。
- 非同步 Callback 只保存 `source_id` 對應關係在記憶體（`pending`）；平台重啟後仍可從歷史看到回調，但不會再「配對」。
- 歷史紀錄不存 `imageBase64` / `encodedPdf` 本體（避免 JSON 膨脹），只留 `[omitted: n chars]`。
- `.dockerignore` 排除 `data/hkia-cdp`：Dockerfile 是 `COPY . .`，若不排除會把本機 `clientSecret` 與 `.pem/.key` 打進 image。
- SIT 設定使用 Windows 絕對路徑；部署到容器時請在容器內重新上傳憑證（Volume 內）。

## 5. SIT 設定（Air Global，2026-11-25）

- **設定位置**：`data/hkia-cdp/config.json`（整個 `data/hkia-cdp/` 已 gitignore，不進版控）。
- **環境**：`env = sit`、`role = RA`、`clientId = hkiacargo-ra-ra020371`（Client Secret / API Key 只存在本機設定檔，
  文件與版控不記錄）。
- **憑證**：`data/hkia-cdp/certs/air_global_sit_2026.pem`
  - subject：`O=Air Global Limited`、`CN=61.238.133.218`（RSA 2048）
  - issuer：`Airport Authority Hong Kong`（`acn-hk-cargo-data-platform.com`）
  - 有效期間：2026-10-13 → **2027-11-17**
- **私鑰**：`data/hkia-cdp/certs/air_global_sit_2026.key`（**仍需放入**；內容需為
  `-----BEGIN PRIVATE KEY-----`，即申請 CSR 時產生的那一把）。沒有私鑰時 mTLS 無法完成，
  但設定頁／總覽會明確顯示缺哪個檔案。
- **上傳防呆**：`POST /api/hkia-cdp/certs` 會檢查 PEM 內容：
  - 憑證欄必須有 `BEGIN CERTIFICATE`（若上傳 CSR 會回 `CERT_FILE_INVALID`）
  - 私鑰欄必須有 `BEGIN PRIVATE KEY`（若上傳憑證會回 `KEY_FILE_INVALID`）
- **合併式 .pem**：若 AAHK 只給一個同時含 CERTIFICATE 與 PRIVATE KEY 的 `.pem`，
  可把「Private Key 路徑」指向同一個 `.pem`；`createAgent()` 也會在未設 keyPath 時自動偵測。
- **狀態檢查**：`GET /api/hkia-cdp/config` 的 `mtls`、`GET /api/hkia-cdp/health` 的
  `mTlsRequired / mTlsConfigured / mTlsIssues / mTlsCombinedPem`；憑證資訊（subject／有效期限／指紋）
  由 Node `crypto.X509Certificate` 解析，不會回傳任何私鑰內容。

## 6. 驗證

```bash
npm run test:hkia-cdp        # 靜態 / 純函式（NAV、validator、presets、錯誤碼、簽章、路徑、設定遮罩）
npm run test:hkia-cdp-api    # 端對端（自帶伺服器；含靜態資源、202 + 延遲 Callback、Webhook Basic Auth、#411 PDF）
npm run test:hkia-cdp-ui     # UI 煙霧（Chrome CDP：登入→各分頁→#405/#415→SSE Callback；找不到瀏覽器會 SKIP）
node scripts/test-nav-hierarchy.js
node scripts/test-nav-order-frontend.js
```

## 7. 後續可選項

1. `#409` 多圖上傳（目前一次一張，單張 ≤ 4 MB；Spec 允許單一 Export Order 20 張）。
2. 歷史紀錄改存 SQLite（若需要跨使用者共享／報表）。
3. Callback 重送（Retry）與簽章驗證（若 AAHK 提供 public key）。
4. SIT 實測：需要 AAHK 核發 `.pem` / `.key`、API Key、Client ID/Secret 與 IP 白名單。
5. Learning Hub 加入更多互動（逐步動畫／測驗）。
