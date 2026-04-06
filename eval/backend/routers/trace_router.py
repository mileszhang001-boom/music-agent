# -*- coding: utf-8 -*-
"""Trace 接收与查询路由

POST /api/eval/trace  — 接收车端 Trace，自动触发评分（带并发控制）
GET  /api/eval/traces — Trace 列表（含评分摘要）
GET  /api/eval/traces/{trace_id} — Trace 详情（含完整评分）
GET  /api/eval/traces/{trace_id}/raw — 原始 JSON
"""

import asyncio
import json
import logging
import re
import time
from fastapi import APIRouter, HTTPException, Request

from db import (
    get_db, insert_trace, get_trace, count_traces,
    list_traces_with_scores, get_scores_by_trace, insert_eval_score,
)
from trace.trace_parser import parse_trace
from trace.trace_store import save_raw_trace, save_parsed_trace, load_raw_trace
from eval.eval_scorer import score_trace

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/eval", tags=["trace"])

# ── 并发控制 ──
_scoring_semaphore = asyncio.Semaphore(2)  # 最多 2 个并发评分
_scoring_queue: set[str] = set()  # 正在评分的 trace_id
_last_score_time: float = 0  # 上次评分时间，用于速率限制

# 内存中维护的 session→case 映射
_session_case_map: dict[str, str] = {}


def register_session_case(session_id: str, case_id: str):
    _session_case_map[session_id] = case_id


def _extract_case_id(raw_trace: dict, parsed: dict) -> str | None:
    session_id = raw_trace.get("session_id", "")
    if session_id and session_id in _session_case_map:
        return _session_case_map.pop(session_id)
    for text in [parsed.get("user_message", ""), parsed.get("user_text", "")]:
        match = re.search(r"eval_(C\d+)_", text)
        if match:
            return match.group(1)
    return None


async def _auto_score_trace(parsed: dict, case_id: str | None):
    """后台异步评分一条 trace（带并发控制 + 防重复）"""
    trace_id = parsed["trace_id"]

    # 防重复
    if trace_id in _scoring_queue:
        return
    _scoring_queue.add(trace_id)

    try:
        async with _scoring_semaphore:
            # 速率限制：两次评分间至少间隔 1 秒
            global _last_score_time
            now = time.time()
            if now - _last_score_time < 1.0:
                await asyncio.sleep(1.0 - (now - _last_score_time))
            _last_score_time = time.time()

            # 检查是否已评分（DB 去重）
            db = await get_db()
            try:
                existing = await get_scores_by_trace(db, trace_id)
                if existing:
                    logger.info(f"跳过已评分: {trace_id}")
                    return

                # 如果有 case_id，加载 case_context 用于 Golden Answer 评分
                case_context = None
                if case_id:
                    try:
                        from cases.bitable_client import BitableCaseManager
                        mgr = BitableCaseManager()
                        eval_cases = mgr.load_test_cases_for_eval()
                        matched = [c for c in eval_cases if c.get("case_id") == case_id]
                        if matched:
                            case_context = mgr.case_to_eval_context(matched[0])
                    except Exception as ctx_err:
                        logger.warning(f"加载 case_context 失败: {ctx_err}")

                result = await score_trace(parsed, case_context=case_context, skip_llm=False)
                d = result.to_db_dict(run_id=f"auto_{trace_id}", case_id=case_id or "")
                await insert_eval_score(db, d)
                logger.info(f"自动评分完成: {trace_id} format={result.format_score} hard={result.hard_pass}")
            finally:
                await db.close()
    except Exception as e:
        logger.error(f"自动评分失败: {trace_id} {e}")
    finally:
        _scoring_queue.discard(trace_id)


@router.post("/trace")
async def receive_trace(request: Request):
    """接收车端 Trace，存储后自动触发评分"""
    body = await request.json()
    traces = body if isinstance(body, list) else [body]

    received = []
    errors = []
    score_tasks = []
    db = await get_db()
    try:
        for raw_trace in traces:
            trace_id = raw_trace.get("traceId")
            if not trace_id:
                errors.append("缺少 traceId")
                continue
            if not raw_trace.get("nodes"):
                errors.append(f"{trace_id}: 缺少 nodes")
                continue
            try:
                # 检查是否已存在（去重，避免重复评分）
                existing = await get_trace(db, trace_id)
                if existing:
                    received.append(trace_id)  # 幂等返回成功
                    continue  # 跳过存储和评分

                parsed = parse_trace(raw_trace)
                case_id = _extract_case_id(raw_trace, parsed)
                save_raw_trace(raw_trace)
                save_parsed_trace(parsed)
                await insert_trace(db, parsed, case_id)
                received.append(trace_id)
                # 仅新 trace 才触发评分
                score_tasks.append((parsed, case_id))
            except Exception as e:
                errors.append(f"{trace_id}: {str(e)}")
    finally:
        await db.close()

    # 启动异步评分（有并发控制，不会同时跑太多）
    for parsed, case_id in score_tasks:
        asyncio.create_task(_auto_score_trace(parsed, case_id))

    if not received and errors:
        raise HTTPException(status_code=400, detail={"status": "error", "message": "; ".join(errors)})

    return {
        "status": "ok",
        "trace_ids": received,
        "received": len(received),
        "errors": errors if errors else None,
    }


def _enrich_list_item(item: dict) -> dict:
    """列表项：从 parsed_json 补充摘要字段"""
    if item.get("tool_calls"):
        try:
            item["tool_calls"] = json.loads(item["tool_calls"])
        except (json.JSONDecodeError, TypeError):
            pass
    pj = item.pop("parsed_json", None)
    if pj:
        try:
            parsed = json.loads(pj)
            item["model"] = parsed.get("model", item.get("model", ""))
            usage = parsed.get("usage", {})
            item["total_tokens"] = usage.get("total_tokens", 0)
            ri = parsed.get("result_items")
            item["has_result"] = bool(ri)
            item["result_total"] = ri.get("total_items", 0) if ri else 0
        except (json.JSONDecodeError, TypeError):
            pass

    # 评分摘要
    fmt = item.get("format_score")
    play = item.get("playability_score")
    if fmt is not None:
        item["scored"] = True
        item["hard_pass"] = (fmt >= 1.0) and (play is not None and play >= 1.0)
        soft_dims = [item.get(k) for k in ["key_factor_score", "preference_score", "scene_score", "action_logic_score"]]
        valid = [s for s in soft_dims if s is not None and s >= 0]
        item["soft_avg"] = round(sum(valid) / len(valid), 1) if valid else None
    else:
        item["scored"] = False
        item["hard_pass"] = None
        item["soft_avg"] = None

    return item


@router.get("/traces")
async def query_traces(limit: int = 50, offset: int = 0):
    db = await get_db()
    try:
        total = await count_traces(db)
        items = await list_traces_with_scores(db, limit=limit, offset=offset)
        items = [_enrich_list_item(item) for item in items]
        return {"total": total, "items": items, "limit": limit, "offset": offset}
    finally:
        await db.close()


@router.get("/traces/{trace_id}")
async def query_trace_detail(trace_id: str):
    db = await get_db()
    try:
        item = await get_trace(db, trace_id)
        if not item:
            raise HTTPException(status_code=404, detail="Trace not found")

        result = {}
        pj = item.get("parsed_json")
        if pj:
            try:
                result = json.loads(pj)
                result["case_id"] = item.get("case_id")
                result["created_at"] = item.get("created_at")
            except (json.JSONDecodeError, TypeError):
                result = item
        else:
            result = item
            if result.get("tool_calls"):
                try:
                    result["tool_calls"] = json.loads(result["tool_calls"])
                except:
                    pass

        score = await get_scores_by_trace(db, trace_id)
        if score:
            if score.get("reasoning"):
                try:
                    score["reasoning"] = json.loads(score["reasoning"])
                except (json.JSONDecodeError, TypeError):
                    pass
            result["score"] = score
        else:
            result["score"] = None

        return result
    finally:
        await db.close()


@router.get("/traces/{trace_id}/raw")
async def query_trace_raw(trace_id: str):
    db = await get_db()
    try:
        item = await get_trace(db, trace_id)
        if not item:
            raise HTTPException(status_code=404, detail="Trace not found")
        raw = load_raw_trace(trace_id, item.get("timestamp", 0))
        if raw:
            return raw
        raise HTTPException(status_code=404, detail="原始 JSON 文件未找到")
    finally:
        await db.close()
