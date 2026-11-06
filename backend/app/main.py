"""FORM3D 로컬 서버 진입점.

실행:  python -m app.main     (backend 폴더에서)
기본 주소 http://127.0.0.1:8765  — 이 컴퓨터에서만 접근 가능합니다.
"""
from __future__ import annotations

from typing import Any

from fastapi import FastAPI

from .ai.manager import AIManager
from .ai.store import AIStore
from .api import ai_settings, bridge, jobs, local, v1
from .core.config import APP_VERSION, Settings, load_settings
from .core.security import LocalOnlyMiddleware, TokenStore
from .storage.store import ProjectStore


def create_app(settings: Settings | None = None, ai: Any = None, providers: dict[str, Any] | None = None) -> FastAPI:
    """ai: 테스트 전용 계획기(정해진 답) · providers: 테스트용 제공자 교체"""
    settings = settings or load_settings()
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    app = FastAPI(title="FORM3D Local Server", version=APP_VERSION, docs_url="/api/docs", redoc_url=None,
                  openapi_url="/api/openapi.json")
    app.state.settings = settings
    app.state.store = ProjectStore(settings.data_dir, settings.versions_to_keep)
    app.state.tokens = TokenStore(settings.data_dir)
    app.state.bridge = bridge.EditorBridge()
    app.state.ai_store = AIStore(settings.data_dir, app.state.store.db, {"claude": settings.anthropic_api_key})
    app.state.ai = AIManager(app.state.ai_store, settings.ai_effort, providers=providers, override=ai)
    app.state.jobs = jobs.JobTracker()
    app.include_router(local.router)
    app.include_router(ai_settings.router)
    app.include_router(v1.router)
    app.include_router(bridge.router)
    if settings.web_dist and (settings.web_dist / "index.html").is_file():
        from fastapi.staticfiles import StaticFiles
        # API 경로를 모두 등록한 뒤 마지막에 연결 → /api/... 는 그대로, 나머지는 편집기 화면
        app.mount("/", StaticFiles(directory=settings.web_dist, html=True), name="web")
    app.add_middleware(LocalOnlyMiddleware, settings=settings)
    return app


def main() -> None:
    import sys

    import uvicorn

    # Windows 콘솔(cp1252 등)에서도 한글 출력 때문에 멈추지 않도록
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
        except (AttributeError, ValueError):
            pass
    settings = load_settings()
    app = create_app(settings)
    print(f"[FORM3D] 로컬 서버 시작: http://{settings.host}:{settings.port}")
    if settings.web_dist:
        print(f"[FORM3D] 편집기 화면 제공: {settings.web_dist}")
    print(f"[FORM3D] 저장 폴더: {settings.data_dir}")
    a = app.state.ai.describe_active()
    print(f"[FORM3D] 기본 AI: {a['label']} · {a['model'] or '모델 미선택'} ({'사용 가능' if a['configured'] else '준비 안 됨 — 화면의 AI 설정(⚙)에서 연결'})")
    print(f"[FORM3D] 외부 API 토큰 파일: {app.state.tokens.token_file}")
    uvicorn.run(app, host=settings.host, port=settings.port, log_level="warning")


if __name__ == "__main__":
    main()
