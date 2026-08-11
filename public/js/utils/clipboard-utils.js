// ===== 通用剪貼簿工具 =====
// 手機瀏覽器透過內網 IP（非 HTTPS）訪問時屬於 non-secure context，
// navigator.clipboard 為 undefined，直接呼叫會拋 TypeError。
// 此函式優先使用 Clipboard API，失敗時 fallback 到隱藏 textarea + execCommand('copy')。

// 複製文字到剪貼簿；成功回傳 true，失敗回傳 false
function copyTextToClipboard(text) {
  // 1) Clipboard API（需 secure context，且 navigator.clipboard 存在）
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text).then(() => true).catch(() => fallbackCopy(text));
  }
  // 2) fallback：隱藏 textarea + execCommand（舊版 / 非 secure context）
  return Promise.resolve(fallbackCopy(text));
}

// fallback：建立暫時 textarea 選取後執行 copy 指令
function fallbackCopy(text) {
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    // 設定在畫面外（避免捲動跳動）
    textarea.style.position = 'fixed';
    textarea.style.top = '-9999px';
    textarea.style.left = '-9999px';
    textarea.style.opacity = '0';
    textarea.setAttribute('readonly', '');
    document.body.appendChild(textarea);
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    textarea.remove();
    return ok;
  } catch (err) {
    console.error('[copyTextToClipboard] fallback 複製失敗：', err);
    return false;
  }
}