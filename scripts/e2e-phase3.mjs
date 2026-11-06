/**
 * FORM3D Phase 3 E2E 테스트 — 프로젝트 저장/복구, AI Assistant, 외부 API(온이)
 * 실제 Chromium에서 UI를 조작하고, 테스트용 로컬 서버(backend/tests/e2e_server.py)를 띄워 검증합니다.
 * (테스트 서버는 실제 Claude 대신 정해진 답을 돌려주는 테스트용 계획기를 씁니다. 제품 실행에는 쓰이지 않습니다.)
 *
 * 사용법:
 *   npm run setup   (처음 한 번 — backend/.venv)
 *   npm run build && (cd apps/web && npx vite preview --port 4173)   (다른 터미널)
 *   npm run test:e2e:phase3
 *
 * 환경 변수: FORM3D_URL (기본 http://localhost:4173), SHOT_DIR, FORM3D_PYTHON (파이썬 경로, 기본 backend/.venv)
 */
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { BACKEND, VENV_PY } from './backend-env.mjs';

const URL = process.env.FORM3D_URL ?? 'http://localhost:4173';
const SHOT_DIR = process.env.SHOT_DIR ?? path.join(os.tmpdir(), 'form3d-e2e-phase3');
const PY = process.env.FORM3D_PYTHON ?? VENV_PY;
const API = 'http://127.0.0.1:8765';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'form3d-e2e-data-'));
const { chromium } = createRequire(import.meta.url)('playwright');

let failures = 0;
let total = 0;
const check = (cond, msg, extra) => {
  total++;
  console.log(`${cond ? '  ✓' : '  ✗'} ${msg}${!cond && extra !== undefined ? ` → ${JSON.stringify(extra)}` : ''}`);
  if (!cond) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const near = (a, b, eps = 1e-3) => Math.abs(a - b) <= eps;
const nearArr = (a, b, eps = 1e-3) => a.length === b.length && a.every((v, i) => near(v, b[i], eps));

// ---------- 테스트 데이터: 텍스처 있는 OBJ ----------
function png2x2(r, g, b) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(2, 0);
  ihdr.writeUInt32BE(2, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const row = Buffer.from([0, r, g, b, r, g, b]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(Buffer.concat([row, row]))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
const objDir = path.join(SHOT_DIR, 'obj');
fs.mkdirSync(objDir, { recursive: true });
fs.writeFileSync(
  path.join(objDir, 'crate.obj'),
  `mtllib crate.mtl\no Crate\nv -0.5 0 -0.5\nv 0.5 0 -0.5\nv 0.5 1 -0.5\nv -0.5 1 -0.5\nv -0.5 0 0.5\nv 0.5 0 0.5\nv 0.5 1 0.5\nv -0.5 1 0.5\nvt 0 0\nvt 1 0\nvt 1 1\nvt 0 1\nusemtl Wood\nf 5/1 6/2 7/3 8/4\nf 2/1 1/2 4/3 3/4\nf 1/1 5/2 8/3 4/4\nf 6/1 2/2 3/3 7/4\nf 8/1 7/2 3/3 4/4\nf 1/1 2/2 6/3 5/4\n`,
);
fs.writeFileSync(path.join(objDir, 'crate.mtl'), `newmtl Wood\nKd 1 1 1\nmap_Kd wood.png\n`);
fs.writeFileSync(path.join(objDir, 'wood.png'), png2x2(200, 120, 40));

// ---------- 테스트 서버 ----------
let backend = null;
async function startBackend() {
  backend = spawn(PY, [path.join(BACKEND, 'tests', 'e2e_server.py'), DATA_DIR, '8765'], {
    cwd: BACKEND,
    stdio: ['ignore', 'inherit', 'inherit'],
    env: { ...process.env, PYTHONUTF8: '1' },
  });
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${API}/api/health`)).ok) return true;
    } catch {
      /* 아직 시작 중 */
    }
    await sleep(100);
  }
  return false;
}
const token = () =>
  fs.readFileSync(path.join(DATA_DIR, 'oni-token.txt'), 'utf8').split(/\r?\n/).find((l) => l && !l.startsWith('#'));
const v1 = (method, p, body, tk = token(), headers = {}) =>
  fetch(`${API}/api/v1${p}`, {
    method,
    headers: { ...(tk ? { Authorization: `Bearer ${tk}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

// ---------- 브라우저 ----------
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, acceptDownloads: true });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('dialog', (d) => void d.accept()); // 새로고침 시 '저장 안 된 변경' 경고 → 진행

const ev = (fn, arg) => page.evaluate(fn, arg);
const shot = (name) => page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`) });
const rootNames = () => ev(() => window.__FORM3D__.root.children.map((o) => o.name));
const selNames = () => ev(() => window.__FORM3D__.getSelectedObjects().map((o) => o.name));
const isDirty = () => ev(() => window.__FORM3D_PROJECT__.isDirty());
const dirtyDot = () => page.getByTestId('dirty-indicator').getAttribute('data-dirty');
const logs = () => ev(() => window.__FORM3D_APP__.getState().logs.map((l) => l.message));
const lastLog = async () => (await logs()).at(-1) ?? '';
const projectName = () => ev(() => window.__FORM3D_APP__.getState().projectName);
const tab = (name) => page.getByRole('tab', { name }).click();
const addPrim = async (label) => {
  await page.getByRole('button', { name: '도형 추가' }).click();
  await page.getByRole('menuitem', { name: new RegExp(label) }).click();
};
const waitLog = async (re, ms = 15000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const all = await logs();
    if (all.some((l) => re.test(l))) return true;
    await sleep(100);
  }
  return false;
};
const logCount = async () => (await logs()).length;
const waitNewLog = async (re, since, ms = 15000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const all = (await logs()).slice(since);
    const hit = all.find((l) => re.test(l));
    if (hit) return hit;
    await sleep(100);
  }
  return null;
};
/** 씬 전체 상태 (데이터 손실 비교용) */
const snapshot = () =>
  ev(() => {
    const e = window.__FORM3D__;
    const out = [];
    const r = (v) => Math.round(v * 1e4) / 1e4;
    e.root.traverse((o) => {
      if (o === e.root) return;
      const m = o.material;
      const mats = m ? (Array.isArray(m) ? m : [m]) : [];
      out.push({
        name: o.name,
        mesh: !!o.isMesh,
        parent: o.parent === e.root ? null : o.parent.name,
        visible: o.visible,
        p: o.position.toArray().map(r),
        q: o.quaternion.toArray().map(r),
        s: o.scale.toArray().map(r),
        mats: mats.map((x) => ({ c: x.color?.getHexString(), m: r(x.metalness ?? -1), ro: r(x.roughness ?? -1), map: !!x.map })),
        verts: o.geometry?.attributes?.position?.count ?? null,
      });
    });
    return out;
  });
const camera = () => ev(() => {
  const { camera, controls } = window.__FORM3D_VIEW__;
  return { p: camera.position.toArray(), t: controls.target.toArray() };
});
const sameScene = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const firstDiff = (a, b) => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) return { i, a: a[i], b: b[i] };
  return null;
};
const ask = async (text) => {
  const before = await page.getByTestId('job-card').count();
  await page.getByLabel('AI 명령 입력').fill(text);
  await page.getByLabel('AI 명령 입력').press('Enter');
  await page.waitForTimeout(150);
  return { card: page.getByTestId('job-card').nth(before), added: (await page.getByTestId('job-card').count()) > before };
};
const runCard = async (card) => {
  await card.getByTestId('job-run').click();
  await page.waitForTimeout(150);
  return card.getAttribute('data-state');
};

try {
  console.log(`▶ ${URL}  (데이터 폴더: ${DATA_DIR})`);
  await page.goto(URL);
  await page.waitForSelector('canvas');
  await page.waitForTimeout(800);

  // ===================================================================
  console.log('▶ 1. 로컬 서버 없이: 상태 표시 · 규칙 기반 해석기 (예시 6문장)');
  check((await page.getByTestId('server-status').getAttribute('data-server')) === 'offline', '서버 꺼짐 상태 표시');
  await tab('AI Assistant');
  check(/연결 안 됨/.test(await page.getByTestId('ai-status').innerText()), 'AI 미연결이라고 정직하게 표시');
  check(await page.getByTestId('mode-ai').isDisabled(), 'AI 모드 버튼 비활성 (가짜 AI 없음)');

  let { card, added } = await ask('큐브 하나 만들어 줘.');
  check(added && (await card.getAttribute('data-state')) === 'pending', '① 명령 미리보기 카드 (실행 전 대기)');
  check(/^job_/.test(await card.getAttribute('data-job-id')), '고유 작업 ID 부여');
  check(/규칙 기반 해석기 · AI 아님/.test(await card.innerText()), '출처 표시: 규칙 기반 · AI 아님');
  check((await rootNames()).length === 0, '실행 전에는 씬 변화 없음');
  check((await runCard(card)) === 'done', '[실행] → 완료');
  check(JSON.stringify(await rootNames()) === '["Box"]', '큐브 생성됨', await rootNames());

  const x0 = await ev(() => window.__FORM3D__.root.getObjectByName('Box').position.x);
  ({ card } = await ask('선택한 오브젝트를 오른쪽으로 3만큼 이동해 줘.'));
  await runCard(card);
  check(near(await ev(() => window.__FORM3D__.root.getObjectByName('Box').position.x), x0 + 3), '② 오른쪽으로 3 이동');

  await addPrim('구');
  ({ card } = await ask('모든 오브젝트를 선택해 줘.'));
  await runCard(card);
  check(JSON.stringify((await selNames()).sort()) === '["Box","Sphere"]', '③ 모두 선택', await selNames());

  ({ card } = await ask('선택한 물체의 색상을 파란색으로 변경해 줘.'));
  await runCard(card);
  const colors = await ev(() => window.__FORM3D__.root.children.map((o) => o.material.color.getHexString()));
  check(colors.every((c) => c === '1e88e5'), '④ 파란색으로 변경', colors);

  ({ card } = await ask('이 오브젝트를 복제해 줘.'));
  await runCard(card);
  check((await rootNames()).length === 4, '⑤ 복제 (2개 → 4개)', await rootNames());

  ({ card } = await ask('선택한 물체들을 하나의 그룹으로 묶어 줘.'));
  await runCard(card);
  const grouped = await ev(() => window.__FORM3D__.root.getObjectByName('Group')?.children.map((c) => c.name) ?? []);
  check((await rootNames()).length === 3 && grouped.length === 2, '⑥ 선택한 물체들(복제본 2개)을 그룹으로 묶음', { root: await rootNames(), grouped });
  check(await card.getByTestId('job-undo').isVisible(), '완료된 작업에 "이 작업 실행 취소" 버튼');
  await card.getByTestId('job-undo').click();
  check((await rootNames()).length === 4, '작업 실행 취소 → 그룹 해제 상태로 복원');
  await page.keyboard.press('Control+y');
  check((await rootNames()).length === 3, 'Ctrl+Y 다시 실행 → 다시 그룹', await rootNames());

  const histBefore = await ev(() => window.__FORM3D__.getHistoryEntries().done.length);
  ({ card } = await ask('모두 위로 2만큼 올린 다음 선택 해제해 줘'));
  check((await card.getByTestId('job-step').count()) >= 2, '여러 단계 명령 해석 (이동 + 선택 해제)');
  await card.getByTestId('job-cancel').click();
  check((await card.getAttribute('data-state')) === 'cancelled', '[취소] → 실행하지 않음');
  check((await ev(() => window.__FORM3D__.getHistoryEntries().done.length)) === histBefore, '취소한 작업은 기록에 없음');

  const notesBefore = await page.getByTestId('assistant-note').count();
  await ask('오늘 날씨 알려줘');
  check((await page.getByTestId('assistant-note').count()) === notesBefore + 1, '이해 못 한 문장 → 추측 없이 안내만');
  await shot('p3-01-rules');

  // ===================================================================
  console.log('▶ 2. 서버 없이 저장 → .form3d 내려받기 → 파일 열기 (데이터 손실 없음)');
  check((await dirtyDot()) === 'true' && (await page.title()).startsWith('●'), '저장 안 된 변경 표시 (점 + 창 제목 ●)');
  const offlineScene = await snapshot();
  const dlPromise = page.waitForEvent('download');
  await page.getByTestId('save-button').click();
  const dl = await dlPromise;
  const localFile = path.join(SHOT_DIR, dl.suggestedFilename());
  await dl.saveAs(localFile);
  check(dl.suggestedFilename().endsWith('.form3d'), `서버 꺼짐 → .form3d 파일로 내려받기 (${dl.suggestedFilename()})`);
  check(fs.readFileSync(localFile).subarray(0, 2).toString() === 'PK', '내려받은 파일은 ZIP 컨테이너');
  await page.waitForTimeout(200);
  check((await dirtyDot()) === 'false', '내려받은 뒤 저장됨 표시');
  await addPrim('원뿔');
  check((await dirtyDot()) === 'true', '변경 후 다시 저장 안 됨 표시');
  await page.getByTestId('project-file-input').setInputFiles(localFile);
  await page.getByRole('dialog', { name: '저장하지 않은 변경 사항' }).waitFor();
  check(true, '열기 전에 저장 여부 확인 대화상자');
  await page.getByRole('button', { name: '저장 안 함' }).click();
  await waitLog(/프로젝트 열기/);
  const reopened = await snapshot();
  check(sameScene(offlineScene, reopened), '파일에서 연 씬 = 저장 전 씬 (그룹·위치·색상 모두 동일)', firstDiff(offlineScene, reopened));
  check((await dirtyDot()) === 'false', '파일 연 직후 저장 안 된 변경 없음');

  // ===================================================================
  console.log('▶ 3. 로컬 서버 연결');
  check(await startBackend(), '테스트 서버 시작');
  await ev(() => window.__FORM3D_PROJECT__.refreshServer());
  await page.waitForTimeout(300);
  check((await page.getByTestId('server-status').getAttribute('data-server')) === 'online', '서버 연결됨 표시');
  check(/test-planner/.test(await page.getByTestId('ai-status').innerText()), 'AI 연결 상태에 실제 연결된 모델 이름 표시');
  let editorConnected = false;
  for (let i = 0; i < 50 && !editorConnected; i++) {
    editorConnected = (await (await fetch(`${API}/api/health`)).json()).externalApi.editorConnected;
    if (!editorConnected) await sleep(100);
  }
  check(editorConnected, '편집기 ↔ 서버 연결 통로(WebSocket) 연결');

  // ===================================================================
  console.log('▶ 4. 프로젝트 저장소: 저장 · 버전 · 다른 이름 · 이름 변경 · 새 프로젝트 · 열기');
  await page.getByTestId('file-menu').click();
  await page.getByTestId('menu-new').click();
  await page.waitForTimeout(200);
  check((await rootNames()).length === 0 && (await projectName()) === 'Untitled Project', '새 프로젝트 (변경 없으면 바로)');
  await page.locator('[data-testid=file-input]').setInputFiles(['crate.obj', 'crate.mtl', 'wood.png'].map((f) => path.join(objDir, f)));
  await waitLog(/불러오기 완료|가져오기 완료|불러왔습니다/i, 8000);
  await addPrim('구');
  await addPrim('원기둥');
  await ev(() => {
    const e = window.__FORM3D__;
    const s = e.root.getObjectByName('Sphere');
    s.position.set(1.25, 0.5, -2);
    s.rotation.set(0.3, 0.6, 0.1);
    s.scale.set(1.5, 0.75, 1.2);
    s.material.color.set('#33aa77');
    s.material.metalness = 0.8;
    s.material.roughness = 0.2;
    s.updateMatrixWorld(true);
    e.root.getObjectByName('Cylinder').visible = false;
    e.notify();
  });
  // 실제 편집 명령으로 그룹 만들기
  await ev(() => {
    const e = window.__FORM3D__;
    e.setSelection([e.root.getObjectByName('Sphere').uuid, e.root.getObjectByName('Cylinder').uuid]);
  });
  await page.keyboard.press('Control+g');
  await page.keyboard.press('5'); // 상단 시점
  await page.waitForTimeout(700);
  await ev(() => {
    const s = window.__FORM3D_APP__.getState();
    if (s.showGrid) s.toggleGrid();
    s.setSnap({ enabled: true, translate: 0.25 });
    s.setTransformMode('rotate');
  });
  await page.getByLabel('프로젝트 이름').fill('E2E 저장 테스트');
  await page.getByLabel('프로젝트 이름').press('Enter');
  const sceneA = await snapshot();
  const camA = await camera();
  check(sceneA.some((n) => n.mats.some((m) => m.map)), '테스트 씬에 텍스처 포함');

  let n = await logCount();
  await page.keyboard.press('Control+s');
  check(!!(await waitNewLog(/새 프로젝트 저장 완료/, n)), 'Ctrl+S → 저장소에 새 프로젝트 저장');
  await tab('프로젝트');
  await page.waitForTimeout(300);
  check((await page.locator('[data-testid=recent-projects] li').count()) === 1, '최근 프로젝트 목록에 추가');
  check(await page.locator('[data-testid=recent-projects] img').first().isVisible(), '목록에 미리보기 이미지');
  check((await dirtyDot()) === 'false' && !(await page.title()).startsWith('●'), '저장 후 변경 표시 사라짐');
  const firstId = await ev(() => document.querySelector('[data-testid=recent-projects] li').dataset.projectId);

  await ev(() => {
    const e = window.__FORM3D__;
    e.setSelection([e.root.getObjectByName('Crate').uuid]);
  });
  await tab('AI Assistant');
  await page.getByTestId('mode-rules').click();
  ({ card } = await ask('선택한 오브젝트를 오른쪽으로 1.5만큼 이동해 줘'));
  await runCard(card);
  check((await dirtyDot()) === 'true', '편집 후 저장 안 된 변경 표시');
  const sceneB = await snapshot();
  n = await logCount();
  await page.getByTestId('save-button').click();
  check(!!(await waitNewLog(/^.*저장 완료: E2E 저장 테스트/, n)), '저장 (덮어쓰기)');
  const vers = await v1('GET', '/projects').then(() => fetch(`${API}/api/projects/${firstId}/versions`).then((r) => r.json()));
  check(vers.versions.length === 1, '덮어쓰기 전 저장본이 버전으로 보관됨');

  await page.keyboard.press('Control+Shift+s');
  await page.getByRole('dialog', { name: '다른 이름으로 저장' }).waitFor();
  await page.getByLabel('새 프로젝트 이름').fill('E2E 복사본');
  n = await logCount();
  await page.getByLabel('새 프로젝트 이름').press('Enter');
  check(!!(await waitNewLog(/다른 이름으로 저장 완료: E2E 복사본/, n)), 'Ctrl+Shift+S 다른 이름으로 저장');
  await tab('프로젝트');
  await page.waitForTimeout(300);
  check((await page.locator('[data-testid=recent-projects] li').count()) === 2, '목록에 2개');
  await page.getByLabel('프로젝트 이름').fill('이름 바꾼 복사본');
  await page.getByLabel('프로젝트 이름').press('Enter');
  await page.waitForTimeout(400);
  const names = await page.locator('[data-testid=recent-projects] li').allInnerTexts();
  check(names.some((t) => t.includes('이름 바꾼 복사본')) && names.some((t) => t.includes('E2E 저장 테스트')), '이름 변경이 저장소에 반영', names);

  await addPrim('토러스');
  await page.getByTestId('file-menu').click();
  await page.getByTestId('menu-new').click();
  await page.getByRole('dialog', { name: '저장하지 않은 변경 사항' }).waitFor();
  await page.getByRole('button', { name: '저장 안 함' }).click();
  await page.waitForTimeout(200);
  check((await rootNames()).length === 0, '새 프로젝트 (저장 안 함 선택 → 비움)');

  await page.locator(`[data-project-id="${firstId}"]`).getByRole('button', { name: /열기/ }).click();
  await waitLog(/프로젝트 열기: E2E 저장 테스트/);
  await page.waitForTimeout(300);
  const sceneB2 = await snapshot();
  check(sceneB.length > 0 && sameScene(sceneB, sceneB2), '저장소에서 연 씬 = 저장 직전 씬 (계층·Transform·재질·텍스처·숨김)', firstDiff(sceneB, sceneB2));
  const camB = await camera();
  check(nearArr(camA.p, camB.p, 1e-3) && nearArr(camA.t, camB.t, 1e-3), '카메라 위치·시점 복원', { camA, camB });
  const st = await ev(() => {
    const s = window.__FORM3D_APP__.getState();
    return { grid: s.showGrid, snap: s.snap.enabled, step: s.snap.translate, mode: s.transformMode };
  });
  check(st.grid === false && st.snap === true && st.step === 0.25 && st.mode === 'rotate', '프로젝트 설정 복원 (격자·스냅·도구)', st);
  check((await projectName()) === 'E2E 저장 테스트' && (await dirtyDot()) === 'false', '이름 복원 · 변경 없음 상태');

  await page.getByRole('button', { name: /버전 기록 보기/ }).click();
  await page.getByTestId('version-list').getByRole('button', { name: '열기' }).first().click();
  await waitLog(/이전 버전/);
  await page.waitForTimeout(300);
  const sceneV = await snapshot();
  check(sameScene(sceneA, sceneV), '이전 버전 열기 = 첫 저장 때 씬', firstDiff(sceneA, sceneV));
  check((await dirtyDot()) === 'true', '이전 버전을 연 상태는 "저장 안 된 변경" (저장하면 되돌리기)');
  await shot('p3-02-projects');

  // ===================================================================
  console.log('▶ 5. 자동 저장');
  const savedBefore = await ev(() => fetch(`/api/projects`).then((r) => r.json()).then((j) => j.projects.find((p) => p.name === 'E2E 저장 테스트').updatedAt));
  await ev(() => window.__FORM3D_PROJECT__.autosaveTick(Date.now(), true));
  await page.waitForTimeout(300);
  const savedAfter = await ev(() => fetch(`/api/projects`).then((r) => r.json()).then((j) => j.projects.find((p) => p.name === 'E2E 저장 테스트').updatedAt));
  check(savedAfter !== savedBefore && (await dirtyDot()) === 'false', '자동 저장이 저장소 프로젝트를 갱신', { savedBefore, savedAfter });
  check(/자동 저장 완료/.test(await lastLog()), '자동 저장 기록 표시');
  await ev(() => window.__FORM3D_PROJECT__.autosaveTick(Date.now(), true));
  check(/자동 저장 완료/.test(await lastLog()) && !(await isDirty()), '변경 없으면 자동 저장 안 함');

  // ===================================================================
  console.log('▶ 6. 비정상 종료 후 복구');
  await addPrim('원뿔');
  await ev(() => {
    const c = window.__FORM3D__.root.getObjectByName('Cone');
    c.position.set(-3, 0.5, 2);
    c.updateMatrixWorld(true);
  });
  const sceneR = await snapshot();
  check(await ev(() => window.__FORM3D_PROJECT__.writeRecoverySnapshot(true)), '저장 안 된 변경 → 복구용 기록');
  await page.reload();
  await page.waitForSelector('canvas');
  await page.getByRole('dialog', { name: '작업 복구' }).waitFor({ timeout: 5000 });
  check((await page.getByTestId('recovery-name').innerText()) === 'E2E 저장 테스트', '다시 열면 복구 창 표시');
  await page.getByRole('button', { name: '복구하기' }).click();
  await waitLog(/복구했습니다/);
  await page.waitForTimeout(300);
  const sceneR2 = await snapshot();
  check(sameScene(sceneR, sceneR2), '복구한 씬 = 닫히기 직전 씬', firstDiff(sceneR, sceneR2));
  check((await dirtyDot()) === 'true', '복구 후에도 "저장 안 됨" 유지 (저장해야 반영)');
  await ev(() => window.__FORM3D_PROJECT__.writeRecoverySnapshot(true));
  await page.reload();
  await page.waitForSelector('canvas');
  await page.getByRole('dialog', { name: '작업 복구' }).waitFor({ timeout: 5000 });
  await page.getByRole('button', { name: '버리기' }).click();
  await page.reload();
  await page.waitForSelector('canvas');
  await page.waitForTimeout(1000);
  check((await page.getByRole('dialog', { name: '작업 복구' }).count()) === 0, '버리기 후에는 복구 창 없음');

  // ===================================================================
  console.log('▶ 7. AI 모드 (서버의 AI 연결부 경유)');
  await ev(() => window.__FORM3D_PROJECT__.refreshServer());
  await page.waitForTimeout(300);
  await tab('AI Assistant');
  check(!(await page.getByTestId('mode-ai').isDisabled()), 'AI 연결되면 AI 모드 사용 가능');
  await page.getByTestId('mode-ai').click();
  const before7 = (await rootNames()).length;
  ({ card } = await ask('빨간 구 두 개 만들어서 정렬해 줘'));
  await card.waitFor();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=job-card]').length > 0);
  check(/AI · test-planner/.test(await card.innerText()), 'AI가 만든 계획 표시 (출처·모델)');
  check((await card.getByTestId('job-step').count()) === 2, 'JSON 명령 2단계 미리보기');
  check((await rootNames()).length === before7, '실행 전에는 변화 없음');
  check((await runCard(card)) === 'done', '[실행] → 완료');
  check((await rootNames()).length === before7 + 2, '구 2개 생성');
  await page.keyboard.press('Control+z');
  check((await rootNames()).length === before7, 'Ctrl+Z 한 번으로 AI 작업 전체 취소');
  const nn = await page.getByTestId('assistant-note').count();
  await ask('고양이 이미지 만들어 줘');
  await page.waitForTimeout(300);
  check((await page.getByTestId('assistant-note').count()) === nn + 1 && /이미지 생성은/.test(await page.getByTestId('assistant-note').last().innerText()), 'AI가 거절한 요청 → 이유 표시');
  ({ card } = await ask('잘못된 계획 만들어 줘'));
  await page.waitForTimeout(300);
  check((await card.getAttribute('data-state')) === 'invalid' && (await card.getByTestId('job-run').count()) === 0, '검증 실패한 AI 계획은 실행 버튼 없음');
  check(/translate/.test(await card.getByTestId('job-errors').innerText()), '검증 실패 이유 표시');
  await shot('p3-03-ai');

  // ===================================================================
  console.log('▶ 8. 외부 AI(온이) API');
  check((await v1('GET', '/capabilities', null, null)).status === 401, '토큰 없으면 401');
  const caps = await v1('GET', '/capabilities');
  check(caps.status === 200 && caps.body.protocol === 'form3d.command', '기능 조회 (명령 표준 공개)');
  check(caps.body.engines.every((e) => !e.available), '이미지·애니메이션·영상 엔진: 구조만, 사용 불가 표시');
  check((await v1('POST', '/engines/video/jobs')).status === 501, '영상 생성 요청 → 501 (구현 안 함)');
  const evil = await fetch(`${API}/api/health`, { headers: { Origin: 'https://evil.example' } });
  check(evil.status === 403, '다른 웹사이트에서 온 요청 차단');
  check((await v1('POST', '/jobs', { steps: [{ command: 'run_code', params: { code: 'x' } }] })).status === 422, '목록에 없는 명령(코드 실행 등) 거부');

  const nObj = (await rootNames()).length;
  let pending = v1('POST', '/objects', { shape: 'box', name: 'OniBox', color: '#ff8800' });
  await page.locator('[data-testid=job-card][data-state=pending]').last().waitFor({ timeout: 5000 });
  card = page.locator('[data-testid=job-card]').last();
  check(/외부 AI · oni/.test(await card.innerText()), '확인 후 실행 정책: 편집기에 외부 작업 미리보기');
  check((await rootNames()).length === nObj, '사용자 확인 전에는 실행 안 됨');
  await card.getByTestId('job-run').click();
  let res = await pending;
  check(res.status === 200 && res.body.status === 'success' && res.body.created[0].name === 'OniBox', 'API 응답: 작업 ID·결과·생성된 오브젝트', res);
  const oniId = res.body.created[0].id;

  pending = v1('DELETE', `/objects/${oniId}`);
  await page.locator('[data-testid=job-card][data-state=pending]').last().waitFor({ timeout: 5000 });
  await page.locator('[data-testid=job-card]').last().getByTestId('job-cancel').click();
  res = await pending;
  check(res.status === 409 && (await rootNames()).includes('OniBox'), '사용자가 취소 → 409, 삭제 안 됨');

  await page.getByTestId('external-settings').click();
  await page.getByTestId('policy-auto').click();
  await page.waitForTimeout(200);
  res = await v1('PATCH', `/objects/${oniId}`, { position: [2, 0.5, 2], color: '#00ff00' });
  const oni = await ev(() => {
    const o = window.__FORM3D__.root.getObjectByName('OniBox');
    return { p: o.position.toArray(), c: o.material.color.getHexString() };
  });
  check(res.status === 200 && nearArr(oni.p, [2, 0.5, 2]) && oni.c === '00ff00', '자동 실행 정책: 수정 즉시 적용', { res, oni });
  const scene = await v1('GET', '/scene');
  check(scene.status === 200 && scene.body.nodes.some((x) => x.name === 'OniBox'), '씬 정보 조회');
  const proj = await v1('GET', '/project');
  check(proj.status === 200 && typeof proj.body.name === 'string' && proj.body.dirty === true && proj.body.objectCount >= 1, '프로젝트 정보 조회', proj.body);
  res = await v1('POST', '/jobs', {
    summary: '여러 단계',
    steps: [
      { command: 'create_primitive', params: { shape: 'cone', name: 'OniCone' } },
      { command: 'transform', params: { target: 'created', translate: [0, 2, 0] } },
      { command: 'set_view', params: { preset: 'iso' } },
    ],
  });
  check(res.status === 200 && res.body.steps.length === 3 && (await rootNames()).includes('OniCone'), '여러 단계 작업 실행');
  await page.keyboard.press('Control+z');
  check(!(await rootNames()).includes('OniCone'), '외부 작업도 Ctrl+Z로 실행 취소');
  res = await v1('DELETE', `/objects/${oniId}`);
  check(res.status === 200 && !(await rootNames()).includes('OniBox'), '삭제 인터페이스');
  res = await v1('POST', '/jobs', { steps: [{ command: 'delete', params: { target: { names: ['없는이름'] } } }] });
  check(res.status === 200 && res.body.status === 'failed', '실패한 작업 → 이유와 함께 failed (부분 실행 없음)', res.body);
  await page.getByTestId('policy-deny').click();
  await page.waitForTimeout(200);
  res = await v1('POST', '/objects', { shape: 'box' });
  check(res.status === 403 && res.body.detail.code === 'rejected_by_policy', '거부 정책 → 403');
  await page.getByTestId('policy-confirm').click();
  await page.keyboard.press('Escape');
  await shot('p3-04-external');

  // ===================================================================
  console.log('▶ 9. GLB 내보내기는 별개 기능으로 유지');
  await addPrim('큐브');
  const dl2p = page.waitForEvent('download');
  await page.getByRole('button', { name: '내보내기 (GLB)' }).click();
  const dl2 = await dl2p;
  check(dl2.suggestedFilename().endsWith('.glb'), `GLB 내보내기 (${dl2.suggestedFilename()})`);

  check(errors.length === 0, '콘솔 오류 없음', errors);
} catch (err) {
  failures++;
  console.error('✗ 예외:', err);
  await shot('p3-error').catch(() => {});
} finally {
  await browser.close();
  backend?.kill('SIGKILL');
  console.log(`\n스크린샷: ${SHOT_DIR}`);
  console.log(failures ? `❌ ${failures}/${total} 실패` : `✅ Phase 3 E2E ${total}개 검사 모두 통과`);
  process.exit(failures ? 1 : 0);
}
