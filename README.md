# FORM3D — AI 3D Creation Studio

> **사용자용 설치:** [Releases](https://github.com/YPQLIW/FORM3D/releases)에서 `FORM3D-Setup-버전.exe`를 받아 설치하세요. 업데이트는 프로그램이 자동으로 합니다. 자세한 내용은 [사용설명서](docs/사용설명서.md) 0장을 보세요.
>
> **설치 파일 만들기 (개발자):** `package.json`의 버전을 올리고 `v버전` 태그를 push하면, GitHub Actions(`.github/workflows/desktop.yml`)가 Windows 설치 파일을 만들어 Releases에 올립니다. 설치된 프로그램은 이 Releases를 보고 자동 업데이트합니다.


텍스트·이미지로 3D 모델을 만들고, 직접 편집하거나 AI와 대화하며 수정하는 3D 제작 프로그램입니다.
웹과 Windows(Tauri) 버전을 목표로 단계별로 개발합니다.

> **현재 상태: Phase 2 완료** — Phase 1(웹 에디터, 3D 뷰포트, 도형 편집, Undo/Redo, GLB 입출력)에
> OBJ 불러오기, 여러 개 선택·복제, 그룹화/해제, 정밀 Transform, 다중 기즈모·스냅, 정렬·분배, 카메라 시점 프리셋,
> 씬 계층 드래그 앤 드롭을 추가했습니다. **처음이라면 [docs/사용설명서.md](docs/사용설명서.md)부터 보세요.** 개발 내용은 [docs/PHASE2.md](docs/PHASE2.md) · [docs/PHASE1.md](docs/PHASE1.md)를 보세요.

## 빠른 시작

필요: **Node.js 20 이상** (npm 포함)

```bash
cd FORM3D
npm install          # .npmrc의 legacy-peer-deps 설정이 자동 적용됩니다
npm run dev          # http://localhost:5173
```

| 명령 | 설명 |
| --- | --- |
| `npm run dev` | 개발 서버 실행 (http://localhost:5173) |
| `npm run build` | 타입 검사 + 프로덕션 빌드 (`apps/web/dist`) |
| `npm run preview` | 빌드 결과 실행 (http://localhost:4173) |
| `npm run typecheck` | TypeScript 타입 검사 |
| `npm test` | 편집 엔진 단위 테스트 (Vitest) |
| `npm run test:e2e -- [샘플.glb]` | Phase 1 실제 브라우저 E2E 테스트 (preview 실행 중이어야 함, Playwright 필요) |
| `npm run test:e2e:phase2 -- [애니메이션.glb]` | Phase 2 실제 브라우저 E2E 테스트 |

## 폴더 구조

```
FORM3D/
├─ apps/
│  ├─ web/                 React + Vite 웹 에디터 (Phase 1 ✅)
│  └─ desktop/             Tauri 2 Windows 앱 (Phase 7 예정)
├─ backend/                FastAPI 백엔드 (Phase 3 예정)
│  └─ app/{api,ai,generation,modeling,blender,storage,core}
├─ packages/
│  ├─ model-types/         공용 타입 (Transform, Material, 편집 명령 이름 …)
│  ├─ editor-core/         편집 엔진: 씬·다중 선택·명령(Undo/Redo)·도형·그룹·정렬·GLB/OBJ 입출력·통계
│  └─ shared/              상수(파일 제한 등)·유틸·오류 타입
├─ assets/{models,textures,previews}
├─ scripts/                E2E 테스트 등 개발 스크립트
└─ docs/                   개발 문서
```

## 기술 스택

React 19 · TypeScript · Vite 8 · Tailwind CSS 4 · Three.js 0.187 · React Three Fiber 9 · Drei 10 · Zustand
(예정: FastAPI · Pydantic · SQLite · Blender Python API · Tauri 2)

## Phase 3 (v0.3.0) 추가
- 처음 한 번: `npm install` → `npm run setup` (Python 3.10+ 필요, 로컬 서버 설치) → (선택) `npm run ai:key`
- 실행: `npm run dev` (로컬 서버 127.0.0.1:8765 + 편집기 5173)
- 테스트: `npm test` · `npm run test:backend` · `npm run test:e2e:phase3` (빌드 후 4173 preview 필요)
- 문서: `docs/PHASE3.md`(결과 보고), `docs/사용설명서.md`, `docs/ONI-API.md`

## Phase 4 (v0.4.0) 추가
- 통합 AI: Claude · Qwen API(DashScope) · Qwen Local(Ollama) — 화면 위쪽 ⚙ AI 설정
- 업데이트 시 `npm run setup` 한 번 다시 (httpx 추가)
- 테스트: `npm run test:backend` · `npm run test:e2e:phase4`
- 문서: `docs/PHASE4.md`, 사용설명서 15장
