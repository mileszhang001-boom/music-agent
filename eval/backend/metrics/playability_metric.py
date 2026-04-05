# -*- coding: utf-8 -*-
"""Metric ② — 可执行性（硬约束）

检查 tool_calls 中的参数值是否合法可执行：
- page_index 在 0-3 范围
- card_names 中的卡片在对应页面的合法池中
- tool 与 arguments 的交叉一致性（QQ tool 不应选喜马卡片）
"""

from metrics.base import BaseMetric, MetricResult
from config import (
    VALID_PAGE_INDICES,
    QQ_CARD_SET,
    XIMALAYA_CARD_SET,
    QQ_CARDS,
    XIMALAYA_CARDS,
)


class ExecutabilityMetric(BaseMetric):
    name = "可执行性"
    threshold = 1.0

    async def measure(self, parsed_trace: dict, case_context: dict | None = None) -> MetricResult:
        errors = []
        warnings = []
        tool_calls = parsed_trace.get("tool_calls", [])

        if not tool_calls:
            # 格式 metric 会捕获空 list，这里给个中性结果
            return MetricResult(
                name=self.name, score=0.0,
                reason="无 tool_calls 可检查",
                threshold=self.threshold, is_successful=False,
            )

        checks_total = 0
        checks_passed = 0

        for i, tc in enumerate(tool_calls):
            fn = tc.get("function", "")
            args = tc.get("arguments", {})
            prefix = f"tool_calls[{i}]({fn})"

            # ── switch_recommend_page ──
            if fn == "switch_recommend_page":
                checks_total += 1
                page_idx = args.get("page_index")
                if page_idx is None:
                    errors.append(f"{prefix}: 缺少 page_index")
                elif not isinstance(page_idx, (int, float)):
                    errors.append(f"{prefix}: page_index 不是数字: {page_idx}")
                elif int(page_idx) not in VALID_PAGE_INDICES:
                    errors.append(f"{prefix}: page_index={page_idx} 不在合法范围 0-3")
                else:
                    checks_passed += 1

            # ── switch_recommend_qq_cards ──
            elif fn == "switch_recommend_qq_cards":
                card_names = args.get("card_names", [])
                if isinstance(card_names, str):
                    card_names = [c.strip() for c in card_names.split(",") if c.strip()]

                if not card_names:
                    checks_total += 1
                    errors.append(f"{prefix}: card_names 为空")
                else:
                    for card in card_names:
                        checks_total += 1
                        if card in QQ_CARD_SET:
                            checks_passed += 1
                        elif card in XIMALAYA_CARD_SET:
                            errors.append(f"{prefix}: '{card}' 是喜马卡片，不应出现在 QQ tool 中")
                        else:
                            errors.append(f"{prefix}: '{card}' 不在 QQ 合法卡片池中")

            # ── switch_recommend_ximalaya_cards ──
            elif fn == "switch_recommend_ximalaya_cards":
                card_names = args.get("card_names", [])
                if isinstance(card_names, str):
                    card_names = [c.strip() for c in card_names.split(",") if c.strip()]

                if not card_names:
                    checks_total += 1
                    errors.append(f"{prefix}: card_names 为空")
                else:
                    for card in card_names:
                        checks_total += 1
                        if card in XIMALAYA_CARD_SET:
                            checks_passed += 1
                        elif card in QQ_CARD_SET:
                            errors.append(f"{prefix}: '{card}' 是 QQ 卡片，不应出现在喜马 tool 中")
                        else:
                            errors.append(f"{prefix}: '{card}' 不在喜马合法卡片池中")

            # ── query_ai_recommend ──
            elif fn == "query_ai_recommend":
                checks_total += 1
                checks_passed += 1  # 参数灵活，只要 function name 合法即可

        if checks_total == 0:
            return MetricResult(
                name=self.name, score=1.0,
                reason="无需参数校验的 tool 调用",
                threshold=self.threshold, is_successful=True,
            )

        score = checks_passed / checks_total
        passed = score >= self.threshold

        if errors:
            reason = f"通过 {checks_passed}/{checks_total} 项检查。问题: " + "; ".join(errors)
        else:
            reason = f"全部 {checks_total} 项参数检查通过"

        return MetricResult(
            name=self.name,
            score=score,
            reason=reason,
            threshold=self.threshold,
            is_successful=passed,
        )
