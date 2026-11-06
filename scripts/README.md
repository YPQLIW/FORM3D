# scripts

- `e2e-smoke.mjs` — 실제 Chromium에서 에디터 UI를 조작해 Phase 1 기능을 검사합니다.
  ```bash
  npm run build && npm run preview          # 다른 터미널에서 실행 유지
  npm i -D playwright && npx playwright install chromium   # 최초 1회
  npm run test:e2e -- path/to/sample.glb   # 샘플 경로는 선택
  ```

- `e2e-phase2.mjs` — Phase 2 기능(OBJ, 다중 선택, 복제, 그룹, 정밀 Transform, 다중 기즈모·스냅, 정렬, 카메라 시점, 씬 계층)을 검사합니다.
  테스트용 OBJ/MTL/PNG 파일은 스크립트가 직접 만듭니다.
  ```bash
  npm run test:e2e:phase2 -- path/to/Fox.glb   # 애니메이션 샘플은 선택 (복제/그룹 해제 거부 검사)
  ```
