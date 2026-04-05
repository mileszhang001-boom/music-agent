# -*- coding: utf-8 -*-
"""自然语言 → 结构化操作解析器

将专家用大白话写的操作描述，自动解析成 Golden Answer metric 需要的 JSON 格式。

示例输入:
  "切到QQ音乐, 选欧美榜、新歌榜卡片"
  "走AI推荐"
  "① 切到喜马拉雅 ② 选相声小品、热门播客卡片"

示例输出:
  [{"tool": "switch_recommend_page", "args": {"page_index": 1}},
   {"tool": "switch_recommend_qq_cards", "args": {"card_names": ["欧美榜", "新歌榜"]}}]
"""

import re
from config import QQ_CARDS, XIMALAYA_CARDS

# 页面名 → page_index 映射
PAGE_MAP = {
    "喜马拉雅": 0, "喜马": 0, "ximalaya": 0,
    "qq音乐": 1, "qq": 1, "QQ音乐": 1, "QQ": 1,
    "ai播客": 2, "AI播客": 2, "播客": 2,
    "ai推荐": 3, "AI推荐": 3,
}

# 全部卡片集合（用于匹配）
ALL_QQ = set(QQ_CARDS)
ALL_XM = set(XIMALAYA_CARDS)


def parse_natural_language(text: str) -> list[dict]:
    """将自然语言操作描述解析为结构化 action 列表。

    如果输入已经是 JSON 格式（以 [ 开头），直接解析返回。
    否则按自然语言解析。
    """
    if not text or not text.strip():
        return []

    text = text.strip()

    # 兼容 JSON 格式输入
    if text.startswith("["):
        import json
        try:
            return json.loads(text)
        except (ValueError, TypeError):
            pass

    actions = []

    # 分步骤（支持 ①②③ 或 1. 2. 3. 或逗号分隔）
    steps = re.split(r'[①②③④⑤]\s*|\d+[.、]\s*', text)
    if len(steps) <= 1:
        steps = [s.strip() for s in text.split(",") if s.strip()]
    if len(steps) <= 1:
        steps = [s.strip() for s in text.split("，") if s.strip()]
    if not steps:
        steps = [text]

    for step in steps:
        step = step.strip()
        if not step:
            continue

        action = _parse_single_step(step)
        if action:
            actions.append(action)

    return actions


def _parse_single_step(step: str) -> dict | None:
    """解析单个步骤描述"""
    step_lower = step.lower().replace(" ", "")

    # 1. "走AI推荐" / "AI智能推荐" / "走ai推荐"
    if any(kw in step_lower for kw in ["走ai推荐", "ai推荐", "ai智能推荐", "智能推荐"]):
        return {"tool": "query_ai_recommend", "args": {}}

    # 2. "切到XX页面" / "切换到XX"
    for page_name, page_idx in PAGE_MAP.items():
        if page_name.lower() in step_lower:
            if any(kw in step_lower for kw in ["切到", "切换", "打开", "进入", "去"]):
                return {"tool": "switch_recommend_page", "args": {"page_index": page_idx}}
            # 如果只提到页面名但没有切换动词，也尝试识别
            if "页面" in step or "页" in step:
                return {"tool": "switch_recommend_page", "args": {"page_index": page_idx}}

    # 3. "选XX卡片" — 自动判断 QQ 还是喜马
    if any(kw in step for kw in ["选", "卡片", "推荐"]):
        cards = _extract_card_names(step)
        if cards:
            qq_cards = [c for c in cards if c in ALL_QQ]
            xm_cards = [c for c in cards if c in ALL_XM]

            if qq_cards and not xm_cards:
                return {"tool": "switch_recommend_qq_cards", "args": {"card_names": qq_cards}}
            elif xm_cards and not qq_cards:
                return {"tool": "switch_recommend_ximalaya_cards", "args": {"card_names": xm_cards}}
            elif qq_cards:
                return {"tool": "switch_recommend_qq_cards", "args": {"card_names": qq_cards}}
            elif xm_cards:
                return {"tool": "switch_recommend_ximalaya_cards", "args": {"card_names": xm_cards}}

    # 4. 尝试直接匹配卡片名（没有"选"字但提到了卡片）
    cards = _extract_card_names(step)
    if cards:
        qq_cards = [c for c in cards if c in ALL_QQ]
        xm_cards = [c for c in cards if c in ALL_XM]
        if qq_cards:
            return {"tool": "switch_recommend_qq_cards", "args": {"card_names": qq_cards}}
        if xm_cards:
            return {"tool": "switch_recommend_ximalaya_cards", "args": {"card_names": xm_cards}}

    return None


def _extract_card_names(text: str) -> list[str]:
    """从文本中提取所有匹配的卡片名"""
    found = []

    # 先尝试匹配已知卡片名
    all_cards = sorted(list(ALL_QQ | ALL_XM), key=len, reverse=True)  # 长的先匹配
    for card in all_cards:
        if card in text:
            found.append(card)

    # 去重并保持顺序
    seen = set()
    result = []
    for c in found:
        if c not in seen:
            seen.add(c)
            result.append(c)

    return result
