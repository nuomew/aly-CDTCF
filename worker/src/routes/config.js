/**
 * 阿里云配置管理路由模块
 * 处理 AccessKey 配置的增删改查和测试
 */

import { dbAll, dbOne, dbRun } from '../lib/db.js';
import { createBssClient, createEcsClient } from '../lib/aliyun-api.js';
import { encryptData, decryptData } from '../lib/auth.js';
import { jsonResponse, errorResponse, logOperation } from '../lib/helpers.js';

/**
 * 处理配置管理路由
 * @param {Request} request - HTTP 请求
 * @param {object} env - 环境变量
 * @returns {Response} JSON 响应
 */
export async function handleConfigRoutes(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  // 获取配置列表
  if (path === '/api/config/list') {
    return await getConfigList(request, env);
  }

  // 获取单个配置
  if (path === '/api/config/get') {
    const id = url.searchParams.get('id');
    return await getConfigDetail(id, env);
  }

  // 添加配置
  if (path === '/api/config/add' && method === 'POST') {
    return await addConfig(request, env);
  }

  // 更新配置
  if (path === '/api/config/update' && method === 'POST') {
    return await updateConfig(request, env);
  }

  // 删除配置
  if (path === '/api/config/delete' && method === 'POST') {
    return await deleteConfig(request, env);
  }

  // 测试连接
  if (path === '/api/config/test' && method === 'POST') {
    return await testConfig(request, env);
  }

  return errorResponse('接口不存在', 404);
}

/**
 * 获取配置列表
 */
async function getConfigList(request, env) {
  const db = env.DB;
  const monthStart = new Date().toISOString().substring(0, 7) + '-01';

  const configs = await dbAll(db, `SELECT ac.id, ac.name, ac.access_key_id, ac.region_id, ac.status, ac.is_default, ac.remark,
    ac.max_traffic_gb, ac.alert_threshold, ac.shutdown_threshold, ac.auto_shutdown,
    ac.auto_start_day, ac.auto_start_hour, ac.auto_start_minute,
    ac.last_auto_shutdown, ac.last_auto_start, ac.created_at,
    COALESCE((SELECT tr.traffic_total FROM traffic_records tr WHERE tr.config_id = ac.id AND tr.record_date >= ? ORDER BY tr.record_date DESC LIMIT 1), 0) as month_traffic
    FROM aliyun_config ac ORDER BY ac.is_default DESC, ac.id ASC`, [monthStart]);

  return jsonResponse(configs.map(c => ({
    ...c,
    access_key_secret: '******',
    month_traffic_gb: (c.month_traffic || 0) / 1024 / 1024 / 1024
  })));
}

/**
 * 获取配置详情
 */
async function getConfigDetail(id, env) {
  if (!id) return errorResponse('缺少配置ID');

  const config = await dbOne(env.DB, 'SELECT * FROM aliyun_config WHERE id = ?', [id]);
  if (!config) return errorResponse('配置不存在', 404);

  config.access_key_secret = '******';
  return jsonResponse(config);
}

/**
 * 添加配置
 */
async function addConfig(request, env) {
  const data = await request.json();
  const { name, access_key_id, access_key_secret, region_id, remark, max_traffic_gb, alert_threshold, shutdown_threshold, auto_shutdown, auto_start_day, auto_start_hour, auto_start_minute } = data;

  if (!name || !access_key_id || !access_key_secret) {
    return errorResponse('配置名称、AccessKey ID 和 Secret 不能为空');
  }

  const encryptedSecret = await encryptData(access_key_secret, env.APP_SECRET);

  const result = await dbRun(env.DB,
    `INSERT INTO aliyun_config (name, access_key_id, access_key_secret, region_id, remark, max_traffic_gb, alert_threshold, shutdown_threshold, auto_shutdown, auto_start_day, auto_start_hour, auto_start_minute)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [name, access_key_id, encryptedSecret, region_id || 'cn-hangzhou', remark || '',
     max_traffic_gb || 200, alert_threshold || 80, shutdown_threshold || 95,
     auto_shutdown ? 1 : 0, auto_start_day || 1, auto_start_hour || 0, auto_start_minute || 0]);

  await logOperation(env.DB, request.admin.id, request.admin.username, 'add_config', '配置', `添加配置: ${name}`, '');

  return jsonResponse({ id: result.meta?.last_row_id }, '配置添加成功');
}

/**
 * 更新配置
 */
async function updateConfig(request, env) {
  const data = await request.json();
  const { id, name, access_key_id, access_key_secret, region_id, status, is_default, remark, max_traffic_gb, alert_threshold, shutdown_threshold, auto_shutdown, auto_start_day, auto_start_hour, auto_start_minute } = data;

  if (!id) return errorResponse('缺少配置ID');

  const existing = await dbOne(env.DB, 'SELECT * FROM aliyun_config WHERE id = ?', [id]);
  if (!existing) return errorResponse('配置不存在', 404);

  let encryptedSecret = existing.access_key_secret;
  if (access_key_secret && access_key_secret !== '******') {
    encryptedSecret = await encryptData(access_key_secret, env.APP_SECRET);
  }

  // 如果设为默认，先取消其他默认
  if (is_default) {
    await dbRun(env.DB, 'UPDATE aliyun_config SET is_default = 0');
  }

  await dbRun(env.DB, `UPDATE aliyun_config SET name = ?, access_key_id = ?, access_key_secret = ?, region_id = ?,
    status = ?, is_default = ?, remark = ?, max_traffic_gb = ?, alert_threshold = ?, shutdown_threshold = ?,
    auto_shutdown = ?, auto_start_day = ?, auto_start_hour = ?, auto_start_minute = ?,
    updated_at = datetime('now', '+8 hours') WHERE id = ?`,
    [name, access_key_id, encryptedSecret, region_id || 'cn-hangzhou',
     status !== undefined ? status : existing.status, is_default ? 1 : 0,
     remark || '', max_traffic_gb || 200, alert_threshold || 80, shutdown_threshold || 95,
     auto_shutdown ? 1 : 0, auto_start_day || 1, auto_start_hour || 0, auto_start_minute || 0, id]);

  await logOperation(env.DB, request.admin.id, request.admin.username, 'update_config', '配置', `更新配置: ${name}`, '');

  return jsonResponse(null, '配置更新成功');
}

/**
 * 删除配置
 */
async function deleteConfig(request, env) {
  const { id } = await request.json();
  if (!id) return errorResponse('缺少配置ID');

  const config = await dbOne(env.DB, 'SELECT name FROM aliyun_config WHERE id = ?', [id]);
  if (!config) return errorResponse('配置不存在', 404);

  await dbRun(env.DB, 'DELETE FROM aliyun_config WHERE id = ?', [id]);
  await dbRun(env.DB, 'DELETE FROM traffic_records WHERE config_id = ?', [id]);

  await logOperation(env.DB, request.admin.id, request.admin.username, 'delete_config', '配置', `删除配置: ${config.name}`, '');

  return jsonResponse(null, '配置删除成功');
}

/**
 * 测试配置连接
 */
async function testConfig(request, env) {
  const { id, access_key_id, access_key_secret } = await request.json();

  let keyId = access_key_id;
  let keySecret = access_key_secret;

  if (id) {
    const config = await dbOne(env.DB, 'SELECT * FROM aliyun_config WHERE id = ?', [id]);
    if (!config) return errorResponse('配置不存在', 404);
    keyId = config.access_key_id;
    keySecret = await decryptData(config.access_key_secret, env.APP_SECRET);
  }

  if (!keyId || !keySecret) {
    return errorResponse('AccessKey ID 和 Secret 不能为空');
  }

  const client = createBssClient(keyId, keySecret);
  const result = await client.testConnection();

  if (result.success) {
    return jsonResponse(result.data, '连接测试成功');
  }
  return errorResponse('连接测试失败: ' + result.error);
}
