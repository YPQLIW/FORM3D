"""보안: 로컬 전용 접근, 브라우저 출처(Origin) 검사, 외부 API 토큰·권한.

- 서버는 127.0.0.1 에만 열리고, 그래도 들어온 요청 중 이 컴퓨터(loopback)가 아닌 곳은 거절합니다.
- Host 헤더가 localhost/127.0.0.1 이 아니면 거절합니다 (DNS rebinding 방지).
- 브라우저에서 온 요청은 FORM3D 편집기 주소(Origin)만 허용합니다 (다른 웹사이트가 몰래 호출하는 것 방지).
- 외부 AI(온이)용 /api/v1 은 Bearer 토큰 + 권한(scope)이 필요합니다. 토큰은 해시로만 저장합니다.
"""
from __future__ import annotations

import hashlib
import hmac
import ipaddress
import json
import os
import secrets
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import HTTPException, Request
from starlette.types import ASGIApp, Receive, Scope, Send

from .config import Settings

ALL_SCOPES = ["scene:read", "scene:write", "view", "project:read"]
SCOPE_DESCRIPTIONS = {
    "scene:read": "열려 있는 씬·프로젝트 정보 조회",
    "scene:write": "오브젝트 생성·수정·삭제 명령 실행",
    "view": "카메라 시점 변경",
    "project:read": "저장된 프로젝트 목록 조회",
}
LOCAL_HOSTS = {"localhost", "127.0.0.1", "[::1]", "::1"}


def is_loopback(host: str | None) -> bool:
    if not host:
        return False
    if host in ("localhost", "testclient"):
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def _host_name(host_header: str) -> str:
    h = host_header.strip().lower()
    if h.startswith("["):
        return h[: h.find("]") + 1] if "]" in h else h
    return h.rsplit(":", 1)[0] if ":" in h else h


class LocalOnlyMiddleware:
    """HTTP와 WebSocket 모두에 적용되는 로컬 전용 검사."""

    def __init__(self, app: ASGIApp, settings: Settings) -> None:
        self.app = app
        self.settings = settings

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] in ("http", "websocket"):
            client = scope.get("client")
            headers = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope.get("headers", [])}
            host = _host_name(headers.get("host", ""))
            origin = headers.get("origin")
            reason = None
            if not is_loopback(client[0] if client else None):
                reason = "이 서버는 같은 컴퓨터에서만 접근할 수 있습니다"
            elif host not in LOCAL_HOSTS and host != "testserver":
                reason = "허용되지 않은 Host 입니다"
            elif origin is not None and origin not in self.settings.allowed_origins:
                reason = "허용되지 않은 웹 페이지에서 온 요청입니다"
            if reason:
                if scope["type"] == "websocket":
                    await send({"type": "websocket.close", "code": 4403})
                    return
                body = json.dumps({"detail": {"code": "forbidden", "message": reason}}, ensure_ascii=False).encode()
                await send({"type": "http.response.start", "status": 403,
                            "headers": [(b"content-type", b"application/json; charset=utf-8")]})
                await send({"type": "http.response.body", "body": body})
                return
        await self.app(scope, receive, send)


def api_error(status: int, code: str, message: str, **extra: Any) -> HTTPException:
    return HTTPException(status_code=status, detail={"code": code, "message": message, **extra})


# ---------------------------------------------------------------- 토큰

def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


class TokenStore:
    """data_dir/api-tokens.json (해시만 저장). 처음 실행 시 온이용 기본 토큰을 만들어 oni-token.txt 에 적습니다."""

    def __init__(self, data_dir: Path) -> None:
        self.path = data_dir / "api-tokens.json"
        self.token_file = data_dir / "oni-token.txt"
        data_dir.mkdir(parents=True, exist_ok=True)
        if not self.path.exists():
            self.create("oni", ALL_SCOPES, write_file=True)

    def _load(self) -> list[dict[str, Any]]:
        try:
            return json.loads(self.path.read_text(encoding="utf-8")).get("tokens", [])
        except (OSError, ValueError):
            return []

    def _save(self, tokens: list[dict[str, Any]]) -> None:
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps({"tokens": tokens}, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(tmp, self.path)

    def create(self, name: str, scopes: list[str], write_file: bool = False) -> str:
        bad = [s for s in scopes if s not in ALL_SCOPES]
        if bad:
            raise ValueError(f"알 수 없는 권한: {', '.join(bad)}")
        token = "f3d_" + secrets.token_urlsafe(32)
        tokens = self._load()
        tokens.append({
            "id": secrets.token_hex(6),
            "name": name,
            "hash": _hash(token),
            "scopes": scopes,
            "created": datetime.now(timezone.utc).isoformat(),
        })
        self._save(tokens)
        if write_file:
            self.token_file.write_text(
                "# FORM3D 외부 API(온이) 토큰. 다른 사람에게 보여주지 마세요.\n"
                f"# 권한: {', '.join(scopes)}\n{token}\n",
                encoding="utf-8",
            )
        return token

    def verify(self, token: str) -> dict[str, Any] | None:
        h = _hash(token)
        for t in self._load():
            if hmac.compare_digest(t.get("hash", ""), h):
                return t
        return None

    def list(self) -> list[dict[str, Any]]:
        return [{k: v for k, v in t.items() if k != "hash"} for t in self._load()]


def require_token(request: Request) -> dict[str, Any]:
    auth = request.headers.get("authorization", "")
    if not auth.lower().startswith("bearer "):
        raise api_error(401, "unauthorized", "Authorization: Bearer <토큰> 헤더가 필요합니다")
    store: TokenStore = request.app.state.tokens
    info = store.verify(auth[7:].strip())
    if not info:
        raise api_error(401, "unauthorized", "토큰이 올바르지 않습니다")
    return info


def check_scopes(token: dict[str, Any], needed: set[str]) -> None:
    missing = sorted(needed - set(token.get("scopes", [])))
    if missing:
        raise api_error(403, "insufficient_scope", f"이 토큰에는 권한이 없습니다: {', '.join(missing)}", missing=missing)
