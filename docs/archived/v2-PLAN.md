# AI 音乐推荐 · 评测迭代系统 — 编码计划

> v1.1 | 2026-04-03 | 供 Claude Code 编码使用

## 项目背景

车载智能音乐推荐系统。手机端 → 服务器(阿里云 47.94.241.139) → 车端 Android，通过 WebSocket 通信。车端接收用户输入后，拼接 prompt 调用 LLM（千问），返回 tool_call 执行 UI 操作（切页、切卡片、AI 推荐）。

目标：构建评测 + 持续优化闭环系统。

## 已有代码

```
eval-music/
├── bitable_client.py          # 飞书多维表格 CRUD（Case 管理）
├── recommender.py             # Mock 推荐器（MOCK_MODE=True）
├── run_eval_dashboard.py      # 本地评测 runner + HTML dashboard
├── metrics/
│   ├── format_metric.py       # 硬约束：格式正确性
│   ├── playability_metric.py  # 硬约束：可播放性
│   ├── llm_metrics.py         # GEval 4 维软指标
│   └── __init__.py
└── docs/                      # HTML 文档（详细版计划在此）
```

## 车端 Trace 日志格式（已由 Android 同事实现）

每次推荐请求产生一条 trace，包含 4 个有序 nodes：

```json
{
  "traceId": "8954668d-724e-4c5e-8a65-8bc4acdab82e",
  "timestamp": 1775201599179,
  "mode": "recommend",
  "nodes": [
    {
      "type": "input",
      "timestamp": 1775201599179,
      "data": {
        "user_text": "用户想听AI播客：《顶尖管理者的决策思维》，请切换到AI博客卡片",
        "current_page": 0,
        "current_page_name": "喜马拉雅",
        "current_qq_cards": "",
        "ximalaya_cards": "热门播客, 每日新闻, 相声小品, 热门有声书"
      }
    },
    {
      "type": "prompt",
      "timestamp": 1775201599179,
      "data": {
        "system_prompt": "你是车载智能音乐 UI 编排助手...(完整 prompt 文本，很长)",
        "user_message": "[当前正在喜马拉雅页面...] 用户想听AI播客...",
        "tools": "[{name=switch_recommend_page, description=...}, ...]"
      }
    },
    {
      "type": "response",
      "timestamp": 1775201600654,
      "data": {
        "tool_calls": "[{function=switch_recommend_page, arguments={\"page_index\": 2}}]",
        "error": null,
        "latency_ms": 1472
      }
    },
    {
      "type": "action",
      "timestamp": 1775201600654,
      "data": {
        "actions": "[{type=switch_page, page=2}]"
      }
    }
  ]
}
```

**注意**：`tool_calls`、`tools`、`actions` 字段的值是**字符串化的 JSON/类 JSON**，需要解析。

## 合法卡片池（用于 playability 检查）

QQ 卡片（15 张）：我喜欢, 每日30首, 欧美榜, 香港TVB劲歌金榜, 抖音热歌榜, 热歌榜, 新歌榜, 飙升榜, 猜你喜欢, 精选歌单, 场景歌单, 热门歌手, 收藏歌单, 最近播放, 自建歌单

喜马拉雅卡片（10 张）：热门播客, 每日新闻, 相声小品, 热门有声书, 悬疑推理, 历史人文, 知识科普, 情感生活, 儿童故事, 健康养生

页面索引：0=喜马拉雅, 1=QQ音乐, 2=AI播客, 3=AI推荐

4 个 tool：switch_recommend_page, switch_recommend_qq_cards, switch_recommend_ximalaya_cards, query_ai_recommend

---

## Phase 1：打通评测闭环（优先实现）

### 1.1 trace_parser.py — Trace 日志解析

从 4-node trace 提取评测结构化数据：

```python
def parse_trace(trace: dict) -> dict:
    """解析车端 Trace JSON，提取评测所需字段"""
    nodes = {n["type"]: n["data"] for n in trace["nodes"]}
    return {
        "trace_id": trace["traceId"],
        "timestamp": trace["timestamp"],
        "mode": trace["mode"],
        # input node
        "user_text": nodes["input"]["user_text"],
        "ui_state": {
            "page": nodes["input"]["current_page"],
            "page_name": nodes["input"]["current_page_name"],
            "qq_cards": parse_card_list(nodes["input"]["current_qq_cards"]),
            "xm_cards": parse_card_list(nodes["input"]["ximalaya_cards"]),
        },
        # response node — 核心评测对象
        "tool_calls": parse_tool_calls(nodes["response"]["tool_calls"]),
        "latency_ms": nodes["response"]["latency_ms"],
        "error": nodes["response"]["error"],
        # action node
        "actions": parse_actions(nodes["action"]["actions"]),
        # prompt 指纹（版本追溯）
        "prompt_fingerprint": hashlib.md5(
            nodes["prompt"]["system_prompt"].encode()
        ).hexdigest()[:8],
    }
```

需要实现的辅助函数：
- `parse_card_list(s: str) -> list[str]` — 解析逗号分隔的卡片名字符串
- `parse_tool_calls(s: str) -> list[dict]` — 解析 tool_calls 字符串（注意格式可能是 Java toString 而非标准 JSON，如 `{function=xxx, arguments={...}}`）
- `parse_actions(s: str) -> list[dict]` — 同上

### 1.2 eval_server.py — FastAPI 后端

部署在阿里云 47.94.241.139:9002，Nginx 反向代理 `/api/eval/` → `:9002`。

核心接口：

| 接口 | 方法 | 功能 |
|------|------|------|
| `/api/eval/trace` | POST | 接收车端 Trace（单条或数组），解析存储，traceId 去重 |
| `/api/eval/run` | POST | 触发一轮评测：读 Case → 注入 → 等待 Trace → 评分 |
| `/api/eval/scores/{run_id}` | GET | 查询某次评测的 6 维分数 |
| `/api/eval/history` | GET | 评测历史列表 |
| `/api/eval/traces` | GET | 查看已收集的 Trace 列表（调试用） |

`/api/eval/trace` 接口规范（提供给车端）：

```
POST /api/eval/trace
Content-Type: application/json

请求体: 单个 Trace 对象 或 Trace 数组 [{...}, {...}]
成功: 200 {"status": "ok", "trace_ids": ["xxx"], "received": 1}
失败: 400 {"status": "error", "message": "..."}
幂等: 相同 traceId 不重复存储
```

### 1.3 eval_injector.py — Case 注入器

从 Bitable 读取 Case → 转换为 WS 消息 → 注入到业务流。

Case 字段 → WebSocket JSON 映射：

**触发方式=query → type=content**
```json
{
  "type": "content",
  "session_id": "eval_{case_id}_{yyyymmdd}_{HHMMss}",
  "timestamp": "ISO8601",
  "user_profile": {
    "persona_id": "eval_user",
    "persona_label": "偏好{偏好风格}，{偏好语言}，{乘客}"
  },
  "payload": { "text": "{用户 Query}" }
}
```

**触发方式=auto → type=recommend**
```json
{
  "type": "recommend",
  "session_id": "eval_{case_id}_{yyyymmdd}_{HHMMss}",
  "timestamp": "ISO8601",
  "user_profile": { "persona_id": "eval_user", "persona_label": "..." },
  "payload": {
    "trigger": "user_enter_car",
    "trip": {"scene_id": "{活动场景映射}", "scene_label": "{活动场景}", "duration_min": 30},
    "time_context": {"hour": "{时间段映射}", "day_type": "{日期类型映射}", "period": "{时间段}"}
  }
}
```

WebSocket 地址：`ws://47.94.241.139:8080/ws?room=eval_room_001`

CLI 用法：
```bash
python eval_injector.py --cases all --interval 15  # 全部已审核 Case，15s 间隔
python eval_injector.py --case-id C001             # 单条
```

### 1.4 metrics 适配 Trace 格式

现有 metrics 接收 Mock 格式数据，需要适配为接收 `parse_trace()` 的输出。

**format_metric.py 改动**：
- 输入从 Mock response 改为 `parsed_trace["tool_calls"]`
- 检查 tool_calls 是 list[dict]，每个 dict 包含 function (str) + arguments (dict)
- function name 必须在 4 个合法 tool 中

**playability_metric.py 改动**：
- 更新卡片合法池为真实的 15 QQ + 10 喜马拉雅
- 检查 arguments 中的 page_index (0-3) 和 card_names (在对应合法池中)

**llm_metrics.py 改动**：
- GEval prompt 中的 input/output 改为从 parsed_trace 构造
- input = user_text + ui_state + Case 的偏好/场景信息
- output = tool_calls + actions

### 1.5 存储

```
/opt/relay/eval-data/
├── traces/                    # 原始 Trace JSON
│   └── 2026-04-03/
│       └── {traceId}.json
├── parsed/                    # 解析后数据
│   └── 2026-04-03/
│       └── {traceId}.json
└── eval.db                    # SQLite（trace 索引 + 评分结果）
```

SQLite 表结构：
```sql
CREATE TABLE traces (
    trace_id TEXT PRIMARY KEY,
    timestamp INTEGER,
    mode TEXT,
    user_text TEXT,
    tool_calls TEXT,        -- JSON
    latency_ms INTEGER,
    prompt_fingerprint TEXT,
    case_id TEXT,           -- 关联的 Case ID（注入时记录）
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE eval_runs (
    run_id TEXT PRIMARY KEY,
    timestamp TIMESTAMP,
    prompt_fingerprint TEXT,
    case_count INTEGER,
    avg_score REAL,
    status TEXT             -- running / completed / failed
);

CREATE TABLE eval_scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT,
    trace_id TEXT,
    case_id TEXT,
    format_score REAL,       -- 硬约束 0/1
    playability_score REAL,  -- 硬约束 0/1
    key_factor_score REAL,   -- GEval 0-10
    preference_score REAL,   -- GEval 0-10
    scene_score REAL,        -- GEval 0-10
    copy_score REAL,         -- GEval 0-10
    latency_ms INTEGER,
    reasoning TEXT,          -- 评分理由 JSON
    FOREIGN KEY (run_id) REFERENCES eval_runs(run_id),
    FOREIGN KEY (trace_id) REFERENCES traces(trace_id)
);
```

---

## Phase 2：Prompt 云端调优（Phase 1 之后）

### prompt_config_manager.py

- 读写 `/opt/relay/prompt-configs/v{N}.json`
- 每个版本 = 完整的推荐 prompt JSON 配置
- API: GET current / GET versions / POST save / POST deploy / POST rollback

### 下发机制

通过 WS 发送 `{"type": "prompt_update", "version": N, "config": {...}}` 给车端。

### 可编辑字段

可编辑：system_prompt, tools.*.description, tools.*.params.*, qq_cards.*.description, qq_cards.*.keywords, xm_cards.*.description, xm_cards.*.keywords

**不可编辑**（后端校验）：qq_cards.*.displayName, xm_cards.*.displayName

---

## Phase 3：Web Dashboard（Phase 1+2 之后）

React + Tailwind SPA，5 个页面：Case 管理、评测执行、评分看板（雷达图+趋势）、模拟输入、Prompt 编辑器。

部署在同一台阿里云，Nginx 代理静态文件。

---

## 关键依赖

| 依赖 | 状态 |
|------|------|
| 车端 Trace 上报 | ✅ 已完成 |
| 车端 HTTP POST /api/eval/trace | 待车端实现（接口已定义） |
| 飞书 Bitable API | ✅ 已封装 |
| 阿里云服务器 | ✅ 可用 |
| WebSocket 通道 | ✅ relay.js 已运行 |

## Bitable 配置

```python
APP_ID     = "cli_a94654a8c779dbd4"
APP_SECRET = "PwauzTiNK3XJKNcSgLskMhKi5KH337KS"
APP_TOKEN  = "V6XVbmGVNaANUQsQQzMcaftAnWg"
TABLE_ID   = "tbldH5LzNDOBCZnk"
```

## 编码顺序

1. `trace_parser.py` — 解析逻辑 + 单元测试（用上面的示例 Trace）
2. `eval_server.py` — FastAPI 框架 + `/api/eval/trace` 接收接口 + SQLite 存储
3. `eval_injector.py` — Case → WS 注入
4. metrics 适配 — format_metric / playability_metric / llm_metrics 对接 Trace
5. 评分 pipeline — eval_server 中串联：Trace → 匹配 Case → 6 维评分 → 写入结果
6. 端到端联调
