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
  const res = await fetch(url, {
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    ...options
  });

  // 未登入 / session 過期 → 跳轉登入頁
  if (res.status === 401) {
    redirectToLogin();
    throw new Error('請先登入');
  }

  if (!res.ok) {
    let errorMsg = '請求失敗';
    try {
      const errData = await res.json();
      if (errData.error) errorMsg = errData.error;
    } catch (e) { /* ignore */ }
    throw new Error(errorMsg);
  }
  return res.json();
}