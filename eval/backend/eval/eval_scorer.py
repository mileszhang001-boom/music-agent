# -*- coding: utf-8 -*-
"""6 维评分执行器

串联全部 6 个 metrics（2 硬 + 4 软），对一条 parsed trace 跑完整评分。
硬约束不通过时，软约束仍然执行（提供参考分），但标记硬约束失败。
"""

import asyncio
from dataclasses import dataclass

from metrics import get_hard_metrics, get_llm_metrics
from metrics.base import MetricResult


@dataclass
class ScoreResult:
    """完整 6 维评分结果"""
    trace_id: str
    # 硬约束 (0 或 1)
    format_score: float
    playability_score: float
    # 软约束 (0-10)
    key_factor_score: float
    preference_score: float
    scene_score: float
    action_logic_score: float
    # 元数据
    latency_ms: int
    hard_pass: bool  # 硬约束是否全部通过
    reasoning: dict  # 各维度评分理由

    def avg_soft_score(self) -> float:
        """软约束平均分"""
        scores = [self.key_factor_score, self.preference_score,
                  self.scene_score, self.action_logic_score]
        valid = [s for s in scores if s >= 0]
        return sum(valid) / len(valid) if valid else 0.0

    def to_db_dict(self, run_id: str = "", case_id: str = "") -> dict:
        """转为 db.insert_eval_score 所需的 dict"""
        return {
            "run_id": run_id,
            "trace_id": self.trace_id,
            "case_id": case_id,
            "format_score": self.format_score,
            "playability_score": self.playability_score,
            "key_factor_score": self.key_factor_score,
            "preference_score": self.preference_score,
            "scene_score": self.scene_score,
            "action_logic_score": self.action_logic_score,
            "latency_ms": self.latency_ms,
            "reasoning": self.reasoning,
        }


async def score_trace(
    parsed_trace: dict,
    case_context: dict | None = None,
    skip_llm: bool = False,
    use_thinking: bool = False,
) -> ScoreResult:
    """对一条 parsed trace 执行完整 6 维评分。

    Args:
        parsed_trace: trace_parser.parse_trace() 的输出
        case_context: 关联的 Case 上下文，可为 None
        skip_llm: 是否跳过 LLM 评分（仅跑硬约束），用于快速调试
        use_thinking: 启用深度思考模式，评分更精准但延迟更高

    Returns:
        ScoreResult
    """
    reasoning = {}

    # ── 硬约束 ──
    hard_metrics = get_hard_metrics()
    hard_results: list[MetricResult] = []
    for m in hard_metrics:
        result = await m.measure(parsed_trace, case_context)
        hard_results.append(result)
        reasoning[result.name] = result.reason

    format_result = hard_results[0]
    playability_result = hard_results[1]
    hard_pass = all(r.is_successful for r in hard_results)

    # ── 软约束 ──
    if skip_llm:
        llm_scores = {
            "key_factor_score": -1.0,
            "preference_score": -1.0,
            "scene_score": -1.0,
            "action_logic_score": -1.0,
        }
        for name in ["关键因素捕获", "用户偏好匹配", "场景契合度", "操作逻辑性"]:
            reasoning[name] = "已跳过 LLM 评分"
    else:
        llm_metrics = get_llm_metrics()
        # 并发执行 4 个 LLM 评测
        llm_results = await asyncio.gather(
            *[m.measure(parsed_trace, case_context, use_thinking=use_thinking) for m in llm_metrics],
            return_exceptions=True,
        )

        llm_score_map = {}
        score_keys = ["key_factor_score", "preference_score", "scene_score", "action_logic_score"]

        for i, (result, key) in enumerate(zip(llm_results, score_keys)):
            if isinstance(result, Exception):
                llm_score_map[key] = -1.0
                reasoning[llm_metrics[i].name] = f"评分出错: {str(result)}"
            else:
                llm_score_map[key] = result.score
                reasoning[result.name] = result.reason

        llm_scores = llm_score_map

    return ScoreResult(
        trace_id=parsed_trace["trace_id"],
        format_score=format_result.score,
        playability_score=playability_result.score,
        key_factor_score=llm_scores["key_factor_score"],
        preference_score=llm_scores["preference_score"],
        scene_score=llm_scores["scene_score"],
        action_logic_score=llm_scores["action_logic_score"],
        latency_ms=parsed_trace.get("latency_ms", 0),
        hard_pass=hard_pass,
        reasoning=reasoning,
    )
