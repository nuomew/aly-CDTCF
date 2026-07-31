/**
 * Worker 主入口文件
 * 处理所有 HTTP 请求，路由分发到对应的处理器
 * 同时处理 Cron Triggers 定时任务
 */

import { handleTrafficRoutes } from './routes/traffic.js';
import { handleConfigRoutes } from './routes/config.js';
import { handleSystemRoutes } from './routes/system.js';
import { handleEcsRoutes } from './routes/ecs.js';
import { handleAuthRoutes } from './routes/auth.js';
import { handleCronTask } from './routes/cron.js';
import { checkAuth } from './lib/auth.js';
import { jsonResponse, errorResponse } from './lib/helpers.js';
import { ensureDatabaseInitialized } from './lib/db-init.js';

export default {
  /**
   * 处理 HTTP 请求
   * @param {Request} request - 请求对象
   * @param {object} env - 环境变量和绑定
   * @param {object} ctx - 执行上下文
   * @returns {Response} 响应对象
   */
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // CORS 预检请求处理
    if (method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Max-Age': '86400'
        }
      });
    }

    // 后台路径重定向到登录页
    if (path === '/admin' || path === '/admin/') {
      return Response.redirect(new URL('/pages/login.html', request.url).toString(), 302);
    }
    // 安装路径重定向
    if (path === '/install' || path === '/install/') {
      return Response.redirect(new URL('/pages/install.html', request.url).toString(), 302);
    }

    try {
      // 自动初始化数据库（首次请求时建表+插入初始数据）
      await ensureDatabaseInitialized(env.DB);

      // API 路由处理
      if (path.startsWith('/api/')) {
        // 认证相关路由（无需登录）
        if (path.startsWith('/api/auth/')) {
          return await handleAuthRoutes(request, env, ctx);
        }

        // 公开接口（无需登录）
        if (path === '/api/traffic/public' || path === '/api/traffic/dashboard') {
          return await handleTrafficRoutes(request, env, ctx);
        }

        // 以下路由需要管理员认证
        const admin = await checkAuth(request, env);
        if (!admin) {
          return errorResponse('未登录或登录已过期', 401);
        }

        // 注入管理员信息到请求
        request.admin = admin;

        if (path.startsWith('/api/traffic/')) {
          return await handleTrafficRoutes(request, env, ctx);
        }
        if (path.startsWith('/api/config/')) {
          return await handleConfigRoutes(request, env, ctx);
        }
        if (path.startsWith('/api/system/')) {
          return await handleSystemRoutes(request, env, ctx);
        }
        if (path.startsWith('/api/ecs/')) {
          return await handleEcsRoutes(request, env, ctx);
        }

        return errorResponse('接口不存在', 404);
      }

      // 静态资源由 Workers Static Assets 自动处理
      // Worker 只处理 /api/ 路由，其他路由走到这里说明是未匹配的路径
      return new Response('Not Found', { status: 404 });

    } catch (err) {
      console.error('请求处理错误:', err);
      return errorResponse('服务器内部错误: ' + err.message, 500);
    }
  },

  /**
   * 处理 Cron Triggers 定时任务
   * 每5分钟执行一次，负责流量刷新和自动开关机检查
   * @param {object} controller - 定时任务控制器
   * @param {object} env - 环境变量和绑定
   * @param {object} ctx - 执行上下文
   */
  async scheduled(controller, env, ctx) {
    console.log('定时任务开始执行:', new Date().toISOString());
    try {
      await ensureDatabaseInitialized(env.DB);
      await handleCronTask(env);
      console.log('定时任务执行完成');
    } catch (err) {
      console.error('定时任务执行失败:', err);
    }
  }
};
