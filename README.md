# 娱乐 Agent 手机端 H5

手机端作为遥控器，向车端 AI 大脑发送用户意图 JSON，车端推理后编排桌面卡片。

## 架构

```
手机 H5 (Netlify)                           车端 Android App
     │                                           │
     └──WSS──→  中继服务器 (阿里云)  ←──WSS──────────┘
                zhangchang.duckdns.org:8443
                ├── relay.js    (消息中继)
                └── podcast-api (播客生成+存储)
```

## 线上地址

| 服务 | URL |
|------|-----|
| 手机端 H5 | https://stalwart-sunburst-2b6e9f.netlify.app/ |
| 中继 WSS | wss://zhangchang.duckdns.org:8443/ws?room=car_001 |
| 播客列表 | https://zhangchang.duckdns.org:8443/api/podcast/list |
| 健康检查 | https://zhangchang.duckdns.org:8443/health |

## 快速开始

```bash
npm install
npm run dev       # 启动 H5 开发服务器 (port 5173)
npm run relay     # 启动本地中继 (port 9000，可选)
```

## 部署

```bash
# 服务端代码更新（只传代码，不碰音频和 store 数据）
SSHPASS=密码 ./server/deploy.sh

# Netlify 自动部署（push 到 main 分支即触发）
# 环境变量：VITE_RELAY_URL = wss://zhangchang.duckdns.org:8443/ws?room=car_001
```

## 项目结构

```
├── src/
│   ├── main.js           # 入口 + 6 条交互链路
│   ├── state.js          # 状态管理
│   ├── config.js         # Persona + 预设播客
│   ├── api.js            # WebSocket 中继通信 + ACK
│   ├── json-builder.js   # JSON 组装
│   ├── podcast.js        # 播客生成 SSE 客户端
│   ├── utils.js          # 工具函数
│   ├── style.css         # 样式
│   └── ui/               # UI 组件
├── server/
│   ├── relay.js          # WebSocket 中继服务器
│   ├── podcast-api.js    # 播客生成 + 内容存储
│   └── deploy.sh         # 安全部署脚本
├── public/audio/         # 预设播客 MP3
└── docs/
    ├── 产品功能和架构.md   # 产品架构、交互链路、部署架构
    └── 对接文档.md        # 车端 Android 对接指南
```

## 文档

- [产品功能和架构](docs/产品功能和架构.md) — 功能定义、交互链路、UI 字段映射、部署架构、内容存储
- [对接文档](docs/对接文档.md) — 车端 Android WebSocket 接入、消息协议、ACK 机制、音频播放
