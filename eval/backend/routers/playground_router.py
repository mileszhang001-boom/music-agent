# -*- coding: utf-8 -*-
"""Playground 路由

POST /api/eval/playground — 模拟输入 → LLM 响应 → 实时评分
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from playground.playground_service import run_playground

router = APIRouter(prefix="/api/eval", tags=["playground"])


class PlaygroundRequest(BaseModel):
    query: str
    current_page: int = 0
    qq_cards: list[str] | None = None
    xm_cards: list[str] | None = None
    user_preference: str = ""
    scene: str = ""
    passenger: str = ""
    time_period: str = ""
    skip_llm_judge: bool = False
    use_thinking: bool = False  # 深度思考模式


@router.post("/playground")
async def playground(req: PlaygroundRequest):
    """模拟输入 → LLM tool_calls → 6 维评分"""
    try:
        result = await run_playground(
            query=req.query,
            current_page=req.current_page,
            qq_cards=req.qq_cards,
            xm_cards=req.xm_cards,
            user_preference=req.user_preference,
            scene=req.scene,
            passenger=req.passenger,
            time_period=req.time_period,
            skip_llm_judge=req.skip_llm_judge,
            use_thinking=req.use_thinking,
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
