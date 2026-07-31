// ===== AI Playground：送出訊息 + 打字中指示 + 逐字回覆 =====
function setupChat() {
  const form = document.getElementById('chat-form');
  if (!form) return;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const input = document.getElementById('chat-input');
    if (!input) return;
    const val = input.value.trim();
    if (!val) return;
    const chatBox = document.getElementById('chat-box');
    if (chatBox) {
      const el = document.createElement('div');
      el.className = 'chat-message user';
      el.innerHTML = `<div class="avatar">You</div><div class="msg-bubble">${escapeHtml(val)}</div>`;
      chatBox.appendChild(el);

      // 打字中指示
      const typingEl = document.createElement('div');
      typingEl.className = 'chat-message bot';
      typingEl.innerHTML = `<div class="avatar">✨</div><div class="msg-bubble bot-typing"><span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span></div>`;
      chatBox.appendChild(typingEl);
      chatBox.scrollTop = chatBox.scrollHeight;

      // 模擬思考後回覆
      const replyText = GEMINI_REPLIES[Math.floor(Math.random() * GEMINI_REPLIES.length)];
      setTimeout(() => {
        typingEl.remove();
        const replyEl = document.createElement('div');
        replyEl.className = 'chat-message bot';
        const bubble = document.createElement('div');
        bubble.className = 'msg-bubble';
        replyEl.innerHTML = '<div class="avatar">✨</div>';
        replyEl.appendChild(bubble);
        chatBox.appendChild(replyEl);
        typeBotReply(bubble, replyText, chatBox);
      }, 900 + Math.random() * 600);
    }
    input.value = '';
  });
}