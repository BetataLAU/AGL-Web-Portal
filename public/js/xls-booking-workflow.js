// ===== Shipper Role Project - XLS Booking 前端（執行工作流程） =====
// 從 xls-booking.js 拆出（.clinerule.md：檔案大小控制）
// 職責：啟動 job、輪詢進度、中止、結果呈現。


// ===== 執行（含進度條） =====
async function runXlsWorkflow() {
  if (!xlsState.uploadId || !xlsState.defs.length) {
    alert('請先上傳檔案並定義至少一個檔案的欄位');
    return;
  }
  // 檢查勾選：有勾選的列才會被執行
  const totalSelected = xlsState.defs.reduce(
    (n, d) => n + (xlsState.selections[d.fileIndex] ? xlsState.selections[d.fileIndex].selected.size : 0),
    0
  );
  if (totalSelected === 0) {
    alert('請先在「標準化結果預覽」勾選至少一行（有勾選的才會執行）');
    return;
  }
  const btn = document.getElementById('xls-run-btn');
  const status = document.getElementById('xls-status');
  if (btn) btn.disabled = true;
  if (status) status.textContent = '啟動中...';

  // 顯示進度區塊
  let progressArea = document.getElementById('xls-progress-area');
  if (!progressArea) {
    progressArea = document.createElement('div');
    progressArea.id = 'xls-progress-area';
    progressArea.className = 'xls-progress-area';
    const runRow = document.querySelector('.xls-run-row');
    if (runRow) runRow.after(progressArea);
  }
  progressArea.innerHTML = `
    <div class="xls-progress-label" id="xls-progress-label">排隊中...</div>
    <div class="xls-progress-track"><div class="xls-progress-fill" id="xls-progress-fill" style="width:0%"></div></div>
    <div class="xls-progress-pct" id="xls-progress-pct">0%</div>
    <div class="xls-progress-actions">
      <button type="button" class="pill btn-danger" id="xls-cancel-btn" onclick="xlsCancelJob()">⏹ 中止</button>
    </div>
  `;
  progressArea.style.display = 'block';

  try {
    // 將每個檔案的勾選狀態（selectedMawbs）+ CNEE 手動補值（cneeOverrides）帶入 defs
    const bodyDefs = xlsState.defs.map((d) => {
      const df = xlsState.files[d.fileIndex];
      return {
        ...d,
        selectedMawbs: xlsState.selections[d.fileIndex] ? Array.from(xlsState.selections[d.fileIndex].selected) : [],
        editedRows: df && df.previewEdited && df.lastPreview ? df.lastPreview.rows : undefined,
        cneeOverrides: xlsState.cneeOverrides[d.fileIndex] || {},
      };
    });
    // 記錄本次執行了哪些檔案（供完成後「下一個檔案」判斷）
    xlsState.lastRunFiles = bodyDefs.map((d) => d.fileIndex);
    // 啟動非同步 job
    const startRes = await apiFetch('/api/xls-booking/process', {
      method: 'POST',
      body: JSON.stringify({ uploadId: xlsState.uploadId, defs: bodyDefs }),
    });
    const jobId = startRes.jobId;
    xlsCurrentJobId = jobId;

    // 輪詢進度
    let finished = false;
    let jobResult = null;
    let cancelled = false;
    for (let attempt = 0; attempt < 1200 && !finished; attempt++) {
      await new Promise((r) => setTimeout(r, 500));
      const st = await apiFetch(`/api/xls-booking/status/${jobId}`);
      const fill = document.getElementById('xls-progress-fill');
      const label = document.getElementById('xls-progress-label');
      const pct = document.getElementById('xls-progress-pct');
      const p = Math.max(0, st.progress);
      if (fill) fill.style.width = `${p}%`;
      if (pct) pct.textContent = `${Math.round(p)}%`;
      if (label) label.textContent = st.message || '處理中...';

      if (st.status === 'done') { finished = true; jobResult = st.result; }
      if (st.status === 'error') {
        finished = true;
        throw new Error(st.error || '執行失敗');
      }
      if (st.status === 'cancelled') { finished = true; cancelled = true; }
    }

    if (cancelled) {
      if (status) status.textContent = '已中止';
      const fill = progressArea.querySelector('.xls-progress-fill');
      const label = progressArea.querySelector('.xls-progress-label');
      if (fill) { fill.style.width = '100%'; fill.style.background = '#f59e0b'; }
      if (label) label.textContent = '已中止';
      return;
    }
    if (!jobResult) throw new Error('處理逾時，請檢查伺服器');
    if (status) status.textContent = `完成：${jobResult.count} 份 PDF。` + (jobResult.errors.length ? ` 有 ${jobResult.errors.length} 個錯誤。` : '');
    renderResult(jobResult);
    // 完成後 3 秒自動隱藏進度條
    setTimeout(() => { progressArea.style.display = 'none'; }, 3000);
  } catch (err) {
    if (status) status.textContent = '執行失敗：' + err.message;
    progressArea.querySelector('.xls-progress-fill').style.width = '100%';
    progressArea.querySelector('.xls-progress-fill').style.background = '#dc2626';
    progressArea.querySelector('.xls-progress-label').textContent = '執行失敗：' + err.message;
  } finally {
    if (btn) btn.disabled = false;
    xlsCurrentJobId = null;
  }
}

// ===== 中止執行 =====
function xlsCancelJob() {
  if (!xlsCurrentJobId) return;
  const btn = document.getElementById('xls-cancel-btn');
  if (btn) { btn.disabled = true; btn.textContent = '正在中止...'; }
  apiFetch(`/api/xls-booking/cancel/${xlsCurrentJobId}`, { method: 'POST' })
    .then(() => {
      const label = document.getElementById('xls-progress-label');
      if (label) label.textContent = '已送出中止要求，處理完目前步驟後停止...';
    })
    .catch(() => {
      if (btn) { btn.disabled = false; btn.textContent = '⏹ 中止'; }
    });
}

function renderResult(res) {
  const panel = document.getElementById('xls-result-panel');
  if (!panel) return;
  let html = `<h4>執行結果</h4>`;
  if (res.errors && res.errors.length) {
    html += `<div class="xls-error">${res.errors.map((e) => xlsEscapeHtml(e)).join('<br>')}</div>`;
  }
  // 缺 CNEE 警告清單（不阻斷執行，SLI/ELI 的 CNEE 留空）
  if (res.warnings && res.warnings.length) {
    html += `<div class="xls-warning-box">⚠️ 有 <b>${res.warnings.length}</b> 筆 MAWB 缺 CNEE（已照常產生，但 SLI/ELI 的 CNEE 留空）。<br>請回到「③ 標準化結果預覽」點擊紅色 CNEE 格補值後再執行：`;
    html += `<ul class="xls-warning-list">${res.warnings.map((w) => `<li>${xlsEscapeHtml(w.mawb)}${w.dest ? `（DEST: ${xlsEscapeHtml(w.dest)}）` : ''}${w.remark ? ` REMARK: ${xlsEscapeHtml(w.remark)}` : ''} — ${xlsEscapeHtml(w.file)}</li>`).join('')}</ul>`;
    html += `</div>`;
  }
  // 重覆 MAWB 警告清單（不阻斷執行；保留重覆資料，僅提示人手判斷）
  if (res.duplicates && res.duplicates.length) {
    html += `<div class="xls-warning-box">⚠️ 偵測到 <b>${res.duplicates.length}</b> 筆 MAWB 出現重覆（已照常處理，不會自動刪除）。如非預期，請檢查來源檔／刪除重覆列後再執行：`;
    html += `<ul class="xls-warning-list">${res.duplicates.map((d) =>
      `<li><b>${xlsEscapeHtml(d.mawb)}</b>（出現 ${d.count} 次）${d.dest ? `DEST: ${xlsEscapeHtml(d.dest)}` : ''} — ${(d.files || []).map((f) => xlsEscapeHtml(f)).join('、')}</li>`
    ).join('')}</ul>`;
    html += `</div>`;
  }
  // 模板自動同步失敗通知（Report 仍可下載）
  if (res.syncWarning) {
    html += `<div class="xls-warning-box">${xlsEscapeHtml(res.syncWarning)}</div>`;
  }
  html += `<p>成功產生 ${res.count} 份 PDF（已合併 SLI + ELI）。</p>`;
  html += `<div class="xls-downloads">`;
  // report 下載
  const reportName = res.reportPath ? res.reportPath.split(/[\\/]/).pop() : '';
  if (reportName) {
    html += `<a class="pill btn-primary" href="/api/xls-booking/download/report/${res.jobId}/${encodeURIComponent(reportName)}" download>📊 下載 Report</a>`;
  }
  // zip 下載
  (res.zipPaths || []).forEach((z) => {
    html += `<a class="pill" href="/api/xls-booking/download/zip/${res.jobId}/${encodeURIComponent(z.name)}" download>📦 ${xlsEscapeHtml(z.name)}</a>`;
  });
  html += `</div>`;
  // 完成後快速操作：回 ① 上傳／跳到下一個未處理檔案
  html += `<div class="xls-result-nav">`;
  html += `<button type="button" class="pill" onclick="xlsScrollToStep('xls-step-1')">⬆ 回 ① 上傳／選檔</button>`;
  const nextIdx = xlsFindNextFileIndex();
  if (nextIdx >= 0 && xlsState.files[nextIdx]) {
    html += `<button type="button" class="pill btn-primary" onclick="xlsGoToNextFile(${nextIdx})">▶ 處理下一個檔案：${xlsEscapeHtml(xlsState.files[nextIdx].originalName)}</button>`;
  }
  html += `</div>`;
  if (res.fileResults && res.fileResults.length) {
    html += `<p class="xls-preview-note">${res.fileResults.map((r) => `${xlsEscapeHtml(r.file)}：${r.records} 筆`).join('；')}</p>`;
  }
  panel.innerHTML = html;
  panel.style.display = 'block';
  panel.scrollIntoView({ behavior: 'smooth' });
}

