from __future__ import annotations

from app.ai.provider import AIError, Plan, parse_plan
from app.core import commands as cmd


def test_rejects_foreign_origin_and_host(client):
    assert client.get("/api/health", headers={"Origin": "http://localhost:5173"}).status_code == 200
    r = client.get("/api/health", headers={"Origin": "https://evil.example"})
    assert r.status_code == 403
    assert client.post("/api/projects", content=b"x", headers={"Origin": "https://evil.example"}).status_code == 403
    assert client.get("/api/health", headers={"Host": "evil.example"}).status_code == 403


def test_rejects_non_local_client(settings, fake_ai):
    from fastapi.testclient import TestClient
    from app.main import create_app

    app = create_app(settings, ai=fake_ai)
    with TestClient(app, client=("192.168.0.10", 5555)) as c:
        r = c.get("/api/health")
        assert r.status_code == 403
        assert "같은 컴퓨터" in r.json()["detail"]["message"]
    app.state.store.close()


def test_health_never_contains_api_key(settings, fake_ai):
    from fastapi.testclient import TestClient
    from app.main import create_app

    settings.anthropic_api_key = "sk-ant-secret-should-not-leak"
    app = create_app(settings, ai=fake_ai)
    with TestClient(app) as c:
        body = c.get("/api/health").text
        assert "sk-ant" not in body
        assert c.get("/api/health").json()["ai"]["configured"] is True  # fake provider 연결됨
        assert "sk-ant" not in c.get("/api/openapi.json").text
    app.state.store.close()


def test_ai_not_configured_returns_503(settings):
    from fastapi.testclient import TestClient
    from app.main import create_app

    app = create_app(settings, ai=None)
    with TestClient(app) as c:
        r = c.post("/api/ai/plan", json={"text": "큐브 하나 만들어 줘"})
        assert r.status_code == 503 and r.json()["detail"]["code"] == "ai_not_configured"
        assert c.get("/api/health").json()["ai"]["configured"] is False
    app.state.store.close()


def test_ai_plan_passes_scene_and_returns_job(client, fake_ai):
    scene = {"projectName": "x", "objects": []}
    r = client.post("/api/ai/plan", json={"text": "큐브 하나 만들어 줘", "scene": scene})
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "plan" and body["steps"][0]["command"] == "create_primitive"
    assert cmd.JOB_ID.match(body["jobId"])
    assert fake_ai.calls == [("큐브 하나 만들어 줘", scene)]


def test_ai_errors_are_reported(client, fake_ai):
    fake_ai.next = AIError(502, "ai_auth", "API 키가 올바르지 않습니다")
    r = client.post("/api/ai/plan", json={"text": "큐브"})
    assert r.status_code == 502 and r.json()["detail"]["code"] == "ai_auth"
    fake_ai.next = Plan("reject", "", "이미지 생성은 지원하지 않습니다", [])
    assert client.post("/api/ai/plan", json={"text": "그림 그려줘"}).json()["status"] == "reject"


def test_parse_plan_validates_ai_output():
    ok = parse_plan({"status": "plan", "summary": "s", "reason": "",
                     "steps": [{"command": "transform", "params_json": '{"translate":[3,0,0]}'}]})
    assert ok.status == "plan" and ok.steps == [{"command": "transform", "params": {"translate": [3, 0, 0]}}]
    bad = parse_plan({"status": "plan", "summary": "s", "reason": "",
                      "steps": [{"command": "transform", "params_json": '{"translate":[3,0]}'}]})
    assert bad.status == "invalid" and "translate" in bad.reason
    unknown = parse_plan({"status": "plan", "summary": "", "reason": "",
                          "steps": [{"command": "run_python", "params_json": '{"code":"import os"}'}]})
    assert unknown.status == "invalid" and "지원하지 않는 명령" in unknown.reason
    try:
        parse_plan({"status": "plan", "summary": "", "reason": "", "steps": [{"command": "delete", "params_json": "{not json"}]})
        raise AssertionError("should fail")
    except AIError as e:
        assert e.code == "ai_bad_output"


def test_claude_provider_request_shape():
    """실제 API 호출 없이, 보내는 요청 형식과 응답 처리를 확인 (모의 클라이언트)."""
    import json
    from types import SimpleNamespace
    from app.ai.base import RESPONSE_SCHEMA, parse_response
    from app.ai.providers.claude import ClaudeProvider

    captured = {}

    class Msgs:
        def create(self, **kw):
            captured.update(kw)
            out = {"kind": "plan", "message": "", "summary": "파란색으로", "options": [],
                   "steps": [{"command": "set_material", "params_json": '{"color":"#1e88e5"}'}]}
            return SimpleNamespace(stop_reason="end_turn", usage=SimpleNamespace(input_tokens=100, output_tokens=20),
                                   content=[SimpleNamespace(type="text", text=json.dumps(out))])

    p = ClaudeProvider(lambda: "k", "low", client=SimpleNamespace(messages=Msgs()))
    raw, usage = p.chat_json("sys", [{"role": "user", "content": "x"}], RESPONSE_SCHEMA, "claude-opus-5-5", {"max_tokens": 4000})
    plan = parse_response(raw)
    assert plan.status == "plan" and plan.steps[0]["params"]["color"] == "#1e88e5"
    assert usage.input_tokens == 100 and usage.output_tokens == 20
    assert captured["model"] == "claude-opus-5-5"
    assert "tool_choice" not in captured and "thinking" not in captured
    assert captured["output_config"]["format"]["type"] == "json_schema"
    assert captured["output_config"]["effort"] == "low"

    class Refuse:
        def create(self, **kw):
            return SimpleNamespace(stop_reason="refusal", usage=None, content=[])

    p2 = ClaudeProvider(lambda: "k", client=SimpleNamespace(messages=Refuse()))
    raw2, _ = p2.chat_json("s", [], RESPONSE_SCHEMA, "m", {})
    assert parse_response(raw2).status == "reject"


def test_validator_matches_manifest():
    assert cmd.validate_steps([{"command": "create_primitive", "params": {"shape": "box", "count": 2}}]) == []
    assert cmd.validate_steps([{"command": "set_material", "params": {"color": "blue"}}])
    assert cmd.validate_steps([{"command": "__proto__", "params": {}}])
    assert cmd.validate_steps([{"command": "select", "params": {"target": {"names": []}}}])
    assert cmd.validate_steps([{"command": "frame"}] * 31)
    assert cmd.validate_steps([{"command": "frame", "params": {}, "code": "x"}])
    assert cmd.required_scopes([{"command": "set_view", "params": {"preset": "top"}}]) == {"view"}
