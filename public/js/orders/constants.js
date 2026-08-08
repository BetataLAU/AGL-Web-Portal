// ===== 訂單系統常數（純常數，無依賴） =====
// 從原 orders.js 抽出的所有常數物件與標籤

export const CATEGORY_LABEL = {
  customer: '客戶公司',
  warehouse: '倉庫/自家地點',
  transport: '運輸公司'
};

export const ORDER_TYPE_LABEL = { delivery: '🚚 送貨', pickup: '📥 收貨' };
export const STATUS_LABEL = { pending: '待處理', in_progress: '進行中', completed: '已完成', cancelled: '已取消' };
export const POWER_TYPE_LABEL = { no: '⚡ 無電', dry: '🔋 乾電', lithium: '🔋 鋰電' };

// 「後補電池資訊」標記（提交時未選擇電池類型的訂單）
export const POWER_LATE_LABEL = '後補電池資訊';

// 「後補MAWB#」標記（utils/mawb-utils.js 以 const 宣告，ES Module 無法透視，故在此重新定義相同字串值）
export const MAWB_LATE_LABEL = '後補MAWB#';

export const POWER_CODES = {
  dry: ['A67', 'A123', 'A199'],
  lithium: ['PI965', 'PI966', 'PI967', 'PI968', 'PI969', 'PI970']
};

// 鋰電主選項 → PI 子代碼
export const LITHIUM_MAIN = {
  ELI: ['PI965', 'PI966', 'PI967'],
  ELM: ['PI968', 'PI969', 'PI970']
};

// 電力組合項目（power_items 元素結構）: { type, main?, code, qty }
export const POWER_ITEMS = [];