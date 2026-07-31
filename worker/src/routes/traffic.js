/**
 * 流量数据路由模块
 * 处理流量查询、统计、刷新、排行等
 */

import { dbAll, dbOne, dbRun, getConfig, setConfig } from '../lib/db.js';
import { createBssClient, parseTrafficData } from '../lib/aliyun-api.js';
import { jsonResponse, errorResponse, formatBytes, nowBeijing, todayBeijing, monthStartBeijing, logOperation, decryptData } from '../lib/helpers.js';

/**
 * 处理流量相关路由
 * @param {Request} request - HTTP 请求
 * @param {object} env - 环境变量
 * @returns {Response} JSON 响应
 */
export async function handleTrafficRoutes(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;
  const action = url.searchParams.get('action') || '';

  // 公开接口：仪表盘数据
  if (path === '/api/traffic/dashboard') {
    return await getDashboardData(env);
  }

  // 公开接口：流量统计
  if (path === '/api/traffic/public') {
    return await getPublicTraffic(env);
  }

  // 刷新流量数据
  if (path === '/api/traffic/refresh' && method === 'POST') {
    return await refreshTraffic(request, env);
  }

  // 后台流量统计
  if (path === '/api/traffic/stats') {
    return await getTrafficStats(request, env);
  }

  // 流量排行
  if (path === '/api/traffic/ranking') {
    return await getTrafficRanking(env);
  }

  // 趋势数据
  if (path === '/api/traffic/trend') {
    return await getTrafficTrend(env);
  }

  return errorResponse('接口不存在', 404);
}

/**
 * 获取前端仪表盘数据
 * 返回所有配置的流量使用情况和统计数据
 */
async function getDashboardData(env) {
  const db = env.DB;
  const monthStart = monthStartBeijing();
  const today = todayBeijing();
  const yesterday = new Date(Date.now() - 86400000).toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).split(' ')[0];
  const dayBefore = new Date(Date.now() - 2 * 86400000).toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).split(' ')[0];

  // 获取站点配置
  const siteName = await getConfig(db, 'site_name', '阿里云流量查询系统');
  const siteDesc = await getConfig(db, 'site_description', '云数据传输流量监控平台');
  const autoRefreshEnabled = await getConfig(db, 'auto_refresh_enabled', '0') === '1';
  const autoRefreshInterval = parseInt(await getConfig(db, 'auto_refresh_interval', '5'));
  const lastRefreshTime = await getConfig(db, 'last_refresh_time', '');

  // 配置统计
  const configCount = await dbOne(db, "SELECT COUNT(*) as count FROM aliyun_config WHERE status = 1");
  const totalConfigCount = await dbOne(db, "SELECT COUNT(*) as count FROM aliyun_config");

  // 各配置详情
  const configs = await dbAll(db, `SELECT ac.*, 
    COALESCE((SELECT tr2.traffic_total FROM traffic_records tr2 WHERE tr2.config_id = ac.id AND tr2.record_date >= ? ORDER BY tr2.record_date DESC LIMIT 1), 0) as month_traffic,
    COALESCE((SELECT tr2.traffic_in FROM traffic_records tr2 WHERE tr2.config_id = ac.id AND tr2.record_date >= ? ORDER BY tr2.record_date DESC LIMIT 1), 0) as month_in,
    COALESCE((SELECT tr2.traffic_out FROM traffic_records tr2 WHERE tr2.config_id = ac.id AND tr2.record_date >= ? ORDER BY tr2.record_date DESC LIMIT 1), 0) as month_out
    FROM aliyun_config ac WHERE ac.status = 1 ORDER BY ac.is_default DESC, ac.id ASC`, [monthStart, monthStart, monthStart]);

  // 今日/昨日流量计算（取最新记录的差值）
  const todayTraffic = await calculateDailyTraffic(db, monthStart, today, yesterday);
  const yesterdayTraffic = await calculateDailyTraffic(db, monthStart, yesterday, dayBefore);

  // 本月流量（取最新日期记录汇总）
  const latestRecord = await dbOne(db, `SELECT MAX(record_date) as max_date FROM traffic_records WHERE record_date >= ?`, [monthStart]);
  let monthTrafficTotal = 0;
  let monthTrafficOut = 0;
  if (latestRecord?.max_date) {
    const stats = await dbOne(db, `SELECT SUM(traffic_out) as traffic_out, SUM(traffic_total) as traffic_total FROM traffic_records WHERE record_date = ?`, [latestRecord.max_date]);
    monthTrafficTotal = stats?.traffic_total || 0;
    monthTrafficOut = stats?.traffic_out || 0;
  }

  // 7天趋势
  const trendData = await getTrendData(db, monthStart);

  // 排行榜
  let ranking = [];
  if (latestRecord?.max_date) {
    ranking = await dbAll(db, `SELECT ac.name, tr.traffic_out, tr.traffic_total 
      FROM traffic_records tr JOIN aliyun_config ac ON tr.config_id = ac.id
      WHERE tr.record_date = ? ORDER BY tr.traffic_total DESC LIMIT 10`, [latestRecord.max_date]);
  }

  // 总流量使用率
  let totalMaxTraffic = 0;
  let totalCurrentTraffic = 0;
  for (const cfg of configs) {
    totalMaxTraffic += parseFloat(cfg.max_traffic_gb || 1000);
    totalCurrentTraffic += (cfg.month_traffic || 0) / 1024 / 1024 / 1024;
  }
  const totalTrafficPercent = totalMaxTraffic > 0 ? Math.min(100, Math.round((totalCurrentTraffic / totalMaxTraffic) * 100 * 10) / 10) : 0;

  return jsonResponse({
    siteName, siteDesc, autoRefreshEnabled, autoRefreshInterval, lastRefreshTime,
    configCount: configCount?.count || 0,
    totalConfigCount: totalConfigCount?.count || 0,
    configs: configs.map(c => ({
      ...c,
      month_traffic_gb: (c.month_traffic || 0) / 1024 / 1024 / 1024,
      month_in_gb: (c.month_in || 0) / 1024 / 1024 / 1024,
      month_out_gb: (c.month_out || 0) / 1024 / 1024 / 1024,
      max_traffic_gb: parseFloat(c.max_traffic_gb || 1000),
      alert_threshold: parseInt(c.alert_threshold || 80)
    })),
    todayTraffic, yesterdayTraffic,
    monthTrafficTotal, monthTrafficOut,
    totalMaxTraffic, totalCurrentTraffic, totalTrafficPercent,
    weeklyStats: trendData,
    ranking
  });
}

/**
 * 计算每日流量（当日累计值 - 前日累计值）
 */
async function calculateDailyTraffic(db, monthStart, targetDate, prevDate) {
  const targetRecords = await dbAll(db, 
    `SELECT instance_id, traffic_total FROM traffic_records 
     WHERE record_date >= ? AND id IN (SELECT MAX(id) FROM traffic_records WHERE record_date >= ? GROUP BY instance_id)
     AND record_date <= ?`,
    [monthStart, monthStart, targetDate]);

  const prevRecords = await dbAll(db,
    `SELECT instance_id, traffic_total FROM traffic_records 
     WHERE record_date >= ? AND record_date <= ? AND id IN (SELECT MAX(id) FROM traffic_records WHERE record_date >= ? AND record_date <= ? GROUP BY instance_id, record_date)
     AND record_date <= ?`,
    [monthStart, prevDate, monthStart, prevDate, prevDate]);

  const targetMap = {};
  for (const r of targetRecords) targetMap[r.instance_id] = parseFloat(r.traffic_total);
  const prevMap = {};
  for (const r of prevRecords) prevMap[r.instance_id] = parseFloat(r.traffic_total);

  let total = 0;
  for (const [instanceId, targetVal] of Object.entries(targetMap)) {
    const prevVal = prevMap[instanceId] || 0;
    total += Math.max(0, targetVal - prevVal);
  }
  return total;
}

/**
 * 获取7天趋势数据
 */
async function getTrendData(db, monthStart) {
  const records = await dbAll(db,
    `SELECT record_date, SUM(traffic_total) as traffic_total 
     FROM traffic_records 
     WHERE record_date >= date('now', '-8 days', '+8 hours') AND record_date >= ?
     AND id IN (SELECT MAX(id) FROM traffic_records WHERE record_date >= date('now', '-8 days', '+8 hours') AND record_date >= ? GROUP BY instance_id, record_date)
     GROUP BY record_date ORDER BY record_date ASC`,
    [monthStart, monthStart]);

  const result = [];
  let prevCum = 0;
  for (let i = 0; i < records.length; i++) {
    const curCum = parseFloat(records[i].traffic_total);
    const dailyUsage = i === 0 ? 0 : Math.max(0, curCum - prevCum);
    result.push({ record_date: records[i].record_date, traffic_total: dailyUsage });
    prevCum = curCum;
  }
  return result;
}

/**
 * 公开流量数据（简化版）
 */
async function getPublicTraffic(env) {
  const db = env.DB;
  const configs = await dbAll(db, "SELECT COUNT(*) as total, SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END) as enabled FROM aliyun_config");
  return jsonResponse({
    totalConfigs: configs[0]?.total || 0,
    enabledConfigs: configs[0]?.enabled || 0
  });
}

/**
 * 刷新流量数据（从阿里云 API 获取最新数据并存入 D1）
 */
async function refreshTraffic(request, env) {
  const db = env.DB;
  const secret = env.APP_SECRET;
  const billingCycle = todayBeijing().substring(0, 7);
  const billingDate = todayBeijing();

  // 获取所有启用的配置
  const configs = await dbAll(db, 'SELECT * FROM aliyun_config WHERE status = 1');
  if (!configs.length) {
    return errorResponse('没有启用的阿里云配置');
  }

  let totalRecords = 0;
  const errors = [];

  for (const config of configs) {
    try {
      const secretKey = await decryptData(config.access_key_secret, secret);
      const client = createBssClient(config.access_key_id, secretKey);

      // 查询当日明细
      const result = await client.queryDailyBill(billingDate);
      if (!result.success) {
        errors.push(`${config.name}: ${result.error}`);
        continue;
      }

      const parsed = parseTrafficData(result.data);
      for (const item of parsed.list) {
        const trafficBytes = Math.round(item.usage * 1024 * 1024 * 1024);

        // 检查是否已有记录
        const existing = await dbOne(db,
          'SELECT id FROM traffic_records WHERE config_id = ? AND instance_id = ? AND record_date = ?',
          [config.id, item.instanceId, billingDate]);

        if (existing) {
          await dbRun(db,
            "UPDATE traffic_records SET traffic_out = ?, traffic_total = ?, instance_name = ?, region_id = ?, updated_at = datetime('now', '+8 hours') WHERE id = ?",
            [trafficBytes, trafficBytes, item.nickName, item.region, existing.id]);
        } else {
          await dbRun(db,
            'INSERT INTO traffic_records (config_id, instance_id, instance_name, region_id, traffic_out, traffic_total, record_date) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [config.id, item.instanceId, item.nickName, item.region, trafficBytes, trafficBytes, billingDate]);
        }
        totalRecords++;
      }
    } catch (err) {
      errors.push(`${config.name}: ${err.message}`);
    }
  }

  // 更新最后刷新时间
  await setConfig(db, 'last_refresh_time', nowBeijing());

  const admin = request.admin;
  await logOperation(db, admin?.id, admin?.username, 'refresh_traffic', '流量', `刷新流量数据，共${totalRecords}条记录`, '');

  return jsonResponse({
    records: totalRecords,
    errors: errors.length > 0 ? errors : null,
    refresh_time: nowBeijing()
  }, `流量数据刷新完成，共更新${totalRecords}条记录`);
}

/**
 * 获取后台流量统计
 */
async function getTrafficStats(request, env) {
  const db = env.DB;
  const url = new URL(request.url);
  const date = url.searchParams.get('date') || todayBeijing();

  const records = await dbAll(db,
    `SELECT tr.*, ac.name as config_name 
     FROM traffic_records tr JOIN aliyun_config ac ON tr.config_id = ac.id
     WHERE tr.record_date = ? ORDER BY tr.traffic_total DESC`, [date]);

  return jsonResponse({ date, records });
}

/**
 * 获取流量排行
 */
async function getTrafficRanking(env) {
  const db = env.DB;
  const monthStart = monthStartBeijing();
  const latest = await dbOne(db, 'SELECT MAX(record_date) as max_date FROM traffic_records WHERE record_date >= ?', [monthStart]);

  if (!latest?.max_date) {
    return jsonResponse({ ranking: [] });
  }

  const ranking = await dbAll(db,
    `SELECT ac.name, tr.instance_id, tr.traffic_out, tr.traffic_total 
     FROM traffic_records tr JOIN aliyun_config ac ON tr.config_id = ac.id
     WHERE tr.record_date = ? ORDER BY tr.traffic_total DESC LIMIT 10`, [latest.max_date]);

  return jsonResponse({ ranking });
}

/**
 * 获取流量趋势
 */
async function getTrafficTrend(env) {
  const db = env.DB;
  const monthStart = monthStartBeijing();
  const trend = await getTrendData(db, monthStart);
  return jsonResponse({ trend });
}
