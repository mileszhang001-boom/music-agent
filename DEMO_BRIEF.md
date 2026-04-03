# Demo App 开发任务

## 做什么

一个 Android App（单 Activity），功能：

1. **输入**：一个文本框，用户输入一句话（如"郭德纲的相声"、"推荐点轻松的播客"）
2. **调用喜马拉雅 AI Agent 接口**：拿到推荐内容列表 + AI 回复文案
3. **展示**：显示 AI 回复文案 + 推荐列表（封面图、标题、副标题、时长）
4. **播放**：点击列表项，通过喜马拉雅车载 APK 的 MediaSession 播放

## 喜马拉雅接口（已验证可用）

### 凭证

```
APP_KEY    = "3d17306243e47f16d21dd438f9d5e5aa"
APP_SECRET = "eed1faaec95bc415da5048a6b2190a4d"
DEVICE_ID  = 运行时取 Android_ID，测试可用 "xiaomi_car_test_001"
```

### 签名算法 (sig)

所有参数(除sig) → 按 key 字典序排序 → `&` 拼接(value 不做 URL encode) → Base64 → HMAC-SHA1(key=APP_SECRET) → 得到 byte[] → MD5 → 32位 hex 小写 = sig

### 接口 1：游客登录（获取 access_token）

```
POST https://api.ximalaya.com/oauth2/secure_access_token
Content-Type: application/x-www-form-urlencoded

参数:
  client_id    = APP_KEY
  device_id    = DEVICE_ID
  grant_type   = "client_credentials"
  nonce        = 随机字符串
  timestamp    = 毫秒时间戳
  sig          = 签名

响应: {"access_token": "xxx", "expires_in": 7211}
```

token 有效期约 2 小时，App 启动时调一次即可。

### 接口 2：AI Agent 文本查询（SSE 流式）

```
POST https://iovapi.ximalaya.com/iov-voice-service/iov-chat/text/query
Content-Type: application/x-www-form-urlencoded; charset=UTF-8
响应: SSE (event:json / event:binary)

参数 (form-urlencoded):
  app_key        = APP_KEY
  device_id      = DEVICE_ID
  device_id_type = "Android_ID"
  pack_id        = 你的包名
  client_os_type = "2"
  access_token   = 上一步获取的 token
  nonce          = 随机字符串
  timestamp      = 毫秒时间戳
  sig            = 签名
  query          = 用户输入的文本
  mode_type      = "2"
  context        = JSON 字符串（见下方）

context 最简写法:
  {"app":{"params":{"outputMode":"text","player":{"status":"Idle"},"content":{"paidFilter":true}}}}
```

### SSE 返回中需要关注的 3 种事件

```
event:json
data:{"directive":{"name":"PlayList","namespace":"ChatXmly","payload":{
  "items": [
    {
      "title": "郭德纲相声十年经典",          // 标题
      "cover_path": "https://...",             // 封面图
      "cover": {"large":{"url":"..."}},        // 多尺寸封面
      "duration": 824,                          // 时长(秒)
      "item_type": "album",                    // album / track
      "id": 2667276,
      "is_paid": false,
      "intro": "...",                           // 简介
      "track": {                                // 嵌套的具体声音
        "title": "《红花绿叶》...",
        "duration": 4,
        "album_id": 2667276,
        "mediaId": "/track?album_id=xxx&track_id=xxx&play_source=xxx"   // ← 播放用这个
      }
    }
  ]
}}}

event:json
data:{"directive":{"name":"WrittenAnswer","namespace":"ChatXmly","payload":{
  "text": "这些是我帮你搜索到的内容："       // AI 回复文案
}}}

event:json
data:{"directive":{"name":"Suggestions","namespace":"ChatXmly","payload":{
  "suggestions": ["换一批", "郭德纲相声创作体系特点"]   // 后续建议
}}}
```

### 播放：MediaSession

车机已装喜马拉雅 APK，通过 MediaSession 拉起播放：

```kotlin
// 连接
val mediaBrowser = MediaBrowserCompat(
    context,
    ComponentName(
        "com.ximalaya.ting.android.car",
        "com.ximalaya.ting.android.car.sdk.XmMediaBrowserService"
    ),
    connectionCallback, null
).apply { connect() }

// 连接成功后获取 controller
val controller = MediaControllerCompat(context, mediaBrowser.sessionToken)

// 播放（media_id 来自 PlayList item 的 track.mediaId）
controller.transportControls.playFromMediaId(mediaId, null)
```

## 技术选型建议

- 语言：Kotlin
- 最低 API：23
- 依赖：`androidx.media:media:1.7.0`（MediaBrowserCompat）
- 网络：OkHttp（处理 SSE 流）或 Retrofit
- 图片：Glide 或 Coil 加载封面
- 架构：单 Activity + ViewModel，不用搞复杂

## 已有参考代码

`demo/ximalaya-player-demo/app/src/main/java/com/xiaomi/car/xmtest/MainActivity.kt` 里有完整的 MediaSession 连接 + 播放代码，可直接复用。

`scripts/test_ximalaya.py` 里有完整的签名算法和接口调用（Python），翻译成 Kotlin 即可。
