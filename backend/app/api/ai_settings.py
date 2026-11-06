"""AI 설정 화면용 API (편집기 전용, 로컬 전용). API 키는 저장만 하고 절대 되돌려주지 않습니다(가린 값만)."""
from __future__ import annotations

import json
import re
from typing import Any

from fastapi import APIRouter, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from ..ai.base import AIError
from ..ai.manager import AIManager, validate_settings
from ..ai.store import PROVIDER_IDS
from ..core.security import api_error
from ..engines.registry import list_engines

router = APIRouter(prefix="/api/ai")


def _m(request: Request) -> AIManager:
    return request.app.state.ai


def _pid(pid: str) -> str:
    if pid not in PROVIDER_IDS:
        raise api_error(404, "not_found", "알 수 없는 AI 제공자입니다")
    return pid


def _ai_error(e: AIError):
    return api_error(e.status, e.code, e.message, hint=e.hint)


@router.get("/status")
async def status(request: Request) -> dict[str, Any]:
    m = _m(request)
    st = await run_in_threadpool(m.status)
    return {**st, "settings": m.store.settings(), "engines": list_engines(), "active": await run_in_threadpool(m.describe_active)}


@router.put("/settings")
def put_settings(body: dict[str, Any], request: Request) -> dict[str, Any]:
    m = _m(request)
    merged = {**m.store.settings(), **body}
    errs = validate_settings(merged, m.providers)
    if errs:
        raise api_error(422, "invalid_settings", "설정 값이 올바르지 않습니다", errors=errs)
    return {"settings": m.store.save_settings(merged)}


class KeyBody(BaseModel):
    key: str = Field(min_length=8, max_length=400)


@router.put("/keys/{pid}")
def set_key(pid: str, body: KeyBody, request: Request) -> dict[str, Any]:
    if _pid(pid) == "ollama":
        raise api_error(400, "no_key_needed", "Ollama는 API 키가 필요 없습니다")
    key = body.key.strip()
    if not re.fullmatch(r"[A-Za-z0-9_\-\.]{8,400}", key):
        raise api_error(422, "invalid_key", "키 형식이 올바르지 않습니다 (공백·특수문자 확인)")
    _m(request).store.set_key(pid, key)
    return _m(request).provider_info(pid, check=False)


@router.delete("/keys/{pid}")
def delete_key(pid: str, request: Request) -> dict[str, Any]:
    _m(request).store.set_key(_pid(pid), None)
    return _m(request).provider_info(pid, check=False)


@router.get("/providers/{pid}/models")
async def models(pid: str, request: Request) -> dict[str, Any]:
    p = _m(request).providers[_pid(pid)]
    try:
        ms = await run_in_threadpool(p.list_models)
    except AIError as e:
        return {"models": [], "error": e.message, "hint": e.hint}
    return {"models": [m.__dict__ for m in ms]}


class TestBody(BaseModel):
    model: str | None = Field(default=None, max_length=200)


@router.post("/providers/{pid}/test")
async def test(pid: str, body: TestBody, request: Request) -> dict[str, Any]:
    try:
        return await run_in_threadpool(_m(request).test, _pid(pid), body.model)
    except AIError as e:
        return {"ok": False, "provider": pid, "model": body.model, "code": e.code, "error": e.message, "hint": e.hint}


class PullBody(BaseModel):
    model: str = Field(min_length=1, max_length=120, pattern=r"^[A-Za-z0-9._:/\-]+$")


@router.post("/ollama/pull")
def ollama_pull(body: PullBody, request: Request) -> StreamingResponse:
    """모델 내려받기 진행률 (줄마다 JSON). 화면에서 취소하면 연결이 끊기며 중단됩니다."""
    p = _m(request).providers["ollama"]

    def gen():
        try:
            for ev in p.pull(body.model):  # type: ignore[attr-defined]
                yield json.dumps(ev, ensure_ascii=False) + "\n"
            yield json.dumps({"status": "success", "done": True}) + "\n"
        except AIError as e:
            yield json.dumps({"status": "error", "error": e.message, "hint": e.hint}, ensure_ascii=False) + "\n"

    return StreamingResponse(gen(), media_type="application/x-ndjson")


@router.get("/usage")
def usage(request: Request, days: int = 30) -> dict[str, Any]:
    import time

    s = _m(request).store
    since = time.time() - max(1, min(days, 3650)) * 86400
    return {"days": days, "rows": s.usage_summary(since), "prices": s.settings()["prices"],
            "note": "예상 비용입니다. 실제 청구 금액은 각 회사 콘솔에서 확인하세요. 로컬(Ollama)은 0원."}


class FeedbackBody(BaseModel):
    conversation: str = Field(min_length=4, max_length=80)
    note: str = Field(min_length=1, max_length=2000)


@router.post("/feedback")
def feedback(body: FeedbackBody, request: Request) -> dict[str, Any]:
    _m(request).feedback(body.conversation, body.note)
    return {"ok": True}


@router.delete("/conversations/{conv}")
def clear_conversation(conv: str, request: Request) -> dict[str, Any]:
    _m(request).store.clear_conversation(conv[:80])
    return {"ok": True}
