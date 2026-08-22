/**
 * public/js/uld-packing/ui.js
 * DOM 渲染：左側專案目錄樹、ULD 卡片、貨物表格、客戶卡片、匯總列。
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  // ===== 左側目錄樹 =====
  /**
   * 渲染專案目錄樹
   * @param {Array} projects 專案列表（含 uld_count / item_count）
   * @param {Function} onSelectProject 點擊專案回呼 (projectId)
   * @param {Function} onSelectUld 點擊 ULD 回呼 (projectId, uldId)
   */
  function renderTree(projects, onSelectProject, onSelectUld) {
    const tree = $('project-tree');
    if (!projects || projects.length === 0) {
      tree.innerHTML = '<p class="up-tree-hint">尚無專案，點「新增專案」開始</p>';
      return;
    }

    const currentPid = window.UPState.getCurrentProjectId();
    tree.innerHTML = projects.map((p) => {
      const active = p.id === currentPid ? 'active' : '';
      const isOpen = p.id === currentPid ? 'open' : '';
      const uldRows = (p.ulds || []).map((u) => `
        <div class="up-tree-uld" data-pid="${p.id}" data-uid="${u.id}" title="${u.uld_type}">
          <span>📦 ${escapeHtml(u.label)}</span>
          <span class="uld-usage">${u.item_count || 0} 件</span>
        </div>`
      ).join('');
      return `
        <div class="up-tree-project ${active} ${isOpen}" data-pid="${p.id}">
          <div class="up-tree-project-head" data-action="toggle-project">
            <span class="up-tree-project-toggle"><i class="fa-solid fa-chevron-right"></i></span>
            <span class="up-tree-project-title">
              <b>✈️ ${escapeHtml(p.mawb || '(未命名)')}</b>
              <small>${escapeHtml(p.dest || '-')} · ${p.uld_count || 0} ULD · ${p.item_count || 0} 件</small>
            </span>
          </div>
          <div class="up-tree-ulds">${uldRows || '<div class="up-tree-uld"><span>（無 ULD）</span></div>'}</div>
        </div>`;
    }).join('');

    // 事件綁定：專案頭
    tree.querySelectorAll('.up-tree-project-head').forEach((head) => {
      head.addEventListener('click', () => {
        const pid = Number(head.closest('.up-tree-project').dataset.pid);
        onSelectProject(pid);
      });
    });
    // 事件綁定：ULD
    tree.querySelectorAll('.up-tree-uld').forEach((row) => {
      row.addEventListener('click', (e) => {
        e.stopPropagation();
        onSelectUld(Number(row.dataset.pid), Number(row.dataset.uid));
      });
    });
  }

  // ===== 匯總列 =====
  function renderSummary(project) {
    const items = project.items || [];
    const ulds = project.ulds || [];

    let grossKg = 0;
    let volWeightKg = 0;
    let cbm = 0;
    let itemPcs = 0;

    items.forEach((it) => {
      grossKg += it.weight_kg * it.pcs;
      volWeightKg += window.UPCalc.volumeWeightTotal(it.length_cm, it.width_cm, it.height_cm, it.pcs);
      cbm += window.UPCalc.cbmTotal(it.length_cm, it.width_cm, it.height_cm, it.pcs);
      itemPcs += it.pcs;
    });

    $('sum-gross').textContent = window.UPCalc.fmt(grossKg);
    $('sum-vw').textContent = window.UPCalc.fmt(volWeightKg);
    $('sum-cbm').textContent = window.UPCalc.fmt(cbm, 2);
    $('sum-ulds').textContent = ulds.length;
    $('sum-items').textContent = itemPcs;

    // 超限警示：任一 ULD 重量超限
    const anyOver = ulds.some((u) => {
      const load = items
        .filter((it) => it.assigned_uld_id === u.id)
        .reduce((s, it) => s + it.weight_kg * it.pcs, 0);
      return load > window.UPCalc.uldMaxWeight(u);
    });
    $('sum-alert').style.display = anyOver ? 'inline-block' : 'none';
  }

  // ===== ULD 卡片 =====
  function renderUlDs(project, callbacks) {
    const container = $('pv-ulds');
    const items = project.items || [];
    const ulds = project.ulds || [];

    if (ulds.length === 0) {
      container.innerHTML = '<p class="up-muted">此專案尚無 ULD，點「追加 ULD」。</p>';
      return;
    }

    container.innerHTML = ulds.map((u) => {
      const maxW = window.UPCalc.uldMaxWeight(u);
      const capCbm = window.UPCalc.uldCapacityCbm(u);
      const assigned = items.filter((it) => it.assigned_uld_id === u.id);
      const curW = assigned.reduce((s, it) => s + it.weight_kg * it.pcs, 0);
      const curVw = assigned.reduce((s, it) => s + window.UPCalc.volumeWeightTotal(it.length_cm, it.width_cm, it.height_cm, it.pcs), 0);
      const curCbm = assigned.reduce((s, it) => s + window.UPCalc.cbmTotal(it.length_cm, it.width_cm, it.height_cm, it.pcs), 0);

      // 重量利用率（取毛重與體積重較大者 → 收費重量）
      const chargeWeight = Math.max(curW, curVw);
      const wPct = maxW > 0 ? Math.min(100, (chargeWeight / maxW) * 100) : 0;
      const vPct = capCbm > 0 ? Math.min(100, (curCbm / capCbm) * 100) : 0;

      // 依目前單位模式顯示的主容量條
      const isVwMode = window.UPState.getUnitMode() === 'vw';
      const primaryPct = isVwMode ? wPct : vPct;
      const primaryLabel = isVwMode
        ? `${window.UPCalc.fmt(chargeWeight)} / ${window.UPCalc.fmt(maxW)} kg`
        : `${window.UPCalc.fmt(curCbm, 2)} / ${window.UPCalc.fmt(capCbm, 2)} CBM`;

      const barClass = primaryPct >= 100 ? 'danger' : primaryPct >= 85 ? 'warn' : '';
      const over = curW > maxW;

      return `
        <div class="up-uld-card ${over ? 'over' : ''}" data-uid="${u.id}">
          <div class="up-uld-card-head">
            <b>📦 ${escapeHtml(u.label)}</b>
            <span class="up-uld-card-type">${escapeHtml(u.uld_type)}</span>
          </div>
          <div class="capacity-bar"><div class="fill ${barClass}" style="width:${primaryPct}%"></div></div>
          <div class="capacity-label"><span>${escapeHtml(primaryLabel)}</span><span>${Math.round(primaryPct)}%</span></div>
          <div class="capacity-label up-muted">
            <span>體積重 ${window.UPCalc.fmt(curVw)} kg</span>
            <span>CBM ${window.UPCalc.fmt(curCbm, 2)}</span>
          </div>
          <div class="up-uld-card-actions">
            <button class="btn btn-xs" data-action="focus-uld">聚焦</button>
            <button class="btn btn-xs btn-danger" data-action="delete-uld">移除</button>
          </div>
        </div>`;
    }).join('');

    // 事件
    container.querySelectorAll('[data-action="focus-uld"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const uid = Number(btn.closest('.up-uld-card').dataset.uid);
        if (callbacks.onFocusUld) callbacks.onFocusUld(uid);
      });
    });
    container.querySelectorAll('[data-action="delete-uld"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const uid = Number(btn.closest('.up-uld-card').dataset.uid);
        if (callbacks.onDeleteUld) callbacks.onDeleteUld(uid);
      });
    });
  }

  // ===== 貨物表格 =====
  function renderItems(project, callbacks) {
    const tbody = $('pv-items-body');
    const items = project.items || [];
    const customersMap = {};
    (project.customers || []).forEach((c) => { customersMap[c.id] = c; });
    const uldsMap = {};
    (project.ulds || []).forEach((u) => { uldsMap[u.id] = u; });

    if (items.length === 0) {
      tbody.innerHTML = '<tr><td colspan="13" class="up-muted" style="text-align:center;padding:20px;">尚無貨物，點「新增貨物」。</td></tr>';
      return;
    }

    tbody.innerHTML = items.map((it) => {
      const cust = customersMap[it.customer_id] || {};
      const uld = uldsMap[it.assigned_uld_id] || null;
      const vw = window.UPCalc.volumeWeightTotal(it.length_cm, it.width_cm, it.height_cm, it.pcs);
      const cbm = window.UPCalc.cbmTotal(it.length_cm, it.width_cm, it.height_cm, it.pcs);
      const light = window.UPCalc.isLightBubble(it.length_cm, it.width_cm, it.height_cm, it.pcs, it.weight_kg);
      const typeCls = String(it.pack_type).toLowerCase() === 'plt' ? 'plt' : 'ctn';

      return `
        <tr data-item-id="${it.id}">
          <td><input type="checkbox" class="item-check" data-id="${it.id}"></td>
          <td><span class="cust-color-dot" style="background:${cust.color_code || '#94a3b8'}"></span>${escapeHtml(it.hawb || '-')}</td>
          <td>${escapeHtml(cust.customer_name || '-')}</td>
          <td><span class="pack-type-badge ${typeCls}">${escapeHtml(it.pack_type)}</span></td>
          <td>${it.length_cm}</td>
          <td>${it.width_cm}</td>
          <td>${it.height_cm}</td>
          <td>${it.pcs}</td>
          <td>${it.weight_kg}</td>
          <td>${window.UPCalc.fmt(vw)}${light ? '<span class="light-bubble">輕泡</span>' : ''}</td>
          <td>${window.UPCalc.fmt(cbm, 2)}</td>
          <td>${uld ? escapeHtml(uld.label) : '<span class="up-muted">待分配</span>'}</td>
          <td>
            <button class="btn btn-xs" data-action="move-item" title="轉移 ULD">
              <i class="fa-solid fa-arrows-left-right"></i>
            </button>
            <button class="btn btn-xs btn-danger" data-action="delete-item" title="刪除">
              <i class="fa-solid fa-trash"></i>
            </button>
          </td>
        </tr>`;
    }).join('');

    // 事件
    tbody.querySelectorAll('[data-action="move-item"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const itemId = Number(btn.closest('tr').dataset.itemId);
        if (callbacks.onMoveItem) callbacks.onMoveItem(itemId);
      });
    });
    tbody.querySelectorAll('[data-action="delete-item"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const itemId = Number(btn.closest('tr').dataset.itemId);
        if (callbacks.onDeleteItem) callbacks.onDeleteItem(itemId);
      });
    });
  }

  // ===== 客戶卡片 =====
  function renderCustomers(project) {
    const container = $('pv-customers');
    const customers = project.customers || [];

    if (customers.length === 0) {
      container.innerHTML = '<p class="up-muted">尚無客戶，點「新增客戶」。</p>';
      return;
    }

    container.innerHTML = customers.map((c) => `
      <div class="up-customer-card" style="border-left-color:${c.color_code || '#3498db'}">
        <h4><span class="cust-color-dot" style="background:${c.color_code || '#3498db'}"></span>${escapeHtml(c.customer_name)}</h4>
        <div class="hawb">HAWB: ${escapeHtml(c.hawb)}</div>
        <div class="color-code">${escapeHtml(c.color_code)}</div>
      </div>`).join('');
  }

  // ===== 工具 =====
  // 以 charCode 建構 HTML entity，避免編輯器格式化工具還原跳脫字元
  const AMP = String.fromCharCode(38);
  const LT = String.fromCharCode(60);
  const GT = String.fromCharCode(62);
  const QUOT = String.fromCharCode(34);
  const APOS = String.fromCharCode(39);

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(new RegExp(AMP, 'g'), AMP + 'amp;')
      .replace(new RegExp(LT, 'g'), LT + 't;')
      .replace(new RegExp(GT, 'g'), GT + 't;')
      .replace(new RegExp(QUOT, 'g'), QUOT + 'quot;')
      .replace(new RegExp(APOS, 'g'), APOS + '#39;');
  }

  // ===== 對外 =====
  window.UPUI = {
    renderTree,
    renderSummary,
    renderUlDs,
    renderItems,
    renderCustomers,
    escapeHtml,
  };
})();