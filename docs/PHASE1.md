# Phase 1 개발 보고서

작성일: 2026-11-04

## 1. 개발 환경 확인

| 항목 | 결과 |
| --- | --- |
| Node.js / npm | v22 / v10 ✅ |
| Python | 3.13 ✅ (Phase 3 백엔드용) |
| Rust / Cargo | 설치됨 ✅ (Phase 7 Tauri용) |
| Blender | 미설치 — Phase 6 전까지 필요 없음. 웹 편집 기능은 Blender 없이 동작 |

참고: npm의 peer 의존성 해석 버그(`Cannot read properties of null (reading 'edgesOut')`)를 피하기 위해
루트 `.npmrc`에 `legacy-peer-deps=true`를 설정했습니다.

## 2. 구현된 기능 (모두 실제 동작)

### 프로그램 UI (다크 테마, 파랑·보라 포인트)
- **상단**: 로고, 프로젝트 이름(편집 가능, 내보내기 파일명으로 사용), 실행 취소/다시 실행, 도형 추가, GLB 불러오기, 내보내기
- **왼쪽**: 씬 계층(트리, 펼치기/접기, 표시/숨김, 삭제) · 모델 목록 · 프로젝트(현재 세션) · 파일(불러온 파일 목록)
- **중앙**: 3D 뷰포트 + 도구 모음(이동/회전/크기, 월드/로컬 좌표, 선택 모드, 맞추기, 그리드)
- **오른쪽**: Object Properties(이름 변경·유형·원본 파일·표시) · Transform(숫자 입력) · Material(색상·Metallic·Roughness) · Texture(연결된 맵·해상도) · Geometry Information(메시·정점·삼각형·재질·텍스처·크기)
- **하단**: AI Assistant(Phase 4 안내) · 명령 실행 내역(Undo/Redo 스택) · 작업 로그(성공/경고/오류) · 상태 표시줄
- 패널별 오류 격리(ErrorBoundary): 한 패널 오류가 프로그램 전체를 멈추지 않음

### 3D 뷰포트 (React Three Fiber + Drei)
- 궤도 회전 / 이동 / 확대·축소 (OrbitControls), 축 방향 기즈모
- 클릭 선택 (오브젝트 모드: 모델 전체 / 메시 모드: 개별 메시), 빈 곳 클릭 시 선택 해제, 선택 박스 표시
- Transform Controls 드래그로 이동/회전/크기 조절 → 드래그 1회가 명령 1개로 기록
- 오프라인 PBR 환경광(RoomEnvironment) — 외부 HDR 다운로드 없음
- 선택 대상/전체에 카메라 맞추기(F), 파일 드래그 앤 드롭으로 불러오기

### 편집 엔진 (`packages/editor-core`)
- 모든 편집은 **명령(Command)** 으로 실행 → Undo/Redo·작업 내역·(Phase 4) AI 명령이 같은 경로 사용
- 구현된 명령: `AddObject`, `RemoveObject`(원래 위치로 복원), `RenameObject`, `SetTransform`, `ChangeMaterial`, `SetVisibility`
- 값 검증: 잘못된 색상, NaN Transform 등은 실행 전에 거부
- 재질 슬라이더/색상은 실시간 반영 후 입력이 멈추면 명령 1개로 기록
- 기본 도형: 큐브, 구, 원기둥, 원뿔, 토러스, 평면 (고유 이름 자동 부여: Box, Box.001 …)

### GLB 불러오기 / 내보내기
- `.glb`, `.gltf`(외부 `.bin`·텍스처는 함께 선택) 불러오기, Meshopt 압축 지원
- 검증: 확장자, 최대 200MB, GLB 시그니처·버전·길이, glTF 2.0 여부, 빈 파일
- 메시·재질·텍스처·스킨·애니메이션 데이터를 그대로 보존
- 씬 전체를 GLB(glTF 2.0 바이너리)로 내보내기 — 애니메이션 포함

## 3. 테스트 결과

- `npm run typecheck` / `npm run build`: 통과
- `npm test` (Vitest): 7개 통과 — 명령 실행/취소/재실행, 삭제 후 순서 복원, 값 검증, 이름 생성, 통계, GLB/glTF 검증
- `npm run test:e2e` (Playwright, 실제 Chromium에서 UI 조작): 25개 검사 모두 통과
  - 도형 추가, 숫자 입력 Transform + Ctrl+Z/Ctrl+Y, 재질 3종 변경 + 실행 취소 버튼, 이름 변경, Delete/복원
  - 뷰포트 클릭 선택, 기즈모 드래그 이동 + Undo
  - GLB 내보내기 → 다시 불러오기 왕복 시 메시 이름·색상·Metallic·위치 보존 확인
  - 잘못된 GLB / 지원하지 않는 형식 거부 메시지
  - Khronos 샘플 DamagedHelmet(텍스처 5종), Fox(스킨 + 애니메이션 3개) 불러오기·왕복 확인
  - 콘솔 오류 없음
- 테스트 중 발견해 수정한 버그: 최신 Chromium에서 `scrollIntoView`가 Promise를 반환해 React effect 정리 함수 오류가 나던 문제

## 4. 완료 / 미완성 구분

| 기능 | 상태 |
| --- | --- |
| UI 레이아웃, 3D 뷰포트, 도형 생성·편집, Undo/Redo, GLB 입출력 | ✅ 완료 |
| 저장 버튼, 프로젝트 목록 | ⏸ 비활성 표시 (Phase 3: FastAPI + SQLite) |
| AI Assistant 입력 | ⏸ 비활성 표시 (Phase 4) |
| 모델 생성 (Text/Image to 3D) | ⏸ 비활성 표시 (Phase 5) |
| OBJ 불러오기, 오브젝트 부모 변경(드래그), 복제 | Phase 2 |
| Draco / KTX2 압축 모델 | 미지원 — 불러오기 시 명확한 오류 안내 |
| 텍스처 교체 | 미지원 — 현재는 정보 표시만 |
| Blender 연동 | Phase 6 |
| Windows 앱 (Tauri) | Phase 7 |

미구현 기능은 버튼을 비활성화하고 어느 단계에서 구현되는지 표시합니다. 가짜 결과를 만들지 않습니다.

## 5. 알려진 제한

- 새로고침하면 작업이 사라집니다 (저장은 Phase 3). 결과물은 GLB로 내보내 보관하세요.
- 여러 메시가 같은 재질을 공유하는 모델에서 재질을 바꾸면 공유하는 메시 모두에 적용됩니다.
- 숨긴 오브젝트도 GLB에 포함되어 내보내집니다 (glTF에는 표시 여부 속성이 없음). 로그에 개수를 안내합니다.
- 불러온 모델은 원점에 배치됩니다 (자동 배치/정렬은 이후 단계).
