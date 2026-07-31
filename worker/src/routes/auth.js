/**
 * 认证路由模块
 * 处理登录、注销、会话检查
 */

import { dbOne, dbRun } from '../lib/db.js';
import { hashPassword, verifyPassword, createSession, destroySession, checkAuth } from '../lib/auth.js';
import { jsonResponse, errorResponse, logOperation } from '../lib/helpers.js';

/**
 * 处理认证相关路由
 * @param {Request} request - HTTP 请求
 * @param {object} env - 环境变量
 * @returns {Response} JSON 响应
 */
export async function handleAuthRoutes(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  // 登录
  if (path === '/api/auth/login' && method === 'POST') {
    return await handleLogin(request, env);
  }

  // 注销
  if (path === '/api/auth/logout' && method === 'POST') {
    return await handleLogout(request, env);
  }

  // 检查登录状态
  if (path === '/api/auth/check') {
    return await handleCheck(request, env);
  }

  // 安装初始化（首次设置管理员）
  if (path === '/api/auth/install' && method === 'POST') {
    return await handleInstall(request, env);
  }

  return errorResponse('接口不存在', 404);
}

/**
 * 处理管理员登录
 */
async function handleLogin(request, env) {
  const { username, password } = await request.json();

  if (!username || !password) {
    return errorResponse('用户名和密码不能为空');
  }

  const admin = await dbOne(env.DB, 'SELECT * FROM admin_users WHERE username = ? AND status = 1', [username]);

  if (!admin) {
    return errorResponse('用户名或密码错误');
  }

  const valid = await verifyPassword(password, admin.password);
  if (!valid) {
    return errorResponse('用户名或密码错误');
  }

  const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || '';
  const userAgent = request.headers.get('User-Agent') || '';
  const token = await createSession(env.DB, admin.id, ip, userAgent);

  // 更新登录信息
  await dbRun(env.DB, "UPDATE admin_users SET login_ip = ?, login_time = datetime('now', '+8 hours') WHERE id = ?", [ip, admin.id]);

  await logOperation(env.DB, admin.id, username, 'login', '认证', '管理员登录', ip);

  const headers = new Headers({ 'Content-Type': 'application/json' });
  headers.set('Set-Cookie', `at_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`);

  return new Response(JSON.stringify({
    success: true,
    message: '登录成功',
    data: { token, admin: { id: admin.id, username: admin.username, nickname: admin.nickname } }
  }), { headers });
}

/**
 * 处理注销
 */
async function handleLogout(request, env) {
  const cookie = request.headers.get('Cookie') || '';
  const match = cookie.match(/at_session=([^;]+)/);
  if (match) {
    await destroySession(env.DB, match[1]);
  }

  const headers = new Headers({ 'Content-Type': 'application/json' });
  headers.set('Set-Cookie', 'at_session=; Path=/; HttpOnly; Max-Age=0');

  return new Response(JSON.stringify({ success: true, message: '注销成功' }), { headers });
}

/**
 * 检查登录状态
 */
async function handleCheck(request, env) {
  const admin = await checkAuth(request, env);
  if (!admin) {
    return jsonResponse({ logged_in: false });
  }
  return jsonResponse({ logged_in: true, admin });
}

/**
 * 首次安装（创建管理员账号）
 */
async function handleInstall(request, env) {
  // 检查是否已有管理员
  const existing = await dbOne(env.DB, 'SELECT COUNT(*) as count FROM admin_users');
  if (existing && existing.count > 0) {
    return errorResponse('系统已安装，不允许重复安装');
  }

  const { username, password, email, nickname } = await request.json();

  if (!username || !password) {
    return errorResponse('用户名和密码不能为空');
  }
  if (password.length < 6) {
    return errorResponse('密码长度不能少于6位');
  }

  const hashedPassword = await hashPassword(password);
  await dbRun(env.DB,
    'INSERT INTO admin_users (username, password, email, nickname) VALUES (?, ?, ?, ?)',
    [username, hashedPassword, email || '', nickname || username]
  );

  return jsonResponse(null, '管理员账号创建成功');
}
