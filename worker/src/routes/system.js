/**
 * 系统设置路由模块
 * 处理系统配置、邮箱配置、邮件模板、操作日志
 */

import { dbAll, dbOne, dbRun, getConfig, setConfig } from '../lib/db.js';
import { jsonResponse, errorResponse, logOperation } from '../lib/helpers.js';

/**
 * 处理系统相关路由
 * @param {Request} request - HTTP 请求
 * @param {object} env - 环境变量
 * @returns {Response} JSON 响应
 */
export async function handleSystemRoutes(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  // 系统设置
  if (path === '/api/system/settings' && method === 'GET') {
    return await getSettings(env);
  }
  if (path === '/api/system/settings' && method === 'POST') {
    return await updateSettings(request, env);
  }

  // 邮箱配置
  if (path === '/api/system/mail/list') return await getMailConfigs(env);
  if (path === '/api/system/mail/save' && method === 'POST') return await saveMailConfig(request, env);
  if (path === '/api/system/mail/delete' && method === 'POST') return await deleteMailConfig(request, env);
  if (path === '/api/system/mail/test' && method === 'POST') return await testMail(request, env);

  // 邮件模板
  if (path === '/api/system/mail-template/list') return await getMailTemplates(env);
  if (path === '/api/system/mail-template/save' && method === 'POST') return await saveMailTemplate(request, env);

  // 操作日志
  if (path === '/api/system/logs') return await getLogs(request, env);

  return errorResponse('接口不存在', 404);
}

/**
 * 获取系统设置
 */
async function getSettings(env) {
  const db = env.DB;
  const settings = {
    site_name: await getConfig(db, 'site_name', '阿里云流量查询系统'),
    site_description: await getConfig(db, 'site_description', '云数据传输流量监控平台'),
    auto_refresh_enabled: await getConfig(db, 'auto_refresh_enabled', '0'),
    auto_refresh_interval: await getConfig(db, 'auto_refresh_interval', '5')
  };
  return jsonResponse(settings);
}

/**
 * 更新系统设置
 */
async function updateSettings(request, env) {
  const db = env.DB;
  const data = await request.json();

  const fields = ['site_name', 'site_description', 'auto_refresh_enabled', 'auto_refresh_interval'];
  for (const field of fields) {
    if (data[field] !== undefined) {
      await setConfig(db, field, String(data[field]));
    }
  }

  await logOperation(db, request.admin.id, request.admin.username, 'update_settings', '系统', '更新系统设置', '');

  return jsonResponse(null, '系统设置更新成功');
}

/**
 * 获取邮箱配置列表
 */
async function getMailConfigs(env) {
  const configs = await dbAll(env.DB, 'SELECT * FROM mail_config ORDER BY is_default DESC, id ASC');
  return jsonResponse(configs.map(c => ({ ...c, resend_api_key: c.resend_api_key ? '******' : '' })));
}

/**
 * 保存邮箱配置
 */
async function saveMailConfig(request, env) {
  const data = await request.json();
  const { id, config_name, resend_api_key, from_email, from_name, to_emails, is_default, status } = data;

  if (!config_name || !from_email) {
    return errorResponse('配置名称和发件人邮箱不能为空');
  }

  if (is_default) {
    await dbRun(env.DB, 'UPDATE mail_config SET is_default = 0');
  }

  if (id) {
    // 更新
    let keySql = '';
    let keyParam = [];
    if (resend_api_key && resend_api_key !== '******') {
      keySql = ', resend_api_key = ?';
      keyParam = [resend_api_key];
    }

    await dbRun(env.DB, `UPDATE mail_config SET config_name = ?, from_email = ?, from_name = ?, to_emails = ?, is_default = ?, status = ?, updated_at = datetime('now', '+8 hours') ${keySql} WHERE id = ?`,
      [config_name, from_email, from_name || '', to_emails || '', is_default ? 1 : 0, status !== undefined ? status : 1, ...keyParam, id]);
  } else {
    // 新增
    await dbRun(env.DB, 'INSERT INTO mail_config (config_name, resend_api_key, from_email, from_name, to_emails, is_default, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [config_name, resend_api_key || '', from_email, from_name || '', to_emails || '', is_default ? 1 : 0, status !== undefined ? status : 1]);
  }

  await logOperation(env.DB, request.admin.id, request.admin.username, 'save_mail_config', '邮箱', `保存邮箱配置: ${config_name}`, '');

  return jsonResponse(null, '邮箱配置保存成功');
}

/**
 * 删除邮箱配置
 */
async function deleteMailConfig(request, env) {
  const { id } = await request.json();
  if (!id) return errorResponse('缺少配置ID');

  await dbRun(env.DB, 'DELETE FROM mail_config WHERE id = ?', [id]);
  return jsonResponse(null, '邮箱配置删除成功');
}

/**
 * 测试邮件发送
 */
async function testMail(request, env) {
  const { id } = await request.json();
  const config = await dbOne(env.DB, 'SELECT * FROM mail_config WHERE id = ?', [id]);
  if (!config) return errorResponse('邮箱配置不存在');

  const { sendEmail } = await import('../lib/mailer.js');
  const result = await sendEmail({
    apiKey: config.resend_api_key,
    from: config.from_email,
    fromName: config.from_name,
    to: config.to_emails,
    subject: '测试邮件 - 阿里云流量查询系统',
    html: '<h2>邮件发送测试</h2><p>如果您收到此邮件，说明邮箱配置正确。</p>'
  });

  if (result.success) return jsonResponse(null, '测试邮件发送成功');
  return errorResponse('测试邮件发送失败: ' + result.error);
}

/**
 * 获取邮件模板列表
 */
async function getMailTemplates(env) {
  const templates = await dbAll(env.DB, 'SELECT * FROM mail_template ORDER BY id ASC');
  return jsonResponse(templates);
}

/**
 * 保存邮件模板
 */
async function saveMailTemplate(request, env) {
  const data = await request.json();
  const { id, template_key, template_name, subject, body, status } = data;

  if (id) {
    await dbRun(env.DB, "UPDATE mail_template SET subject = ?, body = ?, status = ?, updated_at = datetime('now', '+8 hours') WHERE id = ?",
      [subject, body, status !== undefined ? status : 1, id]);
  }
  return jsonResponse(null, '邮件模板保存成功');
}

/**
 * 获取操作日志
 */
async function getLogs(request, env) {
  const url = new URL(request.url);
  const page = parseInt(url.searchParams.get('page') || '1');
  const limit = parseInt(url.searchParams.get('limit') || '50');
  const offset = (page - 1) * limit;

  const total = await dbOne(env.DB, 'SELECT COUNT(*) as count FROM operation_logs');
  const logs = await dbAll(env.DB, 'SELECT * FROM operation_logs ORDER BY id DESC LIMIT ? OFFSET ?', [limit, offset]);

  return jsonResponse({ total: total?.count || 0, page, limit, logs });
}
