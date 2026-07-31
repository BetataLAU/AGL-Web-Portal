// ===== 主題切換 =====
function initTheme() {
  const savedTheme = localStorage.getItem('site-theme') || 'light';
  const savedColor = localStorage.getItem('site-theme-color') || '#0ea5e9';
  document.documentElement.setAttribute('data-theme', savedTheme);
  document.querySelectorAll('.theme-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === savedTheme);
  });

  const picker = document.getElementById('theme-color-picker-container');
  const colorInput = document.getElementById('theme-color-input');
  if (colorInput) colorInput.value = savedColor;
  toggleOceanPicker(savedTheme === 'ocean');
  if (savedTheme === 'ocean') {
    applyCustomOceanColor(savedColor);
  } else {
    clearCustomOceanColor();
  }
}

function setupThemeSwitcher() {
  const colorInput = document.getElementById('theme-color-input');
  const oceanButton = document.querySelector('.theme-btn[data-theme="ocean"]');

  document.querySelectorAll('.theme-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const theme = btn.dataset.theme;
      applyTheme(theme);
    });
  });

  if (colorInput) {
    colorInput.addEventListener('input', () => {
      applyTheme('ocean');
      const color = colorInput.value;
      localStorage.setItem('site-theme-color', color);
      applyCustomOceanColor(color);
      if (oceanButton) {
        document.querySelectorAll('.theme-btn').forEach(b => b.classList.remove('active'));
        oceanButton.classList.add('active');
      }
    });
  }
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('site-theme', theme);
  document.querySelectorAll('.theme-btn').forEach(b => b.classList.remove('active'));
  const activeButton = document.querySelector(`.theme-btn[data-theme="${theme}"]`);
  if (activeButton) activeButton.classList.add('active');
  toggleOceanPicker(theme === 'ocean');
  if (theme === 'ocean') {
    const savedColor = localStorage.getItem('site-theme-color') || '#0ea5e9';
    applyCustomOceanColor(savedColor);
  } else {
    clearCustomOceanColor();
  }
}

function toggleOceanPicker(show) {
  const picker = document.getElementById('theme-color-picker-container');
  if (!picker) return;
  picker.style.display = show ? 'flex' : 'none';
}

function applyCustomOceanColor(color) {
  const root = document.documentElement;
  const bright = adjustColor(color, 25);
  const faded = `rgba(${hexToRgb(color)}, 0.18)`;
  const soft = `rgba(${hexToRgb(color)}, 0.08)`;
  const border = adjustColor(color, 35);
  const backgroundColor = adjustColor(color, 80);
  const textColors = getTextColorsForBackground(backgroundColor);

  root.style.setProperty('--primary', color);
  root.style.setProperty('--primary-gradient', `linear-gradient(135deg, ${color}, ${bright})`);
  root.style.setProperty('--sidebar-bg', faded);
  root.style.setProperty('--card-bg', soft);
  root.style.setProperty('--border-color', border);
  root.style.setProperty('--bg-color', backgroundColor);
  root.style.setProperty('--text-main', textColors.main);
  root.style.setProperty('--text-muted', textColors.muted);
  root.style.setProperty('--input-bg', textColors.inputBg);
}

function clearCustomOceanColor() {
  const root = document.documentElement;
  root.style.removeProperty('--primary');
  root.style.removeProperty('--primary-gradient');
  root.style.removeProperty('--sidebar-bg');
  root.style.removeProperty('--card-bg');
  root.style.removeProperty('--border-color');
  root.style.removeProperty('--bg-color');
  root.style.removeProperty('--text-main');
  root.style.removeProperty('--text-muted');
  root.style.removeProperty('--input-bg');
}

function getTextColorsForBackground(bgHex) {
  const [r, g, b] = hexToRgbArray(bgHex);
  const luminance = getLuminance(r, g, b);
  const main = luminance > 0.65 ? '#0f172a' : '#f8fafc';
  const muted = luminance > 0.65 ? 'rgba(15, 23, 42, 0.72)' : 'rgba(248, 250, 252, 0.75)';
  const inputBg = luminance > 0.65 ? 'rgba(255, 255, 255, 0.92)' : 'rgba(15, 23, 42, 0.86)';
  return { main, muted, inputBg };
}

function getLuminance(r, g, b) {
  const a = [r, g, b].map(v => {
    const value = v / 255;
    return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
}

function hexToRgbArray(hex) {
  const normalized = hex.replace('#', '');
  const bigint = parseInt(normalized, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return [r, g, b];
}

function hexToRgb(hex) {
  const normalized = hex.replace('#', '');
  const bigint = parseInt(normalized, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `${r}, ${g}, ${b}`;
}

function adjustColor(hex, amount) {
  const normalized = hex.replace('#', '');
  const num = parseInt(normalized, 16);
  let r = (num >> 16) + amount;
  let g = ((num >> 8) & 0x00FF) + amount;
  let b = (num & 0x0000FF) + amount;
  r = Math.max(Math.min(255, r), 0);
  g = Math.max(Math.min(255, g), 0);
  b = Math.max(Math.min(255, b), 0);
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}