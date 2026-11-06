# FORM3D Backend (Phase 3 예정)

Python + FastAPI + Pydantic + SQLite. 아직 코드가 없습니다 — Phase 1은 웹 에디터만 포함합니다.

| 폴더 | 역할 (예정) |
| --- | --- |
| `app/api` | REST API 라우터 |
| `app/ai` | LLM 어댑터, 자연어 → JSON 편집 명령 변환·검증 (Phase 4) |
| `app/generation` | Generation Engine Manager: Local / Meshy / Tripo (Phase 5) |
| `app/modeling` | 서버측 모델 처리·검증 |
| `app/blender` | Blender Python API 연동, 실행 권한 제한 (Phase 6) |
| `app/storage` | SQLite + 로컬 파일 저장, 원본 백업 |
| `app/core` | 설정, 보안, 로깅, 공통 오류 |
