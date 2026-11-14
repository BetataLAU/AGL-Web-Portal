// ===== 執 PLAN：DOM 小工具 =====

export function esc(value) {
  return String(value === null || value === undefined ? '' : value).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

export function $(selector, root = document) {
  return root.querySelector(selector);
}

export function $all(selector, root = document) {
  return [...root.querySelectorAll(selector)];
}

export function el(tag, className, html) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html !== undefined) node.innerHTML = html;
  return node;
}

// owner 顏色：同名永遠同色（hue 由字串 hash 決定）
export function ownerColor(name) {
  const text = String(name || '').trim().toUpperCase();
  if (!text) return 'hsl(215 12% 62%)';
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) % 360;
  return `hsl(${hash} 42% 46%)`;
}

export function debounce(fn, delay = 200) {
  let timer = null;
  return function debounced(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

let toastTimer = null;
export function toast(message, type = 'info') {
  let node = document.getElementById('lp-toast');
  if (!node) {
    node = el('div', 'lp-toast');
    node.id = 'lp-toast';
    document.body.appendChild(node);
  }
  node.textContent = message;
  node.dataset.type = type;
  node.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove('show'), 2600);
}
