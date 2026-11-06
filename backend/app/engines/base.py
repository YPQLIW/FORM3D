"""크리에이티브 엔진 공통 인터페이스.

3D 모델 · 이미지 · 애니메이션 · 동영상 생성 엔진을 각각 독립 모듈로 붙이고 교체할 수 있게 하는 자리입니다.
모든 엔진은 같은 흐름을 따릅니다:  check() → submit(입력) → 작업 ID → status() → result() / cancel()
현재는 어떤 엔진도 실제로 연결되어 있지 않으며, 모두 available=False 로 보고합니다.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any


class EngineNotAvailable(Exception):
    pass


@dataclass
class EngineInfo:
    id: str
    kind: str  # model3d | image | animation | video
    name: str
    status: str  # planned | ready | error
    available: bool
    phase: str
    backends: list[str] = field(default_factory=list)  # 연결 예정 후보 (예: Meshy, Tripo, 로컬)
    note: str = ""


class Engine:
    """엔진 구현은 이 클래스를 상속해 각 메서드를 채웁니다."""

    info: EngineInfo

    def describe(self) -> dict[str, Any]:
        return asdict(self.info)

    def check(self) -> dict[str, Any]:
        return {"available": self.info.available, "message": self.info.note}

    def submit(self, params: dict[str, Any]) -> str:
        raise EngineNotAvailable(f"{self.info.name} 엔진은 아직 연결되지 않았습니다 ({self.info.phase})")

    def status(self, job_id: str) -> dict[str, Any]:
        raise EngineNotAvailable(f"{self.info.name} 엔진은 아직 연결되지 않았습니다")

    def result(self, job_id: str) -> dict[str, Any]:
        raise EngineNotAvailable(f"{self.info.name} 엔진은 아직 연결되지 않았습니다")

    def cancel(self, job_id: str) -> None:
        raise EngineNotAvailable(f"{self.info.name} 엔진은 아직 연결되지 않았습니다")


class PlaceholderEngine(Engine):
    """아직 연결되지 않은 엔진 자리 (구현된 것처럼 보이지 않도록 항상 사용 불가)"""

    def __init__(self, info: EngineInfo) -> None:
        self.info = info
