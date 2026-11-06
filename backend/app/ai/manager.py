"""통합 AI 관리: 제공자 등록 · 상태 · 기본/작업별 모델 · 대체 모델 · 대화 맥락 · 사용량 기록"""
from __future__ import annotations

import json
import time
from dataclasses import asdict
from typing import Any

from .base import RESPONSE_SCHEMA, AIError, Plan, Provider, Usage, parse_response, system_prompt
from .providers.claude import ClaudeProvider
from .providers.dashscope import REGIONS, DashScopeProvider
from .providers.ollama import RECOMMENDED, OllamaProvider
from .store import PROVIDER_IDS, TASKS, AIStore, mask


class AIManager:
    def __init__(self, store: AIStore, effort: str = "low", providers: dict[str, Provider] | None = None,
                 override: Any = None) -> None:
        self.store = store
        self.override = override  # 테스트 전용: 정해진 답을 주는 계획기
        self.providers: dict[str, Provider] = providers or {
            "claude": ClaudeProvider(lambda: store.get_key("claude"), effort),
            "dashscope": DashScopeProvider(lambda: store.get_key("dashscope"),
                                           lambda: store.settings()["providers"]["dashscope"]["region"]),
            "ollama": OllamaProvider(lambda: store.settings()["providers"]["ollama"]["url"]),
        }

    # ------------------------------------------------ 상태
    def provider_info(self, pid: str, check: bool = True) -> dict[str, Any]:
        p = self.providers[pid]
        s = self.store.settings()
        st = p.status() if check else None
        info: dict[str, Any] = {
            "id": pid, "label": p.label, "paid": p.paid, "local": p.local,
            "state": st.state if st else "unknown", "message": st.message if st else "", "hint": st.hint if st else "",
            "model": s["providers"][pid].get("model", ""),
        }
        if pid in ("claude", "dashscope"):
            info["key"] = {"set": bool(self.store.get_key(pid)), "masked": mask(self.store.get_key(pid)),
                           "source": self.store.key_source(pid)}
        if pid == "dashscope":
            info["region"] = s["providers"]["dashscope"]["region"]
            info["regions"] = {k: v[0] for k, v in REGIONS.items()}
        if pid == "ollama":
            info["url"] = s["providers"]["ollama"]["url"]
            info["recommended"] = [asdict(m) for m in RECOMMENDED]
        return info

    def status(self) -> dict[str, Any]:
        if self.override is not None:
            return {"providers": [], "default": {"provider": "test", "model": self.override.model},
                    "available": True, "test": True}
        providers = [self.provider_info(pid) for pid in PROVIDER_IDS]
        target = self.resolve("assistant")[0]
        ready = next((p for p in providers if p["id"] == target[0]), None)
        return {"providers": providers, "default": self.store.settings()["default"],
                "available": bool(ready and ready["state"] == "ready" and target[1])}

    def describe_active(self) -> dict[str, Any]:
        """health/화면 표시용 (키는 절대 포함하지 않음)"""
        if self.override is not None:
            return {"configured": True, "provider": self.override.name, "model": self.override.model, "paid": False}
        pid, model = self.resolve("assistant")[0]
        p = self.providers[pid]
        configured = p.status().state == "ready" and bool(model)
        return {"configured": configured, "provider": pid if configured else None, "model": model if configured else None,
                "label": p.label, "paid": p.paid, "local": p.local}

    # ------------------------------------------------ 모델 선택
    def resolve(self, task: str) -> list[tuple[str, str]]:
        s = self.store.settings()
        first = s["tasks"].get(task) or s["default"]
        chain = [(first["provider"], first.get("model") or s["providers"][first["provider"]].get("model", ""))]
        if s["fallback"]["enabled"]:
            for pid in s["fallback"]["order"]:
                if pid in self.providers and pid not in [c[0] for c in chain]:
                    chain.append((pid, self.model_for(pid)))
        return chain

    # ------------------------------------------------ 요청
    def _messages(self, text: str, scene: dict[str, Any] | None, conv: str | None) -> list[dict[str, str]]:
        msgs: list[dict[str, str]] = []
        if conv:
            limit = int(self.store.settings()["params"].get("history", 12))
            for m in self.store.history(conv, limit):
                if m["role"] in ("user", "assistant"):
                    if msgs and msgs[-1]["role"] == m["role"]:
                        msgs[-1]["content"] += "\n" + m["content"]
                    else:
                        msgs.append(dict(m))
            if msgs and msgs[0]["role"] == "assistant":
                msgs.insert(0, {"role": "user", "content": "(이전 대화)"})
        content = f"요청: {text}"
        if scene:
            content = "현재 씬 정보(JSON 데이터):\n" + json.dumps(scene, ensure_ascii=False)[:40000] + "\n\n" + content
        if msgs and msgs[-1]["role"] == "user":
            msgs[-1]["content"] += "\n\n" + content
        else:
            msgs.append({"role": "user", "content": content})
        return msgs

    def call(self, pid: str, model: str, system: str, messages: list[dict[str, str]], task: str) -> tuple[dict[str, Any], Usage, int]:
        p = self.providers[pid]
        params = self.store.settings()["params"]
        t0 = time.monotonic()
        try:
            raw, usage = p.chat_json(system, messages, RESPONSE_SCHEMA, model, params)
        except AIError as e:
            ms = int((time.monotonic() - t0) * 1000)
            self.store.record_usage(pid, model, task, 0, 0, False, ms, e.code, p.paid)
            raise
        ms = int((time.monotonic() - t0) * 1000)
        return raw, usage, ms

    def assist(self, text: str, scene: dict[str, Any] | None, conv: str | None = None, task: str = "assistant",
               provider: str | None = None, model: str | None = None) -> dict[str, Any]:
        if self.override is not None:
            plan = self.override.plan(text, scene)
            out = self._out(plan, self.override.name, self.override.model, None, [])
            self._remember(conv, text, out)
            return out
        chain = [(provider, model or self.model_for(provider))] if provider else self.resolve(task)
        messages = self._messages(text, scene, conv)
        system = system_prompt()
        tried: list[dict[str, str]] = []
        last: AIError | None = None
        for pid, mdl in chain:
            if pid not in self.providers:
                continue
            try:
                raw, usage, ms = self.call(pid, mdl, system, messages, task)
                try:
                    plan = parse_response(raw)
                except AIError:
                    # 형식이 틀렸으면 같은 모델로 한 번 더 (작은 로컬 모델 대비)
                    raw, usage2, ms2 = self.call(pid, mdl, system, messages + [
                        {"role": "assistant", "content": json.dumps(raw, ensure_ascii=False)[:2000]},
                        {"role": "user", "content": "형식이 틀렸습니다. 규칙의 JSON 형식으로만 다시 답하세요."}], task)
                    usage = Usage(usage.input_tokens + usage2.input_tokens, usage.output_tokens + usage2.output_tokens)
                    ms += ms2
                    plan = parse_response(raw)
                cost = self.store.record_usage(pid, mdl, task, usage.input_tokens, usage.output_tokens, True, ms,
                                               paid=self.providers[pid].paid)
                plan.usage, plan.latency_ms = usage, ms
                out = self._out(plan, pid, mdl, cost, tried)
                self._remember(conv, text, out)
                return out
            except AIError as e:
                last = e
                tried.append({"provider": pid, "model": mdl, "error": e.message})
                if not e.retryable:
                    break
        assert last is not None
        if len(tried) > 1:
            last.message = last.message + " (대체 모델도 실패: " + ", ".join(f"{t['provider']}" for t in tried[1:]) + ")"
        raise last

    def _out(self, plan: Plan, pid: str, model: str, cost: float | None, tried: list[dict[str, str]]) -> dict[str, Any]:
        p = self.providers.get(pid)
        return {
            "status": plan.status, "summary": plan.summary, "reason": plan.reason, "message": plan.message,
            "options": plan.options, "steps": plan.steps, "provider": pid, "model": model,
            "paid": bool(p.paid) if p else False,
            "usage": {"inputTokens": plan.usage.input_tokens, "outputTokens": plan.usage.output_tokens,
                      "estimatedCostUsd": round(cost, 6) if cost is not None else None},
            "latencyMs": plan.latency_ms, "fallbackFrom": tried,
        }

    def _remember(self, conv: str | None, text: str, out: dict[str, Any]) -> None:
        if not conv:
            return
        self.store.append(conv, "user", text)
        brief = {"kind": out["status"], "message": out["message"] or out["reason"], "summary": out["summary"],
                 "steps": out["steps"][:10]}
        self.store.append(conv, "assistant", json.dumps(brief, ensure_ascii=False))

    def feedback(self, conv: str, note: str) -> None:
        """실행 결과(성공/실패/취소)를 대화에 남겨 다음 계획에 반영"""
        self.store.append(conv, "user", f"[실행 결과] {note}")

    def model_for(self, pid: str) -> str:
        s = self.store.settings()
        m = s["providers"][pid].get("model", "")
        if not m and s["default"]["provider"] == pid:
            m = s["default"].get("model", "")
        return m

    def test(self, pid: str, model: str | None) -> dict[str, Any]:
        mdl = model or self.model_for(pid)
        msgs = [{"role": "user", "content": "요청: 연결 테스트입니다. kind=answer, message='연결 성공'으로 답하세요."}]
        raw, usage, ms = self.call(pid, mdl, system_prompt(), msgs, "test")
        cost = self.store.record_usage(pid, mdl, "test", usage.input_tokens, usage.output_tokens, True, ms,
                                       paid=self.providers[pid].paid)
        try:
            plan = parse_response(raw)
            fmt_ok = True
        except AIError:
            plan, fmt_ok = None, False
        return {"ok": True, "provider": pid, "model": mdl, "latencyMs": ms, "formatOk": fmt_ok,
                "reply": (plan.message if plan else str(raw)[:200]),
                "usage": {"inputTokens": usage.input_tokens, "outputTokens": usage.output_tokens,
                          "estimatedCostUsd": round(cost, 6) if cost is not None else None}}


def validate_settings(s: dict[str, Any], providers: dict[str, Any]) -> list[str]:
    errs: list[str] = []
    def chk_sel(name: str, v: Any, allow_none: bool) -> None:
        if v is None and allow_none:
            return
        if not isinstance(v, dict) or v.get("provider") not in providers or not isinstance(v.get("model", ""), str):
            errs.append(f"{name}: provider/model 형식이 올바르지 않습니다")
    chk_sel("default", s.get("default"), False)
    for t in TASKS:
        chk_sel(f"tasks.{t}", (s.get("tasks") or {}).get(t), True)
    fb = s.get("fallback") or {}
    if not isinstance(fb.get("enabled"), bool) or not all(p in providers for p in fb.get("order", [])):
        errs.append("fallback 형식이 올바르지 않습니다")
    if s.get("providers", {}).get("dashscope", {}).get("region") not in REGIONS:
        errs.append("DashScope 지역이 올바르지 않습니다")
    url = str(s.get("providers", {}).get("ollama", {}).get("url", ""))
    if not (url.startswith("http://127.0.0.1") or url.startswith("http://localhost")):
        errs.append("Ollama 주소는 이 PC(http://127.0.0.1:포트 또는 http://localhost:포트)만 허용합니다")
    p = s.get("params") or {}
    try:
        if not (0 <= float(p.get("temperature", 0)) <= 1.5 and 256 <= int(p.get("max_tokens", 0)) <= 32000
                and 10 <= int(p.get("timeout", 0)) <= 600 and 0 <= int(p.get("history", 0)) <= 50):
            errs.append("params 범위: temperature 0~1.5, max_tokens 256~32000, timeout 10~600초, history 0~50")
    except (TypeError, ValueError):
        errs.append("params 값이 숫자가 아닙니다")
    for m, pr in (s.get("prices") or {}).items():
        if not (isinstance(pr, dict) and all(isinstance(pr.get(k), (int, float)) and pr[k] >= 0 for k in ("in", "out"))):
            errs.append(f"단가 형식 오류: {m}")
    return errs
