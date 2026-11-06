"""편집기(웹 화면)용 API: 프로젝트 저장소, AI 계획, 상태."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import Response
from pydantic import BaseModel, Field

from ..ai.base import AIError
from ..core import commands as cmd
from ..core.config import APP_VERSION
from ..core.security import SCOPE_DESCRIPTIONS, api_error
from ..storage.store import StoreError

router = APIRouter(prefix="/api")


def _store_error(e: StoreError):
    return api_error(e.status, e.code, e.message)


async def _read_body(request: Request) -> bytes:
    limit = request.app.state.settings.max_upload_mb * 1024 * 1024
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > limit:
        raise api_error(413, "too_large", f"파일이 너무 큽니다 (최대 {request.app.state.settings.max_upload_mb}MB)")
    chunks, size = [], 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > limit:
            raise api_error(413, "too_large", f"파일이 너무 큽니다 (최대 {request.app.state.settings.max_upload_mb}MB)")
        chunks.append(chunk)
    return b"".join(chunks)


@router.get("/health")
def health(request: Request) -> dict[str, Any]:
    s = request.app.state.settings
    bridge = request.app.state.bridge
    ai = request.app.state.ai
    return {
        "ok": True,
        "app": "FORM3D",
        "version": APP_VERSION,
        "dataDir": str(s.data_dir),
        "ai": ai.describe_active(),
        "externalApi": {
            "base": f"http://127.0.0.1:{s.port}/api/v1",
            "tokenFile": str(request.app.state.tokens.token_file),
            "editorConnected": bridge.connected,
            "policy": bridge.policy,
            "scopes": SCOPE_DESCRIPTIONS,
        },
    }


# ------------------------------------------------------------ 프로젝트

@router.get("/projects")
def list_projects(request: Request) -> dict[str, Any]:
    return {"projects": request.app.state.store.list()}


@router.post("/projects")
async def create_project(request: Request, name: str | None = None) -> dict[str, Any]:
    data = await _read_body(request)
    try:
        return request.app.state.store.create(data, name)
    except StoreError as e:
        raise _store_error(e)


@router.put("/projects/{pid}")
async def save_project(pid: str, request: Request, name: str | None = None) -> dict[str, Any]:
    data = await _read_body(request)
    try:
        return request.app.state.store.save(pid, data, name)
    except StoreError as e:
        raise _store_error(e)


class RenameBody(BaseModel):
    name: str = Field(min_length=1, max_length=120)


@router.patch("/projects/{pid}")
def rename_project(pid: str, body: RenameBody, request: Request) -> dict[str, Any]:
    try:
        return request.app.state.store.rename(pid, body.name)
    except StoreError as e:
        raise _store_error(e)


@router.get("/projects/{pid}")
def get_project(pid: str, request: Request) -> dict[str, Any]:
    try:
        return request.app.state.store.get(pid)
    except StoreError as e:
        raise _store_error(e)


@router.get("/projects/{pid}/file")
def download_project(pid: str, request: Request) -> Response:
    try:
        data = request.app.state.store.read(pid)
    except StoreError as e:
        raise _store_error(e)
    return Response(data, media_type="application/octet-stream", headers={"Cache-Control": "no-store"})


@router.get("/projects/{pid}/thumbnail")
def project_thumbnail(pid: str, request: Request) -> Response:
    try:
        data = request.app.state.store.thumbnail(pid)
    except StoreError as e:
        raise _store_error(e)
    if not data:
        raise api_error(404, "not_found", "미리보기가 없습니다")
    return Response(data, media_type="image/png", headers={"Cache-Control": "no-cache"})


@router.get("/projects/{pid}/versions")
def project_versions(pid: str, request: Request) -> dict[str, Any]:
    try:
        return {"versions": request.app.state.store.versions(pid)}
    except StoreError as e:
        raise _store_error(e)


@router.get("/projects/{pid}/versions/{vid}")
def project_version_file(pid: str, vid: str, request: Request) -> Response:
    try:
        data = request.app.state.store.read_version(pid, vid)
    except StoreError as e:
        raise _store_error(e)
    return Response(data, media_type="application/octet-stream", headers={"Cache-Control": "no-store"})


# ------------------------------------------------------------ AI

class PlanBody(BaseModel):
    text: str = Field(min_length=1, max_length=2000)
    scene: dict[str, Any] | None = None
    conversation: str | None = Field(default=None, min_length=4, max_length=80)
    provider: str | None = None
    model: str | None = Field(default=None, max_length=200)


@router.post("/ai/plan")
async def ai_plan(body: PlanBody, request: Request) -> dict[str, Any]:
    """자연어 → 계획/질문/답변/거절. 실행은 하지 않습니다(편집기에서 사용자가 실행)."""
    manager = request.app.state.ai
    if body.provider and body.provider not in manager.providers:
        raise api_error(404, "not_found", "알 수 없는 AI 제공자입니다")
    try:
        out = await run_in_threadpool(manager.assist, body.text, body.scene, body.conversation, "assistant",
                                      body.provider, body.model)
    except AIError as e:
        raise api_error(e.status, e.code, e.message, hint=e.hint)
    return {"jobId": cmd.new_job_id(), **out}
