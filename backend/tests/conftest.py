from __future__ import annotations

import io
import json
import zipfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.ai.provider import Plan
from app.core.config import Settings
from app.main import create_app

ORIGIN = "http://localhost:5173"


def make_form3d(name: str = "테스트", objects: int = 1, scene: bytes = b"glTF-fake-scene", thumbnail: bool = True,
                version: int = 1, fmt: str = "form3d-project") -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        manifest = {
            "format": fmt, "formatVersion": version, "appVersion": "0.3.0", "projectId": None, "name": name,
            "createdAt": "2026-11-05T00:00:00Z", "modifiedAt": "2026-11-05T00:00:00Z",
            "stats": {"objects": objects, "meshes": objects, "triangles": 12 * objects},
            "files": {"scene": "scene.glb", "project": "project.json", "thumbnail": "thumbnail.png" if thumbnail else None},
        }
        zf.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False))
        zf.writestr("scene.glb", scene)
        zf.writestr("project.json", json.dumps({"camera": None, "settings": None}))
        if thumbnail:
            zf.writestr("thumbnail.png", b"\x89PNG\r\n\x1a\nfake")
    return buf.getvalue()


class FakeProvider:
    name = "fake"
    model = "fake-model"

    def __init__(self) -> None:
        self.calls: list[tuple[str, dict | None]] = []
        self.next: Plan | Exception = Plan("plan", "큐브 만들기", "", [{"command": "create_primitive", "params": {"shape": "box"}}])

    def plan(self, text, scene):
        self.calls.append((text, scene))
        if isinstance(self.next, Exception):
            raise self.next
        return self.next


@pytest.fixture()
def settings(tmp_path: Path) -> Settings:
    return Settings(data_dir=tmp_path / "data", bridge_timeout_s=5.0, confirm_timeout_s=5.0)


@pytest.fixture()
def fake_ai() -> FakeProvider:
    return FakeProvider()


@pytest.fixture()
def client(settings: Settings, fake_ai: FakeProvider):
    app = create_app(settings, ai=fake_ai)
    with TestClient(app) as c:
        yield c
    app.state.store.close()


@pytest.fixture()
def token(client) -> str:
    text = client.app.state.tokens.token_file.read_text(encoding="utf-8")
    return [l for l in text.splitlines() if l and not l.startswith("#")][0]
