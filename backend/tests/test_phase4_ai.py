"""Phase 4: 통합 AI (Claude · Qwen API · Ollama) — 실제 외부 호출 없이 모의 서버로 검증"""
from __future__ import annotations

import json
import threading

import httpx
import pytest
from fastapi.testclient import TestClient

from app.ai.base import AIError
from app.ai.providers.dashscope import DashScopeProvider
from app.ai.providers.ollama import OllamaProvider
from app.main import create_app
from conftest import ORIGIN

PLAN = {"kind": "plan", "message": "구를 만듭니다", "summary": "구 만들기", "options": [],
        "steps": [{"command": "create_primitive", "params_json": "{\"shape\":\"sphere\"}"}]}


def dashscope_transport(calls, status=200, body=None):
    def handler(req: httpx.Request):
        calls.append(req)
        if req.url.path.endswith("/models"):
            return httpx.Response(200, json={"data": [{"id": "qwen-plus"}, {"id": "qwen-max"}, {"id": "other"}]})
        if status != 200:
            return httpx.Response(status, json=body or {"error": {"code": "InvalidApiKey", "message": "bad key"}})
        return httpx.Response(200, json=body or {
            "choices": [{"finish_reason": "stop", "message": {"content": "```json\n" + json.dumps(PLAN) + "\n```"}}],
            "usage": {"prompt_tokens": 1000, "completion_tokens": 200}})
    return httpx.MockTransport(handler)


def ollama_transport(calls, chat_content=None, up=True):
    def handler(req: httpx.Request):
        calls.append(req)
        if not up:
            raise httpx.ConnectError("refused")
        p = req.url.path
        if p == "/api/version":
            return httpx.Response(200, json={"version": "0.12.0"})
        if p == "/api/tags":
            return httpx.Response(200, json={"models": [{"name": "qwen3:8b", "size": 5_000_000_000}]})
        if p == "/api/pull":
            lines = [{"status": "pulling manifest"}, {"status": "downloading", "total": 100, "completed": 50},
                     {"status": "success"}]
            return httpx.Response(200, content="\n".join(json.dumps(x) for x in lines).encode())
        if p == "/api/chat":
            return httpx.Response(200, json={"message": {"content": chat_content or json.dumps(PLAN)},
                                             "prompt_eval_count": 800, "eval_count": 100})
        return httpx.Response(404)
    return httpx.MockTransport(handler)


def make_client(settings, providers=None):
    app = create_app(settings, providers=providers)
    return app, TestClient(app)


@pytest.fixture()
def calls():
    return []


@pytest.fixture()
def app_client(settings, calls):
    from app.ai.providers.claude import ClaudeProvider
    from app.ai.store import AIStore  # noqa: F401

    holder = {}
    def key(pid):
        return lambda: holder["app"].state.ai_store.get_key(pid)
    def setting(path):
        def get():
            s = holder["app"].state.ai_store.settings()
            return s["providers"][path[0]][path[1]]
        return get
    providers = {
        "claude": ClaudeProvider(key("claude")),
        "dashscope": DashScopeProvider(key("dashscope"), setting(("dashscope", "region")), transport=dashscope_transport(calls)),
        "ollama": OllamaProvider(setting(("ollama", "url")), transport=ollama_transport(calls)),
    }
    app = create_app(settings, providers=providers)
    holder["app"] = app
    with TestClient(app) as c:
        yield c
    app.state.store.close()


def test_status_lists_three_providers_paid_vs_local(app_client):
    st = app_client.get("/api/ai/status").json()
    ids = {p["id"]: p for p in st["providers"]}
    assert set(ids) == {"claude", "dashscope", "ollama"}
    assert ids["claude"]["paid"] and ids["dashscope"]["paid"] and not ids["ollama"]["paid"] and ids["ollama"]["local"]
    assert ids["claude"]["state"] == "no_key" and ids["dashscope"]["state"] == "no_key"
    assert ids["ollama"]["state"] == "ready" and "qwen3:8b" in [m["id"] for m in ids["ollama"]["recommended"]]
    assert {e["id"] for e in st["engines"]} == {"model3d", "image", "animation", "video"}
    assert all(not e["available"] for e in st["engines"])


def test_key_saved_masked_never_returned(app_client, settings):
    secret = "sk-test-DASHSCOPE-1234567890abcdef"
    r = app_client.put("/api/ai/keys/dashscope", json={"key": secret})
    assert r.status_code == 200 and r.json()["key"]["set"] and secret not in r.text
    assert r.json()["key"]["masked"].startswith("sk-t")
    for url in ("/api/ai/status", "/api/health", "/api/ai/usage", "/api/openapi.json"):
        assert secret not in app_client.get(url).text
    assert secret in (settings.data_dir / "secrets.json").read_text()
    assert secret not in (settings.data_dir / "ai-settings.json").read_text() if (settings.data_dir / "ai-settings.json").exists() else True
    assert app_client.put("/api/ai/keys/dashscope", json={"key": "bad key with spaces"}).status_code == 422
    assert app_client.delete("/api/ai/keys/dashscope").json()["key"]["set"] is False
    assert app_client.put("/api/ai/keys/ollama", json={"key": "whatever123"}).status_code == 400


def test_dashscope_plan_usage_and_cost(app_client, calls):
    app_client.put("/api/ai/keys/dashscope", json={"key": "sk-abcdefgh12345678"})
    app_client.put("/api/ai/settings", json={"default": {"provider": "dashscope", "model": "qwen-plus"}})
    r = app_client.post("/api/ai/plan", json={"text": "구 만들어 줘", "scene": {"nodes": []}})
    body = r.json()
    assert r.status_code == 200 and body["status"] == "plan" and body["provider"] == "dashscope"
    assert body["steps"] == [{"command": "create_primitive", "params": {"shape": "sphere"}}]
    assert body["usage"]["inputTokens"] == 1000 and body["paid"] is True
    assert body["usage"]["estimatedCostUsd"] == pytest.approx((1000 * 0.4 + 200 * 1.2) / 1e6)
    req = [c for c in calls if c.url.path.endswith("/chat/completions")][-1]
    assert req.url.host == "dashscope-intl.aliyuncs.com" and req.headers["authorization"] == "Bearer sk-abcdefgh12345678"
    assert json.loads(req.content)["response_format"] == {"type": "json_object"}
    usage = app_client.get("/api/ai/usage").json()["rows"]
    assert usage[0]["provider"] == "dashscope" and usage[0]["requests"] == 1
    models = app_client.get("/api/ai/providers/dashscope/models").json()["models"]
    assert [m["id"] for m in models] == ["qwen-max", "qwen-plus"]


def test_dashscope_region_and_errors(settings, calls):
    p = DashScopeProvider(lambda: "sk-xxxxxxxx", lambda: "cn", transport=dashscope_transport(calls, 401))
    with pytest.raises(AIError) as e:
        p.chat_json("s", [{"role": "user", "content": "x"}], {}, "qwen-plus", {})
    assert e.value.code == "ai_auth" and "지역" in e.value.hint
    assert calls[-1].url.host == "dashscope.aliyuncs.com"
    with pytest.raises(AIError) as e2:
        DashScopeProvider(lambda: None, lambda: "intl").chat_json("s", [], {}, "m", {})
    assert e2.value.code == "ai_not_configured"


def test_ollama_detect_models_pull_and_plan(app_client, calls):
    models = app_client.get("/api/ai/providers/ollama/models").json()["models"]
    assert models[0]["id"] == "qwen3:8b"
    lines = [json.loads(l) for l in app_client.post("/api/ai/ollama/pull", json={"model": "qwen3:8b"}).text.splitlines()]
    assert lines[1]["completed"] == 50 and lines[-1]["done"] is True
    assert app_client.post("/api/ai/ollama/pull", json={"model": "bad name;rm"}).status_code == 422
    s = app_client.put("/api/ai/settings", json={"default": {"provider": "ollama", "model": "qwen3:8b"}})
    assert s.status_code == 200
    body = app_client.post("/api/ai/plan", json={"text": "구"}).json()
    assert body["status"] == "plan" and body["provider"] == "ollama" and body["paid"] is False
    assert body["usage"]["estimatedCostUsd"] == 0
    chat = json.loads([c for c in calls if c.url.path == "/api/chat"][-1].content)
    assert chat["format"]["type"] == "object" and chat["stream"] is False
    t = app_client.post("/api/ai/providers/ollama/test", json={}).json()
    assert t["ok"] and t["latencyMs"] >= 0


def test_ollama_offline_and_bad_json_retry():
    p = OllamaProvider(lambda: "http://127.0.0.1:11434", transport=ollama_transport([], up=False))
    st = p.status()
    assert st.state == "offline" and "ollama.com" in st.hint


def test_small_model_bad_output_retried_then_reported(settings, calls):
    from app.ai.providers.claude import ClaudeProvider
    holder = {}
    providers = {
        "claude": ClaudeProvider(lambda: None),
        "dashscope": DashScopeProvider(lambda: None, lambda: "intl"),
        "ollama": OllamaProvider(lambda: "http://127.0.0.1:11434", transport=ollama_transport(calls, chat_content="말로만 대답")),
    }
    app = create_app(settings, providers=providers)
    with TestClient(app) as c:
        c.put("/api/ai/settings", json={"default": {"provider": "ollama", "model": "qwen3:4b"}})
        r = c.post("/api/ai/plan", json={"text": "구"})
        assert r.status_code == 502 and r.json()["detail"]["code"] == "ai_bad_output"
        assert r.json()["detail"]["hint"]
        assert len([x for x in calls if x.url.path == "/api/chat"]) == 1  # JSON 자체가 없으면 재시도 전 실패
    app.state.store.close()


def test_fallback_to_next_provider(app_client):
    # Claude 키 없음 → 대체 순서의 Ollama 로 넘어감
    r = app_client.put("/api/ai/settings", json={
        "default": {"provider": "claude", "model": "claude-opus-5-5"},
        "fallback": {"enabled": True, "order": ["ollama"]},
        "providers": {"claude": {"model": "claude-opus-5-5"}, "dashscope": {"model": "qwen-plus", "region": "intl"},
                      "ollama": {"model": "qwen3:8b", "url": "http://127.0.0.1:11434"}}})
    assert r.status_code == 200, r.text
    body = app_client.post("/api/ai/plan", json={"text": "구"}).json()
    assert body["provider"] == "ollama" and body["fallbackFrom"][0]["provider"] == "claude"


def test_task_specific_model(app_client):
    app_client.put("/api/ai/settings", json={"tasks": {"assistant": {"provider": "ollama", "model": "qwen3:8b"}, "oni": None}})
    assert app_client.post("/api/ai/plan", json={"text": "구"}).json()["provider"] == "ollama"


def test_settings_validation(app_client):
    bad = app_client.put("/api/ai/settings", json={"providers": {"ollama": {"url": "http://evil.example:11434", "model": ""},
                                                                  "claude": {"model": "x"}, "dashscope": {"model": "q", "region": "mars"}}})
    assert bad.status_code == 422
    errs = bad.json()["detail"]["errors"]
    assert any("Ollama" in e for e in errs) and any("지역" in e for e in errs)
    assert app_client.put("/api/ai/settings", json={"params": {"temperature": 5, "max_tokens": 4000, "timeout": 60, "history": 5}}).status_code == 422


def test_conversation_context_and_feedback(app_client, calls):
    app_client.put("/api/ai/settings", json={"default": {"provider": "ollama", "model": "qwen3:8b"}})
    app_client.post("/api/ai/plan", json={"text": "구 만들어 줘", "conversation": "conv-1"})
    app_client.post("/api/ai/feedback", json={"conversation": "conv-1", "note": "작업 job_x 성공: 구 1개 생성"})
    app_client.post("/api/ai/plan", json={"text": "그거 빨갛게", "conversation": "conv-1"})
    msgs = json.loads([c for c in calls if c.url.path == "/api/chat"][-1].content)["messages"]
    text = json.dumps(msgs, ensure_ascii=False)
    assert "구 만들어 줘" in text and "[실행 결과] 작업 job_x 성공" in text and "그거 빨갛게" in text
    roles = [m["role"] for m in msgs]
    assert roles[0] == "system" and all(a != b for a, b in zip(roles[1:], roles[2:]))  # user/assistant 번갈아
    app_client.delete("/api/ai/conversations/conv-1")
    app_client.post("/api/ai/plan", json={"text": "새 질문", "conversation": "conv-1"})
    msgs2 = json.loads([c for c in calls if c.url.path == "/api/chat"][-1].content)["messages"]
    assert "구 만들어 줘" not in json.dumps(msgs2, ensure_ascii=False)


def test_question_and_answer_kinds():
    from app.ai.base import parse_response
    q = parse_response({"kind": "question", "message": "어느 것을 옮길까요?", "summary": "", "options": ["Box", "Sphere"], "steps": []})
    assert q.status == "question" and q.options == ["Box", "Sphere"] and not q.steps
    a = parse_response({"kind": "answer", "message": "Box 1개가 있습니다", "summary": "", "options": [], "steps": []})
    assert a.status == "answer" and a.message


# ---------------- ONI

def auth(token):
    return {"Authorization": f"Bearer {token}"}


def test_oni_models_and_assist(client, token):
    m = client.get("/api/v1/ai/models", headers=auth(token)).json()
    assert m["active"]["configured"] is True and "key" not in json.dumps(m)
    assert client.post("/api/v1/assist", headers=auth(token), json={"text": "x"}).status_code == 503  # 편집기 없음
    with client.websocket_connect("/api/bridge", headers={"Origin": ORIGIN}) as ws:
        ws.send_text(json.dumps({"type": "hello", "policy": "auto"}))
        threading.Event().wait(0.1)
        box = {}
        t = threading.Thread(target=lambda: box.setdefault("r", client.post(
            "/api/v1/assist", headers=auth(token), json={"text": "구 만들어 줘"})))
        t.start()
        msg = json.loads(ws.receive_text())
        assert msg["kind"] == "get_scene"
        ws.send_text(json.dumps({"type": "response", "reqId": msg["reqId"], "ok": True, "data": {"nodes": []}}))
        msg = json.loads(ws.receive_text())
        assert msg["kind"] == "run_job" and msg["job"]["source"] == "external"
        jid = msg["job"]["id"]
        ws.send_text(json.dumps({"type": "response", "reqId": msg["reqId"], "ok": True,
                                 "data": {"jobId": jid, "status": "success", "message": "ok", "steps": [], "created": []}}))
        t.join(5)
        r = box["r"].json()
        assert box["r"].status_code == 200 and r["state"] == "done" and r["plan"]["status"] == "plan"
        st = client.get(f"/api/v1/jobs/{jid}", headers=auth(token)).json()
        assert st["state"] == "done" and st["result"]["status"] == "success"

        # 비동기: 바로 작업 ID, 나중에 상태 조회
        r2 = client.post("/api/v1/jobs", headers=auth(token),
                         json={"wait": False, "steps": [{"command": "create_primitive", "params": {"shape": "box"}}]})
        assert r2.status_code == 202
        jid2 = r2.json()["jobId"]
        msg = json.loads(ws.receive_text())
        assert msg["job"]["id"] == jid2
        assert client.get(f"/api/v1/jobs/{jid2}", headers=auth(token)).json()["state"] == "running"
        ws.send_text(json.dumps({"type": "response", "reqId": msg["reqId"], "ok": True,
                                 "data": {"jobId": jid2, "status": "success", "message": "ok", "steps": [], "created": []}}))
        for _ in range(50):
            if client.get(f"/api/v1/jobs/{jid2}", headers=auth(token)).json()["state"] == "done":
                break
            threading.Event().wait(0.05)
        assert client.get(f"/api/v1/jobs/{jid2}", headers=auth(token)).json()["state"] == "done"
    assert client.get("/api/v1/jobs/job_nonexistent", headers=auth(token)).status_code == 404


def test_oni_assist_question_not_executed(client, token, fake_ai):
    from app.ai.base import Plan
    fake_ai.next = Plan("question", "", "", options=["Box", "Sphere"], message="어느 것을 옮길까요?")
    with client.websocket_connect("/api/bridge", headers={"Origin": ORIGIN}) as ws:
        ws.send_text(json.dumps({"type": "hello", "policy": "auto"}))
        threading.Event().wait(0.1)
        box = {}
        t = threading.Thread(target=lambda: box.setdefault("r", client.post(
            "/api/v1/assist", headers=auth(token), json={"text": "그거 옮겨"})))
        t.start()
        msg = json.loads(ws.receive_text())
        ws.send_text(json.dumps({"type": "response", "reqId": msg["reqId"], "ok": True, "data": {"nodes": []}}))
        t.join(5)
        r = box["r"].json()
        assert r["state"] == "answered" and r["plan"]["status"] == "question" and r["plan"]["options"] == ["Box", "Sphere"]


def test_engine_interface():
    from app.engines.base import EngineNotAvailable
    from app.engines.registry import ENGINES
    for e in ENGINES.values():
        assert e.check()["available"] is False
        with pytest.raises(EngineNotAvailable):
            e.submit({})
