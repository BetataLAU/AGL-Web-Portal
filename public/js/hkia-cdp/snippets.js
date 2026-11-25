// ===== HKIA CDP：程式碼片段匯出（cURL / JavaScript / Python）=====
// 產生的片段是「直連 HKIA」的版本（含 mTLS 憑證掛載），方便貼到 Postman／腳本；
// 本平台後端（BFF）本身已代為處理 mTLS、Token 與簽章。

function oneLine(obj) {
  return JSON.stringify(obj, null, 2);
}

function headerLines(headers, indent) {
  const pad = indent || '  ';
  return Object.keys(headers || {})
    .filter((k) => headers[k] !== undefined && headers[k] !== null && headers[k] !== '')
    .map((k) => `${pad}'${k}: ${String(headers[k]).replace(/'/g, "\\'")}'`)
    .join(' \\\n');
}

export function buildCurl({ method = 'POST', url = '', headers = {}, body = null, certPath = './certs/client.pem', keyPath = './certs/client.key' }) {
  const parts = [`curl -X ${method} '${url}'`];
  parts.push(`  --cert '${certPath}' --key '${keyPath}'`);
  parts.push('  --tlsv1.2');
  Object.keys(headers || {}).forEach((k) => {
    if (headers[k] === undefined || headers[k] === null || headers[k] === '') return;
    parts.push(`  -H '${k}: ${String(headers[k]).replace(/'/g, "'\\''")}'`);
  });
  if (body !== null && body !== undefined) parts.push(`  -d '${JSON.stringify(body).replace(/'/g, "'\\''")}'`);
  return parts.join(' \\\n');
}

export function buildJavaScript({ method = 'POST', url = '', headers = {}, body = null, certPath = './certs/client.pem', keyPath = './certs/client.key' }) {
  return `// Node.js 18+（BFF 直連 HKIA；瀏覽器不能直接做 mTLS）
import fs from 'node:fs';
import https from 'node:https';

const agent = new https.Agent({
  cert: fs.readFileSync('${certPath}'),
  key: fs.readFileSync('${keyPath}'),
  minVersion: 'TLSv1.2'
});

const res = await fetch('${url}', {
  method: '${method}',
  headers: {
${Object.keys(headers || {}).filter((k) => headers[k] !== undefined && headers[k] !== null && headers[k] !== '').map((k) => `    '${k}': '${String(headers[k]).replace(/'/g, "\\'")}'`).join(',\n')}
  }${body !== null && body !== undefined ? `,
  body: JSON.stringify(${oneLine(body).replace(/\n/g, '\n  ')})` : ''},
  dispatcher: agent   // undici：需 Node 20+；或改用 https.request
});

const data = await res.json();
console.log(res.status, data);`;
}

export function buildPython({ method = 'POST', url = '', headers = {}, body = null, certPath = './certs/client.pem', keyPath = './certs/client.key' }) {
  const head = Object.keys(headers || {})
    .filter((k) => headers[k] !== undefined && headers[k] !== null && headers[k] !== '')
    .map((k) => `    '${k}': '${String(headers[k]).replace(/'/g, "\\'")}',`)
    .join('\n');
  return `# pip install requests
import requests

url = '${url}'
headers = {
${head}
}
payload = ${body === null || body === undefined ? 'None' : JSON.stringify(body, null, 4).replace(/\n/g, '\n')}

# mTLS（TLS 1.2）。requests 會自動使用 TLS 1.2+；如遇舊 gateway 可指定 ssl_version
res = requests.${String(method || 'POST').toLowerCase()}(url, json=payload, headers=headers,
    cert=('${certPath}', '${keyPath}'), timeout=30)
print(res.status_code, res.text)`;
}

export function buildAll(options) {
  return {
    curl: buildCurl(options),
    javascript: buildJavaScript(options),
    python: buildPython(options)
  };
}
