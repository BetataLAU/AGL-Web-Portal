// ===== 自訂時間選擇器（通用元件） =====
// 用法：setupTimePicker({ input, clockBtn, popup })
// 提供：鍵盤上/下 ±15 分鐘並自動跨小時進位；🕐 彈出小時/分鐘兩欄（分鐘只有 00/15/30/45）
function setupTimePicker(options = {}) {
  const input = options.input;
  const clockBtn = options.clockBtn;
  const popup = options.popup;
  if (!input || !clockBtn || !popup) return;

  let hour = 0;
  let minute = 0;

  function parseTime() {
    const m = (input.value || '').match(/^(\d{1,2}):(\d{2})$/);
    hour = m ? Number(m[1]) : 0;
    minute = m ? Number(m[2]) : 0;
  }

  function writeTime() {
    input.value = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }

  // 分鐘 ±15，並自動跨小時進位（45 上→00 且小時+1；15 下→00 且小時-1）
  function adjustMinute(deltaMin) {
    parseTime();
    minute += deltaMin;
    if (minute >= 60) { minute -= 60; hour = (hour + 1) % 24; }
    if (minute < 0) { minute += 60; hour = (hour - 1 + 24) % 24; }
    writeTime();
  }

  function adjustHour(deltaH) {
    parseTime();
    hour = (hour + deltaH + 24) % 24;
    writeTime();
  }

  // === 鍵盤操作（模擬原生）：右→分鐘、左→小時、上/下增減 ===
  input.addEventListener('keydown', (e) => {
    const selStart = input.selectionStart ?? 0;
    const inMinute = selStart >= 2;

    if (e.key === 'ArrowRight') {
      e.preventDefault();
      input.setSelectionRange(3, 5);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      input.setSelectionRange(0, 2);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (inMinute) adjustMinute(15);
      else adjustHour(1);
      input.setSelectionRange(inMinute ? 3 : 0, inMinute ? 5 : 2);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (inMinute) adjustMinute(-15);
      else adjustHour(-1);
      input.setSelectionRange(inMinute ? 3 : 0, inMinute ? 5 : 2);
    }
  });

  input.addEventListener('focus', () => {
    // 初始游標放在小時段（由「提貨日期」TAB 過來時直接調整小時）
    input.setSelectionRange(0, 2);
  });

  // === 🕐 CLOCK 彈出 ===
  function renderPopup() {
    parseTime();
    const curHour = String(hour).padStart(2, '0');
    const curMin = String(minute).padStart(2, '0');
    const hours = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
    const minutes = ['00', '15', '30', '45'];

    const padOptions = (arr, cur) => arr.map(v =>
      `<div class="pickup-time-opt ${v === cur ? 'active' : ''}" data-val="${v}">${v}</div>`
    ).join('');

    popup.innerHTML = `
      <div class="pickup-time-col">
        <div class="pickup-time-col-title">小時</div>
        <div class="pickup-time-list">${padOptions(hours, curHour)}</div>
      </div>
      <div class="pickup-time-col">
        <div class="pickup-time-col-title">分鐘</div>
        <div class="pickup-time-list">${padOptions(minutes, curMin)}</div>
      </div>
      <div class="pickup-time-actions">
        <button type="button" class="pickup-time-done">確定</button>
      </div>
    `;
    popup.style.display = 'flex';

    // 滾動到選中項
    popup.querySelectorAll('.pickup-time-list').forEach(list => {
      const active = list.querySelector('.pickup-time-opt.active');
      if (active) active.scrollIntoView({ block: 'center' });
    });

    // 點選項即時更新（stopPropagation 防止 renderPopup 重建 DOM 後冒泡誤判為點擊外部而關閉）
    popup.querySelectorAll('.pickup-time-opt').forEach(opt => {
      opt.addEventListener('click', (e) => {
        e.stopPropagation();
        const colTitle = opt.closest('.pickup-time-col').querySelector('.pickup-time-col-title').textContent;
        const val = Number(opt.dataset.val);
        parseTime();
        if (colTitle === '小時') hour = val;
        else minute = val;
        writeTime();
        renderPopup();
      });
    });

    popup.querySelector('.pickup-time-done').addEventListener('click', (e) => {
      e.stopPropagation();
      popup.style.display = 'none';
    });
  }

  clockBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const visible = popup.style.display === 'flex';
    popup.style.display = visible ? 'none' : 'flex';
    if (popup.style.display === 'flex') renderPopup();
  });

  // 點擊外部關閉
  document.addEventListener('click', (e) => {
    const picker = input.closest('.pickup-time-picker');
    if (picker && !picker.contains(e.target)) popup.style.display = 'none';
  });
}