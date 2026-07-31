/**
 * 通用辅助函数模块
 */

/**
 * 返回 JSON 成功响应
 * @param {object} data - 响应数据
 * @param {string} message - 提示消息
 * @returns {Response} JSON 响应
 */
export function jsonResponse(data, message = 'success') {
  return new Response(JSON.stringify({ success: true, message, data }), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  });
}

/**
 * 返回 JSON 错误响应
 * @param {string} message - 错误消息
 * @param {number} status - HTTP 状态码
 * @returns {Response} JSON 响应
 */
export function errorResponse(message, status = 400) {
  return new Response(JSON.stringify({ success: false, message }), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  });
}

/**
 * 格式化字节大小为可读字符串
 * @param {number} bytes - 字节数
 * @param {number} decimals - 小数位数
 * @returns {string} 格式化后的字符串
 */
export function formatBytes(bytes, decimals = 2) {
  bytes = parseFloat(bytes);
  if (bytes < 0 || isNaN(bytes)) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const factor = Math.floor((String(Math.floor(bytes)).length - 1) / 3);

  if (factor >= units.length) return bytes.toFixed(decimals) + ' ' + units[units.length - 1];
  if (factor === 0) return bytes.toFixed(decimals) + ' B';

  return (bytes / Math.pow(1024, factor)).toFixed(decimals) + ' ' + units[factor];
}

/**
 * 格式化 GB 流量
 * @param {number} gb - GB 数值
 * @returns {string} 格式化后的字符串
 */
export function formatGB(gb) {
  gb = parseFloat(gb);
  if (gb >= 1024) return (gb / 1024).toFixed(2) + ' TB';
  return gb.toFixed(2) + ' GB';
}

/**
 * 获取当前北京时间字符串
 * @returns {string} YYYY-MM-DD HH:mm:ss 格式
 */
export function nowBeijing() {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).replace('T', ' ');
}

/**
 * 获取北京时间日期
 * @returns {string} YYYY-MM-DD 格式
 */
export function todayBeijing() {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).split(' ')[0];
}

/**
 * 获取指定天数前的北京时间日期
 * @param {number} days - 天数（负数表示之前）
 * @returns {string} YYYY-MM-DD 格式
 */
export function daysAgoBeijing(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).split(' ')[0];
}

/**
 * 获取本月第一天
 * @returns {string} YYYY-MM-01 格式
 */
export function monthStartBeijing() {
  return todayBeijing().substring(0, 7) + '-01';
}

/**
 * 记录操作日志
 * @param {D1Database} db - D1 数据库绑定
 * @param {number|null} adminId - 管理员 ID
 * @param {string|null} username - 用户名
 * @param {string} action - 操作动作
 * @param {string|null} module - 模块名称
 * @param {string|null} content - 操作内容
 * @param {string|null} ip - IP 地址
 */
export async function logOperation(db, adminId, username, action, module, content, ip) {
  try {
    await db.prepare(
      'INSERT INTO operation_logs (admin_id, username, action, module, content, ip) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(adminId, username, action, module, content, ip).run();
  } catch (e) {
    console.error('记录操作日志失败:', e);
  }
}

/**
 * 解析实例类型为中文描述
 * @param {string} instanceType - 实例类型
 * @returns {string} 中文描述
 */
export function formatInstanceType(instanceType) {
  const map = {
    'ecs.t': '突发性能', 'ecs.s': '共享标准', 'ecs.c': '计算型',
    'ecs.r': '内存型', 'ecs.g': 'GPU型', 'ecs.d': '大数据型',
    'ecs.i': '本地SSD', 'ecs.hf': '高主频', 'ecs.ebm': '裸金属'
  };
  for (const [prefix, label] of Object.entries(map)) {
    if (instanceType && instanceType.startsWith(prefix)) return label;
  }
  return '通用型';
}
