// ===== CBM DIM 預覽 =====
// escapeHtml 為 window 全域函式（main.js）
// formatCbmDimensions 由 ../formatters.js 提供

import { formatCbmDimensions } from '../formatters.js';
import { getCurrentCbmDimensions } from '../state.js';

export function renderCbmDimPreview() {
  const container = document.getElementById('cbm-dim-preview');
  if (!container) return;
  const currentCbmDimensions = getCurrentCbmDimensions();
  if (!currentCbmDimensions.length) {
    container.style.display = 'none';
    container.innerHTML = '';
    return;
  }
  container.style.display = 'block';
  container.innerHTML = `
    <div class="cbm-dim-box">
      <div class="cbm-dim-title">📐 尺寸明細（將加入訂單總結）</div>
      <pre>${escapeHtml(formatCbmDimensions(currentCbmDimensions))}</pre>
    </div>
  `;
}