/**
 * 阿里云 API 签名与请求模块
 * 支持 BSS（账单）和 ECS（云服务器）API
 * 使用 Web Crypto API 替代 PHP hash_hmac
 */

/**
 * 计算 HMAC-SHA1 签名（兼容阿里云 API）
 * @param {string} stringToSign - 待签名字符串
 * @param {string} secret - 密钥（末尾需加 &）
 * @returns {Promise<string>} Base64 编码的签名
 */
async function hmacSha1(stringToSign, secret) {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret + '&');
  const data = encoder.encode(stringToSign);

  const key = await crypto.subtle.importKey(
    'raw', keyData, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, data);
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

/**
 * URL 编码（兼容阿里云 PercentEncode 规则）
 * @param {string} str - 待编码字符串
 * @returns {string} 编码后的字符串
 */
function percentEncode(str) {
  return encodeURIComponent(str)
    .replace(/\+/g, '%20')
    .replace(/\*/g, '%2A')
    .replace(/%7E/g, '~');
}

/**
 * 生成随机 nonce
 * @returns {string} 随机字符串
 */
function generateNonce() {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array, b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 发送阿里云 API 请求
 * @param {object} options - 请求选项
 * @param {string} options.accessKeyId - AccessKey ID
 * @param {string} options.accessKeySecret - AccessKey Secret
 * @param {string} options.endpoint - API 端点域名
 * @param {string} options.apiVersion - API 版本号
 * @param {object} options.params - 请求参数
 * @param {number} [options.timeout=30000] - 超时时间(毫秒)
 * @returns {Promise<object>} API 响应结果
 */
export async function aliyunRequest({ accessKeyId, accessKeySecret, endpoint, apiVersion, params, timeout = 30000 }) {
  const publicParams = {
    Format: 'JSON',
    Version: apiVersion,
    AccessKeyId: accessKeyId,
    SignatureMethod: 'HMAC-SHA1',
    Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    SignatureVersion: '1.0',
    SignatureNonce: generateNonce()
  };

  const allParams = { ...publicParams, ...params };

  // 按 key 排序
  const sortedKeys = Object.keys(allParams).sort();
  let canonicalizedQueryString = '';
  for (const key of sortedKeys) {
    canonicalizedQueryString += '&' + percentEncode(key) + '=' + percentEncode(allParams[key]);
  }

  const stringToSign = 'GET&%2F&' + percentEncode(canonicalizedQueryString.substring(1));
  const signature = await hmacSha1(stringToSign, accessKeySecret);
  allParams.Signature = signature;

  const queryString = Object.entries(allParams)
    .map(([k, v]) => percentEncode(k) + '=' + percentEncode(v))
    .join('&');

  const url = `https://${endpoint}/?${queryString}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': 'AliyunAPI-CF-Worker/1.0' },
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    const result = await response.json();

    // 检查响应码
    const code = result.Code;
    let isSuccess = false;

    if (code === 200 || code === '200') {
      isSuccess = true;
    } else if (typeof code === 'string' && code.toLowerCase() === 'success') {
      isSuccess = true;
    } else if (result.Success === true) {
      isSuccess = true;
    }

    if (!isSuccess && code !== undefined && code !== null) {
      return {
        success: false,
        error: (result.Message || '请求失败') + ' (Code: ' + code + ')',
        code: code,
        requestId: result.RequestId || ''
      };
    }

    return {
      success: true,
      data: result.Data || result,
      requestId: result.RequestId || ''
    };
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      return { success: false, error: 'API请求超时', code: -1 };
    }
    return { success: false, error: '请求失败: ' + err.message, code: -1 };
  }
}

// ==================== BSS 账单 API ====================

/**
 * 创建 BSS 账单 API 客户端
 * @param {string} accessKeyId - AccessKey ID
 * @param {string} accessKeySecret - AccessKey Secret
 * @returns {object} BSS API 客户端
 */
export function createBssClient(accessKeyId, accessKeySecret) {
  return {
    /**
     * 查询 CDT 流量月账单
     * @param {string} billingCycle - 账期 YYYY-MM
     * @param {number} pageNum - 页码
     * @param {number} pageSize - 每页数量
     * @returns {Promise<object>} 账单数据
     */
    async queryInstanceBill(billingCycle, pageNum = 1, pageSize = 100) {
      return aliyunRequest({
        accessKeyId, accessKeySecret,
        endpoint: 'business.aliyuncs.com',
        apiVersion: '2017-12-14',
        params: {
          Action: 'QueryInstanceBill',
          BillingCycle: billingCycle,
          ProductCode: 'cdt',
          PageNum: pageNum,
          PageSize: pageSize,
          IsBillingItem: 'true'
        }
      });
    },

    /**
     * 查询 CDT 流量按日明细
     * @param {string} billingDate - 账单日期 YYYY-MM-DD
     * @param {number} pageNum - 页码
     * @param {number} pageSize - 每页数量
     * @returns {Promise<object>} 日明细数据
     */
    async queryDailyBill(billingDate, pageNum = 1, pageSize = 300) {
      const billingCycle = billingDate.substring(0, 7);
      return aliyunRequest({
        accessKeyId, accessKeySecret,
        endpoint: 'business.aliyuncs.com',
        apiVersion: '2017-12-14',
        params: {
          Action: 'QueryInstanceBill',
          BillingCycle: billingCycle,
          BillingDate: billingDate,
          ProductCode: 'cdt',
          Granularity: 'DAILY',
          PageNum: pageNum,
          PageSize: pageSize,
          IsBillingItem: 'true'
        }
      });
    },

    /**
     * 测试 API 连接
     * @returns {Promise<object>} 测试结果
     */
    async testConnection() {
      return aliyunRequest({
        accessKeyId, accessKeySecret,
        endpoint: 'business.aliyuncs.com',
        apiVersion: '2017-12-14',
        params: { Action: 'QueryAccountBalance' }
      });
    }
  };
}

// ==================== ECS 云服务器 API ====================

/**
 * 获取 ECS API 端点
 * @param {string} regionId - 地域 ID
 * @returns {string} API 端点域名
 */
function getEcsEndpoint(regionId) {
  return `ecs.${regionId}.aliyuncs.com`;
}

/**
 * 创建 ECS 云服务器 API 客户端
 * @param {string} accessKeyId - AccessKey ID
 * @param {string} accessKeySecret - AccessKey Secret
 * @param {string} regionId - 地域 ID
 * @returns {object} ECS API 客户端
 */
export function createEcsClient(accessKeyId, accessKeySecret, regionId = 'cn-hangzhou') {
  const endpoint = getEcsEndpoint(regionId);
  const apiVersion = '2014-05-26';

  const request = (params) => aliyunRequest({
    accessKeyId, accessKeySecret, endpoint, apiVersion, params
  });

  return {
    /** 查询实例列表 */
    async describeInstances(pageNum = 1, pageSize = 50, status = '') {
      const params = { Action: 'DescribeInstances', RegionId: regionId, PageNumber: pageNum, PageSize: pageSize };
      if (status) params.Status = status;
      return request(params);
    },

    /** 查询实例详情 */
    async describeInstanceAttribute(instanceId) {
      return request({ Action: 'DescribeInstanceAttribute', InstanceId: instanceId, RegionId: regionId });
    },

    /** 查询实例状态 */
    async describeInstanceStatus(instanceId) {
      return request({ Action: 'DescribeInstanceStatus', RegionId: regionId, 'InstanceId.1': instanceId });
    },

    /** 启动实例 */
    async startInstance(instanceId) {
      return request({ Action: 'StartInstance', InstanceId: instanceId, RegionId: regionId });
    },

    /** 停止实例 */
    async stopInstance(instanceId, forceStop = false) {
      return request({
        Action: 'StopInstance', InstanceId: instanceId, RegionId: regionId,
        ForceStop: forceStop ? 'true' : 'false'
      });
    },

    /** 重启实例 */
    async rebootInstance(instanceId, forceStop = false) {
      return request({
        Action: 'RebootInstance', InstanceId: instanceId, RegionId: regionId,
        ForceReboot: forceStop ? 'true' : 'false'
      });
    },

    /** 查询 VNC 连接地址 */
    async describeInstanceVncUrl(instanceId) {
      return request({ Action: 'DescribeInstanceVncUrl', InstanceId: instanceId, RegionId: regionId });
    },

    /** 查询镜像列表 */
    async describeImages(imageOwnerAlias = '', pageNum = 1, pageSize = 50) {
      const params = { Action: 'DescribeImages', RegionId: regionId, PageNumber: pageNum, PageSize: pageSize };
      if (imageOwnerAlias) params.ImageOwnerAlias = imageOwnerAlias;
      return request(params);
    },

    /** 更换系统盘（重装系统） */
    async replaceSystemDisk(instanceId, imageId, password = '') {
      const params = { Action: 'ReplaceSystemDisk', InstanceId: instanceId, ImageId: imageId, RegionId: regionId };
      if (password) params.Password = password;
      return request(params);
    },

    /** 查询云盘列表 */
    async describeDisks(instanceId = '') {
      const params = { Action: 'DescribeDisks', RegionId: regionId, PageSize: 50 };
      if (instanceId) params.InstanceId = instanceId;
      return request(params);
    },

    /** 修改实例属性 */
    async modifyInstanceAttribute(instanceId, instanceName = '') {
      const params = { Action: 'ModifyInstanceAttribute', InstanceId: instanceId };
      if (instanceName) params.InstanceName = instanceName;
      return request(params);
    },

    /** 查询密钥对列表 */
    async describeKeyPairs(pageNum = 1, pageSize = 50) {
      return request({ Action: 'DescribeKeyPairs', RegionId: regionId, PageNumber: pageNum, PageSize: pageSize });
    },

    /** 查询安全组列表 */
    async describeSecurityGroups(vpcId = '') {
      const params = { Action: 'DescribeSecurityGroups', RegionId: regionId, PageSize: 50 };
      if (vpcId) params.VpcId = vpcId;
      return request(params);
    }
  };
}

// ==================== 辅助格式化函数 ====================

/**
 * 格式化实例状态为中文
 * @param {string} status - 状态英文
 * @returns {string} 状态中文
 */
export function formatEcsStatus(status) {
  const map = {
    Pending: '创建中', Running: '运行中', Starting: '启动中',
    Stopping: '停止中', Stopped: '已停止', Rebooting: '重启中',
    Deleted: '已删除', Suspended: '已暂停', Migrating: '迁移中'
  };
  return map[status] || status;
}

/**
 * 格式化付费类型为中文
 * @param {string} type - 付费类型
 * @returns {string} 中文描述
 */
export function formatChargeType(type) {
  const map = {
    PrePaid: '包年包月', PostPaid: '按量付费',
    Subscription: '包年包月', PayAsYouGo: '按量付费',
    PayByBandwidth: '按固定带宽', PayByTraffic: '按使用流量'
  };
  return map[type] || type;
}

/**
 * 解析流量数据
 * @param {object} billData - 账单数据
 * @returns {object} 解析后的流量信息
 */
export function parseTrafficData(billData) {
  const trafficList = [];
  let totalUsage = 0;
  let totalCost = 0;

  if (!billData?.Items?.Item && !billData?.Items) {
    return { list: [], totalUsage: 0, totalCost: 0, totalUsageFormatted: '0 GB' };
  }

  let items = billData.Items.Item || billData.Items;
  if (items.InstanceID) items = [items];

  for (const item of items) {
    const usage = parseFloat(item.Usage || 0);
    const usageUnit = item.UsageUnit || 'GB';
    const cost = parseFloat(item.PretaxAmount || 0);

    let usageGB = usage;
    if (/mb/i.test(usageUnit)) usageGB = usage / 1024;
    else if (/tb/i.test(usageUnit)) usageGB = usage * 1024;

    totalUsage += usageGB;
    totalCost += cost;

    trafficList.push({
      instanceId: item.InstanceID || '',
      region: item.Region || '',
      billingItem: item.BillingItem || '',
      productDetail: item.ProductDetail || '',
      usage: usageGB,
      usageUnit: 'GB',
      cost,
      nickName: item.NickName || '',
      internetIP: item.InternetIP || '',
      billingDate: item.BillingDate || '',
      tag: item.Tag || ''
    });
  }

  return { list: trafficList, totalUsage, totalCost };
}
