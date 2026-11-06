"""외부 AI(온이 등)용 표준 API — /api/v1

- 인증: Authorization: Bearer <토큰>  (data_dir/oni-token.txt)
- 권한: scene:read · scene:write · view · project:read
- 명령 형식: commands.json (protocol form3d.command v1.0) — GET /api/v1/capabilities 로 확인
- 모든 편집은 '작업(Job)' 단위: 고유 ID, 검증, 편집기 정책(거부/확인/자동)에 따른 실행, 결과 반환, 실행 취소 가능
- 서버는 명령을 직접 실행하지 않고 열려 있는 편집기로 전달합니다.
"""
from __future__ import annotations

import asyncio
from typing import Any, Literal

from fastapi import APIRouter, Depends, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from ..ai.base import AIError
from ..core import commands as cmd
from ..core.config import APP_VERSION
from ..core.security import ALL_SCOPES, SCOPE_DESCRIPTIONS, api_error, check_scopes, require_token
from ..engines.registry import get_engine, list_engines
from .bridge import BridgeError, EditorBridge

router = APIRouter(prefix="/api/v1")


def _bridge(request: Request) -> EditorBridge:
    return request.app.state.bridge


def _bridge_error(e: BridgeError):
    return api_error(e.status, e.code, e.message)


@router.get("/capabilities")
def capabilities(request: Request, token: dict = Depends(require_token)) -> dict[str, Any]:
    m = cmd.manifest()
    return {
        "app": "FORM3D",
        "version": APP_VERSION,
        "protocol": m["protocol"],
        "protocolVersion": m["version"],
        "target": m["target"],
        "commands": m["commands"],
        "limits": m["limits"],
        "scopes": SCOPE_DESCRIPTIONS,
        "tokenScopes": token.get("scopes", []),
        "engines": list_engines(),
        "editor": {"connected": _bridge(request).connected, "policy": _bridge(request).policy},
    }


@router.get("/engines")
def engines(token: dict = Depends(require_token)) -> dict[str, Any]:
    return {"engines": list_engines()}


@router.post("/engines/{engine_id}/jobs")
def engine_job(engine_id: str, token: dict = Depends(require_token)) -> dict[str, Any]:
    eng = get_engine(engine_id)
    if not eng:
        raise api_error(404, "not_found", "알 수 없는 엔진입니다")
    raise api_error(501, "engine_not_available", f"{eng['name']} 엔진은 아직 구현되지 않았습니다 ({eng['phase']})")


@router.get("/project")
async def current_project(request: Request, token: dict = Depends(require_token)) -> dict[str, Any]:
    check_scopes(token, {"scene:read"})
    try:
        return await _bridge(request).request("get_project", timeout=request.app.state.settings.bridge_timeout_s)
    except BridgeError as e:
        raise _bridge_error(e)


@router.get("/scene")
async def scene(request: Request, token: dict = Depends(require_token)) -> dict[str, Any]:
    check_scopes(token, {"scene:read"})
    try:
        return await _bridge(request).request("get_scene", timeout=request.app.state.settings.bridge_timeout_s)
    except BridgeError as e:
        raise _bridge_error(e)


@router.get("/projects")
def stored_projects(request: Request, token: dict = Depends(require_token)) -> dict[str, Any]:
    check_scopes(token, {"project:read"})
    return {"projects": request.app.state.store.list()}


class JobBody(BaseModel):
    steps: list[Any] = Field(min_length=1)
    summary: str | None = Field(default=None, max_length=500)
    request: str | None = Field(default=None, max_length=2000)
    id: str | None = None
    wait: bool = True


async def _dispatch(request: Request, token: dict, job: dict[str, Any]) -> dict[str, Any]:
    """편집기로 작업을 보내고 결과를 기다림. 진행 상태는 작업 추적기에 기록."""
    tracker = request.app.state.jobs
    bridge = _bridge(request)
    s = request.app.state.settings
    confirm = bridge.policy == "confirm"
    tracker.update(job["id"], state="awaiting_confirmation" if confirm else "running")
    try:
        result = await bridge.request("run_job", {"job": job, "client": token.get("name", "")},
                                      timeout=s.confirm_timeout_s if confirm else s.bridge_timeout_s)
    except BridgeError as e:
        state = {"cancelled": "cancelled", "rejected_by_policy": "rejected", "invalid_job": "rejected"}.get(e.code, "error")
        tracker.update(job["id"], state=state, error={"status": e.status, "code": e.code, "message": e.message})
        raise
    tracker.update(job["id"], state="done" if (result or {}).get("status") == "success" else "failed", result=result)
    return result


def _prepare(request: Request, token: dict, steps: list[Any], summary: str | None, text: str | None,
             job_id: str | None) -> dict[str, Any]:
    errors = cmd.validate_steps(steps)
    if errors:
        raise api_error(422, "invalid_job", "명령이 올바르지 않아 실행하지 않았습니다", errors=errors)
    check_scopes(token, cmd.required_scopes(steps))
    job = {"id": job_id or cmd.new_job_id(), "source": "external", "steps": steps}
    if job_id and cmd.validate_job(job):
        raise api_error(422, "invalid_job", "작업 ID 형식이 올바르지 않습니다 (job_ 로 시작, 영문·숫자·_- 4~64자)")
    if summary:
        job["summary"] = summary
    if text:
        job["request"] = text
    bridge = _bridge(request)
    if bridge.connected and bridge.policy == "deny":
        raise api_error(403, "rejected_by_policy", "편집기 설정에서 외부 AI 명령이 꺼져 있습니다", jobId=job["id"])
    if not bridge.connected:
        raise api_error(503, "editor_not_connected", "FORM3D 편집기가 열려 있지 않습니다. 편집기를 먼저 실행하세요")
    return job


async def run_job(request: Request, token: dict, steps: list[Any], summary: str | None = None,
                  text: str | None = None, job_id: str | None = None, wait: bool = True) -> Any:
    job = _prepare(request, token, steps, summary, text, job_id)
    request.app.state.jobs.create(job["id"], "job", steps=steps, summary=summary)
    if not wait:
        async def bg() -> None:
            try:
                await _dispatch(request, token, job)
            except BridgeError:
                pass
        asyncio.create_task(bg())
        return JSONResponse({"jobId": job["id"], "state": "queued", "statusUrl": f"/api/v1/jobs/{job['id']}"}, status_code=202)
    try:
        return await _dispatch(request, token, job)
    except BridgeError as e:
        raise _bridge_error(e)


@router.post("/jobs")
async def create_job(body: JobBody, request: Request, token: dict = Depends(require_token)) -> Any:
    return await run_job(request, token, body.steps, body.summary, body.request, body.id, body.wait)


@router.get("/jobs/{job_id}")
def job_status(job_id: str, request: Request, token: dict = Depends(require_token)) -> dict[str, Any]:
    rec = request.app.state.jobs.get(job_id)
    if not rec:
        raise api_error(404, "not_found", "작업을 찾을 수 없습니다 (서버를 다시 시작하면 기록이 지워집니다)")
    return rec


@router.get("/ai/models")
async def ai_models(request: Request, token: dict = Depends(require_token)) -> dict[str, Any]:
    m = request.app.state.ai
    st = await run_in_threadpool(m.status)
    providers = [{k: v for k, v in p.items() if k not in ("key", "hint", "recommended")} for p in st["providers"]]
    return {"default": st.get("default"), "available": st.get("available"), "providers": providers,
            "active": await run_in_threadpool(m.describe_active)}


class AssistBody(BaseModel):
    text: str = Field(min_length=1, max_length=2000)
    conversation: str | None = Field(default=None, min_length=4, max_length=80)
    wait: bool = True


@router.post("/assist")
async def assist(body: AssistBody, request: Request, token: dict = Depends(require_token)) -> Any:
    """자연어 작업 요청: AI 계획 → (계획이면) 편집기 정책에 따라 실행 → 결과.
    질문(question)·답변(answer)·거절(reject)이면 실행하지 않고 그대로 돌려줍니다."""
    check_scopes(token, {"scene:read", "scene:write"})
    bridge = _bridge(request)
    if not bridge.connected:
        raise api_error(503, "editor_not_connected", "FORM3D 편집기가 열려 있지 않습니다. 편집기를 먼저 실행하세요")
    if bridge.policy == "deny":
        raise api_error(403, "rejected_by_policy", "편집기 설정에서 외부 AI 명령이 꺼져 있습니다")
    tracker = request.app.state.jobs
    job_id = cmd.new_job_id()
    conv = body.conversation or f"oni-{token.get('id', 'x')}"
    tracker.create(job_id, "assist", request=body.text, conversation=conv)

    async def work() -> dict[str, Any]:
        tracker.update(job_id, state="planning")
        try:
            scene = await bridge.request("get_scene", timeout=request.app.state.settings.bridge_timeout_s)
            plan = await run_in_threadpool(request.app.state.ai.assist, body.text, scene, conv, "oni")
        except AIError as e:
            tracker.update(job_id, state="error", error={"status": e.status, "code": e.code, "message": e.message, "hint": e.hint})
            raise api_error(e.status, e.code, e.message, hint=e.hint, jobId=job_id)
        except BridgeError as e:
            tracker.update(job_id, state="error", error={"status": e.status, "code": e.code, "message": e.message})
            raise _bridge_error(e)
        tracker.update(job_id, plan={k: plan[k] for k in ("status", "summary", "message", "reason", "options", "steps", "provider", "model", "usage")})
        if plan["status"] != "plan":
            tracker.update(job_id, state="answered" if plan["status"] in ("question", "answer") else "rejected")
            return tracker.get(job_id)
        missing = cmd.required_scopes(plan["steps"]) - set(token.get("scopes", []))
        if missing:
            tracker.update(job_id, state="rejected", error={"code": "insufficient_scope", "message": f"권한 부족: {', '.join(sorted(missing))}"})
            return tracker.get(job_id)
        job = {"id": job_id, "source": "external", "request": body.text, "summary": plan["summary"] or None, "steps": plan["steps"]}
        job = {k: v for k, v in job.items() if v is not None}
        try:
            result = await _dispatch(request, token, job)
            created = (result or {}).get("created") or []
            note = ("성공" if (result or {}).get("status") == "success" else "실패") + f" — {(result or {}).get('message', '')}"
            if created:
                note += " (만든 것: " + ", ".join(f"{c.get('name')}(id {c.get('id')})" for c in created) + ")"
            request.app.state.ai.feedback(conv, f"작업 {job_id}: {note}")
        except BridgeError as e:
            request.app.state.ai.feedback(conv, f"작업 {job_id}: 실행 안 됨 — {e.message}")
        return tracker.get(job_id)

    if not body.wait:
        async def bg() -> None:
            try:
                await work()
            except Exception:  # noqa: BLE001 — 상태는 tracker 에 기록됨
                pass
        asyncio.create_task(bg())
        return JSONResponse({"jobId": job_id, "state": "queued", "statusUrl": f"/api/v1/jobs/{job_id}"}, status_code=202)
    return await work()


# ---- 편의 인터페이스: 오브젝트 생성·수정·삭제 (내부적으로 같은 작업 형식으로 변환)

class CreateObjectBody(BaseModel):
    shape: Literal["box", "sphere", "cylinder", "cone", "torus", "plane"]
    name: str | None = None
    position: list[float] | None = None
    color: str | None = None
    count: int | None = None


@router.post("/objects")
async def create_object(body: CreateObjectBody, request: Request, token: dict = Depends(require_token)) -> dict[str, Any]:
    params = {k: v for k, v in body.model_dump().items() if v is not None}
    return await run_job(request, token, [{"command": "create_primitive", "params": params}], "오브젝트 생성")


class UpdateObjectBody(BaseModel):
    name: str | None = None
    position: list[float] | None = None
    rotation_deg: list[float] | None = None
    scale: list[float] | None = None
    translate: list[float] | None = None
    color: str | None = None
    metalness: float | None = None
    roughness: float | None = None
    visible: bool | None = None


@router.patch("/objects/{object_id}")
async def update_object(object_id: str, body: UpdateObjectBody, request: Request,
                        token: dict = Depends(require_token)) -> dict[str, Any]:
    target = {"ids": [object_id]}
    d = {k: v for k, v in body.model_dump().items() if v is not None}
    steps: list[dict[str, Any]] = []
    tf = {k: d[k] for k in ("position", "rotation_deg", "scale", "translate") if k in d}
    if tf:
        steps.append({"command": "transform", "params": {"target": target, **tf}})
    mat = {k: d[k] for k in ("color", "metalness", "roughness") if k in d}
    if mat:
        steps.append({"command": "set_material", "params": {"target": target, **mat}})
    if "visible" in d:
        steps.append({"command": "set_visibility", "params": {"target": target, "visible": d["visible"]}})
    if "name" in d:
        steps.append({"command": "rename", "params": {"target": target, "name": d["name"]}})
    if not steps:
        raise api_error(422, "invalid_job", "바꿀 값이 없습니다")
    return await run_job(request, token, steps, "오브젝트 수정")


@router.delete("/objects/{object_id}")
async def delete_object(object_id: str, request: Request, token: dict = Depends(require_token)) -> dict[str, Any]:
    return await run_job(request, token, [{"command": "delete", "params": {"target": {"ids": [object_id]}}}], "오브젝트 삭제")


__all__ = ["router", "ALL_SCOPES"]
