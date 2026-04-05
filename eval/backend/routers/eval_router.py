# -*- coding: utf-8 -*-
"""评测执行与查询路由

POST /api/eval/run              — 触发评测（对已有 traces 评分）
POST /api/eval/inject           — 注入 Case 到车端（走真实链路）
GET  /api/eval/scores/{run_id}  — 查询某次评测的评分结果
GET  /api/eval/history          — 评测历史列表
"""

import asyncio
import json
import logging
from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel

from db import get_db, get_eval_run, list_eval_runs, get_scores_by_run
from eval.eval_runner import run_eval_on_existing_traces
from cases.bitable_client import BitableCaseManager
from cases.case_injector import case_to_ws_message, inject_cases
from routers.trace_router import register_session_case

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/eval", tags=["eval"])


class RunRequest(BaseModel):
    trace_ids: list[str] | None = None
    skip_llm: bool = False
    prompt_fingerprint: str = ""
    use_thinking: bool = False  # 深度思考模式，评分更精准但更慢


@router.post("/run")
async def trigger_eval_run(req: RunRequest):
    """触发一轮评测（对已有 traces 评分）"""
    try:
        run_id = await run_eval_on_existing_traces(
            trace_ids=req.trace_ids,
            skip_llm=req.skip_llm,
            prompt_fingerprint=req.prompt_fingerprint,
            use_thinking=req.use_thinking,
        )
        return {"status": "ok", "run_id": run_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class InjectRequest(BaseModel):
    case_ids: list[str] | None = None  # None = 全部已审核
    room: str = "car_001"
    interval: float = 15.0


@router.post("/inject")
async def inject_cases_to_car(req: InjectRequest):
    """注入 Case 到车端（走真实 WebSocket 链路）

    流程：读 Case → 转 WS 消息 → 注入 relay → 车端收到并处理
    Trace 会由车端 POST 回来，自动评分（改动 1 已实现）
    """
    try:
        mgr = BitableCaseManager()
        all_cases = mgr.load_test_cases_for_eval()

        if not all_cases:
            return {"status": "error", "message": "没有已审核的 Case"}

        # 筛选指定 case_ids
        if req.case_ids:
            cases = [c for c in all_cases if c["case_id"] in req.case_ids]
            if not cases:
                return {"status": "error", "message": f"未找到指定的 Case: {req.case_ids}"}
        else:
            cases = all_cases

        # 注册 session→case 映射（用于 trace 回收时关联）
        sent_records = []
        for case in cases:
            msg = case_to_ws_message(case)
            register_session_case(msg["session_id"], case["case_id"])
            sent_records.append({
                "case_id": case["case_id"],
                "session_id": msg["session_id"],
                "type": msg["type"],
            })

        # 异步注入（不阻塞响应）
        asyncio.create_task(_do_inject(cases, req.room, req.interval))

        return {
            "status": "ok",
            "injected": len(cases),
            "cases": sent_records,
            "room": req.room,
            "message": f"正在注入 {len(cases)} 个 Case 到 {req.room}，间隔 {req.interval}s",
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


async def _do_inject(cases: list[dict], room: str, interval: float):
    """后台执行注入"""
    try:
        records = await inject_cases(cases, room=room, interval=interval)
        logger.info(f"注入完成: {len(records)} 条")
    except Exception as e:
        logger.error(f"注入失败: {e}")


@router.get("/scores/{run_id}")
async def get_run_scores(run_id: str):
    """查询某次评测的详细评分"""
    db = await get_db()
    try:
        run = await get_eval_run(db, run_id)
        if not run:
            raise HTTPException(status_code=404, detail="Eval run not found")

        scores = await get_scores_by_run(db, run_id)

        # 解析 reasoning JSON
        for s in scores:
            if s.get("reasoning"):
                try:
                    s["reasoning"] = json.loads(s["reasoning"])
                except (json.JSONDecodeError, TypeError):
                    pass

        return {
            "run": run,
            "scores": scores,
            "summary": _compute_summary(scores),
        }
    finally:
        await db.close()


@router.get("/history")
async def get_eval_history(limit: int = 50):
    """评测历史列表"""
    db = await get_db()
    try:
        runs = await list_eval_runs(db, limit=limit)
        return {"runs": runs}
    finally:
        await db.close()


@router.get("/auto-scores")
async def get_auto_scores(limit: int = 30):
    """最近自动评分结果（Trace 到达时自动触发的评分）"""
    db = await get_db()
    try:
        cursor = await db.execute("""
            SELECT es.*, t.user_text, t.model
            FROM eval_scores es
            JOIN traces t ON es.trace_id = t.trace_id
            WHERE es.run_id LIKE 'auto_%'
              AND t.user_text != '' AND t.user_text != '{}' AND t.user_text IS NOT NULL
            ORDER BY es.id DESC LIMIT ?
        """, (limit,))
        scores = [dict(r) for r in await cursor.fetchall()]
        for s in scores:
            if s.get("reasoning"):
                try:
                    s["reasoning"] = json.loads(s["reasoning"])
                except (json.JSONDecodeError, TypeError):
                    pass
        # 真实总数 + 全量汇总统计（不受 limit 截断）
        cnt_cursor = await db.execute("""
            SELECT COUNT(*) FROM eval_scores es
            JOIN traces t ON es.trace_id = t.trace_id
            WHERE es.run_id LIKE 'auto_%'
              AND t.user_text != '' AND t.user_text != '{}' AND t.user_text IS NOT NULL
        """)
        real_total = (await cnt_cursor.fetchone())[0]

        # 基于全量数据计算 summary
        summary_cursor = await db.execute("""
            SELECT
                AVG(format_score) as format_avg,
                AVG(playability_score) as play_avg,
                AVG(CASE WHEN key_factor_score >= 0 THEN key_factor_score END) as key_avg,
                AVG(CASE WHEN preference_score >= 0 THEN preference_score END) as pref_avg,
                AVG(CASE WHEN scene_score >= 0 THEN scene_score END) as scene_avg,
                AVG(CASE WHEN action_logic_score >= 0 THEN action_logic_score END) as logic_avg,
                MIN(format_score) as format_min, MAX(format_score) as format_max,
                MIN(playability_score) as play_min, MAX(playability_score) as play_max,
                MIN(CASE WHEN key_factor_score >= 0 THEN key_factor_score END) as key_min,
                MAX(CASE WHEN key_factor_score >= 0 THEN key_factor_score END) as key_max,
                MIN(CASE WHEN preference_score >= 0 THEN preference_score END) as pref_min,
                MAX(CASE WHEN preference_score >= 0 THEN preference_score END) as pref_max,
                MIN(CASE WHEN scene_score >= 0 THEN scene_score END) as scene_min,
                MAX(CASE WHEN scene_score >= 0 THEN scene_score END) as scene_max,
                MIN(CASE WHEN action_logic_score >= 0 THEN action_logic_score END) as logic_min,
                MAX(CASE WHEN action_logic_score >= 0 THEN action_logic_score END) as logic_max,
                SUM(CASE WHEN format_score >= 1.0 THEN 1 ELSE 0 END) as format_pass,
                SUM(CASE WHEN playability_score >= 1.0 THEN 1 ELSE 0 END) as play_pass,
                COUNT(*) as cnt
            FROM eval_scores es
            JOIN traces t ON es.trace_id = t.trace_id
            WHERE es.run_id LIKE 'auto_%'
              AND t.user_text != '' AND t.user_text != '{}' AND t.user_text IS NOT NULL
        """)
        sr = dict(await summary_cursor.fetchone())
        cnt = sr['cnt'] or 1
        full_summary = {
            "format_score": {"avg": round(sr['format_avg'] or 0, 2), "min": sr['format_min'] or 0, "max": sr['format_max'] or 0, "count": cnt},
            "playability_score": {"avg": round(sr['play_avg'] or 0, 2), "min": sr['play_min'] or 0, "max": sr['play_max'] or 0, "count": cnt},
            "key_factor_score": {"avg": round(sr['key_avg'] or 0, 2), "min": sr['key_min'] or 0, "max": sr['key_max'] or 0, "count": cnt},
            "preference_score": {"avg": round(sr['pref_avg'] or 0, 2), "min": sr['pref_min'] or 0, "max": sr['pref_max'] or 0, "count": cnt},
            "scene_score": {"avg": round(sr['scene_avg'] or 0, 2), "min": sr['scene_min'] or 0, "max": sr['scene_max'] or 0, "count": cnt},
            "action_logic_score": {"avg": round(sr['logic_avg'] or 0, 2), "min": sr['logic_min'] or 0, "max": sr['logic_max'] or 0, "count": cnt},
            "hard_pass_rate": {
                "format": round((sr['format_pass'] or 0) / cnt, 2),
                "playability": round((sr['play_pass'] or 0) / cnt, 2),
            },
        }

        return {
            "scores": scores,
            "total": real_total,
            "summary": full_summary,
        }
    finally:
        await db.close()


def _compute_summary(scores: list[dict]) -> dict:
    """计算评分汇总统计"""
    if not scores:
        return {}

    dims = ["format_score", "playability_score", "key_factor_score",
            "preference_score", "scene_score", "action_logic_score"]
    summary = {}
    for dim in dims:
        vals = [s[dim] for s in scores if s.get(dim) is not None and s[dim] >= 0]
        if vals:
            summary[dim] = {
                "avg": round(sum(vals) / len(vals), 2),
                "min": min(vals),
                "max": max(vals),
                "count": len(vals),
            }
    # 硬约束通过率
    format_pass = sum(1 for s in scores if s.get("format_score", 0) >= 1.0)
    play_pass = sum(1 for s in scores if s.get("playability_score", 0) >= 1.0)
    summary["hard_pass_rate"] = {
        "format": round(format_pass / len(scores), 2) if scores else 0,
        "playability": round(play_pass / len(scores), 2) if scores else 0,
    }
    return summary
