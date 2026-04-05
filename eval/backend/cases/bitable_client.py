# -*- coding: utf-8 -*-
"""飞书多维表格 (Bitable) 客户端 — Case 管理工具

迁移自 eval-music/bitable_client.py，secrets 外置到环境变量。
"""

import json
import os
import time
import requests
from typing import Optional

from config import FEISHU_APP_ID, FEISHU_APP_SECRET, BITABLE_APP_TOKEN, BITABLE_TABLE_ID

BASE_URL = "https://open.feishu.cn/open-apis"

# ─── 字段定义 ───
FIELDS = [
    ("Case ID",       1),
    ("触发方式",       3, ["query", "auto"]),
    ("用户 Query",     1),
    ("偏好风格",       1),
    ("偏好歌手",       1),
    ("偏好语言",       1),
    ("排斥风格",       1),
    ("画像标签",       1),
    ("乘客",          3, ["一个人", "两人", "含儿童", "含老人", "含家人", "含同事"]),
    ("时间段",         3, ["清晨", "早上", "上午", "中午", "下午", "傍晚", "深夜"]),
    ("日期类型",       3, ["工作日", "周末", "春节假期", "节假日"]),
    ("活动场景",       3, ["通勤上班", "通勤回家", "长途自驾", "家庭出行", "接送家人",
                          "约会", "午休短驾"]),
    ("天气",          3, ["晴", "阴", "雨", "雪"]),
    ("即时约束",       1),
    ("关键因素",       1),
    ("关键因素类型",    3, ["人群", "语言", "风格约束"]),
    ("期望风格方向",    1),
    ("应避免的内容",    1),
    ("主要考察维度",    4, ["格式正确性", "可执行性", "Golden Answer",
                          "关键因素捕获", "用户偏好匹配", "场景契合度",
                          "操作逻辑性", "结果质量"]),
    ("required_actions",     1),   # Golden Answer: 必须执行的操作 (JSON)
    ("acceptable_variants",  1),   # Golden Answer: 可接受的替代操作 (JSON)
    ("备注",          1),
    ("审核状态",       3, ["待审核", "已审核", "有建议"]),
    ("问题标注",       1),
]


class BitableCaseManager:
    """飞书多维表格 Case 管理器"""

    def __init__(self, app_token: str = "", table_id: str = ""):
        self.app_token = app_token or BITABLE_APP_TOKEN
        self.table_id = table_id or BITABLE_TABLE_ID
        self._token = None
        self._token_expire = 0

    # ─── Auth ───
    def _get_tenant_token(self) -> str:
        now = time.time()
        if self._token and now < self._token_expire:
            return self._token
        resp = requests.post(f"{BASE_URL}/auth/v3/tenant_access_token/internal", json={
            "app_id": FEISHU_APP_ID, "app_secret": FEISHU_APP_SECRET
        })
        data = resp.json()
        if data.get("code") != 0:
            raise RuntimeError(f"获取 token 失败: {data}")
        self._token = data["tenant_access_token"]
        self._token_expire = now + data.get("expire", 7200) - 60
        return self._token

    def _headers(self):
        return {"Authorization": f"Bearer {self._get_tenant_token()}",
                "Content-Type": "application/json"}

    def _api(self, method, path, **kwargs):
        url = f"{BASE_URL}{path}"
        resp = requests.request(method, url, headers=self._headers(), **kwargs)
        data = resp.json()
        if data.get("code") != 0:
            raise RuntimeError(f"API error: {data}")
        return data.get("data", data)

    # ─── CRUD ───
    def _to_record(self, case: dict) -> dict:
        fields = {}
        for k, v in case.items():
            if v is None or v == "":
                continue
            if k == "主要考察维度" and isinstance(v, str):
                v = [x.strip() for x in v.replace("×", "、").split("、") if x.strip()]
            fields[k] = v
        return {"fields": fields}

    def list_cases(self, filter_formula: str = "") -> list[dict]:
        """读取所有 case"""
        all_items = []
        page_token = None
        while True:
            params = {"page_size": 100}
            if filter_formula:
                params["filter"] = filter_formula
            if page_token:
                params["page_token"] = page_token
            data = self._api("GET",
                f"/bitable/v1/apps/{self.app_token}/tables/{self.table_id}/records",
                params=params)
            items = data.get("items", [])
            all_items.extend([{"record_id": r["record_id"], **r["fields"]} for r in items])
            if not data.get("has_more"):
                break
            page_token = data.get("page_token")
        return all_items

    def add_case(self, case: dict) -> str:
        data = self._api("POST",
            f"/bitable/v1/apps/{self.app_token}/tables/{self.table_id}/records",
            json=self._to_record(case))
        return data["record"]["record_id"]

    def update_case(self, record_id: str, updates: dict) -> None:
        self._api("PUT",
            f"/bitable/v1/apps/{self.app_token}/tables/{self.table_id}/records/{record_id}",
            json=self._to_record(updates))

    def delete_case(self, record_id: str) -> None:
        self._api("DELETE",
            f"/bitable/v1/apps/{self.app_token}/tables/{self.table_id}/records/{record_id}")

    # ─── Eval pipeline 便捷方法 ───
    def load_test_cases_for_eval(self) -> list[dict]:
        """读取所有「已审核」case，转为评测格式"""
        cases = self.list_cases()
        results = []
        for c in cases:
            if c.get("审核状态") != "已审核":
                continue
            results.append({
                "case_id": c.get("Case ID", ""),
                "trigger": c.get("触发方式", ""),
                "query": c.get("用户 Query", ""),
                "user_profile": {
                    "style": c.get("偏好风格", ""),
                    "artist": c.get("偏好歌手", ""),
                    "language": c.get("偏好语言", ""),
                    "dislike": c.get("排斥风格", ""),
                    "tags": c.get("画像标签", ""),
                },
                "scene": {
                    "passenger": c.get("乘客", ""),
                    "time": c.get("时间段", ""),
                    "date_type": c.get("日期类型", ""),
                    "activity": c.get("活动场景", ""),
                    "weather": c.get("天气", ""),
                },
                "eval_hints": {
                    "constraint": c.get("即时约束", ""),
                    "critical_factor": c.get("关键因素", ""),
                    "critical_factor_type": c.get("关键因素类型", ""),
                    "expected_style": c.get("期望风格方向", ""),
                    "should_avoid": c.get("应避免的内容", ""),
                    "focus_dimensions": c.get("主要考察维度", []),
                },
                "required_actions": c.get("required_actions", ""),
                "acceptable_variants": c.get("acceptable_variants", ""),
                "note": c.get("备注", ""),
            })
        return results

    def case_to_eval_context(self, eval_case: dict) -> dict:
        """将 eval 格式的 case 转为 metrics 需要的 case_context"""
        profile = eval_case.get("user_profile", {})
        scene = eval_case.get("scene", {})
        hints = eval_case.get("eval_hints", {})
        return {
            "偏好风格": profile.get("style", ""),
            "偏好歌手": profile.get("artist", ""),
            "偏好语言": profile.get("language", ""),
            "排斥风格": profile.get("dislike", ""),
            "乘客": scene.get("passenger", ""),
            "活动场景": scene.get("activity", ""),
            "时间段": scene.get("time", ""),
            "日期类型": scene.get("date_type", ""),
            "关键因素": hints.get("critical_factor", ""),
            "期望风格": hints.get("expected_style", ""),
            "required_actions": eval_case.get("required_actions", ""),
            "acceptable_variants": eval_case.get("acceptable_variants", ""),
        }
