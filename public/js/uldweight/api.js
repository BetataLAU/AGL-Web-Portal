// ===== ULD 夾重系統：API 呼叫層 =====
// 依賴 window.apiFetch（定義於 utils/api.js）

export async function fetchSheets(params = {}) {
  const query = new URLSearchParams();
  if (params.status) query.set('status', params.status);
  if (params.search) query.set('search', params.search);
  const qs = query.toString();
  const res = await apiFetch(`/api/uld-weight/sheets${qs ? '?' + qs : ''}`);
  return Array.isArray(res.data) ? res.data : [];
}

// 打板計劃的 Booking Record（夾重表「新增 MAWB」的候選清單）
// params：{ search, dest, limit }
export async function fetchBookings(params = {}) {
  const query = new URLSearchParams();
  const search = String(params.search || '').trim();
  const dest = String(params.dest || '').trim();
  if (search) query.set('search', search);
  if (dest) query.set('dest', dest);
  query.set('limit', String(params.limit || 50));
  const res = await apiFetch(`/api/uld-weight/bookings?${query.toString()}`);
  return res.data || [];
}

export async function createSheet(payload = {}) {
  const res = await apiFetch('/api/uld-weight/sheets', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
  return res.data;
}

export async function fetchSheet(id) {
  const res = await apiFetch(`/api/uld-weight/sheets/${id}`);
  return res.data;
}

export async function saveSheet(id, payload) {
  const res = await apiFetch(`/api/uld-weight/sheets/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload)
  });
  return res.data;
}

export async function deleteSheet(id) {
  const res = await apiFetch(`/api/uld-weight/sheets/${id}`, { method: 'DELETE' });
  return res;
}

export async function duplicateSheet(id) {
  const res = await apiFetch(`/api/uld-weight/sheets/${id}/duplicate`, {
    method: 'POST',
    body: JSON.stringify({})
  });
  return res.data;
}

export async function setSheetLocked(id, locked) {
  const res = await apiFetch(`/api/uld-weight/sheets/${id}/${locked ? 'lock' : 'unlock'}`, {
    method: 'POST',
    body: JSON.stringify({})
  });
  return res.data;
}

export async function importRclSheet(id, { file, sheet, columns } = {}) {
  const form = new FormData();
  if (file) form.append('file', file);
  if (sheet) form.append('sheet', sheet);
  if (columns) {
    Object.keys(columns).forEach(key => {
      const value = columns[key];
      if (value == null) return;
      form.append(`col_${key}`, String(value));
    });
  }
  const res = await apiFetch(`/api/uld-weight/sheets/${id}/import-rcl`, {
    method: 'POST',
    body: form
  });
  return res.data;
}

// ===== R1：下載 server 端正式 PDF（固定 A4 排版）=====
// 不能用 apiFetch（它固定解析 JSON）；這裡自行處理 401（跳登入頁）與錯誤訊息。
// 回傳 Blob（呼叫端負責觸發下載與釋放 object URL）。
async function fetchBlobOrThrow(url, fallbackMessage) {
  const res = await fetch(url, { cache: 'no-store' });
  if (res.status === 401) {
    window.location.href = './login.html';
    throw new Error('請先登入');
  }
  if (!res.ok) {
    let message = '';
    try {
      const data = await res.json();
      message = data && data.error ? data.error : '';
    } catch (e) { /* 非 JSON（例：500 HTML）→ 用狀態碼 */ }
    throw new Error(message || `${fallbackMessage}（HTTP ${res.status}）`);
  }
  return res.blob();
}

export async function fetchReportPdfBlob(id) {
  return fetchBlobOrThrow(`/api/uld-weight/sheets/${id}/report.pdf`, '下載 PDF 失敗');
}

// ===== V2：批次 PDF（多張夾重表打包 ZIP）=====
// ids 有值 → 只抓這幾張；ids 為空 → 交給後端依目前的 status／search 篩選（上限 50 張）。
export async function fetchBatchPdfBlob({ ids = [], status = '', search = '' } = {}) {
  const query = new URLSearchParams();
  if (Array.isArray(ids) && ids.length) query.set('ids', ids.join(','));
  if (status) query.set('status', status);
  if (search) query.set('search', search);
  return fetchBlobOrThrow(`/api/uld-weight/sheets/batch-pdf?${query.toString()}`, '下載批次 PDF 失敗');
}

// 回傳整個回應：{ data: { applied, skipped, conflicts }, sheet: <明細> }
export async function applySheet(id) {
  const res = await apiFetch(`/api/uld-weight/sheets/${id}/apply`, {
    method: 'POST',
    body: JSON.stringify({})
  });
  return res;
}

// ===== V3：版本清單／異動比對 =====
export async function fetchSheetVersions(id, { limit = 50 } = {}) {
  const query = new URLSearchParams();
  query.set('limit', String(Number(limit) || 50));
  const res = await apiFetch(`/api/uld-weight/sheets/${id}/versions?${query.toString()}`);
  return Array.isArray(res.data) ? res.data : [];
}

// fromId 必填；toId 省略（或 0）＝與「目前內容」比較
// 回傳 { data: <diff>, from: <版本>, to: <版本 or {id:0}> }
export async function fetchVersionDiff(id, { fromId, toId = 0 } = {}) {
  const query = new URLSearchParams();
  query.set('from', String(Number(fromId) || ''));
  if (Number(toId)) query.set('to', String(Number(toId)));
  const res = await apiFetch(`/api/uld-weight/sheets/${id}/versions/diff?${query.toString()}`);
  return { data: res.data, from: res.from, to: res.to };
}

// 預設 dryRun（後端只回預覽、不寫 DB）；要真的建立／連結才傳 { dryRun: false }。
// 回傳整個回應：{ data: { dry_run, created, linked, skipped, alreadyLinked }, sheet: <明細> }
export async function syncSheetBookings(id, { dryRun = true } = {}) {
  const res = await apiFetch(`/api/uld-weight/sheets/${id}/sync-bookings`, {
    method: 'POST',
    body: JSON.stringify({ dry_run: !!dryRun })
  });
  return res;
}
