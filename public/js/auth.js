// ===== 登入系統：Sidebar 登入狀態與權限控制 =====
// 依賴 window.apiFetch / LOGIN_PAGE_URL（定義於 utils/api.js）
// 用法：在 index.html 引入本檔案（須在 api.js 之後）

const AUTH_ROLE_LABELS = { admin: '管理員', staff: '內部員工', customer: '客戶' };

// 取得目前登入者資訊（未登入回 null）
// 注意：不可使用 apiFetch（401 會自動跳轉登入頁）。
//      主站的公開頁面（HOME/AI/Capabilities/Contour）不需登入，未登入時應停留在主站。
async function fetchCurrentUser() {
  try {
    const res = await fetch('/api/auth/me', { cache: 'no-store' });
    if (res.status === 401) return null; // 未登入 → 返回 null 不跳轉
    if (!res.ok) return null;
    const data = await res.json();
    return data.user || null;
  } catch (e) {
    return null;
  }
}

// 初始化 Sidebar 登入狀態 + 受保護區塊鎖頭
async function setupAuthUI() {
  const user = await fetchCurrentUser();
  const loginBtn = document.getElementById('sidebar-login-btn');
  const loggedInBox = document.getElementById('sidebar-logged-in');
  const userNameEl = document.getElementById('sidebar-user-name');
  const userCompanyEl = document.getElementById('sidebar-user-company');

  if (user) {
    // ===== 已登入：顯示帳號資訊 =====
    if (loginBtn) loginBtn.style.display = 'none';
    if (loggedInBox) loggedInBox.style.display = 'flex';
    if (userNameEl) userNameEl.textContent = user.display_name || user.user_id;
    if (userCompanyEl) userCompanyEl.textContent = `${user.company_name}（${AUTH_ROLE_LABELS[user.role] || user.role}）`;

    // 初始化受保護區塊（訂單系統 / 資料庫檢視器）
    // 定義於 main.js：僅在已登入時呼叫，避免未登入時發出受保護 API 請求
    if (typeof window.initProtectedSections === 'function') {
      window.initProtectedSections();
    }

    // 解鎖訂單系統
    const ordersLock = document.getElementById('nav-orders-lock');
    if (ordersLock) ordersLock.style.display = 'none';

    // 資料庫：僅 admin / staff 解鎖；customer 顯示鎖頭並攔截點擊
    const dbLock = document.getElementById('nav-dbviewer-lock');
    if (dbLock) dbLock.style.display = 'none';
    const navDb = document.getElementById('nav-dbviewer');
    if (navDb) {
      if (user.role === 'customer') {
        if (dbLock) dbLock.style.display = '';
        navDb.classList.add('nav-item-locked');
        navDb.addEventListener('click', (e) => {
          e.preventDefault();
          alert('資料庫僅限管理員/內部員工使用');
        });
      }
    }

    // 使用者管理：僅 admin 顯示
    const navUsers = document.getElementById('nav-users');
    if (navUsers) navUsers.style.display = user.role === 'admin' ? 'flex' : 'none';

    // 登出按鈕
    const logoutBtn = document.getElementById('btn-logout');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', async () => {
        try {
          await apiFetch('/api/auth/logout', { method: 'POST' });
        } catch (e) { /* 忽略登出錯誤，仍跳回首頁 */ }
        window.location.href = 'index.html';
      });
    }
  } else {
    // ===== 未登入：顯示登入按鈕、鎖頭 =====
    if (loginBtn) loginBtn.style.display = 'flex';
    if (loggedInBox) loggedInBox.style.display = 'none';

    // 訂單系統 / 資料庫：顯示鎖頭，點擊導向登入頁
    ['nav-orders', 'nav-dbviewer'].forEach(id => {
      const nav = document.getElementById(id);
      if (!nav) return;
      nav.classList.add('nav-item-locked');
      nav.addEventListener('click', (e) => {
        e.preventDefault();
        // 記住想前往的頁面（「不含」origin/port，登入後在同一 port 跳回）
        try {
          sessionStorage.setItem('login-redirect', window.location.pathname + window.location.search + '#' + id.replace('nav-', 'section-'));
        } catch (err) { /* ignore */ }
        window.location.href = LOGIN_PAGE_URL;
      });
    });
  }
}

// 頁面載入後初始化（須在 DOMContentLoaded 前掛載；api.js 已先載入）
document.addEventListener('DOMContentLoaded', () => {
  setupAuthUI();
});