/**
 * 认证模块
 * 管理员认证、Session 管理、密码加密
 * 使用 Web Crypto API 替代 PHP password_hash/password_verify
 */

import { dbOne, dbRun } from './db.js';

/**
 * 哈希密码（使用 PBKDF2，兼容 bcrypt 安全级别）
 * 格式：iterations.salt.hash（均为 Base64 编码）
 * @param {string} password - 明文密码
 * @returns {Promise<string>} 哈希后的密码
 */
export async function hashPassword(password) {
  const encoder = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iterations = 100000;

  const keyMaterial = await crypto.subtle.importKey(
    'raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']
  );

  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    keyMaterial, 256
  );

  const hashArray = new Uint8Array(bits);
  const saltB64 = btoa(String.fromCharCode(...salt));
  const hashB64 = btoa(String.fromCharCode(...hashArray));

  return `${iterations}.${saltB64}.${hashB64}`;
}

/**
 * 验证密码
 * @param {string} password - 明文密码
 * @param {string} storedHash - 存储的哈希值
 * @returns {Promise<boolean>} 是否匹配
 */
export async function verifyPassword(password, storedHash) {
  try {
    const parts = storedHash.split('.');
    if (parts.length !== 3) return false;

    const iterations = parseInt(parts[0]);
    const salt = Uint8Array.from(atob(parts[1]), c => c.charCodeAt(0));
    const expectedHash = parts[2];

    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']
    );

    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
      keyMaterial, 256
    );

    const hashArray = new Uint8Array(bits);
    const hashB64 = btoa(String.fromCharCode(...hashArray));

    return hashB64 === expectedHash;
  } catch {
    return false;
  }
}

/**
 * 生成 Session Token
 * @returns {string} 随机 token
 */
function generateToken() {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 加密敏感数据（AES-256-GCM）
 * @param {string} plaintext - 明文
 * @param {string} secret - 加密密钥
 * @returns {Promise<string>} 加密后的字符串（Base64）
 */
export async function encryptData(plaintext, secret) {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', encoder.encode(secret.padEnd(32, '0').substring(0, 32)),
    'AES-GCM', false, ['encrypt']
  );

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    keyMaterial,
    encoder.encode(plaintext)
  );

  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(encrypted), iv.length);

  return btoa(String.fromCharCode(...combined));
}

/**
 * 解密数据（AES-256-GCM）
 * @param {string} ciphertext - 密文（Base64）
 * @param {string} secret - 加密密钥
 * @returns {Promise<string>} 解密后的明文
 */
export async function decryptData(ciphertext, secret) {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', encoder.encode(secret.padEnd(32, '0').substring(0, 32)),
    'AES-GCM', false, ['decrypt']
  );

  const combined = Uint8Array.from(atob(ciphertext), c => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const data = combined.slice(12);

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    keyMaterial,
    data
  );

  return new TextDecoder().decode(decrypted);
}

/**
 * 创建登录会话
 * @param {D1Database} db - D1 数据库绑定
 * @param {number} adminId - 管理员 ID
 * @param {string} ip - 客户端 IP
 * @param {string} userAgent - User-Agent
 * @returns {Promise<string>} Session Token
 */
export async function createSession(db, adminId, ip, userAgent) {
  const token = generateToken();
  // 使用 SQLite 兼容格式 YYYY-MM-DD HH:MM:SS
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)
    .toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');

  await dbRun(db,
    'INSERT INTO sessions (token, admin_id, ip, user_agent, expires_at) VALUES (?, ?, ?, ?, ?)',
    [token, adminId, ip, userAgent, expiresAt]
  );

  return token;
}

/**
 * 从请求中检查认证状态
 * @param {Request} request - HTTP 请求
 * @param {object} env - 环境变量
 * @returns {Promise<object|null>} 管理员信息或 null
 */
export async function checkAuth(request, env) {
  const token = extractToken(request);
  console.log('checkAuth: token=' + (token ? token.substring(0, 8) + '...' : 'null'));

  if (!token) return null;

  const db = env.DB;
  // 用参数绑定避免SQL注入和时区问题
  const now = new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
  console.log('checkAuth: now=' + now);

  const session = await dbOne(db,
    'SELECT s.*, a.username, a.nickname, a.email FROM sessions s JOIN admin_users a ON s.admin_id = a.id WHERE s.token = ? AND s.expires_at > ? AND a.status = 1',
    [token, now]
  );

  console.log('checkAuth: session=' + (session ? 'found' : 'null'));

  if (!session) return null;

  return {
    id: session.admin_id,
    username: session.username,
    nickname: session.nickname,
    email: session.email
  };
}

/**
 * 从请求中提取 Token
 * @param {Request} request - HTTP 请求
 * @returns {string|null} Token
 */
function extractToken(request) {
  // 从 Cookie 中提取
  const cookie = request.headers.get('Cookie') || '';
  const match = cookie.match(/at_session=([^;]+)/);
  if (match) return match[1];

  // 从 Authorization 头提取
  const auth = request.headers.get('Authorization') || '';
  if (auth.startsWith('Bearer ')) return auth.substring(7);

  return null;
}

/**
 * 注销会话
 * @param {D1Database} db - D1 数据库绑定
 * @param {string} token - Session Token
 */
export async function destroySession(db, token) {
  await dbRun(db, 'DELETE FROM sessions WHERE token = ?', [token]);
}

/**
 * 清理过期会话
 * @param {D1Database} db - D1 数据库绑定
 */
export async function cleanExpiredSessions(db) {
  await dbRun(db, "DELETE FROM sessions WHERE expires_at < datetime('now')");
}
