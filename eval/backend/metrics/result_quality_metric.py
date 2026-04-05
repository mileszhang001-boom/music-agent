# -*- coding: utf-8 -*-
"""结果质量评分 — LLM Judge 评估推荐内容

仅当 AI 调用了 query_ai_recommend 且返回了 result_items 时触发。
评价推荐内容与用户意图、偏好、场景的匹配度。
"""

import json

from metrics.base import BaseMetric, MetricResult
from config import DEEPSEEK_API_KEY, DEEPSEEK_API_BASE, JUDGE_MODEL


RUBRIC_RESULT_QUALITY = """评价维度：推荐结果质量

当 AI 触发了 query_ai_recommend 后，评价返回的推荐内容（歌曲/播客列表）是否匹配用户意图和场景。

评分标准：
- 9-10: 推荐内容精准匹配用户意图，风格、语言、情绪完全契合，有惊喜感
- 7-8: 大部分内容匹配，方向正确，有 1-2 个不太相关但不算错
- 5-6: 方向大致对但不够精准，内容较泛，缺少针对性
- 3-4: 有明显不匹配的内容（如用户要安静的但推了摇滚）
- 1-2: 推荐内容和用户意图基本无关

═══ 校准指令 ═══
大部分结果应在 5-7 分。8+ 意味着推荐列表几乎完美。
"有结果"≠"结果好"，请区分"返回了内容(5)"和"内容精准匹配(7-8)"。"""


class ResultQualityMetric(BaseMetric):
    name = "结果质量"
    threshold = 0.5

    async def measure(self, parsed_trace: dict, case_context: dict | None = None, use_thinking: bool = False) -> MetricResult:
        # 检查是否调用了 query_ai_recommend
        tool_calls = parsed_trace.get("tool_calls", [])
        has_recommend = any(
            (tc.get("function", "") or tc.get("tool", "")) == "query_ai_recommend"
            for tc in tool_calls
        )
        if not has_recommend:
            return MetricResult(name=self.name, score=-1, reason="非 AI 推荐场景", is_successful=False)

        # 检查是否有 result_items
        result_items = parsed_trace.get("result_items")
        if not result_items:
            return MetricResult(name=self.name, score=-1, reason="无推荐结果数据", is_successful=False)

        # 构造评估输入
        eval_input = f"用户输入: {parsed_trace.get('user_text', '')}"
        if case_context:
            ctx_parts = []
            for k in ["偏好风格", "偏好语言", "活动场景", "时间段", "乘客"]:
                if case_context.get(k):
                    ctx_parts.append(f"{k}: {case_context[k]}")
            if ctx_parts:
                eval_input += "\n用户画像: " + ", ".join(ctx_parts)

        # 构造推荐内容描述
        items_desc = []
        netease = result_items.get("netease_items", []) if isinstance(result_items, dict) else []
        ximalaya = result_items.get("ximalaya_items", []) if isinstance(result_items, dict) else []
        for item in (netease or [])[:8]:
            items_desc.append(f"[网易云] {item.get('title', '?')} - {item.get('artist', '?')}")
        for item in (ximalaya or [])[:8]:
            items_desc.append(f"[喜马拉雅] {item.get('title', '?')}")

        if not items_desc:
            return MetricResult(name=self.name, score=-1, reason="推荐列表为空", is_successful=False)

        eval_output = "推荐内容:\n" + "\n".join(items_desc)

        # 调用 LLM Judge
        from metrics.llm_metrics import _call_judge
        score, reason = await _call_judge(RUBRIC_RESULT_QUALITY, eval_input, eval_output, use_thinking=use_thinking)

        return MetricResult(
            name=self.name,
            score=score,
            reason=reason,
            threshold=self.threshold,
            is_successful=score >= self.threshold * 10,
        )
