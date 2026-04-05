# -*- coding: utf-8 -*-
"""Trace 日志解析器

解析车端上报的 4-node Trace（input → prompt → response → action），
提取评测所需的结构化数据。

难点：tool_calls / tools / actions 字段是字符串化的 JSON 或 Java toString 格式，
例如 {function=switch_recommend_page, arguments={"page_index": 2}}
需要兼容两种格式。
"""

import hashlib
import json
import re
from typing import Any


def parse_card_list(s: str) -> list[str]:
    """解析逗号分隔的卡片名字符串 → 列表"""
    if not s or not s.strip():
        return []
    return [c.strip() for c in s.split(",") if c.strip()]


def _try_json_parse(s: str) -> Any | None:
    """尝试标准 JSON 解析"""
    try:
        return json.loads(s)
    except (json.JSONDecodeError, TypeError):
        return None


def _parse_java_toString_value(s: str) -> Any:
    """解析 Java toString 中的值部分（递归处理嵌套对象）"""
    s = s.strip()
    if s.startswith("{") and s.endswith("}"):
        return _parse_java_toString_object(s)
    if s.startswith("[") and s.endswith("]"):
        return _parse_java_toString_array(s)
    if s.startswith('"') and s.endswith('"'):
        return s[1:-1]
    if s == "null":
        return None
    if s == "true":
        return True
    if s == "false":
        return False
    try:
        return int(s)
    except ValueError:
        pass
    try:
        return float(s)
    except ValueError:
        pass
    return s


def _split_top_level(s: str, delimiter: str = ",") -> list[str]:
    """在顶层按分隔符切分，忽略嵌套的 {} [] "" 内部"""
    parts = []
    depth_brace = 0
    depth_bracket = 0
    in_string = False
    escape = False
    current = []

    for ch in s:
        if escape:
            current.append(ch)
            escape = False
            continue
        if ch == "\\":
            current.append(ch)
            escape = True
            continue
        if ch == '"':
            in_string = not in_string
            current.append(ch)
            continue
        if in_string:
            current.append(ch)
            continue
        if ch == "{":
            depth_brace += 1
        elif ch == "}":
            depth_brace -= 1
        elif ch == "[":
            depth_bracket += 1
        elif ch == "]":
            depth_bracket -= 1

        if ch == delimiter and depth_brace == 0 and depth_bracket == 0:
            parts.append("".join(current))
            current = []
        else:
            current.append(ch)

    if current:
        parts.append("".join(current))
    return parts


def _parse_java_toString_object(s: str) -> dict:
    """解析 Java toString 对象格式：{key=value, key2=value2}"""
    s = s.strip()
    if s.startswith("{"):
        s = s[1:]
    if s.endswith("}"):
        s = s[:-1]
    s = s.strip()
    if not s:
        return {}

    result = {}
    parts = _split_top_level(s, ",")
    for part in parts:
        part = part.strip()
        if not part:
            continue
        eq_idx = part.find("=")
        if eq_idx == -1:
            continue
        key = part[:eq_idx].strip()
        val_str = part[eq_idx + 1:].strip()
        # 值部分可能是嵌套 JSON 字符串 — 先尝试标准 JSON
        json_val = _try_json_parse(val_str)
        if json_val is not None:
            result[key] = json_val
        else:
            result[key] = _parse_java_toString_value(val_str)
    return result


def _parse_java_toString_array(s: str) -> list:
    """解析 Java toString 数组格式：[{...}, {...}]"""
    s = s.strip()
    if s.startswith("["):
        s = s[1:]
    if s.endswith("]"):
        s = s[:-1]
    s = s.strip()
    if not s:
        return []

    items = _split_top_level(s, ",")
    return [_parse_java_toString_value(item) for item in items if item.strip()]


def parse_tool_calls(s: str) -> list[dict]:
    """解析 tool_calls 字符串 → list[dict]

    兼容两种格式：
    1. 标准 JSON: [{"function": "xxx", "arguments": {...}}]
    2. Java toString: [{function=xxx, arguments={"page_index": 2}}]
    """
    if not s or not s.strip():
        return []

    # 尝试标准 JSON
    result = _try_json_parse(s)
    if result is not None:
        if isinstance(result, list):
            return result
        if isinstance(result, dict):
            return [result]
        return []

    # 回退到 Java toString 解析
    s = s.strip()
    if s.startswith("["):
        items = _parse_java_toString_array(s)
    elif s.startswith("{"):
        items = [_parse_java_toString_object(s)]
    else:
        return []

    # 规范化：确保 arguments 是 dict
    normalized = []
    for item in items:
        if not isinstance(item, dict):
            continue
        tc = {
            "function": item.get("function", ""),
            "arguments": item.get("arguments", {}),
        }
        # arguments 可能仍是字符串
        if isinstance(tc["arguments"], str):
            parsed_args = _try_json_parse(tc["arguments"])
            tc["arguments"] = parsed_args if isinstance(parsed_args, dict) else {}
        normalized.append(tc)
    return normalized


def parse_actions(s: str) -> list[dict]:
    """解析 actions 字符串 → list[dict]

    格式同 tool_calls，可能是 JSON 或 Java toString。
    """
    if not s or not s.strip():
        return []

    result = _try_json_parse(s)
    if result is not None:
        if isinstance(result, list):
            return result
        if isinstance(result, dict):
            return [result]
        return []

    s = s.strip()
    if s.startswith("["):
        return _parse_java_toString_array(s)
    if s.startswith("{"):
        return [_parse_java_toString_object(s)]
    return []


def _parse_usage(s) -> dict:
    """解析 usage 字段（可能是 dict 或 Java toString 字符串）"""
    if isinstance(s, dict):
        return s
    if isinstance(s, str):
        parsed = _try_json_parse(s)
        if parsed and isinstance(parsed, dict):
            return parsed
        return _parse_java_toString_object(s) if s.strip().startswith("{") else {}
    return {}


def _parse_result_state(s) -> dict:
    """解析 result_state（可能是 dict 或 Java toString 字符串）"""
    if isinstance(s, dict):
        return s
    if isinstance(s, str):
        parsed = _try_json_parse(s)
        if parsed and isinstance(parsed, dict):
            return parsed
        return _parse_java_toString_object(s) if s.strip().startswith("{") else {}
    return {}


def _parse_result_items(s) -> list:
    """解析 netease_items / ximalaya_items（可能是 list 或字符串）"""
    if isinstance(s, list):
        return s
    if isinstance(s, str):
        parsed = _try_json_parse(s)
        if parsed and isinstance(parsed, list):
            return parsed
        if s.strip().startswith("["):
            return _parse_java_toString_array(s)
    return []


def parse_trace(trace: dict) -> dict:
    """解析车端 Trace JSON，提取评测所需字段。

    Args:
        trace: 原始 trace dict，包含 traceId, timestamp, mode, nodes

    Returns:
        结构化评测数据 dict
    """
    nodes = {n["type"]: n["data"] for n in trace["nodes"]}

    input_data = nodes.get("input", {})
    prompt_data = nodes.get("prompt", {})
    response_data = nodes.get("response", {})
    action_data = nodes.get("action", {})
    result_data = nodes.get("result", {})

    # prompt 指纹（用于版本追溯）
    system_prompt = prompt_data.get("system_prompt", "")
    prompt_fingerprint = hashlib.md5(system_prompt.encode()).hexdigest()[:8] if system_prompt else ""

    # usage
    usage = _parse_usage(response_data.get("usage", {}))

    # result_state（action 执行后的 UI 状态）——规范化字段名，与 ui_state 一致
    _raw_result_state = _parse_result_state(action_data.get("result_state", {}))
    _rs_page = _raw_result_state.get("page", _raw_result_state.get("current_page", 0))
    if isinstance(_rs_page, str):
        try:
            _rs_page = int(_rs_page)
        except (ValueError, TypeError):
            _rs_page = 0
    _RS_PAGE_NAMES = {0: "喜马拉雅", 1: "QQ音乐", 2: "AI播客", 3: "AI推荐"}
    result_state = {
        "page": _rs_page,
        "page_name": _raw_result_state.get("page_name", _RS_PAGE_NAMES.get(_rs_page, "")),
        "qq_cards": (
            _raw_result_state["qq_card_names"]
            if isinstance(_raw_result_state.get("qq_card_names"), list)
            else parse_card_list(_raw_result_state.get("qq_card_names", _raw_result_state.get("current_qq_cards", "")))
        ),
        "xm_cards": (
            _raw_result_state["ximalaya_cards"]
            if isinstance(_raw_result_state.get("ximalaya_cards"), list)
            else parse_card_list(_raw_result_state.get("ximalaya_cards", ""))
        ),
    }

    # result node（AI 推荐返回的内容）
    result_items = None
    if result_data:
        result_items = {
            "query": result_data.get("query", ""),
            "fetch_latency_ms": result_data.get("fetch_latency_ms", 0),
            "total_items": result_data.get("total_items", 0),
            "netease_count": result_data.get("netease_count", 0),
            "netease_items": _parse_result_items(result_data.get("netease_items", [])),
            "ximalaya_count": result_data.get("ximalaya_count", 0),
            "ximalaya_items": _parse_result_items(result_data.get("ximalaya_items", [])),
            "error": result_data.get("error"),
        }

    return {
        "trace_id": trace["traceId"],
        "timestamp": trace["timestamp"],
        "mode": trace.get("mode", ""),
        # input node
        "user_text": input_data.get("user_text", ""),
        "ui_state": {
            "page": input_data.get("current_page", 0),
            "page_name": input_data.get("current_page_name", ""),
            "qq_cards": parse_card_list(input_data.get("current_qq_cards", "")),
            "xm_cards": parse_card_list(input_data.get("ximalaya_cards", "")),
        },
        # response node — 核心评测对象
        "tool_calls": parse_tool_calls(response_data.get("tool_calls", "")),
        "latency_ms": response_data.get("latency_ms", 0),
        "error": response_data.get("error"),
        # response 新增字段
        "model": prompt_data.get("model", ""),
        "usage": usage,
        "finish_reason": response_data.get("finish_reason", ""),
        # action node
        "actions": parse_actions(action_data.get("actions", "")),
        "result_state": result_state,
        "awaiting_result": action_data.get("awaiting_result", False),
        # result node（仅 query_ai_recommend 时有）
        "result_items": result_items,
        # prompt 指纹
        "prompt_fingerprint": prompt_fingerprint,
        # 保留原始 prompt（供 Playground 和调试用）
        "system_prompt": system_prompt,
        "user_message": prompt_data.get("user_message", ""),
        "tools_def": prompt_data.get("tools", ""),
    }
