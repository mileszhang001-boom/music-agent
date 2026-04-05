# -*- coding: utf-8 -*-
"""Playground 服务

直接调用 LLM（使用与车端相同的 prompt + tools），
构造 synthetic trace，然后跑 6 维评分。

从 prompt_config_manager 读取当前激活的配置，
确保 Playground 与车端使用完全相同的 prompt。
"""

import json
import time
import hashlib
import uuid
import httpx

from config import DEEPSEEK_API_KEY, DEEPSEEK_API_BASE, PAGES
from prompt.prompt_config_manager import get_current_config
from eval.eval_scorer import score_trace


def _get_active_config() -> dict:
    """获取当前激活的 recommend 配置"""
    cfg = get_current_config()
    return cfg.get("recommend", cfg)


def _build_tools_for_api(rec: dict) -> list[dict]:
    """从 recommend 配置构建 OpenAI function calling 格式的 tools"""
    tools_cfg = rec.get("tools", {})
    qq_cards = rec.get("qq_cards", {})
    xm_cards = rec.get("xm_cards", {})

    # 构建卡片名称列表（用于替换占位符）
    qq_names = "/".join(c["displayName"] for c in qq_cards.values())
    xm_names = ", ".join(c["displayName"] for c in xm_cards.values())

    tools = []

    # switch_recommend_page
    t = tools_cfg.get("switch_recommend_page", {})
    tools.append({
        "type": "function",
        "function": {
            "name": "switch_recommend_page",
            "description": t.get("description", "切换推荐卡当前展示的页面"),
            "parameters": {
                "type": "object",
                "properties": {
                    "page_index": {
                        "type": "integer",
                        "description": t.get("params", {}).get("page_index", "页面索引"),
                        "enum": [0, 1, 2, 3]
                    }
                },
                "required": ["page_index"]
            }
        }
    })

    # switch_recommend_qq_cards
    t = tools_cfg.get("switch_recommend_qq_cards", {})
    desc = t.get("description", "").replace("{qq_card_names}", qq_names)
    tools.append({
        "type": "function",
        "function": {
            "name": "switch_recommend_qq_cards",
            "description": desc,
            "parameters": {
                "type": "object",
                "properties": {
                    "card_names": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": t.get("params", {}).get("card_names", "卡片名称列表")
                    }
                },
                "required": ["card_names"]
            }
        }
    })

    # switch_recommend_ximalaya_cards
    t = tools_cfg.get("switch_recommend_ximalaya_cards", {})
    desc = t.get("description", "").replace("{xm_card_names}", xm_names)
    tools.append({
        "type": "function",
        "function": {
            "name": "switch_recommend_ximalaya_cards",
            "description": desc,
            "parameters": {
                "type": "object",
                "properties": {
                    "card_names": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": t.get("params", {}).get("card_names", "卡片名称列表")
                    }
                },
                "required": ["card_names"]
            }
        }
    })

    # query_ai_recommend
    t = tools_cfg.get("query_ai_recommend", {})
    tools.append({
        "type": "function",
        "function": {
            "name": "query_ai_recommend",
            "description": t.get("description", "AI综合推荐"),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": t.get("params", {}).get("query", "自然语言描述")
                    }
                },
                "required": ["query"]
            }
        }
    })

    return tools


def _build_user_message(
    query: str,
    current_page: int = 0,
    qq_cards: list[str] | None = None,
    xm_cards: list[str] | None = None,
    user_preference: str = "",
    rec: dict | None = None,
) -> str:
    """组装 user_message，与车端格式一致"""
    pages_cfg = (rec or {}).get("pages", {})
    page_name = pages_cfg.get(str(current_page), {}).get("name", PAGES.get(current_page, "未知"))
    qq = qq_cards or []
    xm = xm_cards or ["热门播客", "每日新闻", "相声小品", "热门有声书"]

    state = f"[当前正在{page_name}页面，喜马拉雅当前卡片({', '.join(xm)})，QQ音乐当前{len(qq)}个卡片({', '.join(qq)})]"
    text = query
    if user_preference:
        text += f"（用户偏好：{user_preference}）"
    return f"{state} {text}"


async def run_playground(
    query: str,
    current_page: int = 0,
    qq_cards: list[str] | None = None,
    xm_cards: list[str] | None = None,
    user_preference: str = "",
    scene: str = "",
    passenger: str = "",
    time_period: str = "",
    skip_llm_judge: bool = False,
    use_thinking: bool = False,
) -> dict:
    """执行 Playground：读取当前配置 → LLM 调用 → 构造 trace → 评分"""

    rec = _get_active_config()
    system_prompt = rec.get("system_prompt", "")
    tools = _build_tools_for_api(rec)
    user_message = _build_user_message(query, current_page, qq_cards, xm_cards, user_preference, rec)

    # ── 1. 调用 LLM ──
    url = f"{DEEPSEEK_API_BASE.rstrip('/')}/chat/completions"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {DEEPSEEK_API_KEY}",
    }
    payload = {
        "model": "deepseek-chat",
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message},
        ],
        "tools": tools,
        "tool_choice": "required",
        "temperature": 0.3,
        "max_tokens": 500,
    }

    start = time.time()
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(url, headers=headers, json=payload)
        resp.raise_for_status()
        data = resp.json()
    latency_ms = int((time.time() - start) * 1000)

    # ── 2. 解析 tool_calls ──
    choice = data["choices"][0]["message"]
    raw_tool_calls = choice.get("tool_calls", [])
    tool_calls = []
    for tc in raw_tool_calls:
        fn = tc.get("function", {})
        args = fn.get("arguments", "{}")
        if isinstance(args, str):
            try:
                args = json.loads(args)
            except json.JSONDecodeError:
                args = {}
        tool_calls.append({"function": fn.get("name", ""), "arguments": args})

    # ── 3. 构造 synthetic parsed_trace ──
    trace_id = f"playground_{uuid.uuid4().hex[:8]}"
    prompt_fp = hashlib.md5(system_prompt.encode()).hexdigest()[:8]

    parsed_trace = {
        "trace_id": trace_id,
        "timestamp": int(time.time() * 1000),
        "mode": "playground",
        "user_text": query,
        "ui_state": {
            "page": current_page,
            "page_name": PAGES.get(current_page, ""),
            "qq_cards": qq_cards or [],
            "xm_cards": xm_cards or ["热门播客", "每日新闻", "相声小品", "热门有声书"],
        },
        "tool_calls": tool_calls,
        "latency_ms": latency_ms,
        "error": None,
        "actions": [],
        "prompt_fingerprint": prompt_fp,
        "system_prompt": system_prompt,
        "user_message": user_message,
        "tools_def": "",
    }

    # ── 4. 评分 ──
    case_context = {}
    if user_preference:
        case_context["偏好风格"] = user_preference
    if scene:
        case_context["活动场景"] = scene
    if passenger:
        case_context["乘客"] = passenger
    if time_period:
        case_context["时间段"] = time_period

    result = await score_trace(
        parsed_trace,
        case_context=case_context if case_context else None,
        skip_llm=skip_llm_judge,
        use_thinking=use_thinking,
    )

    return {
        "trace_id": trace_id,
        "tool_calls": tool_calls,
        "latency_ms": latency_ms,
        "scores": {
            "format_score": result.format_score,
            "playability_score": result.playability_score,
            "key_factor_score": result.key_factor_score,
            "preference_score": result.preference_score,
            "scene_score": result.scene_score,
            "action_logic_score": result.action_logic_score,
        },
        "hard_pass": result.hard_pass,
        "reasoning": result.reasoning,
        "user_message": user_message,
        "model": "deepseek-chat",
    }
