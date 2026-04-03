# 三方推荐接口联调计划 v1.0

> 生成时间：2026-04-01
> 状态：喜马拉雅接口已跑通 ✅ / 网易云待线下协调

---

## 1. 实测结果 (2026-04-01)

| 接口 | 状态 | 说明 |
|------|------|------|
| 喜马拉雅 游客登录 | ✅ **已通** | `access_token` 获取成功，有效期 7211 秒 (~2h) |
| 喜马拉雅 主动推荐 | ✅ **已通** | 返回 `welcome_text` + `recommend_list.items[]`，含封面/标题/时长/media_id |
| 喜马拉雅 AI Agent text/query | ✅ **已通** | SSE 返回 104 条事件，含 PlayList/WrittenAnswer/SpokenAnswer/Suggestions |
| 网易云 匿名登录 | ❌ 未测 | 缺少 appId + channel + deviceType + os + brand |
| 网易云 一句话歌单 | ❌ 未测 | 同上 |

### 喜马拉雅实测数据示例

**主动推荐返回结构** (验证与文档一致):

```
welcome_text: "给你盘点了两条热点，听哪条？"
suggestions: ["我想听社会热点", "推荐今日财经新闻", "来点通勤轻松内容"]
recommend_list:
  scene: "通勤"
  items[]:
    ├─ type: "aiRadio"
    ├─ title: "xxx"
    ├─ cover: "http://aod.cos.tx.xmcdn.com/..."
    ├─ sub_title: "每日新鲜事"
    ├─ rec_reason: "最新热点"
    ├─ decision_short_title: "每日新鲜事"
    ├─ category_name: "热点"
    ├─ event_value: "waOhW0CS2-v..."  (埋点用)
    └─ track:
        ├─ id: 967046160
        ├─ title: "xxx"
        ├─ coverPath: "http://imagev2.xmcdn.com/..."
        ├─ albumId: 82482722
        ├─ albumTitle: "热点新闻"
        ├─ duration: 49  (秒)
        ├─ isPaid: false
        ├─ isAuthorized: true
        ├─ mediaId: "/track?album_id=82482722&track_id=967046160&play_source=..."
        └─ image: {url, width:290, height:290}
```

**关键发现**:

1. `items[].cover` 和 `items[].track.coverPath` / `items[].track.image.url` 提供多种封面来源
2. `items[].track.mediaId` 即 MediaSession 播放用的完整 media_id
3. `items[].track.duration` 单位确认为秒
4. 游客模式下已能获取推荐内容（无需用户登录）
5. SSE text/query 返回的 PlayList 含 cover 三尺寸（small 86/middle 140/large 290）

---

## 2. 喜马拉雅 — 剩余工作

### 已完成 ✅

| 项目 | 详情 |
|------|------|
| 凭证 | app_key + app_secret 已验证可用 |
| 签名算法 | HMAC-SHA1 + MD5 已实现并验证 |
| 游客登录 | `/oauth2/secure_access_token` 已跑通 |
| 主动推荐 | `/proactive-recommend` 非流式已跑通 |
| AI Agent 查询 | `/iov-chat/text/query` SSE 已跑通 |
| 返回字段映射 | 与文档一致，可直接对接卡片 UI |

### 待完成 ⏳

| # | 事项 | 负责方 | 预计耗时 | 优先级 |
|---|------|--------|---------|--------|
| 1 | **车端 MediaSession 播放集成** — 连接喜马拉雅 APK, `playFromMediaId` | 车端开发 | 1 天 | **P0** |
| 2 | **Token 自动续期** — 2h 到期前刷新, 或 APK ContentProvider 获取 | 后端 | 0.5 天 | **P0** |
| 3 | **主动推荐 → 卡片 UI 数据绑定** — items[] → 喜马拉雅推荐卡渲染 | 前端 | 1 天 | **P0** |
| 4 | **text/query → 语音搜索集成** — 对接车端语音输入 | 车端 | 1 天 | P1 |
| 5 | **埋点上报** — page_view/expose/click 三类事件 | 前端+后端 | 0.5 天 | P1 |
| 6 | **Context 真实数据填充** — 天气/导航/DMS 接入 | 车端 | 2 天 | P2 |
| 7 | **device_id 正式化** — 确认用 Android_ID 还是 OAID | 车端 | 0.5 天 | P1 |
| 8 | **pack_id 确认** — 座舱端包名, 需同步给喜马拉雅做白名单 | PM | 0.5 天 | P1 |

---

## 3. 网易云音乐 — 卡点 & 行动计划

### 当前卡点

| # | 卡点 | 性质 | 说明 |
|---|------|------|------|
| 1 | `appId` 未获取 | 需注册 | 开放平台控制台创建应用 |
| 2 | `channel` 未获取 | **需线下协调** | 云音乐分配的厂商标识 |
| 3 | `deviceType` 未获取 | **需线下协调** | 云音乐产品确认 |
| 4 | `os` 未获取 | **需线下协调** | 云音乐分配 |
| 5 | `brand` 未获取 | **需线下协调** | 云音乐确认 |
| 6 | RSA 密钥对未生成 | 可自行完成 | `openssl genrsa` 生成, 公钥上传平台 |

> **核心阻塞**: 2/3/4/5 四个参数必须线下联系网易云音乐同事分配，无法通过开放平台自助获取

### 行动计划

| 阶段 | 行动 | 负责人 | 预计完成 |
|------|------|--------|---------|
| **本周** | 联系网易云音乐商务/技术对接人，申请 channel/deviceType/os/brand | PM (Miles) | 4月4日 |
| **本周** | 开放平台注册应用，获取 appId | 开发 | 4月2日 |
| **本周** | 生成 RSA 密钥对，上传公钥 | 开发 | 4月2日 |
| **拿到参数后** | 匿名登录测试 → accessToken | 开发 | +1天 |
| **拿到参数后** | 一句话歌单 SSE 测试 | 开发 | +1天 |
| **拿到参数后** | 歌曲详情(封面) + 播放URL 补充接口测试 | 开发 | +1天 |
| **全部跑通后** | 统一数据适配层开发 | 开发 | +2天 |

---

## 4. 整体里程碑

```
Week 1 (4/1 - 4/4):
  ✅ 喜马拉雅接口验证通过
  → 喜马拉雅推荐卡数据对接 + MediaSession 播放
  → 网易云线下协调启动 (申请 channel 等参数)
  → RSA 密钥对生成 + appId 申请

Week 2 (4/7 - 4/11):
  → 喜马拉雅: 埋点 + Context 真实数据 + Token 续期
  → 网易云: 凭证到位后联调 (匿名登录 → 一句话歌单 → 封面/播放URL)

Week 3 (4/14 - 4/18):
  → 统一数据适配层 (两家数据 → CardItem normalize)
  → 4张推荐卡全部接入真实数据
  → 端到端联调: 推荐 → 展示 → 播放 → 埋点

Week 4 (4/21 - 4/25):
  → 性能优化 (封面缓存, SSE超时, Token池)
  → 异常处理 & 降级策略
  → QA 验收
```

---

## 5. 测试脚本位置

| 脚本 | 路径 | 说明 |
|------|------|------|
| 喜马拉雅全链路测试 | `scripts/test_ximalaya.py` | 游客登录 + 主动推荐 + AI Agent 查询 |
| 网易云测试 | 待凭证到位后编写 | — |

运行方式: `cd 音乐agent && python3 scripts/test_ximalaya.py`
