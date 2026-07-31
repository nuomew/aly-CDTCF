/**
 * 公共认证辅助函数
 * 使用 localStorage + Authorization Header 替代 Cookie（Cloudflare Workers 兼容）
 */

/**
 * 获取存储的认证 token
 * @returns {string|null} token
 */
function getAuthToken() {
  return localStorage.getItem('at_session');
}

/**
 * 设置认证 token
 * @param {string} token - 认证 token
 */
function setAuthToken(token) {
  localStorage.setItem('at_session', token);
}

/**
 * 清除认证 token
 */
function clearAuthToken() {
  localStorage.removeItem('at_session');
}

/**
 * 创建带认证的 fetch 请求头
 * @returns {object} fetch options 中的 headers
 */
function authHeaders() {
  var headers = { 'Content-Type': 'application/json' };
  var token = getAuthToken();
  if (token) {
    headers['Authorization'] = 'Bearer ' + token;
  }
  return headers;
}

/**
 * 带认证的 fetch GET 请求
 * @param {string} url - 请求 URL
 * @returns {Promise<object>} JSON 响应
 */
function authFetch(url) {
  return fetch(url, {
    headers: authHeaders()
  }).then(function(r) { return r.json(); });
}

/**
 * 带认证的 fetch POST/PUT/DELETE 请求
 * @param {string} url - 请求 URL
 * @param {string} method - HTTP 方法
 * @param {object} body - 请求体
 * @returns {Promise<object>} JSON 响应
 */
function authFetchJSON(url, method, body) {
  return fetch(url, {
    method: method || 'POST',
    headers: authHeaders(),
    body: body ? JSON.stringify(body) : undefined
  }).then(function(r) { return r.json(); });
}

/**
 * 检查登录状态，未登录则跳转到登录页
 * @param {function} callback - 登录成功后的回调，参数为 admin 对象
 */
function checkLoginStatus(callback) {
  authFetch('/api/auth/check').then(function(d) {
    if (d.success && d.data && d.data.logged_in) {
      if (callback) callback(d.data.admin);
    } else {
      window.location.href = 'login.html';
    }
  }).catch(function() {
    window.location.href = 'login.html';
  });
}

/**
 * 注销登录
 */
function logout() {
  authFetchJSON('/api/auth/logout', 'POST').then(function() {
    clearAuthToken();
    window.location.href = 'login.html';
  }).catch(function() {
    clearAuthToken();
    window.location.href = 'login.html';
  });
}
