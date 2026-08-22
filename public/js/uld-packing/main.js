/**
 * public/js/uld-packing/main.js
 * 主控模組：初始化、事件綁定、資料載入與重新整理。
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const esc = (s) => window.UPUI.escapeHtml(s);

  let uldTypeOptions = []; // 可用 ULD 類型（後端 API）

  // ===== 通用：載入並渲染 =====
  async function loadProjects() {
    const projects = await window.UPProject.listProjects();
    window.UPUI.renderTree(projects, onSelectProject, onSelectUld);
    return projects;
  }

  async function refreshCurrentProject() {
    const pid = window.UPState.getCurrentProjectId();
    if (!pid) return;
    const project = await window.UPProject.getProject(pid);
    window.UPState.setCurrentProjectCache(project);
    renderProject(project);

    // 同步更新左側樹（ULD 件數）
    await loadProjects();
  }

  function renderProject(project) {
    // 顯示詳情區
    $('up-empty').style.display = 'none';
    $('up-project-view').style.display = 'block';

    $('pv-title').textContent = `✈️ MAWB: ${project.mawb}`;
    $('pv-dest').textContent = project.dest;

    // 同步刷新 3D 視圖（無方案時僅顯示 ULD）
    // 以 try-catch 保護：3D 渲染失敗不影響 ULD/貨物/客戶清單與按鈕操作
    try {
      if (window.UD3D && window.UD3D.refreshPreview) {
        window.UD3D.refreshPreview();
      }
    } catch (e) {
      console.error('3D 視圖刷新失敗（不影響操作功能）:', e);
    }

    window.UPUI.renderSummary(project);
    window.UPUI.renderUlDs(project, {
      onFocusUld: () => { /* Phase D: 3D 聚焦 */ },
      onDeleteUld: async (uid) => {
        if (!confirm(`確定移除 ULD-${uid}？其下貨物將改為「待分配」。`)) return;
        await window.UPProject.deleteUld(project.id, uid);
        await refreshCurrentProject();
      },
    });
    window.UPUI.renderItems(project, {
      onMoveItem: () => openMoveItemModal(project),
      onDeleteItem: async (itemId) => {
        if (!confirm('確定刪除此貨物？')) return;
        await window.UPProject.deleteItem(project.id, itemId);
        await refreshCurrentProject();
      },
    });
    window.UPUI.renderCustomers(project);
  }

  // ===== 左側樹事件 =====
  async function onSelectProject(pid) {
    window.UPState.setCurrentProjectId(pid);
    window.UPState.setCurrentUldId(null);
    await refreshCurrentProject();
  }

  async function onSelectUld(pid, uid) {
    window.UPState.setCurrentProjectId(pid);
    window.UPState.setCurrentUldId(uid);
    await refreshCurrentProject();
  }

  // ===== Modal 工具 =====
  function openModal(id) { $(id).style.display = 'flex'; }
  function closeModal(id) { $(id).style.display = 'none'; }

  // ===== 新增專案 =====
  function initNewProjectModal() {
    const rows = $('np-uld-rows');
    if (!rows) return;
    const addRow = () => {
      const div = document.createElement('div');
      div.className = 'np-uld-row';
      // 無 ULD 類型資料時顯示「載入中…」選項；fetchUldTypes 完成後由 refreshUldOptions 更新
      const opts = uldTypeOptions.length > 0
        ? uldTypeOptions.map((u) => `<option value="${esc(u.code)}">${esc(u.code)} - ${esc(u.name)}</option>`).join('')
        : '<option value="">（載入中…）</option>';
      div.innerHTML = `
        <select class="np-uld-type">${opts}</select>
        <input type="number" class="np-uld-qty" value="1" min="1" max="50">
        <button class="btn btn-xs btn-danger np-uld-remove" title="移除列"><i class="fa-solid fa-xmark"></i></button>`;
      div.querySelector('.np-uld-remove').addEventListener('click', () => {
        if (rows.children.length > 1) div.remove();
      });
      rows.appendChild(div);
    };
    $('np-add-uld-row').addEventListener('click', addRow);
    addRow();

    $('btn-new-project').addEventListener('click', () => {
      $('np-mawb').value = '';
      $('np-dest').value = '';
      rows.innerHTML = '';
      addRow();
      openModal('modal-new-project');
    });
    $('np-cancel').addEventListener('click', () => closeModal('modal-new-project'));
    $('np-create').addEventListener('click', async () => {
      const mawb = $('np-mawb').value.trim();
      const dest = $('np-dest').value.trim();
      if (!mawb || !dest) { alert('請填寫 MAWB 與 DEST'); return; }

      const ulds = Array.from(rows.querySelectorAll('.np-uld-row')).map((row) => ({
        uld_type: row.querySelector('.np-uld-type').value,
        quantity: Number(row.querySelector('.np-uld-qty').value) || 1,
      }));

      try {
        const res = await window.UPProject.createProject({ mawb, dest, ulds });
        closeModal('modal-new-project');
        window.UPState.setCurrentProjectId(res.id);
        await loadProjects();
        await refreshCurrentProject();
      } catch (e) {
        alert(`建立失敗：${e.message || e}`);
      }
    });
  }

  // ===== 追加 ULD =====
  function initAddUldModal() {
    $('btn-add-uld').addEventListener('click', () => {
      const pid = window.UPState.getCurrentProjectId();
      if (!pid) return;
      openModal('modal-add-uld');
    });
    $('au-cancel').addEventListener('click', () => closeModal('modal-add-uld'));
    $('au-add').addEventListener('click', async () => {
      const pid = window.UPState.getCurrentProjectId();
      const type = $('au-type').value;
      const qty = Number($('au-qty').value) || 1;
      try {
        await window.UPProject.addUlDs(pid, type, qty);
        closeModal('modal-add-uld');
        await refreshCurrentProject();
      } catch (e) {
        alert(`追加失敗：${e.message || e}`);
      }
    });
  }

  // ===== 新增客戶 =====
  function initAddCustomerModal() {
    $('btn-add-customer').addEventListener('click', () => {
      const pid = window.UPState.getCurrentProjectId();
      if (!pid) return;
      $('ac-hawb').value = '';
      $('ac-name').value = '';
      openModal('modal-add-customer');
    });
    $('ac-cancel').addEventListener('click', () => closeModal('modal-add-customer'));
    $('ac-add').addEventListener('click', async () => {
      const pid = window.UPState.getCurrentProjectId();
      const hawb = $('ac-hawb').value.trim();
      const name = $('ac-name').value.trim();
      if (!hawb || !name) { alert('請填寫 HAWB 與客戶名稱'); return; }
      try {
        await window.UPProject.addCustomer(pid, hawb, name);
        closeModal('modal-add-customer');
        await refreshCurrentProject();
      } catch (e) {
        alert(`新增客戶失敗：${e.message || e}`);
      }
    });
  }

  // ===== 新增貨物 =====
  function initAddItemModal() {
    $('btn-add-item').addEventListener('click', () => {
      const project = window.UPState.getCurrentProjectCache();
      if (!project || project.customers.length === 0) {
        alert('請先新增客戶');
        return;
      }
      // 客戶下拉
      $('ai-customer').innerHTML = project.customers
        .map((c) => `<option value="${c.id}">${esc(c.hawb)} - ${esc(c.customer_name)}</option>`)
        .join('');
      // ULD 下拉
      const uldOpts = ['<option value="">待分配</option>']
        .concat(project.ulds.map((u) => `<option value="${u.id}">${esc(u.label)}</option>`));
      $('ai-uld').innerHTML = uldOpts.join('');
      openModal('modal-add-item');
    });
    $('ai-cancel').addEventListener('click', () => closeModal('modal-add-item'));
    $('ai-add').addEventListener('click', async () => {
      const pid = window.UPState.getCurrentProjectId();
      const payload = {
        customer_id: Number($('ai-customer').value),
        assigned_uld_id: $('ai-uld').value ? Number($('ai-uld').value) : null,
        pack_type: $('ai-pack-type').value,
        length_cm: Number($('ai-l').value),
        width_cm: Number($('ai-w').value),
        height_cm: Number($('ai-h').value),
        pcs: Number($('ai-pcs').value),
        weight_kg: Number($('ai-weight').value),
        is_stackable: $('ai-stackable').checked,
        actual_type: $('ai-actual').value.trim() || null,
      };
      try {
        await window.UPProject.addItem(pid, payload);
        closeModal('modal-add-item');
        await refreshCurrentProject();
      } catch (e) {
        alert(`新增貨物失敗：${e.message || e}`);
      }
    });
  }

  // ===== 轉移貨物 ULD（簡易版：一次選目標，套用所有勾選列） =====
  function openMoveItemModal(project) {
    let itemIds = [];
    const checked = document.querySelectorAll('.item-check:checked');
    if (checked.length > 0) {
      itemIds = Array.from(checked).map((cb) => Number(cb.dataset.id));
    } else {
      const summary = prompt('請輸入貨物 ID（或先勾選表格列的複選框）：');
      if (!summary) return;
      const item = project.items.find((i) => String(i.id) === summary.trim());
      if (!item) { alert('找不到此貨物 ID'); return; }
      itemIds = [item.id];
    }

    const target = uldOptionsPrompt(project);
    if (target === undefined) return;
    moveItemsToUld(project, itemIds, target);
  }

  function uldOptionsPrompt(project) {
    if (project.ulds.length === 0) {
      if (confirm('專案內尚無 ULD，要設為「待分配」嗎？')) return null;
      return undefined;
    }
    const options = project.ulds
      .map((u, i) => `${i + 1}. ${u.label} (${u.id})`)
      .concat(['0. 待分配'])
      .join('\n');
    const input = prompt(`選擇轉移目標 ULD：\n${options}\n\n（輸入編號）`);
    if (input === null) return undefined;
    const idx = Number(input);
    if (idx === 0) return null; // 待分配 = null
    const uld = project.ulds[idx - 1];
    return uld ? uld.id : undefined;
  }

  async function moveItemsToUld(project, itemIds, targetUldId) {
    for (const itemId of itemIds) {
      try {
        await window.UPProject.updateItem(project.id, itemId, { assigned_uld_id: targetUldId });
      } catch (e) {
        alert(`貨物 ${itemId} 轉移失敗：${e.message || e}`);
      }
    }
    await refreshCurrentProject();
  }

  // ===== 智能裝箱（GA-LNS 非同步求解） =====
  let solvePollTimer = null;
  let solving = false;
  let currentJobId = null;

  function initSmartSolve() {
    $('btn-smart-solve').addEventListener('click', startSolve);
    $('btn-solve-cancel').addEventListener('click', cancelSolve);
  }

  async function startSolve() {
    const pid = window.UPState.getCurrentProjectId();
    if (!pid || solving) return;
    const project = window.UPState.getCurrentProjectCache();
    if (!project || project.ulds.length === 0 || project.items.length === 0) {
      alert('專案需先有 ULD 與貨物才能智能裝箱');
      return;
    }

    solving = true;
    $('btn-smart-solve').disabled = true;
    $('solve-panel').style.display = 'block';
    $('solve-progress-fill').style.width = '0%';
    $('solve-progress-text').textContent = '開始求解...';
    $('btn-solve-cancel').style.display = 'inline-block';
    $('solve-solutions').innerHTML = '';

    try {
      const res = await window.apiFetch('/api/packing/solve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: pid, options: {} }),
      });
      currentJobId = res.jobId;
      pollSolve(currentJobId);
    } catch (e) {
      finishSolveError(`求解啟動失敗：${e.message || e}`);
    }
  }

  async function pollSolve(jobId) {
    try {
      const st = await window.apiFetch(`/api/packing/solve/${jobId}`);
      const pct = st.progress || 0;
      $('solve-progress-fill').style.width = `${pct}%`;
      $('solve-progress-text').textContent = `求解中 ${pct}%...`;

      if (st.status === 'completed') {
        renderSolutions(st.result);
      } else if (st.status === 'cancelled') {
        finishSolveError('已取消求解');
      } else if (st.status === 'failed') {
        finishSolveError(`求解失敗：${st.error || '未知錯誤'}`);
      } else {
        solvePollTimer = setTimeout(() => pollSolve(jobId), 600);
      }
    } catch (e) {
      finishSolveError(`查詢進度失敗：${e.message || e}`);
    }
  }

  async function cancelSolve() {
    if (!solving) return;
    if (solvePollTimer) clearTimeout(solvePollTimer);
    $('solve-progress-text').textContent = '取消中...';
    // 通知後端取消（若 job 還在執行）
    if (currentJobId) {
      try {
        await window.apiFetch(`/api/packing/solve/${currentJobId}/cancel`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (e) { /* 忽略取消 API 錯誤 */ }
    }
    setTimeout(() => finishSolveError('已取消求解'), 300);
  }

  function finishSolveError(msg) {
    if (solvePollTimer) clearTimeout(solvePollTimer);
    solving = false;
    currentJobId = null;
    $('btn-smart-solve').disabled = false;
    $('btn-solve-cancel').style.display = 'none';
    $('solve-progress-fill').style.width = '0%';
    $('solve-progress-text').textContent = msg;
  }

  function renderSolutions(result) {
    solving = false;
    currentJobId = null;
    $('btn-smart-solve').disabled = false;
    $('btn-solve-cancel').style.display = 'none';
    $('solve-progress-text').textContent = `完成！(${(result.elapsedMs / 1000).toFixed(1)}s)`;

    const solutions = result.solutions || [];
    const container = $('solve-solutions');
    if (solutions.length === 0) {
      container.innerHTML = '<p class="up-muted">無可行方案產生。</p>';
      return;
    }

    container.innerHTML = solutions.map((sol, idx) => {
      const s = sol.stats;
      const cogOk = Math.abs(s.cog.x) < 500 && Math.abs(s.cog.y) < 500;
      const floorOk = s.floorPressureOk;
      return `
        <div class="solve-solution-card ${idx === 0 ? 'selected' : ''}" data-sol-idx="${idx}">
          <h4>📋 方案 ${idx + 1}</h4>
          <div class="sol-metrics">
            <span>體積率 <b>${s.volumeUtilization}%</b></span>
            <span>載重率 <b>${s.weightUtilization}%</b></span>
            <span>放置 <b>${s.placedCount}</b>/${result.itemCount}</span>
            <span>總重 <b>${window.UPCalc.fmt(s.totalWeightKg)}</b>kg</span>
          </div>
          <div class="sol-badges">
            <span class="sol-badge ${floorOk ? 'ok' : 'warn'}">${floorOk ? '✔ 壓力 OK' : '⚠ 壓力超限'}</span>
            <span class="sol-badge ${cogOk ? 'ok' : 'warn'}">${cogOk ? '✔ 重心 OK' : '⚠ 重心偏移'}</span>
          </div>
        </div>`;
    }).join('');

    // 方案選擇事件
    container.querySelectorAll('.solve-solution-card').forEach((card) => {
      card.addEventListener('click', () => {
        container.querySelectorAll('.solve-solution-card').forEach((c) => c.classList.remove('selected'));
        card.classList.add('selected');
        const idx = Number(card.dataset.solIdx);
        // 將選中的方案傳給 3D viewer，立即切換 3D 場景
        window.UPSolveLastResult = result;
        window.UPSolveLastIndex = idx;
        if (window.UD3D && window.UD3D.refreshPreview) {
          window.UD3D.refreshPreview();
        }
      });
    });
  }

  // ===== 標籤頁切換 =====
  function initTabs() {
    document.querySelectorAll('.up-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.up-tab').forEach((t) => t.classList.remove('active'));
        document.querySelectorAll('.up-tab-pane').forEach((p) => p.classList.remove('active'));
        tab.classList.add('active');
        $(`tab-${tab.dataset.tab}`).classList.add('active');
      });
    });
  }

  // ===== 單位切換 =====
  function initUnitToggle() {
    $('btn-unit-toggle').addEventListener('click', () => {
      window.UPState.toggleUnitMode();
      $('unit-toggle-label').textContent = window.UPState.unitLabel();
      const project = window.UPState.getCurrentProjectCache();
      if (project) renderProject(project);
    });
    $('unit-toggle-label').textContent = window.UPState.unitLabel();
  }

  // ===== 刷新專案 Modal 的 ULD 類型選項（fetchUldTypes 完成後呼叫） =====
  function refreshUldOptions() {
    // 更新「新增專案」Modal 中所有列的下拉
    document.querySelectorAll('#np-uld-rows .np-uld-type').forEach((sel) => {
      const current = sel.value;
      sel.innerHTML = uldTypeOptions.length > 0
        ? uldTypeOptions.map((u) => `<option value="${esc(u.code)}">${esc(u.code)} - ${esc(u.name)}</option>`).join('')
        : '<option value="">（載入中…）</option>';
      // 盡量保留原選擇
      if (current && uldTypeOptions.some((u) => u.code === current)) sel.value = current;
    });
    // 更新「追加 ULD」Modal 的下拉
    const auType = $('au-type');
    if (auType) {
      auType.innerHTML = uldTypeOptions.length > 0
        ? uldTypeOptions.map((u) => `<option value="${esc(u.code)}">${esc(u.code)} - ${esc(u.name)}</option>`).join('')
        : '<option value="">（無可用 ULD 類型）</option>';
    }
  }

  // ===== 初始化 =====
  async function init() {
    // 1) 先同步綁定所有互動按鈕（不依賴 3D / API / await），
    //    確保「新增專案」「追加 ULD」「新增客戶」「新增貨物」「智能裝箱」「標籤頁」一定有反應。
    initTabs();
    initUnitToggle();
    initNewProjectModal();
    initAddUldModal();
    initAddCustomerModal();
    initAddItemModal();
    initSmartSolve();

    // 2) 初始化求解結果增強 UI（存檔/套用/PDF/表格拖拽）— 不依賴 3D
    try {
      if (window.UPSolveUI && window.UPSolveUI.init) {
        window.UPSolveUI.init();
      }
    } catch (e) {
      console.error('求解 UI 初始化失敗:', e);
    }

    // 3) 初始化 3D viewer（等待動態載入的 Three.js 依賴；失敗不影響按鈕操作）
    try {
      if (window.UD3D && window.UD3D.init) {
        const depsReady = window.__up3dDepsReady;
        if (depsReady && typeof depsReady.then === 'function') {
          // 等 CDN 依賴載入（成功或失敗）後再初始化 3D，避免初始化拋錯
          depsReady.then(() => {
            try {
              window.UD3D.init();
              // 若有已選專案，立即刷新 3D 視圖
              if (window.UPState && window.UPState.getCurrentProjectCache() && window.UD3D.refreshPreview) {
                window.UD3D.refreshPreview();
              }
            } catch (e) {
              console.error('3D viewer 初始化失敗（不影響操作功能）:', e);
            }
          });
        } else {
          window.UD3D.init();
        }
      }
    } catch (e) {
      console.error('3D viewer 初始化失敗（不影響操作功能）:', e);
    }

    // 4) 非同步載入 ULD 類型選單
    try {
      const types = await window.UPProject.fetchUldTypes();
      uldTypeOptions = Array.isArray(types) ? types : [];
      refreshUldOptions();
    } catch (e) {
      console.warn('載入 ULD 類型失敗:', e.message);
    }

    // 5) 載入專案列表（401 → 登入頁）
    try {
      await loadProjects();
    } catch (e) {
      if (e && e.status === 401) {
        location.href = 'login.html';
      } else {
        console.error('載入專案列表失敗:', e);
      }
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();