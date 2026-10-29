// ===== 模擬裝板：主題色與顏色工具（2D / 3D 繪圖共用）=====
let themeCache = { key: '', colors: null };

// 讀取目前主題的 CSS 變數（切換 data-theme 時自動重讀）
export function loadsimThemeColors() {
  const key = document.documentElement.getAttribute('data-theme') || 'light';
  if (themeCache.key === key && themeCache.colors) return themeCache.colors;
  const cs = getComputedStyle(document.documentElement);
  const read = (name, fallback) => ((cs.getPropertyValue(name) || '').trim() || fallback);
  themeCache = {
    key,
    colors: {
      text: read('--text-main', '#0f172a'),
      muted: read('--text-muted', '#475569'),
      border: read('--border-color', 'rgba(148,163,184,0.35)'),
      surface: read('--card-bg', 'rgba(255,255,255,0.9)'),
      input: read('--input-bg', '#ffffff'),
      primary: read('--primary', '#2563eb')
    }
  };
  return themeCache.colors;
}

// #rgb / #rrggbb → { r, g, b }
export function loadsimParseHex(hex) {
  const value = String(hex || '').trim();
  if (!value.startsWith('#')) return null;
  const clean = value.length === 4
    ? '#' + value.slice(1).split('').map(ch => ch + ch).join('')
    : value;
  if (clean.length !== 7) return null;
  return {
    r: parseInt(clean.slice(1, 3), 16),
    g: parseInt(clean.slice(3, 5), 16),
    b: parseInt(clean.slice(5, 7), 16)
  };
}

// 轉成 rgba()（hex 以外的主題色字串原樣回傳）
export function loadsimRgba(hex, alpha) {
  const rgb = loadsimParseHex(hex);
  if (!rgb) return hex || `rgba(37,99,235,${alpha})`;
  return `rgba(${rgb.r},${rgb.g},${rgb.b},${alpha})`;
}

// 依光線方向調整明暗（factor > 1 變亮、< 1 變暗），用於 3D 面著色
export function loadsimShade(hex, factor, alpha = 1) {
  const rgb = loadsimParseHex(hex);
  if (!rgb) return loadsimRgba(hex, alpha);
  const clamp = v => Math.max(0, Math.min(255, Math.round(v)));
  return `rgba(${clamp(rgb.r * factor)},${clamp(rgb.g * factor)},${clamp(rgb.b * factor)},${alpha})`;
}
