"""Claude (Anthropic, 유료 API)"""
from __future__ import annotations

import json
from typing import Any, Callable

from ..base import AIError, ModelInfo, ProviderStatus, Usage

MODELS = [
    ModelInfo("claude-opus-5-5", "Claude Opus 5.5", note="가장 정확"),
    ModelInfo("claude-sonnet-5-5", "Claude Sonnet 5.5", note="빠르고 저렴"),
    ModelInfo("claude-haiku-5-5", "Claude Haiku 5.5", note="가장 빠름·저렴"),
]


class ClaudeProvider:
    id = "claude"
    label = "Claude (Anthropic)"
    paid = True
    local = False

    def __init__(self, get_key: Callable[[], str | None], effort: str = "low", client: Any = None) -> None:
        self.get_key = get_key
        self.effort = effort
        self._client = client
        self._client_key: str | None = None

    def _get_client(self) -> Any:
        if self._client is not None and self._client_key is None:
            return self._client  # 테스트용 주입
        key = self.get_key()
        if not key:
            raise AIError(503, "ai_not_configured", "Claude API 키가 없습니다", "AI 설정에서 Claude API 키를 등록하세요")
        if self._client is None or self._client_key != key:
            import anthropic

            self._client = anthropic.Anthropic(api_key=key, timeout=90.0, max_retries=1)
            self._client_key = key
        return self._client

    def status(self) -> ProviderStatus:
        if self._client is None and not self.get_key():
            return ProviderStatus("no_key", "API 키 없음", "console.anthropic.com 에서 키를 발급해 등록하세요")
        return ProviderStatus("ready", "키 등록됨 (연결 테스트로 확인)")

    def list_models(self) -> list[ModelInfo]:
        return list(MODELS)

    def chat_json(self, system: str, messages: list[dict[str, str]], schema: dict[str, Any], model: str,
                  params: dict[str, Any]) -> tuple[dict[str, Any], Usage]:
        import anthropic

        client = self._get_client()
        try:
            response = client.messages.create(
                model=model,
                max_tokens=int(params.get("max_tokens") or 16000),
                system=system,
                messages=messages,
                output_config={"effort": self.effort, "format": {"type": "json_schema", "schema": schema}},
                timeout=float(params.get("timeout") or 90),
            )
        except anthropic.AuthenticationError as e:
            raise AIError(502, "ai_auth", "Claude API 키가 올바르지 않습니다", "AI 설정에서 키를 다시 등록하세요") from e
        except anthropic.PermissionDeniedError as e:
            raise AIError(502, "ai_permission", "이 키로는 해당 모델을 쓸 수 없습니다", "다른 모델을 선택하세요") from e
        except anthropic.NotFoundError as e:
            raise AIError(502, "ai_model_not_found", f"모델을 찾을 수 없습니다: {model}", "모델 목록에서 다시 선택하세요") from e
        except anthropic.RateLimitError as e:
            raise AIError(429, "ai_rate_limit", "요청이 너무 많거나 한도를 넘었습니다", "잠시 후 다시 시도하거나 결제 한도를 확인하세요") from e
        except anthropic.APITimeoutError as e:
            raise AIError(504, "ai_timeout", "Claude 응답 시간이 초과되었습니다", "잠시 후 다시 시도하세요") from e
        except anthropic.APIConnectionError as e:
            raise AIError(502, "ai_unreachable", "Claude 서버에 연결할 수 없습니다", "인터넷 연결을 확인하세요") from e
        except anthropic.APIStatusError as e:
            raise AIError(502, "ai_error", f"Claude 서버 오류 ({e.status_code})", "잠시 후 다시 시도하세요") from e
        usage = Usage(getattr(response.usage, "input_tokens", 0) or 0, getattr(response.usage, "output_tokens", 0) or 0) \
            if getattr(response, "usage", None) else Usage()
        if response.stop_reason == "refusal":
            return {"kind": "reject", "message": "AI가 이 요청 처리를 거절했습니다", "summary": "", "options": [], "steps": []}, usage
        if response.stop_reason == "max_tokens":
            raise AIError(502, "ai_bad_output", "AI 응답이 너무 길어 끊겼습니다", "요청을 나누거나 최대 길이를 늘리세요")
        text = next((b.text for b in response.content if getattr(b, "type", None) == "text"), None)
        if not text:
            raise AIError(502, "ai_bad_output", "AI 응답이 비어 있습니다")
        try:
            return json.loads(text), usage
        except ValueError as e:
            raise AIError(502, "ai_bad_output", "AI 응답이 JSON이 아닙니다") from e
