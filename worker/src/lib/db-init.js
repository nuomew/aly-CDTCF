/**
 * D1 数据库自动初始化模块
 * 首次请求时检测表是否存在，不存在则自动创建并插入初始数据
 * 解决一键部署后 D1 数据库为空的问题
 */

// 建表 SQL 数组（逐条执行，避免 exec 对注释的解析问题）
const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS system_config (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  config_key TEXT NOT NULL UNIQUE,
  config_value TEXT,
  config_desc TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))
)`,
  `CREATE TABLE IF NOT EXISTS admin_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  email TEXT,
  nickname TEXT,
  status INTEGER NOT NULL DEFAULT 1,
  login_ip TEXT,
  login_time TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))
)`,
  `CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT NOT NULL UNIQUE,
  admin_id INTEGER NOT NULL,
  ip TEXT,
  user_agent TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))
)`,
  `CREATE TABLE IF NOT EXISTS aliyun_config (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  access_key_id TEXT NOT NULL,
  access_key_secret TEXT NOT NULL,
  region_id TEXT NOT NULL DEFAULT 'cn-hangzhou',
  status INTEGER NOT NULL DEFAULT 1,
  is_default INTEGER NOT NULL DEFAULT 0,
  remark TEXT,
  max_traffic_gb REAL DEFAULT 200.00,
  alert_threshold INTEGER DEFAULT 80,
  shutdown_threshold INTEGER DEFAULT 95,
  auto_shutdown INTEGER DEFAULT 0,
  auto_start_day INTEGER DEFAULT 1,
  auto_start_hour INTEGER DEFAULT 0,
  auto_start_minute INTEGER DEFAULT 0,
  last_auto_shutdown TEXT,
  last_auto_start TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))
)`,
  `CREATE TABLE IF NOT EXISTS traffic_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  config_id INTEGER NOT NULL,
  instance_id TEXT,
  instance_name TEXT,
  instance_type TEXT,
  region_id TEXT,
  traffic_in INTEGER NOT NULL DEFAULT 0,
  traffic_out INTEGER NOT NULL DEFAULT 0,
  traffic_total INTEGER NOT NULL DEFAULT 0,
  bandwidth_in REAL DEFAULT 0.00,
  bandwidth_out REAL DEFAULT 0.00,
  record_date TEXT NOT NULL,
  record_hour INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))
)`,
  `CREATE INDEX IF NOT EXISTS idx_traffic_config_id ON traffic_records(config_id)`,
  `CREATE INDEX IF NOT EXISTS idx_traffic_instance_id ON traffic_records(instance_id)`,
  `CREATE INDEX IF NOT EXISTS idx_traffic_record_date ON traffic_records(record_date)`,
  `CREATE INDEX IF NOT EXISTS idx_traffic_date_instance ON traffic_records(record_date, instance_id)`,
  `CREATE TABLE IF NOT EXISTS operation_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id INTEGER,
  username TEXT,
  action TEXT NOT NULL,
  module TEXT,
  content TEXT,
  ip TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))
)`,
  `CREATE INDEX IF NOT EXISTS idx_logs_admin_id ON operation_logs(admin_id)`,
  `CREATE INDEX IF NOT EXISTS idx_logs_action ON operation_logs(action)`,
  `CREATE INDEX IF NOT EXISTS idx_logs_created_at ON operation_logs(created_at)`,
  `CREATE TABLE IF NOT EXISTS mail_config (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  config_name TEXT NOT NULL,
  resend_api_key TEXT,
  from_email TEXT NOT NULL,
  from_name TEXT,
  to_emails TEXT,
  is_default INTEGER DEFAULT 0,
  status INTEGER DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))
)`,
  `CREATE TABLE IF NOT EXISTS mail_template (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_key TEXT NOT NULL UNIQUE,
  template_name TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  variables TEXT,
  status INTEGER DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))
)`
];

// 初始数据 SQL 数组（逐条执行）
const SEED_STATEMENTS = [
  `INSERT OR IGNORE INTO system_config (config_key, config_value, config_desc) VALUES
  ('site_name', '阿里云流量查询系统', '网站名称'),
  ('site_description', '云数据传输流量监控平台', '网站描述'),
  ('auto_refresh_enabled', '0', '是否启用自动刷新'),
  ('auto_refresh_interval', '5', '自动刷新间隔(分钟)'),
  ('last_refresh_time', '', '最后刷新时间')`,
  `INSERT OR IGNORE INTO mail_template (template_key, template_name, subject, body, variables, status) VALUES
  ('traffic_alert', '流量提醒模板', '【流量提醒】{config_name} 流量已达 {percent}%',
  '<!DOCTYPE html><html><head><meta charset=\"UTF-8\"></head><body style=\"font-family: Arial, sans-serif; padding: 20px; background: #f5f5f5;\"><div style=\"max-width: 600px; margin: 0 auto; background: #fff; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);\"><h2 style=\"color: #f59e0b; margin-top: 0;\">流量使用提醒</h2><p>您好，</p><p>您的阿里云配置 <strong>{config_name}</strong> 流量使用已达到预设阈值，请注意控制流量使用。</p><table style=\"width: 100%; border-collapse: collapse; margin: 20px 0;\"><tr><td style=\"padding: 10px; border-bottom: 1px solid #eee; color: #666;\">配置名称</td><td style=\"padding: 10px; border-bottom: 1px solid #eee; font-weight: bold; text-align: right;\">{config_name}</td></tr><tr><td style=\"padding: 10px; border-bottom: 1px solid #eee; color: #666;\">当前使用流量</td><td style=\"padding: 10px; border-bottom: 1px solid #eee; font-weight: bold; text-align: right;\">{traffic_used} GB</td></tr><tr><td style=\"padding: 10px; border-bottom: 1px solid #eee; color: #666;\">最大流量限制</td><td style=\"padding: 10px; border-bottom: 1px solid #eee; font-weight: bold; text-align: right;\">{traffic_max} GB</td></tr><tr><td style=\"padding: 10px; border-bottom: 1px solid #eee; color: #666;\">使用比例</td><td style=\"padding: 10px; border-bottom: 1px solid #eee; font-weight: bold; text-align: right; color: #f59e0b;\">{percent}%</td></tr><tr><td style=\"padding: 10px; color: #666;\">提醒时间</td><td style=\"padding: 10px; text-align: right;\">{alert_time}</td></tr></table><p style=\"color: #999; font-size: 12px;\">此邮件由系统自动发送，请勿回复。</p></div></body></html>',
  '["config_name","traffic_used","traffic_max","percent","threshold","alert_time"]', 1)`,
  `INSERT OR IGNORE INTO mail_template (template_key, template_name, subject, body, variables, status) VALUES
  ('auto_shutdown', '自动关机模板', '【紧急通知】{config_name} 流量已达 {percent}% 已自动关机',
  '<!DOCTYPE html><html><head><meta charset=\"UTF-8\"></head><body style=\"font-family: Arial, sans-serif; padding: 20px; background: #f5f5f5;\"><div style=\"max-width: 600px; margin: 0 auto; background: #fff; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);\"><h2 style=\"color: #ef4444; margin-top: 0;\">自动关机通知</h2><p>您好，</p><p>您的阿里云配置 <strong>{config_name}</strong> 流量已达到自动关机阈值，系统已自动关闭该账号下的所有ECS实例。</p><table style=\"width: 100%; border-collapse: collapse; margin: 20px 0;\"><tr><td style=\"padding: 10px; border-bottom: 1px solid #eee; color: #666;\">配置名称</td><td style=\"padding: 10px; border-bottom: 1px solid #eee; font-weight: bold; text-align: right;\">{config_name}</td></tr><tr><td style=\"padding: 10px; border-bottom: 1px solid #eee; color: #666;\">当前使用流量</td><td style=\"padding: 10px; border-bottom: 1px solid #eee; font-weight: bold; text-align: right;\">{traffic_used} GB</td></tr><tr><td style=\"padding: 10px; border-bottom: 1px solid #eee; color: #666;\">使用比例</td><td style=\"padding: 10px; border-bottom: 1px solid #eee; font-weight: bold; text-align: right; color: #ef4444;\">{percent}%</td></tr><tr><td style=\"padding: 10px; border-bottom: 1px solid #eee; color: #666;\">关机阈值</td><td style=\"padding: 10px; border-bottom: 1px solid #eee; text-align: right;\">{shutdown_threshold}%</td></tr><tr><td style=\"padding: 10px; color: #666;\">关机时间</td><td style=\"padding: 10px; text-align: right;\">{shutdown_time}</td></tr></table><p style=\"color: #666; background: #fef3cd; padding: 15px; border-radius: 8px;\">如需提前开机，请登录管理后台手动操作。</p><p style=\"color: #999; font-size: 12px; margin-top: 20px;\">此邮件由系统自动发送，请勿回复。</p></div></body></html>',
  '["config_name","traffic_used","traffic_max","percent","shutdown_threshold","shutdown_time"]', 1)`
];

// 初始化状态缓存（同一个 Worker 实例内只检查一次）
let initialized = false;

/**
 * 检查并自动初始化数据库
 * 首次调用时检测表是否存在，不存在则自动创建
 * @param {D1Database} db - D1 数据库绑定
 */
export async function ensureDatabaseInitialized(db) {
  if (initialized) return;

  try {
    // 检测 system_config 表是否存在
    const result = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='system_config'").first();

    if (!result) {
      console.log('数据库表不存在，开始自动初始化...');
      // 逐条执行建表 SQL（避免 exec 对注释的解析问题）
      for (const sql of SCHEMA_STATEMENTS) {
        await db.prepare(sql).run();
      }
      console.log('数据库表创建完成');
      // 逐条执行初始数据 SQL
      for (const sql of SEED_STATEMENTS) {
        await db.prepare(sql).run();
      }
      console.log('初始数据插入完成');
    }

    initialized = true;
  } catch (err) {
    console.error('数据库初始化失败:', err);
    throw err;
  }
}
