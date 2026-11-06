/**
 * FORM3D Phase 1 E2E 스모크 테스트 (실제 브라우저에서 UI를 조작해 검증)
 *
 * 사용법:
 *   npm run build && npm run preview   (다른 터미널)
 *   node scripts/e2e-smoke.mjs [텍스처가 있는 샘플.glb 경로]
 *
 * 필요: playwright (npm i -D playwright && npx playwright install chromium)
 * 환경 변수: FORM3D_URL (기본 http://localhost:4173), SHOT_DIR (스크린샷 저장 폴더)
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const URL = process.env.FORM3D_URL ?? 'http://localhost:4173';
const SHOT_DIR = process.env.SHOT_DIR ?? path.join(os.tmpdir(), 'form3d-e2e');
const SAMPLE = process.argv[2];
fs.mkdirSync(SHOT_DIR, { recursive: true });
// require 사용: 전역 설치(NODE_PATH)된 playwright도 찾을 수 있도록
const { chromium } = createRequire(import.meta.url)('playwright');

let failures = 0;
const check = (cond, msg) => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${msg}`);
  if (!cond) failures++;
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, acceptDownloads: true });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

const engine = (fn) => page.evaluate(fn);
const rootNames = () => engine(() => window.__FORM3D__.root.children.map((o) => o.name));
const selectedName = () => engine(() => window.__FORM3D__.getSelected()?.name ?? null);
const shot = (name) => page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`) });
const lastLog = () => page.locator('[data-testid=log-panel] > div[data-level]').last().innerText();

console.log(`▶ ${URL}`);
await page.goto(URL);
await page.waitForSelector('canvas');
await page.waitForTimeout(800);
check((await page.title()).includes('FORM3D'), '앱 로드');
await shot('01-empty');

console.log('▶ 기본 도형 생성');
for (const label of ['큐브', '구', '토러스']) {
  await page.getByRole('button', { name: '도형 추가' }).click();
  await page.getByRole('menuitem', { name: new RegExp(label) }).click();
}
check(JSON.stringify(await rootNames()) === '["Box","Sphere","Torus"]', `도형 3개 추가 → ${await rootNames()}`);
check((await selectedName()) === 'Torus', '마지막 추가 도형이 선택됨');
check(await page.locator('[role=tree] [data-node-name="Sphere"]').isVisible(), 'Scene Hierarchy에 표시');

console.log('▶ Transform 숫자 입력 + Undo/Redo');
await page.locator('[data-node-name="Sphere"]').click();
const posX = page.getByLabel('위치 X');
await posX.fill('2');
await posX.press('Enter');
const sx = () => engine(() => window.__FORM3D__.getObject(window.__FORM3D__.getSelectedId()).position.x);
check((await sx()) === 2, 'Sphere 위치 X = 2');
await page.keyboard.press('Control+z');
check((await sx()) === 0, 'Ctrl+Z → X = 0');
await page.keyboard.press('Control+y');
check((await sx()) === 2, 'Ctrl+Y → X = 2');

console.log('▶ 재질 (색상/Metallic/Roughness)');
await page.getByLabel('색상').fill('#ff3366');
await page.getByLabel('Metallic').fill('0.9');
await page.getByLabel('Roughness').fill('0.2');
await page.waitForTimeout(600);
const mat = await engine(() => {
  const m = window.__FORM3D__.getSelected().material;
  return { c: m.color.getHexString(), me: m.metalness, r: m.roughness };
});
check(mat.c === 'ff3366' && mat.me === 0.9 && mat.r === 0.2, `재질 적용 ${JSON.stringify(mat)}`);
const histNames = () => engine(() => window.__FORM3D__.getHistoryEntries().done.map((h) => h.name));
check((await histNames()).at(-1) === 'ChangeMaterial', '재질 변경이 명령 1개로 기록됨');
await page.getByRole('button', { name: '실행 취소' }).click();
check(
  (await engine(() => window.__FORM3D__.getSelected().material.color.getHexString())) === '9aa4b5',
  '실행 취소 버튼 → 원래 색상 복원',
);
await page.getByRole('button', { name: '다시 실행' }).click();
await shot('02-material');

console.log('▶ 이름 변경 / 삭제 / 복원');
const nameInput = page.getByLabel('오브젝트 이름');
await nameInput.fill('MyBall');
await nameInput.press('Enter');
check((await selectedName()) === 'MyBall', '이름 변경');
await page.locator('canvas').hover();
await page.keyboard.press('Delete');
check(!(await rootNames()).includes('MyBall'), 'Delete 키로 삭제');
await page.keyboard.press('Control+z');
check((await rootNames()).includes('MyBall'), 'Ctrl+Z로 복원 (원래 순서)');

console.log('▶ 뷰포트 클릭 선택 + 기즈모 드래그');
await page.locator('[data-node-name="Box"]').click();
await page.keyboard.press('f');
await page.waitForTimeout(700);
await page.keyboard.press('Escape');
check((await selectedName()) === null, 'Esc → 선택 해제');
const box = await page.locator('canvas').boundingBox();
const cx = box.x + box.width / 2;
const cy = box.y + box.height / 2;
await page.mouse.click(cx, cy);
check((await selectedName()) === 'Box', '뷰포트 중앙 클릭 → Box 선택');
await page.waitForTimeout(300);
const before = await engine(() => window.__FORM3D__.getSelected().position.toArray());
await page.mouse.move(cx, cy);
await page.mouse.down();
await page.mouse.move(cx + 60, cy, { steps: 6 });
await page.mouse.move(cx + 120, cy - 10, { steps: 6 });
await page.mouse.up();
await page.waitForTimeout(200);
const after = await engine(() => window.__FORM3D__.getSelected().position.toArray());
const moved = before.some((v, i) => Math.abs(v - after[i]) > 1e-3);
check(moved, `기즈모 드래그로 이동 ${before.map((v) => v.toFixed(2))} → ${after.map((v) => v.toFixed(2))}`);
check((await selectedName()) === 'Box', '드래그 후에도 선택 유지');
check((await histNames()).at(-1) === 'SetTransform', '드래그가 SetTransform으로 기록됨');
await page.keyboard.press('Control+z');
const undone = await engine(() => window.__FORM3D__.getSelected().position.toArray());
check(undone.every((v, i) => Math.abs(v - before[i]) < 1e-6), '드래그 Undo');
await shot('03-gizmo');

console.log('▶ GLB 내보내기');
const [download] = await Promise.all([
  page.waitForEvent('download'),
  page.getByRole('button', { name: /내보내기/ }).click(),
]);
const exportPath = path.join(SHOT_DIR, download.suggestedFilename());
await download.saveAs(exportPath);
const buf = fs.readFileSync(exportPath);
check(buf.subarray(0, 4).toString() === 'glTF' && buf.readUInt32LE(4) === 2, `GLB 파일 생성 ${download.suggestedFilename()} (${buf.length} bytes)`);

console.log('▶ 내보낸 GLB 다시 불러오기 (왕복)');
const countBefore = (await rootNames()).length;
await page.getByTestId('file-input').first().setInputFiles(exportPath);
await page.waitForFunction((n) => window.__FORM3D__.root.children.length === n + 1, countBefore);
const reimported = await engine(() => {
  const r = window.__FORM3D__.root.children.at(-1);
  const names = [];
  r.traverse((o) => o.isMesh && names.push(o.name));
  const ball = r.getObjectByName('MyBall');
  return { names, color: ball?.material.color.getHexString(), metal: ball?.material.metalness, x: ball?.position.x };
});
check(
  reimported.names.join() === 'Box,MyBall,Torus' && reimported.color === 'ff3366' && reimported.metal === 0.9 && reimported.x === 2,
  `메시/재질/Transform 보존 ${JSON.stringify(reimported)}`,
);

console.log('▶ 잘못된 파일 거부');
const badPath = path.join(SHOT_DIR, 'fake.glb');
fs.writeFileSync(badPath, 'this is not a glb file at all');
await page.getByTestId('file-input').first().setInputFiles(badPath);
await page.waitForTimeout(300);
check(/시그니처|손상/.test(await lastLog()), `오류 표시: ${await lastLog()}`);
const txtPath = path.join(SHOT_DIR, 'note.txt');
fs.writeFileSync(txtPath, 'x');
await page.getByTestId('file-input').first().setInputFiles(txtPath);
await page.waitForTimeout(200);
check(/지원하지 않는 형식/.test(await lastLog()), `형식 거부: ${await lastLog()}`);

if (SAMPLE) {
  console.log(`▶ 샘플 모델 불러오기: ${path.basename(SAMPLE)}`);
  const n = (await rootNames()).length;
  await page.getByTestId('file-input').first().setInputFiles(SAMPLE);
  await page.waitForFunction((k) => window.__FORM3D__.root.children.length === k + 1, n, { timeout: 30000 });
  await page.waitForTimeout(1200);
  check(/불러오기 완료/.test(await lastLog()), await lastLog());
  await page.getByRole('button', { name: '선택 모드: 메시 (개별 메시 선택)' }).click();
  const b2 = await page.locator('canvas').boundingBox();
  // 화면 중앙은 Transform 기즈모가 차지하므로 모델의 다른 부분을 클릭
  await page.mouse.click(b2.x + b2.width / 2 - 100, b2.y + b2.height / 2 + 50);
  await page.waitForTimeout(300);
  const tex = await page.locator('section', { hasText: 'Texture' }).locator('li').count();
  check(tex > 0, `메시 선택 후 텍스처 정보 ${tex}개 표시 (선택: ${await selectedName()})`);
  await shot('04-sample');
}

await page.getByRole('tab', { name: '명령 실행 내역' }).click();
await shot('05-history');

const relevantErrors = errors.filter((e) => !/WebGL|GPU stall|GL Driver/i.test(e));
check(relevantErrors.length === 0, `콘솔 오류 없음 ${relevantErrors.length ? JSON.stringify(relevantErrors) : ''}`);

await browser.close();
console.log(`\n스크린샷: ${SHOT_DIR}`);
console.log(failures === 0 ? '✅ 모든 E2E 검사 통과' : `❌ 실패 ${failures}건`);
process.exit(failures === 0 ? 0 : 1);
