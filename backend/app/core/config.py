"""서버 설정. 값은 환경 변수 또는 backend/.env 에서만 읽습니다 (API 키는 웹 화면으로 절대 보내지 않음)."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[2]
REPO_DIR = BACKEND_DIR.parent
COMMANDS_JSON = REPO_DIR / "packages" / "model-types" / "src" / "commands.json"
APP_VERSION = "0.4.5"


def _read_dotenv(path: Path) -> dict[str, str]:
    """아주 단순한 .env 파서 (KEY=VALUE, # 주석). 따옴표는 벗겨냅니다."""
    values: dict[str, str] = {}
    if not path.is_file():
        return values
    for raw in path.read_text(encoding="utf-8-sig").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        values[key.strip()] = value
    return values


def default_data_dir() -> Path:
    home = Path.home()
    docs = home / "Documents"
    return (docs if docs.is_dir() else home) / "FORM3D"


@dataclass
class Settings:
    data_dir: Path
    host: str = "127.0.0.1"
    port: int = 8765
    anthropic_api_key: str | None = None
    ai_model: str = "claude-opus-5-5"
    ai_effort: str = "low"
    max_upload_mb: int = 500
    versions_to_keep: int = 10
    bridge_timeout_s: float = 15.0
    confirm_timeout_s: float = 300.0
    allowed_origins: list[str] = field(
        default_factory=lambda: [
            f"http://{h}:{p}" for h in ("localhost", "127.0.0.1") for p in (5173, 4173)
        ]
    )

    @property
    def ai_configured(self) -> bool:
        return bool(self.anthropic_api_key)


def load_settings(env_file: Path | None = None) -> Settings:
    file_values = _read_dotenv(env_file or BACKEND_DIR / ".env")

    def get(key: str) -> str | None:
        v = os.environ.get(key)
        if v is None or v == "":
            v = file_values.get(key)
        return v or None

    data_dir = Path(get("FORM3D_DATA_DIR") or default_data_dir()).expanduser()
    effort = (get("FORM3D_AI_EFFORT") or "low").lower()
    if effort not in ("low", "medium", "high", "xhigh", "max"):
        effort = "low"
    return Settings(
        data_dir=data_dir,
        port=int(get("FORM3D_PORT") or 8765),
        anthropic_api_key=get("ANTHROPIC_API_KEY"),
        ai_model=get("FORM3D_AI_MODEL") or "claude-opus-5-5",
        ai_effort=effort,
    )
