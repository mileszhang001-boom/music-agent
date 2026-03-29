# 娱乐 Agent · 手机端 ↔ 车端 · 对接文档

> 版本：v1.1 | 2026-03-28 | 给服务端 & 车端开发看的

---

## 一句话理解

手机端是遥控器，车端是大脑。手机发 JSON，车端收 JSON → LLM 推理 → 渲染卡片 → 回 ACK。

```
手机 H5 ──JSON──→ 服务端 ──透传──→ 车端 AI
                    ↑                  │
                    └──── ACK ─────────┘
```

---

## 谁负责什么

| | 手机端 | 服务端 | 车端 |
|--|--------|--------|------|
| **做** | 组装 JSON、发送 | 接收、存储、透传 | 接收 JSON、LLM 推理、卡片编排、回 ACK |
| **不做** | 推理、渲染 | 业务决策 | 收集用户输入 |

---

## JSON 协议

### 通用信封

所有消息共用一个顶层结构，`type` 区分场景：

```json
{
  "type": "content | postcard | recommend",
  "session_id": "sess_20260328_083215",
  "timestamp": "2026-03-28T08:32:15+08:00",
  "user_profile": {
    "persona_id": "user_a",
    "persona_label": "欧美流行重度发烧友"
  },
  "payload": { }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `type` | string | `"content"` / `"postcard"` / `"recommend"` |
| `session_id` | string | 格式 `sess_YYYYMMDD_HHmmss`，手机端生成 |
| `timestamp` | string | ISO 8601 + 时区 |
| `user_profile.persona_id` | string | `user_a` / `user_b` / `user_c` |
| `user_profile.persona_label` | string | 中文展示名 |

---

### ① content — 用户说了一句话

**场景**：用户在输入框打字发送，比如"不想听音乐了，我想听播客"。

**车端该做什么**：根据 `text` + `user_profile` 推理，决定推哪张卡到堆栈顶。

```json
{
  "type": "content",
  "session_id": "sess_20260328_083215",
  "timestamp": "2026-03-28T08:32:15+08:00",
  "user_profile": {
    "persona_id": "user_a",
    "persona_label": "欧美流行重度发烧友"
  },
  "payload": {
    "text": "不想听音乐了，我想听播客"
  }
}
```

**payload 只有一个字段**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `text` | string | 用户原文，不做预处理 |

**演示时会测的输入**：

| 输入 | 期望车端行为 |
|------|-------------|
| "不想听音乐了，我想听播客" | 喜马拉雅推荐卡 → 堆栈顶 |
| "导航回家" | 地图卡 → 堆栈顶 |
| "太热了" | 空调控制卡 → 堆栈顶 |

---

### ② recommend — 用户上车了

**场景**：用户选择行程类型（如"早上通勤"）和时长（如 30 分钟），点击「触发上车信号」。

**车端该做什么**：根据 `user_profile` + `trip` + `time_context` 做全量卡片编排推荐。

```json
{
  "type": "recommend",
  "session_id": "sess_20260328_083500",
  "timestamp": "2026-03-28T08:35:00+08:00",
  "user_profile": {
    "persona_id": "user_b",
    "persona_label": "喜欢听国语民谣、轻音乐"
  },
  "payload": {
    "trigger": "user_enter_car",
    "trip": {
      "scene_id": "commute_home",
      "scene_label": "下班回家",
      "duration_min": 60
    },
    "time_context": {
      "hour": 22,
      "day_type": "weekday",
      "period": "late_night"
    }
  }
}
```

**payload 字段**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `trigger` | string | 固定 `"user_enter_car"` |
| `trip.scene_id` | string | 见下方枚举 |
| `trip.scene_label` | string | 中文展示名 |
| `trip.duration_min` | number | 行程时长（分钟），用户手动输入 |
| `time_context.hour` | number | 0-23，自动获取 |
| `time_context.day_type` | string | `"weekday"` / `"weekend"` / `"holiday"` |
| `time_context.period` | string | 由 hour 推导，见下方规则 |

**行程类型枚举（5 种）**：

| scene_id | scene_label |
|----------|-------------|
| `morning_commute` | 早上通勤 |
| `commute_home` | 下班回家 |
| `weekend_outing` | 周末出游 |
| `couple_time` | 情侣时光 |
| `kid_mode` | 儿童 |

**period 推导规则**：

| hour | period |
|------|--------|
| 5-8 | `early_morning` |
| 9-11 | `morning` |
| 12-16 | `afternoon` |
| 17-20 | `evening` |
| 21-4 | `late_night` |

**演示时会测的组合**：

| Persona | 行程 | 时间 | 期望 |
|---------|------|------|------|
| 用户A | 下班回家 60min | 22:00 | 深夜欧美慢摇歌单 |
| 用户B | 早上通勤 30min | 08:00 | 晨间民谣 + 天气 + 日程 |
| 用户C | 周末出游 120min | 10:00 | 古典乐长途精选 / 热门播客 |

---

### ③ postcard — AI 播客可以播了

**场景**：手机端调用豆包播客 API 生成播客，生成完成后推送给车端播放。

**车端该做什么**：将播客卡插入堆栈顶，用 `cdn_url` 播放音频。

**关键**：postcard 只在播客**完整生成后**才发送，`cdn_url` 一定可用。车端收到即可播放。

```json
{
  "type": "postcard",
  "session_id": "sess_20260328_090000",
  "timestamp": "2026-03-28T09:05:30+08:00",
  "user_profile": {
    "persona_id": "user_c",
    "persona_label": "喜欢听古典乐、播客"
  },
  "payload": {
    "source": {
      "type": "url",
      "url": "https://mp.weixin.qq.com/s/CiN0XRWQc3hIV9lLLS0rGA",
      "title": "2026年AI行业十大趋势"
    },
    "podcast": {
      "cdn_url": "https://speech-tts-podcast.tos-cn-beijing.volces.com/...podcast_demo.mp3?签名参数",
      "duration_sec": 497,
      "format": "mp3",
      "speakers": [
        { "id": "zh_male_dayixiansheng_v2_saturn_bigtts", "role": "host_a" },
        { "id": "zh_female_mizaitongxue_v2_saturn_bigtts", "role": "host_b" }
      ]
    }
  }
}
```

**payload 字段**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `source.type` | string | `"url"` 用户输入链接 / `"preset"` 预设内容 |
| `source.url` | string | 原始链接（type=url 时必填） |
| `source.title` | string | 内容标题 |
| `podcast.cdn_url` | string | 可直接播放的 mp3 URL（豆包 CDN，**24h 有效**） |
| `podcast.duration_sec` | number | 播客总时长（秒） |
| `podcast.format` | string | 固定 `"mp3"`（96kbps, 24kHz mono） |
| `podcast.speakers` | array | 发音人列表，`host_a` 男声 / `host_b` 女声 |

**车端播放注意**：
- `cdn_url` 是签名 URL，24 小时后过期
- 预设播客的 `cdn_url` 指向我们自己的服务端，长期有效

---

## ACK 回传

车端处理完 JSON 后，需要回传一个简单 ACK，让手机端知道"已生效"。

### ACK 格式

```json
{
  "status": "ok",
  "session_id": "sess_20260328_083215",
  "message": "推荐已更新"
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `status` | string | `"ok"` 成功 / `"error"` 失败 |
| `session_id` | string | 原请求的 session_id，用于关联 |
| `message` | string | 可选，人可读的状态描述 |

### ACK 路由

```
车端 ──ACK JSON──→ 服务端 ──透传──→ 手机端
```

手机端收到 `status: "ok"` 后，在对应卡片上显示 `● 已发送至车端`。
收到 `status: "error"` 则显示错误提示。
超时（如 10s 无 ACK）手机端显示 `● 发送中...`。

---

## 中继服务器

### 架构

手机端和车端通过 WebSocket 中继服务器通信。中继只做消息转发，不做业务逻辑。

```
手机 H5 ←─WSS─→ 中继 (阿里云) ←─WSS─→ 车端 Android
                 同一 room
```

### 连接地址

```
wss://zhangchang.duckdns.org:8443/ws?room=car_001&role=phone|car
```

| 参数 | 说明 |
|------|------|
| `room` | 房间号，手机和车端必须相同 |
| `role` | `phone`（手机端）或 `car`（车端） |

### 消息流转

1. 手机端发送 JSON → 中继广播给同房间其他连接（车端）
2. 车端处理后发送 ACK → 中继广播给手机端
3. 中继不解析、不存储消息内容

### 中继系统事件

中继会发送 `type: "_relay_event"` 类型的系统消息，**不是业务消息**：

```json
{"type": "_relay_event", "event": "connected", "room": "car_001", "peers": 1}
{"type": "_relay_event", "event": "peer_joined", "role": "car", "peers": 2}
{"type": "_relay_event", "event": "peer_left", "role": "car", "peers": 1}
```

手机端和车端都应该过滤这些事件，不要当作业务消息处理。

### 健康检查

```
GET https://zhangchang.duckdns.org:8443/health
→ {"status":"ok","service":"relay"}
```

---

## Persona 枚举（共 3 个）

| persona_id | persona_label | 音乐偏好 |
|------------|---------------|---------|
| `user_a` | 欧美流行重度发烧友 | 欧美流行、电子、Hip-hop |
| `user_b` | 喜欢听国语民谣、轻音乐 | 华语民谣、轻音乐、Acoustic |
| `user_c` | 喜欢听古典乐、播客 | 古典乐、知识播客、有声书 |

---

## 快速验证

用 curl 模拟手机端发送（服务端联调时用）：

```bash
# content 消息
curl -X POST http://localhost:8000/api/agent/message \
  -H "Content-Type: application/json" \
  -d '{
    "type": "content",
    "session_id": "sess_test_001",
    "timestamp": "2026-03-28T10:00:00+08:00",
    "user_profile": {"persona_id": "user_a", "persona_label": "欧美流行重度发烧友"},
    "payload": {"text": "不想听音乐了，我想听播客"}
  }'

# recommend 消息
curl -X POST http://localhost:8000/api/agent/message \
  -H "Content-Type: application/json" \
  -d '{
    "type": "recommend",
    "session_id": "sess_test_002",
    "timestamp": "2026-03-28T10:00:00+08:00",
    "user_profile": {"persona_id": "user_b", "persona_label": "喜欢听国语民谣、轻音乐"},
    "payload": {
      "trigger": "user_enter_car",
      "trip": {"scene_id": "morning_commute", "scene_label": "早上通勤", "duration_min": 30},
      "time_context": {"hour": 8, "day_type": "weekday", "period": "early_morning"}
    }
  }'

# postcard 消息
curl -X POST http://localhost:8000/api/agent/message \
  -H "Content-Type: application/json" \
  -d '{
    "type": "postcard",
    "session_id": "sess_test_003",
    "timestamp": "2026-03-28T10:05:00+08:00",
    "user_profile": {"persona_id": "user_c", "persona_label": "喜欢听古典乐、播客"},
    "payload": {
      "source": {"type": "url", "url": "https://mp.weixin.qq.com/s/xxx", "title": "测试播客"},
      "podcast": {
        "cdn_url": "https://example.com/podcast.mp3",
        "duration_sec": 300,
        "format": "mp3",
        "speakers": [
          {"id": "zh_male_dayixiansheng_v2_saturn_bigtts", "role": "host_a"},
          {"id": "zh_female_mizaitongxue_v2_saturn_bigtts", "role": "host_b"}
        ]
      }
    }
  }'
```
