/**
 * 流量数据路由模块
 * 处理流量查询、统计、刷新、排行等
 */

import { dbAll, dbOne, dbRun, getConfig, setConfig } from '../lib/db.js';
import { createBssClient, parseTrafficData } from '../lib/aliyun-api.js';
import { decryptData } from '../lib/auth.js';
import { jsonResponse, errorResponse, formatBytes, nowBeijing, todayBeijing, monthStartBeijing, logOperation } from '../lib/helpers.js';

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

  // 统计概览（4个统计卡片数据）
  if (path === '/api/traffic/summary') {
    return await getTrafficSummary(request, env);
  }

  // 流量排行
  if (path === '/api/traffic/ranking') {
    return await getTrafficRanking(request, env);
  }

  // 趋势数据
  if (path === '/api/traffic/trend') {
    return await getTrafficTrend(request, env);
  }

  return errorResponse('接口不存在', 404);
}

/**
 * 解析日期范围与配置筛选参数
 * 默认查询最近7天（含今天）
 * @param {URL} url - 请求 URL 对象
 * @returns {{startDate: string, endDate: string, configId: number}} 筛选参数
 */
function parseFilterParams(url) {
  // 默认结束日期为今天（北京时间）
  const defaultEnd = todayBeijing();
  // 默认开始日期为6天前（北京时间），与今天组成最近7天
  const defaultStart = new Date(Date.now() - 6 * 86400000)
    .toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).split(' ')[0];
  const startDate = url.searchParams.get('start_date') || defaultStart;
  const endDate = url.searchParams.get('end_date') || defaultEnd;
  const configId = parseInt(url.searchParams.get('config_id') || '0', 10) || 0;
  return { startDate, endDate, configId };
}

/**
 * 构建筛选 WHERE 条件与参数（不带 WHERE 关键字）
 * @param {string} startDate - 开始日期 YYYY-MM-DD
 * @param {string} endDate - 结束日期 YYYY-MM-DD
 * @param {number} configId - 配置ID，0表示全部
 * @returns {{where: string, params: Array}} SQL 条件与参数
 */
function buildFilterWhere(startDate, endDate, configId) {
  let where = 'record_date BETWEEN ? AND ?';
  const params = [startDate, endDate];
  if (configId > 0) {
    where += ' AND config_id = ?';
    params.push(configId);
  }
  return { where, params };
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

  // 上月流量（取上月最新日期记录汇总，用于环比计算）
  const todayBj = todayBeijing();
  const curYear = parseInt(todayBj.substring(0, 4), 10);
  const curMonth = parseInt(todayBj.substring(5, 7), 10);
  const lastMonthYear = curMonth === 1 ? curYear - 1 : curYear;
  const lastMonthNum = curMonth === 1 ? 12 : curMonth - 1;
  const lastMonthStart = `${lastMonthYear}-${String(lastMonthNum).padStart(2, '0')}-01`;
  // 本月的第 0 天即上月最后一天
  const lastMonthEnd = new Date(Date.UTC(curYear, curMonth - 1, 0)).toISOString().split('T')[0];
  let lastMonthTrafficTotal = 0;
  const lastMonthLatest = await dbOne(db, `SELECT MAX(record_date) as max_date FROM traffic_records WHERE record_date BETWEEN ? AND ?`, [lastMonthStart, lastMonthEnd]);
  if (lastMonthLatest?.max_date) {
    const lastStats = await dbOne(db, `SELECT SUM(traffic_total) as traffic_total FROM traffic_records WHERE record_date = ?`, [lastMonthLatest.max_date]);
    lastMonthTrafficTotal = lastStats?.traffic_total || 0;
  }

  // 本月有流量记录的天数（用于预测月底流量：日均 = 本月流量 / 记录天数）
  const recordDaysRow = await dbOne(db, `SELECT COUNT(DISTINCT record_date) as days FROM traffic_records WHERE record_date >= ?`, [monthStart]);
  const recordDays = recordDaysRow?.days || 0;

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
    lastMonthTrafficTotal, recordDays,
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

      // 查询当月累计流量（与 PHP 版一致：QueryInstanceBill 无 Granularity 返回月累计）
      const result = await client.queryInstanceBill(billingCycle);
      if (!result.success) {
        errors.push(`${config.name}: ${result.error}`);
        continue;
      }

      const parsed = parseTrafficData(result.data);
      for (const item of parsed.list) {
        const trafficBytes = Math.round(item.usage * 1024 * 1024 * 1024);

        // 检查是否已有今天记录
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
 * 获取流量统计概览（页面顶部4个统计卡片）
 * 今日流量：今日所有记录合计（不受日期范围影响，受配置筛选影响）
 * 入/出/总流量：日期范围内合计（流量记录为当日用量，直接求和）
 * @param {Request} request - HTTP 请求（含 start_date/end_date/config_id 参数）
 * @param {object} env - 环境变量
 * @returns {Response} JSON 响应
 */
async function getTrafficSummary(request, env) {
  const db = env.DB;
  const url = new URL(request.url);
  const { startDate, endDate, configId } = parseFilterParams(url);
  const { where, params } = buildFilterWhere(startDate, endDate, configId);
  const today = todayBeijing();

  // 今日流量合计
  let todayWhere = 'record_date = ?';
  const todayParams = [today];
  if (configId > 0) {
    todayWhere += ' AND config_id = ?';
    todayParams.push(configId);
  }
  const todayStats = await dbOne(db,
    `SELECT SUM(traffic_in) as traffic_in, SUM(traffic_out) as traffic_out, SUM(traffic_total) as traffic_total
     FROM traffic_records WHERE ${todayWhere}`, todayParams);

  // 日期范围内流量合计
  const totalStats = await dbOne(db,
    `SELECT SUM(traffic_in) as traffic_in, SUM(traffic_out) as traffic_out, SUM(traffic_total) as traffic_total
     FROM traffic_records WHERE ${where}`, params);

  return jsonResponse({
    startDate, endDate, configId,
    today: {
      traffic_in: todayStats?.traffic_in || 0,
      traffic_out: todayStats?.traffic_out || 0,
      traffic_total: todayStats?.traffic_total || 0
    },
    total: {
      traffic_in: totalStats?.traffic_in || 0,
      traffic_out: totalStats?.traffic_out || 0,
      traffic_total: totalStats?.traffic_total || 0
    }
  });
}

/**
 * 获取流量排行 TOP 20（支持日期范围与配置筛选）
 * 按实例汇总日期范围内的入/出/总流量
 * @param {Request} request - HTTP 请求（含 start_date/end_date/config_id 参数）
 * @param {object} env - 环境变量
 * @returns {Response} JSON 响应
 */
async function getTrafficRanking(request, env) {
  const db = env.DB;
  const url = new URL(request.url);
  const { startDate, endDate, configId } = parseFilterParams(url);
  const { where, params } = buildFilterWhere(startDate, endDate, configId);

  // 按实例汇总范围内流量（record_date/config_id 仅存在于 traffic_records，无歧义）
  const ranking = await dbAll(db,
    `SELECT ac.name, tr.instance_id, MAX(tr.instance_name) as instance_name,
       SUM(tr.traffic_in) as traffic_in, SUM(tr.traffic_out) as traffic_out, SUM(tr.traffic_total) as traffic_total
     FROM traffic_records tr JOIN aliyun_config ac ON tr.config_id = ac.id
     WHERE ${where}
     GROUP BY tr.instance_id
     ORDER BY traffic_total DESC LIMIT 20`, params);

  return jsonResponse({ ranking });
}

/**
 * 获取流量趋势（支持日期范围与配置筛选）
 * 按日期汇总每日入/出/总流量，用于双数据线趋势图
 * @param {Request} request - HTTP 请求（含 start_date/end_date/config_id 参数）
 * @param {object} env - 环境变量
 * @returns {Response} JSON 响应
 */
async function getTrafficTrend(request, env) {
  const db = env.DB;
  const url = new URL(request.url);
  const { startDate, endDate, configId } = parseFilterParams(url);
  const { where, params } = buildFilterWhere(startDate, endDate, configId);

  // 按日期分组汇总（流量记录为当日用量，直接求和即为每日用量）
  const trend = await dbAll(db,
    `SELECT record_date, SUM(traffic_in) as traffic_in, SUM(traffic_out) as traffic_out, SUM(traffic_total) as traffic_total
     FROM traffic_records WHERE ${where}
     GROUP BY record_date ORDER BY record_date ASC`, params);

  return jsonResponse({ trend });
}
