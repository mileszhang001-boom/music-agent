# -*- coding: utf-8 -*-
"""SQLite 数据库管理

使用 aiosqlite 提供异步访问。启动时自动建表。
"""

import json
import aiosqlite
from config import DB_PATH


_SCHEMA = """
CREATE TABLE IF NOT EXISTS traces (
    trace_id TEXT PRIMARY KEY,
    timestamp INTEGER,
    mode TEXT,
    user_text TEXT,
    tool_calls TEXT,
    latency_ms INTEGER,
    prompt_fingerprint TEXT,
    case_id TEXT,
    model TEXT DEFAULT '',
    total_tokens INTEGER DEFAULT 0,
    parsed_json TEXT DEFAULT '',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS eval_runs (
    run_id TEXT PRIMARY KEY,
    timestamp TIMESTAMP,
    prompt_fingerprint TEXT,
    case_count INTEGER,
    avg_score REAL,
    status TEXT DEFAULT 'pending'
);

CREATE TABLE IF NOT EXISTS eval_scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT,
    trace_id TEXT,
    case_id TEXT,
    format_score REAL,
    playability_score REAL,
    key_factor_score REAL,
    preference_score REAL,
    scene_score REAL,
    action_logic_score REAL,
    latency_ms INTEGER,
    reasoning TEXT,
    FOREIGN KEY (run_id) REFERENCES eval_runs(run_id),
    FOREIGN KEY (trace_id) REFERENCES traces(trace_id)
);
"""


async def get_db() -> aiosqlite.Connection:
    """获取数据库连接（调用方负责关闭）"""
    db = await aiosqlite.connect(DB_PATH)
    db.row_factory = aiosqlite.Row
    await db.execute("PRAGMA journal_mode=WAL")
    return db


async def init_db():
    """初始化数据库表结构"""
    import os
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)

    db = await aiosqlite.connect(DB_PATH)
    try:
        for statement in _SCHEMA.strip().split(";"):
            statement = statement.strip()
            if statement:
                await db.execute(statement)
        # 迁移：为已有数据库添加新列
        for col, default in [("model", "''"), ("total_tokens", "0"), ("parsed_json", "''")]:
            try:
                await db.execute(f"ALTER TABLE traces ADD COLUMN {col} TEXT DEFAULT {default}")
            except Exception:
                pass  # 列已存在
        # v2.0 迁移：eval_scores 新增列
        for col in ["executability_score", "golden_score", "result_quality_score"]:
            try:
                await db.execute(f"ALTER TABLE eval_scores ADD COLUMN {col} REAL DEFAULT -1")
            except Exception:
                pass
        await db.commit()
    finally:
        await db.close()


# ── Trace CRUD ──

async def insert_trace(db: aiosqlite.Connection, parsed: dict, case_id: str = None):
    """插入解析后的 trace，traceId 去重"""
    usage = parsed.get("usage", {})
    total_tokens = usage.get("total_tokens", 0) if isinstance(usage, dict) else 0

    await db.execute(
        """INSERT OR IGNORE INTO traces
           (trace_id, timestamp, mode, user_text, tool_calls, latency_ms,
            prompt_fingerprint, case_id, model, total_tokens, parsed_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            parsed["trace_id"],
            parsed["timestamp"],
            parsed["mode"],
            parsed["user_text"],
            json.dumps(parsed["tool_calls"], ensure_ascii=False),
            parsed["latency_ms"],
            parsed["prompt_fingerprint"],
            case_id,
            parsed.get("model", ""),
            total_tokens,
            json.dumps(parsed, ensure_ascii=False),
        ),
    )
    await db.commit()


async def get_trace(db: aiosqlite.Connection, trace_id: str) -> dict | None:
    """按 trace_id 查询单条"""
    cursor = await db.execute("SELECT * FROM traces WHERE trace_id = ?", (trace_id,))
    row = await cursor.fetchone()
    if row is None:
        return None
    return dict(row)


async def list_traces(db: aiosqlite.Connection, limit: int = 50, offset: int = 0) -> list[dict]:
    """分页查询 trace 列表"""
    cursor = await db.execute(
        "SELECT * FROM traces ORDER BY created_at DESC LIMIT ? OFFSET ?",
        (limit, offset),
    )
    rows = await cursor.fetchall()
    return [dict(r) for r in rows]


_TRACE_FILTER = "WHERE t.user_text != '' AND t.user_text != '{}' AND t.user_text IS NOT NULL"


async def count_traces(db: aiosqlite.Connection) -> int:
    cursor = await db.execute(f"SELECT COUNT(*) FROM traces t {_TRACE_FILTER}")
    row = await cursor.fetchone()
    return row[0]


async def list_traces_with_scores(db: aiosqlite.Connection, limit: int = 50, offset: int = 0) -> list[dict]:
    """分页查询 trace 列表，LEFT JOIN 评分结果，过滤空数据"""
    cursor = await db.execute(f"""
        SELECT t.*,
               es.format_score, es.playability_score,
               es.key_factor_score, es.preference_score,
               es.scene_score, es.action_logic_score
        FROM traces t
        LEFT JOIN eval_scores es ON t.trace_id = es.trace_id
        {_TRACE_FILTER}
        ORDER BY t.created_at DESC
        LIMIT ? OFFSET ?
    """, (limit, offset))
    rows = await cursor.fetchall()
    return [dict(r) for r in rows]


async def get_scores_by_trace(db: aiosqlite.Connection, trace_id: str) -> dict | None:
    """获取某条 trace 的评分（取最新一条）"""
    cursor = await db.execute(
        "SELECT * FROM eval_scores WHERE trace_id = ? ORDER BY id DESC LIMIT 1",
        (trace_id,),
    )
    row = await cursor.fetchone()
    return dict(row) if row else None


# ── Eval Run CRUD ──

async def insert_eval_run(db: aiosqlite.Connection, run: dict):
    await db.execute(
        """INSERT INTO eval_runs (run_id, timestamp, prompt_fingerprint, case_count, avg_score, status)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (run["run_id"], run["timestamp"], run.get("prompt_fingerprint", ""),
         run.get("case_count", 0), run.get("avg_score"), run.get("status", "pending")),
    )
    await db.commit()


async def update_eval_run(db: aiosqlite.Connection, run_id: str, **kwargs):
    sets = ", ".join(f"{k} = ?" for k in kwargs)
    vals = list(kwargs.values()) + [run_id]
    await db.execute(f"UPDATE eval_runs SET {sets} WHERE run_id = ?", vals)
    await db.commit()


async def get_eval_run(db: aiosqlite.Connection, run_id: str) -> dict | None:
    cursor = await db.execute("SELECT * FROM eval_runs WHERE run_id = ?", (run_id,))
    row = await cursor.fetchone()
    return dict(row) if row else None


async def list_eval_runs(db: aiosqlite.Connection, limit: int = 50) -> list[dict]:
    cursor = await db.execute(
        "SELECT * FROM eval_runs ORDER BY timestamp DESC LIMIT ?", (limit,)
    )
    return [dict(r) for r in await cursor.fetchall()]


# ── Eval Score CRUD ──

async def insert_eval_score(db: aiosqlite.Connection, score: dict):
    await db.execute(
        """INSERT INTO eval_scores
           (run_id, trace_id, case_id, format_score, playability_score,
            executability_score, golden_score,
            key_factor_score, preference_score, scene_score, action_logic_score,
            result_quality_score, latency_ms, reasoning)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            score["run_id"], score["trace_id"], score.get("case_id"),
            score.get("format_score"), score.get("playability_score"),
            score.get("executability_score", score.get("playability_score")),
            score.get("golden_score", -1),
            score.get("key_factor_score"), score.get("preference_score"),
            score.get("scene_score"), score.get("action_logic_score"),
            score.get("result_quality_score", -1),
            score.get("latency_ms"),
            json.dumps(score.get("reasoning", {}), ensure_ascii=False),
        ),
    )
    await db.commit()


async def get_scores_by_run(db: aiosqlite.Connection, run_id: str) -> list[dict]:
    cursor = await db.execute(
        "SELECT * FROM eval_scores WHERE run_id = ? ORDER BY id", (run_id,)
    )
    return [dict(r) for r in await cursor.fetchall()]
