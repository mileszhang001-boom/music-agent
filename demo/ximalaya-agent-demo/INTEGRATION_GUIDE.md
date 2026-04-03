# 喜马拉雅 AI Agent 接口对接指南

> 基于 Demo App 实机验证（2026-04-01，SU7 台架），全部接口已跑通至播放。

---

## 一、整体流程

```
用户输入 "郭德纲的相声"
        │
        ▼
  ① 游客登录 → access_token（2h 有效，启动时调一次）
        │
        ▼
  ② AI Agent text/query（SSE 流式）
        │
        ├─ WrittenAnswer  → "为您找到如下内容。"
        ├─ PlayList        → 10 条推荐（标题、封面、时长、mediaId）
        └─ Suggestions     → ["郭德纲经典相声作品推荐", ...]
        │
        ▼
  ③ 渲染推荐卡片
        │
        ▼
  ④ 用户点击 → MediaSession playFromMediaId → 喜马拉雅 APK 播放
```

---

## 二、凭证

```
APP_KEY    = "3d17306243e47f16d21dd438f9d5e5aa"
APP_SECRET = "eed1faaec95bc415da5048a6b2190a4d"
DEVICE_ID  = 运行时取 Android_ID（测试值 "xiaomi_car_test_001"）
PACK_ID    = "com.xiaomi.car.agent"
```

---

## 三、签名算法

所有接口都需要 `sig` 参数。算法（6 步）：

```
1. 取所有参数（排除 sig 自身），按 key 字典序排序
2. 拼接为 "key1=value1&key2=value2&..." —— value 不做 URL encode
3. 对拼接结果做 Base64 编码
4. 以 APP_SECRET 为 key，对 Base64 结果做 HMAC-SHA1 → 得到 byte[]
5. 对 byte[] 做 MD5 → 32 位小写 hex
```

**Kotlin 实现：**

```kotlin
fun sign(params: Map<String, String>): String {
    val sortedStr = params.keys
        .filter { it != "sig" }
        .sorted()
        .joinToString("&") { "$it=${params[it]}" }

    val b64 = Base64.encode(sortedStr.toByteArray(Charsets.UTF_8), Base64.NO_WRAP)

    val mac = Mac.getInstance("HmacSHA1")
    mac.init(SecretKeySpec(APP_SECRET.toByteArray(Charsets.UTF_8), "HmacSHA1"))
    val sha1Bytes = mac.doFinal(b64)

    return MessageDigest.getInstance("MD5").digest(sha1Bytes)
        .joinToString("") { "%02x".format(it) }
}
```

> 参考实现：`api/XimalayaSigner.kt`、`scripts/test_ximalaya.py:12-21`

---

## 四、接口 1：游客登录

```
POST https://api.ximalaya.com/oauth2/secure_access_token
Content-Type: application/x-www-form-urlencoded
```

| 参数 | 值 |
|------|-----|
| client_id | APP_KEY |
| device_id | DEVICE_ID |
| grant_type | `"client_credentials"` |
| nonce | 随机字符串（16 位） |
| timestamp | 毫秒时间戳 |
| sig | 签名 |

**响应：**

```json
{
  "access_token": "xxx",
  "expires_in": 7211
}
```

- token 有效期约 2 小时，建议启动时获取一次，提前 5 分钟刷新
- 不需要用户登录/扫码，纯设备级鉴权

> 参考实现：`api/XimalayaAuth.kt`

---

## 五、接口 2：AI Agent 文本查询（SSE）

```
POST https://iovapi.ximalaya.com/iov-voice-service/iov-chat/text/query
Content-Type: application/x-www-form-urlencoded
响应: SSE 流（event:json / event:binary）
```

| 参数 | 值 |
|------|-----|
| app_key | APP_KEY |
| device_id | DEVICE_ID |
| device_id_type | `"Android_ID"` |
| pack_id | PACK_ID |
| client_os_type | `"2"` |
| access_token | 上一步获取的 token |
| nonce | 随机字符串 |
| timestamp | 毫秒时间戳 |
| sig | 签名（**注意 context 参与签名，value 不做 URL encode**） |
| query | 用户输入的文本 |
| mode_type | `"2"` |
| context | JSON 字符串（见下方） |

**context 最简写法（实测可用）：**

```json
{"app":{"params":{"outputMode":"text","player":{"status":"Idle"},"content":{"paidFilter":true}}}}
```

> 参考实现：`api/XimalayaAgentApi.kt`

---

## 六、SSE 解析

### 6.1 SSE 格式

```
event:json
data:{"directive":{"name":"PlayList","namespace":"ChatXmly","payload":{...}}}

event:binary
data:<base64 音频，跳过>

event:json
data:{"directive":{"name":"WrittenAnswer",...}}
```

- 只处理 `event:json` 的 `data:` 行，**跳过 `event:binary`**
- 一次查询约产生 100+ 条事件，大部分是 binary（TTS 音频），json 事件约 3-5 条

### 6.2 需要关注的 3 种 directive

#### ① PlayList — 推荐列表

```json
{
  "directive": {
    "name": "PlayList",
    "namespace": "ChatXmly",
    "payload": {
      "items": [...]
    }
  }
}
```

#### ② WrittenAnswer — AI 回复文案

```json
{
  "directive": {
    "name": "WrittenAnswer",
    "namespace": "ChatXmly",
    "payload": {
      "text": "为您找到如下内容。"
    }
  }
}
```

#### ③ Suggestions — 后续建议

```json
{
  "directive": {
    "name": "Suggestions",
    "namespace": "ChatXmly",
    "payload": {
      "suggestions": ["郭德纲经典相声作品推荐", "郭德纲相声的语言风格解析"]
    }
  }
}
```

---

## 七、PlayList item 实际数据结构（重要）

> **以下基于 2026-04-01 实测抓包，与喜马拉雅文档描述有差异，以实际为准。**

```json
{
  "title": "郭德纲21年相声精选",
  "cover_path": "https://imagev2.xmcdn.com/.../xxx.png!op_type=3&columns=290&rows=290",
  "cover": {
    "small":  { "url": "...!op_type=3&columns=86",  "width": "86",  "height": "86" },
    "middle": { "url": "...!op_type=3&columns=140", "width": "140", "height": "140" },
    "large":  { "url": "...!op_type=3&columns=290", "width": "290", "height": "290" }
  },
  "id": 9723091,
  "item_type": "album",
  "is_paid": false,
  "play_count": 3781475226,
  "intro": "2023德云社线上相声三场...",
  "media_id": "/album?album_id=9723091&play_source=...",
  "play_source": "...",
  "created_at": 1501577741000,
  "resouce_id": "9723091",

  "track": {
    "title": "《败家子儿》 郭德纲 于谦",
    "duration": 1401,
    "album_id": 9723091,
    "id": 45982355,
    "media_id": "/track?album_id=9723091&track_id=45982355&play_source=...",
    "cover_path": "http://imagev2.xmcdn.com/.../xxx.jpg",
    "image": { "url": "...", "width": 290, "height": 290 },
    "album_title": "郭德纲21年相声精选",
    "item_type": "track",
    "is_paid": false,
    "is_authorized": true,
    "play_source": "...",
    "created_at": 1501664024000,
    "resouce_id": "45982355"
  }
}
```

### 字段映射到推荐卡片

| 卡片字段 | 取值路径 | 说明 |
|----------|----------|------|
| **标题** | `item.title` | 专辑级标题 |
| **封面图** | `item.cover.large.url` 或 `item.cover_path` | 290px 封面，推荐用 large |
| **时长** | `item.track.duration` | **秒**。**注意：item 顶层无 duration 字段** |
| **播放 mediaId** | `item.track.media_id` | **必须用 track 级别的**，格式 `/track?album_id=&track_id=&play_source=` |
| 副标题 | `item.track.title` | 具体声音标题（如"《败家子儿》郭德纲 于谦"） |
| 简介 | `item.intro` | 专辑简介 |
| 是否付费 | `item.is_paid` | false = 免费 |
| 播放量 | `item.play_count` | 数字 |

### ⚠️ 踩坑记录

| 坑 | 说明 |
|----|------|
| **两类 item 结构完全不同** | 搜"郭德纲的相声"→ `item_type=album`，有 `track` 子对象；搜"国际新闻"→ `item_type=track`，**无 `track` 子对象** |
| **duration 位置** | album 类：在 `track.duration`（item 顶层无 duration）；track 类：在 `item.duration`（顶层直接有） |
| **mediaId 三种格式** | ① `/track?album_id=x&track_id=y&play_source=z` → 可直接播放；② `/album?album_id=x&play_source=z` → 专辑播放；③ `/tracks_list?start_from=/track?album_id%3Dx%26track_id%3Dy` → **需 URL 解码提取内部 `/track?...`** 才能播放 |
| **单曲 mediaId 有 URL 编码** | track 类 item 的 `media_id` 是 `/tracks_list?start_from=` 包裹的，`=` `&` 被编码为 `%3D` `%26`，必须 `URLDecoder.decode()` 提取内部路径 |
| **字段命名不统一** | text/query 返回 `media_id`（下划线）；proactive-recommend 返回 `track.mediaId`（驼峰） |
| **WrittenAnswer 可能流式逐字** | 搜"国际新闻"时 WrittenAnswer 逐字返回多条，需累积拼接而非覆盖 |
| **封面 URL 后缀** | cover_path 自带 `!op_type=3&columns=290` 裁切参数，可直接使用 |
| **SSE binary 事件** | 大量 `event:binary` 是 TTS 音频数据，必须跳过，只处理 `event:json` |

---

## 八、MediaSession 播放

车机已装喜马拉雅车载 APK，通过 MediaBrowserCompat 连接其 MediaBrowserService：

```kotlin
// 1. 连接
val mediaBrowser = MediaBrowserCompat(
    context,
    ComponentName(
        "com.ximalaya.ting.android.car",
        "com.ximalaya.ting.android.car.sdk.XmMediaBrowserService"
    ),
    connectionCallback,
    null
).apply { connect() }

// 2. 连接成功后获取 controller
override fun onConnected() {
    val controller = MediaControllerCompat(context, mediaBrowser.sessionToken)
    controller.registerCallback(controllerCallback)
}

// 3. 播放（mediaId 来自 track.media_id）
controller.transportControls.playFromMediaId(
    "/track?album_id=9723091&track_id=45982355&play_source=...",
    null
)

// 4. 监听回调
override fun onPlaybackStateChanged(state: PlaybackStateCompat?) { ... }
override fun onMetadataChanged(metadata: MediaMetadataCompat?) { ... }
```

**前提条件：**
- 车机已安装喜马拉雅车载 APK（`com.ximalaya.ting.android.car`）
- 调用方包名需加入喜马拉雅白名单（联系喜马拉雅 PM 配置）
- AndroidManifest 需声明 `<queries>` 以便发现喜马拉雅包：
  ```xml
  <queries>
      <package android:name="com.ximalaya.ting.android.car" />
  </queries>
  ```

> 参考实现：`player/MediaSessionPlayer.kt`

---

## 九、接入推荐卡片系统的建议

### 数据适配层

建议在 API 返回和卡片系统之间加一个数据适配，将 PlayList item 转为卡片系统的统一数据模型：

```kotlin
fun PlaylistItem.toCardItem() = CardItem(
    source = "ximalaya",
    title = this.title,                      // item.title
    subtitle = this.trackTitle,              // item.track.title
    coverUrl = this.coverUrl,                // item.cover.large.url
    durationSec = this.duration,             // item.track.duration (秒)
    gradientTheme = "blue",                  // 喜马拉雅用蓝色主题
    action = PlayAction(
        type = "media_session",
        mediaId = this.mediaId,              // item.track.media_id
        targetPackage = "com.ximalaya.ting.android.car"
    )
)
```

### Token 管理

- 建议在 Application 或全局单例中管理 token，避免每次查询都重新登录
- token 有效期 ~2h，设一个 Timer 在过期前 5 分钟自动刷新
- 无网络时缓存上一次的 token，重连后再刷新

### SSE 超时

- OkHttp `readTimeout` 建议设 60s（SSE 流可能持续 10-20s）
- 如果 30s 内没有收到 PlayList 事件，可以主动关闭连接并提示用户重试

### 错误处理

| 场景 | 处理 |
|------|------|
| token 过期（API 返回 401） | 清除缓存 token，重新游客登录，重试一次 |
| SSE 无 PlayList 事件 | 可能是查询无结果，展示 WrittenAnswer 文案即可 |
| MediaSession 连接失败 | 检查喜马拉雅 APK 是否安装、包名是否在白名单 |
| 网络异常 | 常规重试，注意 SSE 连接不支持断点续传 |

---

## 十、依赖

```groovy
implementation 'androidx.media:media:1.7.0'           // MediaBrowserCompat
implementation 'com.squareup.okhttp3:okhttp:4.12.0'   // HTTP + SSE 流读取
```

图片加载按项目已有方案选择（Glide/Coil 均可）。

---

## 十一、完整调用时序（实测数据）

```
T+0ms     启动 App
T+200ms   MediaSession connect → onConnected ✅
T+5800ms  游客登录 → access_token (expires_in=13027s) ✅
T+5800ms  发起 text/query SSE
T+9500ms  收到 PlayList (10 items) → 渲染列表
T+9500ms  收到 WrittenAnswer → 显示 AI 文案
T+11000ms 收到 Suggestions → 显示建议词条
T+11000ms SSE 流结束
T+用户点击  playFromMediaId → 喜马拉雅 APK 开始播放 ✅
```

总耗时（查询到出结果）：约 **5 秒**。

---

## 十二、Demo 源码结构

```
app/src/main/java/com/xiaomi/car/xmagent/
├── api/
│   ├── XimalayaSigner.kt      ← 签名算法
│   ├── XimalayaAuth.kt        ← 游客登录 + token 缓存
│   └── XimalayaAgentApi.kt    ← SSE 调用 + 解析
├── model/
│   ├── PlaylistItem.kt        ← 数据模型 + fromJson
│   └── UiState.kt             ← UI 状态
├── player/
│   └── MediaSessionPlayer.kt  ← MediaSession 连接 + 播放
├── ui/
│   └── PlaylistAdapter.kt     ← 列表渲染
├── MainActivity.kt            ← UI 入口
└── MainViewModel.kt           ← 业务编排
```

研发可直接复用 `api/` 和 `player/` 两个包，将 `PlaylistItem.fromJson()` 的输出适配到推荐卡片的数据模型即可。
