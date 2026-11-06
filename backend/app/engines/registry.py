"""엔진 레지스트리: 각 엔진 모듈의 ENGINE 을 등록합니다. 새 엔진은 폴더를 추가하고 여기에 이름만 넣으면 됩니다."""
from __future__ import annotations

from typing import Any

from . import animation, image, model3d, video
from .base import Engine

ENGINES: dict[str, Engine] = {m.ENGINE.info.id: m.ENGINE for m in (model3d, image, animation, video)}


def list_engines() -> list[dict[str, Any]]:
    return [e.describe() for e in ENGINES.values()]


def get_engine(engine_id: str) -> dict[str, Any] | None:
    e = ENGINES.get(engine_id)
    return e.describe() if e else None
