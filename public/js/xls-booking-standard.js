// ===== Shipper Role Project - XLS Booking 前端（標準化結果預覽） =====
// 從 xls-booking.js 拆出（.clinerule.md：檔案大小控制）
// 職責：標準化資料載入/快取、勾選列、CNEE 手動補值。


// ===== 標準化預覽（前端簡易標準化，供使用者核對 + 勾選要執行的列） =====
// 標準化資料會快取（f._stdCache）；勾選切換時僅「同步重繪」，不再重新打 API，
// 避免每次 re-render 都有網路延遲，造成「勾選沒反應／連點兩下又跳回原狀」。

async function xlsEnsureStandardized(fileIndex) {
  const f = xlsState.files[fileIndex];
  if (!f) return null;
  const def = xlsState.defs.find((d) => d.fileIndex === fileIndex);
  if (!def) return null;

  const firstDataRow = def.firstDataRow || 2;
  const sheetIndex = def.sheetIndex || 0;
  const fieldMapKey = JSON.stringify(def.fieldMap || {});
  const cache = f._stdCache;
  if (cache && cache.firstDataRow === firstDataRow && cache.sheetIndex === sheetIndex && cache.fieldMapKey === fieldMapKey) {
    return cache;
  }

  // 以 ② 預覽「編輯後」的資料為準（雙擊修改／刪除 CNEE／增刪列等都會反映到 ③）；
  // 沒有開過預覽才向伺服器抓原檔。
  let rows;
  if (f.lastPreview) {
    rows = f.lastPreview.rows;
  } else {
    const res = await apiFetch(`/api/xls-booking/preview/${xlsState.uploadId}/${f.id}/${sheetIndex}`);
    rows = res.rows;
  }

  // 取得 CNEE 對照區比對結果（自動抽取 + DEST/REMARK 比對，後端為單一事實來源）。
  // 必須帶入 cneeOverrides，與 ④ 執行時看到的結果一致（否則 ③ 會顯示原檔 CNEE）。
  // editedRows 只在 ②「真正編輯過」才帶：若只是開過預覽就把整張表（最多 100 列 x 100 欄、
  // 且菜鳥/QR 檔含超長文字格）送回，body 會超過伺服器 JSON 上限而 413，導致 CNEE 全數誤判為缺。
  const cneeDef = {
    ...def,
    editedRows: f.previewEdited && f.lastPreview ? f.lastPreview.rows : undefined,
    cneeOverrides: xlsState.cneeOverrides[fileIndex] || {},
  };
  let cneeRes = null;
  let cneeError = '';
  try {
    cneeRes = await apiFetch('/api/xls-booking/cnee-preview', {
      method: 'POST',
      body: JSON.stringify({ uploadId: xlsState.uploadId, defs: [cneeDef] }),
    });
  } catch (err) {
    // 不靜默吞掉：留訊息給 ③ 顯示，避免「伺服器其實沒回傳」卻被當成「全部缺 CNEE」
    cneeError = (err && err.message) ? err.message : '網路錯誤';
  }
  const cneeInfo = cneeRes ? (cneeRes.results || []).find((r) => r.fileIndex === fileIndex) : undefined;
  const cneeMap = {};
  if (cneeInfo) {
    (cneeInfo.entries || []).forEach((e) => {
      if (e.mawb) cneeMap[xlsNormMawb(e.mawb)] = e.cnee || '';
    });
    f._cneeBlocks = cneeInfo.blocks || [];
  } else {
    f._cneeBlocks = [];
  }
  f._cneeWarning = cneeError ? `CNEE 比對暫時無法取得（${cneeError}）。若此檔「CNEE 名稱」欄位已指派，已先用該列值顯示；可點下方「重試 CNEE 比對」。` : '';

  const extract = (row, type) => {
    for (const [ci, t] of Object.entries(def.fieldMap)) {
      if (t === type) return row[Number(ci)];
    }
    return null;
  };

  // 動態欄位：所有已指派（非 ignore）的欄位類型，依 XLS_FIELD_TYPES 順序
  const assignedTypes = XLS_FIELD_TYPES.filter((t) => t.value !== 'ignore' && Object.values(def.fieldMap).includes(t.value));

  // 標準化列（僅包含有 MAWB 的列）
  const standardized = [];
  rows.slice(firstDataRow - 1).forEach((row) => {
    const mawb = extract(row, 'mawb');
    if (!mawb) return;
    const rec = { mawbKey: xlsNormMawb(mawb) };
    assignedTypes.forEach((t) => {
      rec[t.value] = xlsCellDisplay(extract(row, t.value));
    });
    // CNEE 顯示順序：1) 後端比對結果（含逐列 CNEE_NAME 直取） 2) 已指派「CNEE 名稱」欄的該列值（後端比對暫時失敗時仍正確）
    // 3) 前端手動補值（③ 點擊填入，最高優先，與 ④ 執行一致）
    const hasDirectCnee = assignedTypes.some((t) => t.value === 'cnee_name');
    rec.cnee = cneeMap[rec.mawbKey] || (hasDirectCnee ? (rec.cnee_name || '') : '');
    const over = (xlsState.cneeOverrides[fileIndex] || {})[rec.mawbKey];
    if (over) rec.cnee = over;
    standardized.push(rec);
  });

  // 校正勾選狀態：移除已不存在的 mawbKey、新出現的 MAWB 預設勾選。
  // （防止拖入新檔案／欄位定義變更後沿用上一輪的舊勾選，導致全選 checkbox「按不到」）
  const mawbKeys = standardized.map((r) => r.mawbKey);
  let sel = xlsState.selections[fileIndex];
  if (!sel) {
    xlsState.selections[fileIndex] = { all: mawbKeys, selected: new Set(mawbKeys) };
  } else {
    const valid = new Set(mawbKeys);
    sel.all = mawbKeys;
    for (const k of [...sel.selected]) {
      if (!valid.has(k)) sel.selected.delete(k);
    }
    mawbKeys.forEach((k) => { if (!sel.selected.has(k)) sel.selected.add(k); });
  }

  f._stdCache = { firstDataRow, sheetIndex, fieldMapKey, assignedTypes, standardized };
  return f._stdCache;
}

function xlsRenderStandardized(fileIndex) {
  const f = xlsState.files[fileIndex];
  if (!f || !f._stdCache) return;
  const { assignedTypes, standardized } = f._stdCache;

  // 勾選狀態：第一次建立時預設全選
  if (!xlsState.selections[fileIndex]) {
    xlsState.selections[fileIndex] = {
      all: standardized.map((r) => r.mawbKey),
      selected: new Set(standardized.map((r) => r.mawbKey)),
    };
  }
  const sel = xlsState.selections[fileIndex];
  const total = standardized.length;
  const selectedCount = standardized.filter((r) => sel.selected.has(r.mawbKey)).length;
  const allSelected = total > 0 && selectedCount === total;

  const panel = document.getElementById('xls-standardized-panel');
  if (!panel) return;
  // 重繪前記住表格捲動位置（避免勾選後跳回最上面）
  const prevWrap = panel.querySelector('.xls-standardized-table-wrap');
  const savedScroll = prevWrap ? { left: prevWrap.scrollLeft, top: prevWrap.scrollTop } : null;
  const otherTypes = assignedTypes.filter((t) => t.value !== 'mawb');
  const missingCnee = standardized.filter((r) => !r.cnee).length;
  const cneeHint = (f._cneeBlocks && f._cneeBlocks.length) ? '（CNEE 自動由下方對照區比對，點擊 CNEE 格可手動補值）' : '（點擊 CNEE 格可手動補值）';
  panel.innerHTML = `
    <h4>標準化結果預覽（${xlsEscapeHtml(f.originalName)}）</h4>
    <p class="xls-standardized-count">☑ 已勾選 <b>${selectedCount}</b> / ${total} 筆（有勾選的才會執行）${missingCnee ? ` &nbsp;🔴 <b>${missingCnee}</b> 筆缺 CNEE <button type="button" class="pill xls-jump-cnee" onclick="xlsJumpFirstMissingCnee(${fileIndex})">📍 跳至第一筆</button>` : ''}</p>
    <p class="xls-preview-note">${cneeHint}</p>
    ${f._cneeWarning ? `<div class="xls-warning-box">⚠️ ${xlsEscapeHtml(f._cneeWarning)}<br><button type="button" class="pill" onclick="xlsRetryStandardized(${fileIndex})">↻ 重試 CNEE 比對</button></div>` : ''}
    <div class="xls-standardized-table-wrap">
      <table class="xls-preview-table">
        <thead><tr>
          <th class="xls-check-col">
            <label title="全選 / 全部不選">
              <input type="checkbox" id="xls-select-all-${fileIndex}" ${allSelected ? 'checked' : ''} onchange="xlsToggleAll(${fileIndex})" />
            </label>
          </th>
          <th>MAWB#</th>
          <th class="xls-cnee-col">CNEE</th>
          ${otherTypes.map((t) => `<th>${xlsEscapeHtml(t.label)}</th>`).join('')}
        </tr></thead>
        <tbody>
          ${standardized.slice(0, 50).map((r) => {
            const isSel = sel.selected.has(r.mawbKey);
            // 已勾選（會執行）的列才提示：缺 MAWB#/CNEE/DEST/航班號 → 該格持續脈動
            const cneeMissing = !(r.cnee || '').trim();
            const mawbMissing = isSel && !(r.mawb || '').trim(); // 無 MAWB 的列不會進入標準化，通常不觸發
            const cellMissing = (t) => {
              if (!isSel || (t.value !== 'dest' && t.value !== 'flight')) return false;
              return !(r[t.value] || '').trim();
            };
            return `
            <tr>
              <td class="xls-check-col">
                <label title="選擇此列">
                  <input type="checkbox" data-mawb="${xlsEscapeHtml(r.mawbKey)}" ${isSel ? 'checked' : ''} onchange="xlsToggleRow(${fileIndex}, '${xlsEscapeHtml(r.mawbKey)}')" />
                </label>
              </td>
              <td${mawbMissing ? ' class="xls-required-missing" title="🔴 缺少 MAWB#（此列已勾選，執行時將被略過）"' : ''}>${xlsEscapeHtml(r.mawb || '')}</td>
              <td class="xls-cnee-cell${cneeMissing ? ' xls-cnee-missing' : ''}${isSel && cneeMissing ? ' xls-missing-pulse' : ''}" title="${r.cnee ? '點擊編輯 CNEE' : '🔴 無 CNEE — 點擊填入'}" onclick="xlsEditCnee(event, ${fileIndex}, '${xlsEscapeHtml(r.mawbKey)}')">
                ${r.cnee ? xlsEscapeHtml(r.cnee.length > 30 ? r.cnee.slice(0, 30) + '…' : r.cnee) : '🔴 無 CNEE（點擊填入）'}
              </td>
              ${otherTypes.map((t) => `<td${cellMissing(t) ? ` class="xls-required-missing" title="🔴 缺少 ${t.label}（此列已勾選，執行時此欄會留空）"` : ''}>${xlsEscapeHtml(r[t.value] || '')}</td>`).join('')}
            </tr>
          `;
          }).join('')}
        </tbody>
      </table>
    </div>
    ${total > 50 ? `<p class="xls-preview-note">僅顯示前 50 筆，共 ${total} 筆（勾選範圍涵蓋全部 ${total} 筆）。</p>` : ''}
  `;
  // 還原表格捲動位置
  if (savedScroll) {
    const newWrap = panel.querySelector('.xls-standardized-table-wrap');
    if (newWrap) {
      newWrap.scrollLeft = savedScroll.left;
      newWrap.scrollTop = savedScroll.top;
    }
  }
  panel.style.display = 'block';
}

// 載入標準化資料（首次或欄位定義／資料列變更時）後重繪
async function renderStandardizedPreview(fileIndex) {
  const data = await xlsEnsureStandardized(fileIndex);
  if (!data) return;
  xlsRenderStandardized(fileIndex);
}

// ===== 標準化預覽：CNEE 比對失敗後的手動重試（清快取強制重新向後端抓） =====
function xlsRetryStandardized(fileIndex) {
  const f = xlsState.files[fileIndex];
  if (f) {
    f._stdCache = null;
    f._cneeWarning = '';
  }
  renderStandardizedPreview(fileIndex);
}

// ===== 標準化預覽：勾選 / 取消勾選單一列 =====
function xlsToggleRow(fileIndex, mawbKey) {
  const sel = xlsState.selections[fileIndex];
  if (!sel) return;
  if (sel.selected.has(mawbKey)) sel.selected.delete(mawbKey);
  else sel.selected.add(mawbKey);
  xlsRenderStandardized(fileIndex); // 同步重繪，即時反應
}

// ===== 標準化預覽：全選 / 全部不選（頂部 checkbox） =====
function xlsToggleAll(fileIndex) {
  const sel = xlsState.selections[fileIndex];
  if (!sel) return;
  const allChecked = sel.all.length > 0 && sel.all.every((k) => sel.selected.has(k));
  if (allChecked) {
    sel.selected.clear();
  } else {
    sel.all.forEach((k) => sel.selected.add(k));
  }
  xlsRenderStandardized(fileIndex); // 同步重繪，即時反應
}

// ===== 標準化預覽：跳至第一筆缺 CNEE（捲動到該列 + 短暫高亮） =====
function xlsJumpFirstMissingCnee(fileIndex) {
  const panel = document.getElementById('xls-standardized-panel');
  if (!panel) return;
  const cell = panel.querySelector('.xls-cnee-cell.xls-cnee-missing');
  if (!cell) return;
  cell.scrollIntoView({ behavior: 'smooth', block: 'center' });
  cell.classList.add('xls-cnee-flash');
  setTimeout(() => cell.classList.remove('xls-cnee-flash'), 1400);
}

// ===== 標準化預覽：點擊 CNEE 格補值（存為 overrides，不需重新上傳） =====
function xlsEditCnee(ev, fileIndex, mawbKey) {
  const f = xlsState.files[fileIndex];
  if (!f || !f._stdCache) return;
  const cell = ev.currentTarget;
  if (!cell || cell.querySelector('textarea')) return;
  const rec = f._stdCache.standardized.find((r) => r.mawbKey === mawbKey);
  if (!rec) return;
  const oldVal = rec.cnee || '';
  cell.innerHTML = `<textarea class="xls-cnee-input" rows="4" placeholder="輸入 CNEE 名稱／地址（可多行）">${xlsEscapeHtml(oldVal)}</textarea>`;
  const ta = cell.querySelector('textarea');
  ta.focus();
  ta.select();
  let done = false;
  const commit = () => {
    if (done) return;
    done = true;
    const newVal = ta.value.trim();
    if (!xlsState.cneeOverrides[fileIndex]) xlsState.cneeOverrides[fileIndex] = {};
    if (newVal === '') {
      delete xlsState.cneeOverrides[fileIndex][mawbKey];
    } else {
      xlsState.cneeOverrides[fileIndex][mawbKey] = newVal;
    }
    rec.cnee = newVal;
    xlsRenderStandardized(fileIndex);
  };
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { done = true; xlsRenderStandardized(fileIndex); }
    else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); commit(); }
  });
  ta.addEventListener('blur', commit);
  ta.addEventListener('click', (e) => e.stopPropagation());
}

