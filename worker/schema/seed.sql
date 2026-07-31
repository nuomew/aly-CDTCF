-- 阿里云流量查询系统 - 初始数据
-- 适用于 Cloudflare D1

-- 默认系统配置
INSERT OR IGNORE INTO system_config (config_key, config_value, config_desc) VALUES
('site_name', '阿里云流量查询系统', '网站名称'),
('site_description', '云数据传输流量监控平台', '网站描述'),
('auto_refresh_enabled', '0', '是否启用自动刷新'),
('auto_refresh_interval', '5', '自动刷新间隔(分钟)'),
('last_refresh_time', '', '最后刷新时间');

-- 默认邮件模板：流量提醒
INSERT OR IGNORE INTO mail_template (template_key, template_name, subject, body, variables, status) VALUES
('traffic_alert', '流量提醒模板', '【流量提醒】{config_name} 流量已达 {percent}%',
'<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family: Arial, sans-serif; padding: 20px; background: #f5f5f5;">
<div style="max-width: 600px; margin: 0 auto; background: #fff; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
<h2 style="color: #f59e0b; margin-top: 0;">流量使用提醒</h2>
<p>您好，</p>
<p>您的阿里云配置 <strong>{config_name}</strong> 流量使用已达到预设阈值，请注意控制流量使用。</p>
<table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
<tr><td style="padding: 10px; border-bottom: 1px solid #eee; color: #666;">配置名称</td><td style="padding: 10px; border-bottom: 1px solid #eee; font-weight: bold; text-align: right;">{config_name}</td></tr>
<tr><td style="padding: 10px; border-bottom: 1px solid #eee; color: #666;">当前使用流量</td><td style="padding: 10px; border-bottom: 1px solid #eee; font-weight: bold; text-align: right;">{traffic_used} GB</td></tr>
<tr><td style="padding: 10px; border-bottom: 1px solid #eee; color: #666;">最大流量限制</td><td style="padding: 10px; border-bottom: 1px solid #eee; font-weight: bold; text-align: right;">{traffic_max} GB</td></tr>
<tr><td style="padding: 10px; border-bottom: 1px solid #eee; color: #666;">使用比例</td><td style="padding: 10px; border-bottom: 1px solid #eee; font-weight: bold; text-align: right; color: #f59e0b;">{percent}%</td></tr>
<tr><td style="padding: 10px; color: #666;">提醒时间</td><td style="padding: 10px; text-align: right;">{alert_time}</td></tr>
</table>
<p style="color: #999; font-size: 12px;">此邮件由系统自动发送，请勿回复。</p>
</div>
</body>
</html>',
'["config_name","traffic_used","traffic_max","percent","threshold","alert_time"]', 1),

('auto_shutdown', '自动关机模板', '【紧急通知】{config_name} 流量已达 {percent}% 已自动关机',
'<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family: Arial, sans-serif; padding: 20px; background: #f5f5f5;">
<div style="max-width: 600px; margin: 0 auto; background: #fff; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
<h2 style="color: #ef4444; margin-top: 0;">自动关机通知</h2>
<p>您好，</p>
<p>您的阿里云配置 <strong>{config_name}</strong> 流量已达到自动关机阈值，系统已自动关闭该账号下的所有ECS实例。</p>
<table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
<tr><td style="padding: 10px; border-bottom: 1px solid #eee; color: #666;">配置名称</td><td style="padding: 10px; border-bottom: 1px solid #eee; font-weight: bold; text-align: right;">{config_name}</td></tr>
<tr><td style="padding: 10px; border-bottom: 1px solid #eee; color: #666;">当前使用流量</td><td style="padding: 10px; border-bottom: 1px solid #eee; font-weight: bold; text-align: right;">{traffic_used} GB</td></tr>
<tr><td style="padding: 10px; border-bottom: 1px solid #eee; color: #666;">使用比例</td><td style="padding: 10px; border-bottom: 1px solid #eee; font-weight: bold; text-align: right; color: #ef4444;">{percent}%</td></tr>
<tr><td style="padding: 10px; border-bottom: 1px solid #eee; color: #666;">关机阈值</td><td style="padding: 10px; border-bottom: 1px solid #eee; text-align: right;">{shutdown_threshold}%</td></tr>
<tr><td style="padding: 10px; color: #666;">关机时间</td><td style="padding: 10px; text-align: right;">{shutdown_time}</td></tr>
</table>
<p style="color: #666; background: #fef3cd; padding: 15px; border-radius: 8px;">如需提前开机，请登录管理后台手动操作。</p>
<p style="color: #999; font-size: 12px; margin-top: 20px;">此邮件由系统自动发送，请勿回复。</p>
</div>
</body>
</html>',
'["config_name","traffic_used","traffic_max","percent","shutdown_threshold","shutdown_time"]', 1);
