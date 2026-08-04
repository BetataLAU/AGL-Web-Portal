// ===== CBM 計算機（通用浮動視窗） =====
// 用法：openCbmCalculator({ targetInput: document.getElementById('order-cbm') })
// 每行輸入 長(cm) × 寬(cm) × 高(cm) × 件數，Tab 加行，Enter 計算（按鈕在右下方）
function openCbmCalculator(options = {}) {
  const targetInput = options.targetInput || null;
  const onCommit = options.onCommit || null;
  // 移除舊的計算機
  document.querySelectorAll('.cbm-calculator-overlay').forEach(el => el.remove());

  const overlay = document.createElement('div');
  overlay.className = 'cbm-calculator-overlay';
  overlay.innerHTML = `
    <div class="cbm-calculator">
      <div class="cbm-calculator-header">
        <span>🧮 CBM 計算機</span>
        <button type="button" class="cbm-calculator-close" title="關閉">✕</button>
      </div>
      <div class="cbm-calculator-hint">每行輸入 長(cm) × 寬(cm) × 高(cm) × 件數，填完一行按 Tab 會新增一行；按 Enter 計算。</div>
      <div class="cbm-calculator-grid">
        <div class="cbm-calc-col-header">長 (cm)</div>
        <div class="cbm-calc-col-header">寬 (cm)</div>
        <div class="cbm-calc-col-header">高 (cm)</div>
        <div class="cbm-calc-col-header">件數</div>
        <div class="cbm-calc-row">
          <input type="number" class="cbm-calc-len" min="0" step="0.01" placeholder="長" />
          <input type="number" class="cbm-calc-width" min="0" step="0.01" placeholder="寬" />
          <input type="number" class="cbm-calc-height" min="0" step="0.01" placeholder="高" />
          <input type="number" class="cbm-calc-qty" min="1" step="1" placeholder="件數" />
        </div>
      </div>
      <div class="cbm-calculator-result">CBM 結果：<strong>—</strong></div>
      <div class="cbm-calculator-actions">
        <button type="button" class="cbm-calc-add-row">＋ 新增一行</button>
        <button type="button" class="cbm-calc-enter">Enter 計算</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.classList.add('visible');

  const grid = overlay.querySelector('.cbm-calculator-grid');
  const resultEl = overlay.querySelector('.cbm-calculator-result strong');
  const enterBtn = overlay.querySelector('.cbm-calc-enter');

  // 兩段式 Enter：第一次計算顯示結果，第二次填回並關閉
  let hasCalculated = false;

  // 將 CBM 結果填回目標 input 並關閉
  function commitResult() {
    const value = resultEl.textContent;
    if (targetInput && value && !isNaN(parseFloat(value))) {
      targetInput.value = parseFloat(value);
    }
    // 收集每個有完整數值的行
    if (onCommit) {
      const dims = [];
      grid.querySelectorAll('.cbm-calc-row').forEach(row => {
        const len = parseFloat(row.querySelector('.cbm-calc-len').value);
        const width = parseFloat(row.querySelector('.cbm-calc-width').value);
        const height = parseFloat(row.querySelector('.cbm-calc-height').value);
        const qty = parseFloat(row.querySelector('.cbm-calc-qty').value);
        if (!isNaN(len) && !isNaN(width) && !isNaN(height) && !isNaN(qty) && len > 0 && width > 0 && height > 0 && qty > 0) {
          dims.push({ len, width, height, qty });
        }
      });
      onCommit(dims);
    }
    overlay.remove();
  }

  // 兩段式處理共用邏輯：第一次計算 → 顯示結果；第二次 → 填回並關閉
  function handleQtyEnter() {
    if (hasCalculated) {
      commitResult();
      return;
    }
    calculate();
    // 計算成功（結果為有效數字）後標記，下次 Enter 即填回
    if (resultEl.textContent && !isNaN(parseFloat(resultEl.textContent))) {
      hasCalculated = true;
    }
  }

  function createRow() {
    const row = document.createElement('div');
    row.className = 'cbm-calc-row';
    row.innerHTML = `
      <input type="number" class="cbm-calc-len" min="0" step="0.01" placeholder="長" />
      <input type="number" class="cbm-calc-width" min="0" step="0.01" placeholder="寬" />
      <input type="number" class="cbm-calc-height" min="0" step="0.01" placeholder="高" />
      <input type="number" class="cbm-calc-qty" min="1" step="1" placeholder="件數" />
    `;
    grid.appendChild(row);
    bindRow(row);
    // 焦點移到新行第一個 input
    const first = row.querySelector('input');
    if (first) first.focus();
  }

  // 當一行 4 格全部填完時，按 Tab（在最後一格）即新增一行
  function bindRow(row) {
    const inputs = row.querySelectorAll('input');
    const len = inputs[0], width = inputs[1], height = inputs[2], qty = inputs[3];
    // 最後一格（件數）按 Tab → 若整行有值則新增一行
    qty.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        const allFilled = [len, width, height, qty].every(inp => inp.value !== '');
        if (allFilled) {
          e.preventDefault();
          createRow();
        }
      }
    });
    // 件數按 Enter → 兩段式：第一次計算、第二次填回並關閉
    qty.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        handleQtyEnter();
      }
    });
    // 其他 input 按 Enter → 跳到下一格
    [len, width, height].forEach(inp => {
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const next = inp.parentElement.querySelectorAll('input')[Array.from(inputs).indexOf(inp) + 1];
          if (next) next.focus();
        }
      });
    });
  }

  function calculate() {
    const rows = grid.querySelectorAll('.cbm-calc-row');
    let total = 0;
    let hasRow = false;
    rows.forEach(row => {
      const len = parseFloat(row.querySelector('.cbm-calc-len').value);
      const width = parseFloat(row.querySelector('.cbm-calc-width').value);
      const height = parseFloat(row.querySelector('.cbm-calc-height').value);
      const qty = parseFloat(row.querySelector('.cbm-calc-qty').value);
      if (!isNaN(len) && !isNaN(width) && !isNaN(height) && !isNaN(qty) && len > 0 && width > 0 && height > 0 && qty > 0) {
        total += len * width * height * qty;
        hasRow = true;
      }
    });
    if (!hasRow) {
      resultEl.textContent = '請輸入至少一行完整數值';
      return;
    }
    // 公式：(每行長×寬×高×件數 的總和) ÷ 1,000,000，四捨五入到小數後 2 位
    const cbm = Math.round(total / 1000000 * 100) / 100;
    resultEl.textContent = cbm;
  }

  // 綁定第一行
  const firstRow = grid.querySelector('.cbm-calc-row');
  bindRow(firstRow);

  // 新增一行按鈕
  overlay.querySelector('.cbm-calc-add-row').addEventListener('click', createRow);

  // Enter 計算按鈕（右下方）：無結果先計算；有結果即填回並關閉（一按即完成）
  enterBtn.addEventListener('click', () => {
    if (!hasCalculated) {
      calculate();
      if (!resultEl.textContent || isNaN(parseFloat(resultEl.textContent))) return;
    }
    commitResult();
  });

  // 關閉
  overlay.querySelector('.cbm-calculator-close').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  // 第一行第一個格獲焦
  setTimeout(() => {
    const first = grid.querySelector('.cbm-calc-row input');
    if (first) first.focus();
  }, 100);
}