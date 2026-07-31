/**
 * Cron Triggers 定时任务模块
 * 负责定时刷新流量数据、检查告警阈值、自动开关机
 */

import { dbAll, dbOne, dbRun, getConfig, setConfig } from '../lib/db.js';
import { createBssClient, createEcsClient, parseTrafficData } from '../lib/aliyun-api.js';
import { decryptData } from '../lib/auth.js';
import { nowBeijing, todayBeijing, formatBytes } from '../lib/helpers.js';
import { sendEmail, renderTemplate } from '../lib/mailer.js';

/**
 * 处理定时任务
 * @param {object} env - 环境变量
 */
export async function handleCronTask(env) {
  const db = env.DB;
  const secret = env.APP_SECRET;

  console.log('[Cron] 开始执行定时任务');

  // 1. 刷新流量数据
  await refreshAllTraffic(db, secret);

  // 2. 检查告警阈值
  await checkAlertThresholds(db, secret);

  // 3. 检查自动关机
  await checkAutoShutdown(db, secret);

  // 4. 检查自动开机
  await checkAutoStart(db, secret);

  // 5. 清理过期会话
  await dbRun(db, "DELETE FROM sessions WHERE expires_at < datetime('now')");

  // 更新最后刷新时间
  await setConfig(db, 'last_refresh_time', nowBeijing());

  console.log('[Cron] 定时任务执行完成');
}

/**
 * 刷新所有配置的流量数据
 */
async function refreshAllTraffic(db, secret) {
  const configs = await dbAll(db, 'SELECT * FROM aliyun_config WHERE status = 1');
  const billingDate = todayBeijing();

  for (const config of configs) {
    try {
      const keySecret = await decryptData(config.access_key_secret, secret);
      const client = createBssClient(config.access_key_id, keySecret);

      const result = await client.queryDailyBill(billingDate);
      if (!result.success) {
        console.error(`[Cron] 刷新流量失败 [${config.name}]:`, result.error);
        continue;
      }

      const parsed = parseTrafficData(result.data);
      for (const item of parsed.list) {
        const trafficBytes = Math.round(item.usage * 1024 * 1024 * 1024);
        const existing = await dbOne(db,
          'SELECT id FROM traffic_records WHERE config_id = ? AND instance_id = ? AND record_date = ?',
          [config.id, item.instanceId, billingDate]);

        if (existing) {
          await dbRun(db, "UPDATE traffic_records SET traffic_out = ?, traffic_total = ?, instance_name = ?, region_id = ?, updated_at = datetime('now', '+8 hours') WHERE id = ?",
            [trafficBytes, trafficBytes, item.nickName, item.region, existing.id]);
        } else {
          await dbRun(db,
            'INSERT INTO traffic_records (config_id, instance_id, instance_name, region_id, traffic_out, traffic_total, record_date) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [config.id, item.instanceId, item.nickName, item.region, trafficBytes, trafficBytes, billingDate]);
        }
      }
      console.log(`[Cron] 流量刷新完成 [${config.name}]: ${parsed.list.length}条记录`);
    } catch (err) {
      console.error(`[Cron] 刷新异常 [${config.name}]:`, err);
    }
  }
}

/**
 * 检查告警阈值并发送邮件
 */
async function checkAlertThresholds(db, secret) {
  const configs = await dbAll(db, 'SELECT * FROM aliyun_config WHERE status = 1');
  const monthStart = todayBeijing().substring(0, 7) + '-01';

  for (const config of configs) {
    try {
      // 获取最新流量记录
      const record = await dbOne(db,
        'SELECT traffic_total FROM traffic_records WHERE config_id = ? AND record_date >= ? ORDER BY record_date DESC LIMIT 1',
        [config.id, monthStart]);

      if (!record) continue;

      const trafficGB = record.traffic_total / 1024 / 1024 / 1024;
      const maxTraffic = parseFloat(config.max_traffic_gb || 200);
      const alertThreshold = parseInt(config.alert_threshold || 80);
      const percent = maxTraffic > 0 ? Math.round((trafficGB / maxTraffic) * 100 * 10) / 10 : 0;

      if (percent >= alertThreshold) {
        // 检查今天是否已发送过提醒
        const todayAlert = await dbOne(db,
          "SELECT id FROM operation_logs WHERE action = 'traffic_alert' AND content LIKE ? AND created_at >= date('now', '+8 hours', 'start of day')",
          [`%${config.name}%`]);

        if (!todayAlert) {
          // 发送流量提醒邮件
          const template = await dbOne(db, "SELECT * FROM mail_template WHERE template_key = 'traffic_alert' AND status = 1");
          if (template) {
            const html = renderTemplate(template.body, {
              config_name: config.name,
              traffic_used: trafficGB.toFixed(2),
              traffic_max: maxTraffic.toFixed(0),
              percent: percent.toString(),
              threshold: alertThreshold.toString(),
              alert_time: nowBeijing()
            });

            await sendWithDefaultConfig(db, null, renderTemplate(template.subject, { config_name: config.name, percent: percent.toString() }), html);
          }

          // 记录日志
          await dbRun(db, "INSERT INTO operation_logs (action, module, content) VALUES ('traffic_alert', '告警', ?)",
            [`${config.name} 流量达${percent}%，已发送提醒`]);
        }
      }
    } catch (err) {
      console.error(`[Cron] 告警检查异常 [${config.name}]:`, err);
    }
  }
}

/**
 * 检查自动关机
 */
async function checkAutoShutdown(db, secret) {
  const configs = await dbAll(db,
    "SELECT * FROM aliyun_config WHERE status = 1 AND auto_shutdown = 1 AND (last_auto_shutdown IS NULL OR last_auto_shutdown < date('now', '+8 hours', 'start of month'))");
  const monthStart = todayBeijing().substring(0, 7) + '-01';

  for (const config of configs) {
    try {
      const record = await dbOne(db,
        'SELECT traffic_total FROM traffic_records WHERE config_id = ? AND record_date >= ? ORDER BY record_date DESC LIMIT 1',
        [config.id, monthStart]);

      if (!record) continue;

      const trafficGB = record.traffic_total / 1024 / 1024 / 1024;
      const maxTraffic = parseFloat(config.max_traffic_gb || 200);
      const shutdownThreshold = parseInt(config.shutdown_threshold || 95);
      const percent = maxTraffic > 0 ? Math.round((trafficGB / maxTraffic) * 100) : 0;

      if (percent >= shutdownThreshold) {
        console.log(`[Cron] 触发自动关机 [${config.name}]: ${percent}%`);

        const keySecret = await decryptData(config.access_key_secret, secret);
        const client = createEcsClient(config.access_key_id, keySecret, config.region_id);
        const instances = await client.describeInstances();

        let shutdownCount = 0;
        if (instances.success && instances.data?.Instances?.Instance) {
          for (const inst of instances.data.Instances.Instance) {
            if (inst.Status === 'Running') {
              await client.stopInstance(inst.InstanceId);
              shutdownCount++;
            }
          }
        }

        // 更新最后自动关机时间
        await dbRun(db, "UPDATE aliyun_config SET last_auto_shutdown = datetime('now', '+8 hours') WHERE id = ?", [config.id]);

        // 发送关机通知邮件
        const template = await dbOne(db, "SELECT * FROM mail_template WHERE template_key = 'auto_shutdown' AND status = 1");
        if (template) {
          const html = renderTemplate(template.body, {
            config_name: config.name,
            traffic_used: trafficGB.toFixed(2),
            traffic_max: maxTraffic.toFixed(0),
            percent: percent.toString(),
            shutdown_threshold: shutdownThreshold.toString(),
            shutdown_count: shutdownCount.toString(),
            shutdown_time: nowBeijing()
          });

          await sendWithDefaultConfig(db, null, renderTemplate(template.subject, { config_name: config.name, percent: percent.toString() }), html);
        }

        await dbRun(db, "INSERT INTO operation_logs (action, module, content) VALUES ('auto_shutdown', '自动关机', ?)",
          [`${config.name} 流量达${percent}%，已自动关闭${shutdownCount}台实例`]);
      }
    } catch (err) {
      console.error(`[Cron] 自动关机异常 [${config.name}]:`, err);
    }
  }
}

/**
 * 检查自动开机
 */
async function checkAutoStart(db, secret) {
  const now = new Date();
  const beijingHour = parseInt(now.toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).split(' ')[1].split(':')[0]);
  const beijingMinute = parseInt(now.toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).split(' ')[1].split(':')[1]);
  const beijingDay = parseInt(now.toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).split(' ')[0].split('-')[2]);

  const configs = await dbAll(db, 'SELECT * FROM aliyun_config WHERE status = 1 AND auto_shutdown = 1');

  for (const config of configs) {
    try {
      const startDay = parseInt(config.auto_start_day || 1);
      const startHour = parseInt(config.auto_start_hour || 0);
      const startMinute = parseInt(config.auto_start_minute || 0);

      // 检查是否到了开机时间（允许5分钟窗口）
      if (beijingDay === startDay && beijingHour === startHour && Math.abs(beijingMinute - startMinute) <= 5) {
        // 检查本月是否已自动开过机
        if (config.last_auto_start && config.last_auto_start >= todayBeijing().substring(0, 7) + '-01') {
          continue;
        }

        console.log(`[Cron] 触发自动开机 [${config.name}]`);

        const keySecret = await decryptData(config.access_key_secret, secret);
        const client = createEcsClient(config.access_key_id, keySecret, config.region_id);
        const instances = await client.describeInstances();

        let startCount = 0;
        if (instances.success && instances.data?.Instances?.Instance) {
          for (const inst of instances.data.Instances.Instance) {
            if (inst.Status === 'Stopped') {
              await client.startInstance(inst.InstanceId);
              startCount++;
            }
          }
        }

        await dbRun(db, "UPDATE aliyun_config SET last_auto_start = datetime('now', '+8 hours') WHERE id = ?", [config.id]);

        await dbRun(db, "INSERT INTO operation_logs (action, module, content) VALUES ('auto_start', '自动开机', ?)",
          [`${config.name} 定时开机，已启动${startCount}台实例`]);
      }
    } catch (err) {
      console.error(`[Cron] 自动开机异常 [${config.name}]:`, err);
    }
  }
}
