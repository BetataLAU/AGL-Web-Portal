// ===== HKIA CDP：前端 API 層（所有請求都經過本平台 BFF）=====
// 使用 utils/api.js 的 apiFetch（401 自動跳登入、錯誤統一拋出）。
const call = (url, options) => window.apiFetch(url, options || {});

const jsonBody = (method, body) => ({ method, body: JSON.stringify(body || {}) });

export const hkiaApi = {
  config: () => call('/api/hkia-cdp/config'),
  saveConfig: (patch) => call('/api/hkia-cdp/config', jsonBody('PUT', patch)),
  uploadCert: (kind, file) => {
    const form = new FormData();
    form.append('kind', kind);
    form.append('file', file);
    return call('/api/hkia-cdp/certs', { method: 'POST', body: form });
  },
  authTest: (body) => call('/api/hkia-cdp/auth/test', jsonBody('POST', body || {})),
  lint: (payload, options) => call('/api/hkia-cdp/lint', jsonBody('POST', Object.assign({ payload }, options || {}))),
  sign: (imageBase64) => call('/api/hkia-cdp/sign', jsonBody('POST', { imageBase64 })),
  proxy: (body) => call('/api/hkia-cdp/proxy', jsonBody('POST', body || {})),
  history: (limit, type) => call(`/api/hkia-cdp/history?limit=${encodeURIComponent(limit || 30)}${type ? `&type=${encodeURIComponent(type)}` : ''}`),
  clearHistory: () => call('/api/hkia-cdp/history', { method: 'DELETE' }),
  refs: () => call('/api/hkia-cdp/refs'),
  pending: () => call('/api/hkia-cdp/pending'),
  resetMock: () => call('/api/hkia-cdp/mock/reset', { method: 'POST' }),
  health: () => call('/api/hkia-cdp/health'),
  simulateCallback: (payload) => call('/api/hkia-cdp/simulate-callback', jsonBody('POST', payload)),
  eventsUrl: '/api/hkia-cdp/events'
};

// 依環境與 API 定義組出「直連 HKIA」的 URL（供程式碼片段使用）
export function directUrl(env, pathTemplate) {
  const base = env === 'sit'
    ? 'https://api-external.sit.hkiacargo.com'
    : env === 'prod'
      ? 'https://api-external.hkiacargo.com'
      : 'https://api-external.sit.hkiacargo.com';
  return `${base}${pathTemplate}`;
}

export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const comma = result.indexOf(',');
      resolve(comma === -1 ? result : result.slice(comma + 1));
    };
    reader.onerror = () => reject(new Error('讀取檔案失敗'));
    reader.readAsDataURL(file);
  });
}
