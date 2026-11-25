// ===== HKIA CDP：#409 安檢影像簽章（SHA-256 + RSA-SHA256）=====
// Spec 要求：以申請憑證時的 RSA 私鑰（PKCS#8 2048-bit）對「圖片的原始位元組」做 SHA-256 雜湊後簽章，
// 並將 signature 以 Base64 放在 imageSignature；本平台後端自動完成，免另外執行 C# 程式。
const crypto = require('crypto');

function decodeImageBase64(imageBase64) {
  const raw = String(imageBase64 || '');
  const comma = raw.indexOf(',');
  // 支援 data URI（data:image/jpeg;base64,xxxx）
  const body = raw.startsWith('data:') && comma !== -1 ? raw.slice(comma + 1) : raw;
  const cleaned = body.replace(/\s+/g, '');
  if (!cleaned) throw new Error('缺少 imageBase64');
  const buffer = Buffer.from(cleaned, 'base64');
  if (!buffer.length) throw new Error('imageBase64 無法解碼');
  return { buffer, base64: cleaned };
}

function sha256Hex(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function sha256Base64(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('base64');
}

function loadPrivateKey(privateKeyPemOrPath, fs) {
  const value = String(privateKeyPemOrPath || '');
  if (!value) throw new Error('缺少私鑰（請在設定頁指定 .key 或上傳）');
  if (value.indexOf('-----BEGIN') !== -1) return value;
  if (!fs || !fs.existsSync(value)) throw new Error(`找不到私鑰檔案：${value}`);
  return fs.readFileSync(value, 'utf8');
}

// 回傳 { algorithm, hash, hashBase64, signature, bytes }
function signImage(imageBase64, privateKeyPem) {
  const { buffer, base64 } = decodeImageBase64(imageBase64);
  if (buffer.length > 4 * 1024 * 1024) {
    const err = new Error('圖片超過 4 MB 限制');
    err.code = 'IMAGE_TOO_LARGE';
    throw err;
  }
  const hash = sha256Hex(buffer);
  const hashBase64 = sha256Base64(buffer);
  // RSA-SHA256（等同 SHA256withRSA）
  const signature = crypto.sign('sha256', buffer, privateKeyPem).toString('base64');
  return { algorithm: 'SHA256withRSA', hash, hashBase64, signature, bytes: buffer.length, base64 };
}

function verifyImage(imageBase64, signatureBase64, publicKeyPem) {
  const { buffer } = decodeImageBase64(imageBase64);
  return crypto.verify('sha256', buffer, publicKeyPem, Buffer.from(String(signatureBase64 || ''), 'base64'));
}

module.exports = { decodeImageBase64, sha256Hex, sha256Base64, loadPrivateKey, signImage, verifyImage };
