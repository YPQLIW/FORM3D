"""AI 설정 · API 키 · 사용량 · 대화 기록 저장

- 키: data_dir/secrets.json (이 PC 사용자만 읽기, 화면에는 가린 값만 반환). backend/.env 의 ANTHROPIC_API_KEY 도 계속 인식
- 설정: data_dir/ai-settings.json (비밀 값 없음)
- 사용량·대화: data_dir/form3d.db (SQLite)
"""
from __future__ import annotations

import copy
import json
import os
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any

from ..storage.store import atomic_write

PROVIDER_IDS = ("claude", "dashscope", "ollama")
TASKS = ("assistant", "oni")

DEFAULT_SETTINGS: dict[str, Any] = {
    "default": {"provider": "claude", "model": "claude-opus-5-5"},
    "tasks": {"assistant": None, "oni": None},
    "fallback": {"enabled": False, "order": []},
    "providers": {
        "claude": {"model": "claude-opus-5-5"},
        "dashscope": {"model": "qwen-plus", "region": "intl"},
        "ollama": {"model": "", "url": "http://127.0.0.1:11434"},
    },
    "params": {"temperature": 0.2, "max_tokens": 4000, "timeout": 180, "history": 12},
    # 1백만 토큰당 예상 단가 (USD). 실제 청구 금액과 다를 수 있음 — 설정에서 수정 가능
    "prices": {
        "claude-opus-5-5": {"in": 5.0, "out": 25.0},
        "claude-sonnet-5-5": {"in": 3.0, "out": 15.0},
        "claude-haiku-5-5": {"in": 1.0, "out": 5.0},
        "qwen-max": {"in": 1.6, "out": 6.4},
        "qwen-plus": {"in": 0.4, "out": 1.2},
        "qwen-turbo": {"in": 0.05, "out": 0.2},
    },
}


def _merge(base: dict[str, Any], over: dict[str, Any]) -> dict[str, Any]:
    out = copy.deepcopy(base)
    for k, v in over.items():
        if isinstance(v, dict) and isinstance(out.get(k), dict) and k != "prices":
            out[k] = _merge(out[k], v)
        else:
            out[k] = v
    return out


def mask(key: str | None) -> str | None:
    if not key:
        return None
    return f"{key[:4]}…{key[-4:]}" if len(key) > 12 else "••••"


class AIStore:
    def __init__(self, data_dir: Path, db: sqlite3.Connection, env_keys: dict[str, str | None] | None = None) -> None:
        self.dir = data_dir
        self.settings_path = data_dir / "ai-settings.json"
        self.secrets_path = data_dir / "secrets.json"
        self.env_keys = env_keys or {}
        self.db = db
        self._lock = threading.RLock()
        self.db.execute("""CREATE TABLE IF NOT EXISTS ai_usage (
            ts REAL, provider TEXT, model TEXT, task TEXT, input_tokens INTEGER, output_tokens INTEGER,
            cost REAL, ok INTEGER, latency_ms INTEGER, error TEXT)""")
        self.db.execute("""CREATE TABLE IF NOT EXISTS ai_messages (
            conv TEXT, ts REAL, role TEXT, content TEXT)""")
        self.db.execute("CREATE INDEX IF NOT EXISTS ai_messages_conv ON ai_messages(conv, ts)")
        self.db.commit()

    # ---------------- 설정
    def settings(self) -> dict[str, Any]:
        try:
            saved = json.loads(self.settings_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            saved = {}
        merged = _merge(DEFAULT_SETTINGS, saved if isinstance(saved, dict) else {})
        # v0.4.0 의 기본 시간 제한(120초)은 Qwen 큰 모델에 짧아서 180초로 올림
        if merged.get("params", {}).get("timeout") == 120:
            merged["params"]["timeout"] = 180
        return merged

    def save_settings(self, s: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            atomic_write(self.settings_path, json.dumps(s, ensure_ascii=False, indent=2).encode("utf-8"))
        return self.settings()

    # ---------------- 키
    def _secrets(self) -> dict[str, str]:
        try:
            data = json.loads(self.secrets_path.read_text(encoding="utf-8"))
            return {k: v for k, v in data.items() if isinstance(v, str)}
        except (OSError, ValueError):
            return {}

    def get_key(self, provider: str) -> str | None:
        return self._secrets().get(provider) or self.env_keys.get(provider) or None

    def key_source(self, provider: str) -> str | None:
        if self._secrets().get(provider):
            return "settings"
        return "env" if self.env_keys.get(provider) else None

    def set_key(self, provider: str, key: str | None) -> None:
        with self._lock:
            s = self._secrets()
            if key:
                s[provider] = key
            else:
                s.pop(provider, None)
            atomic_write(self.secrets_path, json.dumps(s).encode("utf-8"))
            try:
                os.chmod(self.secrets_path, 0o600)
            except OSError:
                pass

    # ---------------- 사용량
    def price(self, model: str) -> dict[str, float] | None:
        p = self.settings()["prices"].get(model)
        return p if isinstance(p, dict) else None

    def record_usage(self, provider: str, model: str, task: str, inp: int, out: int, ok: bool, latency_ms: int,
                     error: str = "", paid: bool = True) -> float | None:
        price = self.price(model) if paid else {"in": 0.0, "out": 0.0}
        cost = (inp * price["in"] + out * price["out"]) / 1_000_000 if price else None
        with self._lock:
            self.db.execute("INSERT INTO ai_usage VALUES (?,?,?,?,?,?,?,?,?,?)",
                            (time.time(), provider, model, task, inp, out, cost, int(ok), latency_ms, error[:200]))
            self.db.commit()
        return cost

    def usage_summary(self, since: float = 0) -> list[dict[str, Any]]:
        rows = self.db.execute(
            """SELECT provider, model, COUNT(*) n, SUM(ok) ok, SUM(input_tokens) i, SUM(output_tokens) o,
                      SUM(cost) c, SUM(cost IS NULL) unknown, AVG(latency_ms) lat
               FROM ai_usage WHERE ts >= ? GROUP BY provider, model ORDER BY provider, model""", (since,)).fetchall()
        return [{"provider": r[0], "model": r[1], "requests": r[2], "succeeded": r[3] or 0, "inputTokens": r[4] or 0,
                 "outputTokens": r[5] or 0, "estimatedCostUsd": round(r[6] or 0, 6), "unpricedRequests": r[7] or 0,
                 "avgLatencyMs": int(r[8] or 0)} for r in rows]

    # ---------------- 대화
    def history(self, conv: str, limit: int) -> list[dict[str, str]]:
        rows = self.db.execute("SELECT role, content FROM ai_messages WHERE conv=? ORDER BY ts DESC LIMIT ?",
                               (conv, limit)).fetchall()
        return [{"role": r[0], "content": r[1]} for r in reversed(rows)]

    def append(self, conv: str, role: str, content: str) -> None:
        with self._lock:
            self.db.execute("INSERT INTO ai_messages VALUES (?,?,?,?)", (conv, time.time(), role, content[:8000]))
            self.db.commit()

    def clear_conversation(self, conv: str) -> None:
        with self._lock:
            self.db.execute("DELETE FROM ai_messages WHERE conv=?", (conv,))
            self.db.commit()
