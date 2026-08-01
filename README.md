# 阿里云流量查询系统 - Cloudflare Workers 版

基于 Cloudflare Workers + D1 数据库的阿里云 CDT 流量监控与 ECS 管理系统，完全 Serverless 部署。

## 一键部署

点击下方按钮，通过 Cloudflare 一键部署本系统：

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/nuomew/aly-CDTCF)

**部署后自动完成：**
- 自动创建 D1 数据库（`aly-cdtcf`）并绑定到 Worker
- 首次访问时自动初始化数据库表结构和初始数据
- 自动创建默认管理员账号 `admin` / `admin`
- 无需手动执行任何 SQL 或配置步骤

## 默认账号

| 项目 | 值 |
|------|-----|
| 后台登录地址 | `https://你的域名/admin` |
| 默认用户名 | `admin` |
| 默认密码 | `admin` |

> **首次登录后请立即修改默认密码！** 登录后台 → 系统设置 → 修改密码。

## 功能特性

- **流量监控**：多 AccessKey 流量使用情况实时展示，环形进度条 + 趋势图表
- **ECS 管理**：云服务器开关机、重启、重装系统、状态查询
- **VNC 连接**：全屏内置 VNC 远程连接，无需登录阿里云控制台
- **自动开关机**：流量超阈值自动关机，定时自动开机
- **邮件告警**：流量预警 + 自动关机通知（Resend API）
- **后台管理**：配置管理、系统设置、操作日志
- **定时任务**：Cron Triggers 每 5 分钟自动刷新流量数据
- **数据大屏**：环形仪表盘、各配置流量卡片、流量构成、月底预测、环比百分比

## 技术栈

| 组件 | 方案 |
|------|------|
| 运行时 | Cloudflare Workers (ES Modules) |
| 数据库 | Cloudflare D1 (SQLite) |
| 前端 | 原生 HTML + CSS + JavaScript |
| 邮件 | Resend API（后台配置，非环境变量） |
| 加密 | Web Crypto API |
| 定时任务 | Cron Triggers |
| 认证 | localStorage + Authorization Header |

## 快速开始（手动部署）

### 1. 安装依赖

```bash
npm install
```

### 2. 登录 Cloudflare

```bash
npx wrangler login
```

### 3. 创建 D1 数据库

```bash
npx wrangler d1 create aly-cdtcf
```

将输出的 `database_id` 填入 `wrangler.jsonc`。

### 4. 初始化数据库

```bash
npx wrangler d1 execute aly-cdtcf --remote --file=./worker/schema/schema.sql
npx wrangler d1 execute aly-cdtcf --remote --file=./worker/schema/seed.sql
```

### 5. 配置环境变量

编辑 `wrangler.jsonc`，填入：

```jsonc
{
  "vars": {
    "APP_SECRET": "你的随机密钥（建议 openssl rand -hex 32 生成）",
    "APP_URL": "https://你的域名"
  }
}
```

敏感变量建议使用 Secrets：

```bash
npx wrangler secret put APP_SECRET
```

### 6. 本地开发

```bash
npx wrangler dev
```

### 7. 部署

```bash
npx wrangler deploy
```

### 8. 完成安装

访问 `https://你的域名/admin`，用默认账号 `admin` / `admin` 登录。

## 目录结构

```
cloudflare/
├── worker/              # 后端 Worker
│   ├── src/
│   │   ├── index.js     # 主入口
│   │   ├── lib/         # 核心库（auth/db/helpers/mailer/aliyun-api/db-init）
│   │   └── routes/      # API 路由（auth/config/traffic/ecs/system/cron）
│   └── schema/          # 数据库 SQL（schema.sql + seed.sql）
├── frontend/            # 前端静态页面
│   ├── index.html       # 前台首页（流量展示）
│   ├── admin.html       # 后台重定向页
│   ├── install.html     # 安装向导重定向页
│   ├── js/              # 公共JS（auth.js 认证模块）
│   └── pages/           # 后台页面
│       ├── login.html   # 登录页
│       ├── admin.html   # 控制台（数据大屏）
│       ├── config.html  # 阿里云配置
│       ├── traffic.html # 流量统计
│       ├── server.html  # 服务器管理
│       ├── system.html  # 系统设置
│       ├── mail.html    # 邮箱配置
│       ├── logs.html    # 操作日志
│       ├── install.html # 安装向导
│       └── vnc.html     # VNC远程连接（备用）
├── wrangler.jsonc       # Wrangler 配置
├── package.json         # 依赖和脚本
└── docs/                # 文档
```

## 页面路由

| 路径 | 说明 |
|------|------|
| `/` | 前台首页（流量展示，无需登录） |
| `/admin` | 后台登录页（302重定向到 `/pages/login.html`） |
| `/install` | 安装向导（302重定向到 `/pages/install.html`） |
| `/pages/admin.html` | 控制台（需登录） |
| `/pages/config.html` | 阿里云配置（需登录） |
| `/pages/traffic.html` | 流量统计（需登录） |
| `/pages/server.html` | 服务器管理（需登录） |
| `/pages/system.html` | 系统设置（需登录） |
| `/pages/mail.html` | 邮箱配置（需登录） |
| `/pages/logs.html` | 操作日志（需登录） |

## API 文档

### 认证

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/auth/login | 管理员登录（返回 token） |
| POST | /api/auth/logout | 注销 |
| GET | /api/auth/check | 检查登录状态 |
| POST | /api/auth/install | 首次安装（创建管理员） |

### 流量

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/traffic/dashboard | 仪表盘数据（公开） |
| GET | /api/traffic/summary | 流量统计摘要 |
| GET | /api/traffic/trend | 流量趋势（支持日期范围+配置筛选） |
| GET | /api/traffic/ranking | 流量排行 TOP20 |
| POST | /api/traffic/refresh | 手动刷新流量 |

### 配置

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/config/list | 配置列表 |
| GET | /api/config/get | 获取配置详情 |
| POST | /api/config/add | 添加配置 |
| POST | /api/config/update | 更新配置 |
| POST | /api/config/delete | 删除配置 |
| POST | /api/config/test | 测试配置连接 |

### ECS

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/ecs/instances | 实例列表 |
| GET | /api/ecs/instance/detail | 实例详情 |
| GET | /api/ecs/instance/disks | 磁盘信息 |
| POST | /api/ecs/instance/action | 开关机/重启 |
| POST | /api/ecs/instance/vnc | 获取 VNC 地址 |
| POST | /api/ecs/instance/reinstall | 重装系统 |
| POST | /api/ecs/instance/reinstall_progress | 重装进度 |
| GET | /api/ecs/images | 镜像列表 |

### 系统

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/system/info | 系统信息 |
| GET | /api/system/settings | 系统设置 |
| POST | /api/system/settings | 保存设置 |
| GET | /api/system/logs | 操作日志 |

完整 API 文档见 [说明文档.md](./docs/说明文档.md)。

## 常见问题

### Q: 部署后访问首页空白或报错 D1_ERROR？
A: 首次访问时 Worker 会自动初始化数据库（建表+插入初始数据+创建默认管理员）。如果仍报错，请检查 Cloudflare Dashboard → D1 → 数据库是否已创建。

### Q: 登录后立即被退出到登录页？
A: 请清除浏览器缓存（Ctrl+Shift+Delete），然后重新访问。系统使用 localStorage + Authorization Header 认证，不依赖 Cookie。

### Q: 点击侧边栏菜单跳回控制台？
A: 请清除浏览器缓存后重试。旧版本代码中 `adminName` 元素缺失导致回调报错，已修复。

### Q: VNC 按钮点击后跳转阿里云登录页？
A: 旧版本使用外链跳转，已改为内置全屏弹窗，通过阿里云 API 获取 VncUrl 嵌入 iframe，无需登录阿里云。

### Q: 实例详情显示"-"（操作系统/公网IP/带宽等为空）？
A: 已修复。阿里云 `DescribeInstanceAttribute` 成功响应无 `Code` 字段，且部分字段名与预期不同。现在先用 `DescribeInstances` 获取（字段更全），并正确处理 EIP 弹性IP和 VPC 内网IP。

### Q: 邮件功能无法使用？
A: 邮件功能需要在后台"邮箱配置"页面填写 Resend API Key，非环境变量配置。注册 https://resend.com 获取 API Key。

## 许可证

MIT License
