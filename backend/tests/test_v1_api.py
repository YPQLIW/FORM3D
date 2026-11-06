from __future__ import annotations

import json
import threading

from conftest import ORIGIN, make_form3d


def auth(token):
    return {"Authorization": f"Bearer {token}"}


def test_requires_token(client, token):
    assert client.get("/api/v1/capabilities").status_code == 401
    assert client.get("/api/v1/capabilities", headers=auth("wrong")).status_code == 401
    r = client.get("/api/v1/capabilities", headers=auth(token))
    assert r.status_code == 200
    body = r.json()
    assert body["protocol"] == "form3d.command" and "create_primitive" in body["commands"]
    assert {e["id"] for e in body["engines"]} >= {"image", "animation", "video"}
    assert all(not e["available"] for e in body["engines"])


def test_token_file_stores_hash_only(client, token, settings):
    raw = (settings.data_dir / "api-tokens.json").read_text(encoding="utf-8")
    assert token not in raw and "hash" in raw


def test_engines_not_implemented(client, token):
    r = client.post("/api/v1/engines/video/jobs", headers=auth(token))
    assert r.status_code == 501 and r.json()["detail"]["code"] == "engine_not_available"


def test_scope_enforcement(client):
    limited = client.app.state.tokens.create("readonly", ["scene:read"])
    r = client.post("/api/v1/jobs", headers=auth(limited),
                    json={"steps": [{"command": "create_primitive", "params": {"shape": "box"}}]})
    assert r.status_code == 403 and r.json()["detail"]["missing"] == ["scene:write"]
    assert client.get("/api/v1/projects", headers=auth(limited)).status_code == 403


def test_invalid_job_rejected_with_reasons(client, token):
    r = client.post("/api/v1/jobs", headers=auth(token),
                    json={"steps": [{"command": "exec", "params": {"code": "rm -rf"}}]})
    assert r.status_code == 422
    assert "지원하지 않는 명령" in r.json()["detail"]["errors"][0]


def test_no_editor_returns_503(client, token):
    r = client.post("/api/v1/jobs", headers=auth(token),
                    json={"steps": [{"command": "create_primitive", "params": {"shape": "box"}}]})
    assert r.status_code == 503 and r.json()["detail"]["code"] == "editor_not_connected"


def test_project_list(client, token):
    client.post("/api/projects", content=make_form3d("온이 테스트"))
    r = client.get("/api/v1/projects", headers=auth(token))
    assert r.json()["projects"][0]["name"] == "온이 테스트"


def _call_in_thread(fn):
    box = {}
    t = threading.Thread(target=lambda: box.setdefault("r", fn()))
    t.start()
    return t, box


def test_bridge_forwards_job_to_editor(client, token):
    with client.websocket_connect("/api/bridge", headers={"Origin": ORIGIN}) as ws:
        ws.send_text(json.dumps({"type": "hello", "app": "FORM3D", "version": "0.3.0", "policy": "auto"}))
        # hello 처리 대기
        for _ in range(50):
            if client.app.state.bridge.policy == "auto":
                break
            threading.Event().wait(0.02)
        t, box = _call_in_thread(lambda: client.post(
            "/api/v1/objects", headers=auth(token), json={"shape": "sphere", "color": "#ff0000"}))
        msg = json.loads(ws.receive_text())
        assert msg["type"] == "request" and msg["kind"] == "run_job"
        job = msg["job"]
        assert job["source"] == "external" and job["id"].startswith("job_")
        assert job["steps"] == [{"command": "create_primitive", "params": {"shape": "sphere", "color": "#ff0000"}}]
        result = {"jobId": job["id"], "status": "success", "message": "완료", "steps": [], "created": ["u1"]}
        ws.send_text(json.dumps({"type": "response", "reqId": msg["reqId"], "ok": True, "data": result}))
        t.join(5)
        assert box["r"].status_code == 200 and box["r"].json()["created"] == ["u1"]

        # 씬 조회
        t, box = _call_in_thread(lambda: client.get("/api/v1/scene", headers=auth(token)))
        msg = json.loads(ws.receive_text())
        assert msg["kind"] == "get_scene"
        ws.send_text(json.dumps({"type": "response", "reqId": msg["reqId"], "ok": True, "data": {"objects": [1]}}))
        t.join(5)
        assert box["r"].json() == {"objects": [1]}

        # 편집기가 거절(사용자가 취소)
        t, box = _call_in_thread(lambda: client.delete("/api/v1/objects/abc", headers=auth(token)))
        msg = json.loads(ws.receive_text())
        assert msg["job"]["steps"][0] == {"command": "delete", "params": {"target": {"ids": ["abc"]}}}
        ws.send_text(json.dumps({"type": "response", "reqId": msg["reqId"], "ok": False,
                                 "error": {"status": 409, "code": "cancelled", "message": "사용자가 취소했습니다"}}))
        t.join(5)
        assert box["r"].status_code == 409

        # 정책 deny 이면 편집기로 보내지도 않음
        ws.send_text(json.dumps({"type": "policy", "policy": "deny"}))
        for _ in range(50):
            if client.app.state.bridge.policy == "deny":
                break
            threading.Event().wait(0.02)
        r = client.post("/api/v1/objects", headers=auth(token), json={"shape": "box"})
        assert r.status_code == 403 and r.json()["detail"]["code"] == "rejected_by_policy"


def test_bridge_rejects_foreign_origin(client):
    import pytest
    from starlette.websockets import WebSocketDisconnect

    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/api/bridge", headers={"Origin": "https://evil.example"}) as ws:
            ws.receive_text()
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/api/bridge") as ws:
            ws.receive_text()


def test_editor_timeout(client, token):
    client.app.state.settings.bridge_timeout_s = 0.3
    client.app.state.settings.confirm_timeout_s = 0.3
    with client.websocket_connect("/api/bridge", headers={"Origin": ORIGIN}) as ws:
        ws.send_text(json.dumps({"type": "hello", "policy": "confirm"}))
        threading.Event().wait(0.1)
        r = client.get("/api/v1/project", headers=auth(token))
        assert r.status_code == 504
