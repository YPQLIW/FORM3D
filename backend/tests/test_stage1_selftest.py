"""1단계: 실제 AI 점검 기능 · 대화 기록 조회 · 온이 대화 조회 (모의 Ollama 로 기능 검증)"""
from __future__ import annotations

import json

import httpx

from app.ai.providers.ollama import OllamaProvider
from app.ai.selftest import SelfTest
from test_phase4_ai import app_client, calls  # noqa: F401


def smart_ollama(calls):
    """요청 문장에 따라 그럴듯하게 답하는 가짜 Ollama (점검 기능 자체를 검증하기 위한 것 · 실제 AI 아님)"""
    def reply(kind, **kw):
        return json.dumps({"kind": kind, "message": "", "summary": "", "options": [], "steps": [], **kw}, ensure_ascii=False)

    def step(c, p):
        return {"command": c, "params_json": json.dumps(p)}

    def handler(req: httpx.Request):
        p = req.url.path
        if p == "/api/version":
            return httpx.Response(200, json={"version": "0.12.0"})
        if p == "/api/tags":
            return httpx.Response(200, json={"models": [{"name": "qwen2.5:7b", "size": 4_700_000_000}]})
        b = json.loads(req.content)
        calls.append(b)
        allm = json.dumps(b["messages"], ensure_ascii=False)
        last = b["messages"][-1]["content"]
        t = last[last.rfind("요청:"):]
        if "좋아하는 색이 뭐" in t:
            c = reply("answer", message="초록색이라고 하셨어요." if "초록색이에요" in allm else "모르겠어요.")
        elif "원기둥 하나" in t:
            c = reply("plan", message="원기둥을 하나 만들겠습니다.", steps=[step("create_primitive", {"shape": "cylinder"})])
        elif "조금 더 크게" in t:
            c = reply("plan", message="키우겠습니다.", steps=[step("transform", {"target": {"ids": ["selftest-cyl-1"]}, "scale_by": 1.25})])
        elif "그거 지워" in t:
            c = reply("question", message="어느 것을 지울까요?", options=["Box", "Sphere", "Cylinder"])
        elif "구 3개" in t:
            c = reply("plan", message="만들겠습니다.", steps=[
                step("create_primitive", {"shape": "sphere", "count": 3}), step("distribute", {"target": "created", "axis": "x"}),
                step("set_material", {"target": "created", "color": "#e53935"}), step("group", {"target": "created", "name": "Spheres"})])
        elif "1 더하기 1" in t:
            c = reply("answer", message="2")
        else:
            c = reply("answer", message="안녕하세요! 3D 편집을 도와드려요.")
        return httpx.Response(200, json={"message": {"content": c}, "prompt_eval_count": 500, "eval_count": 40})
    return httpx.MockTransport(handler)


def test_selftest_runs_all_items_and_writes_report(app_client, tmp_path):
    m = app_client.app.state.ai
    calls = []
    m.providers["ollama"] = OllamaProvider(lambda: "http://127.0.0.1:11434", transport=smart_ollama(calls))
    oni_calls = []

    def oni(text, conv):
        oni_calls.append((text, conv))
        return {"_status": 200, "state": "answered", "plan": {"status": "answer", "message": "2개 있습니다.",
                                                              "provider": "ollama", "model": "qwen2.5:7b"}}
    t = SelfTest(m, "ollama", "qwen2.5:7b", oni, tmp_path / "reports")
    t.run()
    st = t.state
    res = {it["no"]: it["result"] for it in st["items"]}
    assert res == {1: "pass", 2: "pass", 3: "pass", 4: "pass", 5: "pass", 6: "skip", 7: "pass", 8: "pass"}, st["items"]
    assert st["state"] == "done" and st["reportPath"] and "실제 AI 모델 테스트" in st["report"]
    assert "초록색이라고" in st["report"] and "(키가 없거나" not in st["report"]
    assert all(b["options"]["num_ctx"] == 8192 for b in calls)
    # 3번: 후속 요청에 실행 결과(만든 원기둥 id)와 recentlyCreated 가 전달됨
    follow = [b for b in calls if "조금 더 크게" in b["messages"][-1]["content"]][0]
    assert "selftest-cyl-1" in json.dumps(follow["messages"], ensure_ascii=False)
    # 임시 대화는 지워짐
    assert all(m.store.history(c, 10) == [] for c in t.convs)


def test_selftest_detects_failures(app_client, tmp_path):
    """모델이 엉뚱하게 답하면 실패로 판정 (기억 못 함 · 되묻지 않음 등)"""
    m = app_client.app.state.ai
    def dumb(req):
        if req.url.path == "/api/version":
            return httpx.Response(200, json={"version": "0.12.0"})
        if req.url.path == "/api/tags":
            return httpx.Response(200, json={"models": [{"name": "tiny:1b"}]})
        return httpx.Response(200, json={"message": {"content": json.dumps(
            {"kind": "answer", "message": "네", "summary": "", "options": [], "steps": []})}})
    m.providers["ollama"] = OllamaProvider(lambda: "http://127.0.0.1:11434", transport=httpx.MockTransport(dumb))
    t = SelfTest(m, "ollama", "tiny:1b", None, tmp_path)
    t.run()
    res = {it["no"]: it["result"] for it in t.state["items"]}
    assert res[2] == "fail" and res[3] == "fail" and res[4] == "fail" and res[5] == "fail" and res[8] == "skip"


def test_selftest_api_and_conversation_history(app_client):
    r = app_client.post("/api/ai/selftest", json={"provider": "claude"})
    assert r.status_code == 409 and "연결 테스트" in r.json()["detail"]["hint"]
    assert app_client.get("/api/ai/selftest/st_nope").status_code == 404
    app_client.post("/api/ai/plan", json={"text": "구 만들어 줘", "conversation": "conv_hist_1"})
    h = app_client.get("/api/ai/conversations/conv_hist_1").json()["messages"]
    assert h[0] == {"role": "user", "content": "구 만들어 줘"} and h[1]["role"] == "assistant"


def test_oni_conversation_history(client, token):
    st = client.app.state.ai_store
    st.append("oni-c1", "user", "원기둥 만들어 줘")
    st.append("oni-c1", "assistant", json.dumps({"kind": "plan", "message": "만들겠습니다.", "summary": "", "steps": []}, ensure_ascii=False))
    st.append("oni-c1", "user", "[실행 결과] 작업 job_a: 성공 — 완료 (만든 것: Cylinder(id u1))")
    r = client.get("/api/v1/conversations/oni-c1", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    msgs = r.json()["messages"]
    assert [x["role"] for x in msgs] == ["user", "assistant", "result"] and msgs[1]["text"] == "만들겠습니다."
    assert client.get("/api/v1/conversations/oni-c1").status_code == 401
