"""Phase 4.5: 실제 대화형 AI Assistant — Qwen 연결 수정, 대화 맥락, 온이 대화 이어가기 (모의 서버)"""
from __future__ import annotations

import json
import threading

import httpx
import pytest

from app.ai.base import AIError, Plan
from app.ai.providers.dashscope import DashScopeProvider, usable_model
from conftest import ORIGIN
from test_phase4_ai import PLAN, app_client, calls, dashscope_transport  # noqa: F401


def auth(t):
    return {"Authorization": f"Bearer {t}"}


def test_dashscope_disables_thinking_and_filters_models(calls):  # noqa: F811
    p = DashScopeProvider(lambda: "sk-xxxxxxxx", lambda: "intl", transport=dashscope_transport(calls))
    p.chat_json("s", [{"role": "user", "content": "x"}], {}, "qwen3-235b-a22b", {})
    body = json.loads(calls[-1].content)
    assert body["enable_thinking"] is False and body["model"] == "qwen3-235b-a22b"
    assert usable_model("qwen-plus") and usable_model("qwen3-32b")
    assert not any(usable_model(m) for m in ["qwq-plus", "qwen3-235b-a22b-thinking-2507", "qwen-vl-max", "qwen-omni-turbo", "other"])


@pytest.mark.parametrize("status,msg,code,hint_word", [
    (400, "parameter.enable_thinking must be set to false for non-streaming calls", "ai_model_unsupported", "qwen-plus"),
    (400, "This model only support stream mode", "ai_model_unsupported", "qwen-plus"),
    (401, "Incorrect API key provided", "ai_auth", "지역"),
    (403, "Model access denied", "ai_auth", "활성화"),
])
def test_dashscope_error_classification(calls, status, msg, code, hint_word):  # noqa: F811
    t = dashscope_transport(calls, status, {"error": {"code": "x", "message": msg}})
    with pytest.raises(AIError) as e:
        DashScopeProvider(lambda: "sk-xxxxxxxx", lambda: "intl", transport=t).chat_json("s", [], {}, "qwen-plus", {})
    assert e.value.code == code and hint_word in e.value.hint
    if code == "ai_model_unsupported":
        assert msg in e.value.message  # 원래 오류 문장도 보여 줌


def test_dashscope_timeout_is_classified():
    def handler(req):
        raise httpx.ReadTimeout("slow")
    with pytest.raises(AIError) as e:
        DashScopeProvider(lambda: "sk-xxxxxxxx", lambda: "intl", transport=httpx.MockTransport(handler)).chat_json(
            "s", [], {}, "qwen-plus", {"timeout": 180})
    assert e.value.code == "ai_timeout"


def test_default_timeout_180_and_old_120_raised(app_client):  # noqa: F811
    store = app_client.app.state.ai_store
    assert store.settings()["params"]["timeout"] == 180
    s = store.settings()
    s["params"]["timeout"] = 120
    store.save_settings(s)
    assert store.settings()["params"]["timeout"] == 180
    s["params"]["timeout"] = 300
    store.save_settings(s)
    assert store.settings()["params"]["timeout"] == 300


def test_conversation_remembers_created_object(app_client, calls):  # noqa: F811
    """원기둥 생성 → 실행 결과(id) 기록 → '조금 더 크게' 요청에 이전 대화·결과·recentlyCreated 가 함께 전달됨"""
    app_client.put("/api/ai/keys/dashscope", json={"key": "sk-abcdefgh12345678"})
    app_client.put("/api/ai/settings", json={"default": {"provider": "dashscope", "model": "qwen-plus"}})
    conv = "conv_test_1"
    r = app_client.post("/api/ai/plan", json={"text": "원기둥 하나 만들어 줘", "scene": {"nodes": []}, "conversation": conv})
    assert r.status_code == 200
    app_client.post("/api/ai/feedback", json={"conversation": conv, "note": "작업 job_a: 성공 — 완료 (만든 것: Cylinder(id u-cyl-1))"})
    scene = {"nodes": [{"id": "u-cyl-1", "name": "Cylinder"}], "recentlyCreated": [{"id": "u-cyl-1", "name": "Cylinder"}]}
    app_client.post("/api/ai/plan", json={"text": "조금 더 크게 해줘", "scene": scene, "conversation": conv})
    msgs = json.loads([c for c in calls if c.url.path.endswith("/chat/completions")][-1].content)["messages"]
    text = json.dumps(msgs, ensure_ascii=False)
    assert "원기둥 하나 만들어 줘" in text and "u-cyl-1" in text and "recentlyCreated" in text and "조금 더 크게" in text
    assert msgs[0]["role"] == "system" and "scale_by 1.25" in msgs[0]["content"]
    roles = [m["role"] for m in msgs[1:]]
    assert all(a != b for a, b in zip(roles, roles[1:]))  # user/assistant 번갈아


def test_oni_assist_continues_conversation(client, token, fake_ai):
    """온이: 실행 결과(만든 오브젝트 id)가 같은 대화에 남아 다음 요청에서 쓰임"""
    fake_ai.next = Plan("plan", "원기둥 만들기", "", [{"command": "create_primitive", "params": {"shape": "cylinder"}}],
                        message="원기둥을 하나 만들겠습니다.")
    with client.websocket_connect("/api/bridge", headers={"Origin": ORIGIN}) as ws:
        ws.send_text(json.dumps({"type": "hello", "policy": "auto"}))
        threading.Event().wait(0.1)
        box = {}
        t = threading.Thread(target=lambda: box.setdefault("r", client.post(
            "/api/v1/assist", headers=auth(token), json={"text": "원기둥 하나 만들어 줘", "conversation": "oni-chat-1"})))
        t.start()
        msg = json.loads(ws.receive_text())
        ws.send_text(json.dumps({"type": "response", "reqId": msg["reqId"], "ok": True, "data": {"nodes": []}}))
        msg = json.loads(ws.receive_text())
        jid = msg["job"]["id"]
        ws.send_text(json.dumps({"type": "response", "reqId": msg["reqId"], "ok": True, "data": {
            "jobId": jid, "status": "success", "message": "1개 단계 완료", "steps": [],
            "created": [{"id": "u-cyl-9", "name": "Cylinder"}]}}))
        t.join(5)
    r = box["r"].json()
    assert r["state"] == "done" and r["conversation"] == "oni-chat-1" and r["plan"]["message"] == "원기둥을 하나 만들겠습니다."
    hist = json.dumps(client.app.state.ai_store.history("oni-chat-1", 20), ensure_ascii=False)
    assert "원기둥 하나 만들어 줘" in hist and "Cylinder(id u-cyl-9)" in hist


def test_server_serves_editor_for_desktop_app(tmp_path):
    """설치형 프로그램: 서버 하나가 편집기 화면과 API를 같은 주소로 제공"""
    from fastapi.testclient import TestClient

    from app.core.config import Settings
    from app.main import create_app
    web = tmp_path / "web"
    (web / "assets").mkdir(parents=True)
    (web / "index.html").write_text("<html>FORM3D</html>", encoding="utf-8")
    (web / "assets" / "a.js").write_text("console.log(1)", encoding="utf-8")
    s = Settings(data_dir=tmp_path / "data", port=8765, web_dist=web)
    assert "http://127.0.0.1:8765" in s.allowed_origins
    app = create_app(s)
    with TestClient(app) as c:
        assert "FORM3D" in c.get("/").text and c.get("/assets/a.js").status_code == 200
        assert c.get("/api/health").json()["ok"] is True
        r = c.put("/api/ai/settings", json={"params": {"temperature": 0.2, "max_tokens": 4000, "timeout": 200, "history": 12}},
                  headers={"Origin": "http://127.0.0.1:8765"})
        assert r.status_code == 200
        assert c.get("/api/health", headers={"Origin": "http://evil.example"}).status_code == 403
    app.state.store.close()
