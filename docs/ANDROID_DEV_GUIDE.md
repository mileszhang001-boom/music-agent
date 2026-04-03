# 车端推荐卡 Android 开发指南 v1.0

> 本文档是基于 Pencil 设计稿 `demo落地版本.pen` 提取的 1:1 还原开发规范。
> 所有数值来自设计稿实际节点，单位为 dp（逻辑像素）。

---

## 1. 整体架构

### 1.1 页面结构

整个推荐卡是一张 **664×1110** 的圆角卡片，包含两个区域：**内容推荐区** + **播放器区**。

```
┌──────────────────────────────────────┐ ← cornerRadius: 32
│            内容推荐区                 │
│     (ViewPager, 左右滑动翻页)         │
│                                      │
│   ┌──────────────────────────────┐   │
│   │  4张内容卡片之一 (含Tab+底栏) │   │
│   └──────────────────────────────┘   │
│         ● ○ ○ ○  (page indicator)    │
├──────────────────────────────────────┤
│            播放器区                   │
│   萌宠播放器 OR mini player           │
└──────────────────────────────────────┘
```

### 1.2 两种模式

| 属性 | 萌宠播放器模式 | Mini Player 模式 |
|------|-------------|-----------------|
| 总高度 | 1110 | 1110 |
| 内容区高度 | **555** | **968** |
| 播放器区高度 | **555** | **142** |
| 切换方式 | 用户手动切换 | 用户手动切换 |
| Pencil 整体组合 | `mGjm6` | `3F4Ym` |

### 1.3 背景

```
类型: LinearGradient
方向: 180° (从上到下)
色值: #7343B6 → #150A3D
应用范围: 整个 1110 高度的容器
cornerRadius: 32 (仅顶部两角; 如全部四角则均为 32)
stroke: 2px (可选, 视车端实际效果)
```

### 1.4 顶部状态栏

```
Multitasking Indicator
高度: 32
宽度: 664
内容: 居中的拖拽手柄 (36×8, fill #ffffffb8, path)
```

---

## 2. 内容推荐区

### 2.1 ViewPager 配置

内容推荐区承载 4 张内容卡片，使用 `ViewPager2` 实现左右滑动翻页。

- **卡片数量**: 4（喜马拉雅 → QQ音乐 → AI播客 → AI推荐）
- **翻页方式**: 左右滑动
- **Page Indicator**: 4 个圆点，居中显示

#### Page Indicator 规格

| 属性 | 值 |
|------|-----|
| Pencil Node | `hvPnt` (萌宠版), `2SjKH` (mini版) |
| 容器 | 664 × 32, justifyContent: center |
| 圆点尺寸 | 11 × 11 (ellipse) |
| 圆点间距 | gap: 10 |
| 选中色 | `#CCCCCC` (opacity 1.0) |
| 未选中色 | `#CCCCCC` (opacity 0.5, 即 `#cccccc80`) |

### 2.2 内容卡片通用结构

每张卡片都遵循三段式布局：

```
┌─────────────────────────────────┐
│  Tab 栏 (音源图标 + 名称)        │ height: 75  (或 120, 见下文)
├─────────────────────────────────┤
│                                 │
│  主体内容区                      │ height: 自适应
│                                 │
├─────────────────────────────────┤
│  底栏 (描述文字)                 │ height: 75  (或 120)
└─────────────────────────────────┘

外框: 664 × [555 或 968]
内容区宽度: 600 (居中, 即左右各 padding 32)
layout: vertical, alignItems: center, justifyContent: center
```

#### Tab 栏通用规格（喜马拉雅 & QQ音乐 卡片使用）

| 属性 | 值 |
|------|-----|
| 高度 | 75 |
| 宽度 | 600 |
| 布局 | horizontal, justifyContent: end (底部对齐), padding-left: 10 |
| 音源图标 | 40×40 (切音源 frame, 含具体平台 icon) |
| 图标与文字间距 | gap: 17 |
| 平台名称字体 | MiSans VF, 26px, weight 500 |
| 平台名称颜色 | `#D9D9D9` opacity 0.6 (`#d9d9d999`) |

#### 底栏通用规格

| 属性 | 值 |
|------|-----|
| 高度 | 75 |
| 宽度 | 600 |
| 布局 | horizontal, alignItems: center, justifyContent: end, padding-left: 10 |
| 文字 | `"说出功能，定制专属于你的卡片"` |
| 字体 | MiSans VF, 26px, weight 500 |
| 颜色 | `#D9D9D9` opacity 0.6 (`#d9d9d999`) |

> **注意**: AI播客卡 和 AI推荐卡 使用不同的 Tab/底栏样式（高度 120, 文字 32px），详见各卡片章节。

---

## 3. 四张内容卡片详细规格

### 3.1 喜马拉雅内容卡

**Tab 栏**: 喜马拉雅 icon (40×40) + "喜马拉雅"

#### 555 模式 (萌宠播放器版)

| 属性 | 值 | Pencil Node |
|------|-----|-------------|
| 外框 | 664×555 | `76pZ5` |
| 内容区 | 600×261, 两卡并排 | `2MLBV` |
| 左卡 | 292×256 | `PRgLS` |
| 右卡 | 292×256 | `Ik33I` |
| 卡间距 | justifyContent: space_between (约 16) | — |

#### 968 模式 (Mini Player 版)

| 属性 | 值 | Pencil Node |
|------|-----|-------------|
| 外框 | 664×968 | `YcV07` |
| 内容区 | 600×535, 两卡纵向堆叠 | `l5t4s` |
| 上卡 | 598×256 (满宽) | `GtlZ0` |
| 下卡 | 604×256 (满宽) | `ggUwJ` |
| 卡间距 | justifyContent: space_between (约 23) | — |

#### 子卡片样式 — "快听" (蓝色)

```
┌────────────────────────────────┐  cornerRadius: 16
│ ┌ 快听                         │  title: (32, 28)
│ │ 开启专属音乐电台              │  subtitle: (32, 65)
│ │                              │
│ │              ▶               │  play btn: 右下区域
│ └──────────────────────────────│
└────────────────────────────────┘

背景层 (由下到上):
1. 渐变底色: linear-gradient(-261°, #383EC2 21.5% → #2FA7BD 100%)
   - 矩形尺寸 300×288 (超出裁剪), offset (-5, 0)
2. 装饰方块: 118.5×118.5, fill #001AB8, opacity 0.5, rotation -45°, 右上角
3. 装饰矢量: fill #719AE380, rotation -45°, 左下区域
4. 毛玻璃层: background_blur radius 105, fill #6262620F (整个卡面)

文字:
- 标题: "快听", MiSans VF 28px weight 500, #FFFFFF
- 副标题: "开启专属音乐电台", MiSans VF 22px weight normal, opacity 0.4
  - 副标题 fill 为复合填充: [overlay #FFFFFF, overlay #FFFFFF99, #FFFFFF1A]

播放按钮: (位于右下角, x: 187.5, y: 144.5)
- 外圆: 80×80 ellipse, fill #FFFFFF opacity 0.2
- 内三角: 35×26 path, fill #FFFFFF, rotation -90°
```

#### 子卡片样式 — "上次听过" (紫色)

```
与"快听"结构完全相同, 区别:
- 渐变色: linear-gradient(-261°, #C138A3 21.5% → #732FBC 100%)
- 装饰方块: fill #4B00B7, opacity 0.5
- 装饰矢量: fill #A072E380
- 标题: "上次听过"
- 副标题: "《特朗普最新直播》" (动态数据)
```

#### 数据接口 — 喜马拉雅卡

```json
{
  "source": "ximalaya",
  "source_icon": "ximalaya_icon_40x40.png",
  "items": [
    {
      "slot": "left",
      "title": "{{recommend_title}}",
      "subtitle": "{{recommend_desc}}",
      "gradient_theme": "blue",
      "action": "{{playback_action}}"
    },
    {
      "slot": "right",
      "title": "{{history_title}}",
      "subtitle": "{{history_item_name}}",
      "gradient_theme": "purple",
      "action": "{{resume_action}}"
    }
  ]
}
```

| 字段 | 来源 | 示例值 | 备注 |
|------|------|--------|------|
| `recommend_title` | 喜马拉雅主动推荐 API → recall strategy name | "快听" | 对应 `aiRadio`/`subscribeUpdate` 等策略 |
| `recommend_desc` | 喜马拉雅 API → 策略描述 | "开启专属音乐电台" | 固定文案或 API 返回 |
| `history_title` | 固定文案 | "上次听过" | — |
| `history_item_name` | 喜马拉雅 API → `continuePlayback` 策略 → title | "《特朗普最新直播》" | 取最近一条记录 |
| `playback_action` | 喜马拉雅 API → content_type + id | — | 触发播放 |
| `gradient_theme` | 预定义 | "blue" / "purple" | 控制渐变配色方案 |

---

### 3.2 QQ音乐内容卡

**Tab 栏**: QQ音乐 icon (40×40) + "QQ音乐"

#### 布局类型: 数据驱动

- API 返回 **3 个推荐位** → 3 子卡布局（1 左列 2 行 + 1 右列满高）
- API 返回 **4 个推荐位** → 2×2 网格布局

#### 3 子卡布局 — 555 模式

| 属性 | 值 | Pencil Node |
|------|-----|-------------|
| 外框 | 664×555 | `XCciv` |
| 内容区 | 600×261 | `pQ1Lq` |
| 左列容器 | 292×256, vertical, space_between | `cOJr5` |
| 左上卡 | 292×120 | `7jzWM` |
| 左下卡 | 292×120 | `jQURe` |
| 右卡 | 292×256 | `Fdd8c` |
| 左右间距 | justifyContent: space_between | — |
| 左列卡间距 | justifyContent: space_between (约 16) | — |

#### 4 子卡布局 — 555 模式

| 属性 | 值 | Pencil Node |
|------|-----|-------------|
| 外框 | 664×555 | `jOy3W` |
| 内容区 | 600×260 | `DtsbA` |
| 左列容器 | 292×256, vertical, space_between | `TIlG0` |
| 左上卡 | 292×120 | `6xGmX` |
| 左下卡 | 292×120 | `4vyun` |
| 右列容器 | 292×256, vertical, space_between | `EaHtr` |
| 右上卡 | 292×119 | `6bdeg` |
| 右下卡 | 292×121 | `Gs9JV` |

#### 3 子卡布局 — 968 模式

| 属性 | 值 | Pencil Node |
|------|-----|-------------|
| 外框 | 664×968 | `IpcbK` |
| 内容区 | 600×535, vertical, space_between | `M9LGz` |
| 上行 | 600×261, 单张满宽卡 | `dQz3x` |
| 上卡 | 598×256 | `T1dq2` |
| 下行 | 600×256, 两卡并排 | `pAI4D` |
| 下左卡 | 292×255 | `gRzaO` |
| 下右卡 | 292×261 | `jnm7B` |

#### 4 子卡布局 — 968 模式

| 属性 | 值 | Pencil Node |
|------|-----|-------------|
| 外框 | 664×968 | `G0hhV` |
| 内容区 | 600×535, vertical, space_between | `8SRfP` |
| 上行 | 600×256, 两卡并排 | `ad8H0` |
| 上左卡 | 292×255 | `uHyHf` |
| 上右卡 | 292×256 | `FWPKd` |
| 下行 | 600×256, 两卡并排 | `Nws30` |
| 下左卡 | 292×261 | `42jKP` |
| 下右卡 | 292×262 | `lnUke` |

#### 子卡配色方案

| 名称 | 标题 | 渐变色 | 装饰色 | Pencil 示例 |
|------|------|--------|--------|------------|
| **red** | "每日30首" | `#C26638 → #BD2F2F` | 方块 `#B80000`, 矢量 `#EA4A4A80` | `7jzWM` |
| **green** | "我喜欢" | `#C29F38 → #50BD2F` | 方块 `#7EB800`, 矢量 `#E8EB4B80` | `jQURe` |
| **purple** | "猜你喜欢" | `#C138A3 → #732FBC` | 方块 `#4B00B7`, 矢量 `#A072E380` | `Fdd8c` |
| **blue** | "快听" | `#383EC2 → #2FA7BD` | 方块 `#001AB8`, 矢量 `#719AE380` | `PRgLS` |

> 半高卡 (120px) 与全高卡 (256px) 结构一致，区别仅在于高度和播放按钮位置。
> 半高卡: 播放按钮在右侧居中 (x:197, y:25)。
> 全高卡: 播放按钮在右下角 (x:186.5, y:144.5)。

#### 数据接口 — QQ音乐卡

```json
{
  "source": "qqmusic",
  "source_icon": "qqmusic_icon_40x40.png",
  "items": [
    {
      "title": "{{playlist_title}}",
      "subtitle": "{{playlist_desc}}",
      "gradient_theme": "red|green|purple|blue",
      "action": "{{play_action}}"
    }
  ]
}
```

| 字段 | 来源 | 示例值 | 备注 |
|------|------|--------|------|
| `items` | QQ音乐推荐 API | 数组 (3~4项) | items.length 决定布局 |
| `items[n].title` | API → playlist.name | "每日30首" | 播放列表/电台名 |
| `items[n].subtitle` | API → playlist.desc | "开启专属音乐电台" | 可选; 仅全高卡显示 |
| `items[n].gradient_theme` | 按顺序分配 | "red" → "green" → "purple" → "blue" | 循环使用 4 种配色 |
| `items[n].action` | API → deeplink / playback params | — | 点击触发播放 |

---

### 3.3 AI播客内容卡

**特殊 Tab/底栏**: 不使用音源 icon，而是显示状态文案，高度 120，文字 32px 居中。

#### 555 模式

| 属性 | 值 | Pencil Node |
|------|-----|-------------|
| 外框 | 664×555 | `mQv2u` |
| 顶部状态文案区 | 600×120, center | `HBO8x` |
| 中心卡片区 | 600×254, center (单卡居中) | `c26DX` |
| 中心卡 | 292×256 | `D2cqX` |
| 底部标题区 | 600×120, center | `KOUo6` |

#### 968 模式

| 属性 | 值 | Pencil Node |
|------|-----|-------------|
| 外框 | 664×968 | `y1nJq` |
| 顶部状态文案区 | 600×120 | `GnwIw` |
| 中心卡片区 | 600×254 | `caDKj` |
| 中心卡 | 292×256 | `hJ4SH` |
| 底部标题区 | 600×120 | `kyDu1` |

> 968 模式下, AI播客卡的中心内容区域与 555 模式相同 (292×256 单卡居中)。额外的高度空间由上下文案区和间距吸收。

#### 文案规格

| 位置 | 内容 | 字体 | 大小 | 颜色 | 对齐 |
|------|------|------|------|------|------|
| 顶部 | "AI播客已生成" | MiSans VF | 32px, weight 500 | `#D9D9D9FF` | center |
| 卡片标题 | "AI浪潮下，我们" | MiSans VF | 28px, weight 500 | `#FFFFFF` | left (32, 28) |
| 卡片副标题 | "Audio Flow专属电台" | MiSans VF | 22px, normal | multi-fill, opacity 0.4 | left (32, 65) |
| 底部 | "AI浪潮下，我们应该做些什么" | MiSans VF | 32px, weight 500 | `#D9D9D9FF` | center |

#### 数据接口 — AI播客卡

```json
{
  "source": "ai_podcast",
  "status_text": "{{status}}",
  "podcast": {
    "title": "{{podcast_title_short}}",
    "subtitle": "{{podcast_channel}}",
    "full_title": "{{podcast_title_full}}",
    "audio_url": "{{cdn_url}}",
    "duration_seconds": 0,
    "gradient_theme": "blue"
  }
}
```

| 字段 | 来源 | 示例值 | 备注 |
|------|------|--------|------|
| `status_text` | 播客生成状态 | "AI播客已生成" / "正在生成中..." | 顶部显示 |
| `podcast_title_short` | 豆包 pipeline → 生成结果 | "AI浪潮下，我们" | 卡片标题, 单行截断 |
| `podcast_channel` | 自定义 / 默认 | "Audio Flow专属电台" | 卡片副标题 |
| `podcast_title_full` | 豆包 pipeline → 完整标题 | "AI浪潮下，我们应该做些什么" | 底部完整标题 |
| `cdn_url` | 豆包 PodcastEnd(363) → audio_url | CDN URL | 24h 有效 |

---

### 3.4 AI推荐内容卡

**特殊 Tab/底栏**: 高度 120, 文字 32px 居中, 无音源 icon。

#### 555 模式

| 属性 | 值 | Pencil Node |
|------|-----|-------------|
| 外框 | 664×555 | `2XU4O` |
| 顶部文案区 | 600×120 | `DeIAS` |
| 歌单封面区 | 669×254, layout: none (绝对定位) | `Ly49i` |
| 底部标题区 | 600×120 | `Oikn5` |

#### 歌单封面区 — 3 项卡片旋转布局

这是一个视觉复杂的区域，3 张歌单/专辑卡片呈扇形排列：

| 卡片 | 尺寸 | 位置 | 旋转 | z-index | Pencil Node |
|------|------|------|------|---------|-------------|
| 左卡 | 166×208 | (92.5, 34.8) | +0.443° | 1 (底) | `V6m2T` |
| **中心卡** | **259×254** | **(204.5, 0.5)** | **0°** | **3 (顶)** | `9oYfA` |
| 右卡 | 199×211 | (390.5, 35.0) | +0.443° | 2 (中) | `6mGzi` |

#### 歌单项结构

每个歌单项 (Frame 2090060685) 内部:

```
┌──────────────────────┐  cornerRadius: 10, padding: [9, 0]
│ ┌──────────────────┐ │
│ │   封面图 / 渐变   │ │  cornerRadius: 10, stroke: 1 #dddddd80
│ │                  │ │  高度: 116~166 (按卡片大小)
│ │      ▶ (中心卡)  │ │  播放按钮仅中心卡有
│ └──────────────────┘ │
│                      │
│  标题 (单行)          │  MiSans VF 18px, #FFFFFFE5
│  副标题              │  MiSans VF 18px, #FFFFFF7A
│  信息区高度: 72       │
└──────────────────────┘
```

#### 封面图类型

| 卡片 | 封面来源 | 占位/默认 |
|------|---------|----------|
| 左卡 | API 返回 cover URL | 径向渐变 `#000000→#686868` |
| 中心卡 | API 返回 cover URL | 线性渐变 `#5A17E9→#160D22` + 播放icon |
| 右卡 | API 返回 cover URL | 图片填充 (image-1.png) |

#### 数据接口 — AI推荐卡

```json
{
  "source": "ai_recommend",
  "header_text": "{{recommend_header}}",
  "footer_text": "{{recommend_title}}",
  "items": [
    {
      "cover_url": "{{cover_image_url}}",
      "title": "{{item_title}}",
      "subtitle": "{{track_count}}首·{{source_name}}",
      "content_type": "album|playlist|track",
      "action": "{{play_action}}"
    }
  ]
}
```

| 字段 | 来源 | 示例值 | 备注 |
|------|------|--------|------|
| `recommend_header` | AI 推荐引擎 → 场景描述 | "为你推荐·本次行程45mins" | 含行程时间 |
| `recommend_title` | AI 推荐引擎 → 听单名 | "雨天深夜通勤听单" | 底部显示 |
| `items` | 推荐结果 | 数组 (3项) | 固定 3 项 |
| `items[n].cover_url` | API → RecommendItem.cover | 图片 URL | 封面图 |
| `items[n].title` | API → RecommendItem.title | "一个歌单一个歌单" | 单行 |
| `items[n].subtitle` | 拼接: track_count + source | "8首·QQ音乐" | — |
| `items[n].action` | API → content_type + id | — | 点击播放 |

---

## 4. 播放器区详细规格

### 4.1 萌宠播放器 (664×555)

| 属性 | 值 | Pencil Node |
|------|-----|-------------|
| 外框 | 664×555 | `F6cN5` |
| 背景 | 透明 (使用整体 BG 渐变) | — |
| 浮动音符 | lucide icons (music, music-2), 渐变 #dd7b66→#ffffff | 各音符 node |
| 控制按钮组 | 居底, y:423, 590×80, padding [0, 16] | `CpM6P` |

#### 控制按钮

```
[上一曲]  ←72px→  [暂停/播放]  ←72px→  [下一曲]
  80×80             80×80               80×80

（暂停按钮单独, 上一曲&下一曲在 Row-[32] 内, 间距 gap: 81）
```

| 按钮 | 尺寸 | cornerRadius | 背景色 | 图标 |
|------|------|-------------|--------|------|
| 上一曲 | 80×80 | 20 | `#D9D9D9` opacity 0.6 (`#d9d9d999`) | 三角+竖线, fill #FFFFFF |
| 暂停/播放 | 80×80 | 20 | 同上 | 双竖线 (暂停) / 三角 (播放), fill #FFFFFF |
| 下一曲 | 80×80 | 20 | 同上 | 三角+竖线 (翻转), fill #FFFFFF |

#### 浮动音符装饰

| 音符 | icon | 位置 (x, y) | 旋转 | Pencil Node |
|------|------|------------|------|-------------|
| 1 | music | (480.3, 45.5) | -22.8° | `WUwpW` |
| 2 | music | (56.3, 170) | -22.8° | `YR2pq` |
| 3 | music-2 | (513, 207.3) | +21.2° | `dU0da` |
| 4 | music-2 | (106.7, 280) | -11.6° | `lu4YA` |

- icon 尺寸: 99×68
- 填充: 线性渐变 #dd7b66 → #ffffff
- 建议实现: 预渲染为静态图或使用 Lottie 做轻微浮动动画

### 4.2 Mini Player (664×142)

| 属性 | 值 | Pencil Node |
|------|-----|-------------|
| 外框 | 664×142 | `3f2Vk` |
| 布局 | vertical, alignItems: center, justifyContent: space_between |
| padding | [0, 0, 10, 0] (bottom: 10) |

#### 进度条

| 属性 | 值 | Pencil Node |
|------|-----|-------------|
| 容器 | 663×6, vertical | `SYnXA` |
| 已播进度 | 224×6 (示例值), cornerRadius [12,0,0,12], fill `#FFFFFF7A` | `1bxmu` |
| 总进度条 | fill_container × 6, fill `#FFFFFF7A` opacity 0.25 | `6QTI7` |

#### 歌曲信息区

| 属性 | 值 | Pencil Node |
|------|-----|-------------|
| 容器 | 659×124, layout: none | `I1Dlf` |
| 封面图 | 70×70, cornerRadius 16 | `2wVzw` |
| 封面图位置 | (33.5, 27) | `Mi2jX` |
| 封面图默认 | 线性渐变 32°, #000000→#595959 50%→#FFFFFF | — |

| 文字 | 值 | 字体 |
|------|-----|------|
| 歌曲名 | "Dance with You" | MiSans VF, 32px, normal, `#FFFFFFE5`, at (129.5, 15) |
| 歌手名 | "Justin Durk" | MiSans VF, 28px, normal, `#FFFFFF7A`, at (129, 58.7), fixed-width 312 |

#### Mini Player 控制按钮 (Row-[32])

```
[暂停]  ←53px→  [下一曲]
 80×80            80×80

位置: 画面右侧 (集成在 `Ov49c` 内, width:181)
```

> Mini Player 只有 2 个按钮 (暂停 + 下一曲)，没有上一曲。

#### 数据接口 — 播放器

```json
{
  "playback": {
    "is_playing": true,
    "current_track": {
      "title": "{{track_title}}",
      "artist": "{{artist_name}}",
      "cover_url": "{{cover_url}}",
      "duration_ms": 0,
      "position_ms": 0
    }
  },
  "player_mode": "pet|mini"
}
```

| 字段 | 来源 | 说明 |
|------|------|------|
| `track_title` | 当前播放内容 | 歌曲名 / 播客标题 |
| `artist_name` | 当前播放内容 | 歌手名 / 频道名 |
| `cover_url` | 当前播放内容 | 封面图 URL |
| `duration_ms` | 播放引擎 | 总时长 (ms) |
| `position_ms` | 播放引擎 | 当前进度 (ms) |
| `player_mode` | 用户手动切换 | "pet" = 萌宠播放器, "mini" = mini player |

---

## 5. 设计系统 — Liquid Glass 子卡片实现

所有推荐子卡片 (喜马拉雅/QQ音乐的渐变卡) 共享一套 Liquid Glass 视觉语言。这里给出通用实现方案:

### 5.1 图层结构 (由下到上)

```
Layer 0: 渐变底色 (Rectangle, 超出卡片 clip)
  - 渐变方向: -261.35° (≈从左下到右上)
  - 尺寸: 300×288 (偏移 x:-5)
  - 配色: 按 gradient_theme 选择

Layer 1: 装饰方块 (Rectangle)
  - 118.5×118.5, cornerRadius 2
  - opacity 0.5, rotation -45°
  - 位置: 右上角 (x:241.8, y:-54)

Layer 2: 装饰矢量 (Path)
  - 复杂 path, rotation -45°
  - 50% opacity 的主题色
  - 位置: 左下方

Layer 3: 毛玻璃层 (Rectangle)
  - 覆盖整个卡面
  - background_blur: radius 105
  - fill: #6262620F (近透明)

Layer 4: 文字 + 播放按钮
  - 标题: (32, 28)
  - 副标题: (32, 65)
  - 播放按钮: 右下区域
```

### 5.2 渐变配色速查表

| Theme | 主渐变 | 装饰方块 | 装饰矢量 |
|-------|--------|---------|---------|
| `blue` | `#383EC2 → #2FA7BD` | `#001AB8` 50% | `#719AE3` 50% |
| `purple` | `#C138A3 → #732FBC` | `#4B00B7` 50% | `#A072E3` 50% |
| `red` | `#C26638 → #BD2F2F` | `#B80000` 50% | `#EA4A4A` 50% |
| `green` | `#C29F38 → #50BD2F` | `#7EB800` 50% | `#E8EB4B` 50% |

### 5.3 播放按钮

```
全高卡 (256px):
  容器: 80×80 group, 位于 (186.5~197, 144.5)
  外圆: 80×80 ellipse, fill #FFFFFF, opacity 0.2
  内三角: 35×26, fill #FFFFFF, rotation -90°
  三角位置: (57, 23) 相对于容器

半高卡 (120px):
  容器: 80×80 group, 位于 (197, 25)
  结构同上
```

---

## 6. Android 实现建议

### 6.1 技术选型

| 模块 | 推荐方案 |
|------|---------|
| 卡片容器 | `CardView` (664×1110), cornerRadius 32dp |
| 内容翻页 | `ViewPager2` + `FragmentStateAdapter` |
| Page Indicator | 自定义 View 或 `TabLayoutMediator` |
| 播放器切换 | `MotionLayout` 或 `ValueAnimator` 平滑过渡 |
| 毛玻璃效果 | `RenderEffect.createBlurEffect()` (API 31+) 或 `RenderScript` |
| 渐变背景 | `GradientDrawable` (XML 或代码生成) |
| 字体 | `MiSans VF` 可变字体 (assets/fonts/) |

### 6.2 组件树

```kotlin
RecommendCardView (664×1110, cornerRadius=32)
├── BackgroundGradient (#7343B6 → #150A3D)
├── MultitaskingIndicator (664×32)
├── ContentArea (ViewPager2)
│   ├── XimalayaCardFragment
│   │   ├── TabBar (icon + "喜马拉雅")
│   │   ├── ContentGrid
│   │   │   ├── LiquidGlassCard ("快听", blue)
│   │   │   └── LiquidGlassCard ("上次听过", purple)
│   │   └── BottomBar ("说出功能...")
│   ├── QQMusicCardFragment
│   │   ├── TabBar (icon + "QQ音乐")
│   │   ├── ContentGrid (3-sub OR 4-sub, 数据驱动)
│   │   │   ├── LiquidGlassCard (red)
│   │   │   ├── LiquidGlassCard (green)
│   │   │   ├── LiquidGlassCard (purple)
│   │   │   └── LiquidGlassCard (blue)  // 可选, 4-sub 时
│   │   └── BottomBar ("说出功能...")
│   ├── AIPodcastCardFragment
│   │   ├── StatusText ("AI播客已生成")
│   │   ├── LiquidGlassCard (blue, 居中)
│   │   └── TitleText ("AI浪潮下...")
│   └── AIRecommendCardFragment
│       ├── HeaderText ("为你推荐·本次行程45mins")
│       ├── AlbumCarousel (3 items, 旋转布局)
│       └── FooterText ("雨天深夜通勤听单")
├── PageIndicator (4 dots)
└── PlayerArea
    ├── PetPlayerView (555px) ─── OR
    └── MiniPlayerView (142px)
```

### 6.3 尺寸适配策略

设计基准: **664dp 宽**。实际车机屏幕宽度可能不同,建议:

```kotlin
val designWidth = 664f
val scale = actualContainerWidth / designWidth
// 所有 dp 值乘以 scale
```

---

## 7. Pencil 校准清单

开发完成后，使用以下清单对照 Pencil 设计稿进行 1:1 校准:

### 7.1 整体校准

| # | 校验项 | Pencil Node | 预期值 | 检查方法 |
|---|--------|-------------|--------|---------|
| 1 | 卡片总尺寸 | `mGjm6` / `3F4Ym` | 664×1110 | 截图叠加对比 |
| 2 | 圆角 | — | 32dp | 视觉比对 |
| 3 | BG 渐变色 | `1gYX2` / `avfKQ` | #7343B6→#150A3D | 取色器验证 |
| 4 | 顶部指示器 | `eBf8B` / `6oa1b` | 36×8 手柄, 居中 | 截图对比 |

### 7.2 内容卡片校准 (每张卡都要验)

| # | 校验项 | 预期值 | 检查方法 |
|---|--------|--------|---------|
| 5 | Tab 栏高度 | 75 (or 120 for AI卡) | Layout Inspector |
| 6 | Tab icon 尺寸 | 40×40 | — |
| 7 | Tab 文字 | 26px MiSans VF, #D9D9D999 | 取色+字号 |
| 8 | 底栏文字 | 同上, "说出功能..." | — |
| 9 | 子卡片圆角 | 16 | — |
| 10 | 子卡片尺寸 (555模式) | 292×256 / 292×120 | Layout Inspector |
| 11 | 子卡片尺寸 (968模式) | 598×256 / 292×256 | Layout Inspector |
| 12 | 子卡片毛玻璃 | blur radius 105, fill #6262620F | 视觉比对 |
| 13 | 子卡片渐变色 | 按 theme 表匹配 | 取色器 |
| 14 | 标题 (28px #FFF) | 位于 (32, 28) | — |
| 15 | 副标题 (22px, opacity 0.4) | 位于 (32, 65) | — |
| 16 | 播放按钮 | 80×80, 外圆 20% 白, 内三角 | — |

### 7.3 播放器校准

| # | 校验项 | 预期值 | Pencil Node |
|---|--------|--------|-------------|
| 17 | 萌宠播放器高度 | 555 | `F6cN5` |
| 18 | 控制按钮尺寸 | 80×80, cornerRadius 20 | `Pu5BX` 等 |
| 19 | 按钮背景色 | #D9D9D999 | — |
| 20 | 按钮间距 | 组间 72, 组内 81 | `CpM6P`, `nJkUl` |
| 21 | Mini Player 高度 | 142 | `3f2Vk` |
| 22 | 进度条高度 | 6 | `SYnXA` |
| 23 | 进度条填充色 | #FFFFFF7A (轨道 25% opacity) | — |
| 24 | 封面图 | 70×70, cornerRadius 16, at (33.5, 27) | `2wVzw` |
| 25 | 歌名 | 32px #FFFFFFE5, at (129.5, 15) | `2dAMU` |
| 26 | 歌手 | 28px #FFFFFF7A, at (129, 58.7), maxWidth 312 | `PYJeL` |

### 7.4 Page Indicator 校准

| # | 校验项 | 预期值 |
|---|--------|--------|
| 27 | 圆点数量 | 4 |
| 28 | 圆点尺寸 | 11×11 |
| 29 | 圆点间距 | 10 |
| 30 | 选中色 / 未选中色 | #CCCCCC / #CCCCCC80 |

### 7.5 截图对比方法

```
1. 在 Pencil 中, 使用 get_screenshot 导出目标 node 的 2x PNG
2. 在 Android 模拟器/实机中, 截图对应区域
3. 在图像编辑器中:
   a. 将两张图缩放到相同 DPI
   b. 叠加 (差值模式/半透明)
   c. 差异像素应 < 2dp
4. 重点对比: 圆角、间距、字号、渐变色值
```

---

## 8. 附录

### 8.1 参考截图 (2x PNG)

所有参考截图位于 `design/ref/` 目录, 文件名即 Pencil Node ID:

| 文件 | 内容 |
|------|------|
| `mGjm6.png` | 萌宠播放器 完整组合 (664×1110) |
| `3F4Ym.png` | Mini Player 完整组合 (664×1110) |
| `76pZ5.png` | 喜马拉雅卡 — 555 模式 |
| `XCciv.png` | QQ音乐卡 (3子) — 555 模式 |
| `jOy3W.png` | QQ音乐卡 (4子) — 555 模式 |
| `mQv2u.png` | AI播客卡 — 555 模式 |
| `2XU4O.png` | AI推荐卡 — 555 模式 |
| `YcV07.png` | 喜马拉雅卡 — 968 模式 |
| `IpcbK.png` | QQ音乐卡 (3子) — 968 模式 |
| `G0hhV.png` | QQ音乐卡 (4子) — 968 模式 |
| `F6cN5.png` | 萌宠播放器 (播放器区) |
| `3f2Vk.png` | Mini Player (播放器区) |

> 校准时将开发截图与上述 ref 图做像素级叠加对比。

### 8.2 Pencil 设计稿

原始 Pencil 文件: `design/demo落地版本.pen`

### 8.3 Pencil Node ID 速查

| 组件 | 555 模式 Node | 968 模式 Node | 说明 |
|------|-------------|---------------|------|
| **整体组合** | `mGjm6` | `3F4Ym` | 含 BG + 内容 + 播放器 |
| **喜马拉雅卡** | `76pZ5` | `YcV07` | widget-function2 |
| **QQ音乐卡 (3子)** | `XCciv` | `IpcbK` | widget-function1 |
| **QQ音乐卡 (4子)** | `jOy3W` | `G0hhV` | widget-function1 |
| **AI播客卡** | `mQv2u` | `y1nJq` | AI推荐卡-雨天深夜通勤 |
| **AI推荐卡** | `2XU4O` | `FnHFh` | list |
| **萌宠播放器** | `F6cN5` | — | widget-time |
| **Mini Player** | — | `3f2Vk` | widget-player |
| **Page Indicator** | `hvPnt` | `2SjKH` | 4圆点 |
| **萌宠控制按钮** | `CpM6P` | — | Row-[68] |
| **Mini 控制按钮** | — | `Ov49c` | Row-[32] |

### 8.4 字体规格汇总

| 场景 | 字号 | 字重 | 颜色 | 备注 |
|------|------|------|------|------|
| Tab 平台名 | 26 | 500 | #D9D9D999 | — |
| 底栏文案 | 26 | 500 | #D9D9D999 | "说出功能..." |
| AI卡顶/底文案 | 32 | 500 | #D9D9D9FF | 居中 |
| 子卡标题 | 28 | 500 | #FFFFFFFF | 左上 (32, 28) |
| 子卡副标题 | 22 | normal | multi-fill, 0.4 | 左 (32, 65) |
| 歌单项标题 | 18 | normal | #FFFFFFE5 | AI推荐列表 |
| 歌单项副标题 | 18 | normal | #FFFFFF7A | AI推荐列表 |
| Mini Player 歌名 | 32 | normal | #FFFFFFE5 | — |
| Mini Player 歌手 | 28 | normal | #FFFFFF7A | maxWidth 312 |

### 8.5 配色 Token 汇总

```kotlin
object DesignTokens {
    // 背景
    val BG_GRADIENT_START = Color(0xFF7343B6)
    val BG_GRADIENT_END   = Color(0xFF150A3D)

    // 文字
    val TEXT_PRIMARY     = Color(0xFFFFFFFF)  // 子卡标题
    val TEXT_SECONDARY   = Color(0x99D9D9D9)  // Tab/底栏
    val TEXT_STATUS      = Color(0xFFD9D9D9)  // AI卡状态文案
    val TEXT_SONG_TITLE  = Color(0xE5FFFFFF)  // 播放器歌名
    val TEXT_SONG_ARTIST = Color(0x7AFFFFFF)  // 播放器歌手

    // 控件
    val BUTTON_BG        = Color(0x99D9D9D9)  // 播放控制按钮
    val PROGRESS_FILL    = Color(0x7AFFFFFF)  // 进度条填充
    val PROGRESS_TRACK   = Color(0x40FFFFFF)  // 进度条轨道 (7A * 0.25)
    val INDICATOR_ACTIVE = Color(0xFFCCCCCC)  // 圆点选中
    val INDICATOR_IDLE   = Color(0x80CCCCCC)  // 圆点未选

    // 毛玻璃
    val GLASS_FILL       = Color(0x0F626262)  // 毛玻璃层
    val GLASS_BLUR_RADIUS = 105f              // dp

    // 渐变主题
    data class GlassTheme(val gradientStart: Long, val gradientEnd: Long,
                          val decoBlock: Long, val decoVector: Long)

    val THEME_BLUE   = GlassTheme(0xFF383EC2, 0xFF2FA7BD, 0xFF001AB8, 0x80719AE3)
    val THEME_PURPLE = GlassTheme(0xFFC138A3, 0xFF732FBC, 0xFF4B00B7, 0x80A072E3)
    val THEME_RED    = GlassTheme(0xFFC26638, 0xFFBD2F2F, 0xFFB80000, 0x80EA4A4A)
    val THEME_GREEN  = GlassTheme(0xFFC29F38, 0xFF50BD2F, 0xFF7EB800, 0x80E8EB4B)
}
```
