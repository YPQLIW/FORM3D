"""Qwen API (Alibaba Cloud DashScope / Model Studio, 유료 API) — OpenAI 호환 REST"""
from __future__ import annotations

from typing import Any, Callable

import httpx

from ..base import AIError, ModelInfo, ProviderStatus, Usage, extract_json

REGIONS = {
    "intl": ("국제판 (싱가포르)", "https://dashscope-intl.aliyuncs.com/compatible-mode/v1"),
    "cn": ("중국판 (베이징)", "https://dashscope.aliyuncs.com/compatible-mode/v1"),
}
DEFAULT_MODELS = [
    ModelInfo("qwen-max", "Qwen-Max", note="가장 정확"),
    ModelInfo("qwen-plus", "Qwen-Plus", note="균형 (추천)"),
    ModelInfo("qwen-turbo", "Qwen-Turbo", note="빠르고 저렴"),
]


# 대화용 JSON 응답에 쓸 수 없는 모델(이미지·음성·생각 전용·번역 등)은 목록에서 뺍니다
_UNUSABLE = ("qwq", "qvq", "-thinking", "-vl", "-audio", "-omni", "-mt", "-tts", "-asr", "embedding", "-ocr", "-image", "-math")


def usable_model(mid: str) -> bool:
    m = mid.lower()
    return m.startswith("qwen") and not any(u in m for u in _UNUSABLE)


class DashScopeProvider:
    id = "dashscope"
    label = "Qwen API (Alibaba DashScope)"
    paid = True
    local = False

    def __init__(self, get_key: Callable[[], str | None], get_region: Callable[[], str],
                 transport: httpx.BaseTransport | None = None) -> None:
        self.get_key = get_key
        self.get_region = get_region
        self.transport = transport

    @property
    def base(self) -> str:
        return REGIONS.get(self.get_region(), REGIONS["intl"])[1]

    def _client(self, timeout: float = 60) -> httpx.Client:
        key = self.get_key()
        if not key:
            raise AIError(503, "ai_not_configured", "DashScope API 키가 없습니다", "AI 설정에서 Qwen API 키를 등록하세요")
        return httpx.Client(base_url=self.base, headers={"Authorization": f"Bearer {key}"}, timeout=timeout,
                            transport=self.transport)

    def _raise_for(self, r: httpx.Response) -> None:
        if r.status_code < 400:
            return
        try:
            err = r.json().get("error", {}) or {}
        except ValueError:
            err = {}
        msg = str(err.get("message") or r.text[:200])
        code = str(err.get("code") or "")
        if r.status_code == 401 or "InvalidApiKey" in code or "invalid_api_key" in code:
            raise AIError(502, "ai_auth", "DashScope가 API 키를 거부했습니다 (키 오류 또는 지역 불일치)",
                          f"지금 지역은 '{REGIONS.get(self.get_region(), REGIONS['intl'])[0]}'입니다. 키를 발급한 지역과 같은지 확인하고, "
                          "다르면 AI 설정에서 지역을 바꾼 뒤 다시 테스트하세요. 지역이 맞다면 키를 다시 복사해 등록하세요")
        if r.status_code == 404 or "model_not_found" in code.lower():
            raise AIError(502, "ai_model_not_found", f"모델을 찾을 수 없습니다: {msg}", "모델 목록을 새로 고쳐 다시 선택하세요")
        low = msg.lower()
        if "enable_thinking" in low or "only support stream" in low or "stream mode" in low:
            raise AIError(502, "ai_model_unsupported", f"이 모델은 FORM3D 방식(한 번에 응답 받기)을 지원하지 않습니다: {msg}",
                          "AI 설정에서 qwen-plus 또는 qwen-max 를 선택하세요 (생각 전용 모델 qwq·*-thinking 은 쓸 수 없습니다)")
        if r.status_code == 400 and ("response_format" in low or "json" in low):
            raise AIError(502, "ai_model_unsupported", f"이 모델은 JSON 응답 형식을 지원하지 않습니다: {msg}",
                          "AI 설정에서 qwen-plus 또는 qwen-max 를 선택하세요")
        if r.status_code == 403:
            raise AIError(502, "ai_auth", f"이 키로는 사용할 수 없는 모델이거나 서비스가 활성화되지 않았습니다: {msg}",
                          "Alibaba Cloud Model Studio 에서 모델 사용(활성화) 여부를 확인하세요")
        if r.status_code == 429:
            raise AIError(429, "ai_rate_limit", "요청 한도를 넘었거나 잔액이 부족합니다", "Alibaba Cloud 콘솔에서 한도·잔액을 확인하세요")
        raise AIError(502, "ai_error", f"DashScope 오류 ({r.status_code}): {msg}", "잠시 후 다시 시도하세요")

    def status(self) -> ProviderStatus:
        if not self.get_key():
            return ProviderStatus("no_key", "API 키 없음", "Alibaba Cloud Model Studio 에서 API 키를 발급해 등록하세요")
        return ProviderStatus("ready", f"키 등록됨 · {REGIONS.get(self.get_region(), REGIONS['intl'])[0]} (연결 테스트로 확인)")

    def list_models(self) -> list[ModelInfo]:
        if not self.get_key():
            return list(DEFAULT_MODELS)
        try:
            with self._client(15) as c:
                r = c.get("/models")
                self._raise_for(r)
                ids = sorted({m.get("id") for m in r.json().get("data", []) if usable_model(str(m.get("id", "")))})
        except (httpx.HTTPError, ValueError):
            return list(DEFAULT_MODELS)
        known = {m.id: m for m in DEFAULT_MODELS}
        return [known.get(i, ModelInfo(i, i)) for i in ids] or list(DEFAULT_MODELS)

    def chat_json(self, system: str, messages: list[dict[str, str]], schema: dict[str, Any], model: str,
                  params: dict[str, Any]) -> tuple[dict[str, Any], Usage]:
        body = {
            "model": model,
            "messages": [{"role": "system", "content": system + "\n반드시 JSON 객체 하나로만 답하세요."}, *messages],
            "response_format": {"type": "json_object"},
            "temperature": float(params.get("temperature", 0.2)),
            "max_tokens": min(int(params.get("max_tokens") or 4000), 8000),
            # qwen3 계열은 '한 번에 응답 받기'에서 생각 모드를 끄지 않으면 400 오류를 냅니다
            "enable_thinking": False,
        }
        try:
            with self._client(float(params.get("timeout") or 90)) as c:
                r = c.post("/chat/completions", json=body)
        except httpx.TimeoutException as e:
            raise AIError(504, "ai_timeout", "Qwen API 응답 시간이 초과되었습니다", "잠시 후 다시 시도하세요") from e
        except httpx.HTTPError as e:
            raise AIError(502, "ai_unreachable", "DashScope 서버에 연결할 수 없습니다", "인터넷 연결과 지역 설정을 확인하세요") from e
        self._raise_for(r)
        data = r.json()
        u = data.get("usage") or {}
        usage = Usage(int(u.get("prompt_tokens") or 0), int(u.get("completion_tokens") or 0))
        choice = (data.get("choices") or [{}])[0]
        if choice.get("finish_reason") == "length":
            raise AIError(502, "ai_bad_output", "AI 응답이 너무 길어 끊겼습니다", "요청을 나누거나 최대 길이를 늘리세요")
        return extract_json(str((choice.get("message") or {}).get("content") or "")), usage
