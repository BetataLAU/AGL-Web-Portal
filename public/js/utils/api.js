// ===== 通用 API 封裝 =====
// 統一 fetch 呼叫，自動帶 JSON header、解析 JSON、拋出錯誤訊息
// cache: 'no-store' 防止瀏覽器（尤其手機）快取 GET 回應，確保永遠拿到最新資料

// 登入頁路徑（與 login.html 位置對應）
const LOGIN_PAGE_URL = './login.html';
// 已設定跳轉 flag：避免無限重導向（多次 401 連續觸發）
let redirectingToLogin = false;

function redirectToLogin() {
  if (redirectingToLogin) return;
  redirectingToLogin = true;
  // 記錄來源路徑（「不含」origin/port）：
  // 登入成功後可在「同一 port」用相對路徑跳回原頁
  // 避免使用者從其他 port 開啟網站時，登入後被導向錯誤的 port 而失敗
  try {
    sessionStorage.setItem('login-redirect', window.location.pathname + window.location.search + window.location.hash);
  } catch (e) { /* ignore */ }
  window.location.href = LOGIN_PAGE_URL;
}

async function apiFetch(url, options = {}) {
  // FormData 上傳（如檔案的 multipart/form-data）時不可指定 Content-Type，
  // 否則會覆蓋瀏覽器自動產生的 boundary，導致伺服器解析失敗（HTTP 400）
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
  const defaultHeaders = isFormData ? {} : { 'Content-Type': 'application/json' };
  const res = await fetch(url, {
    cache: 'no-store',
    headers: defaultHeaders,
    ...options
  });

  // 未登入 / session 過期 → 跳轉登入頁
  if (res.status === 401) {
    redirectToLogin();
    throw new Error('請先登入');
  }

  if (!res.ok) {
    let errorMsg = '';
    try {
      const errData = await res.json();
      if (errData.error) errorMsg = errData.error;
    } catch (e) { /* ignore */ }
    // 後端無回傳 JSON（如 Express 預設 HTML error page）→ 附加 HTTP 狀態碼
    if (!errorMsg) errorMsg = `請求失敗（HTTP ${res.status}）`;
    throw new Error(errorMsg);
  }
  return res.json();
}