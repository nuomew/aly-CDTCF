# 阿里云流量查询系统 - Cloudflare Workers 版

基于 Cloudflare Workers + D1 数据库的阿里云 CDT 流量监控与 ECS 管理系统，完全 Serverless 部署。

## 一键部署

点击下方按钮，通过 Cloudflare 一键部署本系统：

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/nuomew/aly-CDTCF)

> **部署前注意**：一键部署后，仍需手动创建 D1 数据库并执行 `schema.sql`，详见下方"部署指南"。

## 功能特性

- **流量监控**：多 AccessKey 流量使用情况实时展示，环形进度条 + 趋势图表
- **ECS 管理**：云服务器开关机、重启、重装系统、状态查询
- **VNC 连接**：远程连接管理终端
- **自动开关机**：流量超阈值自动关机，定时自动开机
- **邮件告警**：流量预警 + 自动关机通知（Resend API）
- **后台管理**：配置管理、系统设置、操作日志
- **定时任务**：Cron Triggers 每 5 分钟自动刷新流量数据

## 技术栈

| 组件 | 方案 |
|------|------|
| 运行时 | Cloudflare Workers (ES Modules) |
| 数据库 | Cloudflare D1 (SQLite) |
| 前端 | 原生 HTML + CSS + JavaScript |
| 邮件 | Resend API |
| 加密 | Web Crypto API |
| 定时任务 | Cron Triggers |

## 快速开始

### 1. 安装依赖

```bash
cd cloudflare/worker
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
    "APP_SECRET": "你的随机密钥",
    "APP_URL": "https://你的域名",
    "RESEND_API_KEY": "你的 Resend API Key"
  }
}
```

敏感变量建议使用 Secrets：

```bash
npx wrangler secret put APP_SECRET
npx wrangler secret put RESEND_API_KEY
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

访问 `https://你的域名/pages/install.html` 创建管理员账号。

## 目录结构

```
cloudflare/
├── worker/              # 后端 Worker
│   ├── src/
│   │   ├── index.js     # 主入口
│   │   ├── lib/         # 核心库
│   │   └── routes/      # API 路由
│   └── schema/          # 数据库 SQL
├── frontend/            # 前端静态页面
│   ├── index.html
│   └── pages/
└── docs/
```

## API 文档

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/auth/login | 管理员登录 |
| GET | /api/traffic/dashboard | 仪表盘数据 |
| POST | /api/traffic/refresh | 刷新流量 |
| GET | /api/config/list | 配置列表 |
| GET | /api/ecs/instances | ECS 实例列表 |
| GET | /api/system/logs | 操作日志 |

完整 API 文档见 [说明文档.md](./docs/说明文档.md)。

## 许可证

MIT License
