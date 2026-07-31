// ===== 動效 #1: 打字機效果 =====
function setupTypewriter() {
  const el = document.getElementById('typed-subtitle');
  if (!el) return;
  const text = el.getAttribute('data-text') || '';
  el.textContent = '';
  let index = 0;
  const speed = 55;
  function type() {
    if (index < text.length) {
      el.textContent += text.charAt(index);
      index++;
      setTimeout(type, speed);
    }
  }
  setTimeout(type, 600);
}

// ===== 動效 #5: 游標追蹤光暈 =====
function setupCardGlowTracking() {
  document.addEventListener('mousemove', (e) => {
    const cards = document.querySelectorAll('.card, .hero-header');
    cards.forEach(card => {
      const rect = card.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 100;
      const y = ((e.clientY - rect.top) / rect.height) * 100;
      card.style.setProperty('--mouse-x', `${x}%`);
      card.style.setProperty('--mouse-y', `${y}%`);
    });
  });
}

// ===== 動效 #6: 游標拖尾 =====
function setupCursorTrail() {
  const canvas = document.getElementById('cursor-trail-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let trails = [];
  let rafId = null;
  let lastMove = 0;
  const MAX_TRAILS = 24;

  function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  function addTrail(x, y) {
    const now = Date.now();
    if (now - lastMove < 14) return;
    lastMove = now;
    trails.push({ x, y, life: 1 });
    if (trails.length > MAX_TRAILS) trails.shift();
  }

  function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    trails.forEach((t, i) => {
      t.life -= 0.05;
      if (t.life <= 0) { trails.splice(i, 1); return; }
      const size = 10 * t.life;
      const hue = 220;
      ctx.beginPath();
      ctx.arc(t.x, t.y, size, 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${hue}, 85%, 65%, ${t.life * 0.5})`;
      ctx.shadowColor = `hsla(${hue}, 90%, 65%, ${t.life * 0.7})`;
      ctx.shadowBlur = 14;
      ctx.fill();
    });
    if (trails.length > 0) {
      rafId = requestAnimationFrame(animate);
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      rafId = null;
    }
  }

  document.addEventListener('mousemove', (e) => {
    addTrail(e.clientX, e.clientY);
    if (!rafId) rafId = requestAnimationFrame(animate);
  });
}

// ===== 動效 #8: 滾動進度條 =====
function setupScrollProgressBar() {
  const bar = document.getElementById('scroll-progress-bar');
  const scroller = document.querySelector('.app-layout');
  if (!bar || !scroller) return;

  function update() {
    const maxScroll = scroller.scrollHeight - scroller.clientHeight;
    const pct = maxScroll > 0 ? (scroller.scrollTop / maxScroll) * 100 : 0;
    bar.style.width = `${pct}%`;
  }
  scroller.addEventListener('scroll', () => requestAnimationFrame(update), { passive: true });
  window.addEventListener('resize', debounce(update, 150));
  update();
}

// ===== 動效 #7: 背景漂浮粒子 =====
function setupBackgroundParticles() {
  const canvas = document.getElementById('bg-particles-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let particles = [];
  const MIN_COUNT = 40;
  const MAX_COUNT = 70;

  function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    initParticles();
  }

  function initParticles() {
    const count = MIN_COUNT + Math.floor(Math.random() * (MAX_COUNT - MIN_COUNT));
    particles = Array.from({ length: count }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      r: 1.5 + Math.random() * 3,
      vx: (Math.random() - 0.5) * 0.35,
      vy: (Math.random() - 0.5) * 0.35,
      alpha: 0.25 + Math.random() * 0.5,
      pulse: Math.random() * Math.PI * 2,
      pulseSpeed: 0.01 + Math.random() * 0.03
    }));
  }

  function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles.forEach(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.pulse += p.pulseSpeed;
      if (p.x < -10) p.x = canvas.width + 10;
      if (p.x > canvas.width + 10) p.x = -10;
      if (p.y < -10) p.y = canvas.height + 10;
      if (p.y > canvas.height + 10) p.y = -10;
      const a = p.alpha * (0.7 + 0.3 * Math.sin(p.pulse));
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(99, 132, 235, ${a})`;
      ctx.fill();
    });
    // 微細連線
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const dx = particles[i].x - particles[j].x;
        const dy = particles[i].y - particles[j].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 110) {
          ctx.beginPath();
          ctx.moveTo(particles[i].x, particles[i].y);
          ctx.lineTo(particles[j].x, particles[j].y);
          ctx.strokeStyle = `rgba(99, 132, 235, ${(1 - dist / 110) * 0.16})`;
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }
    }
    requestAnimationFrame(animate);
  }

  resizeCanvas();
  window.addEventListener('resize', debounce(resizeCanvas, 200));
  animate();
}

// ===== 動效 #9: 技能條動畫 =====
function animateSkillBars() {
  document.querySelectorAll('.skill-item').forEach((item, index) => {
    const target = parseInt(item.dataset.level || '0', 10);
    const bar = item.querySelector('.progress');
    const numEl = item.querySelector('.skill-level-num');
    if (!bar) return;
    setTimeout(() => {
      let current = 0;
      const step = Math.max(1, Math.round(target / 60));
      bar.style.transition = 'width 1.1s cubic-bezier(0.22, 1, 0.36, 1)';
      const timer = setInterval(() => {
        current += step;
        if (current >= target) {
          current = target;
          clearInterval(timer);
        }
        bar.style.width = `${current}%`;
        if (numEl) numEl.textContent = `${current}%`;
      }, 18);
    }, 150 + index * 120);
  });
}

// ===== 動效 #10: 頁面切換轉場（由 main.js 的 showSection 觸發） =====
// 相關 CSS 在 animations.css 中定義

// ===== 動效 #11: 卡片交錯彈入（由 skills / contours / forum 渲染時加入 stagger-item + animation-delay） =====
// 相關 CSS 在 animations.css 中定義

// ===== 動效 #12: 機器人打字回覆 =====
const GEMINI_REPLIES = [
  "That's a great question! As a multimodal assistant, I can help with coding, analysis, and much more.",
  "Interesting! Let me note that — my core strengths include reasoning, context handling, and workflow automation.",
  "I understand. If you'd like, I can elaborate on my capabilities or walk you through my stack.",
  "Good point! Feel free to browse the Contour section to see my image-handling workflow in action.",
  "Noted! You can also create a topic in the Forum to continue this discussion with others.",
  "Absolutely — my skill set spans multimodal understanding, code debugging, and logical reasoning."
];

function typeBotReply(bubbleEl, text, chatBox) {
  bubbleEl.textContent = '';
  let index = 0;
  const speed = 18;
  function type() {
    if (index < text.length) {
      bubbleEl.textContent += text.charAt(index);
      index++;
      chatBox.scrollTop = chatBox.scrollHeight;
      setTimeout(type, speed);
    }
  }
  setTimeout(type, 250);
}

// ===== 既有：卡片滾動淡入 =====
function setupScrollAnimations() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
      }
    });
  }, { threshold: 0.15 });

  document.querySelectorAll('.card').forEach(el => {
    el.classList.add('fade-in-up');
    observer.observe(el);
  });
}

// ===== 既有：載入時卡片動畫 =====
function animateCardsOnLoad() {
  const cards = document.querySelectorAll('.card');
  cards.forEach((card, i) => {
    card.style.opacity = '0';
    card.style.transform = 'translateY(20px)';
    setTimeout(() => {
      card.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
      card.style.opacity = '1';
      card.style.transform = 'translateY(0)';
    }, 100 + i * 150);
  });
}