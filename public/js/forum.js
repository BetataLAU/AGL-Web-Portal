// ===== 論壇頁：分類 + 主題 + 回覆 + SSE 即時推播 =====
let currentMessagesData = [];
let currentCategory = 'General';
let currentThreadId = null;
const categories = ['General', 'Announcements', 'Feedback'];

// 資料請求與渲染
async function fetchThreads(category = '') {
  const query = category ? `?category=${encodeURIComponent(category)}` : '';
  const res = await fetch(`/api/threads${query}`);
  const result = await res.json();
  currentMessagesData = result.data || [];

  renderThreadList(currentMessagesData);
  if (!currentThreadId && currentMessagesData.length) {
    loadThread(currentMessagesData[0].id);
  }
}

function renderThreadList(threads) {
  const listEl = document.getElementById('forum-thread-list');
  if (!listEl) return;

  if (!threads.length) {
    listEl.innerHTML = '<div class="empty-state">No topics yet in this category.</div>';
    return;
  }

  listEl.innerHTML = threads.map((thread, idx) => `
    <div class="forum-thread-card stagger-item" style="animation-delay: ${Math.min(idx * 45, 600)}ms" data-id="${thread.id}">
      <div class="forum-thread-title">${escapeHtml(thread.title)}</div>
      <div class="forum-thread-meta">
        <span>${escapeHtml(thread.category)}</span>
        <span>${escapeHtml(thread.user_name)}</span>
        <span>${formatLocalDateTime(thread.created_at)}</span>
      </div>
    </div>
  `).join('');

  listEl.querySelectorAll('.forum-thread-card').forEach(card => {
    card.addEventListener('click', () => {
      const id = card.dataset.id;
      if (id) loadThread(id);
    });
  });
}

async function loadThread(id) {
  currentThreadId = parseInt(id, 10);
  const res = await fetch(`/api/threads/${encodeURIComponent(currentThreadId)}`);
  if (!res.ok) {
    console.error('Failed to load thread', res.statusText);
    return;
  }
  const result = await res.json();
  renderThreadDetail(result.thread, result.replies || []);
}

function renderThreadDetail(thread, replies) {
  const detailEl = document.getElementById('forum-thread-detail');
  if (!detailEl) return;

  detailEl.innerHTML = `
    <div class="forum-detail-header">
      <div>
        <h3>${escapeHtml(thread.title)}</h3>
        <div class="forum-thread-meta">
          <span>${escapeHtml(thread.category)}</span>
          <span>by ${escapeHtml(thread.user_name)}</span>
          <span>${formatLocalDateTime(thread.created_at)}</span>
        </div>
      </div>
    </div>
    <div class="forum-detail-body">
      <p>${escapeHtml(thread.content)}</p>
    </div>
    <div class="forum-detail-replies">
      <h4>Replies</h4>
      ${replies.length ? replies.map(reply => `
        <div class="forum-reply-card">
          <div class="forum-reply-meta">
            <strong>${escapeHtml(reply.user_name)}</strong>
            <span>${formatLocalDateTime(reply.created_at)}</span>
          </div>
          <p>${escapeHtml(reply.content)}</p>
        </div>
      `).join('') : '<div class="empty-state">No replies yet. Be the first to reply.</div>'}
    </div>
    <div class="forum-reply-form">
      <h4>Reply to this thread</h4>
      <div class="form-group">
        <input type="text" id="reply-username" placeholder="Your Name" required />
      </div>
      <div class="form-group">
        <textarea id="reply-content" placeholder="Write your reply..." required></textarea>
      </div>
      <button type="button" id="reply-submit" class="btn-primary"><i class="fa-solid fa-reply"></i> Post Reply</button>
    </div>
  `;

  const replyBtn = document.getElementById('reply-submit');
  if (replyBtn) {
    replyBtn.addEventListener('click', async () => {
      const user_name = document.getElementById('reply-username').value.trim();
      const content = document.getElementById('reply-content').value.trim();
      if (!user_name || !content) return;

      const res = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_name, content, parent_id: currentThreadId })
      });

      if (res.ok) {
        document.getElementById('reply-username').value = '';
        document.getElementById('reply-content').value = '';
        loadThread(currentThreadId);
      }
    });
  }
}

// 版面設定
function setupForumSection() {
  const tabs = document.getElementById('forum-category-tabs');
  const categorySelect = document.getElementById('forum-category-select');
  const refreshBtn = document.getElementById('btn-forum-refresh');
  const threadForm = document.getElementById('forum-thread-form');

  if (tabs) {
    tabs.innerHTML = categories.map(category => `
      <button class="pill ${category === currentCategory ? 'active' : ''}" data-category="${escapeHtml(category)}">${escapeHtml(category)}</button>
    `).join('');
    tabs.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => {
        tabs.querySelectorAll('button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentCategory = btn.dataset.category;
        fetchThreads(currentCategory);
      });
    });
  }

  if (categorySelect) {
    categorySelect.innerHTML = categories.map(category => `
      <option value="${escapeHtml(category)}">${escapeHtml(category)}</option>
    `).join('');
  }

  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => fetchThreads(currentCategory));
  }

  if (threadForm) {
    threadForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const title = document.getElementById('thread-title').value.trim();
      const category = document.getElementById('forum-category-select').value;
      const content = document.getElementById('thread-content').value.trim();
      const user_name = document.getElementById('thread-username').value.trim();

      if (!title || !content || !user_name) return;

      const res = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_name, title, category, content })
      });

      if (res.ok) {
        document.getElementById('thread-title').value = '';
        document.getElementById('thread-content').value = '';
        document.getElementById('thread-username').value = '';
        fetchThreads(currentCategory);
      }
    });
  }
}

// SSE 即時推播
async function setupMessageStream() {
  if (typeof EventSource === 'undefined') return;
  const source = new EventSource('/api/messages/stream');

  source.addEventListener('messages_update', async (event) => {
    try {
      const payload = JSON.parse(event.data);
      if (payload.type === 'new_thread') {
        fetchThreads(currentCategory);
      } else if (payload.type === 'new_reply') {
        if (payload.thread_id && payload.thread_id === currentThreadId) {
          loadThread(currentThreadId);
        }
      } else if (payload.type === 'refresh') {
        fetchThreads(currentCategory);
        if (currentThreadId) loadThread(currentThreadId);
      }
    } catch (err) {
      console.error('SSE parse error:', err);
    }
  });

  source.addEventListener('error', () => {
    console.warn('Forum SSE connection lost.');
    source.close();
  });
}

// ISO 時間格式化
function formatLocalDateTime(isoString) {
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return isoString;
  return date.toLocaleString('zh-HK', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false
  });
}