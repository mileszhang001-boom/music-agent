# 车端 Android 对接指南

> 版本：v1.0 | 2026-03-29 | 给车端 Android 开发看的

---

## 一句话理解

车端 Android App 通过 WebSocket 连接中继服务器，接收手机端发来的 JSON → LLM 推理 → 卡片渲染 → 回传 ACK。

```
手机 H5 (Netlify) ←─WSS─→ 中继服务器 (阿里云) ←─WSS─→ 车端 Android App
                          zhangchang.duckdns.org:8443
```

---

## 1. 连接方式

### WebSocket 地址（APK 中硬编码）

```
wss://zhangchang.duckdns.org:8443/ws?room=car_001&role=car
```

| 参数 | 值 | 说明 |
|------|-----|------|
| 协议 | `wss://` | TLS 加密，Let's Encrypt 正式证书 |
| 域名 | `zhangchang.duckdns.org` | 阿里云服务器 47.94.241.139 |
| 端口 | `8443` | 非标端口（绕过 ICP 备案检查） |
| 路径 | `/ws` | Nginx 反代到 WebSocket 中继 |
| room | `car_001` | 房间号，手机和车端必须相同 |
| role | `car` | 标识连接身份为车端 |

### Android OkHttp 示例

```kotlin
val client = OkHttpClient.Builder()
    .readTimeout(0, TimeUnit.MILLISECONDS) // WebSocket 长连接不超时
    .build()

val request = Request.Builder()
    .url("wss://zhangchang.duckdns.org:8443/ws?room=car_001&role=car")
    .build()

client.newWebSocket(request, object : WebSocketListener() {
    override fun onMessage(webSocket: WebSocket, text: String) {
        val json = JSONObject(text)

        // 过滤中继系统事件
        if (json.optString("type") == "_relay_event") {
            Log.d("Relay", "事件: ${json.optString("event")}")
            return
        }

        // 处理手机端发来的业务消息
        handleMessage(json, webSocket)
    }
})
```

---

## 2. 连接生命周期

### 建连后

连接成功后，中继会发送一条系统事件：

```json
{
  "type": "_relay_event",
  "event": "connected",
  "room": "car_001",
  "role": "car",
  "peers": 1
}
```

`peers` 表示房间内当前连接数（含自己）。

### 对端加入/离开

手机端连接或断开时，车端会收到：

```json
{ "type": "_relay_event", "event": "peer_joined", "role": "phone", "peers": 2 }
{ "type": "_relay_event", "event": "peer_left", "role": "phone", "peers": 1 }
```

### 断线重连

建议实现指数退避重连：

```kotlin
var retryDelay = 1000L // 初始 1s
val maxDelay = 10000L  // 最大 10s

fun reconnect() {
    handler.postDelayed({
        connectWebSocket()
        retryDelay = min(retryDelay * 2, maxDelay)
    }, retryDelay)
}

// 连接成功后重置
fun onConnected() {
    retryDelay = 1000L
}
```

---

## 3. 接收消息格式

所有业务消息共用一个信封结构，通过 `type` 字段区分：

```json
{
  "type": "content | recommend | postcard",
  "session_id": "sess_20260329_103000",
  "timestamp": "2026-03-29T10:30:00+08:00",
  "user_profile": {
    "persona_id": "user_a",
    "persona_label": "欧美流行重度发烧友"
  },
  "payload": { ... }
}
```

**关键**：`_relay_event` 类型的消息是中继系统事件，不是业务消息，**必须过滤掉**。

### ① type: "content" — 用户说了一句话

**车端该做什么**：根据 `text` + `user_profile` 推理，决定推哪张卡到堆栈顶。

```json
{
  "type": "content",
  "session_id": "sess_20260329_103000",
  "timestamp": "2026-03-29T10:30:00+08:00",
  "user_profile": {
    "persona_id": "user_a",
    "persona_label": "欧美流行重度发烧友"
  },
  "payload": {
    "text": "不想听音乐了，我想听播客"
  }
}
```

| payload 字段 | 类型 | 说明 |
|-------------|------|------|
| `text` | string | 用户原文 |

**演示会测的输入**：

| 输入文字 | 期望车端行为 |
|---------|-------------|
| "不想听音乐了，我想听播客" | 喜马拉雅推荐卡 → 堆栈顶 |
| "导航回家" | 地图卡 → 堆栈顶 |
| "太热了" | 空调控制卡 → 堆栈顶 |

### ② type: "recommend" — 用户上车了

**车端该做什么**：根据 `user_profile` + `trip` + `time_context` 做全量卡片编排推荐。

```json
{
  "type": "recommend",
  "session_id": "sess_20260329_103500",
  "timestamp": "2026-03-29T10:35:00+08:00",
  "user_profile": {
    "persona_id": "user_b",
    "persona_label": "喜欢听国语民谣、轻音乐"
  },
  "payload": {
    "trigger": "user_enter_car",
    "trip": {
      "scene_id": "morning_commute",
      "scene_label": "早上通勤",
      "duration_min": 30
    },
    "time_context": {
      "hour": 8,
      "day_type": "weekday",
      "period": "early_morning"
    }
  }
}
```

| payload 字段 | 类型 | 说明 |
|-------------|------|------|
| `trigger` | string | 固定 `"user_enter_car"` |
| `trip.scene_id` | string | `morning_commute` / `commute_home` / `weekend_outing` / `couple_time` / `kid_mode` |
| `trip.scene_label` | string | 中文名 |
| `trip.duration_min` | number | 行程分钟数 |
| `time_context.hour` | number | 0-23 |
| `time_context.day_type` | string | `weekday` / `weekend` |
| `time_context.period` | string | `early_morning` / `morning` / `afternoon` / `evening` / `late_night` |

### ③ type: "postcard" — AI 播客可以播了

**车端该做什么**：将播客卡插入堆栈顶，用 `cdn_url` 播放音频。

```json
{
  "type": "postcard",
  "session_id": "sess_20260329_104000",
  "timestamp": "2026-03-29T10:40:00+08:00",
  "user_profile": {
    "persona_id": "user_c",
    "persona_label": "喜欢听古典乐、播客"
  },
  "payload": {
    "source": {
      "type": "preset",
      "url": "https://mp.weixin.qq.com/s/g5-Y-7H1hfovmyBcB6WSqQ",
      "title": "AI 重塑未来工作方式"
    },
    "podcast": {
      "cdn_url": "https://stalwart-sunburst-2b6e9f.netlify.app/audio/ai_tech_01.mp3",
      "duration_sec": 1110,
      "format": "mp3",
      "speakers": [
        { "id": "zh_male_dayixiansheng_v2_saturn_bigtts", "role": "host_a" },
        { "id": "zh_female_mizaitongxue_v2_saturn_bigtts", "role": "host_b" }
      ]
    }
  }
}
```

| payload 字段 | 类型 | 说明 |
|-------------|------|------|
| `source.type` | string | `"preset"` 预设 / `"url"` 用户输入链接 |
| `source.title` | string | 内容标题 |
| `podcast.cdn_url` | string | **可直接播放的 MP3 URL** |
| `podcast.duration_sec` | number | 播客总时长（秒） |
| `podcast.format` | string | 固定 `"mp3"` |
| `podcast.speakers` | array | 发音人信息 |

**播放注意**：
- `cdn_url` 可直接用 Android MediaPlayer 播放
- 预设播客的 URL 指向 Netlify CDN（长期有效）
- 实时生成的播客 URL 指向豆包 CDN（24小时有效）

---

## 4. 回传 ACK

**收到任何业务消息后**，处理完毕立即回传 ACK：

```json
{
  "status": "ok",
  "session_id": "sess_20260329_103000",
  "message": "推荐已更新"
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `status` | string | `"ok"` 成功 / `"error"` 失败 |
| `session_id` | string | **必须与收到的消息的 session_id 一致** |
| `message` | string | 可选，人可读描述 |

**ACK 通过同一个 WebSocket 连接发送**，中继会自动转发给手机端。

### Android 发送 ACK 示例

```kotlin
fun handleMessage(json: JSONObject, ws: WebSocket) {
    val type = json.getString("type")
    val sessionId = json.getString("session_id")

    // 处理业务逻辑...

    // 回传 ACK
    val ack = JSONObject().apply {
        put("status", "ok")
        put("session_id", sessionId)
        put("message", "处理完成")
    }
    ws.send(ack.toString())
}
```

**手机端超时策略**：10 秒内未收到 ACK 则显示"发送失败"。

---

## 5. Persona 枚举

| persona_id | 标签 | 音乐偏好 |
|------------|------|---------|
| `user_a` | 欧美流行重度发烧友 | 欧美流行、电子、Hip-hop |
| `user_b` | 喜欢听国语民谣、轻音乐 | 华语民谣、轻音乐、Acoustic |
| `user_c` | 喜欢听古典乐、播客 | 古典乐、知识播客、有声书 |

---

## 6. 快速测试（无需 Android 代码）

用命令行工具 `wscat` 模拟车端：

```bash
# 安装
npm install -g wscat

# 连接（和手机端进入同一房间）
wscat -c "wss://zhangchang.duckdns.org:8443/ws?room=car_001&role=car"

# 连接后会收到：
# {"type":"_relay_event","event":"connected","room":"car_001",...}

# 手机端操作后，这里会收到 JSON 消息
# 手动输入 ACK 回复：
{"status":"ok","session_id":"sess_20260329_103000","message":"测试ACK"}
```

也可以用 `wscat` 模拟手机端发消息给车端：

```bash
# 终端 1：模拟车端
wscat -c "wss://zhangchang.duckdns.org:8443/ws?room=car_001&role=car"

# 终端 2：模拟手机端
wscat -c "wss://zhangchang.duckdns.org:8443/ws?room=car_001&role=phone"
# 输入：
{"type":"content","session_id":"test_001","timestamp":"2026-03-29T10:00:00+08:00","user_profile":{"persona_id":"user_a","persona_label":"欧美流行重度发烧友"},"payload":{"text":"不想听音乐了，我想听播客"}}

# 终端 1 收到后，回复 ACK：
{"status":"ok","session_id":"test_001","message":"推荐已更新"}
# 终端 2 会收到这条 ACK
```

---

## 7. 常见问题

**Q: WebSocket 断开后消息会丢吗？**
A: 会。中继不做持久化，断连期间的消息会丢失。重连后手机端如需重发会由用户手动触发。

**Q: 多台手机连同一个 room 会怎样？**
A: 所有手机的消息都会到达车端。车端收到的 `user_profile` 可以区分是哪个用户。

**Q: cdn_url 音频格式是什么？**
A: MP3，96kbps，24kHz，单声道。Android MediaPlayer 直接支持。

**Q: 需要处理所有三种消息类型吗？**
A: 是的。`content` 和 `recommend` 需要 LLM 推理后渲染卡片，`postcard` 直接播放 `cdn_url`。三种都需要回传 ACK。
