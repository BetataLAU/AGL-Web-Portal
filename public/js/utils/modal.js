// ===== 通用 Modal（浮動卡片） =====
// 用法：
//   const modal = openModal({
//     title: '標題',
//     body: '<div>內容...</div>',
//     actions: [
//       { label: '確定', className: 'pill btn-primary', onClick: (modal) => { ... } },
//       { label: '取消', className: 'pill' }
//     ],
//     className: 'custom-class'  // 可選：追加到卡片上的額外 class
//   });
// 回傳 { element, card, close }；不提供 onClick 的按鈕預設為關閉 modal
// 支援按 ESC 鍵關閉 modal
let activeEscHandler = null;

function openModal({ title = '', body = '', actions = [], className = '' } = {}) {
  // 移除舊的 modal 及其 ESC 監聽器
  document.querySelectorAll('.app-modal-overlay').forEach(el => el.remove());
  if (activeEscHandler) {
    document.removeEventListener('keydown', activeEscHandler);
    activeEscHandler = null;
  }

  const overlay = document.createElement('div');
  overlay.className = 'app-modal-overlay';

  const card = document.createElement('div');
  card.className = `app-modal${className ? ' ' + className : ''}`;

  // Header：標題 + 關閉按鈕
  const header = document.createElement('div');
  header.className = 'app-modal-header';
  const titleEl = document.createElement('span');
  titleEl.innerHTML = title;
  header.appendChild(titleEl);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'app-modal-close';
  closeBtn.title = '關閉';
  closeBtn.innerHTML = '✕';
  header.appendChild(closeBtn);

  // Body
  const bodyEl = document.createElement('div');
  bodyEl.className = 'app-modal-body';
  if (typeof body === 'string') bodyEl.innerHTML = body;
  else if (body instanceof Node) bodyEl.appendChild(body);

  card.appendChild(header);
  card.appendChild(bodyEl);

  // Actions
  const actionsEl = document.createElement('div');
  actionsEl.className = 'app-modal-actions';
  if (actions && actions.length) {
    const actionBtns = [];
    actions.forEach(action => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = action.className || 'pill';
      btn.innerHTML = action.label || '';
      btn.addEventListener('click', () => {
        if (action.onClick) action.onClick(modal, btn);
        else modal.close();
      });
      actionsEl.appendChild(btn);
      actionBtns.push(btn);
    });
    card.appendChild(actionsEl);
  }

  overlay.appendChild(card);

  // modal 物件（close 方法）
  const modal = {
    element: overlay,
    card,
    close: () => overlay.remove()
  };

  // 包裝 close：關閉時一併移除 ESC 監聽器
  const originalClose = modal.close;
  modal.close = () => {
    originalClose();
    if (activeEscHandler) {
      document.removeEventListener('keydown', activeEscHandler);
      activeEscHandler = null;
    }
  };

  // 按 ESC 關閉 modal
  const escHandler = (e) => {
    if (e.key === 'Escape' || e.key === 'Esc') modal.close();
  };
  activeEscHandler = escHandler;
  document.addEventListener('keydown', escHandler);

  // 關閉按鈕
  closeBtn.addEventListener('click', () => modal.close());

  // 點擊遮罩背景關閉
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) modal.close();
  });

  document.body.appendChild(overlay);
  // 下一幀才顯示，確保過渡動畫生效
  requestAnimationFrame(() => overlay.classList.add('visible'));

  return modal;
}