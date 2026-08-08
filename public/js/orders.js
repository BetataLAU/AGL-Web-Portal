// ===== 訂單系統入口（ES Module） =====
// 將初始化工作委派給 orders/formController.js 的 initOrderModule()
// 方案 1A：module 屬 defer，於 DOMContentLoaded 前執行完畢；
//          initOrderModule 掛載 window.setupOrdersSection，main.js 在 DOMContentLoaded 時呼叫它，無需修改 main.js

import { initOrderModule } from './orders/formController.js';

initOrderModule();