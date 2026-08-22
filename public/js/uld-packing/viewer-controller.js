/**
 * public/js/uld-packing/viewer-controller.js
 * 3D viewer 控制器：初始化、工具列事件、專案/方案渲染與圖例。
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  let viewer = null;
  let currentProject = null;
  let currentSolution = null;
  let lastFilter = null;

  let dragController = null;
  let dragEnabled = false;

  /** 初始化：建立 viewer 並綁定工具列事件 */
  function init() {
    if (!window.UldPackingViewer || !window.THREE) {
      console.warn('3D 依賴未就緒（Three.js 載入失敗或尚未完成），3D 視圖停用');
      return;
    }

    const container = $('up3d-container');
    if (!container) return;

    viewer = new window.UldPackingViewer(container);

    // 點擊貨物 → 顯示詳情
    viewer.onCargoClick = (data) => {
      const title = `📦 ${data.id}`;
      const detail = [
        `尺寸: ${(data.l / 10).toFixed(0)}×${(data.w / 10).toFixed(0)}×${(data.h / 10).toFixed(0)} cm`,
        `重量: ${data.weightKg} kg`,
        `客戶: C${data.customerId}`,
      ].join('\n');
      alert(`${title}\n${detail}`);
    };

    // 動畫步進指示
    viewer.onStepChange = (step) => {
      const total = (viewer.cargoMeshes || []).length;
      $('anim-step-indicator').textContent = `${Math.max(0, step)} / ${total}`;
    };

    // 視角按鈕（data-view）
    document.querySelectorAll('[data-view]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const v = btn.dataset.view;
        if (v === '3d') viewer.setView3D();
        else if (v === 'top') viewer.setViewTop();
        else if (v === 'side') viewer.setViewSide();
      });
    });

    // 爆炸 / 復位
    $('btn-explode').addEventListener('click', () => viewer.explode());
    $('btn-restore').addEventListener('click', () => viewer.restorePositions());

    // 透視濾鏡（data-filter）
    document.querySelectorAll('[data-filter]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const f = btn.dataset.filter;
        lastFilter = f === 'off' ? null : f;
        viewer.setFilter(lastFilter);
      });
    });

    // 動畫控制
    $('btn-anim-play').addEventListener('click', () => viewer.play());
    $('btn-anim-pause').addEventListener('click', () => viewer.pause());
    $('btn-anim-prev').addEventListener('click', () => viewer.stepBackward());
    $('btn-anim-next').addEventListener('click', () => viewer.stepForward());

    // 拖拽模式切換
    if (window.UldDragController) {
      dragController = new window.UldDragController(viewer, {
        onDragEnd: (item, bp, moved) => {
          if (!moved) return;
          // 更新目前方案中該貨物位置（記憶體，供後續確認存檔）
          const lastResult = window.UPSolveLastResult;
          const lastIdx = window.UPSolveLastIndex !== undefined ? window.UPSolveLastIndex : 0;
          if (lastResult && lastResult.solutions && lastResult.solutions[lastIdx]) {
            const target = lastResult.solutions[lastIdx].placedItems.find((p) => p.id === item.id);
            if (target) {
              target.x = bp.x;
              target.y = bp.y;
              target.z = bp.z;
            }
          }
          // 顯示已更新提示
          const progressText = document.getElementById('solve-progress-text');
          if (progressText) progressText.textContent = '已更新貨物位置（記憶體）';
        },
      });
      $('btn-drag-mode').addEventListener('click', () => {
        dragEnabled = !dragEnabled;
        dragController.setEnabled(dragEnabled);
        $('btn-drag-mode').classList.toggle('active', dragEnabled);
      });
    }

    // 初次渲染（若專案已選）
    refreshPreview();
  }

  /** 依目前專案 + 選定方案渲染 3D */
  function refreshPreview() {
    const project = window.UPState ? window.UPState.getCurrentProjectCache() : null;
    if (!project || !viewer) return;

    // 有求解結果時使用最後選定方案（僅限同一專案）
    const lastResult = window.UPSolveLastResult;
    const lastIdx = window.UPSolveLastIndex !== undefined ? window.UPSolveLastIndex : 0;
    const solution = lastResult && lastResult.projectId === project.id
                    && lastResult.solutions && lastResult.solutions[lastIdx]
      ? lastResult
      : null;

    // 需將專案 ULD 補齊尺寸資訊（contour_config）
    const normalizedUlDs = (project.ulds || []).map((u) => {
      const cfg = u.contour_config || {};
      return {
        ...u,
        l: cfg.baseL || 3175,
        w: cfg.baseW || 2438,
        h: cfg.maxHeightMm || 3000,
        contour_config: cfg,
      };
    });

    viewer.renderProject({ ...project, ulds: normalizedUlDs }, solution);
    currentProject = project;
    currentSolution = solution;

    updateLegend(project);
    $('anim-step-indicator').textContent = `0 / ${(viewer.cargoMeshes || []).length}`;
  }

  /** 更新客戶色卡圖例 */
  function updateLegend(project) {
    const legend = $('up3d-legend');
    if (!legend) return;
    const customers = project.customers || [];
    if (customers.length === 0) {
      legend.innerHTML = '';
      return;
    }
    legend.innerHTML = customers.map((c) => `
      <span><span class="legend-dot" style="background:${c.color_code || '#94a3b8'}"></span>${window.UPUI.escapeHtml(c.customer_name)}</span>
    `).join('');
  }

  window.UD3D = {
    init,
    refreshPreview,
  };
})();