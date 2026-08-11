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

// ===== 我的帳號 Modal（顯示帳號資訊 + 修改密碼） =====
function showAccountModal(user) {
  const overlay = document.createElement('div');
  overlay.className = 'account-modal-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(2,6,23,0.6);display:flex;align-items:center;justify-content:center;z-index:300;padding:20px;';
  overlay.innerHTML = `
    <div style="background:var(--card-bg);border:1px solid var(--border-color);border-radius:20px;width:100%;max-width:420px;padding:28px;box-shadow:0 30px 60px rgba(2,6,23,0.4);box-sizing:border-box;">
      <h2 style="margin:0 0 16px;font-size:1.2rem;color:var(--text-main);">👤 我的帳號</h2>
      <div style="font-size:0.9rem;color:var(--text-muted);margin-bottom:20px;line-height:1.7;">
        <div>公司：<strong style="color:var(--text-main);">${escapeHtml(user.company_name || '-')}</strong>（${escapeHtml(user.company_code || '-')}）</div>
        <div>帳號：<strong style="color:var(--text-main);">${escapeHtml(user.user_id)}</strong></div>
        <div>名稱：${escapeHtml(user.display_name || '-')}</div>
        <div>角色：${escapeHtml(AUTH_ROLE_LABELS[user.role] || user.role || '-')}</div>
      </div>
      <div id="acct-error" style="display:none;background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.4);color:#dc2626;border-radius:10px;padding:10px 14px;font-size:0.85rem;margin-bottom:16px;"></div>
      <div style="border-top:1px solid var(--border-color);padding-top:16px;margin-bottom:16px;">
        <label style="display:block;font-size:0.85rem;font-weight:600;margin-bottom:6px;">目前密碼</label>
        <input type="password" id="acct-current" style="width:100%;padding:11px 14px;border:1px solid var(--border-color);border-radius:10px;background:var(--input-bg);color:var(--text-main);font-size:0.95rem;margin-bottom:12px;box-sizing:border-box;" />
        <label style="display:block;font-size:0.85rem;font-weight:600;margin-bottom:6px;">新密碼</label>
        <input type="password" id="acct-new" maxlength="20" style="width:100%;padding:11px 14px;border:1px solid var(--border-color);border-radius:10px;background:var(--input-bg);color:var(--text-main);font-size:0.95rem;margin-bottom:6px;box-sizing:border-box;" />
        <div style="color:var(--text-muted);font-size:0.78rem;">4-20 位，須包含英文與數字。</div>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:10px;">
        <button type="button" id="acct-cancel" style="padding:10px 18px;border:1px solid var(--border-color);border-radius:10px;background:var(--card-bg);color:var(--text-main);cursor:pointer;">關閉</button>
        <button type="button" id="acct-save" style="padding:10px 18px;border:none;border-radius:10px;background:var(--primary-gradient, #2563eb);color:#fff;cursor:pointer;font-weight:700;">🔑 改密碼</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const errBox = overlay.querySelector('#acct-error');
  overlay.querySelector('#acct-cancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  overlay.querySelector('#acct-save').addEventListener('click', async () => {
    errBox.style.display = 'none';
    const current = overlay.querySelector('#acct-current').value;
    const next = overlay.querySelector('#acct-new').value;
    if (!current) { errBox.textContent = '請填寫目前密碼'; errBox.style.display = 'block'; return; }
    if (!next) { errBox.textContent = '請填寫新密碼'; errBox.style.display = 'block'; return; }
    try {
      await apiFetch('/api/auth/me/password', {
        method: 'PUT',
        body: JSON.stringify({ current_password: current, new_password: next })
      });
      alert('密碼已更新');
      overlay.remove();
    } catch (err) {
      errBox.textContent = err.message;
      errBox.style.display = 'block';
    }
  });
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

    // 資料庫：僅具備 db_view 權限解鎖；否則顯示鎖頭並攔截
    const dbLock = document.getElementById('nav-dbviewer-lock');
    const navDb = document.getElementById('nav-dbviewer');
    const canViewDb = !!(user.permissions ? user.permissions.db_view : (user.role !== 'customer'));
    if (dbLock) dbLock.style.display = canViewDb ? 'none' : '';
    if (navDb) {
      if (!canViewDb) {
        navDb.classList.add('nav-item-locked');
        navDb.addEventListener('click', (e) => {
          e.preventDefault();
          alert('資料庫僅限具備檢視權限的人員使用');
        });
      }
    }

    // 使用者管理：僅 admin 顯示
    const navUsers = document.getElementById('nav-users');
    if (navUsers) navUsers.style.display = user.role === 'admin' ? 'flex' : 'none';

    // 我的帳號（顯示資訊 + 改密碼）
    const accountBtn = document.getElementById('btn-account');
    if (accountBtn) {
      accountBtn.addEventListener('click', () => showAccountModal(user));
    }

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