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

// ===== Sidebar 登入卡背景圖（localStorage 快取 + 伺服器持久化，全站共用） =====
const SIDEBAR_BG_KEY = 'sidebar-bg-image';
const SIDEBAR_BG_MAX_BYTES = 1024 * 1024; // 1MB

// 背景圖調整參數（縮放倍率 + 位移）
// 儲存格式（JSON 物件或純 URL 舊格式相容）：
//   { url: "data:...", scale: 1.5, posX: 20, posY: -10 }
function parseSidebarBgData(raw) {
  if (!raw) return { url: '', scale: 1, posX: 0, posY: 0 };
  // 舊格式：純 URL 字串
  if (typeof raw === 'string' && (raw.startsWith('data:') || /^https?:\/\//i.test(raw))) {
    return { url: raw, scale: 1, posX: 0, posY: 0 };
  }
  // 新格式：JSON 字串
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && parsed.url) {
      return {
        url: parsed.url,
        scale: Number.isFinite(Number(parsed.scale)) ? Number(parsed.scale) : 1,
        posX: Number.isFinite(Number(parsed.posX)) ? Number(parsed.posX) : 0,
        posY: Number.isFinite(Number(parsed.posY)) ? Number(parsed.posY) : 0
      };
    }
  } catch (e) { /* ignore */ }
  return { url: raw, scale: 1, posX: 0, posY: 0 };
}

function serializeSidebarBgData(data) {
  if (!data || !data.url) return '';
  if (data.scale === 1 && data.posX === 0 && data.posY === 0) {
    return data.url; // 無調整 → 存純 URL（與舊格式相容）
  }
  return JSON.stringify({ url: data.url, scale: data.scale, posX: data.posX, posY: data.posY });
}

// 套用背景圖到「登入卡中間圖片區」（含半透明遮罩確保視覺柔和）
// 參數：bgUrl 圖片網址；opts { scale, posX, posY } 縮放與位移
function applySidebarBg(bgUrl, opts) {
  const imageBox = document.getElementById('sidebar-bg-image');
  if (!imageBox) return;
  if (!bgUrl) {
    imageBox.removeAttribute('data-has-bg');
    imageBox.style.backgroundImage = '';
    return;
  }
  const scale = opts && Number.isFinite(Number(opts.scale)) ? Number(opts.scale) : 1;
  const posX = opts && Number.isFinite(Number(opts.posX)) ? Number(opts.posX) : 0;
  const posY = opts && Number.isFinite(Number(opts.posY)) ? Number(opts.posY) : 0;

  imageBox.setAttribute('data-has-bg', '1');
  imageBox.style.backgroundImage = `url("${bgUrl}")`;
  // 保持圖片原始比例縮放（以高度為基準），位移為中心點偏移
  imageBox.style.backgroundSize = `${Math.round(scale * 100)}% auto`;
  imageBox.style.backgroundPosition = `calc(50% + ${posX}px) calc(50% + ${posY}px)`;
  imageBox.style.backgroundRepeat = 'no-repeat';
}

// 讀取並套用已儲存背景圖（登入 / 頁面載入時呼叫）
// 流程：先顯示 localStorage 快取（立即顯示），再從伺服器讀取最新值覆蓋
function loadSidebarBg() {
  try {
    const cached = localStorage.getItem(SIDEBAR_BG_KEY);
    if (cached) {
      const parsed = parseSidebarBgData(cached);
      applySidebarBg(parsed.url || null, parsed);
    }
  } catch (e) { /* ignore */ }

  // 已登入時從伺服器讀取（重啟伺服器 / 換瀏覽器後仍能取回）
  fetch('/api/auth/me/sidebar-bg', { cache: 'no-store' })
    .then(res => {
      if (!res.ok) return null;
      return res.json();
    })
    .then(data => {
      if (!data) return;
      const bgData = { url: data.bgUrl || '', scale: data.scale || 1, posX: data.posX || 0, posY: data.posY || 0 };
      try {
        if (bgData.url) {
          localStorage.setItem(SIDEBAR_BG_KEY, serializeSidebarBgData(bgData));
        } else {
          localStorage.removeItem(SIDEBAR_BG_KEY);
        }
      } catch (e) { /* ignore */ }
      applySidebarBg(bgData.url || null, bgData);
    })
    .catch(() => { /* 伺服器錯誤時保留 localStorage 快取 */ });
}

// 儲存背景圖（寫入伺服器持久化 + localStorage 快取）
// 參數：bgUrl 圖片網址；opts { scale, posX, posY }
async function saveSidebarBg(bgUrl, opts) {
  const bgData = {
    url: bgUrl || '',
    scale: (opts && Number.isFinite(Number(opts.scale))) ? Number(opts.scale) : 1,
    posX: (opts && Number.isFinite(Number(opts.posX))) ? Number(opts.posX) : 0,
    posY: (opts && Number.isFinite(Number(opts.posY))) ? Number(opts.posY) : 0
  };
  const serialized = serializeSidebarBgData(bgData);

  // 先更新 localStorage 與 UI（立即反應，不需等伺服器回應）
  try {
    if (!bgData.url) {
      localStorage.removeItem(SIDEBAR_BG_KEY);
    } else {
      localStorage.setItem(SIDEBAR_BG_KEY, serialized);
    }
  } catch (e) {
    // localStorage 滿了不代表伺服器端失敗，僅提示但繼續嘗試伺服器端
  }
  applySidebarBg(bgData.url || null, bgData);

  // 寫入伺服器（SQLite 持久化，重啟伺服器 / 換瀏覽器後仍保留）
  try {
    await apiFetch('/api/auth/me/sidebar-bg', {
      method: 'PUT',
      body: JSON.stringify({ bgUrl: bgData.url, scale: bgData.scale, posX: bgData.posX, posY: bgData.posY })
    });
  } catch (e) {
    // localStorage 寫入失敗時拋出明確錯誤
    try {
      if (bgData.url) localStorage.setItem(SIDEBAR_BG_KEY, serialized);
    } catch (e2) {
      throw new Error('儲存失敗：圖片可能太大。建議使用 200KB 以下的圖片或改用圖片網址。');
    }
  }
}

// ===== 我的帳號 Modal（顯示帳號資訊 + 修改密碼 + 背景圖設定） =====
function showAccountModal(user) {
  const overlay = document.createElement('div');
  overlay.className = 'account-modal-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(2,6,23,0.6);display:flex;align-items:center;justify-content:center;z-index:300;padding:20px;';
  overlay.innerHTML = `
    <div style="background:var(--card-bg);border:1px solid var(--border-color);border-radius:20px;width:100%;max-width:440px;padding:28px;box-shadow:0 30px 60px rgba(2,6,23,0.4);box-sizing:border-box;max-height:88vh;overflow-y:auto;">
      <h2 style="margin:0 0 16px;font-size:1.2rem;color:var(--text-main);">👤 我的帳號</h2>
      <div style="font-size:0.9rem;color:var(--text-muted);margin-bottom:20px;line-height:1.7;">
        <div>公司：<strong style="color:var(--text-main);">${escapeHtml(user.company_name || '-')}</strong>（${escapeHtml(user.company_code || '-')}）</div>
        <div>帳號：<strong style="color:var(--text-main);">${escapeHtml(user.user_id)}</strong></div>
        <div>名稱：${escapeHtml(user.display_name || '-')}</div>
        <div>角色：${escapeHtml(AUTH_ROLE_LABELS[user.role] || user.role || '-')}</div>
      </div>

      <div style="border-top:1px solid var(--border-color);padding-top:16px;margin-bottom:16px;">
        <label style="display:block;font-size:0.85rem;font-weight:600;margin-bottom:6px;">🖼️ 登入資訊卡背景圖</label>
        <div style="font-size:0.78rem;color:var(--text-muted);margin-bottom:8px;">此圖片會顯示在登入卡的「中間區」。建議比例 3:1～4:1（如 800×200），大小 ≤200KB，會自動裁切填滿。</div>
        <input type="text" id="acct-bg-url" placeholder="貼上圖片網址（http/https）..." value="${escapeAttr((() => { try { const s = localStorage.getItem(SIDEBAR_BG_KEY); return s ? parseSidebarBgData(s).url : ''; } catch (e) { return ''; } })())}" style="width:100%;padding:10px 12px;border:1px solid var(--border-color);border-radius:10px;background:var(--input-bg);color:var(--text-main);font-size:0.9rem;margin-bottom:8px;box-sizing:border-box;" />
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px;">
          <button type="button" id="acct-bg-upload" style="padding:8px 14px;border:1px solid var(--border-color);border-radius:10px;background:var(--card-bg);color:var(--text-main);cursor:pointer;font-size:0.85rem;">📁 上傳圖片</button>
          <button type="button" id="acct-bg-preview" style="padding:8px 14px;border:1px solid var(--border-color);border-radius:10px;background:var(--card-bg);color:var(--text-main);cursor:pointer;font-size:0.85rem;">👁️ 預覽</button>
          <button type="button" id="acct-bg-reset" style="padding:8px 14px;border:1px solid var(--border-color);border-radius:10px;background:var(--card-bg);color:var(--text-main);cursor:pointer;font-size:0.85rem;">↺ 重設位置</button>
          <button type="button" id="acct-bg-clear" style="padding:8px 14px;border:1px solid rgba(239,68,68,0.4);border-radius:10px;background:rgba(239,68,68,0.1);color:#dc2626;cursor:pointer;font-size:0.85rem;">✖ 移除背景</button>
        </div>
        <input type="file" id="acct-bg-file" accept="image/*" style="display:none;" />
        <div id="acct-bg-msg" style="display:none;font-size:0.8rem;border-radius:8px;padding:6px 10px;margin-bottom:8px;"></div>
        <div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:4px;">👆 在預覽框內拖曳可移動圖片，滾輪可縮放</div>
        <div id="acct-bg-live" style="border:1px solid var(--border-color);border-radius:12px;height:100px;overflow:hidden;background:var(--surface-glow);cursor:grab;position:relative;touch-action:none;"></div>
        <div style="display:flex;align-items:center;gap:8px;margin-top:8px;">
          <span style="font-size:0.75rem;color:var(--text-muted);">縮放</span>
          <input type="range" id="acct-bg-scale" min="0.5" max="5" step="0.05" value="1" style="flex:1;" />
          <span id="acct-bg-scale-label" style="font-size:0.75rem;color:var(--text-muted);min-width:38px;text-align:right;">100%</span>
        </div>
      </div>

      <div style="border-top:1px solid var(--border-color);padding-top:16px;margin-bottom:16px;">
        <label style="display:block;font-size:0.85rem;font-weight:600;margin-bottom:6px;">🔑 修改密碼</label>
        <label style="display:block;font-size:0.75rem;font-weight:600;margin-bottom:4px;color:var(--text-muted);">目前密碼</label>
        <input type="password" id="acct-current" style="width:100%;padding:11px 14px;border:1px solid var(--border-color);border-radius:10px;background:var(--input-bg);color:var(--text-main);font-size:0.95rem;margin-bottom:10px;box-sizing:border-box;" />
        <label style="display:block;font-size:0.75rem;font-weight:600;margin-bottom:4px;color:var(--text-muted);">新密碼</label>
        <input type="password" id="acct-new" maxlength="20" style="width:100%;padding:11px 14px;border:1px solid var(--border-color);border-radius:10px;background:var(--input-bg);color:var(--text-main);font-size:0.95rem;margin-bottom:6px;box-sizing:border-box;" />
        <div style="color:var(--text-muted);font-size:0.78rem;">4-20 位，須包含英文與數字。</div>
      </div>
      <div id="acct-error" style="display:none;background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.4);color:#dc2626;border-radius:10px;padding:10px 14px;font-size:0.85rem;margin-bottom:16px;"></div>
      <div style="display:flex;justify-content:flex-end;gap:10px;">
        <button type="button" id="acct-cancel" style="padding:10px 18px;border:1px solid var(--border-color);border-radius:10px;background:var(--card-bg);color:var(--text-main);cursor:pointer;">關閉</button>
        <button type="button" id="acct-save" style="padding:10px 18px;border:none;border-radius:10px;background:var(--primary-gradient, #2563eb);color:#fff;cursor:pointer;font-weight:700;">🔑 改密碼</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const errBox = overlay.querySelector('#acct-error');
  const bgUrlInput = overlay.querySelector('#acct-bg-url');
  const bgMsg = overlay.querySelector('#acct-bg-msg');
  const bgLive = overlay.querySelector('#acct-bg-live');
  const bgFileInput = overlay.querySelector('#acct-bg-file');
  const bgScaleSlider = overlay.querySelector('#acct-bg-scale');
  const bgScaleLabel = overlay.querySelector('#acct-bg-scale-label');

  // ===== 目前調整狀態（縮放倍率 + 位移） =====
  let currentScale = 1;
  let currentPosX = 0;
  let currentPosY = 0;

  function showBgMsg(text, isError) {
    bgMsg.textContent = text;
    bgMsg.style.display = 'block';
    bgMsg.style.background = isError ? 'rgba(239,68,68,0.12)' : 'rgba(34,197,94,0.12)';
    bgMsg.style.color = isError ? '#dc2626' : '#15803d';
    bgMsg.style.border = `1px solid ${isError ? 'rgba(239,68,68,0.4)' : 'rgba(34,197,94,0.4)'}`;
  }

  // 更新預覽框（套用目前縮放與位移）
  function updateBgLive(url) {
    if (url) {
      bgLive.style.backgroundImage = `url("${url}")`;
      bgLive.style.backgroundSize = `${Math.round(currentScale * 100)}% auto`;
      bgLive.style.backgroundPosition = `calc(50% + ${currentPosX}px) calc(50% + ${currentPosY}px)`;
      bgLive.style.backgroundRepeat = 'no-repeat';
    } else {
      bgLive.style.backgroundImage = '';
      bgLive.style.background = 'var(--surface-glow)';
    }
  }

  // 同步縮放滑桿 UI
  function syncScaleUI() {
    if (bgScaleSlider) bgScaleSlider.value = String(currentScale);
    if (bgScaleLabel) bgScaleLabel.textContent = `${Math.round(currentScale * 100)}%`;
  }

  // 初始化預覽（顯示目前已儲存的背景與調整參數）
  let initialBgData = { url: '', scale: 1, posX: 0, posY: 0 };
  try {
    const saved = localStorage.getItem(SIDEBAR_BG_KEY);
    if (saved) initialBgData = parseSidebarBgData(saved);
  } catch (e) { /* ignore */ }
  currentScale = initialBgData.scale;
  currentPosX = initialBgData.posX;
  currentPosY = initialBgData.posY;
  updateBgLive(initialBgData.url);
  syncScaleUI();

  // ===== 預覽區互動：拖曳移動 =====
  let isDragging = false;
  let dragStartX = 0, dragStartY = 0;
  let dragOriginX = 0, dragOriginY = 0;

  bgLive.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    isDragging = true;
    bgLive.style.cursor = 'grabbing';
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    dragOriginX = currentPosX;
    dragOriginY = currentPosY;
    e.preventDefault();
  });

  window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    // 縮放倍率愈大，拖曳位移的像素靈敏度愈高
    const sensitivity = Math.max(1, currentScale);
    currentPosX = dragOriginX + (e.clientX - dragStartX) * sensitivity;
    currentPosY = dragOriginY + (e.clientY - dragStartY) * sensitivity;
    updateBgLive(bgUrlInput.value.trim() || (initialBgData.url));
  });

  window.addEventListener('mouseup', () => {
    if (!isDragging) return;
    isDragging = false;
    bgLive.style.cursor = 'grab';
    // 拖曳結束後立即儲存調整參數
    const url = bgUrlInput.value.trim() || initialBgData.url;
    if (url) {
      saveSidebarBg(url, { scale: currentScale, posX: currentPosX, posY: currentPosY })
        .catch(() => showBgMsg('儲存失敗，請重試', true));
    }
  });

  // ===== 預覽區互動：滾輪縮放（以滑鼠位置為中心） =====
  bgLive.addEventListener('wheel', (e) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
    const newScale = Math.min(5, Math.max(0.5, currentScale * zoomFactor));
    if (newScale === currentScale) return;
    currentScale = Math.round(newScale * 100) / 100;
    syncScaleUI();
    updateBgLive(bgUrlInput.value.trim() || initialBgData.url);
  }, { passive: false });

  // ===== 縮放滑桿 =====
  if (bgScaleSlider) {
    bgScaleSlider.addEventListener('input', () => {
      currentScale = Number(bgScaleSlider.value);
      syncScaleUI();
      updateBgLive(bgUrlInput.value.trim() || initialBgData.url);
    });
    bgScaleSlider.addEventListener('change', () => {
      // 滑桿放開後儲存
      const url = bgUrlInput.value.trim() || initialBgData.url;
      if (url) {
        saveSidebarBg(url, { scale: currentScale, posX: currentPosX, posY: currentPosY })
          .catch(() => showBgMsg('儲存失敗，請重試', true));
      }
    });
  }

  // 重設位置/縮放
  overlay.querySelector('#acct-bg-reset').addEventListener('click', () => {
    currentScale = 1;
    currentPosX = 0;
    currentPosY = 0;
    syncScaleUI();
    updateBgLive(bgUrlInput.value.trim() || initialBgData.url);
    const url = bgUrlInput.value.trim() || initialBgData.url;
    if (url) {
      saveSidebarBg(url, { scale: 1, posX: 0, posY: 0 })
        .catch(() => showBgMsg('儲存失敗，請重試', true));
      showBgMsg('✅ 已重設位置', false);
      setTimeout(() => (bgMsg.style.display = 'none'), 1500);
    }
  });

  async function commitBg(url, successMsg) {
    try {
      await saveSidebarBg(url, { scale: currentScale, posX: currentPosX, posY: currentPosY });
      updateBgLive(url);
      showBgMsg(successMsg, false);
      setTimeout(() => (bgMsg.style.display = 'none'), 2500);
    } catch (e) {
      showBgMsg(e.message, true);
    }
  }

  // 上傳圖片按鈕 → 觸發隱藏 file input
  overlay.querySelector('#acct-bg-upload').addEventListener('click', () => bgFileInput.click());

  // 選擇圖片 → FileReader 轉 DataURL
  bgFileInput.addEventListener('change', () => {
    const file = bgFileInput.files && bgFileInput.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      showBgMsg('請選擇圖片檔案（JPG / PNG / WebP 等）', true);
      return;
    }
    if (file.size > SIDEBAR_BG_MAX_BYTES) {
      showBgMsg('圖片超過 1MB，可能無法存入瀏覽器。建議使用 200KB 以下的圖片。', true);
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target.result;
      bgUrlInput.value = dataUrl;
      commitBg(dataUrl, '✅ 背景圖已套用（上傳）');
    };
    reader.onerror = () => showBgMsg('讀取圖片失敗，請重試', true);
    reader.readAsDataURL(file);
    bgFileInput.value = '';
  });

  // 預覽按鈕 → 讀取 URL input → 驗證 → 套用
  overlay.querySelector('#acct-bg-preview').addEventListener('click', () => {
    const url = bgUrlInput.value.trim();
    if (!url) { showBgMsg('請先貼上圖片網址或上傳圖片', true); return; }
    // 允許 data: 開頭（上傳產生的）與 http/https
    if (!url.startsWith('data:') && !/^https?:\/\//i.test(url)) {
      showBgMsg('請輸入有效的圖片網址（http:// 或 https://）', true);
      return;
    }
    commitBg(url, '✅ 背景圖已套用（網址）');
  });

  // 移除背景
  overlay.querySelector('#acct-bg-clear').addEventListener('click', () => {
    bgUrlInput.value = '';
    commitBg('', '背景圖已移除');
  });

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

    // 初始化受保護區塊（訂單系統 / 資料庫檢視器 / 打板計劃）
    // 定義於 main.js：僅在已登入時呼叫，避免未登入時發出受保護 API 請求
    // 傳入 user 讓打板計劃僅對 admin/staff 初始化
    if (typeof window.initProtectedSections === 'function') {
      window.initProtectedSections(user);
    }

    // 解鎖訂單系統
    const ordersLock = document.getElementById('nav-orders-lock');
    if (ordersLock) ordersLock.style.display = 'none';

    // 解鎖 Shipper Role Project（登入即可用）
    const xlsLock = document.getElementById('nav-xls-booking-lock');
    if (xlsLock) xlsLock.style.display = 'none';

    // 解鎖 ULD 智能裝箱（登入即可用）
    const uldProjectsLock = document.getElementById('nav-uld-projects-lock');
    if (uldProjectsLock) uldProjectsLock.style.display = 'none';

    // 解鎖 3D ULD 裝箱（登入即可用）
    const packingLock = document.getElementById('nav-packing-lock');
    if (packingLock) packingLock.style.display = 'none';

    // 打板計劃：僅限 admin / staff 解鎖；否則顯示鎖頭並攔截
    const palletLock = document.getElementById('nav-palletization-lock');
    const navPallet = document.getElementById('nav-palletization');
    const canPallet = user.role === 'admin' || user.role === 'staff';
    if (palletLock) palletLock.style.display = canPallet ? 'none' : '';
    if (navPallet) {
      if (!canPallet) {
        navPallet.classList.add('nav-item-locked');
        navPallet.addEventListener('click', (e) => {
          e.preventDefault();
          alert('打板計劃僅限內部員工使用');
        });
      }
    }

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

    // 登入後重新整理 Sidebar 排序（nav-users 顯示時需補上箭頭）
    if (typeof window.setupSidebarReorder === 'function') {
      window.setupSidebarReorder();
    }

    // 套用已儲存的登入卡背景圖
    loadSidebarBg();

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

    // 訂單系統 / Shipper Role Project / 資料庫 / 打板計劃 / 3D ULD 裝箱：顯示鎖頭，點擊導向登入頁
    ['nav-orders', 'nav-xls-booking', 'nav-dbviewer', 'nav-palletization', 'nav-packing'].forEach(id => {
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