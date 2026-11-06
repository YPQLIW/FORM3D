"""편집기 연결 통로 (WebSocket).

외부 AI(온이)가 보낸 명령은 서버가 직접 실행하지 않고, 열려 있는 FORM3D 편집기로 전달됩니다.
편집기는 자신의 설정(거부 / 확인 후 실행 / 자동 실행)에 따라 처리하고 결과를 돌려줍니다.
"""
from __future__ import annotations

import asyncio
import json
import secrets
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

router = APIRouter()
POLICIES = ("deny", "confirm", "auto")


class BridgeError(Exception):
    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


class EditorBridge:
    def __init__(self) -> None:
        self.ws: WebSocket | None = None
        self.policy: str = "confirm"
        self.editor_info: dict[str, Any] = {}
        self._pending: dict[str, asyncio.Future[Any]] = {}

    @property
    def connected(self) -> bool:
        return self.ws is not None

    async def attach(self, ws: WebSocket) -> None:
        if self.ws is not None:
            try:
                await self.ws.close(code=4000, reason="다른 편집기 창이 연결되었습니다")
            except Exception:
                pass
        self.ws = ws

    def detach(self, ws: WebSocket) -> None:
        if self.ws is ws:
            self.ws = None
            for fut in self._pending.values():
                if not fut.done():
                    fut.set_exception(BridgeError(503, "editor_disconnected", "편집기 연결이 끊어졌습니다"))
            self._pending.clear()

    def handle(self, msg: dict[str, Any]) -> None:
        t = msg.get("type")
        if t in ("hello", "policy"):
            if msg.get("policy") in POLICIES:
                self.policy = msg["policy"]
            if t == "hello":
                self.editor_info = {"app": str(msg.get("app", ""))[:40], "version": str(msg.get("version", ""))[:20]}
        elif t == "response":
            fut = self._pending.pop(str(msg.get("reqId")), None)
            if fut and not fut.done():
                if msg.get("ok"):
                    fut.set_result(msg.get("data"))
                else:
                    err = msg.get("error") or {}
                    fut.set_exception(BridgeError(int(err.get("status", 400)), str(err.get("code", "editor_error")),
                                                  str(err.get("message", "편집기에서 처리하지 못했습니다"))))

    async def request(self, kind: str, payload: dict[str, Any] | None = None, timeout: float = 15.0) -> Any:
        ws = self.ws
        if ws is None:
            raise BridgeError(503, "editor_not_connected", "FORM3D 편집기가 열려 있지 않습니다. 편집기를 먼저 실행하세요")
        req_id = secrets.token_hex(8)
        fut: asyncio.Future[Any] = asyncio.get_running_loop().create_future()
        self._pending[req_id] = fut
        try:
            await ws.send_text(json.dumps({"type": "request", "reqId": req_id, "kind": kind, **(payload or {})}, ensure_ascii=False))
            return await asyncio.wait_for(fut, timeout)
        except asyncio.TimeoutError as e:
            raise BridgeError(504, "editor_timeout", "편집기가 제한 시간 안에 응답하지 않았습니다") from e
        finally:
            self._pending.pop(req_id, None)


@router.websocket("/api/bridge")
async def bridge_ws(ws: WebSocket) -> None:
    settings = ws.app.state.settings
    # 브라우저 편집기만 연결 가능 (Origin 필수 + 허용 목록)
    if ws.headers.get("origin") not in settings.allowed_origins:
        await ws.close(code=4403)
        return
    bridge: EditorBridge = ws.app.state.bridge
    await ws.accept()
    await bridge.attach(ws)
    try:
        while True:
            text = await ws.receive_text()
            if len(text) > 5_000_000:
                continue
            try:
                msg = json.loads(text)
            except ValueError:
                continue
            if isinstance(msg, dict):
                bridge.handle(msg)
    except WebSocketDisconnect:
        pass
    finally:
        bridge.detach(ws)
