# -*- coding: utf-8 -*-
"""Golden Answer 匹配 — 规则匹配评测

将 AI 实际操作与专家标注的参考答案对比：
- required_actions: 必须执行的操作，缺失则扣分
- acceptable_variants: 可接受的替代操作，命中则加分

评分公式: score = (required_match_rate * 0.6 + variant_match_rate * 0.4) * 10
"""

import json

from metrics.base import BaseMetric, MetricResult


class GoldenAnswerMetric(BaseMetric):
    name = "Golden Answer"
    threshold = 0.5

    async def measure(self, parsed_trace: dict, case_context: dict | None = None, **kwargs) -> MetricResult:
        if not case_context:
            return MetricResult(name=self.name, score=-1, reason="无 Case 上下文", is_successful=False)

        raw_required = case_context.get("required_actions", "[]")
        raw_variants = case_context.get("acceptable_variants", "[]")

        required = json.loads(raw_required) if isinstance(raw_required, str) else (raw_required or [])
        variants = json.loads(raw_variants) if isinstance(raw_variants, str) else (raw_variants or [])

        if not required and not variants:
            return MetricResult(name=self.name, score=-1, reason="未标注 Golden Answer", is_successful=False)

        tool_calls = parsed_trace.get("tool_calls", [])

        # 匹配 required_actions
        req_hits, req_misses = [], []
        for req in required:
            if _match_action(req, tool_calls):
                req_hits.append(req)
            else:
                req_misses.append(req)

        # 匹配 acceptable_variants
        var_hits = [v for v in variants if _match_action(v, tool_calls)]

        # 计算分数
        req_rate = len(req_hits) / len(required) if required else 1.0
        var_rate = len(var_hits) / len(variants) if variants else 0.0
        score = round((req_rate * 0.6 + var_rate * 0.4) * 10, 1)

        # 构建理由
        parts = []
        if req_hits:
            parts.append(f"命中必要操作 {len(req_hits)}/{len(required)}")
        if req_misses:
            tools = [m.get("tool", "?") for m in req_misses]
            parts.append(f"缺失: {', '.join(tools)}")
        if var_hits:
            parts.append(f"命中替代操作 {len(var_hits)}/{len(variants)}")
        reason = "; ".join(parts) if parts else "无匹配信息"

        return MetricResult(
            name=self.name,
            score=score,
            reason=reason,
            threshold=self.threshold,
            is_successful=score >= self.threshold * 10,
        )


def _match_action(expected: dict, actual_calls: list[dict]) -> bool:
    """匹配一个 expected action 是否在 actual_calls 中命中。

    匹配规则:
    - tool/function 名完全匹配
    - switch_recommend_page: page_index 精确匹配
    - switch_recommend_qq/ximalaya_cards: expected card_names ⊆ actual card_names
    - query_ai_recommend: tool 名匹配即可
    """
    expected_tool = expected.get("tool", "")
    expected_args = expected.get("args", {})

    for call in actual_calls:
        fn = call.get("function", "") or call.get("tool", "")
        if fn != expected_tool:
            continue

        actual_args = call.get("arguments", {})
        if isinstance(actual_args, str):
            try:
                actual_args = json.loads(actual_args)
            except (json.JSONDecodeError, TypeError):
                actual_args = {}

        # query_ai_recommend: tool 名匹配即可
        if fn == "query_ai_recommend":
            return True

        # switch_recommend_page: page_index 精确匹配
        if fn == "switch_recommend_page":
            if actual_args.get("page_index") == expected_args.get("page_index"):
                return True
            continue

        # card tools: expected cards ⊆ actual cards
        if "card_names" in expected_args:
            actual_cards = set(actual_args.get("card_names", []))
            expected_cards = set(expected_args.get("card_names", []))
            if expected_cards and expected_cards.issubset(actual_cards):
                return True

    return False
