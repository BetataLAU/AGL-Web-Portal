/**
 * public/js/packing/packing-main.js
 * 3D ULD Packing 頁面邏輯：ULD 載入、貨物編輯、API 求解、結果顯示、動畫控制。
 */
(function () {
  'use strict';

  // ===== 狀態 =====
  const state = {
    uldList: [],
    selectedUld: 'PMC',
    cargoList: [], // 從 modal 新增的貨物群組
    lastResult: null,
  };

  // ===== Fallback ULD 清單（API 失敗時仍可操作；API 成功會覆蓋） =====
  const FALLBACK_ULDS = [
    { code: 'PMC', name: 'Pallet PMC (B747F Main Deck)', l: 3160, w: 2438, h: 3000, geometryType: 'rectangular' },
    { code: 'PAG', name: 'Pallet PAG (B747F)', l: 3180, w: 2240, h: 3000, geometryType: 'rectangular' },
    { code: 'PAP', name: 'Pallet PAP (B747F)', l: 3180, w: 2240, h: 3000, geometryType: 'rectangular' },
    { code: 'P1P', name: 'Pallet P1P (90 x 125 in)', l: 3175, w: 2235, h: 3000, geometryType: 'rectangular' },
    { code: 'P6P', name: 'Pallet P6P (96 x 125 in)', l: 3175, w: 2438, h: 3000, geometryType: 'rectangular' },
    { code: 'AKE', name: 'Container AKE (LD3)', l: 1534, w: 2007, h: 1600, geometryType: 'extrudedProfile' },
    { code: 'AKH', name: 'Container AKH (LD3-46W)', l: 1534, w: 2174, h: 1829, geometryType: 'extrudedProfile' },
    { code: 'ALF', name: 'Container ALF (A-type Full)', l: 3175, w: 1534, h: 1626, geometryType: 'extrudedProfile' },
    { code: 'AMA', name: 'Container AMA (A-type Half)', l: 3175, w: 1534, h: 1638, geometryType: 'extrudedProfile' },
    { code: 'PMC-Q6', name: 'Pallet PMC + Q6 Contour (B747F)', l: 3160, w: 2438, h: 2690, geometryType: 'extrudedProfile' },
    { code: 'PMC-Q7', name: 'Pallet PMC + Q7 Contour (B777F)', l: 3160, w: 2438, h: 3048, geometryType: 'extrudedProfile' },
    { code: 'PAG-Q7', name: 'Pallet PAG + Q7 Contour', l: 3180, w: 2240, h: 3048, geometryType: 'extrudedProfile' },
    { code: 'Q7-00', name: 'Container Q7-00 (Contoured Main Deck ULD)', l: 3175, w: 2438, h: 2997, geometryType: 'extrudedProfile' },
  ];

  // ===== DOM 參考 =====
  const $ = (id) => document.getElementById(id);
  const el = {
    uldSelect: $('uld-select'),
    btnDemo: $('btn-demo'),
    btnAddCargo: $('btn-add-cargo'),
    btnSolve: $('btn-solve'),
    cargoList: $('cargo-list'),
    supportRatio: $('support-ratio'),
    summaryBox: $('summary-box'),
    unplacedBox: $('unplaced-box'),
    strategyBox: $('strategy-box'),
    threeContainer: $('three-container'),
    btnPlay: $('btn-play'),
    btnPause: $('btn-pause'),
    btnReset: $('btn-reset'),
    speedSelect: $('speed-select'),
    btn3dView: $('btn-3d-view'),
    btn2dView: $('btn-2d-view'),
    // Modal
    cargoModal: $('cargo-modal'),
    cargoTitle: $('cargo-modal-title'),
    cargoId: $('cargo-id'),
    cargoL: $('cargo-l'),
    cargoW: $('cargo-w'),
    cargoH: $('cargo-h'),
    cargoWeight: $('cargo-weight'),
    cargoQty: $('cargo-qty'),
    cargoStackable: $('cargo-stackable'),
    cargoUpright: $('cargo-upright'),
    cargoMaxStack: $('cargo-max-stack'),
    btnCancelCargo: $('btn-cancel-cargo'),
    btnSaveCargo: $('btn-save-cargo'),
  };

  // ===== 初始化 =====
  let viewer = null;

  async function init() {
    try {
      // 初始化 3D viewer
      viewer = new PackingViewer(el.threeContainer);
      window.showCargoInfo = showCargoInfo;

      // 載入 ULD 清單（apiFetch 會自動處理 401 → 跳登入頁）
      await loadUlds();

      // 綁定事件
      el.uldSelect.addEventListener('change', () => {
        state.selectedUld = el.uldSelect.value;
        renderPreview();
      });
      el.btnDemo.addEventListener('click', loadDemoCargo);
      el.btnAddCargo.addEventListener('click', () => openCargoModal());
      el.btnSaveCargo.addEventListener('click', saveCargo);
      el.btnCancelCargo.addEventListener('click', closeCargoModal);
      el.cargoModal.addEventListener('click', (e) => {
        if (e.target === el.cargoModal) closeCargoModal();
      });
      el.btnSolve.addEventListener('click', solve);
      el.btnPlay.addEventListener('click', () => {
        if (viewer) viewer.play(parseFloat(el.speedSelect.value));
      });
      el.btnPause.addEventListener('click', () => {
        if (viewer) {
          if (viewer.playState === 'playing') viewer.pause();
          else viewer.resume();
        }
      });
      el.btnReset.addEventListener('click', () => {
        if (viewer) {
          viewer.reset();
          if (state.lastResult) {
            renderPreview();
          }
        }
      });
      el.btn3dView.addEventListener('click', () => viewer && viewer.setView3D());
      el.btn2dView.addEventListener('click', () => viewer && viewer.setViewTop());

      // 預覽 ULD
      setSelectedUld(state.selectedUld);
      renderPreview();
    } catch (err) {
      console.error('init failed:', err);
      showToast(`初始化失敗：${err.message}`, 'error');
    }
  }

  // ===== ULD =====
  /** 用清單填入下拉選單 */
  function fillUldSelect(list) {
    el.uldSelect.innerHTML = '';
    if (!list || !list.length) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = '（無 ULD 資料）';
      el.uldSelect.appendChild(opt);
      return;
    }
    list.forEach((uld) => {
      const opt = document.createElement('option');
      opt.value = uld.code;
      opt.textContent = `${uld.code} — ${uld.name}`;
      el.uldSelect.appendChild(opt);
    });
    // 保持目前選擇
    if (list.some((u) => u.code === state.selectedUld)) {
      el.uldSelect.value = state.selectedUld;
    }
  }

  async function loadUlds() {
    // 先顯示 Fallback，確保下拉一定有選項
    state.uldList = FALLBACK_ULDS;
    fillUldSelect(FALLBACK_ULDS);
    renderPreview();

    // 再從 API 更新（若失敗保留 Fallback）
    try {
      const data = await apiFetch('/api/packing/ulds');
      const list = data.data || [];
      if (list.length) {
        state.uldList = list;
        fillUldSelect(list);
        renderPreview();
      }
    } catch (err) {
      console.warn('ULD API 更新失敗，使用內建清單:', err.message);
      showToast('ULD 清單載入失敗，使用內建清單', 'warn');
    }
  }

  function setSelectedUld(code) {
    el.uldSelect.value = code;
    state.selectedUld = code;
  }

  /** 預覽目前選擇的 ULD 線框 */
  function renderPreview() {
    if (!viewer || !state.uldList.length) return;
    const uld = state.uldList.find((u) => u.code === state.selectedUld);
    if (!uld) return;
    viewer.renderUld(uld);
    enablePlayControls(false);
  }

  // ===== 貨物編輯 =====
  function openCargoModal(editIndex) {
    el.cargoModal.style.display = 'flex';
    // 內部以 mm 儲存，表單以 cm 顯示（編輯時 ÷10 轉換）
    if (editIndex !== undefined) {
      const c = state.cargoList[editIndex];
      el.cargoTitle.textContent = '編輯貨物';
      el.cargoId.value = c.id;
      el.cargoL.value = (c.length_mm / 10).toFixed(1);
      el.cargoW.value = (c.width_mm / 10).toFixed(1);
      el.cargoH.value = (c.height_mm / 10).toFixed(1);
      el.cargoWeight.value = c.weight_kg;
      el.cargoQty.value = c.quantity;
      el.cargoStackable.checked = c.is_stackable !== false;
      el.cargoUpright.checked = c.must_stay_upright === true;
      el.cargoMaxStack.value = c.max_stack_weight || '';
      el.cargoId.dataset.editIndex = editIndex;
    } else {
      el.cargoTitle.textContent = '新增貨物';
      el.cargoId.value = `PKG-${String(state.cargoList.length + 1).padStart(3, '0')}`;
      el.cargoL.value = 50;
      el.cargoW.value = 40;
      el.cargoH.value = 30;
      el.cargoWeight.value = 20;
      el.cargoQty.value = 1;
      el.cargoStackable.checked = true;
      el.cargoUpright.checked = false;
      el.cargoMaxStack.value = '';
      delete el.cargoId.dataset.editIndex;
    }
  }

  function closeCargoModal() {
    el.cargoModal.style.display = 'none';
  }

  function saveCargo() {
    const editIndex = el.cargoId.dataset.editIndex;
    // 表單以 cm 輸入；內部/API 以 mm 儲存（×10 轉換）
    const l = Number(el.cargoL.value) * 10;
    const w = Number(el.cargoW.value) * 10;
    const h = Number(el.cargoH.value) * 10;
    const weight = Number(el.cargoWeight.value);
    const qty = Number(el.cargoQty.value);
    if (!(l > 0) || !(w > 0) || !(h > 0)) return showToast('尺寸必須為正數', 'error');
    if (!(weight > 0)) return showToast('重量必須為正數', 'error');
    if (!(qty >= 1 && Number.isInteger(qty))) return showToast('數量必須為正整數', 'error');

    const cargo = {
      id: el.cargoId.value || `PKG-${state.cargoList.length + 1}`,
      length_mm: l,
      width_mm: w,
      height_mm: h,
      weight_kg: weight,
      quantity: qty,
      is_stackable: el.cargoStackable.checked,
      must_stay_upright: el.cargoUpright.checked,
      max_stack_weight: el.cargoMaxStack.value ? Number(el.cargoMaxStack.value) : undefined,
    };

    if (editIndex !== undefined) {
      state.cargoList[editIndex] = cargo;
    } else {
      state.cargoList.push(cargo);
    }
    closeCargoModal();
    renderCargoList();
  }

  function removeCargo(index) {
    state.cargoList.splice(index, 1);
    renderCargoList();
  }

  function renderCargoList() {
    if (!state.cargoList.length) {
      el.cargoList.innerHTML = '<p class="hint" style="padding:4px 2px;">尚未加入貨物，請按「新增」或「載入示範」</p>';
      return;
    }
    el.cargoList.innerHTML = '';
    state.cargoList.forEach((c, i) => {
      const div = document.createElement('div');
      div.className = 'cargo-item';
      // 內部以 mm 儲存，顯示轉為 cm
      const lCm = (c.length_mm / 10).toFixed(1);
      const wCm = (c.width_mm / 10).toFixed(1);
      const hCm = (c.height_mm / 10).toFixed(1);
      div.innerHTML = `
        <div class="cargo-info">
          <div class="cargo-id">${escapeHtml(c.id)}</div>
          <div class="cargo-meta">${lCm}×${wCm}×${hCm}cm, ${c.weight_kg}kg × ${c.quantity}</div>
        </div>
        <div style="display:flex;gap:4px;">
          <button class="cargo-del" title="編輯"><i class="fa-solid fa-pen"></i></button>
          <button class="cargo-del" title="刪除"><i class="fa-solid fa-trash"></i></button>
        </div>
      `;
      div.querySelectorAll('button')[0].addEventListener('click', () => openCargoModal(i));
      div.querySelectorAll('button')[1].addEventListener('click', () => removeCargo(i));
      el.cargoList.appendChild(div);
    });
  }

  // ===== 示範資料（內部以 mm 儲存，長度值由 cm ×10） =====
  function loadDemoCargo() {
    state.cargoList = [
      { id: 'PKG-A', length_mm: 600, width_mm: 400, height_mm: 400, weight_kg: 45, quantity: 12, is_stackable: true },
      { id: 'PKG-B', length_mm: 800, width_mm: 500, height_mm: 350, weight_kg: 80, quantity: 8, is_stackable: true },
      { id: 'PKG-C', length_mm: 1200, width_mm: 800, height_mm: 600, weight_kg: 250, quantity: 4, is_stackable: false },
      { id: 'PKG-D', length_mm: 400, width_mm: 300, height_mm: 200, weight_kg: 15, quantity: 20, is_stackable: true, must_stay_upright: true },
      { id: 'PKG-E', length_mm: 1000, width_mm: 700, height_mm: 500, weight_kg: 180, quantity: 3, is_stackable: true, max_stack_weight: 400 },
    ];
    renderCargoList();
    showToast('已載入示範貨物', 'success');
  }

  // ===== 求解 =====
  async function solve() {
    if (!state.cargoList.length) {
      return showToast('請先加入貨物', 'error');
    }
    const uldSpec = {
      type: state.selectedUld,
      net_clearance_mm: 30,
    };
    const payload = {
      uld_spec: uldSpec,
      cargo_list: state.cargoList,
      options: {
        min_support_ratio: Number(el.supportRatio.value) || 0.7,
      },
    };

    el.btnSolve.disabled = true;
    el.btnSolve.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 求解中...';
    try {
      const data = await apiFetch('/api/packing/pack-uld', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      state.lastResult = data;
      renderResult(data);
    } catch (err) {
      console.error('solve failed:', err);
      showToast(`求解失敗：${err.message}`, 'error');
    } finally {
      el.btnSolve.disabled = false;
      el.btnSolve.innerHTML = '<i class="fa-solid fa-calculator"></i> 求解裝載計劃';
    }
  }

  // ===== 結果顯示 =====
  function renderResult(data) {
    renderSummary(data);
    renderUnplaced(data.unplaced || []);
    renderStrategies(data.strategies || []);

    // 渲染 3D：ULD + 貨物
    const uldInfo = data.uld.renderInfo || {
      l: data.uld.dimensionsMm.l,
      w: data.uld.dimensionsMm.w,
      h: data.uld.dimensionsMm.h,
      geometryType: data.uld.geometryType,
      code: data.uld.type,
      name: data.uld.name,
    };
    viewer.renderUld(uldInfo);
    if (data.sequence && data.sequence.length) {
      viewer.setSequence(data.sequence, {
        l: uldInfo.l,
        w: uldInfo.w,
        h: uldInfo.h,
      });
      enablePlayControls(true);
      // 自動播放
      viewer.play(parseFloat(el.speedSelect.value));
      showToast(`求解完成：${data.summary.placedCount}/${data.summary.totalItems} 件貨物已裝載`, 'success');
    } else {
      enablePlayControls(false);
      showToast('求解完成，但沒有貨物能放置', 'warn');
    }
  }

  function renderSummary(data) {
    const s = data.summary;
    el.summaryBox.innerHTML = '';
    const items = [
      ['ULD', `${data.uld.type} (${data.uld.name})`],
      ['裝載件數', `${s.placedCount} / ${s.totalItems}`],
      ['體積利用率', `${s.volumeUtilizationPct}%`],
      ['總重量', `${s.totalWeightKg} kg`],
      ['剩餘承重', `${s.remainingWeightKg} kg`],
      ['CoG (X/Y)', `(${(s.cog.xMm / 10).toFixed(1)}, ${(s.cog.yMm / 10).toFixed(1)}) cm ${s.cog.ok ? '✓' : '⚠️'}`],
      ['地面壓力', `${s.floorPressureKgM2} kg/m² ${s.floorPressureOk ? '✓' : '⚠️'}`],
      ['使用策略', data.strategyName || data.strategy],
      ['計算時間', `${data.elapsedMs} ms`],
    ];
    for (const [label, val] of items) {
      const div = document.createElement('div');
      div.className = 'summary-item';
      const isWarn = typeof val === 'string' && val.includes('⚠️');
      div.innerHTML = `<span class="label">${label}</span><span class="value ${isWarn ? 'warn' : 'ok'}">${val}</span>`;
      el.summaryBox.appendChild(div);
    }
    // 警告
    if (s.cog.warnings && s.cog.warnings.length) {
      s.cog.warnings.forEach((w) => {
        const warn = document.createElement('div');
        warn.className = 'unplaced-item';
        warn.style.marginTop = '6px';
        warn.innerHTML = `<span class="u-id">⚠️ CoG 警告</span><span>${w}</span>`;
        el.summaryBox.appendChild(warn);
      });
    }
  }

  function renderUnplaced(unplaced) {
    if (!unplaced.length) {
      el.unplacedBox.innerHTML = '<p class="hint">全部貨物已放置 ✓</p>';
      return;
    }
    el.unplacedBox.innerHTML = '';
    unplaced.forEach((u) => {
      const div = document.createElement('div');
      div.className = 'unplaced-item';
      div.innerHTML = `<span class="u-id">${escapeHtml(u.id)}</span><span>${escapeHtml(u.reason)}</span>`;
      el.unplacedBox.appendChild(div);
    });
  }

  function renderStrategies(strategies) {
    if (!strategies || !strategies.length) {
      el.strategyBox.innerHTML = '<p class="hint">無策略資料</p>';
      return;
    }
    el.strategyBox.innerHTML = '';
    strategies.forEach((st) => {
      const div = document.createElement('div');
      div.className = `strategy-item ${st.strategyKey === state.lastResult.strategy ? 'best' : ''}`;
      div.innerHTML = `<span>${escapeHtml(st.strategyName)}</span><span>${st.placedCount} 件 / ${st.volumeUtilization}%</span>`;
      el.strategyBox.appendChild(div);
    });
  }

  // ===== 3D 互動 =====
  function showCargoInfo(step) {
    const msg = [
      `📦 ${step.id}`,
      `尺寸：${(step.l / 10).toFixed(1)} × ${(step.w / 10).toFixed(1)} × ${(step.h / 10).toFixed(1)} cm`,
      `重量：${step.weightKg} kg`,
      `位置：(${Math.round(step.x)}, ${Math.round(step.y)}, ${Math.round(step.z)})`,
      `支撐率：${Math.round(step.supportRatio * 100)}%`,
      `方向：${step.orientation}`,
    ].join('\n');
    alert(msg);
  }

  function enablePlayControls(enabled) {
    el.btnPlay.disabled = !enabled;
    el.btnPause.disabled = !enabled;
    el.btnReset.disabled = !enabled;
  }

  // ===== 工具 =====
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = String(str ?? '');
    return div.innerHTML;
  }

  let toastTimer = null;
  function showToast(msg, type = 'info') {
    let toast = document.querySelector('.packing-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'packing-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.className = `packing-toast ${type}`;
    toast.style.display = 'block';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.style.display = 'none'; }, 3000);
  }

  // ===== 啟動 =====
  document.addEventListener('DOMContentLoaded', init);
})();