# 아키텍처

## 데이터 흐름

```
UI (React 패널) ──명령 생성──▶ EditorEngine.execute(command) ──▶ Three.js 씬 그래프 변경
      ▲                                   │
      └──── useSyncExternalStore ◀── notify() (revision 증가)
```

- **EditorEngine** (`packages/editor-core/src/engine.ts`): `root`(사용자 콘텐츠 전용 Group), 선택, 명령 기록.
  Three.js 씬 그래프가 메시·재질의 원본이므로 불러온 모델 데이터가 변환 없이 보존됩니다.
- **Command** (`history.ts`, `commands/`): `execute`/`undo`를 갖는 편집 단위.
  드래그·슬라이더처럼 이미 적용된 변경은 `engine.record()`로 기록만 합니다.
- **선택** (Phase 2): `EditorEngine`이 여러 개 선택을 관리합니다. 배열의 마지막이 활성 오브젝트이며,
  Phase 1 API(`getSelected`/`select`)는 활성 오브젝트 기준으로 그대로 동작합니다.
  `getTopLevelSelection()`은 부모·자식이 함께 선택된 경우 부모만 돌려줘 이동/복제/삭제가 두 번 적용되지 않게 합니다.
- **CompositeCommand** (`commands/composite.ts`): 여러 명령을 Undo 1회 단위로 묶고, 실행 전후 선택도 함께 복원합니다.
  다중 삭제·다중 드래그·정렬·여러 그룹 해제가 이 경로를 씁니다. 중간에 실패하면 이미 실행한 명령을 되돌립니다.
- **계층 명령** (`commands/hierarchy.ts`): `DuplicateObjects`, `GroupObjects`, `UngroupObject`, `ReparentObject`.
  모두 월드 Transform을 유지하고, Undo 시 원래 부모·순서·로컬 Transform을 정확히 복원합니다.
- **정렬/스냅 계산** (`align.ts`): 순수 함수가 변경 목록(before/after)을 만들고 `changesToCommand`가 명령으로 묶습니다.
  UI 없이도 같은 함수를 AI 명령(Phase 4)에서 재사용할 수 있습니다.
- **모델 불러오기** (`io/import.ts`): 확장자별 로더 선택. 새 형식(FBX, STL 등)은 여기에 로더를 추가하면 UI 변경 없이 연결됩니다.
  OBJ(`io/obj.ts`)는 Phong 재질을 PBR(MeshStandardMaterial)로 변환해 재질 편집·GLB 내보내기와 호환됩니다.
- **앱 상태** (`apps/web/src/state/appStore.ts`, Zustand): 도구 모드, 스냅 설정, 카메라 시점 요청, 로그, 탭 등 UI 상태.
- **동작** (`apps/web/src/lib/actions.ts`): UI 동작을 명령으로 바꾸고 오류를 로그에 기록.

## 이후 단계와의 연결

- **Phase 3 (백엔드)**: `backend/app/storage`에 SQLite 프로젝트 저장, 원본 파일 백업. 웹은 GLB + 씬 메타데이터를 업로드.
- **Phase 4 (AI 편집)**: LLM이 `EDITOR_COMMAND_NAMES` 범위의 JSON 명령 생성 → 스키마 검증 → 기존 Command 클래스로 실행.
  허용되지 않은 명령은 실행하지 않습니다.
- **Phase 5 (생성 엔진)**: `backend/app/generation`에 공통 인터페이스(Local / Meshy / Tripo). API 키는 서버에만 보관.
- **Phase 6 (Blender)**: `backend/app/blender`에서 허용된 스크립트만 백그라운드 Blender로 실행.
- **Phase 7 (Tauri)**: `apps/desktop`이 `apps/web` 빌드 결과를 감싸는 구조. Vite 포트 5173 고정.

## Phase 3 구조
```
편집기(React) ── /api (Vite 프록시) ──> 로컬 서버 FastAPI 127.0.0.1:8765
  lib/project.ts   저장·열기·자동 저장·복구(IndexedDB)     storage/  SQLite + .form3d 파일, 버전, 원자적 쓰기
  lib/assistant.ts 문장→작업→검증→미리보기→실행               ai/       AI 연결부(Claude) — 계획만, 실행 안 함
  lib/bridge.ts    WebSocket <────── /api/bridge ────── api/v1   외부 AI(온이): 토큰·scope·로컬 전용
editor-core/ai     validate · executor(원자적, Undo 1회) · ruleParser · describe
model-types/commands.json  명령 표준 (TS·Python 공용 단일 기준)
engines/registry   이미지·애니메이션·영상·3D 생성 엔진 자리 (구조만)
```
