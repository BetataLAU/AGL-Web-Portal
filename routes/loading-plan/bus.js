// ===== 執 PLAN：程序內事件匯流排（SSE 廣播用）=====
// 單一 Node process → 直接用 EventEmitter；未來多 instance 時只要把 publish/subscribe
// 換成「輪詢 loading_plan_events 的 id」即可（介面不變）。
const { EventEmitter } = require('events');

const bus = new EventEmitter();
bus.setMaxListeners(500);

// event 形狀：{ id, plan_id, action, payload, actor_user_id, actor_display, created_at }
function publish(event) {
  if (!event || !event.action) return;
  bus.emit('event', event);
}

function subscribe(listener) {
  bus.on('event', listener);
  return () => bus.off('event', listener);
}

module.exports = { publish, subscribe };
