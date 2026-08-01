/**
 * ECS 服务器管理路由模块
 * 处理实例查询、开关机、重启、重装、VNC
 */

import { dbAll, dbOne } from '../lib/db.js';
import { createEcsClient, formatEcsStatus, formatChargeType } from '../lib/aliyun-api.js';
import { decryptData, encryptData } from '../lib/auth.js';
import { jsonResponse, errorResponse, logOperation, formatInstanceType } from '../lib/helpers.js';

/**
 * 处理 ECS 相关路由
 * @param {Request} request - HTTP 请求
 * @param {object} env - 环境变量
 * @returns {Response} JSON 响应
 */
export async function handleEcsRoutes(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  // 获取实例列表
  if (path === '/api/ecs/instances') {
    return await getInstances(request, env);
  }

  // 获取实例详情
  if (path === '/api/ecs/instance/detail') {
    return await getInstanceDetail(request, env);
  }

  // 实例操作（开机/关机/重启）
  if (path === '/api/ecs/instance/action' && method === 'POST') {
    return await instanceAction(request, env);
  }

  // 获取 VNC 连接地址
  if (path === '/api/ecs/instance/vnc' && method === 'POST') {
    return await getVncUrl(request, env);
  }

  // 重装系统
  if (path === '/api/ecs/instance/reinstall' && method === 'POST') {
    return await reinstallInstance(request, env);
  }

  // 查询实例状态
  if (path === '/api/ecs/instance/status') {
    return await getInstanceStatus(request, env);
  }

  return errorResponse('接口不存在', 404);
}

/**
 * 获取所有配置下的实例列表
 */
async function getInstances(request, env) {
  const db = env.DB;
  const secret = env.APP_SECRET;
  const configId = new URL(request.url).searchParams.get('config_id');

  let configs;
  if (configId) {
    configs = await dbAll(db, 'SELECT * FROM aliyun_config WHERE id = ? AND status = 1', [configId]);
  } else {
    configs = await dbAll(db, 'SELECT * FROM aliyun_config WHERE status = 1');
  }

  if (!configs.length) {
    return jsonResponse({ instances: [], errors: [], message: '暂无启用的阿里云配置' });
  }

  const allInstances = [];
  const errors = [];

  for (const config of configs) {
    try {
      const keySecret = await decryptData(config.access_key_secret, secret);
      const client = createEcsClient(config.access_key_id, keySecret, config.region_id);
      const result = await client.describeInstances();

      if (!result.success) {
        errors.push({ configName: config.name, error: result.error || '未知错误' });
        continue;
      }

      if (result.data?.Instances?.Instance) {
        const instances = result.data.Instances.Instance;
        for (const inst of instances) {
          allInstances.push({
            configId: config.id,
            configName: config.name,
            instanceId: inst.InstanceId,
            instanceName: inst.InstanceName || '',
            status: inst.Status,
            statusText: formatEcsStatus(inst.Status),
            instanceType: inst.InstanceType || '',
            instanceTypeText: formatInstanceType(inst.InstanceType || ''),
            regionId: inst.RegionId,
            publicIp: inst.PublicIpAddress?.IpAddress?.[0] || inst.EipAddress?.IpAddress || '',
            privateIp: inst.VpcAttributes?.PrivateIpAddress?.IpAddress?.[0] || '',
            osName: inst.OSName || '',
            creationTime: inst.CreationTime || '',
            expiredTime: inst.ExpiredTime || '',
            chargeType: inst.InstanceChargeType || '',
            chargeTypeText: formatChargeType(inst.InstanceChargeType || ''),
            bandwidth: inst.InternetMaxBandwidthOut || 0
          });
        }
      }
    } catch (err) {
      console.error(`获取实例列表失败 [${config.name}]:`, err);
      errors.push({ configName: config.name, error: err.message || String(err) });
    }
  }

  return jsonResponse({ instances: allInstances, errors });
}

/**
 * 获取实例详情
 */
async function getInstanceDetail(request, env) {
  const url = new URL(request.url);
  const configId = url.searchParams.get('config_id');
  const instanceId = url.searchParams.get('instance_id');

  if (!configId || !instanceId) return errorResponse('缺少参数');

  const config = await dbOne(env.DB, 'SELECT * FROM aliyun_config WHERE id = ?', [configId]);
  if (!config) return errorResponse('配置不存在', 404);

  const keySecret = await decryptData(config.access_key_secret, env.APP_SECRET);
  const client = createEcsClient(config.access_key_id, keySecret, config.region_id);

  const result = await client.describeInstanceAttribute(instanceId);
  if (!result.success) return errorResponse('获取实例详情失败: ' + result.error);

  const data = result.data;
  return jsonResponse({
    instanceId: data.InstanceId,
    instanceName: data.InstanceName || '',
    description: data.Description || '',
    status: data.Status,
    statusText: formatEcsStatus(data.Status),
    instanceType: data.InstanceType || '',
    osName: data.OSName || '',
    regionId: data.RegionId,
    publicIp: data.PublicIpAddress?.IpAddress || [],
    innerIp: data.InnerIpAddress?.IpAddress || [],
    vpcId: data.VpcAttributes?.VpcId || '',
    vswitchId: data.VpcAttributes?.VSwitchId || '',
    securityGroupIds: data.SecurityGroupIds?.SecurityGroupId || [],
    internetChargeType: data.InternetChargeType || '',
    internetMaxBandwidthIn: data.InternetMaxBandwidthIn || 0,
    internetMaxBandwidthOut: data.InternetMaxBandwidthOut || 0,
    creationTime: data.CreationTime || '',
    expiredTime: data.ExpiredTime || '',
    imageId: data.ImageId || '',
    cpu: data.Cpu || 0,
    memory: data.Memory || 0
  });
}

/**
 * 实例操作（开机/关机/重启）
 */
async function instanceAction(request, env) {
  const { config_id, instance_id, action } = await request.json();

  if (!config_id || !instance_id || !action) {
    return errorResponse('缺少必要参数');
  }

  const config = await dbOne(env.DB, 'SELECT * FROM aliyun_config WHERE id = ?', [config_id]);
  if (!config) return errorResponse('配置不存在', 404);

  const keySecret = await decryptData(config.access_key_secret, env.APP_SECRET);
  const client = createEcsClient(config.access_key_id, keySecret, config.region_id);

  let result;
  const actionMap = {
    start: () => client.startInstance(instance_id),
    stop: () => client.stopInstance(instance_id),
    reboot: () => client.rebootInstance(instance_id)
  };

  if (!actionMap[action]) return errorResponse('不支持的操作: ' + action);

  result = await actionMap[action]();

  if (result.success) {
    const actionText = { start: '开机', stop: '关机', reboot: '重启' };
    await logOperation(env.DB, request.admin.id, request.admin.username, `ecs_${action}`, 'ECS', `${actionText[action]}实例: ${instance_id}`, '');
    return jsonResponse(null, `实例${actionText[action]}指令已发送`);
  }
  return errorResponse(`操作失败: ${result.error}`);
}

/**
 * 获取 VNC 连接地址
 */
async function getVncUrl(request, env) {
  const { config_id, instance_id } = await request.json();

  const config = await dbOne(env.DB, 'SELECT * FROM aliyun_config WHERE id = ?', [config_id]);
  if (!config) return errorResponse('配置不存在', 404);

  const keySecret = await decryptData(config.access_key_secret, env.APP_SECRET);
  const client = createEcsClient(config.access_key_id, keySecret, config.region_id);

  const result = await client.describeInstanceVncUrl(instance_id);
  if (!result.success) return errorResponse('获取VNC地址失败: ' + result.error);

  return jsonResponse({
    vncUrl: result.data?.VncUrl || '',
    connectUrl: `https://ecs.console.aliyun.com/vnc/${instance_id}?regionId=${config.region_id}`
  });
}

/**
 * 重装系统
 */
async function reinstallInstance(request, env) {
  const { config_id, instance_id, image_id, password } = await request.json();

  const config = await dbOne(env.DB, 'SELECT * FROM aliyun_config WHERE id = ?', [config_id]);
  if (!config) return errorResponse('配置不存在', 404);

  const keySecret = await decryptData(config.access_key_secret, env.APP_SECRET);
  const client = createEcsClient(config.access_key_id, keySecret, config.region_id);

  // 先停止实例
  await client.stopInstance(instance_id, true);
  await logOperation(env.DB, request.admin.id, request.admin.username, 'ecs_reinstall', 'ECS', `重装系统实例: ${instance_id}`, '');

  const result = await client.replaceSystemDisk(instance_id, image_id, password || '');
  if (result.success) {
    return jsonResponse({ diskId: result.data?.DiskId }, '重装系统指令已发送');
  }
  return errorResponse('重装失败: ' + result.error);
}

/**
 * 查询实例状态
 */
async function getInstanceStatus(request, env) {
  const url = new URL(request.url);
  const configId = url.searchParams.get('config_id');
  const instanceId = url.searchParams.get('instance_id');

  const config = await dbOne(env.DB, 'SELECT * FROM aliyun_config WHERE id = ?', [configId]);
  if (!config) return errorResponse('配置不存在', 404);

  const keySecret = await decryptData(config.access_key_secret, env.APP_SECRET);
  const client = createEcsClient(config.access_key_id, keySecret, config.region_id);

  const result = await client.describeInstanceStatus(instanceId);
  if (!result.success) return errorResponse('查询状态失败: ' + result.error);

  const status = result.data?.InstanceStatuses?.InstanceStatus?.[0];
  return jsonResponse({
    instanceId: status?.InstanceId,
    status: status?.Status,
    statusText: formatEcsStatus(status?.Status)
  });
}
