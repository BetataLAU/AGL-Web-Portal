// ===== 技能頁：獲取資料 + 渲染 + 篩選 =====
async function fetchSkills() {
  const res = await fetch('/api/skills');
  const result = await res.json();
  const container = document.getElementById('skills-list');

  container.innerHTML = result.data.map(skill => `
    <div class="skill-item" data-level="${skill.level}">
      <div class="skill-info">
        <span><strong>${skill.name}</strong> (${skill.category})</span>
        <span><span class="skill-level-num">0%</span></span>
      </div>
      <div class="progress-bar">
        <div class="progress" style="width: 0%"></div>
      </div>
    </div>
  `).join('');

  animateSkillBars();
}

function setupFilters() {
  const container = document.getElementById('skills-filter');
  if (!container) return;
  container.querySelectorAll('.pill').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.pill').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });
}