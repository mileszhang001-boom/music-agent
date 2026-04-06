# -*- coding: utf-8 -*-
"""Metric ③④⑤⑥ — 四个 LLM-as-Judge 软指标

使用 DeepSeek V3 原生 API（OpenAI 兼容格式）。
评分制度：0-10 分，提供细粒度区分。
保留原有的 anti-leniency 校准指令。
"""

import json
import httpx

from metrics.base import BaseMetric, MetricResult
from config import DEEPSEEK_API_KEY, DEEPSEEK_API_BASE, JUDGE_MODEL, PAGES


# ═══════════════════════════════════════════════════════════
# 全局校准指令（注入每个 criteria 末尾）
# 目的：对抗 LLM judge 的 leniency bias（宽容偏差）
# 从原 eval-music/metrics/llm_metrics.py 保留
# ═══════════════════════════════════════════════════════════
ANTI_LENIENCY_PROMPT = """

═══ 校准指令（必须遵守）═══
你是一个严格的评估者。请注意以下校准规则：

1. 分数分布校准：在一组合格的推荐结果中，大部分应得 5-7 分。
   8 分以上意味着"在该维度上几乎找不到可改进之处"——这应该是少数情况。
   不要因为"没有明显错误"就给 8+，"没有错"≠"做得好"。

2. 区分"不出错"与"做得好"：
   - "操作没有违反约束"只能保证不低于 5 分，不代表应该给高分
   - "操作高度针对当前场景、换个场景就不合适了" 才值得 7-8 分
   - 只有"让人惊喜的精准操作"才配 9-10 分

3. 反向测试：打分前先问自己——如果有人提交一份明显更好的操作方案，
   你现在这个分还站得住吗？如果有明显的提升空间，不应该给 8+。

4. 必须指出具体不足：不允许只说"整体良好"就给高分。
   reason 中必须列出至少一个具体的改进点或不足（哪怕是小问题），
   除非你认为该维度已经完美无缺（9-10 分）。
"""


# ═══════════════════════════════════════════════════════════
# 四个维度的 Rubric
# ═══════════════════════════════════════════════════════════

RUBRIC_KEY_FACTOR = """评估 AI 的 tool_call 操作是否严格遵守了输入中的关键约束因素。

你将看到：
- 用户输入（user_text）和当前 UI 状态
- AI 返回的 tool_calls（页面切换、卡片选择等操作）
- Case 上下文（用户偏好、关键因素等）

关键因素分为两类：
1. 明确指令：如「用户想听播客」→ 必须切到 AI 播客页面（page_index=2），不能留在其他页面。
   「来点欧美音乐」→ 应该选择包含欧美内容的卡片（如"欧美榜"），不应选择"相声小品"。
2. 人群约束：如「儿童上车」→ 选择的卡片应适合儿童（如"儿童故事"），不应选择不适宜内容。
   「不听英文歌」→ 不应切到以英文内容为主的卡片。

评分标准（0-10分制）：
9-10分 = 所有 tool_call 操作完全围绕关键因素展开，无一违反
7-8分  = 全部遵守约束，但操作不够精准（如用户明确要播客，虽然切了页面但没选具体卡片）
5-6分  = 大部分遵守，但有部分操作与约束不完全一致
3-4分  = 部分考虑了关键因素，但混入了不相关的操作
1-2分  = 关键因素被明显忽略，操作跟没有该因素时差别不大
0分    = 操作与关键因素直接冲突

重要规则：
- 即时约束（如「我想听播客」「不要英文歌」）的优先级高于用户长期偏好
- 本维度只评价关键因素的遵守情况，不评价操作效率
- 如果 context 中没有标注关键因素，你需要从用户输入(user_text)中自行识别隐含约束
  例如「来点安静的」隐含「安静」约束，「随便放点什么」则无明确约束
- 无法识别出任何约束时给 6 分（中性），不要给 8 分""" + ANTI_LENIENCY_PROMPT

RUBRIC_PREFERENCE = """评估 AI 的 tool_call 操作是否体现了用户画像中的偏好。

你将看到：
- 用户输入和当前 UI 状态
- AI 返回的 tool_calls（页面切换、卡片选择等操作）
- Case 上下文（偏好风格、偏好语言、排斥风格等）

评估操作选择是否反映了用户偏好。例如：
- 偏好欧美流行 → 应选择 QQ 音乐的"欧美榜"而非"热歌榜"（泛化）
- 偏好播客 → 应优先考虑喜马拉雅页面或 AI 播客页面
- 偏好安静民谣 → 应选择"场景歌单"（可匹配安静场景）而非"抖音热歌榜"

评分标准（0-10分制）：
9-10分 = 操作深度匹配用户偏好，选择的页面和卡片高度针对该用户画像
7-8分  = 页面和卡片选择与偏好方向一致，但缺乏精准度
5-6分  = 有一定关联但不够精准，选了"安全但泛化"的选项
3-4分  = 偏好匹配度低，操作与用户画像关系不大
1-2分  = 操作与偏好方向冲突
0分    = 完全无关，或选了用户明确排斥的方向

锚定案例：
- 用户偏好「欧美流行」，AI 切到 QQ 页面 + 选了"欧美榜" → 7-8 分
- 用户偏好「欧美流行」，AI 切到 QQ 页面 + 选了"热歌榜" → 5-6 分（泛化）
- 用户偏好「欧美流行」，AI 切到喜马拉雅 + 选了"相声小品" → 1-2 分

注意：
- 如果关键因素（如「儿童上车」）导致操作偏离用户日常偏好，不应扣分
- 即使 context 中没有显式偏好标注，也应从 user_text 中识别隐含偏好
  例如「来点欧美音乐」隐含欧美偏好，「放点嗨的」隐含高能量偏好
- 无法识别任何偏好信息时给 5 分（中性），不要高于 5 分""" + ANTI_LENIENCY_PROMPT

RUBRIC_SCENE = """评估 AI 的 tool_call 操作与用户「此刻场景」的契合程度。

你将看到：
- 用户输入和当前 UI 状态
- AI 返回的 tool_calls（页面切换、卡片选择等操作）
- Case 上下文（时间段、日期类型、活动场景、乘客等）

核心评估方法——反向测试：
不只问「这些操作适不适合这个场景」，
还要问「把这些操作放到一个完全不同的场景，是否仍然合适？」
如果答案是「换个场景也行」，说明场景契合度不高。

评分标准（0-10分制）：
9-10分 = 操作高度特异于当前场景——换一个时间/场合/活动，这个操作方案会明显不合适
7-8分  = 操作与场景有明确关联，但个别选择在「任何场景都适用」
5-6分  = 不出错但缺乏针对性——像一个「万能安全方案」，换个场景也行
3-4分  = 大部分操作与场景关联不强
1-2分  = 操作与场景有明显错位（如深夜独处选了"抖音热歌榜"这种嗨曲入口）
0分    = 操作与场景完全矛盾

锚定案例：
- 早上通勤 + 偏好民谣，AI 选了"场景歌单"（匹配通勤场景）→ 7-8 分
- 早上通勤 + 偏好民谣，AI 选了"猜你喜欢"（泛化）→ 5-6 分
- 儿童场景，AI 切到喜马拉雅 + 选了"儿童故事" → 8-9 分（高度针对性）

重要：5-6 分是最需要仔细把关的区间。
如果你无法指出这个操作方案为什么特别适合这个场景，就不应该超过 6 分。

强信号规则：
- 儿童上车、深夜独驾、长途 2 小时、下雨天、特殊节日——这些是强信号
- 强信号如果在推荐中完全没有体现，即使推荐内容本身"没有错"，也应扣到 3 分以下
- 弱信号场景（如"周末下午晴天"）的天花板是 7 分，除非 AI 做了跨信号组合推理""" + ANTI_LENIENCY_PROMPT

RUBRIC_ACTION_LOGIC = """评估 AI 的 tool_call 操作序列是否逻辑合理、高效。

你将看到：
- 用户输入和当前 UI 状态（当前在哪个页面、哪些卡片可见）
- AI 返回的 tool_calls 操作序列
- 执行后的 actions

评估维度：
1. 操作顺序：页面切换应在卡片选择之前（先切页面，再选卡片）
2. 操作必要性：不应有冗余操作（如当前已在 QQ 页面，不应再切到 QQ 页面）
3. 操作完整性：如果需要切页面+选卡片，不应只做一半
4. 操作一致性：如果切到了 QQ 页面，后续卡片选择应该用 switch_recommend_qq_cards 而非 ximalaya

评分标准（0-10分制）：
9-10分 = 操作序列精简高效，没有冗余，顺序合理，覆盖完整
7-8分  = 逻辑正确，但有小瑕疵（如多了一步不必要的操作，或少了一步优化）
5-6分  = 基本能完成目标，但操作不够精练或有遗漏
3-4分  = 操作逻辑有明显问题（如先选卡片再切页面，导致卡片选择无效）
1-2分  = 操作序列混乱，无法达成用户意图
0分    = 操作之间互相矛盾

锚定案例：
- 当前在喜马页面，用户要听 QQ 音乐 → AI 先 switch_page(1) 再 switch_qq_cards(["欧美榜"]) → 9 分
- 当前在喜马页面，用户要听 QQ 音乐 → AI 只 switch_page(1) 没选卡片 → 6 分（不完整）
- 当前已在 QQ 页面 → AI 又 switch_page(1) → 扣分（冗余）
- AI 先 switch_qq_cards 再 switch_page → 3-4 分（顺序错误）""" + ANTI_LENIENCY_PROMPT


# ═══════════════════════════════════════════════════════════
# LLM Judge 调用
# ═══════════════════════════════════════════════════════════

def _build_api_url() -> str:
    return f"{DEEPSEEK_API_BASE.rstrip('/')}/chat/completions"


def _build_eval_input(parsed_trace: dict, case_context: dict | None) -> str:
    """构造给 judge 的输入描述"""
    ui_state = parsed_trace.get("ui_state", {})
    page_name = ui_state.get("page_name", PAGES.get(ui_state.get("page", 0), "未知"))

    parts = [
        f"用户输入: {parsed_trace.get('user_text', '')}",
        f"当前页面: {page_name} (page_index={ui_state.get('page', '?')})",
    ]

    qq = ui_state.get("qq_cards", [])
    xm = ui_state.get("xm_cards", [])
    if qq:
        parts.append(f"当前 QQ 卡片: {', '.join(qq)}")
    if xm:
        parts.append(f"当前喜马卡片: {', '.join(xm)}")

    if case_context:
        ctx_parts = []
        # 用户画像
        for k in ["偏好风格", "偏好歌手", "偏好语言", "排斥风格", "画像标签"]:
            if case_context.get(k):
                ctx_parts.append(f"{k}: {case_context[k]}")
        # 场景
        for k in ["乘客", "活动场景", "时间段", "日期类型", "天气"]:
            if case_context.get(k):
                ctx_parts.append(f"{k}: {case_context[k]}")
        # 约束与期望
        if case_context.get("即时约束"):
            ctx_parts.append(f"⚠ 即时约束: {case_context['即时约束']}")
        if case_context.get("关键因素"):
            ctx_parts.append(f"⚠ 关键因素: {case_context['关键因素']}")
        if case_context.get("期望风格"):
            ctx_parts.append(f"期望风格: {case_context['期望风格']}")
        if case_context.get("应避免的内容"):
            ctx_parts.append(f"🚫 应避免: {case_context['应避免的内容']}")
        if ctx_parts:
            parts.append("\n用户画像与场景:\n" + "\n".join(ctx_parts))

    return "\n".join(parts)


def _build_eval_output(parsed_trace: dict) -> str:
    """构造给 judge 的输出描述（AI 的操作）"""
    tool_calls = parsed_trace.get("tool_calls", [])
    actions = parsed_trace.get("actions", [])

    parts = ["AI 执行的 tool_calls:"]
    for i, tc in enumerate(tool_calls):
        fn = tc.get("function", "")
        args = tc.get("arguments", {})
        parts.append(f"  {i+1}. {fn}({json.dumps(args, ensure_ascii=False)})")

    if actions:
        parts.append("\n执行后的 actions:")
        for a in actions:
            parts.append(f"  - {json.dumps(a, ensure_ascii=False)}")

    parts.append(f"\n延迟: {parsed_trace.get('latency_ms', '?')}ms")
    return "\n".join(parts)


JUDGE_SYSTEM_PROMPT = """你是一个专业的 AI 车载音乐推荐系统评估专家。
你需要根据给定的评价标准（criteria），对 AI 的操作（tool_calls）进行打分。

输出格式必须是严格的 JSON：
{"score": 数字(0-10), "reason": "评分理由（中文，100字以内）"}

只输出 JSON，不要输出其他内容。"""


async def _call_judge(rubric: str, eval_input: str, eval_output: str, use_thinking: bool = False) -> tuple[float, str]:
    """调用 LLM judge，返回 (score, reason)

    Args:
        use_thinking: 启用 V3.2 深度思考模式，评分更精准但延迟约 25-30s
    """
    user_prompt = f"""## 评价标准
{rubric}

## 输入（用户请求 + 上下文）
{eval_input}

## 输出（AI 的操作）
{eval_output}

请按评价标准打分，输出 JSON："""

    url = _build_api_url()
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {DEEPSEEK_API_KEY}",
    }
    payload = {
        "model": JUDGE_MODEL,
        "messages": [
            {"role": "system", "content": JUDGE_SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": 0.1,
        "max_tokens": 300,
    }

    if use_thinking:
        payload["enable_thinking"] = True
        payload["thinking"] = {"type": "enabled", "budget_tokens": 1024}
        payload["max_tokens"] = 2048

    timeout = 120 if use_thinking else 60
    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.post(url, headers=headers, json=payload)
        resp.raise_for_status()
        data = resp.json()

    content = data["choices"][0]["message"]["content"].strip()

    # 解析 JSON 响应
    # 处理可能的 markdown 代码块
    if content.startswith("```"):
        content = content.split("\n", 1)[-1].rsplit("```", 1)[0].strip()

    try:
        result = json.loads(content)
        score = float(result.get("score", 0))
        reason = result.get("reason", "")
        return min(max(score, 0), 10), reason
    except (json.JSONDecodeError, ValueError, TypeError):
        # 回退：尝试从文本中提取数字
        import re
        match = re.search(r'"score"\s*:\s*(\d+(?:\.\d+)?)', content)
        if match:
            return float(match.group(1)), content
        return 0.0, f"Judge 响应解析失败: {content[:200]}"


# ═══════════════════════════════════════════════════════════
# 四个 Metric 类
# ═══════════════════════════════════════════════════════════

class KeyFactorMetric(BaseMetric):
    name = "关键因素捕获"
    threshold = 0.6

    async def measure(self, parsed_trace: dict, case_context: dict | None = None, use_thinking: bool = False) -> MetricResult:
        eval_input = _build_eval_input(parsed_trace, case_context)
        eval_output = _build_eval_output(parsed_trace)
        score, reason = await _call_judge(RUBRIC_KEY_FACTOR, eval_input, eval_output, use_thinking=use_thinking)
        return MetricResult(
            name=self.name, score=score, reason=reason,
            threshold=self.threshold, is_successful=score >= self.threshold * 10,
        )


class PreferenceMetric(BaseMetric):
    name = "用户偏好匹配"
    threshold = 0.5

    async def measure(self, parsed_trace: dict, case_context: dict | None = None, use_thinking: bool = False) -> MetricResult:
        eval_input = _build_eval_input(parsed_trace, case_context)
        eval_output = _build_eval_output(parsed_trace)
        score, reason = await _call_judge(RUBRIC_PREFERENCE, eval_input, eval_output, use_thinking=use_thinking)
        return MetricResult(
            name=self.name, score=score, reason=reason,
            threshold=self.threshold, is_successful=score >= self.threshold * 10,
        )


class SceneMetric(BaseMetric):
    name = "场景契合度"
    threshold = 0.5

    async def measure(self, parsed_trace: dict, case_context: dict | None = None, use_thinking: bool = False) -> MetricResult:
        eval_input = _build_eval_input(parsed_trace, case_context)
        eval_output = _build_eval_output(parsed_trace)
        score, reason = await _call_judge(RUBRIC_SCENE, eval_input, eval_output, use_thinking=use_thinking)
        return MetricResult(
            name=self.name, score=score, reason=reason,
            threshold=self.threshold, is_successful=score >= self.threshold * 10,
        )


class ActionLogicMetric(BaseMetric):
    name = "操作逻辑性"
    threshold = 0.5

    async def measure(self, parsed_trace: dict, case_context: dict | None = None, use_thinking: bool = False) -> MetricResult:
        eval_input = _build_eval_input(parsed_trace, case_context)
        eval_output = _build_eval_output(parsed_trace)
        score, reason = await _call_judge(RUBRIC_ACTION_LOGIC, eval_input, eval_output, use_thinking=use_thinking)
        return MetricResult(
            name=self.name, score=score, reason=reason,
            threshold=self.threshold, is_successful=score >= self.threshold * 10,
        )


def create_llm_metrics() -> list[BaseMetric]:
    """创建四个 LLM 评测指标"""
    return [KeyFactorMetric(), PreferenceMetric(), SceneMetric(), ActionLogicMetric()]
