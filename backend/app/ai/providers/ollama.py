"""Qwen Local (Ollama, 무료 · 내 PC에서 실행 · 인터넷 불필요)"""
from __future__ import annotations

import json
from typing import Any, Callable, Iterator

import httpx

from ..base import AIError, ModelInfo, ProviderStatus, Usage, extract_json

RECOMMENDED = [
    ModelInfo("qwen3:4b", "Qwen3 4B", note="약 2.5GB · RAM 8GB · 간단한 명령"),
    ModelInfo("qwen3:8b", "Qwen3 8B", note="약 5GB · 그래픽 메모리 8GB 권장 (추천)"),
    ModelInfo("qwen3:14b", "Qwen3 14B", note="약 9GB · 그래픽 메모리 12~16GB · 복잡한 계획"),
]
INSTALL_HINT = "https://ollama.com/download 에서 Windows용 Ollama를 설치하고 실행하세요"


class OllamaProvider:
    id = "ollama"
    label = "Qwen Local (Ollama)"
    paid = False
    local = True

    def __init__(self, get_url: Callable[[], str], transport: httpx.BaseTransport | None = None) -> None:
        self.get_url = get_url
        self.transport = transport

    def _client(self, timeout: float | None = 5) -> httpx.Client:
        return httpx.Client(base_url=self.get_url().rstrip("/"), timeout=timeout, transport=self.transport)

    def version(self) -> str | None:
        try:
            with self._client(2) as c:
                r = c.get("/api/version")
                return r.json().get("version") if r.status_code == 200 else None
        except (httpx.HTTPError, ValueError):
            return None

    def status(self) -> ProviderStatus:
        v = self.version()
        if not v:
            return ProviderStatus("offline", "Ollama가 실행 중이 아닙니다", INSTALL_HINT + " (설치했다면 Ollama 앱을 켜세요)")
        try:
            n = len(self.installed())
        except AIError:
            n = 0
        if n == 0:
            return ProviderStatus("ready", f"Ollama {v} 실행 중 · 설치된 모델 없음", "아래에서 qwen3:8b 등을 내려받으세요")
        return ProviderStatus("ready", f"Ollama {v} 실행 중 · 모델 {n}개")

    def installed(self) -> list[ModelInfo]:
        try:
            with self._client(5) as c:
                r = c.get("/api/tags")
                r.raise_for_status()
                return [ModelInfo(m["name"], m["name"], size=m.get("size")) for m in r.json().get("models", [])]
        except (httpx.HTTPError, ValueError, KeyError) as e:
            raise AIError(503, "ai_unreachable", "Ollama에 연결할 수 없습니다", INSTALL_HINT) from e

    def list_models(self) -> list[ModelInfo]:
        return self.installed()

    def pull(self, model: str) -> Iterator[dict[str, Any]]:
        """모델 내려받기 진행 상황 (Ollama /api/pull 스트림)"""
        try:
            with self._client(None) as c, c.stream("POST", "/api/pull", json={"model": model, "stream": True}) as r:
                if r.status_code >= 400:
                    raise AIError(502, "ai_error", f"모델을 내려받을 수 없습니다: {r.read().decode(errors='ignore')[:200]}",
                                  "모델 이름을 확인하세요 (예: qwen3:8b)")
                for line in r.iter_lines():
                    if not line.strip():
                        continue
                    try:
                        msg = json.loads(line)
                    except ValueError:
                        continue
                    if msg.get("error"):
                        raise AIError(502, "ai_error", f"내려받기 실패: {msg['error']}", "모델 이름과 디스크 공간을 확인하세요")
                    yield {"status": msg.get("status", ""), "total": msg.get("total"), "completed": msg.get("completed")}
        except httpx.HTTPError as e:
            raise AIError(503, "ai_unreachable", "Ollama에 연결할 수 없습니다", INSTALL_HINT) from e

    def chat_json(self, system: str, messages: list[dict[str, str]], schema: dict[str, Any], model: str,
                  params: dict[str, Any]) -> tuple[dict[str, Any], Usage]:
        if not model:
            raise AIError(503, "ai_not_configured", "사용할 Ollama 모델이 선택되지 않았습니다", "AI 설정에서 모델을 내려받고 선택하세요")
        body = {
            "model": model,
            "messages": [{"role": "system", "content": system}, *messages],
            "format": schema,
            "stream": False,
            "think": False,
            "options": {"temperature": float(params.get("temperature", 0.2)),
                        "num_predict": int(params.get("max_tokens") or 4000)},
        }
        try:
            with self._client(float(params.get("timeout") or 180)) as c:
                r = c.post("/api/chat", json=body)
        except httpx.TimeoutException as e:
            raise AIError(504, "ai_timeout", "로컬 모델 응답 시간이 초과되었습니다",
                          "PC 사양에 비해 모델이 클 수 있습니다. 더 작은 모델을 쓰거나 시간 제한을 늘리세요") from e
        except httpx.HTTPError as e:
            raise AIError(503, "ai_unreachable", "Ollama에 연결할 수 없습니다", INSTALL_HINT) from e
        if r.status_code == 404:
            raise AIError(502, "ai_model_not_found", f"설치되지 않은 모델입니다: {model}", "AI 설정에서 모델을 내려받으세요")
        if r.status_code >= 400:
            raise AIError(502, "ai_error", f"Ollama 오류 ({r.status_code}): {r.text[:200]}", "Ollama를 다시 시작해 보세요")
        data = r.json()
        usage = Usage(int(data.get("prompt_eval_count") or 0), int(data.get("eval_count") or 0))
        return extract_json(str((data.get("message") or {}).get("content") or "")), usage
