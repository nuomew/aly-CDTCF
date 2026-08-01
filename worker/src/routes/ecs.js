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

  // 重装进度轮询（自动停止→重装→开机）
  if (path === '/api/ecs/instance/reinstall_progress' && method === 'POST') {
    return await reinstallProgress(request, env);
  }

  // 获取镜像列表
  if (path === '/api/ecs/images') {
    return await getImages(request, env);
  }

  // 获取实例磁盘信息
  if (path === '/api/ecs/instance/disks') {
    return await getInstanceDisks(request, env);
  }

  // 查询实例状态
  if (path === '/api/ecs/instance/status') {
    return await getInstanceStatus(request, env);
  }

  return errorResponse('接口不存在', 404);
}

/**
 * 根据配置ID创建 ECS 客户端（内部辅助函数）
 * @param {object} env - 环境变量
 * @param {number|string} configId - 配置ID
 * @returns {object|null} { client, config } 或 null
 */
async function buildEcsClient(env, configId) {
  const config = await dbOne(env.DB, 'SELECT * FROM aliyun_config WHERE id = ?', [configId]);
  if (!config) return null;
  const keySecret = await decryptData(config.access_key_secret, env.APP_SECRET);
  const client = createEcsClient(config.access_key_id, keySecret, config.region_id);
  return { client, config };
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

  const allInstances = [];

  for (const config of configs) {
    try {
      const keySecret = await decryptData(config.access_key_secret, secret);
      const client = createEcsClient(config.access_key_id, keySecret, config.region_id);
      const result = await client.describeInstances();

      if (result.success && result.data?.Instances?.Instance) {
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
    }
  }

  return jsonResponse(allInstances);
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
  console.log('describeInstanceAttribute原始数据:', JSON.stringify({
    osName: data.OSName,
    osNameEn: data.OSNameEn,
    publicIp: data.PublicIpAddress,
    innerIp: data.InnerIpAddress,
    vpcPrivateIp: data.VpcAttributes?.PrivateIpAddress,
    internetChargeType: data.InternetChargeType,
    instanceChargeType: data.InstanceChargeType,
    networkType: data.NetworkType,
    bandwidthOut: data.InternetMaxBandwidthOut,
    keys: Object.keys(data)
  }));
  // 内网IP：优先从VPC属性获取，其次从经典网络属性获取
  const privateIpList = data.VpcAttributes?.PrivateIpAddress?.IpAddress
    || data.InnerIpAddress?.IpAddress
    || [];

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
    innerIp: privateIpList,
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
    memory: data.Memory || 0,
    instanceChargeType: data.InstanceChargeType || '',
    instanceChargeTypeText: formatChargeType(data.InstanceChargeType || ''),
    networkType: data.NetworkType || ''
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
 * 流程：若实例运行中则先停止（返回 stopping 状态由前端轮询），
 *       若已停止则直接执行更换系统盘（返回 reinstalling 状态）
 * 支持密码登录或密钥对登录，支持扩大系统盘容量
 */
async function reinstallInstance(request, env) {
  const { config_id, instance_id, image_id, password, key_pair_name, system_disk_size } = await request.json();

  if (!config_id || !instance_id) {
    return errorResponse('缺少必要参数');
  }
  if (!image_id) {
    return errorResponse('请选择镜像');
  }
  if (!password && !key_pair_name) {
    return errorResponse('请设置登录密码或选择密钥对');
  }

  const built = await buildEcsClient(env, config_id);
  if (!built) return errorResponse('配置不存在', 404);
  const { client } = built;

  // 获取实例当前状态
  const instanceInfo = await client.describeInstanceAttribute(instance_id);
  if (!instanceInfo.success) {
    return errorResponse('获取实例状态失败: ' + instanceInfo.error);
  }

  const currentStatus = instanceInfo.data?.Status || '';
  const diskSize = parseInt(system_disk_size) || 0;

  if (currentStatus === 'Running') {
    // 运行中：先停止实例，由前端轮询重装进度接口继续流程
    const stopResult = await client.stopInstance(instance_id);
    if (!stopResult.success) {
      return errorResponse('停止实例失败: ' + stopResult.error);
    }
    await logOperation(env.DB, request.admin.id, request.admin.username, 'ecs_reinstall', 'ECS', `重装系统实例: ${instance_id}，开始重装流程，正在停止实例`, '');
    return jsonResponse({
      status: 'stopping',
      instance_id
    }, '任务已提交，正在停止实例...');
  }

  if (currentStatus === 'Stopped') {
    // 已停止：直接执行更换系统盘
    const apiResult = await client.replaceSystemDisk(instance_id, image_id, password || '', key_pair_name || '', diskSize);
    if (apiResult.success) {
      await logOperation(env.DB, request.admin.id, request.admin.username, 'ecs_reinstall', 'ECS', `重装系统实例: ${instance_id}，镜像: ${image_id}`, '');
      return jsonResponse({
        status: 'reinstalling',
        instance_id,
        diskId: apiResult.data?.DiskId || ''
      }, '任务已提交，正在重装系统...');
    }
    return errorResponse('重装系统失败: ' + apiResult.error);
  }

  return errorResponse(`实例当前状态为 ${currentStatus}，无法重装系统，请等待实例停止后再试`);
}

/**
 * 重装进度轮询（自动停止→重装→开机 全流程）
 * 前端每5秒调用一次，携带当前阶段 phase：
 *   stopping     - 等待实例停止后执行更换系统盘
 *   reinstalling - 等待重装完成（无操作锁）后自动开机
 *   starting     - 等待实例进入运行中，标记完成
 */
async function reinstallProgress(request, env) {
  const { config_id, instance_id, image_id, password, key_pair_name, system_disk_size, phase } = await request.json();

  if (!config_id || !instance_id || !phase) {
    return errorResponse('缺少必要参数');
  }

  const built = await buildEcsClient(env, config_id);
  if (!built) return errorResponse('配置不存在', 404);
  const { client } = built;

  const statusResult = await client.describeInstanceAttribute(instance_id);
  if (!statusResult.success) {
    return errorResponse('获取状态失败: ' + statusResult.error);
  }

  const status = statusResult.data?.Status || '';
  const diskSize = parseInt(system_disk_size) || 0;

  // 阶段一：等待实例停止
  if (phase === 'stopping') {
    if (status === 'Stopped') {
      if (!image_id) return errorResponse('缺少镜像ID');
      const apiResult = await client.replaceSystemDisk(instance_id, image_id, password || '', key_pair_name || '', diskSize);
      if (apiResult.success) {
        await logOperation(env.DB, request.admin.id, request.admin.username, 'ecs_reinstall', 'ECS', `重装系统实例: ${instance_id}，镜像: ${image_id}`, '');
        return jsonResponse({ status: 'reinstalling', instance_id }, '实例已停止，正在重装系统...');
      }
      return errorResponse('重装系统失败: ' + apiResult.error);
    }
    return jsonResponse({ status: 'stopping', current_status: status }, '正在等待实例停止...');
  }

  // 阶段二：等待重装完成（通过操作锁判断），完成后自动开机
  if (phase === 'reinstalling') {
    const locks = statusResult.data?.OperationLocks?.LockReason || [];
    const isLocked = Array.isArray(locks) && locks.length > 0;

    if (status === 'Stopped' && !isLocked) {
      const startResult = await client.startInstance(instance_id);
      if (startResult.success) {
        await logOperation(env.DB, request.admin.id, request.admin.username, 'ecs_start', 'ECS', `开机实例: ${instance_id}（重装完成后自动开机）`, '');
        return jsonResponse({ status: 'starting', instance_id }, '重装完成，正在开机...');
      }
      return errorResponse('开机失败: ' + startResult.error);
    }
    const statusText = isLocked ? '实例正在重装中...' : '正在重装系统，请稍候...';
    return jsonResponse({ status: 'reinstalling', current_status: status, is_locked: isLocked }, statusText);
  }

  // 阶段三：等待实例启动完成
  if (phase === 'starting') {
    if (status === 'Running') {
      return jsonResponse({ status: 'completed', instance_id }, '重装系统完成，实例已启动！');
    }
    return jsonResponse({ status: 'starting', current_status: status }, '实例正在启动...');
  }

  return errorResponse('未知阶段');
}

/**
 * 获取镜像列表
 * 查询参数：config_id（必填）、image_owner_alias（system/self/others）、ostype（linux/windows）
 */
async function getImages(request, env) {
  const url = new URL(request.url);
  const configId = url.searchParams.get('config_id');
  const imageOwnerAlias = url.searchParams.get('image_owner_alias') || 'system';
  const ostype = url.searchParams.get('ostype') || '';

  if (!configId) return errorResponse('缺少参数');

  const built = await buildEcsClient(env, configId);
  if (!built) return errorResponse('配置不存在', 404);
  const { client } = built;

  const apiResult = await client.describeImages(imageOwnerAlias, '', ostype, 1, 100);
  if (!apiResult.success) {
    return errorResponse('查询镜像失败: ' + apiResult.error);
  }

  let images = apiResult.data?.Images?.Image || [];
  // 单个镜像时阿里云返回对象而非数组，统一转为数组
  if (!Array.isArray(images)) images = [images];

  const imageList = images.map(img => ({
    imageId: img.ImageId || '',
    osName: img.OSName || img.OSNameEn || '',
    osType: (img.OSType || '').toLowerCase(),
    architecture: img.Architecture || '',
    imageVersion: img.ImageVersion || '',
    size: img.Size || '',
    imageOwnerAlias: img.ImageOwnerAlias || '',
    description: img.Description || ''
  }));

  return jsonResponse(imageList);
}

/**
 * 获取实例磁盘信息
 * 查询参数：config_id、instance_id
 */
async function getInstanceDisks(request, env) {
  const url = new URL(request.url);
  const configId = url.searchParams.get('config_id');
  const instanceId = url.searchParams.get('instance_id');

  if (!configId || !instanceId) return errorResponse('缺少参数');

  const built = await buildEcsClient(env, configId);
  if (!built) return errorResponse('配置不存在', 404);
  const { client } = built;

  const apiResult = await client.describeDisks(instanceId);
  if (!apiResult.success) {
    return errorResponse('查询磁盘失败: ' + apiResult.error);
  }

  let disks = apiResult.data?.Disks?.Disk || [];
  // 单磁盘时阿里云返回对象而非数组，统一转为数组
  if (!Array.isArray(disks)) disks = [disks];

  // 磁盘类别中文映射
  const categoryMap = {
    cloud: '普通云盘',
    cloud_efficiency: '高效云盘',
    cloud_ssd: 'SSD云盘',
    cloud_essd: 'ESSD云盘',
    cloud_auto: 'ESSD AutoPL云盘',
    ephemeral_ssd: '本地SSD盘'
  };

  const diskList = disks.map(disk => ({
    diskId: disk.DiskId || '',
    diskName: disk.DiskName || '',
    type: disk.Type || '',
    typeText: disk.Type === 'system' ? '系统盘' : '数据盘',
    size: disk.Size || 0,
    category: disk.Category || '',
    categoryText: categoryMap[disk.Category] || disk.Category || '-',
    status: disk.Status || '',
    statusText: formatEcsStatus(disk.Status || ''),
    creationTime: disk.CreationTime || ''
  }));

  return jsonResponse(diskList);
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
