/**
 * D1 数据库操作封装
 * 提供便捷的数据库查询方法
 */

/**
 * 执行查询并返回所有结果
 * @param {D1Database} db - D1 数据库绑定
 * @param {string} sql - SQL 语句
 * @param {Array} params - 参数列表
 * @returns {Array} 查询结果数组
 */
export async function dbAll(db, sql, params = []) {
  const stmt = db.prepare(sql).bind(...params);
  const result = await stmt.all();
  return result.results || [];
}

/**
 * 执行查询并返回第一行
 * @param {D1Database} db - D1 数据库绑定
 * @param {string} sql - SQL 语句
 * @param {Array} params - 参数列表
 * @returns {object|null} 查询结果
 */
export async function dbOne(db, sql, params = []) {
  const stmt = db.prepare(sql).bind(...params);
  return await stmt.first();
}

/**
 * 执行写入操作（INSERT/UPDATE/DELETE）
 * @param {D1Database} db - D1 数据库绑定
 * @param {string} sql - SQL 语句
 * @param {Array} params - 参数列表
 * @returns {object} 执行结果
 */
export async function dbRun(db, sql, params = []) {
  const stmt = db.prepare(sql).bind(...params);
  return await stmt.run();
}

/**
 * 获取系统配置值
 * @param {D1Database} db - D1 数据库绑定
 * @param {string} key - 配置键名
 * @param {string} defaultValue - 默认值
 * @returns {string} 配置值
 */
export async function getConfig(db, key, defaultValue = '') {
  const row = await dbOne(db, 'SELECT config_value FROM system_config WHERE config_key = ?', [key]);
  return row ? row.config_value : defaultValue;
}

/**
 * 设置系统配置值（存在则更新，不存在则插入）
 * @param {D1Database} db - D1 数据库绑定
 * @param {string} key - 配置键名
 * @param {string} value - 配置值
 * @param {string} desc - 配置描述（可选）
 */
export async function setConfig(db, key, value, desc = null) {
  const existing = await dbOne(db, 'SELECT id FROM system_config WHERE config_key = ?', [key]);
  if (existing) {
    await dbRun(db, "UPDATE system_config SET config_value = ?, updated_at = datetime('now', '+8 hours') WHERE config_key = ?", [value, key]);
  } else {
    await dbRun(db, 'INSERT INTO system_config (config_key, config_value, config_desc) VALUES (?, ?, ?)', [key, value, desc]);
  }
}

/**
 * 批量执行 SQL（事务）
 * @param {D1Database} db - D1 数据库绑定
 * @param {Array} statements - SQL 语句数组 [{sql, params}]
 * @returns {Array} 执行结果数组
 */
export async function dbBatch(db, statements) {
  const batch = statements.map(s => db.prepare(s.sql).bind(...(s.params || [])));
  return await db.batch(batch);
}
