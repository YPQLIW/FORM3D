"""작업 진행 상태 추적 (외부 AI가 작업 ID로 조회)

상태: planning(AI 계획 중) → awaiting_confirmation(편집기에서 사용자 확인 대기) / running → done | failed | rejected | cancelled | error
"""
from __future__ import annotations

import time
from typing import Any

FINAL = ("done", "failed", "rejected", "cancelled", "error", "answered")


class JobTracker:
    def __init__(self, keep: int = 500) -> None:
        self.jobs: dict[str, dict[str, Any]] = {}
        self.keep = keep

    def create(self, job_id: str, kind: str, **extra: Any) -> dict[str, Any]:
        now = time.time()
        rec = {"jobId": job_id, "kind": kind, "state": "queued", "createdAt": now, "updatedAt": now,
               "result": None, "error": None, **extra}
        self.jobs[job_id] = rec
        if len(self.jobs) > self.keep:
            for old in sorted(self.jobs.values(), key=lambda j: j["updatedAt"])[: len(self.jobs) - self.keep]:
                self.jobs.pop(old["jobId"], None)
        return rec

    def update(self, job_id: str, **patch: Any) -> None:
        rec = self.jobs.get(job_id)
        if rec:
            rec.update(patch, updatedAt=time.time())

    def get(self, job_id: str) -> dict[str, Any] | None:
        return self.jobs.get(job_id)
