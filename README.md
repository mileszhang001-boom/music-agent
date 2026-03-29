# 娱乐 Agent 手机端 H5

手机端作为遥控器，向车端 AI 大脑发送用户意图 JSON，车端推理后编排桌面卡片。

## 架构

```
手机 H5 (Netlify)                           车端 Android App
     │                                           │
     └──WSS──→  中继服务器 (阿里云)  ←──WSS──────────┘
                zhangchang.duckdns.org:8443
```

## 线上地址

| 服务 | URL |
|------|-----|
| 手机端 H5 | https://stalwart-sunburst-2b6e9f.netlify.app/ |
| 中继服务器 | wss://zhangchang.duckdns.org:8443/ws?room=car_001 |
| 健康检查 | https://zhangchang.duckdns.org:8443/health |

## 快速开始

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 启动本地中继（可选，默认连阿里云）
npm run relay
```

## 六条交互链路

| 链路 | 触发 | 发送 JSON | 说明 |
|------|------|----------|------|
| A | 点击用户胶囊 | — | 切换 Persona（纯本地） |
| B | 输入文字 → 发送 | `content` | 用户偏好/指令 |
| C | 模拟上车 → 触发 | `recommend` | 行程推荐 |
| D | AI播客 → 选内容 | — | 预设列表 + URL 输入 |
| E | 发送播客 | `postcard` | 预设/实时生成 |
| F | 查看 JSON | — | 调试工具 |

## 项目结构

```
├── src/
│   ├── main.js           # 入口 + 事件绑定
│   ├── state.js          # 状态管理
│   ├── config.js         # Persona + 预设播客
│   ├── api.js            # WebSocket 中继通信
│   ├── json-builder.js   # JSON 组装
│   ├── podcast.js        # 豆包 API（预留）
│   ├── utils.js          # 工具函数
│   ├── style.css         # 样式
│   └── ui/               # UI 组件
├── server/
│   └── relay.js          # WebSocket 中继服务器
├── public/audio/         # 预设播客 MP3
└── docs/
    ├── PRODUCT_ARCH.md   # 产品架构
    ├── INTEGRATION.md    # 对接协议
    └── CAR_INTEGRATION.md # 车端对接指南
```

## 环境变量

| 变量 | 说明 | 示例 |
|------|------|------|
| `VITE_RELAY_URL` | 中继服务器 WSS 地址 | `wss://zhangchang.duckdns.org:8443/ws?room=car_001` |

本地开发：`.env` 文件（已 gitignore）
Netlify 部署：Site settings → Environment variables

## 文档

- [产品架构](docs/PRODUCT_ARCH.md) — 功能定义、交互链路、UI 字段映射
- [对接协议](docs/INTEGRATION.md) — JSON 格式、ACK 机制
- [车端对接指南](docs/CAR_INTEGRATION.md) — Android WebSocket 接入
