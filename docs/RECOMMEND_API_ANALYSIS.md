# 三方推荐接口分析文档 v1.0

> 本文档分析喜马拉雅、网易云音乐两个三方推荐接口的能力、字段、集成方案。
> 目标：评估能否对接到车端推荐卡片系统。

---

## 1. 喜马拉雅 — 主动推荐接口

### 1.1 接口概览

| 属性 | 值 |
|------|-----|
| **接口名** | 主动推荐 (Proactive Recommend) |
| **用途** | 基于驾驶场景 + 用户画像，智能推荐音频内容 |
| **协议** | HTTPS POST |
| **Content-Type** | `application/x-www-form-urlencoded; charset=UTF-8` |
| **流式地址** | `https://iovapi.ximalaya.com/iov-voice-service/iov-chat/proactive-recommend/stream` |
| **非流式地址** | `https://iovapi.ximalaya.com/iov-voice-service/iov-chat/proactive-recommend` |
| **响应格式** | 流式: SSE (Server-Sent Events) / 非流式: JSON |

### 1.2 凭证信息

| 凭证 | 值/说明 | 状态 |
|------|---------|------|
| `app_key` | `3d17306243e47f16d21dd438f9d5e5aa` | ✅ 已获取 |
| `app_secret` | `eed1faaec95bc415da5048a6b2190a4d` | ✅ 已获取 (签名用, **不可外泄**) |
| `access_token` | 通过游客登录或 APK ContentProvider 获取 | 需运行时获取 |
| `device_id` | 车端生成 (Android_ID/OAID, ≤32 字符) | 车端提供 |

### 1.3 签名算法 (sig)

签名对**除 sig 外所有请求参数的原始值**进行计算, 6 步流程:

```
Step 1: 将所有参数(除sig)按参数名字典序排序
Step 2: 用 & 拼接成 key=value&key=value... 形式 (value 不做 URL encode)
Step 3: 对拼接字符串做 Base64 编码 (UTF-8) → base64Str
Step 4: 用 app_secret 作为 HMAC-SHA1 的 key
Step 5: HMAC-SHA1(app_secret, base64Str) → 得到字节数组 (注意: 不是 hex 字符串!)
Step 6: 对字节数组做 MD5 → 得到 32 位小写 hex 字符串 = sig
```

**Python 实现**:

```python
import hashlib, hmac, base64, time, random, string, urllib.parse, json

APP_KEY = "3d17306243e47f16d21dd438f9d5e5aa"
APP_SECRET = "eed1faaec95bc415da5048a6b2190a4d"

def gen_sig(params: dict) -> str:
    """生成喜马拉雅 sig 签名"""
    # Step 1-2: 按 key 字典序排序, 拼接 (value 不做 URL encode)
    sorted_str = "&".join(f"{k}={params[k]}" for k in sorted(params.keys()) if k != "sig")
    # Step 3: Base64 编码
    base64_str = base64.b64encode(sorted_str.encode("utf-8"))
    # Step 4-5: HMAC-SHA1 (key=app_secret, msg=base64_str) → bytes
    sha1_bytes = hmac.new(APP_SECRET.encode("utf-8"), base64_str, hashlib.sha1).digest()
    # Step 6: MD5(sha1_bytes) → hex string
    return hashlib.md5(sha1_bytes).hexdigest()

def build_common_params(access_token: str, device_id: str) -> dict:
    """构造公共参数 + 签名"""
    params = {
        "app_key": APP_KEY,
        "device_id": device_id,
        "device_id_type": "Android_ID",
        "pack_id": "com.xiaomi.car.agent",
        "client_os_type": "2",  # Android
        "access_token": access_token,
        "nonce": "".join(random.choices(string.ascii_letters + string.digits, k=16)),
        "timestamp": str(int(time.time() * 1000)),
    }
    params["sig"] = gen_sig(params)
    return params
```

### 1.4 Token 管理 (三种方式)

#### 方式 A: 游客登录 (API 直接获取, 推荐先跑通)

| 属性 | 值 |
|------|-----|
| **接口** | `POST https://api.ximalaya.com/oauth2/secure_access_token` |
| **Content-Type** | `application/x-www-form-urlencoded` |

| 参数 | 说明 |
|------|------|
| `client_id` | 即 `app_key` |
| `device_id` | 设备 ID |
| `grant_type` | 固定 `client_credentials` |
| `nonce` / `timestamp` / `sig` | 同公共参数 |

```python
def get_guest_token(device_id: str) -> str:
    """游客登录获取 access_token (无需用户扫码)"""
    params = {
        "client_id": APP_KEY,
        "device_id": device_id,
        "grant_type": "client_credentials",
        "nonce": "".join(random.choices(string.ascii_letters + string.digits, k=16)),
        "timestamp": str(int(time.time() * 1000)),
    }
    params["sig"] = gen_sig(params)
    resp = requests.post("https://api.ximalaya.com/oauth2/secure_access_token", data=params)
    data = resp.json()
    # 返回: {"access_token": "xxx", "expires_in": 10348}
    return data["access_token"]  # 有效期约 2 小时
```

#### 方式 B: APK ContentProvider (车端已安装喜马拉雅 APK ≥ 7.1.6)

```kotlin
// 同 app_key 方式
val uri = Uri.parse("content://com.ximalaya.ting.android.car.xm.p/agent/app-token")
val cursor = contentResolver.query(uri, null, null, null, null)
// 返回: access_token, expire_time(秒), device_id, app_key, uid

// 不同 app_key 方式
val uri2 = Uri.parse("content://com.ximalaya.ting.android.car.xm.p/agent/related-channel-token?app_key=YOUR_AGENT_KEY")
// 返回: access_token, refresh_token, expire_time, uid, device_id, app_key
```

> ⚠️ 前提: 需向喜马拉雅提供座舱端包名做白名单配置; token 有效期约 **2 小时**

#### 方式 C: Token 刷新

| 属性 | 值 |
|------|-----|
| **接口** | `POST https://api.ximalaya.com/oauth2/refresh_token` |
| **参数** | `refresh_token` + `grant_type=refresh_token` + 公共参数 |

> access_token 有效期约 **2 小时**, refresh_token 有效期 **30 天** (每次刷新续期)

### 1.5 请求参数

#### 公共参数 (所有接口通用, form-urlencoded)

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `app_key` | string | 是 | `3d17306243e47f16d21dd438f9d5e5aa` |
| `device_id` | string | 是 | 设备唯一标识 (≤32 字符, 与申请 token 时一致) |
| `device_id_type` | string | 是 | `OAID` / `Android_ID` / `OAID_MD5` 等 |
| `pack_id` | string | 是 | 客户端包名 |
| `client_os_type` | string | 是 | `2` = Android |
| `access_token` | string | 是 | OAuth2 令牌 |
| `nonce` | string | 是 | 随机字符串 (**每次请求重新生成**) |
| `timestamp` | long | 是 | Unix 毫秒时间戳 (**每次请求重新生成**) |
| `sig` | string | 是 | 参数签名 (见 1.3 签名算法) |

#### 主动推荐专属参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `context` | string | 是 | **核心业务参数**, JSON 字符串 (见下方) |

#### Context 对象完整结构

```json
{
  "env": {
    "current_time": "2026-04-01 22:30:00",    // yyyy-MM-dd HH:mm:ss
    "weather": "大雨"                            // 晴天/多云/大雨/下雪
  },
  "scene": "通勤",                               // 通勤/接送孩子/...
  "cabin": {
    "occupant_summary": "仅主驾",                 // 仅主驾/有儿童/多人无儿童
    "occupants": [
      {
        "emotion": "平静",
        "age": 30,
        "gender": "男",                           // 男/女/未知
        "position": "主驾"                        // 主驾/副驾/后排
      }
    ]
  },
  "vehicle": {
    "nav_total_duration_min": 45,                // 导航总时长 (分钟)
    "nav_remaining_duration_min": 30,            // 剩余时长
    "traffic_status": "缓行",                     // 畅通/缓行/拥堵
    "nav_destination": "公司"
  },
  "user_profile": {
    "preferences": {},                            // 用户偏好 (自定义)
    "context_memory": {}                          // 上下文记忆 (自定义)
  },
  "behavior": {},                                 // 用户行为信号
  "ext": {}                                       // 扩展字段
}
```

**Context 字段来源映射 (车端)**:

| Context 字段 | 车端数据来源 |
|-------------|------------|
| `env.current_time` | 系统时间 |
| `env.weather` | 天气 API / 车机天气组件 |
| `scene` | 导航目的地推断 or 用户设置 |
| `cabin.occupants` | DMS (驾驶员监控) / 摄像头 |
| `vehicle.nav_*` | 导航 SDK |
| `vehicle.traffic_status` | 导航 SDK → 路况信息 |
| `user_profile` | 本地存储 / 用户中心 |

### 1.6 响应结构

#### 非流式响应

```json
{
  "welcome_text": "深夜通勤辛苦了，为你准备了轻松的内容",
  "recommend_list": {
    "scene": "夜间通勤",
    "items": [ /* RecommendItem 数组 */ ],
    "event_value": "evt_page_xxx"
  },
  "suggestions": ["换一批", "我想听音乐", "来点新闻"]
}
```

#### SSE 流式事件 (4 类 + 结束标记)

| 事件序号 | 事件名 | payload | 说明 |
|---------|--------|---------|------|
| 1 | `Intent` | `{"intent":"PROACTIVE_RECOMMEND"}` | 意图识别 |
| 2 | `WrittenAnswer` | `{"text":"欢迎语"}` | AI 生成的欢迎文案 |
| 3 | `ProactiveRecommendList` | `{"scene":"...", "items":[...]}` | **核心推荐列表** |
| 4 | `Suggestions` | `{"suggestions":[...]}` | 后续建议操作 |
| 5 | `Noop` | — | 流结束标记 |

#### RecommendItem 完整字段

| 字段 | 类型 | 说明 | 对应卡片字段 |
|------|------|------|------------|
| `content_type` | string | `track` / `album` / `aiRadio` | 决定播放行为 |
| `type` | string | 召回策略 (见下) | 可用于 UI 展示逻辑 |
| `id` | string | 内容唯一 ID | 播放 action |
| `title` | string | **主标题** | → 卡片标题 |
| `sub_title` | string | 副标题 | → 卡片副标题 |
| `decision_short_title` | string | 决策短标题 | → 可选的简短展示 |
| `cover` | string | **封面图 URL** | → 卡片封面 |
| `rec_reason` | string | 推荐理由 | → 可用于底栏 |
| `duration` | int | **时长 (秒)** | → 时长显示 |
| `played_second` | int | 已播放断点 (秒) | → 续播进度 |
| `play_count` | long | 播放量 | 可选展示 |
| `category_name` | string | 内容分类 | 可选 tag |
| `media_id` | string | **播放用 ID** | → 触发播放 |
| `album_title` | string | 所属专辑名 | track 类型时可用 |
| `track_title` | string | 声音名 | aiRadio/track 时 |
| `ai_radio_title` | string | AI 频道名 | aiRadio 类型时 |
| `event_value` | string | 埋点值 | 上报用 |
| `upt_time` | long | 更新时间戳 | 排序用 |
| `track` | object | `XiaoyaSimpleTrack` | track/aiRadio 时 |
| `album` | object | `XiaoyaSimpleAlbum` | album 类型时 |

### 1.7 六种召回策略

| 策略 type | 名称 | 返回内容 | 适合的卡片 |
|-----------|------|---------|-----------|
| `aiRadio` | AI 电台 | AI 混合频道 | 喜马拉雅卡 "快听" |
| `subscribeUpdate` | 订阅更新 | 用户已订阅的节目更新 | 喜马拉雅卡 列表项 |
| `anchor` | 常听主播 | 常听主播的新内容 | 喜马拉雅卡 列表项 |
| `continuePlayback` | 续播 | 上次未听完的内容 | 喜马拉雅卡 "上次听过" |
| `albumRecommend` | 专辑推荐 | 算法推荐专辑 | AI推荐卡 |
| `trackRecommend` | 声音推荐 | 算法推荐单条声音 | AI推荐卡 |

### 1.8 埋点上报接口

| 属性 | 值 |
|------|-----|
| URL | `https://api.ximalaya.com/iov-collect-service/iov-collect/api/v2/agent/statistic` |
| 方法 | POST |

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `event_type` | string | 是 | `expose` / `click` / `page_view` |
| `event_values` | string | 是 | 对应 item 的 `event_value`, 多个逗号分隔 |

**埋点时机**:
- `page_view`: 卡片整体展示 → 用 `recommend_list.event_value`
- `expose`: 某推荐项进入可见区域 → 用 `item.event_value`
- `click`: 用户点击某推荐项 → 用 `item.event_value`

### 1.9 播放链路 — MediaSession (APK 方式)

收到推荐列表后, 通过喜马拉雅 APK 的 `MediaSession` 播放 `media_id`。

#### media_id 格式

```
/track?album_id=83944735&track_id=965120970&play_source=0vTe8OM3LQY7gm9iePS8...
```

#### 播放实现 (Kotlin)

```kotlin
// Step 1: 连接 MediaSession
val mediaBrowser = MediaBrowserCompat(
    context,
    ComponentName(
        "com.ximalaya.ting.android.car",                    // 喜马拉雅车载 APK 包名
        "com.ximalaya.ting.android.car.sdk.XmMediaBrowserService"  // MediaBrowser 服务
    ),
    object : MediaBrowserCompat.ConnectionCallback() {
        override fun onConnected() {
            // Step 2: 获取 MediaController
            val controller = MediaControllerCompat(context, mediaBrowser.sessionToken)
            controller.registerCallback(controllerCallback)

            // Step 3: 通过 media_id 播放
            controller.transportControls.playFromMediaId(mediaId, null)
        }
        override fun onConnectionSuspended() { /* 重连逻辑 */ }
        override fun onConnectionFailed() { /* 错误处理 */ }
    },
    null
).apply { connect() }
```

> ⚠️ 需车端已安装喜马拉雅 APK (包名 `com.ximalaya.ting.android.car`)
> 如有问题联系喜马拉雅获取 MediaSession Demo

### 1.10 AI Agent 文本查询接口 (/iov-chat/text/query)

除了主动推荐, 还可通过 AI Agent 接口进行语音点播、问答:

| 属性 | 值 |
|------|-----|
| **接口** | `POST https://iovapi.ximalaya.com/iov-voice-service/iov-chat/text/query` |
| **Content-Type** | `application/x-www-form-urlencoded; charset=UTF-8` |
| **响应** | SSE (event:json / event:binary / event:error) |

#### 额外参数 (在公共参数基础上)

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `query` | string | 是 | 用户文本输入 (如 "来点郭德纲的相声") |
| `dialog_id` | string | 否 | 多轮会话 ID (首轮由服务端返回, 后续轮次必传) |
| `mode_type` | int | 是 | 固定 `2` |
| `context` | string | 是 | JSON 字符串, 含播放状态/展示列表/用户信息 |

#### SSE 返回的核心 Directive 类型

| Directive | Namespace | 说明 |
|-----------|-----------|------|
| `Intent` | ChatXmly | 意图识别结果 (如 NLRS=搜索) |
| `PlayList` | ChatXmly | **搜索结果列表** (含 items: cover/title/duration/media_id) |
| `WrittenAnswer` | ChatXmly | AI 文案 (文字版) |
| `SpokenAnswer` | ChatXmly | AI 语音文案 (流式逐字) |
| `Suggestions` | ChatXmly | 后续建议操作列表 |
| `ttsStart`/`ttsEnd` | Speech | TTS 音频流边界 (outputMode=audio 时) |
| `PlayUrl` | Speech | TTS 播放地址 |

#### PlayList item 数据结构 (text/query 返回)

与主动推荐的 `RecommendItem` 类似但字段名不同:

| 字段 | 类型 | 说明 | 对应卡片字段 |
|------|------|------|------------|
| `title` | string | 专辑/声音标题 | → 卡片标题 |
| `cover_path` | string | 封面图 URL | → 卡片封面 |
| `cover` | object | 多尺寸封面 (small/middle/large) | → 选合适尺寸 |
| `duration` | int | 时长 (秒) | → 时长显示 |
| `item_type` | string | `album` / `track` | → 播放行为 |
| `id` | long | 内容 ID | → 标识 |
| `play_source` | string | 播放来源标识 | → media_id 构建 |
| `is_paid` | boolean | 是否付费 | → 付费标识 |
| `track` | object | 嵌套 track 详情 (album 类型时) | → 具体播放声音 |

### 1.11 完整调用链路总结

```
┌─────────────────────────────────────────────────────────┐
│  车端 Entertainment Agent 完整调用链路 (喜马拉雅)        │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  1. 初始化                                              │
│     ├─ 游客登录 → access_token (2h 有效)                │
│     └─ 连接 MediaSession → MediaController              │
│                                                         │
│  2. 获取推荐                                            │
│     ├─ 构造 Context (天气/导航/车内人员/偏好)            │
│     ├─ 生成 sig 签名                                    │
│     └─ POST /proactive-recommend/stream → SSE           │
│        ├─ Intent → 意图确认                             │
│        ├─ WrittenAnswer → AI 欢迎语                     │
│        ├─ ProactiveRecommendList → items[]              │
│        ├─ Suggestions → 后续操作                        │
│        └─ Noop → 流结束                                 │
│                                                         │
│  3. 展示卡片                                            │
│     └─ items → 标题/封面/时长/推荐理由 → 渲染 UI        │
│                                                         │
│  4. 播放                                                │
│     └─ MediaController.playFromMediaId(media_id)        │
│                                                         │
│  5. 埋点                                                │
│     ├─ page_view → 卡片展示                             │
│     ├─ expose → 具体 item 曝光                          │
│     └─ click → 用户点击                                 │
│                                                         │
│  6. Token 续期                                          │
│     └─ 2h 到期前 → refresh_token 刷新                   │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## 2. 网易云音乐 — 开放平台接口

> ✅ 以下信息已通过浏览器直接访问 `developer.music.163.com` 获取，为**官方文档真实内容**。

### 2.1 你分享的接口：一句话歌单 (AI 歌单生成)

| 属性 | 值 |
|------|-----|
| **接口名** | 开放平台一句话歌单 |
| **用途** | 用户输入一句话描述场景/情绪，AI 自动生成匹配歌单 |
| **协议** | SSE (Server-Sent Events), Content-Type=text/event-stream |
| **方法** | POST |
| **域名** | `openapi-stream.music.163.com` |
| **路径** | `/openapi/stream/common/ai/playlist/create` |
| **前置条件** | 需申请接口组：**云音乐智能搜推能力** |

> 💡 **亮点**: 这个接口和我们的 AI推荐卡完美匹配 — 可以用 "雨天深夜通勤" 之类的场景描述直接生成歌单！

### 2.2 IOT 端公共参数 (车载设备通用)

适用范围：车载、手表、音箱、电视、智能硬件等所有 IoT 设备。

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `appId` | String | 是 | 云音乐分配的应用 ID (控制台获取) |
| `signType` | String | 是 | 签名算法, 目前支持 `RSA_SHA256` |
| `sign` | String | 是 | 请求参数的签名串 (RSA 加密) |
| `timestamp` | Long | 是 | UNIX 时间戳 (**毫秒级**) |
| `bizContent` | String | 是 | 业务参数 JSON 字符串 (**需 URL encode**) |
| `accessToken` | String | 按接口 | 登录令牌; 匿名登录不需要, 其他接口必传 |
| `device` | String | 是 | 设备信息 JSON 字符串 (**需 URL encode**) |

#### device 设备信息字段

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `channel` | String | 是 | 厂商标识 (**云音乐分配, 需线下联系**) |
| `deviceId` | String | 是 | 设备唯一 ID (SN/MAC/IMEI/VIN 等, ≤64 字符) |
| `deviceType` | String | 是 | 设备类型 (**需线下联系云音乐确认**) |
| `appVer` | String | 是 | 客户端版本号 (格式: x.x.x) |
| `os` | String | 是 | 操作系统类型 (**云音乐分配**) |
| `osVer` | String | 否 | 操作系统版本 (如 8.1.0) |
| `brand` | String | 是 | 品牌 (**需线下联系确认**) |
| `model` | String | 否 | 设备型号 (车型/产品型号) |
| `clientIp` | String | 否 | 终端 IP |
| `flowFlag` | String | 否 | 是否初始化, 默认 `init` (决定是否计入日活) |

### 2.3 需要找网易云获取的凭证

| 凭证 | 说明 | 获取方式 |
|------|------|---------|
| `appId` | 应用 ID | **开放平台控制台创建应用后获取** |
| `channel` | 厂商标识 | **线下联系云音乐同事分配** |
| `deviceType` | 设备类型 | **线下联系云音乐产品确认** |
| `os` | 操作系统类型 | **线下联系云音乐分配** |
| `brand` | 品牌标识 | **线下联系确认** |
| RSA 密钥对 | 签名用 | 本地 OpenSSL 生成, 公钥上传平台 |
| `accessToken` | 用户登录令牌 | 通过匿名登录/二维码登录接口获取 |

### 2.4 一句话歌单 — 业务参数 (bizContent)

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `sessionId` | String | 首次可选 | 会话 ID; 首次请求可由服务端生成，后续对话**必传** |
| `query` | String | 是 | **用户输入的场景描述** (如 "雨天深夜通勤", "带点沙哑烟嗓") |

> **query 最佳实践**: 用具体场景/情绪/兴趣 + 细节描述替代模糊需求，触发 AI 对"风格、氛围、记忆"的理解。

### 2.5 一句话歌单 — 响应结构 (SSE 流式)

#### SSE 事件格式

每条 SSE 事件为 `data:{JSON}`, 其中 JSON 结构:

| 字段 | 类型 | 说明 |
|------|------|------|
| `code` | int | 200=正常, 其他=异常 |
| `contentDone` | boolean | 单类资源是否完结 (可带 content) |
| `totalDone` | boolean | **整体完结** (服务端断开 SSE, 不带 content) |
| `totalException` | boolean | 整体超时/异常 |
| `sessionId` | String | 会话 ID |
| `dialogueId` | String | 本次对话 ID |
| `msgIndex` | int | 消息序号 (从 0 开始) |
| `responseContent` | Object | **核心响应内容** |
| `specialMeasures` | String | 特殊处理措施 (反垃圾/异常时) |

#### responseContent 结构

| 字段 | 类型 | 说明 |
|------|------|------|
| `contentType` | String | `text` / `resourceList` / promptList / logger (**只需关注 text 和 resourceList**) |
| `bizType` | String | 业务类型 (一般不使用) |
| `content` | Object | 具体内容 (格式取决于 contentType) |

**contentType = "text"**: AI 生成的文案 (推荐理由/歌单描述)
**contentType = "resourceList"**: **歌曲列表** ← 核心数据

#### resourceList → content 结构

| 字段 | 类型 | 说明 | 对应卡片字段 |
|------|------|------|------------|
| `resourceType` | String | 资源类型, 目前只有 `"song"` | — |
| `resourceId` | String | 资源 ID | 播放 action |
| `contentExt` | String | **SongModel JSON 字符串** | 解析后使用 |

#### SongModel (核心歌曲数据)

| 字段 | 类型 | 说明 | 对应卡片字段 |
|------|------|------|------------|
| `encId` | String | 歌曲加密 ID | 播放/查询用 |
| `name` | String | **歌曲名** | → 卡片标题 |
| `duration` | Integer | **歌曲时长** (毫秒) | → 时长显示 (需÷1000) |
| `artists` | List\<ArtistModel\> | **歌手列表** | → 卡片副标题 |
| `albumModel` | List\<AlbumModel\> | 专辑信息 | → 封面图来源 |
| `privilegeModel` | List\<PrivilegeModel\> | 权限信息 | → 判断可否播放 |

#### ArtistModel

| 字段 | 类型 | 说明 |
|------|------|------|
| `encId` | String | 歌手加密 ID |
| `name` | String | **歌手名** |

#### PrivilegeModel

| 字段 | 类型 | 说明 |
|------|------|------|
| `visible` | Boolean | 是否有版权 |
| `playFlag` | Boolean | **是否可播放** |
| `vipFlag` | Boolean | 是否需要会员 |

> ⚠️ 注意: SongModel 中**没有直接返回封面图 URL 和播放 URL**。需要用 `encId` 调用以下补充接口:
> - 封面图: `获取歌曲详情` 接口 → album.picUrl
> - 播放地址: `获取歌曲播放url` 或 `批量获取歌曲播放url` 接口

### 2.6 补充接口 (完成播放链路所需)

从完整 API 目录中，以下接口构成车端推荐卡的完整链路:

| 接口 | 功能 | 用途 |
|------|------|------|
| **匿名登录** | 获取 accessToken (无需用户扫码) | 首次启动必调 |
| **一句话歌单** | AI 生成场景歌单 (SSE) | QQ音乐卡 / AI推荐卡 数据源 |
| **每日推荐** | 基于用户偏好的日推歌曲 | QQ音乐卡 "每日30首" |
| **获取场景音乐标签** | 获取场景列表 (通勤/健身/...) | AI推荐卡场景匹配 |
| **获取场景音乐标签下的歌曲** | 按场景获取歌曲 | AI推荐卡备选数据源 |
| **私人定制** | 算法推荐歌曲 | QQ音乐卡 "猜你喜欢" |
| **获取歌曲详情** | 歌曲名/歌手/专辑封面 | 补全 SongModel 缺失的封面图 |
| **批量获取歌曲播放url** | 获取播放地址 | 实际播放必需 |
| **跨端续播-查询** | 获取上次播放进度 | QQ音乐卡 "上次听过" / 播放器续播 |
| **跨端续播-上报** | 上报播放进度 | 退出时保存进度 |
| **播放数据回传** | 上报播放行为 | 合规要求 + 优化推荐 |

### 2.7 完整 API 目录 (与车端相关的分类)

```
音乐API文档
├── 用户登录API
│   ├── 匿名登录 ★
│   ├── 获取登录二维码
│   ├── 轮询二维码状态
│   ├── 刷新AccessToken ★
│   └── 获取用户基本信息
├── 推荐-歌曲类API
│   ├── 每日推荐 ★
│   ├── 每日推荐封面
│   ├── 获取相似歌曲（新）
│   ├── 心动模式
│   ├── 获取场景音乐标签 ★
│   ├── 获取场景音乐标签下的歌曲 ★
│   └── 私人定制 ★
├── 推荐-歌单类API
│   ├── 获取推荐歌单列表
│   ├── 获取雷达歌单
│   ├── 获取榜单列表
│   └── 最近常听 ★
├── 日推MIX
│   ├── 日推mix
│   ├── 获取相似艺人-歌曲列表
│   ├── 获取相似歌曲-歌曲列表
│   └── 获取风格日推-歌曲列表
├── 私人漫游API
│   ├── 获取私人漫游场景模式
│   └── 获取私人漫游场景歌曲
├── AI互动
│   ├── 开放平台智能搜推
│   └── 开放平台一句话歌单 ★★★ (你分享的)
├── 查询歌曲API
│   ├── 获取歌曲详情 ★
│   └── 批量获取歌曲信息 ★
├── 获取播放地址API
│   ├── 获取歌曲播放url ★
│   └── 批量获取歌曲播放url ★
├── 跨端续播API ★
│   ├── 跨端续播-查询
│   └── 跨端续播-上报
├── AIDJ
│   ├── 获取音色列表
│   └── 获取歌曲口播信息
└── 播放数据回传API ★
    └── 音乐/长音频播放数据回传
```

(★ = 车端推荐卡直接相关, ★★★ = 核心接口)

---

## 3. 对比分析

### 3.1 能力对比

| 能力维度 | 喜马拉雅 | 网易云音乐 |
|---------|---------|-----------|
| **内容类型** | 播客/有声书/电台 (音频内容) | 音乐歌曲 (纯音乐) |
| **推荐智能度** | ⭐⭐⭐⭐⭐ 场景感知 (天气/导航/车内人员) | ⭐⭐⭐⭐ AI 一句话歌单 (自然语言→场景歌单) + 每日推荐 + 场景标签 + 私人定制 |
| **场景适配** | 原生车载设计, Context 含 vehicle/cabin | IOT 端专属接口 (device 含 channel/brand/model), 有场景音乐标签体系 |
| **流式支持** | SSE 流式 + 非流式双模式 | SSE 流式 (一句话歌单), 其他接口为标准 JSON |
| **AI 文案** | 有 (WrittenAnswer 事件) | 有 (SSE contentType=text, AI 生成推荐语/歌单描述) |
| **续播能力** | 有 (`continuePlayback` + `played_second`) | 有 (跨端续播 API: 查询 + 上报) |
| **埋点体系** | 完整 (expose/click/page_view) | 有 (播放数据回传 API, 合规必需) |
| **返回内容** | 内容列表 (多个 RecommendItem, 含封面/时长/播放) | 歌曲列表 (SongModel, **需补充调用获取封面图和播放 URL**) |
| **补充接口** | 单接口闭环, 不需要额外调用 | 需 2 次额外调用: 歌曲详情(封面) + 播放URL |

### 3.2 字段映射到卡片 UI

| 卡片字段 | 喜马拉雅字段 | 网易云字段 |
|---------|------------|-----------|
| **标题** | `item.title` | `SongModel.name` |
| **副标题** | `item.sub_title` | `SongModel.artists[0].name` |
| **封面图** | `item.cover` (直接返回) | ⚠️ SongModel 不含封面 → 需调 `获取歌曲详情` 接口 → `album.picUrl` |
| **时长** | `item.duration` (秒) | `SongModel.duration` (毫秒, 需÷1000) |
| **播放 action** | `item.media_id` + `content_type` | `SongModel.encId` → 需调 `批量获取歌曲播放url` 接口获取播放地址 |
| **推荐理由** | `item.rec_reason` | SSE contentType=text 中 AI 生成的推荐文案 |
| **续播进度** | `item.played_second` | 需调 `跨端续播-查询` 接口 |
| **可播放判断** | 无 (默认可播) | `PrivilegeModel.playFlag` + `visible` (版权) + `vipFlag` (会员) |

### 3.3 认证复杂度对比

| 维度 | 喜马拉雅 | 网易云音乐 |
|------|---------|-----------|
| 申请流程 | ✅ app_key + app_secret 已获取 | 开放平台创建应用获取 appId + **线下联系**获取 channel/deviceType/os/brand |
| 签名方式 | ✅ HMAC-SHA1 + MD5 (算法已明确, 见 1.3) | RSA_SHA256 签名 (`sign` = RSA 私钥签名拼接字符串) |
| 认证方式 | 游客登录 `/oauth2/secure_access_token` 或 APK ContentProvider | 匿名登录接口获取 accessToken (无需用户扫码即可使用) |
| Token 有效期 | **2 小时** (refresh_token 30 天) | 需定期刷新 (刷新AccessToken 接口) |
| 播放方式 | MediaSession `playFromMediaId` (APK) | 需调 `批量获取播放url` 接口 |
| 复杂度 | ⭐⭐ 中等 (凭证已齐, 可直接开发) | ⭐⭐⭐ 中高 (RSA 签名 + 多参数 URL encode + 线下协调) |

### 3.4 数据链路完整度对比

| 维度 | 喜马拉雅 | 网易云音乐 |
|------|---------|-----------|
| 推荐→展示 | 1 次调用即可 (含标题/封面/时长) | 1 次 SSE 获取歌曲列表 + 1 次批量获取详情(封面) = **最少 2 次调用** |
| 展示→播放 | media_id 直接播放 (需确认方式) | 额外调 `批量获取歌曲播放url` = **3 次调用** |
| 推荐多样性 | 6 种召回策略 (场景/续播/兴趣/时段/热门/新品) | 多接口组合: 一句话歌单 + 每日推荐 + 场景标签 + 私人定制 + 私人漫游 |
| AI 能力 | 服务端 AI 决策 (用户无感) | 用户可主动输入 query (如 "雨天深夜通勤"), AI 理解场景生成歌单 |

---

## 4. 需要找三方获取的信息

### 4.1 喜马拉雅 — 已获取 & 待确认

> ✅ 已获取: app_key, app_secret, 签名算法, Token 管理, MediaSession 播放方式

| # | 事项 | 优先级 | 状态 |
|---|------|--------|------|
| 1 | ~~`app_key` + `app_secret`~~ | ~~P0~~ | ✅ 已获取 |
| 2 | ~~`sig` 签名算法~~ | ~~P0~~ | ✅ HMAC-SHA1+MD5, 见 1.3 |
| 3 | ~~Token 有效期 & 刷新~~ | ~~P1~~ | ✅ 2h 有效, refresh_token 30d |
| 4 | ~~播放 media_id 方式~~ | ~~P0~~ | ✅ MediaSession `playFromMediaId` |
| 5 | 车端 `device_id` 确定 (Android_ID or OAID) | **P1** | ⏳ 需车端确认 |
| 6 | 车端包名 (`pack_id`) 确定 | **P1** | ⏳ 需车端确认 |
| 7 | APK 白名单配置 (座舱端包名) | P1 | ⏳ 需找喜马拉雅配置 |
| 8 | 主动推荐返回的 items 数量上限 | P2 | ⏳ 实测确认 |

### 4.2 网易云音乐 — 需要确认/获取

> ✅ 已获取完整 API 文档 (一句话歌单 + 60+ 相关接口), 以下为**仍需线下协调**的事项:

| # | 事项 | 优先级 | 说明 |
|---|------|--------|------|
| 1 | ~~文档获取~~ | ~~P0~~ | ✅ 已完成 (见 Section 2) |
| 2 | 开放平台 `appId` (是否已创建应用) | **P0** | 控制台创建应用后获取, 所有接口必传 |
| 3 | `channel` 厂商标识 | **P0** | **需线下联系云音乐同事分配**, 无法自行获取 |
| 4 | `deviceType` 设备类型 | **P0** | **需线下联系云音乐产品确认** |
| 5 | `os` 操作系统类型 | **P0** | **需线下联系云音乐分配** |
| 6 | `brand` 品牌标识 | **P0** | **需线下联系确认** |
| 7 | RSA 密钥对生成 & 公钥上传 | **P0** | 本地 `openssl genrsa` 生成, 公钥上传开放平台控制台 |
| 8 | 匿名登录测试 → 获取 accessToken | P1 | 拿到上述凭证后即可调用, 无需用户扫码 |
| 9 | VIP 歌曲播放策略 | P1 | `PrivilegeModel.vipFlag=true` 的歌曲是否可试听/跳过 |

---

## 5. 模拟调用可行性评估

### 5.1 喜马拉雅 — ✅ 可立即模拟

**前提全部满足**: app_key ✅ + app_secret ✅ + sig 算法 ✅ → 只需获取 access_token 即可调用

**完整调用脚本** (Python, 可直接运行):

```python
import requests, hashlib, hmac, base64, time, random, string, json, urllib.parse

APP_KEY = "3d17306243e47f16d21dd438f9d5e5aa"
APP_SECRET = "eed1faaec95bc415da5048a6b2190a4d"
DEVICE_ID = "test_xiaomi_car_001"  # 测试用, 正式需替换

def gen_sig(params):
    sorted_str = "&".join(f"{k}={params[k]}" for k in sorted(params.keys()) if k != "sig")
    b64 = base64.b64encode(sorted_str.encode("utf-8"))
    sha1 = hmac.new(APP_SECRET.encode("utf-8"), b64, hashlib.sha1).digest()
    return hashlib.md5(sha1).hexdigest()

# Step 1: 游客登录
token_params = {
    "client_id": APP_KEY, "device_id": DEVICE_ID,
    "grant_type": "client_credentials",
    "nonce": "".join(random.choices(string.ascii_letters, k=16)),
    "timestamp": str(int(time.time() * 1000)),
}
token_params["sig"] = gen_sig(token_params)
token_resp = requests.post("https://api.ximalaya.com/oauth2/secure_access_token", data=token_params)
access_token = token_resp.json()["access_token"]
print(f"✅ access_token: {access_token}")

# Step 2: 主动推荐
context = json.dumps({
    "env": {"current_time": time.strftime("%Y-%m-%d %H:%M:%S"), "weather": "晴天"},
    "scene": "通勤",
    "vehicle": {"nav_total_duration_min": 30, "nav_remaining_duration_min": 20, "traffic_status": "畅通"},
    "cabin": {"occupant_summary": "仅主驾"}
})
rec_params = {
    "app_key": APP_KEY, "device_id": DEVICE_ID,
    "device_id_type": "Android_ID", "pack_id": "com.xiaomi.car.agent",
    "client_os_type": "2", "access_token": access_token,
    "nonce": "".join(random.choices(string.ascii_letters, k=16)),
    "timestamp": str(int(time.time() * 1000)),
    "context": context,
}
rec_params["sig"] = gen_sig(rec_params)

# 非流式调用
resp = requests.post(
    "https://iovapi.ximalaya.com/iov-voice-service/iov-chat/proactive-recommend",
    data=rec_params, headers={"Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"}
)
print(json.dumps(resp.json(), ensure_ascii=False, indent=2))

# 流式调用 (SSE)
rec_params["nonce"] = "".join(random.choices(string.ascii_letters, k=16))
rec_params["timestamp"] = str(int(time.time() * 1000))
rec_params["sig"] = gen_sig(rec_params)
sse_resp = requests.post(
    "https://iovapi.ximalaya.com/iov-voice-service/iov-chat/proactive-recommend/stream",
    data=rec_params, stream=True,
    headers={"Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"}
)
for line in sse_resp.iter_lines(decode_unicode=True):
    if line.startswith("data:"):
        print(line)
```

**评估**:
- 接口文档完整度: ⭐⭐⭐⭐⭐ (签名算法、Token、Context、响应结构全部明确)
- 模拟调用难度: ⭐ (凭证已齐, 脚本可直接跑)
- 集成工作量: **1-2 天** (验证 + 对接卡片 UI)

### 5.2 网易云音乐 — ✅ 可模拟 (需线下协调凭证)

**前提**: 拿到 `appId` + `channel`/`deviceType`/`os`/`brand` (线下分配) + 生成 RSA 密钥对

**调用链路** (完整流程, 3 步):

```
Step 1: 匿名登录 → 获取 accessToken
Step 2: 一句话歌单 SSE → 获取 SongModel 列表 (含 encId/name/duration/artists)
Step 3: 批量获取歌曲详情 + 批量获取播放URL → 补全封面图 + 播放地址
```

**一句话歌单调用示例** (伪代码):

```python
import time, json, urllib.parse
from Crypto.Signature import pkcs1_15
from Crypto.Hash import SHA256
from Crypto.PublicKey import RSA

# 1. 构造公共参数
app_id = "YOUR_APP_ID"
timestamp = str(int(time.time() * 1000))
biz_content = json.dumps({"sessionId": "", "query": "雨天深夜通勤，适合发呆"})
device = json.dumps({"channel": "XIAOMI_CAR", "deviceId": "VIN_xxx", "deviceType": "car", "appVer": "1.0.0", "os": "android", "brand": "xiaomi"})

# 2. RSA_SHA256 签名
sign_str = f"accessToken=&appId={app_id}&bizContent={biz_content}&device={device}&signType=RSA_SHA256&timestamp={timestamp}"
private_key = RSA.import_key(open("private.pem").read())
h = SHA256.new(sign_str.encode("utf-8"))
sign = pkcs1_15.new(private_key).sign(h).hex()  # 或 base64

# 3. 发送请求 (SSE)
params = {
    "appId": app_id,
    "signType": "RSA_SHA256",
    "sign": sign,
    "timestamp": timestamp,
    "bizContent": urllib.parse.quote(biz_content),
    "device": urllib.parse.quote(device),
    "accessToken": "FROM_ANONYMOUS_LOGIN"
}
# POST to 一句话歌单 endpoint, Accept: text/event-stream
```

**评估**:
- 接口文档完整度: ⭐⭐⭐⭐⭐ (官方文档齐全, SSE 结构 / SongModel / 补充接口全部明确)
- 模拟调用难度: ⭐⭐⭐ (RSA 签名逻辑清晰, 但需线下拿 4 个分配参数)
- 集成工作量: 3-5 天 (拿到凭证后; 含封面/播放URL 的补充调用链路)
- **关键风险**: `channel`/`deviceType`/`os`/`brand` 必须线下联系云音乐，无法自行注册获取

### 5.3 建议的集成优先级

```
Phase 1 (立即): 喜马拉雅接口跑通 ← 凭证已齐, 可直接开始
  → 运行 5.1 中的 Python 测试脚本
  → 验证游客登录 → access_token
  → 验证主动推荐 → RecommendItem (封面/标题/时长/media_id)
  → 验证 AI Agent text/query → PlayList 返回

Phase 2 (同步): 网易云线下协调启动
  → 找网易云拿 channel / deviceType / os / brand 四个分配参数
  → 本地 openssl genrsa 生成 RSA 密钥对, 公钥上传开放平台
  → 创建应用获取 appId

Phase 3 (拿到凭证后): 网易云接口跑通
  → 匿名登录 → 一句话歌单 SSE → 解析 SongModel
  → 批量获取歌曲详情 (封面) + 播放URL
  → 验证 PrivilegeModel (版权/VIP 过滤)

Phase 4: 统一数据层 + 车端集成
  → 将两个接口返回数据 normalize 成统一 CardItem 格式
  → 对接 ANDROID_DEV_GUIDE.md 中定义的数据接口
  → 喜马拉雅: MediaSession 播放集成
  → 网易云: 播放URL 获取 + 自建播放器
  → Token 自动续期 (喜马拉雅 2h / 网易云按需)
```

---

## 6. 统一数据适配层设计

无论喜马拉雅还是网易云，最终都需要 normalize 成卡片系统能消费的统一格式。

### 6.1 统一 CardItem 数据模型

```json
{
  "source": "ximalaya | netease",
  "source_icon": "icon_url",
  "source_name": "喜马拉雅 | 网易云音乐",
  "ai_text": "AI 推荐文案 (来自 SSE text 事件或 WrittenAnswer)",
  "items": [
    {
      "id": "唯一ID",
      "title": "主标题",
      "subtitle": "副标题 (歌手/主播名)",
      "cover_url": "封面图URL",
      "duration_sec": 300,
      "played_sec": 0,
      "gradient_theme": "blue|purple|red|green",
      "content_type": "track|album|podcast|aiRadio",
      "playable": true,
      "vip_required": false,
      "action": {
        "type": "play",
        "media_id": "xxx",
        "play_url": "https://...",
        "source_type": "ximalaya|netease"
      },
      "extra": {
        "rec_reason": "推荐理由",
        "category": "分类",
        "event_value": "埋点值"
      }
    }
  ]
}
```

### 6.2 字段来源映射

| CardItem 字段 | 喜马拉雅来源 | 网易云来源 | 备注 |
|--------------|------------|-----------|------|
| `id` | `item.media_id` | `SongModel.encId` | 唯一标识 |
| `title` | `item.title` | `SongModel.name` | |
| `subtitle` | `item.sub_title` | `SongModel.artists[].name` 拼接 | 多歌手用 "/" 连接 |
| `cover_url` | `item.cover` (直接返回) | ⚠️ 需额外调 `获取歌曲详情` → `album.picUrl` | **网易云最大差异点** |
| `duration_sec` | `item.duration` (已是秒) | `SongModel.duration / 1000` | 网易云返回毫秒 |
| `played_sec` | `item.played_second` | 需调 `跨端续播-查询` | |
| `playable` | 默认 `true` | `PrivilegeModel.playFlag && visible` | |
| `vip_required` | 默认 `false` | `PrivilegeModel.vipFlag` | 影响 UI 展示 VIP 标 |
| `action.play_url` | 无需 URL, 用 `MediaSession.playFromMediaId(media_id)` | 需调 `批量获取歌曲播放url` | **播放方式完全不同** |
| `ai_text` | WrittenAnswer 事件 | SSE contentType=text | AI 推荐文案 |
| `extra.rec_reason` | `item.rec_reason` | 可复用 ai_text 或置空 | |

### 6.3 适配器伪代码

```kotlin
// 统一适配器接口
interface RecommendAdapter {
    suspend fun fetchRecommendations(context: SceneContext): CardData
}

// 喜马拉雅适配器 — 单次调用, 数据完整, 播放走 MediaSession
class XimalayaAdapter(private val mediaController: MediaControllerCompat) : RecommendAdapter {
    override suspend fun fetchRecommendations(context: SceneContext): CardData {
        val response = ximalayaApi.proactiveRecommend(context.toXimalayaContext())
        return CardData(
            source = "ximalaya",
            ai_text = response.writtenAnswer,
            items = response.items.map { it.toCardItem() }  // 直接映射, 含封面/时长
        )
    }
    // 播放: 不需要 play_url, 直接用 MediaSession
    fun play(mediaId: String) {
        mediaController.transportControls.playFromMediaId(mediaId, null)
    }
}

// 网易云适配器 — 三步调用, 需补全封面和播放URL
class NeteaseAdapter : RecommendAdapter {
    override suspend fun fetchRecommendations(context: SceneContext): CardData {
        // Step 1: 一句话歌单 SSE → SongModel 列表 + AI 文案
        val (songs, aiText) = neteaseApi.aiPlaylistSSE(context.toQuery())
        val encIds = songs.map { it.encId }

        // Step 2: 批量补全 (并行请求)
        val (details, playUrls) = coroutineScope {
            val detailsDeferred = async { neteaseApi.batchSongDetail(encIds) }  // → 封面
            val urlsDeferred = async { neteaseApi.batchPlayUrl(encIds) }        // → 播放地址
            detailsDeferred.await() to urlsDeferred.await()
        }

        // Step 3: 合并为 CardItem
        return CardData(
            source = "netease",
            ai_text = aiText,
            items = songs.mapIndexed { i, song ->
                CardItem(
                    id = song.encId,
                    title = song.name,
                    subtitle = song.artists.joinToString("/") { it.name },
                    cover_url = details[i]?.album?.picUrl ?: "",
                    duration_sec = song.duration / 1000,
                    playable = song.privilege?.playFlag == true && song.privilege?.visible == true,
                    vip_required = song.privilege?.vipFlag == true,
                    action = PlayAction(media_id = song.encId, play_url = playUrls[i] ?: "")
                )
            }
        )
    }
}
```

### 6.4 关键设计决策

1. **封面图缓存**: 网易云每次推荐都需额外调歌曲详情获取封面, 应在适配层做 LRU 缓存 (encId → picUrl), 避免重复请求
2. **播放URL 时效性**: 播放地址通常有时效 (分钟级), 不应长期缓存; 建议用户点击播放时才实时获取
3. **VIP 歌曲处理**: `vip_required=true` 的歌曲在卡片 UI 上显示 VIP 角标, 点击时提示 "需开通会员"
4. **错误降级**: 封面/播放URL 补充调用失败时, 使用默认封面 + 标记为不可播放, 不阻塞整个推荐列表
5. **SSE 超时**: 一句话歌单 SSE 应设 10s 超时, `totalDone=true` 或 `totalException=true` 时关闭连接

这个统一格式直接对接 `ANDROID_DEV_GUIDE.md` 中各卡片类型的数据接口定义。
