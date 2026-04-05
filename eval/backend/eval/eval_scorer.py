# -*- coding: utf-8 -*-
"""8 维评分执行器 (v2.0)

串联全部 metrics 对一条 parsed trace 跑完整评分：
- L1 硬约束 (2): 格式正确性、可执行性
- L2 规则匹配 (1): Golden Answer
- L3 LLM 评分 (4+1): 关键因素、偏好匹配、场景契合、操作逻辑 + 结果质量(条件)
"""

import asyncio
from dataclasses import dataclass, field

from metrics import get_hard_metrics, get_llm_metrics
from metrics.base import MetricResult


@dataclass
class ScoreResult:
    """完整 8 维评分结果"""
    trace_id: str
    # L1 硬约束 (0 或 1)
    format_score: float
    playability_score: float  # 保留兼容旧数据
    executability_score: float  # v2.0 重命名
    # L2 规则匹配 (0-10, -1=未标注)
    golden_score: float
    # L3 LLM 评分 (0-10)
    key_factor_score: float
    preference_score: float
    scene_score: float
    action_logic_score: float
    result_quality_score: float  # -1=非推荐场景
    # 元数据
    latency_ms: int
    hard_pass: bool
    reasoning: dict = field(default_factory=dict)

    def avg_soft_score(self) -> float:
        """软约束平均分（排除 -1 的 N/A 维度）"""
        scores = [self.key_factor_score, self.preference_score,
                  self.scene_score, self.action_logic_score,
                  self.golden_score, self.result_quality_score]
        valid = [s for s in scores if s >= 0]
        return sum(valid) / len(valid) if valid else 0.0

    def to_db_dict(self, run_id: str = "", case_id: str = "") -> dict:
        return {
            "run_id": run_id,
            "trace_id": self.trace_id,
            "case_id": case_id,
            "format_score": self.format_score,
            "playability_score": self.playability_score,
            "executability_score": self.executability_score,
            "golden_score": self.golden_score,
            "key_factor_score": self.key_factor_score,
            "preference_score": self.preference_score,
            "scene_score": self.scene_score,
            "action_logic_score": self.action_logic_score,
            "result_quality_score": self.result_quality_score,
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
    executability_result = hard_results[1]
    hard_pass = all(r.is_successful for r in hard_results)

    # ── L2: Golden Answer (规则匹配) ──
    golden_score = -1.0
    try:
        from metrics.golden_metric import GoldenAnswerMetric
        golden_metric = GoldenAnswerMetric()
        golden_result = await golden_metric.measure(parsed_trace, case_context)
        golden_score = golden_result.score
        reasoning[golden_result.name] = golden_result.reason
    except Exception as e:
        reasoning["Golden Answer"] = f"评分出错: {e}"

    # ── L3: LLM 软约束 ──
    result_quality_score = -1.0
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

        # 结果质量 metric (条件触发)
        try:
            from metrics.result_quality_metric import ResultQualityMetric
            rq_metric = ResultQualityMetric()
            rq_result = await rq_metric.measure(parsed_trace, case_context, use_thinking=use_thinking)
            result_quality_score = rq_result.score
            reasoning[rq_result.name] = rq_result.reason
        except Exception as e:
            reasoning["结果质量"] = f"评分出错: {e}"

        # 4 个 LLM 评测并发执行
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

    exec_score = executability_result.score
    return ScoreResult(
        trace_id=parsed_trace["trace_id"],
        format_score=format_result.score,
        playability_score=exec_score,  # 兼容旧数据
        executability_score=exec_score,
        golden_score=golden_score,
        key_factor_score=llm_scores["key_factor_score"],
        preference_score=llm_scores["preference_score"],
        scene_score=llm_scores["scene_score"],
        action_logic_score=llm_scores["action_logic_score"],
        result_quality_score=result_quality_score,
        latency_ms=parsed_trace.get("latency_ms", 0),
        hard_pass=hard_pass,
        reasoning=reasoning,
    )
