# -*- coding: utf-8 -*-
"""评测运行器

编排完整评测流程：
1. 创建 eval_run 记录
2. 注入 cases（通过 WebSocket 或直接评分已有 traces）
3. 等待 traces 回收
4. 逐条评分
5. 写入 eval_scores
6. 更新 eval_run 状态
"""

import asyncio
import logging
import uuid
from datetime import datetime, timezone

from db import (
    get_db, insert_eval_run, update_eval_run,
    insert_eval_score, get_scores_by_run,
    list_traces,
)
from eval.eval_scorer import score_trace
from trace.trace_parser import parse_trace

logger = logging.getLogger(__name__)


async def run_eval_on_existing_traces(
    trace_ids: list[str] | None = None,
    case_contexts: dict[str, dict] | None = None,
    skip_llm: bool = False,
    prompt_fingerprint: str = "",
    use_thinking: bool = False,
) -> str:
    """对已收集的 traces 执行评分（不需要注入，不需要车端）。

    这是最常用的模式：traces 已经通过车端上报，我们直接评分。

    Args:
        trace_ids: 要评分的 trace_id 列表。None = 评分所有未评分的
        case_contexts: {trace_id: case_context} 映射
        skip_llm: 是否跳过 LLM 评分
        prompt_fingerprint: 评测关联的 prompt 版本指纹

    Returns:
        run_id
    """
    run_id = f"run_{datetime.now(tz=timezone.utc).strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:6]}"
    case_contexts = case_contexts or {}

    db = await get_db()
    try:
        # 获取要评分的 traces
        if trace_ids:
            traces = []
            for tid in trace_ids:
                cursor = await db.execute("SELECT * FROM traces WHERE trace_id = ?", (tid,))
                row = await cursor.fetchone()
                if row:
                    traces.append(dict(row))
        else:
            # 获取所有未参与过评测的 traces（不在 eval_scores 中的）
            cursor = await db.execute("""
                SELECT t.* FROM traces t
                LEFT JOIN eval_scores es ON t.trace_id = es.trace_id
                WHERE es.trace_id IS NULL
                ORDER BY t.created_at DESC
                LIMIT 100
            """)
            traces = [dict(r) for r in await cursor.fetchall()]

        if not traces:
            logger.warning("没有可评分的 traces")
            return run_id

        # 创建 eval_run
        await insert_eval_run(db, {
            "run_id": run_id,
            "timestamp": datetime.now(tz=timezone.utc).isoformat(),
            "prompt_fingerprint": prompt_fingerprint or (traces[0].get("prompt_fingerprint", "") if traces else ""),
            "case_count": len(traces),
            "status": "running",
        })

        logger.info(f"开始评测 run={run_id}, traces={len(traces)}, skip_llm={skip_llm}, use_thinking={use_thinking}")

        # 逐条评分
        scored = 0
        total_soft = 0.0
        soft_count = 0

        for i, trace_row in enumerate(traces):
            trace_id = trace_row["trace_id"]
            try:
                # 从 DB row 构造 parsed_trace 供 scorer 使用
                import json
                parsed = {
                    "trace_id": trace_id,
                    "timestamp": trace_row.get("timestamp", 0),
                    "mode": trace_row.get("mode", ""),
                    "user_text": trace_row.get("user_text", ""),
                    "tool_calls": json.loads(trace_row["tool_calls"]) if trace_row.get("tool_calls") else [],
                    "latency_ms": trace_row.get("latency_ms", 0),
                    "error": None,
                    "actions": [],
                    "ui_state": {"page": 0, "page_name": "", "qq_cards": [], "xm_cards": []},
                    "prompt_fingerprint": trace_row.get("prompt_fingerprint", ""),
                }

                case_ctx = case_contexts.get(trace_id)
                result = await score_trace(parsed, case_context=case_ctx, skip_llm=skip_llm, use_thinking=use_thinking)

                # 写入 DB
                d = result.to_db_dict(run_id=run_id, case_id=trace_row.get("case_id", ""))
                await insert_eval_score(db, d)

                scored += 1
                avg = result.avg_soft_score()
                if avg >= 0:
                    total_soft += avg
                    soft_count += 1

                logger.info(
                    f"  [{i+1}/{len(traces)}] {trace_id}: "
                    f"format={result.format_score} play={result.playability_score} "
                    f"hard_pass={result.hard_pass}"
                )

            except Exception as e:
                logger.error(f"  [{i+1}/{len(traces)}] {trace_id} 评分失败: {e}")

        # 更新 eval_run
        avg_score = (total_soft / soft_count) if soft_count > 0 else None
        await update_eval_run(db, run_id,
            status="completed",
            avg_score=avg_score,
            case_count=scored,
        )

        logger.info(f"评测完成 run={run_id}, scored={scored}/{len(traces)}, avg_soft={avg_score}")
        return run_id

    except Exception as e:
        logger.error(f"评测失败 run={run_id}: {e}")
        try:
            await update_eval_run(db, run_id, status="failed")
        except Exception:
            pass
        raise
    finally:
        await db.close()
