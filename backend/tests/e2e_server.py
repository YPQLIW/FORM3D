"""브라우저 E2E 테스트 전용 서버 (npm run test:e2e:phase3 에서 실행).

실제 Claude API를 호출하지 않도록 '정해진 답을 돌려주는 테스트용 계획기'를 끼워 넣습니다.
화면에는 모델 이름이 "test-planner (E2E 전용)"으로 표시되며, 제품 실행(npm run dev)에서는 절대 쓰이지 않습니다.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import uvicorn  # noqa: E402

from app.ai.provider import Plan  # noqa: E402
from app.core.config import Settings  # noqa: E402
from app.main import create_app  # noqa: E402


class ScriptedPlanner:
    name = "test"
    model = "test-planner (E2E 전용)"

    def plan(self, text: str, scene):
        if "이미지" in text:
            return Plan("reject", "", "이미지 생성은 이번 단계에서 지원하지 않습니다", [])
        if "잘못" in text:
            return Plan("invalid", "잘못된 계획", "AI가 만든 명령이 검증을 통과하지 못했습니다: 1단계 transform: translate은(는) [x, y, z] 숫자 3개여야 합니다",
                        [{"command": "transform", "params": {"translate": [1, 2]}}])
        return Plan("plan", "빨간 구 2개를 만들고 X축 가운데로 정렬", "", [
            {"command": "create_primitive", "params": {"shape": "sphere", "count": 2, "color": "#e53935"}},
            {"command": "align", "params": {"target": "created", "axis": "z", "mode": "center"}},
        ])


if __name__ == "__main__":
    data_dir = Path(sys.argv[1])
    port = int(sys.argv[2]) if len(sys.argv) > 2 else 8765
    import os
    web = os.environ.get("FORM3D_WEB_DIST")  # 설정 시 서버가 편집기 화면도 제공 (설치형 프로그램과 같은 구성)
    settings = Settings(data_dir=data_dir, port=port, bridge_timeout_s=10, confirm_timeout_s=60,
                        web_dist=Path(web) if web else None)
    # 세 번째 인자 real: 실제 제공자 코드(Claude·DashScope·Ollama) 사용 — Phase 4 E2E는 가짜 Ollama 서버에 연결
    real = len(sys.argv) > 3 and sys.argv[3] == "real"
    # 네 번째 인자: Qwen API(DashScope) 주소를 테스트용 가짜 서버로 바꿈 (Phase 4.5 E2E 전용)
    if len(sys.argv) > 4:
        from app.ai.providers import dashscope
        dashscope.REGIONS["intl"] = ("국제판 (E2E 가짜 서버)", sys.argv[4])
    app = create_app(settings, ai=None if real else ScriptedPlanner())
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")
