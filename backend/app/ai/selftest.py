"""실제 AI 점검: 사용자가 고른 '실제' AI 모델로 완료 조건 1~8을 자동으로 확인하고 보고서를 만듭니다.

- 장면은 바꾸지 않습니다. 계획만 받아서 검증하고, 실행하지 않습니다.
- 대화는 임시 대화 ID를 쓰고, 끝나면 지웁니다.
- 판정은 단순한 규칙(예: 답에 '초록'이 들어 있는가)입니다. AI 원문 응답을 함께 저장하므로 사람이 다시 볼 수 있습니다.
"""
from __future__ import annotations

import json
import threading
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Callable

from .base import AIError

PROVIDER_NAMES = {"claude": "Claude", "dashscope": "Qwen API", "ollama": "Ollama"}

TITLES = [
    (1, "일반 질문에 답하기"),
    (2, "이전 대화 기억하기"),
    (3, "앞선 대화와 이어지는 후속 요청 (방금 만든 원기둥 키우기)"),
    (4, "모호한 요청에 되묻기"),
    (5, "복잡한 요청을 작업 계획으로 정리하기"),
    (6, "Claude ↔ Qwen API 모델 전환"),
    (7, "Ollama 연결과 응답"),
    (8, "온이(ONI)를 통한 실제 AI 응답"),
]

SCENE_BASE: dict[str, Any] = {"projectName": "AI 점검", "objectCount": 0, "selection": [], "nodes": []}


def _node(i: str, name: str, x: float, color: str) -> dict[str, Any]:
    return {"id": i, "name": name, "type": "Mesh", "visible": True, "selected": False, "position": [x, 0.5, 0],
            "rotationDeg": [0, 0, 0], "scale": [1, 1, 1], "color": color}


class SelfTest:
    def __init__(self, manager: Any, provider: str, model: str, oni: Callable[[str, str], dict[str, Any]] | None,
                 report_dir: Path) -> None:
        self.m = manager
        self.provider = provider
        self.model = model
        self.oni = oni
        self.report_dir = report_dir
        self.id = "st_" + uuid.uuid4().hex[:10]
        self.convs: list[str] = []
        self.state: dict[str, Any] = {
            "id": self.id, "state": "running", "provider": provider, "model": model,
            "providerName": PROVIDER_NAMES.get(provider, provider),
            "paid": bool(manager.providers[provider].paid), "startedAt": time.time(), "current": 0,
            "items": [{"no": n, "title": t, "result": "pending"} for n, t in TITLES],
            "reportPath": None, "report": None, "cancel": False,
        }

    # ---------------------------------------------------------------- 도우미
    def _conv(self) -> str:
        c = f"selftest-{self.id}-{len(self.convs)}"
        self.convs.append(c)
        return c

    def _ask(self, text: str, scene: dict[str, Any] | None, conv: str | None, provider: str | None = None,
             model: str | None = None) -> dict[str, Any]:
        p = provider or self.provider
        out = self.m.assist(text, scene, conv, "assistant", p, model or (self.model if p == self.provider else None))
        return out

    @staticmethod
    def _brief(out: dict[str, Any]) -> dict[str, Any]:
        return {"kind": out.get("status"), "message": out.get("message") or out.get("reason") or "",
                "summary": out.get("summary") or "", "options": out.get("options") or [], "steps": out.get("steps") or [],
                "provider": out.get("provider"), "model": out.get("model"), "latencyMs": out.get("latencyMs"),
                "costUsd": (out.get("usage") or {}).get("estimatedCostUsd")}

    def _set(self, no: int, **kw: Any) -> None:
        self.state["items"][no - 1].update(kw)

    # ---------------------------------------------------------------- 항목별 점검
    def t1(self) -> tuple[str, str, list[dict]]:
        q = "안녕하세요. 당신은 무엇을 도와줄 수 있나요? 한두 문장으로 답해 주세요."
        out = self._ask(q, SCENE_BASE, self._conv())
        ok = out["status"] == "answer" and len((out.get("message") or "").strip()) >= 5
        return ("pass" if ok else "fail", "답변(answer)으로 응답" if ok else f"응답 종류가 answer가 아님: {out['status']}",
                [{"request": q, "response": self._brief(out)}])

    def t2(self) -> tuple[str, str, list[dict]]:
        conv = self._conv()
        q1 = "제 이름은 하율이고, 제가 좋아하는 색은 초록색이에요. 기억해 주세요."
        q2 = "제가 좋아하는 색이 뭐라고 했죠?"
        o1 = self._ask(q1, SCENE_BASE, conv)
        o2 = self._ask(q2, SCENE_BASE, conv)
        msg = (o2.get("message") or "") + (o2.get("summary") or "")
        ok = "초록" in msg or "녹색" in msg or "green" in msg.lower()
        return ("pass" if ok else "fail", "두 번째 답에 '초록'이 들어 있음" if ok else "두 번째 답에서 좋아하는 색(초록)을 찾지 못함",
                [{"request": q1, "response": self._brief(o1)}, {"request": q2, "response": self._brief(o2)}])

    def t3(self) -> tuple[str, str, list[dict]]:
        conv = self._conv()
        scene1 = {**SCENE_BASE, "objectCount": 1, "nodes": [_node("selftest-box-1", "Box", -2, "#9aa4b5")]}
        q1 = "원기둥 하나 만들어 줘."
        o1 = self._ask(q1, scene1, conv)
        log = [{"request": q1, "response": self._brief(o1)}]
        made = o1["status"] == "plan" and any(
            s["command"] == "create_primitive" and s["params"].get("shape") == "cylinder" for s in o1["steps"])
        if not made:
            return "fail", f"원기둥 생성 계획이 아님 (응답 종류: {o1['status']})", log
        cid = "selftest-cyl-1"
        self.m.feedback(conv, f"작업 job_selftest1: 성공 — 1개 단계 완료 (만든 것: Cylinder(id {cid}))")
        scene2 = {**scene1, "objectCount": 2, "nodes": [*scene1["nodes"], _node(cid, "Cylinder", 0, "#9aa4b5")],
                  "recentlyCreated": [{"id": cid, "name": "Cylinder"}]}
        q2 = "조금 더 크게 해줘."
        o2 = self._ask(q2, scene2, conv)
        log.append({"request": q2, "response": self._brief(o2)})
        if o2["status"] != "plan":
            return "fail", f"후속 요청이 계획이 아님 (응답 종류: {o2['status']})", log

        def targets_cyl(t: Any) -> bool:
            if isinstance(t, dict):
                return cid in (t.get("ids") or []) or "Cylinder" in (t.get("names") or [])
            return False

        def bigger(p: dict[str, Any]) -> bool:
            sb = p.get("scale_by")
            if isinstance(sb, (int, float)):
                return sb > 1
            if isinstance(sb, list):
                return all(isinstance(v, (int, float)) and v >= 1 for v in sb) and any(v > 1 for v in sb)
            sc = p.get("scale")
            return isinstance(sc, list) and all(isinstance(v, (int, float)) and v > 1 for v in sc)

        ok = any(s["command"] == "transform" and targets_cyl(s["params"].get("target")) and bigger(s["params"])
                 for s in o2["steps"])
        return ("pass" if ok else "fail",
                "방금 만든 원기둥(Cylinder)만 더 크게 하는 계획" if ok else "원기둥을 대상으로 크기를 키우는 계획이 아님", log)

    def t4(self) -> tuple[str, str, list[dict]]:
        scene = {**SCENE_BASE, "objectCount": 3, "nodes": [
            _node("selftest-a", "Box", -2, "#e53935"), _node("selftest-b", "Sphere", 0, "#1e88e5"),
            _node("selftest-c", "Cylinder", 2, "#43a047")]}
        q = "그거 지워줘."
        out = self._ask(q, scene, self._conv())
        ok = out["status"] == "question"
        return ("pass" if ok else "fail",
                f"실행하지 않고 되물음 (선택지 {len(out.get('options') or [])}개)" if ok else f"되묻지 않음 (응답 종류: {out['status']})",
                [{"request": q, "response": self._brief(out)}])

    def t5(self) -> tuple[str, str, list[dict]]:
        q = "바닥 위에 구 3개를 일렬로 만들고, 각각 빨강·초록·파랑으로 칠한 다음 하나의 그룹으로 묶어 줘."
        out = self._ask(q, SCENE_BASE, self._conv())
        cmds = [s["command"] for s in out.get("steps") or []]
        ok = out["status"] == "plan" and "create_primitive" in cmds and "group" in cmds and len(cmds) >= 3
        note = (f"{len(cmds)}단계 계획 ({', '.join(cmds)}) · 명령 검증 통과" if ok else
                "계획이 검증을 통과하지 못함" if out["status"] == "invalid" else
                f"필요한 단계(생성·색·그룹)가 빠짐 또는 응답 종류 {out['status']}")
        return "pass" if ok else "fail", note, [{"request": q, "response": self._brief(out)}]

    def t6(self) -> tuple[str, str, list[dict]]:
        usable = [p for p in ("claude", "dashscope") if self.m._usable(p, self.m.model_for(p))]
        if len(usable) < 2:
            missing = [PROVIDER_NAMES[p] for p in ("claude", "dashscope") if p not in usable]
            return "skip", f"건너뜀: {', '.join(missing)} 키가 없거나 연결되지 않음 (두 모델 모두 연결해야 점검 가능)", []
        q = "한 문장으로 자기소개를 해 주세요."
        log = []
        oks = []
        for p in usable:
            o = self._ask(q, SCENE_BASE, None, provider=p, model=self.m.model_for(p))
            log.append({"request": f"[{PROVIDER_NAMES[p]}] {q}", "response": self._brief(o)})
            oks.append(o["provider"] == p and o["status"] == "answer")
        ok = all(oks)
        return ("pass" if ok else "fail", "Claude와 Qwen API가 각각 답함" if ok else "한쪽 모델이 답하지 않음", log)

    def t7(self) -> tuple[str, str, list[dict]]:
        m = self.m.model_for("ollama")
        if not self.m._usable("ollama", m):
            return "skip", "건너뜀: Ollama가 꺼져 있거나 설치된 모델이 없음", []
        q = "1 더하기 1은 얼마인가요? 숫자로만 답해 주세요."
        o = self._ask(q, SCENE_BASE, None, provider="ollama", model=m)
        ok = o["provider"] == "ollama" and o["status"] == "answer" and "2" in (o.get("message") or "")
        return ("pass" if ok else "fail", f"Ollama({m})가 응답함" if ok else "Ollama 응답이 올바르지 않음",
                [{"request": q, "response": self._brief(o)}])

    def t8(self) -> tuple[str, str, list[dict]]:
        if self.oni is None:
            return "skip", "건너뜀: 온이 연결을 확인할 수 없음", []
        conv = self._conv()
        q = "지금 장면에 오브젝트가 몇 개 있나요? 실행하지 말고 답만 해 주세요."
        r = self.oni(q, conv)
        plan = r.get("plan") or {}
        ok = r.get("_status") == 200 and plan.get("status") in ("answer", "question") and bool(plan.get("message")) \
            and plan.get("provider") in PROVIDER_NAMES
        note = (f"온이 → {PROVIDER_NAMES.get(plan.get('provider'), plan.get('provider'))}({plan.get('model')}) 응답, 실행 안 함" if ok
                else f"온이 응답 실패: {r.get('_error') or r.get('state') or r}")
        return "pass" if ok else "fail", note, [{"request": f"[온이 /api/v1/assist] {q}",
                                                  "response": {"kind": plan.get("status"), "message": plan.get("message"),
                                                               "provider": plan.get("provider"), "model": plan.get("model"),
                                                               "state": r.get("state")}}]

    # ---------------------------------------------------------------- 실행
    def run(self) -> None:
        tests = [self.t1, self.t2, self.t3, self.t4, self.t5, self.t6, self.t7, self.t8]
        try:
            for i, fn in enumerate(tests, start=1):
                if self.state["cancel"]:
                    self._set(i, result="skip", note="사용자가 점검을 중단함")
                    continue
                self.state["current"] = i
                self._set(i, result="running")
                t0 = time.monotonic()
                try:
                    result, note, log = fn()
                except AIError as e:
                    result, note, log = "fail", f"AI 오류: {e.message}" + (f" (해결 방법: {e.hint})" if e.hint else ""), []
                except Exception as e:  # noqa: BLE001 — 점검은 끝까지 진행
                    result, note, log = "fail", f"점검 중 오류: {e}", []
                self._set(i, result=result, note=note, log=log, seconds=round(time.monotonic() - t0, 1))
        finally:
            for c in self.convs:
                try:
                    self.m.store.clear_conversation(c)
                except Exception:  # noqa: BLE001
                    pass
            self.state["current"] = 0
            self.state["finishedAt"] = time.time()
            self.state["report"] = self.markdown()
            try:
                self.report_dir.mkdir(parents=True, exist_ok=True)
                path = self.report_dir / f"ai-점검-{datetime.now().strftime('%Y%m%d-%H%M%S')}.md"
                path.write_text(self.state["report"], encoding="utf-8")
                self.state["reportPath"] = str(path)
            except OSError:
                pass
            self.state["state"] = "cancelled" if self.state["cancel"] else "done"

    def markdown(self) -> str:
        s = self.state
        icon = {"pass": "✅ 통과", "fail": "❌ 실패", "skip": "⏭ 건너뜀", "pending": "-", "running": "…"}
        counts = {k: sum(1 for it in s["items"] if it["result"] == k) for k in ("pass", "fail", "skip")}
        from ..core.config import APP_VERSION
        lines = [
            "# FORM3D 실제 AI 점검 보고서",
            "",
            f"- 일시: {datetime.fromtimestamp(s['startedAt']).strftime('%Y-%m-%d %H:%M')}",
            f"- FORM3D 버전: {APP_VERSION}",
            f"- 점검 모델: {s['providerName']} · {s['model']} ({'유료' if s['paid'] else '무료·로컬'})",
            "- 구분: **실제 AI 모델 테스트** (모의 서버 아님)",
            f"- 결과: 통과 {counts['pass']} · 실패 {counts['fail']} · 건너뜀 {counts['skip']}",
            "",
            "| # | 항목 | 결과 | 설명 | 시간 |",
            "| --- | --- | --- | --- | --- |",
        ]
        for it in s["items"]:
            note = str(it.get("note", "")).replace("|", "/")
            lines.append(f"| {it['no']} | {it['title']} | {icon.get(it['result'], it['result'])} | {note} | {it.get('seconds', '-')}초 |")
        lines += ["", "## AI 원문 응답", ""]
        for it in s["items"]:
            for entry in it.get("log") or []:
                r = entry["response"]
                lines.append(f"**{it['no']}. 요청:** {entry['request']}")
                lines.append("")
                lines.append(f"- 응답 종류: `{r.get('kind')}` · 모델: {PROVIDER_NAMES.get(r.get('provider'), r.get('provider'))} {r.get('model') or ''}"
                             + (f" · {r['latencyMs'] / 1000:.1f}초" if r.get("latencyMs") else ""))
                if r.get("message"):
                    lines.append(f"- AI의 말: {r['message']}")
                if r.get("options"):
                    lines.append(f"- 선택지: {', '.join(r['options'])}")
                if r.get("steps"):
                    lines.append("- 계획: `" + json.dumps(r["steps"], ensure_ascii=False)[:1500] + "`")
                lines.append("")
        return "\n".join(lines)


class SelfTestRegistry:
    def __init__(self) -> None:
        self.runs: dict[str, SelfTest] = {}
        self.lock = threading.Lock()

    def start(self, test: SelfTest) -> dict[str, Any]:
        with self.lock:
            if any(t.state["state"] == "running" for t in self.runs.values()):
                raise RuntimeError("이미 점검이 진행 중입니다")
            self.runs[test.id] = test
        threading.Thread(target=test.run, daemon=True, name=f"selftest-{test.id}").start()
        return self.public(test)

    def get(self, sid: str) -> SelfTest | None:
        return self.runs.get(sid)

    @staticmethod
    def public(test: SelfTest) -> dict[str, Any]:
        return {k: v for k, v in test.state.items() if k != "cancel"}
