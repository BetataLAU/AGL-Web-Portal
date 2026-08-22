/**
 * public/js/uld-packing/solve-ui.js
 * 求解結果 UI 增強：方案存檔、套用方案（指派 ULD）、PDF 導出觸發、
 * 貨物表格拖拽換 ULD（3D 同步）。
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  // ===== 工具 =====
  function itemIdFromGroup(groupId) {
    // groupId 可能含 #k 後綴 → 取基數
    return Number(String(groupId).split('#')[0]);
  }

  function projectId() {
    const s = window.UPState;
    return s ? s.getCurrentProjectId() : null;
  }

  // ===== 存檔方案（寫入 solutions 表） =====
  async function saveCurrentSolution() {
    const result = window.UPSolveLastResult;
    const idx = window.UPSolveLastIndex !== undefined ? window.UPSolveLastIndex : 0;
    const pid = projectId();
    if (!result || !result.solutions || !result.solutions[idx]) {
      alert('尚無求解結果可存檔');
      return;
    }
    const sol = result.solutions[idx];

    try {
      const res = await window.apiFetch(`/api/packing/projects/${pid}/solutions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          solution_data: sol,
          utilization_rate: sol.stats.volumeUtilization,
          weight_utilization: sol.stats.weightUtilization,
          cog_x: sol.stats.cog.x,
          cog_y: sol.stats.cog.y,
          cog_z: sol.stats.cog.z,
        }),
      });
      alert(`✅ 方案已存檔（ID: ${res.id}）`);
    } catch (e) {
      alert(`存檔失敗：${e.message || e}`);
    }
  }

  // ===== 套用方案 → 批次指派 items.assigned_uld_id =====
  async function applySolution() {
    const result = window.UPSolveLastResult;
    const idx = window.UPSolveLastIndex !== undefined ? window.UPSolveLastIndex : 0;
    const pid = projectId();
    if (!result || !result.solutions || !result.solutions[idx]) {
      alert('尚無求解結果可套用');
      return;
    }
    const sol = result.solutions[idx];
    const items = sol.placedItems || [];
    if (items.length === 0) {
      alert('方案內無已放置貨物');
      return;
    }

    if (!confirm(`將方案中 ${items.length} 件貨物指派至對應 ULD？`)) return;

    let ok = 0;
    let fail = 0;
    for (const p of items) {
      const itemId = itemIdFromGroup(p.groupId || p.id);
      if (!itemId) continue;
      try {
        await window.apiFetch(`/api/packing/projects/${pid}/items/${itemId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ assigned_uld_id: p.uldId }),
        });
        ok++;
      } catch (e) {
        fail++;
      }
    }
    alert(`✅ 已指派 ${ok} 件貨物${fail > 0 ? `，失敗 ${fail} 件` : ''}`);
    if (window.UPProject && window.UD3D) {
      // 重新載入專案並刷新 3D
      const proj = await window.UPProject.getProject(pid);
      window.UPState.setCurrentProjectCache(proj);
      if (window.UD3D.refreshPreview) window.UD3D.refreshPreview();
    }
  }

  // ===== PDF 導出 =====
  function downloadPdf() {
    const result = window.UPSolveLastResult;
    const idx = window.UPSolveLastIndex !== undefined ? window.UPSolveLastIndex : 0;
    const pid = projectId();
    if (!result || !result.solutions || !result.solutions[idx]) {
      alert('尚無求解結果可導出');
      return;
    }
    // 觸發後端 PDF 生成（下載 blob）
    window.apiFetch(`/api/packing/projects/${pid}/export-pdf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ solution_index: idx, solution_data: result.solutions[idx] }),
    }).then(() => {
      // 由於 apiFetch 解析 JSON，改以 blob 下載需另建 fetch
      window.location.href = `/api/packing/projects/${pid}/export-pdf?index=${idx}`;
    }).catch((e) => alert(`導出失敗：${e.message || e}`));
  }

  // ===== 表格拖拽換 ULD（HTML5 draggable） =====
  let dragItemId = null;

  function initTableDrag() {
    const tbody = $('pv-items-body');
    if (!tbody) return;

    // 委派 dragover/drop：依「ULD 欄」文字判斷目標
    tbody.addEventListener('dragstart', (e) => {
      const row = e.target.closest('tr');
      if (!row) return;
      dragItemId = row.dataset.itemId;
      row.classList.add('dragging-row');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', dragItemId);
    });

    tbody.addEventListener('dragend', (e) => {
      const row = e.target.closest('tr');
      if (row) row.classList.remove('dragging-row');
      tbody.querySelectorAll('tr.drag-over').forEach((r) => r.classList.remove('drag-over'));
      dragItemId = null;
    });

    // 拖到 ULD 卡片（右側 ULD 清單分頁）
    const uldGrid = $('pv-ulds');
    if (uldGrid) {
      uldGrid.addEventListener('dragover', (e) => e.preventDefault());
      uldGrid.addEventListener('drop', async (e) => {
        e.preventDefault();
        const card = e.target.closest('.up-uld-card');
        const targetUldId = card ? Number(card.dataset.uid) : null;
        if (!dragItemId || !targetUldId) return;
        await reassignItem(Number(dragItemId), targetUldId);
      });
    }
  }

  // 表格列之間拖拽：改變 assigned_uld_id（目標列顯示的 ULD）
  async function reassignItem(itemId, targetUldId) {
    const pid = projectId();
    if (!pid) return;
    try {
      await window.apiFetch(`/api/packing/projects/${pid}/items/${itemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assigned_uld_id: targetUldId }),
      });
      // 重新整理專案並觸發外部 re-render
      const proj = await window.UPProject.getProject(pid);
      window.UPState.setCurrentProjectCache(proj);
      document.dispatchEvent(new CustomEvent('up-project-updated', { detail: { projectId: pid } }));
    } catch (e) {
      alert(`指派失敗：${e.message || e}`);
    }
  }

  // ===== 初始化增強的求解工具列 =====
  function initSolveUi() {
    // 在方案面板上方加工具列
    const panel = $('solve-panel');
    if (!panel) return;

    const toolbar = document.createElement('div');
    toolbar.className = 'up-items-toolbar';
    toolbar.style.marginBottom = '8px';
    toolbar.innerHTML = `
      <button class="btn btn-xs btn-success" id="btn-save-solution"><i class="fa-solid fa-floppy-disk"></i> 存檔方案</button>
      <button class="btn btn-xs" id="btn-apply-solution"><i class="fa-solid fa-check-double"></i> 套用指派</button>
      <button class="btn btn-xs" id="btn-export-pdf"><i class="fa-solid fa-file-pdf"></i> 匯出 PDF</button>
    `;
    panel.insertBefore(toolbar, panel.firstChild);

    $('btn-save-solution').addEventListener('click', saveCurrentSolution);
    $('btn-apply-solution').addEventListener('click', applySolution);
    $('btn-export-pdf').addEventListener('click', downloadPdf);

    initTableDrag();
  }

  // 監聽專案更新事件（re-render）
  document.addEventListener('up-project-updated', async () => {
    const pid = projectId();
    if (!pid) return;
    const proj = await window.UPProject.getProject(pid);
    window.UPState.setCurrentProjectCache(proj);
    // 重繪表格與 3D
    if (window.UD3D && window.UD3D.refreshPreview) window.UD3D.refreshPreview();
  });

  window.UPSolveUI = {
    init: initSolveUi,
    saveCurrentSolution,
    applySolution,
    downloadPdf,
  };
})();