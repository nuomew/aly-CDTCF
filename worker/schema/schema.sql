-- 阿里云流量查询系统 - D1 数据库结构 (SQLite)
-- Cloudflare D1 版本

-- 系统配置表
CREATE TABLE IF NOT EXISTS system_config (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  config_key TEXT NOT NULL UNIQUE,
  config_value TEXT,
  config_desc TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))
);

-- 管理员表
CREATE TABLE IF NOT EXISTS admin_users (
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
);

-- 会话表（替代PHP Session）
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT NOT NULL UNIQUE,
  admin_id INTEGER NOT NULL,
  ip TEXT,
  user_agent TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))
);

-- 阿里云配置表
CREATE TABLE IF NOT EXISTS aliyun_config (
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
);

-- 流量记录表
CREATE TABLE IF NOT EXISTS traffic_records (
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
);

CREATE INDEX IF NOT EXISTS idx_traffic_config_id ON traffic_records(config_id);
CREATE INDEX IF NOT EXISTS idx_traffic_instance_id ON traffic_records(instance_id);
CREATE INDEX IF NOT EXISTS idx_traffic_record_date ON traffic_records(record_date);
CREATE INDEX IF NOT EXISTS idx_traffic_date_instance ON traffic_records(record_date, instance_id);

-- 操作日志表
CREATE TABLE IF NOT EXISTS operation_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id INTEGER,
  username TEXT,
  action TEXT NOT NULL,
  module TEXT,
  content TEXT,
  ip TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))
);

CREATE INDEX IF NOT EXISTS idx_logs_admin_id ON operation_logs(admin_id);
CREATE INDEX IF NOT EXISTS idx_logs_action ON operation_logs(action);
CREATE INDEX IF NOT EXISTS idx_logs_created_at ON operation_logs(created_at);

-- 邮箱配置表
CREATE TABLE IF NOT EXISTS mail_config (
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
);

-- 邮件模板表
CREATE TABLE IF NOT EXISTS mail_template (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_key TEXT NOT NULL UNIQUE,
  template_name TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  variables TEXT,
  status INTEGER DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))
);
