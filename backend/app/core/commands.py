"""편집 명령 표준(commands.json) 로더와 검증기.

웹 편집기(TypeScript)의 validate.ts 와 같은 규칙입니다. 외부 AI(온이)나 내장 AI가 보낸 명령은
여기서 먼저 검사하고, 편집기에서 한 번 더 검사합니다. 명령 이름은 목록에 있는 것만 허용하므로
임의 코드를 실행할 경로가 없습니다.
"""
from __future__ import annotations

import json
import math
import re
import secrets
import time
from functools import lru_cache
from typing import Any

from .config import COMMANDS_JSON

HEX = re.compile(r"^#[0-9a-fA-F]{6}$")
JOB_ID = re.compile(r"^job_[A-Za-z0-9_-]{4,64}$")


@lru_cache(maxsize=1)
def manifest() -> dict[str, Any]:
    return json.loads(COMMANDS_JSON.read_text(encoding="utf-8"))


def commands() -> dict[str, Any]:
    return manifest()["commands"]


def max_steps() -> int:
    return int(manifest()["limits"]["maxStepsPerJob"])


def _is_num(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def _is_vec3(v: Any) -> bool:
    return isinstance(v, list) and len(v) == 3 and all(_is_num(x) for x in v)


def _check_target(v: Any) -> str | None:
    if v in ("selection", "all", "created"):
        return None
    if isinstance(v, dict) and len(v) == 1:
        key = next(iter(v))
        if key in ("names", "ids"):
            lst = v[key]
            if isinstance(lst, list) and 0 < len(lst) <= 200 and all(isinstance(x, str) and len(x) <= 200 for x in lst):
                return None
            return f"{key}는 1~200개의 문자열 목록이어야 합니다"
    return 'target은 "selection" | "all" | "created" | {"names":[...]} | {"ids":[...]} 중 하나여야 합니다'


def _check_param(name: str, spec: dict[str, Any], v: Any) -> str | None:
    t = spec["type"]
    if t == "enum":
        return None if isinstance(v, str) and v in spec["values"] else f"{name}은(는) {' / '.join(spec['values'])} 중 하나여야 합니다"
    if t == "integer":
        if not (isinstance(v, int) and not isinstance(v, bool)):
            return f"{name}은(는) 정수여야 합니다"
    elif t == "number":
        if not _is_num(v):
            return f"{name}은(는) 숫자여야 합니다"
    elif t == "string":
        if not isinstance(v, str) or not v.strip():
            return f"{name}은(는) 비어 있지 않은 문자열이어야 합니다"
        if spec.get("maxLength") and len(v) > spec["maxLength"]:
            return f"{name}은(는) {spec['maxLength']}자 이하여야 합니다"
        return None
    elif t == "boolean":
        return None if isinstance(v, bool) else f"{name}은(는) true/false여야 합니다"
    elif t == "vec3":
        if not _is_vec3(v):
            return f"{name}은(는) [x, y, z] 숫자 3개여야 합니다"
        return None if all(abs(x) <= 1e6 for x in v) else f"{name} 값이 너무 큽니다"
    elif t == "scale":
        if _is_num(v):
            return None if 0 < v <= 1000 else f"{name}은(는) 0보다 크고 1000 이하여야 합니다"
        if _is_vec3(v):
            return None if all(0 < x <= 1000 for x in v) else f"{name}의 각 값은 0보다 크고 1000 이하여야 합니다"
        return f"{name}은(는) 양수 또는 [x, y, z]여야 합니다"
    elif t == "color":
        return None if isinstance(v, str) and HEX.match(v) else f"{name}은(는) #rrggbb 형식 색상이어야 합니다"
    elif t == "target":
        return _check_target(v)
    if "min" in spec and v < spec["min"]:
        return f"{name}은(는) {spec['min']} 이상이어야 합니다"
    if "max" in spec and v > spec["max"]:
        return f"{name}은(는) {spec['max']} 이하여야 합니다"
    return None


def validate_step(step: Any, index: int = 0) -> list[str]:
    where = f"{index + 1}단계"
    if not isinstance(step, dict):
        return [f"{where}: 명령은 객체여야 합니다"]
    extra = [k for k in step if k not in ("command", "params")]
    if extra:
        return [f"{where}: 알 수 없는 필드 {', '.join(extra)}"]
    name = step.get("command")
    if not isinstance(name, str) or name not in commands():
        return [f'{where}: 지원하지 않는 명령 "{name}"']
    spec = commands()[name]
    params = step.get("params", {})
    if params is None:
        params = {}
    if not isinstance(params, dict):
        return [f"{where} {name}: params는 객체여야 합니다"]
    errors: list[str] = []
    for key, value in params.items():
        if key not in spec["params"]:
            errors.append(f'{where} {name}: 알 수 없는 파라미터 "{key}"')
            continue
        e = _check_param(key, spec["params"][key], value)
        if e:
            errors.append(f"{where} {name}: {e}")
    for key, p in spec["params"].items():
        if p.get("required") and key not in params:
            errors.append(f'{where} {name}: "{key}"가 필요합니다')
    if name == "transform" and not any(k in params for k in ("translate", "position", "rotate_deg", "rotation_deg", "scale_by", "scale")):
        errors.append(f"{where} transform: 바꿀 값(translate, position, rotate_deg 등)이 하나도 없습니다")
    if name == "set_material" and not any(k in params for k in ("color", "metalness", "roughness")):
        errors.append(f"{where} set_material: 바꿀 값(color, metalness, roughness)이 없습니다")
    return errors


def validate_steps(steps: Any) -> list[str]:
    if not isinstance(steps, list) or not steps:
        return ["실행할 단계가 없습니다"]
    if len(steps) > max_steps():
        return [f"한 작업은 최대 {max_steps()}단계까지 가능합니다"]
    errors: list[str] = []
    for i, s in enumerate(steps):
        errors.extend(validate_step(s, i))
    return errors


def validate_job(job: Any) -> list[str]:
    if not isinstance(job, dict):
        return ["작업은 객체여야 합니다"]
    if not isinstance(job.get("id"), str) or not JOB_ID.match(job["id"]):
        return ["작업 ID 형식이 올바르지 않습니다 (job_...)"]
    return validate_steps(job.get("steps"))


def required_scopes(steps: list[dict[str, Any]]) -> set[str]:
    return {commands()[s["command"]]["scope"] for s in steps}


def new_job_id() -> str:
    return f"job_{int(time.time() * 1000):x}_{secrets.token_hex(4)}"
