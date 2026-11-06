"""프로젝트 저장소: SQLite(목록·메타데이터) + 파일(.form3d 원본).

data_dir/
  form3d.db
  projects/<id>/project.form3d        현재 저장본
  projects/<id>/thumbnail.png         목록용 미리보기
  projects/<id>/versions/<시각>.form3d  덮어쓰기 직전 저장본 (최근 N개 보관)

모든 쓰기는 임시 파일에 쓴 뒤 fsync → os.replace 로 교체합니다.
저장 도중 전원이 꺼져도 이전 저장본이 깨지지 않습니다.
"""
from __future__ import annotations

import io
import json
import os
import re
import secrets
import sqlite3
import threading
import zipfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

FORMAT = "form3d-project"
FORMAT_VERSION = 1
ID_RE = re.compile(r"^p_[a-f0-9]{16}$")


class StoreError(Exception):
    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def atomic_write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.{secrets.token_hex(4)}.tmp")
    try:
        with open(tmp, "wb") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    finally:
        if tmp.exists():
            tmp.unlink(missing_ok=True)


@dataclass
class Inspected:
    manifest: dict[str, Any]
    thumbnail: bytes | None


def inspect_project_file(data: bytes) -> Inspected:
    """업로드된 .form3d 가 올바른지 확인 (ZIP · manifest · 형식/버전 · scene.glb 존재)."""
    if len(data) < 22 or data[:2] != b"PK":
        raise StoreError(400, "invalid_file", "FORM3D 프로젝트 파일(.form3d)이 아닙니다")
    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
        names = set(zf.namelist())
        if "manifest.json" not in names:
            raise StoreError(400, "invalid_file", "manifest.json 이 없는 파일입니다")
        manifest = json.loads(zf.read("manifest.json").decode("utf-8"))
        if not isinstance(manifest, dict) or manifest.get("format") != FORMAT:
            raise StoreError(400, "invalid_file", "FORM3D 프로젝트 형식이 아닙니다")
        version = manifest.get("formatVersion")
        if not isinstance(version, int) or version < 1:
            raise StoreError(400, "invalid_file", "형식 버전이 올바르지 않습니다")
        if version > FORMAT_VERSION:
            raise StoreError(400, "newer_version", f"더 새로운 FORM3D에서 만든 파일입니다 (형식 {version})")
        files = manifest.get("files") or {}
        scene = files.get("scene")
        if scene and scene not in names:
            raise StoreError(400, "invalid_file", "씬 데이터(scene.glb)가 빠져 있습니다")
        if files.get("project") and files["project"] not in names:
            raise StoreError(400, "invalid_file", "project.json 이 빠져 있습니다")
        bad = zf.testzip()
        if bad:
            raise StoreError(400, "corrupt_file", f"손상된 항목이 있습니다: {bad}")
        thumb_name = files.get("thumbnail")
        thumbnail = zf.read(thumb_name) if thumb_name and thumb_name in names else None
        return Inspected(manifest, thumbnail)
    except StoreError:
        raise
    except (zipfile.BadZipFile, ValueError, KeyError, UnicodeDecodeError) as e:
        raise StoreError(400, "corrupt_file", f"파일을 읽을 수 없습니다: {e}") from e


def clean_name(name: Any, fallback: str = "제목 없음") -> str:
    if not isinstance(name, str):
        return fallback
    name = re.sub(r"[\x00-\x1f]", "", name).strip()[:120]
    return name or fallback


class ProjectStore:
    def __init__(self, data_dir: Path, versions_to_keep: int = 10) -> None:
        self.root = data_dir
        self.projects_dir = data_dir / "projects"
        self.projects_dir.mkdir(parents=True, exist_ok=True)
        self.versions_to_keep = versions_to_keep
        self._lock = threading.RLock()
        self.db = sqlite3.connect(data_dir / "form3d.db", check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute(
            """CREATE TABLE IF NOT EXISTS projects (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                opened_at TEXT NOT NULL,
                size INTEGER NOT NULL,
                objects INTEGER NOT NULL DEFAULT 0,
                triangles INTEGER NOT NULL DEFAULT 0,
                has_thumbnail INTEGER NOT NULL DEFAULT 0
            )"""
        )
        self.db.commit()

    # -------------------------------------------------- 내부

    def _dir(self, pid: str) -> Path:
        if not ID_RE.match(pid):
            raise StoreError(404, "not_found", "프로젝트를 찾을 수 없습니다")
        return self.projects_dir / pid

    def _row(self, pid: str) -> sqlite3.Row:
        row = self.db.execute("SELECT * FROM projects WHERE id=?", (pid,)).fetchone()
        if not row:
            raise StoreError(404, "not_found", "프로젝트를 찾을 수 없습니다")
        return row

    @staticmethod
    def _public(row: sqlite3.Row) -> dict[str, Any]:
        return {
            "id": row["id"],
            "name": row["name"],
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
            "openedAt": row["opened_at"],
            "size": row["size"],
            "objects": row["objects"],
            "triangles": row["triangles"],
            "hasThumbnail": bool(row["has_thumbnail"]),
        }

    def _write_files(self, pid: str, data: bytes, info: Inspected) -> None:
        d = self._dir(pid)
        atomic_write(d / "project.form3d", data)
        thumb = d / "thumbnail.png"
        if info.thumbnail:
            atomic_write(thumb, info.thumbnail)
        elif thumb.exists():
            thumb.unlink()

    # -------------------------------------------------- 공개 API

    def list(self, limit: int = 50) -> list[dict[str, Any]]:
        rows = self.db.execute(
            "SELECT * FROM projects ORDER BY MAX(updated_at, opened_at) DESC LIMIT ?", (limit,)
        ).fetchall()
        return [self._public(r) for r in rows]

    def get(self, pid: str) -> dict[str, Any]:
        return self._public(self._row(pid))

    def create(self, data: bytes, name: str | None = None) -> dict[str, Any]:
        info = inspect_project_file(data)
        with self._lock:
            pid = "p_" + secrets.token_hex(8)
            ts = now_iso()
            stats = info.manifest.get("stats") or {}
            self._write_files(pid, data, info)
            self.db.execute(
                "INSERT INTO projects VALUES (?,?,?,?,?,?,?,?,?)",
                (pid, clean_name(name or info.manifest.get("name")), ts, ts, ts, len(data),
                 int(stats.get("objects") or 0), int(stats.get("triangles") or 0), int(bool(info.thumbnail))),
            )
            self.db.commit()
            return self.get(pid)

    def save(self, pid: str, data: bytes, name: str | None = None) -> dict[str, Any]:
        info = inspect_project_file(data)
        with self._lock:
            row = self._row(pid)
            d = self._dir(pid)
            current = d / "project.form3d"
            if current.exists():
                # 덮어쓰기 전 이전 저장본을 versions/ 에 보관
                stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
                atomic_write(d / "versions" / f"{stamp}.form3d", current.read_bytes())
                self._prune_versions(pid)
            self._write_files(pid, data, info)
            stats = info.manifest.get("stats") or {}
            ts = now_iso()
            self.db.execute(
                "UPDATE projects SET name=?, updated_at=?, opened_at=?, size=?, objects=?, triangles=?, has_thumbnail=? WHERE id=?",
                (clean_name(name, row["name"]) if name is not None else row["name"], ts, ts, len(data),
                 int(stats.get("objects") or 0), int(stats.get("triangles") or 0), int(bool(info.thumbnail)), pid),
            )
            self.db.commit()
            return self.get(pid)

    def rename(self, pid: str, name: str) -> dict[str, Any]:
        new = clean_name(name, "")
        if not new:
            raise StoreError(400, "invalid_name", "이름이 비어 있습니다")
        with self._lock:
            self._row(pid)
            self.db.execute("UPDATE projects SET name=? WHERE id=?", (new, pid))
            self.db.commit()
            return self.get(pid)

    def read(self, pid: str) -> bytes:
        self._row(pid)
        path = self._dir(pid) / "project.form3d"
        if not path.exists():
            raise StoreError(404, "missing_file", "프로젝트 파일이 없습니다 (폴더에서 지워졌을 수 있습니다)")
        with self._lock:
            self.db.execute("UPDATE projects SET opened_at=? WHERE id=?", (now_iso(), pid))
            self.db.commit()
        return path.read_bytes()

    def thumbnail(self, pid: str) -> bytes | None:
        self._row(pid)
        path = self._dir(pid) / "thumbnail.png"
        return path.read_bytes() if path.exists() else None

    def versions(self, pid: str) -> list[dict[str, Any]]:
        self._row(pid)
        vdir = self._dir(pid) / "versions"
        if not vdir.is_dir():
            return []
        out = []
        for p in sorted(vdir.glob("*.form3d"), reverse=True):
            out.append({"id": p.stem, "size": p.stat().st_size, "savedAt": _stamp_to_iso(p.stem)})
        return out

    def read_version(self, pid: str, vid: str) -> bytes:
        self._row(pid)
        if not re.match(r"^\d{8}T\d{12}Z$", vid):
            raise StoreError(404, "not_found", "버전을 찾을 수 없습니다")
        path = self._dir(pid) / "versions" / f"{vid}.form3d"
        if not path.exists():
            raise StoreError(404, "not_found", "버전을 찾을 수 없습니다")
        return path.read_bytes()

    def _prune_versions(self, pid: str) -> None:
        vdir = self._dir(pid) / "versions"
        files = sorted(vdir.glob("*.form3d"), reverse=True)
        for old in files[self.versions_to_keep:]:
            old.unlink(missing_ok=True)

    def close(self) -> None:
        self.db.close()


def _stamp_to_iso(stamp: str) -> str:
    try:
        return datetime.strptime(stamp, "%Y%m%dT%H%M%S%fZ").replace(tzinfo=timezone.utc).isoformat(timespec="seconds")
    except ValueError:
        return stamp
