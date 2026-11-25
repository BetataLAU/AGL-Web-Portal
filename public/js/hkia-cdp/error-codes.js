// ===== HKIA CDP：錯誤碼智能解析字典（前後端共用）=====
// 收到 4xx/5xx 或 CTO 錯誤碼時，UI 以此字典顯示中文原因與修正建議。
// 查詢順序：完全比對 → 前綴規則（例 CDP_0xx 未列出的）→ HTTP 狀態碼 → 原始訊息。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HkiaErrorCodes = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // GLS = HKIA gateway 共通錯誤；CDP = CDP 平台驗證錯誤；HACTL 為 CTO 專屬數字碼
  const DICTIONARY = {
    CDP_001: { message: '缺少必要的 Request Header（x-api-key / Authorization / x-request-id）', fix: '確認 headers 是否齊全；#401/#403/#404/#415 需要 x-request-id。' },
    CDP_002: { message: 'x-api-key 無效或已停用', fix: '向 AAHK 確認 API Key，或在設定頁重新填寫。' },
    CDP_003: { message: 'Access Token 無效或已過期', fix: '重新呼叫 #001 取得新 Token（前端會自動續期，Mock 模式除外）。' },
    CDP_004: { message: '角色與路徑不符（RA / RF / TP）', fix: 'Role 設定需與 Token URI 及 payload 一致。' },
    CDP_010: { message: 'Request body 格式錯誤或欄位型別不符', fix: '確認 JSON 結構與 Spec 範例一致（數字欄位不要加引號或單位）。' },
    CDP_011: { message: '缺少必填欄位', fix: '依 CTO 預檢結果補齊必填欄位（例如 vehicleRegistration、securityStatus）。' },
    CDP_020: { message: '重複的 documentId / x-request-id', fix: '每次呼叫重新產生 UUID v4；重送請用 #403 更新而非重複建立。' },
    CDP_030: { message: '找不到指定的 ra_reference_id / export_order_reference_num', fix: '先用 #402 / #406 確認單號存在，或重新建立。' },
    CDP_040: { message: '狀態不允許此操作（例如已刪除或已提交）', fix: '查詢最新狀態後再操作；刪除後不可再更新。' },
    CDP_050: { message: '簽章驗證失敗（#409 imageSignature）', fix: '確認使用「申請憑證時的同一把 RSA 私鑰」、對原始圖片位元組做 SHA-256 後 RSA 簽章，並以 Base64 送出。' },
    CDP_060: { message: '圖片超過大小限制（<= 4 MB）', fix: '壓縮或裁切圖片；單一 Export Order 最多 20 張。' },
    CDP_070: { message: '超過 Rate Limit（15 requests/second/RA）', fix: '降低呼叫頻率；本平台後端已內建 15 req/s 排隊保護。' },
    CDP_080: { message: '非同步請求尚未處理完成', fix: '等待 Callback，或稍後以 #402 / #406 輪詢。' },
    CDP_090: { message: 'CTO 回傳值無法對應（cto_predeclaration_num 不符）', fix: '確認送出的 CTO 與 pre-declaration 的 CTO 相同。' },
    CERT_REQUIRED: { message: 'SIT / Production 需要 mTLS 客戶端憑證（.pem）', fix: '到「設定」指定路徑或上傳 AAHK 簽發的 .pem。' },
    CERT_NOT_FOUND: { message: '找不到憑證檔案（.pem）', fix: '確認路徑是否正確（含磁碟機代號），或重新上傳。' },
    KEY_REQUIRED: { message: '需要 mTLS 私鑰（.key）', fix: '上傳申請 CSR 時產生的 .key（PKCS#8）；若 .pem 是「憑證＋私鑰」合併檔，把 .key 路徑指向同一個 .pem。' },
    KEY_NOT_FOUND: { message: '找不到私鑰檔案（.key）', fix: '把 .key 放到設定頁指定的路徑，或重新上傳（內容需有 BEGIN PRIVATE KEY）。' },
    CREDENTIAL_MISSING: { message: '尚未設定 Client ID / Client Secret', fix: '到「設定」填入 AAHK 提供的 Client ID / Secret。' },
    API_KEY_MISSING: { message: '尚未設定 x-api-key', fix: '到「設定」填入 API Key。' },
    TOKEN_FAILED: { message: '#001 取得 Token 失敗', fix: '確認 Client ID / Secret / API Key、mTLS 憑證與來源 IP 白名單。' },
    TOKEN_INVALID: { message: '#001 回應沒有 access_token', fix: '確認環境（SIT / Production）與回應格式；必要時聯絡 AAHK。' },
    IMAGE_TOO_LARGE: { message: '#409 圖片超過 4 MB', fix: '壓縮或裁切圖片後再上傳。' },
    SIGN_FAILED: { message: '#409 簽章失敗', fix: '確認私鑰是 PKCS#8、與憑證配對，且圖片為有效 Base64。' },
    GLS_001: { message: 'Gateway 無法驗證 mTLS 憑證', fix: '確認 .pem / .key 配對正確、TLS 1.2、且 IP 已加入白名單。' },
    GLS_002: { message: '憑證已過期', fix: '重新申請並更換 certs 目錄中的 .pem / .key。' },
    GLS_003: { message: '來源 IP 不在白名單', fix: '提供對外 IP 給 AAHK 加入白名單（SIT 亦同）。' },
    GLS_010: { message: 'Gateway 逾時（30 秒）', fix: '縮小 payload（例如分批上傳安檢影像）或稍後重試。' },
    GLS_020: { message: 'Gateway 暫時不可用', fix: '稍後重試；若持續發生請聯絡 AAHK。' },
    GLS_030: { message: '請求路徑或方法錯誤', fix: '對照 Spec 的 Method / Endpoint（#409 的 role 可為 ra 或 rf）。' },
    108004: { message: 'HACTL：MAWB# 格式或檢查碼不正確', fix: 'MAWB 需為 11 位數字（前 7 位 mod 7 為檢查碼），顯示格式 000-0000 0000。' },
    108717: { message: 'HACTL：重量小數位超過 1 位', fix: '重量四捨五入到 1 位小數後重送。' },
    108785: { message: 'HACTL：體積小數位超過 2 位', fix: '體積四捨五入到 2 位小數後重送。' },
    122090: { message: 'HACTL：additionalSecurityInformation 格式不符（限 60 字元且全大寫）', fix: '改成全大寫英文並縮短到 60 字元內。' },
    122319: { message: 'HACTL：CTO 系統暫時無法處理', fix: '稍後重試；若持續發生請聯絡 HACTL。' }
  };

  // 前綴規則（未列出的號碼也能給方向）
  const PREFIX_RULES = [
    { re: /^CDP_0(0|1)\d$/, message: 'CDP 請求／認證層錯誤', fix: '檢查 API Key、Token、必填欄位與 x-request-id。' },
    { re: /^CDP_/, message: 'CDP 平台驗證錯誤', fix: '依訊息微調 payload；可先用本頁 CTO 預檢找出問題欄位。' },
    { re: /^GLS_/, message: 'HKIA Gateway 層錯誤', fix: '多為 mTLS、IP 白名單、Token 或逾時問題。' },
    { re: /^1\d{5}$/, message: 'HACTL CTO 驗證錯誤', fix: '對照 HACTL 錯誤清單修正欄位；重量／體積小數位與 ASI 全大寫最常見。' }
  ];

  const HTTP = {
    400: { message: '請求格式錯誤', fix: '檢查 JSON 語法、必填欄位與欄位型別。' },
    401: { message: '未授權（Token 失效或缺少 x-api-key）', fix: '重新取得 #001 Token；確認 x-api-key 與 Authorization 都有帶。' },
    403: { message: '沒有權限（角色或 IP 白名單）', fix: '確認 Role（RA/RF/TP）與 AAHK 開通的權限、來源 IP。' },
    404: { message: '找不到資源', fix: '確認單號（ra_reference_id / export_order_reference_num / MAWB）。' },
    409: { message: '資源狀態衝突', fix: '先查詢最新狀態；已刪除或已鎖定的資料不可再更新。' },
    413: { message: 'Payload 過大', fix: '縮小圖片或分批送出（#409 單張 <= 4 MB）。' },
    415: { message: 'Content-Type 不支援', fix: '#001 必須是 application/x-www-form-urlencoded；其餘為 application/json。' },
    422: { message: '欄位驗證失敗（CTO 規則）', fix: '依 CTO 預檢結果修正；常見為小數位、車牌、seal 長度、statusCode。' },
    429: { message: '超過 Rate Limit', fix: '降低頻率（15 req/s/RA），或稍後重試。' },
    500: { message: 'HKIA 或 CTO 內部錯誤', fix: '稍後重試並保留 x-request-id 供 AAHK 追查。' },
    504: { message: 'Gateway Timeout（30 秒）', fix: '分批處理或稍後重試。' }
  };

  function lookup(code) {
    const key = String(code === undefined || code === null ? '' : code).trim();
    if (!key) return null;
    if (DICTIONARY[key]) return Object.assign({ code: key, source: 'dictionary' }, DICTIONARY[key]);
    const rule = PREFIX_RULES.find((r) => r.re.test(key));
    if (rule) return { code: key, source: 'prefix', message: rule.message, fix: rule.fix };
    return null;
  }

  function explainHttp(status) {
    const n = Number(status);
    if (!Number.isFinite(n)) return null;
    return HTTP[n] ? Object.assign({ code: String(n), source: 'http' }, HTTP[n]) : null;
  }

  // 從 API 回應中抽出錯誤（支援 { error }, { message }, { cto_errors:[...] }, { errors:[...] }）
  // options.ok：未提供時維持舊行為（視為失敗）；明確 ok:true 時，頂層 message / error
  // 視為成功訊息（例：#405 的 { message: 'Export order created（mock）' }），不列為錯誤。
  function extract(response, options) {
    const out = [];
    if (!response || typeof response !== 'object') return out;
    const opts = options || {};
    const failed = opts.ok === undefined ? true : opts.ok !== true;
    const push = (item) => {
      if (!item) return;
      const code = item.code || item.errorCode || item.error_code || item.id;
      const msg = item.message || item.error || item.msg || item.description;
      const info = lookup(code) || (msg ? { code: code || '', message: msg, fix: '' } : null);
      if (info) out.push(info);
      else if (msg) out.push({ code: code || '', message: String(msg), fix: '' });
    };
    ['cto_errors', 'errors', 'errorDetails', 'details'].forEach((key) => {
      if (Array.isArray(response[key])) response[key].forEach(push);
    });
    if (failed) {
      if (typeof response.error === 'string') push({ code: response.code, message: response.error });
      if (typeof response.message === 'string') push({ code: response.code, message: response.message });
    }
    return out;
  }

  return { DICTIONARY, HTTP, lookup, explainHttp, extract };
});
