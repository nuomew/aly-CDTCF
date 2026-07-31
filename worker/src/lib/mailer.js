/**
 * 邮件发送模块
 * 使用 Resend API 发送邮件
 */

import { dbOne } from './db.js';

/**
 * 通过 Resend API 发送邮件
 * @param {object} options - 邮件选项
 * @param {string} options.apiKey - Resend API Key
 * @param {string} options.from - 发件人邮箱
 * @param {string} options.fromName - 发件人名称
 * @param {string|string[]} options.to - 收件人邮箱（支持多个）
 * @param {string} options.subject - 邮件主题
 * @param {string} options.html - 邮件正文（HTML）
 * @returns {Promise<object>} 发送结果
 */
export async function sendEmail({ apiKey, from, fromName, to, subject, html }) {
  const toList = typeof to === 'string' ? to.split(',').map(s => s.trim()).filter(Boolean) : to;

  if (!toList.length) {
    return { success: false, error: '收件人邮箱不能为空' };
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: fromName ? `${fromName} <${from}>` : from,
        to: toList,
        subject,
        html
      })
    });

    const result = await response.json();

    if (!response.ok) {
      return { success: false, error: result.message || '邮件发送失败' };
    }

    return { success: true, id: result.id };
  } catch (err) {
    return { success: false, error: '邮件发送失败: ' + err.message };
  }
}

/**
 * 使用默认邮件配置发送邮件
 * @param {D1Database} db - D1 数据库绑定
 * @param {string} to - 收件人（为空时使用配置的默认收件人）
 * @param {string} subject - 邮件主题
 * @param {string} html - 邮件正文
 * @returns {Promise<object>} 发送结果
 */
export async function sendWithDefaultConfig(db, to, subject, html) {
  const config = await dbOne(db, 'SELECT * FROM mail_config WHERE is_default = 1 AND status = 1');
  if (!config) {
    return { success: false, error: '未配置默认邮箱' };
  }

  const recipients = to || config.to_emails;
  if (!recipients) {
    return { success: false, error: '收件人邮箱不能为空' };
  }

  return sendEmail({
    apiKey: config.resend_api_key,
    from: config.from_email,
    fromName: config.from_name,
    to: recipients,
    subject,
    html
  });
}

/**
 * 渲染邮件模板
 * @param {string} template - 模板内容（含 {变量名} 占位符）
 * @param {object} variables - 变量键值对
 * @returns {string} 渲染后的内容
 */
export function renderTemplate(template, variables) {
  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
  }
  return result;
}
