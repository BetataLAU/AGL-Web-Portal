// ===== 通用 API 封裝 =====
// 統一 fetch 呼叫，自動帶 JSON header、解析 JSON、拋出錯誤訊息
// cache: 'no-store' 防止瀏覽器（尤其手機）快取 GET 回應，確保永遠拿到最新資料
async function apiFetch(url, options = {}) {
  const res = await fetch(url, {
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  if (!res.ok) {
    let errorMsg = '請求失敗';
    try {
      const errData = await res.json();
      if (errData.error) errorMsg = errData.error;
    } catch (e) { /* ignore */ }
    throw new Error(errorMsg);
  }
  return res.json();
}