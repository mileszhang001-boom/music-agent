---
name: doubao-podcast
description: |
  豆包（Doubao/ByteDance）播客 TTS API 集成指南。涵盖 WebSocket 二进制协议 v3、两种输入模式（URL 文章 / 短文本）、流式音频接收、CDN URL 获取、批量生成、以及实战踩坑记录。
  当你需要：调用豆包播客 API 生成音频、解析 WebSocket 二进制帧、处理播客流式音频块、获取 audio_url、排查播客生成超时或卡死问题、设计播客播放链路（流式 vs 非流式）时，请使用此 skill。
  即使用户没有明确提到"豆包"，只要涉及播客 TTS、ByteDance 语音合成、podcast generation，都应触发此 skill。
---

# 豆包播客 TTS API 集成指南

本 skill 基于 7 篇微信长文（共 93 分钟音频）的实战生成经验，记录了从建连到拿到完整 mp3 的全流程，以及每一步可能遇到的坑。

## 1. 接口概览

| 项 | 值 |
|----|-----|
| 协议 | WebSocket 二进制协议 v3 |
| 地址 | `wss://openspeech.bytedance.com/api/v3/sami/podcasttts` |
| 鉴权 | 4 个 Header：`X-Api-App-Id`、`X-Api-Access-Key`、`X-Api-Resource-Id`、`X-Api-App-Key` |
| Resource ID | `volc.service_type.10050` |
| 输出格式 | MP3，MPEG2 Layer3，96kbps，24kHz mono（固定，不可更改） |

## 2. 二进制协议详解

豆包使用自定义二进制帧，**不是**标准 JSON WebSocket。理解帧结构是一切的基础。

### 2.1 帧头（固定 4 字节）

```
[0x11, 0x14, 0x10, 0x00]
```

第 2 字节（0x14）编码了 message_type 和 flags：
- 高 4 位 = message_type（1=full client, 4=error 0xF）
- 低 4 位 = flags（bit2=0x04 表示含 session_id）

第 3 字节（0x10）编码了序列化方式：
- 高 4 位 = serialization（1=JSON, 0=raw binary/audio）

### 2.2 两种帧格式

**Pre-connection 帧**（建连前，无 session_id）：
```
header(4) + event_type(4, big-endian uint32) + payload_size(4) + payload_json
```

**Post-connection 帧**（建连后，含 session_id）：
```
header(4) + event_type(4) + sid_len(4) + session_id(sid_len) + payload_size(4) + payload
```

payload 的序列化方式取决于第 3 字节高 4 位：
- `1` → JSON（文本事件如 RoundStart）
- `0` → raw binary（音频块 RoundResp）

### 2.3 构造帧的代码

```python
import struct, json

def pre_frame(event, payload):
    """建连前的帧（无 session_id）"""
    header = bytes([0x11, 0x14, 0x10, 0x00])
    p = json.dumps(payload, ensure_ascii=False).encode()
    return header + struct.pack('>I', event) + struct.pack('>I', len(p)) + p

def post_frame(event, sid, payload):
    """建连后的帧（含 session_id）"""
    header = bytes([0x11, 0x14, 0x10, 0x00])
    sb = sid.encode()
    p = json.dumps(payload, ensure_ascii=False).encode()
    return header + struct.pack('>I', event) + struct.pack('>I', len(sb)) + sb + struct.pack('>I', len(p)) + p
```

### 2.4 解析帧的代码

```python
def parse_event(data):
    """解析服务端返回的帧 → (event_type, payload_dict)

    返回值说明：
    - event_type = -1 表示错误帧
    - payload 中如果有音频数据，会包含 audio_data (bytes) 和 audio_bytes (int)
    """
    if len(data) < 8:
        return None, {}
    mt = (data[1] >> 4) & 0xF  # message_type
    fl = data[1] & 0xF          # flags
    ser = (data[2] >> 4) & 0xF  # serialization

    # 错误帧：message_type = 0xF
    if mt == 0xF:
        js = data.find(b'{')
        return -1, json.loads(data[js:]) if js >= 0 else {"error": "unknown"}

    evt = struct.unpack('>I', data[4:8])[0]
    off = 8
    payload = {}
    audio_data = None

    if fl & 0x04:  # 含 session_id
        if len(data) >= off + 4:
            sid_len = struct.unpack('>I', data[off:off+4])[0]
            off += 4 + sid_len  # 跳过 session_id
        if len(data) >= off + 4:
            p_len = struct.unpack('>I', data[off:off+4])[0]
            off += 4
            if p_len > 0 and len(data) >= off + p_len:
                pd = data[off:off+p_len]
                if ser == 1:       # JSON
                    try: payload = json.loads(pd)
                    except: pass
                elif ser == 0:     # raw binary = 音频数据
                    audio_data = pd

    if audio_data is not None:
        return evt, {"audio_data": audio_data, "audio_bytes": len(audio_data)}
    return evt, payload
```

## 3. 握手流程与事件表

```
客户端                                豆包 API
  │── StartConnection(event=1) ────→│
  │←── ConnectionStarted(event=50) ─│  ← 获得 session_id
  │── StartSession(event=100) ─────→│  ← 携带播客参数
  │←── SessionStarted(event=150) ───│
  │  ┌── 流式循环 ──────────────────┐
  │←─┤ 360: RoundStart (JSON)      │  ← 本轮文案文本
  │←─┤ 361: RoundResp (binary)     │  ← 音频块 ~4.6KB/chunk
  │←─┤ 154: Usage (JSON)           │  ← token 用量
  │←─┤ 362: RoundEnd (JSON)        │
  │  └─────────────────────────────┘
  │←── 363: PodcastEnd (JSON) ─────│  ← meta_info.audio_url（CDN 完整 URL）
  │←── 152: SessionFinished ───────│  ← ⚠️ 可能不来，见下文
  │── FinishConnection(event=2) ──→│
```

### 事件类型速查

| event | 名称 | 方向 | payload 类型 | 关键字段 |
|-------|------|------|-------------|---------|
| 1 | StartConnection | 客户端→API | JSON `{}` | 无 |
| 50 | ConnectionStarted | API→客户端 | JSON | 从帧中提取 session_id |
| 100 | StartSession | 客户端→API | JSON | 播客参数（见下文） |
| 150 | SessionStarted | API→客户端 | JSON | — |
| 360 | RoundStart | API→客户端 | JSON | `text`: 本轮文案 |
| 361 | RoundResp | API→客户端 | **binary** | 原始 MP3 音频块 |
| 154 | Usage | API→客户端 | JSON | `usage.total_tokens` |
| 362 | RoundEnd | API→客户端 | JSON | — |
| 363 | PodcastEnd | API→客户端 | JSON | `meta_info.audio_url`, `meta_info.duration_sec` |
| 152 | SessionFinished | API→客户端 | JSON | — |
| 2 | FinishConnection | 客户端→API | JSON `{}` | 关闭连接 |

### 提取 session_id

ConnectionStarted(50) 返回后，session_id 在帧的二进制负载中（不是 JSON 字段）：

```python
data = await ws.recv()  # ConnectionStarted
off = 8
sid_len = struct.unpack('>I', data[off:off+4])[0]
off += 4
session_id = data[off:off+sid_len].decode()
```

后续所有帧都用 `post_frame(event, session_id, payload)` 发送。

## 4. 两种输入模式

### 模式 A：input_url（URL 文章，推荐用于长内容）

```python
payload = {
    "input_info": {                           # ⚠️ 注意！url 在 input_info 内
        "input_url": "https://mp.weixin.qq.com/s/xxx",
        "return_audio_url": True              # 必须设为 True 才能拿到 CDN URL
    },
    "use_head_music": True,                   # 片头音乐
    "use_tail_music": False,                  # 片尾音乐
    "audio_config": {
        "format": "mp3",
        "sample_rate": 24000,
        "speech_rate": 0                      # 0=正常，正数加速，负数减速
    },
    "speaker_info": {
        "random_order": True,
        "speakers": [
            "zh_male_dayixiansheng_v2_saturn_bigtts",    # 男声主持
            "zh_female_mizaitongxue_v2_saturn_bigtts"    # 女声主持
        ]
    }
}
```

### 模式 B：input_text（短文本，< 200 字）

```python
payload = {
    "input_text": "文本内容...",              # ⚠️ 注意！text 在顶层，不是 input_info
    "audio_config": {"format": "mp3", "sample_rate": 24000, "speech_rate": 0},
    "speaker_info": {
        "random_order": True,
        "speakers": ["zh_male_dayixiansheng_v2_saturn_bigtts", "zh_female_mizaitongxue_v2_saturn_bigtts"]
    }
}
```

> **易踩的坑**：`input_url` 放在 `input_info` 对象里，而 `input_text` 放在顶层。搞反了不会报错，只会得到空结果。

## 5. 关键节点：PodcastEnd(363)

PodcastEnd 是整个流程中最重要的事件。它包含：

```json
{
    "meta_info": {
        "audio_url": "https://speech-tts-podcast.tos-cn-beijing.volces.com/...podcast_demo.mp3?签名参数",
        "duration_sec": 497.5
    }
}
```

- `audio_url`：完整播客的 CDN 下载链接，**签名 URL，24 小时有效**
- `duration_sec`：播客总时长（秒）
- `audio_url` **只在 PodcastEnd 时才返回**，无法提前获取

## 6. 实战踩坑记录（极其重要）

这些是我们在 7 篇长文生成中总结的血泪教训：

### 坑 1：input_url vs input_text 参数位置

```
❌ {"input_text": "https://..."}                    → 当短文本处理，结果不对
❌ {"input_url": "https://..."}                     → 顶层没有这个字段，静默失败
✅ {"input_info": {"input_url": "https://..."}}     → URL 模式正确用法
✅ {"input_text": "你好世界"}                        → 短文本模式正确用法
```

### 坑 2：PodcastEnd 之后不要等 SessionFinished

实测中 PodcastEnd(363) 之后，SessionFinished(152) **经常不来或者要等很久**（10 分钟+）。

```python
# ❌ 错误做法：等 SessionFinished 才退出
elif evt == 363:
    audio_url = info.get("meta_info", {}).get("audio_url", "")
    # 继续等... 可能永远等不到 152

# ✅ 正确做法：PodcastEnd 立即 break
elif evt == 363:
    audio_url = info.get("meta_info", {}).get("audio_url", "")
    success = True
    break  # 不要等了！
```

这是最致命的坑。不加 break，一个 5 分钟的播客可能要跑 15 分钟。

### 坑 3：长文章生成需要足够的超时时间

| 文章长度 | 播客时长 | 生成耗时 | 建议超时 |
|---------|---------|---------|---------|
| ~2000字 | ~5 min | ~2.5 min | 300s |
| ~5000字 | ~10 min | ~4 min | 600s |
| ~10000字 | ~20 min | ~7 min | 600s |
| ~25000字 | ~30 min | ~10 min | 900s |

建议统一设 `TIMEOUT = 900`（15 分钟），覆盖极端情况。

### 坑 4：WebSocket 连接参数

```python
async with websockets.connect(
    WS_URL,
    additional_headers=HEADERS,
    max_size=50*1024*1024,    # 长播客单帧可能很大
    ping_interval=20,          # 保活心跳
    ping_timeout=120,          # 生成中可能长时间无消息
    close_timeout=30,
) as ws:
```

不设 `ping_timeout=120` 的话，长文章生成过程中 WebSocket 会因心跳超时断开。

### 坑 5：Python 后台运行时输出缓冲

如果用 `nohup` 后台运行脚本，默认 stdout 有缓冲，日志看不到实时输出。

```bash
# ❌ 看不到实时日志
nohup python gen_podcast.py > output.log 2>&1 &

# ✅ 加 -u 关闭缓冲
nohup python -u gen_podcast.py > output.log 2>&1 &
```

### 坑 6：连接断开但已有音频块

网络抖动可能导致连接中途断开，但此时可能已经收到了大量音频块。这些块是完整的 MP3 片段，**直接拼接就是可播放的 mp3 文件**。

```python
except Exception as e:
    if audio_chunks:
        print(f"Connection lost but have {len(audio_chunks)} chunks, saving anyway")
        success = True  # 保存已有内容，不要丢弃
```

### 坑 7：audio_url 的 24 小时有效期

CDN URL 带签名参数（`X-Tos-Expires=86400`），过期后返回 403。如果需要长期可用：
- 生成后立即下载 mp3 到自己的存储
- 或者在使用前检查 URL 是否仍在有效期内

## 7. 性能基线（实测数据）

基于 7 篇微信公众号长文的完整测试（2026-03-28）：

| 指标 | 值 | 含义 |
|------|-----|------|
| 首 token 延迟 | 1-10s（avg 6s） | API 解析文章 + 首段文本生成 |
| 首段可播音频 | 14-24s（avg 18s） | 从发出请求到第一段音频就绪 |
| 生成速度比 | **2.7× 实时** | 1 分钟播客只需 ~22s 生成 |
| 音频块大小 | ~4.6KB/chunk | RoundResp(361) 单帧 |
| 文字→播客时长 | ~800 字/分钟 | 粗略估算：文章字数 ÷ 800 = 播客分钟数 |
| 总测试量 | 7 篇，63.8MB，93 分钟音频 | 全部成功 |

详细数据：

| 分类 | 大小 | 轮数 | 生成耗时 | 播客时长 | Tokens |
|------|------|------|---------|---------|--------|
| AI科技 | 12.7MB | 69 | 415s | 18.5min | 32,191 |
| AI科技 | 5.7MB | 37 | 187s | 8.3min | 15,347 |
| 人物 | 3.4MB | 25 | 140s | 5.0min | 9,395 |
| 人物 | 10.0MB | 71 | 332s | 14.5min | 25,730 |
| 商业 | 7.1MB | 51 | 235s | 10.3min | 17,868 |
| 商业 | 5.1MB | 35 | 163s | 7.5min | 13,621 |
| 商业 | 19.8MB | 103 | 591s | 28.8min | 51,552 |

## 8. 两种播放架构

### 方案 A：等待完成 + CDN URL（简单可靠，推荐 MVP）

```
客户端 → 建连 → 生成中(状态反馈) → PodcastEnd → 拿 cdn_url → 播放
```

- 优点：实现极简，无需服务端参与音频处理
- 缺点：用户需等待全部生成完成（2-10 分钟）
- 适用：不追求极致体验的场景，演示时配合预设内容使用

### 方案 B：流式中转 + 边生边播（体验最佳，需要更多基础设施）

```
客户端 → 建连 → 音频块实时转发给服务端 → 服务端拼接 mp3
→ 累积 0.5MB 后推送播放 URL → 播放端边下边播
```

- 优点：用户 ~18s 就能听到声音（而非等全部生成完）
- 前提：播放端支持 HTTP Range 渐进式下载，服务端支持流式写入/托管
- 关键洞察：生成速度(2.7×) > 播放速度(1×)，缓冲区只增不减，不会断流

## 9. 错误处理

| 错误场景 | 表现 | 处理建议 |
|---------|------|---------|
| 建连失败 | event=-1，error JSON | 检查凭证和网络，重试 |
| 内容过滤 | 错误码 `50302102` | 提示"该内容暂不支持"，不重试 |
| 生成中断连 | WebSocket 异常关闭 | 保存已有音频块 + 自动重试一次 |
| 心跳超时 | 连接静默断开 | 设 `ping_timeout=120` |
| audio_url 过期 | CDN 返回 403 | 重新生成或使用本地缓存 |

## 10. 完整参考实现

`scripts/` 目录下有一个经过实战验证的批量生成脚本 `generate_podcast.py`，支持：
- URL 文章模式和短文本模式
- 单个生成和批量生成
- 进度日志和错误恢复
- manifest.json 元数据输出

使用方法：

```python
# 阅读脚本了解完整实现
# 路径: <skill-dir>/scripts/generate_podcast.py
```

关键配置项说明：

```python
TIMEOUT = 900           # 超时秒数，建议不低于 600
SPEAKERS = [            # 发音人，可替换
    "zh_male_dayixiansheng_v2_saturn_bigtts",    # 男声
    "zh_female_mizaitongxue_v2_saturn_bigtts"     # 女声
]
AUDIO_CFG = {
    "format": "mp3",    # 固定 mp3
    "sample_rate": 24000,  # 固定 24kHz
    "speech_rate": 0       # 0=正常，可调
}
```
