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


@router.get("/conversations/{conv}")
def get_conversation(conv: str, request: Request, limit: int = 60) -> dict[str, Any]:
    """대화 기록 (프로그램을 다시 켰을 때 화면에 다시 보여 주기용)"""
    rows = _m(request).store.history(conv[:80], max(1, min(limit, 200)))
    return {"conversation": conv[:80], "messages": rows}


# ---------------------------------------------------------------- 실제 AI 점검
class SelfTestBody(BaseModel):
    provider: str | None = None
    model: str | None = Field(default=None, max_length=200)


def _oni_caller(request: Request):
    """점검 8번: 실제 온이 경로(/api/v1/assist, 토큰 인증 포함)로 요청"""
    import httpx

    settings = request.app.state.settings
    token_file = request.app.state.tokens.token_file
    try:
        token = next(l.strip() for l in token_file.read_text(encoding="utf-8").splitlines() if l.strip() and not l.startswith("#"))
    except (OSError, StopIteration):
        return None

    def call(text: str, conv: str) -> dict[str, Any]:
        try:
            r = httpx.post(f"http://127.0.0.1:{settings.port}/api/v1/assist", json={"text": text, "conversation": conv},
                           headers={"Authorization": f"Bearer {token}"}, timeout=900, trust_env=False)
            body = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
            if r.status_code != 200:
                return {"_status": r.status_code, "_error": (body.get("error") or {}).get("message") or body.get("message") or r.text[:200]}
            return {**body, "_status": 200}
        except httpx.HTTPError as e:
            return {"_status": 0, "_error": f"온이 API에 연결할 수 없음: {e}"}
    return call


@router.post("/selftest")
def start_selftest(body: SelfTestBody, request: Request) -> dict[str, Any]:
    from ..ai.selftest import SelfTest

    m = _m(request)
    if m.override is not None:
        raise api_error(400, "test_planner", "테스트용 계획기에서는 실제 AI 점검을 할 수 없습니다")
    if body.provider:
        pid, model = _pid(body.provider), body.model or m.model_for(body.provider)
    else:
        pid, model = m.resolve("assistant")[0]
    if not m._usable(pid, model):
        raise api_error(409, "ai_not_ready", f"{m.providers[pid].label} 을(를) 지금 쓸 수 없습니다",
                        hint="AI 제공자 탭에서 연결 테스트를 먼저 통과시키세요")
    reg = request.app.state.selftests
    try:
        return reg.start(SelfTest(m, pid, model, _oni_caller(request), request.app.state.settings.data_dir / "reports"))
    except RuntimeError as e:
        raise api_error(409, "selftest_running", str(e))


@router.get("/selftest/{sid}")
def get_selftest(sid: str, request: Request) -> dict[str, Any]:
    t = request.app.state.selftests.get(sid)
    if t is None:
        raise api_error(404, "not_found", "점검 기록이 없습니다")
    return request.app.state.selftests.public(t)


@router.post("/selftest/{sid}/cancel")
def cancel_selftest(sid: str, request: Request) -> dict[str, Any]:
    t = request.app.state.selftests.get(sid)
    if t is None:
        raise api_error(404, "not_found", "점검 기록이 없습니다")
    t.state["cancel"] = True
    return {"ok": True}
