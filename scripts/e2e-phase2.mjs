/**
 * FORM3D Phase 2 E2E 테스트 (실제 Chromium에서 UI를 조작해 검증)
 *
 * 사용법:
 *   npm run build && npm run preview   (다른 터미널)
 *   node scripts/e2e-phase2.mjs [애니메이션이 있는 샘플.glb 경로 (선택)]
 *
 * 환경 변수: FORM3D_URL (기본 http://localhost:4173), SHOT_DIR (스크린샷 저장 폴더)
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

const URL = process.env.FORM3D_URL ?? 'http://localhost:4173';
const SHOT_DIR = process.env.SHOT_DIR ?? path.join(os.tmpdir(), 'form3d-e2e-phase2');
const ANIM_SAMPLE = process.argv[2];
fs.mkdirSync(SHOT_DIR, { recursive: true });
const { chromium } = createRequire(import.meta.url)('playwright');

let failures = 0;
let total = 0;
const check = (cond, msg) => {
  total++;
  console.log(`${cond ? '  ✓' : '  ✗'} ${msg}`);
  if (!cond) failures++;
};
const near = (a, b, eps = 1e-3) => Math.abs(a - b) <= eps;
const nearArr = (a, b, eps = 1e-3) => a.length === b.length && a.every((v, i) => near(v, b[i], eps));

// ---------- 테스트용 OBJ / MTL / PNG 생성 ----------
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
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const row = Buffer.from([0, r, g, b, r, g, b]);
  const raw = Buffer.concat([row, row]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
const OBJ = `# FORM3D test
mtllib crate.mtl
o Crate
v -0.5 0 -0.5
v 0.5 0 -0.5
v 0.5 1 -0.5
v -0.5 1 -0.5
v -0.5 0 0.5
v 0.5 0 0.5
v 0.5 1 0.5
v -0.5 1 0.5
vt 0 0
vt 1 0
vt 1 1
vt 0 1
usemtl Wood
f 5/1 6/2 7/3 8/4
f 2/1 1/2 4/3 3/4
f 1/1 5/2 8/3 4/4
f 6/1 2/2 3/3 7/4
f 8/1 7/2 3/3 4/4
f 1/1 2/2 6/3 5/4
o Roof
v -0.6 1 -0.6
v 0.6 1 -0.6
v 0 1.6 0
usemtl Paint
f 9 10 11
`;
const MTL = `newmtl Wood
Kd 1 1 1
Ns 100
map_Kd textures\\wood.png
newmtl Paint
Kd 0 0.5 1
`;
const objDir = path.join(SHOT_DIR, 'obj');
fs.mkdirSync(objDir, { recursive: true });
const objPath = path.join(objDir, 'crate.obj');
const mtlPath = path.join(objDir, 'crate.mtl');
const pngPath = path.join(objDir, 'wood.png');
fs.writeFileSync(objPath, OBJ);
fs.writeFileSync(mtlPath, MTL);
fs.writeFileSync(pngPath, png2x2(200, 120, 40));
const badObj = path.join(objDir, 'broken.obj');
fs.writeFileSync(badObj, 'this is not an obj\nhello');

// ---------- 브라우저 ----------
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, acceptDownloads: true });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

const ev = (fn, arg) => page.evaluate(fn, arg);
const rootNames = () => ev(() => window.__FORM3D__.root.children.map((o) => o.name));
const selNames = () => ev(() => window.__FORM3D__.getSelectedObjects().map((o) => o.name));
const histNames = () => ev(() => window.__FORM3D__.getHistoryEntries().done.map((h) => h.name));
const histLen = () => ev(() => window.__FORM3D__.getHistoryEntries().done.length);
const shot = (name) => page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`) });
const lastLog = () => page.locator('[data-testid=log-panel] > div[data-level]').last().innerText();
const logsSince = async (n) => (await page.locator('[data-testid=log-panel] > div[data-level]').allInnerTexts()).slice(n);
const logCount = () => page.locator('[data-testid=log-panel] > div[data-level]').count();
const pos = (name) => ev((n) => window.__FORM3D__.root.getObjectByName(n).getWorldPosition(new window.__FORM3D__.root.position.constructor()).toArray(), name);
const row = (name) => page.locator(`[role=tree] [data-node-name="${name}"]`);
const addPrim = async (label) => {
  await page.getByRole('button', { name: '도형 추가' }).click();
  await page.getByRole('menuitem', { name: new RegExp(label) }).click();
};
const resetScene = async () => {
  await ev(() => window.__FORM3D__.reset());
  await page.waitForTimeout(100);
};
const setPos = (name, p) =>
  ev(([n, v]) => {
    const o = window.__FORM3D__.root.getObjectByName(n);
    o.position.fromArray(v);
    o.updateMatrixWorld(true);
    window.__FORM3D__.notify();
  }, [name, p]);
/** 오브젝트 월드 중심을 화면 좌표로 투영 */
const screenOf = (name) =>
  ev((n) => {
    const e = window.__FORM3D__;
    const { camera } = window.__FORM3D_VIEW__;
    const o = e.root.getObjectByName(n);
    const c = e.getWorldCenter(o).project(camera);
    const r = document.querySelector('canvas').getBoundingClientRect();
    return { x: r.left + ((c.x + 1) / 2) * r.width, y: r.top + ((1 - c.y) / 2) * r.height };
  }, name);
const camDir = () =>
  ev(() => {
    const { camera, controls } = window.__FORM3D_VIEW__;
    return camera.position.clone().sub(controls.target).normalize().toArray();
  });

console.log(`▶ ${URL}`);
await page.goto(URL);
await page.waitForSelector('canvas');
await page.waitForTimeout(800);
check((await page.title()).includes('FORM3D'), '앱 로드');

// =====================================================================
console.log('▶ 1. OBJ 가져오기 (OBJ + MTL + 텍스처)');
let n0 = await logCount();
await page.getByTestId('file-input').first().setInputFiles([objPath, mtlPath, pngPath]);
await page.waitForFunction(() => window.__FORM3D__.root.children.length === 1);
await page.waitForTimeout(600);
const objInfo = await ev(() => {
  const r = window.__FORM3D__.root.children[0];
  const crate = r.getObjectByName('Crate');
  const roof = r.getObjectByName('Roof');
  return {
    name: r.name,
    meshes: r.children.map((c) => c.name),
    crateType: crate.material.type,
    crateMap: !!crate.material.map,
    mapW: crate.material.map?.image?.width ?? null,
    roofColor: roof.material.color.getHexString(),
    verts: crate.geometry.getAttribute('position').count,
    selected: window.__FORM3D__.getSelected()?.name,
  };
});
check(objInfo.name === 'crate' && objInfo.meshes.join() === 'Crate,Roof', `오브젝트 구조 ${JSON.stringify(objInfo.meshes)}`);
check(objInfo.crateType === 'MeshStandardMaterial', 'OBJ 재질을 PBR(MeshStandardMaterial)로 변환');
check(objInfo.crateMap && objInfo.mapW === 2, `MTL의 텍스처(map_Kd, 하위 폴더 경로) 연결 + 이미지 로드 (폭 ${objInfo.mapW})`);
check(objInfo.roofColor === '0080ff', `MTL 색상 적용 (#${objInfo.roofColor})`);
check(objInfo.verts === 36, `정점 수 ${objInfo.verts} (사각면 6개 → 삼각형 12개)`);
let newLogs = await logsSince(n0);
check(newLogs.some((l) => /불러오기 완료: crate\.obj/.test(l)), '불러오기 완료 로그');
check(!newLogs.some((l) => /찾을 수 없는|기본 재질/.test(l)), '누락 경고 없음');
check(await row('crate').isVisible(), 'Scene Hierarchy에 표시');
// OBJ 재질도 편집 가능
await page.getByRole('button', { name: '선택 모드: 메시 (개별 메시 선택)' }).click();
await row('Roof').click();
await page.getByLabel('색상').fill('#33cc66');
await page.waitForTimeout(500);
check(
  (await ev(() => window.__FORM3D__.getSelected().material.color.getHexString())) === '33cc66',
  'OBJ 메시 재질 색상 편집',
);
await page.getByRole('button', { name: '선택 모드: 오브젝트 (모델 전체 선택)' }).click();
await page.keyboard.press('f');
await page.waitForTimeout(500);
await shot('01-obj-import');

n0 = await logCount();
await page.getByTestId('file-input').first().setInputFiles([objPath]);
await page.waitForFunction(() => window.__FORM3D__.root.children.length === 2);
newLogs = await logsSince(n0);
check(newLogs.some((l) => /재질 파일\(crate\.mtl\)이 함께 선택되지 않아/.test(l)), 'MTL 없이 불러오면 경고 + 기본 재질');
check(
  (await ev(() => window.__FORM3D__.root.children[1].getObjectByName('Crate').material.color.getHexString())) === '9aa4b5',
  '기본 재질 색상 적용',
);
check((await rootNames())[1] === 'crate.001', `같은 이름은 고유 이름 부여 (${(await rootNames())[1]})`);
n0 = await logCount();
await page.getByTestId('file-input').first().setInputFiles([objPath, mtlPath]);
await page.waitForFunction(() => window.__FORM3D__.root.children.length === 3);
newLogs = await logsSince(n0);
check(newLogs.some((l) => /찾을 수 없는 텍스처 1개: wood\.png/.test(l)), '텍스처 누락 시 경고 (콘솔 오류 없이)');
await page.getByTestId('file-input').first().setInputFiles([badObj]);
await page.waitForTimeout(300);
check(/정점\(v\) 데이터가 없습니다/.test(await lastLog()), `잘못된 OBJ 거부: ${(await lastLog()).split('\n').pop()}`);
const binObj = path.join(objDir, 'model.obj');
fs.writeFileSync(binObj, Buffer.from([0x76, 0x20, 0x00, 0x01, 0x02]));
await page.getByTestId('file-input').first().setInputFiles([binObj]);
await page.waitForTimeout(300);
check(/텍스트 OBJ 파일이 아닙니다/.test(await lastLog()), '바이너리 파일 거부');
// OBJ 왕복: GLB 내보내기 → 다시 불러오기
await ev(() => {
  const e = window.__FORM3D__;
  e.root.children.slice(1).forEach((c) => c.removeFromParent());
  e.notify();
});
const [dl0] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /내보내기/ }).click()]);
const objGlb = path.join(SHOT_DIR, 'obj-roundtrip.glb');
await dl0.saveAs(objGlb);
await page.getByTestId('file-input').first().setInputFiles(objGlb);
await page.waitForFunction(() => window.__FORM3D__.root.children.length === 2);
const rt = await ev(() => {
  const r = window.__FORM3D__.root.children[1];
  const crate = r.getObjectByName('Crate');
  return { tex: !!crate?.material.map, roof: r.getObjectByName('Roof')?.material.color.getHexString() };
});
check(rt.tex && rt.roof === '33cc66', `OBJ → GLB 내보내기 왕복 시 텍스처/편집한 색상 보존 ${JSON.stringify(rt)}`);

// =====================================================================
console.log('▶ 2. 여러 오브젝트 선택');
await resetScene();
for (const l of ['큐브', '구', '원기둥', '원뿔']) await addPrim(l);
await setPos('Box', [-3, 0.5, 0]);
await setPos('Sphere', [-1, 0.5, 1]);
await setPos('Cylinder', [1, 0.5, -1]);
await setPos('Cone', [3, 0.5, 0]);
await row('Box').click();
await row('Cylinder').click({ modifiers: ['Control'] });
check(JSON.stringify(await selNames()) === '["Box","Cylinder"]', 'Ctrl+클릭으로 추가 선택');
check(await page.getByTestId('multi-count').innerText() === '2개 오브젝트 선택됨', '속성 패널에 선택 개수 표시');
await row('Box').click();
await row('Cone').click({ modifiers: ['Shift'] });
check(JSON.stringify(await selNames()) === '["Box","Sphere","Cylinder","Cone"]', `Shift+클릭 범위 선택 → ${await selNames()}`);
check((await ev(() => window.__FORM3D__.getSelected().name)) === 'Cone', 'Shift+클릭한 항목이 활성 오브젝트');
await row('Sphere').click({ modifiers: ['Control'] });
check(JSON.stringify(await selNames()) === '["Box","Cylinder","Cone"]', 'Ctrl+클릭으로 선택 해제');
check((await row('Box').getAttribute('aria-selected')) === 'true' && (await row('Sphere').getAttribute('aria-selected')) === 'false', '계층 구조에 선택 표시');
await page.locator('canvas').hover();
await page.keyboard.press('Escape');
await page.keyboard.press('f');
await page.waitForTimeout(500);
const sb = await screenOf('Box');
const sc = await screenOf('Cone');
await page.mouse.click(sb.x, sb.y);
await page.keyboard.down('Shift');
await page.mouse.click(sc.x, sc.y);
await page.keyboard.up('Shift');
check(JSON.stringify(await selNames()) === '["Box","Cone"]', `뷰포트 Shift+클릭 다중 선택 → ${await selNames()}`);
const sbox = await page.locator('canvas').boundingBox();
await page.keyboard.down('Control');
await page.mouse.click(sbox.x + 30, sbox.y + sbox.height - 40);
await page.keyboard.up('Control');
check((await selNames()).length === 2, 'Ctrl 누른 채 빈 곳 클릭 시 선택 유지');
await page.keyboard.press('Control+a');
check((await selNames()).length === 4, 'Ctrl+A 전체 선택');
await shot('02-multi-select');

// =====================================================================
console.log('▶ 3. 복제');
await row('Box').click();
await row('Sphere').click({ modifiers: ['Control'] });
let h0 = await histLen();
await page.keyboard.press('Control+d');
check(JSON.stringify(await rootNames()) === '["Box","Box.001","Sphere","Sphere.001","Cylinder","Cone"]', `Ctrl+D → ${await rootNames()}`);
check(JSON.stringify(await selNames()) === '["Box.001","Sphere.001"]', '복제본이 선택됨');
check((await histLen()) === h0 + 1 && (await histNames()).at(-1) === 'DuplicateObject', '복제가 명령 1개로 기록');
const bp = await pos('Box');
const bcp = await pos('Box.001');
check(bcp[0] > bp[0] && near(bcp[1], bp[1]) && near(bcp[2], bp[2]), `복제본은 +X 옆에 배치 (${bcp.map((v) => v.toFixed(2))})`);
const indep = await ev(() => {
  const r = window.__FORM3D__.root;
  r.getObjectByName('Box.001').material.color.set('#ff0000');
  return r.getObjectByName('Box').material.color.getHexString();
});
check(indep === '9aa4b5', '복제본 재질은 원본과 독립');
await page.keyboard.press('Control+z');
check(JSON.stringify(await rootNames()) === '["Box","Sphere","Cylinder","Cone"]', 'Undo로 복제 취소');
check(JSON.stringify(await selNames()) === '["Box","Sphere"]', 'Undo 후 원래 선택 복원');
await page.keyboard.press('Control+y');
check((await rootNames()).length === 6, 'Redo로 다시 복제');
await page.keyboard.press('Control+z');
await page.getByRole('button', { name: '복제 (Ctrl+D)' }).click();
check((await rootNames()).length === 6, '계층 패널 복제 버튼 동작');
await page.keyboard.press('Control+z');

// =====================================================================
console.log('▶ 4. 그룹화 / 그룹 해제');
await row('Box').click();
await row('Cylinder').click({ modifiers: ['Control'] });
const wBefore = [await pos('Box'), await pos('Cylinder')];
await page.keyboard.press('Control+g');
const g = await ev(() => {
  const e = window.__FORM3D__;
  const grp = e.root.getObjectByName('Group');
  return {
    root: e.root.children.map((o) => o.name),
    kids: grp?.children.map((o) => o.name),
    sel: e.getSelected()?.name,
    gp: grp?.position.toArray(),
  };
});
check(JSON.stringify(g.root) === '["Group","Sphere","Cone"]' && JSON.stringify(g.kids) === '["Box","Cylinder"]', `Ctrl+G → ${JSON.stringify(g)}`);
check(g.sel === 'Group', '그룹이 선택됨');
check(nearArr(g.gp, [-1, 0.5, -0.5]), `그룹 원점 = 선택 중심 (${g.gp})`);
check(nearArr(await pos('Box'), wBefore[0]) && nearArr(await pos('Cylinder'), wBefore[1]), '그룹화 후 월드 위치 유지');
check(await row('Group').isVisible() && (await row('Box').isVisible()), '계층 구조에 그룹/자식 표시 (자동 펼침)');
// 그룹을 이동하면 자식도 함께 이동
await page.getByLabel('위치 Y').fill('2');
await page.getByLabel('위치 Y').press('Enter');
check(near((await pos('Box'))[1], 2), '그룹 이동 시 자식도 이동');
await page.keyboard.press('Control+z');
await row('Group').click();
await page.keyboard.press('Control+Shift+g');
check(JSON.stringify(await rootNames()) === '["Box","Cylinder","Sphere","Cone"]', `Ctrl+Shift+G 그룹 해제 → ${await rootNames()}`);
check(JSON.stringify(await selNames()) === '["Box","Cylinder"]', '해제 후 자식들이 선택됨');
check(nearArr(await pos('Box'), wBefore[0]), '해제 후 월드 위치 유지');
await page.keyboard.press('Control+z');
check(JSON.stringify(await rootNames()) === '["Group","Sphere","Cone"]', 'Undo로 그룹 복원');
await page.keyboard.press('Control+z');
check(JSON.stringify(await rootNames()) === '["Box","Sphere","Cylinder","Cone"]', 'Undo로 그룹화 이전 순서 복원');
await row('Box').click();
n0 = await logCount();
await page.keyboard.press('Control+Shift+g');
check((await logsSince(n0)).some((l) => /그룹이 아닙니다/.test(l)), '메시는 그룹 해제 거부 + 이유 안내');
check(await page.getByRole('button', { name: '그룹 해제 (Ctrl+Shift+G)' }).isDisabled(), '그룹이 아니면 해제 버튼 비활성');

// =====================================================================
console.log('▶ 5. 정밀 위치·회전·크기 조절');
await row('Box').click();
await row('Sphere').click({ modifiers: ['Control'] });
check((await page.getByLabel('위치 X').inputValue()) === '' && (await page.getByLabel('위치 X').getAttribute('placeholder')) === '—', '값이 다르면 "—"(혼합) 표시');
check((await page.getByLabel('위치 Y').inputValue()) === '0.5', '값이 같으면 공통 값 표시');
h0 = await histLen();
await page.getByLabel('위치 Z').fill('2');
await page.getByLabel('위치 Z').press('Enter');
check(near((await pos('Box'))[2], 2) && near((await pos('Sphere'))[2], 2), '여러 오브젝트에 같은 값 적용');
check((await histLen()) === h0 + 1, '여러 오브젝트 변경도 Undo 1회 단위');
await page.keyboard.press('Control+z');
check(near((await pos('Box'))[2], 0) && near((await pos('Sphere'))[2], 1), 'Undo로 각각 원래 값 복원');
await row('Box').click();
await page.getByLabel('위치 X').fill('(1+2)*1.5');
await page.getByLabel('위치 X').press('Enter');
check(near((await pos('Box'))[0], 4.5), '수식 입력 (1+2)*1.5 = 4.5');
await page.getByLabel('위치 X').fill('abc');
await page.getByLabel('위치 X').press('Enter');
check(near((await pos('Box'))[0], 4.5) && (await page.getByLabel('위치 X').inputValue()) === '4.5', '잘못된 입력은 무시하고 이전 값 복원');
await page.getByLabel('위치 X').focus();
await page.keyboard.press('ArrowUp');
await page.keyboard.press('Shift+ArrowUp');
check(near((await pos('Box'))[0], 5.6), `↑ / Shift+↑ 증감 → ${(await pos('Box'))[0]}`);
await page.getByLabel('회전 Y').fill('90');
await page.getByLabel('회전 Y').press('Enter');
check(near(await ev(() => window.__FORM3D__.getSelected().rotation.y), Math.PI / 2), '회전 Y = 90°');
await page.getByRole('button', { name: '크기 비율 고정' }).click();
await page.getByLabel('크기 X').fill('2');
await page.getByLabel('크기 X').press('Enter');
check(nearArr(await ev(() => window.__FORM3D__.getSelected().scale.toArray()), [2, 2, 2]), '크기 비율 고정 시 XYZ 함께 변경');
await page.getByRole('button', { name: '크기 비율 고정' }).click();
await page.getByLabel('크기 Y').fill('0.5');
await page.getByLabel('크기 Y').press('Enter');
check(nearArr(await ev(() => window.__FORM3D__.getSelected().scale.toArray()), [2, 0.5, 2]), '비율 고정 해제 시 한 축만 변경');
await page.getByRole('button', { name: '크기 초기화' }).click();
await page.getByRole('button', { name: '회전 초기화' }).click();
check(
  nearArr(await ev(() => window.__FORM3D__.getSelected().scale.toArray()), [1, 1, 1]) &&
    near(await ev(() => window.__FORM3D__.getSelected().rotation.y), 0),
  '초기화 버튼 (크기 1, 회전 0)',
);
// 축 라벨 드래그(스크럽)
h0 = await histLen();
const xBefore = (await pos('Box'))[0];
const lab = await page.locator('[data-scrub="위치 X"]').boundingBox();
await page.mouse.move(lab.x + lab.width / 2, lab.y + lab.height / 2);
await page.mouse.down();
await page.mouse.move(lab.x + 40, lab.y + lab.height / 2, { steps: 5 });
await page.mouse.move(lab.x + 80, lab.y + lab.height / 2, { steps: 5 });
await page.mouse.up();
const xAfter = (await pos('Box'))[0];
check(xAfter > xBefore + 1, `축 라벨 드래그로 값 조절 ${xBefore.toFixed(2)} → ${xAfter.toFixed(2)}`);
check((await histLen()) === h0 + 1, '드래그 1회 = 명령 1개');
await page.keyboard.press('Control+z');
check(near((await pos('Box'))[0], xBefore), '스크럽 Undo');

// =====================================================================
console.log('▶ 6. 이동·회전·크기 도구 (다중 기즈모, 스냅, 실시간 표시)');
await resetScene();
await addPrim('큐브');
await addPrim('구');
await setPos('Box', [-1, 0.5, 0]);
await setPos('Sphere', [1, 0.5, 0]);
await page.keyboard.press('Control+a');
await page.locator('canvas').hover();
await page.keyboard.press('f');
await page.waitForTimeout(500);
const cv = await page.locator('canvas').boundingBox();
const cx = cv.x + cv.width / 2;
const cy = cv.y + cv.height / 2;
const pb = [await pos('Box'), await pos('Sphere')];
h0 = await histLen();
await page.mouse.move(cx, cy);
await page.mouse.down();
await page.mouse.move(cx + 50, cy, { steps: 5 });
await page.mouse.move(cx + 100, cy - 20, { steps: 5 });
const readout = await page.getByTestId('drag-readout').innerText().catch(() => '');
await page.mouse.up();
await page.waitForTimeout(100);
const pa = [await pos('Box'), await pos('Sphere')];
const d0 = pa[0].map((v, i) => v - pb[0][i]);
const d1 = pa[1].map((v, i) => v - pb[1][i]);
check(Math.hypot(...d0) > 0.05, `다중 선택 기즈모 드래그로 이동 Δ(${d0.map((v) => v.toFixed(2))})`);
check(nearArr(d0, d1, 1e-4), '두 오브젝트가 같은 만큼 이동');
check(/이동 Δ/.test(readout), `드래그 중 실시간 값 표시: "${readout}"`);
check((await histLen()) === h0 + 1 && (await histNames()).at(-1) === 'SetTransform', '다중 드래그 = 명령 1개');
check(JSON.stringify(await selNames()) === '["Box","Sphere"]', '드래그 후 다중 선택 유지');
await page.keyboard.press('Control+z');
check(nearArr(await pos('Box'), pb[0]) && nearArr(await pos('Sphere'), pb[1]), 'Undo로 둘 다 복원');
// 다중 회전: 중심 기준
await page.keyboard.press('e');
await ev(() => window.__FORM3D__.notify());
await page.waitForTimeout(100);
// 회전 링 위를 드래그 (Y축 링은 화면 중앙 아래쪽 근처)
const ringPts = [];
for (let a = 0; a < 360; a += 15) ringPts.push(a);
let rotated = false;
for (const r of [60, 80, 100, 120]) {
  for (const a of [90, 270, 0, 180, 45, 135]) {
    const rad = (a * Math.PI) / 180;
    const sx = cx + Math.cos(rad) * r;
    const sy = cy + Math.sin(rad) * r;
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.mouse.move(sx + 40, sy + 10, { steps: 5 });
    await page.mouse.move(sx + 80, sy + 20, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(50);
    const q = await ev(() => window.__FORM3D__.root.getObjectByName('Box').quaternion.toArray());
    if (Math.abs(q[3]) < 0.9999) {
      rotated = true;
      break;
    }
  }
  if (rotated) break;
}
const centerAfter = await ev(() => {
  const e = window.__FORM3D__;
  return e.getUnionBounds(e.getTopLevelSelection()).getCenter(e.root.position.clone()).toArray();
});
const rotB = await ev(() => window.__FORM3D__.root.getObjectByName('Box').quaternion.toArray());
const rotS = await ev(() => window.__FORM3D__.root.getObjectByName('Sphere').quaternion.toArray());
check(rotated && nearArr(rotB, rotS, 1e-4), `다중 회전: 두 오브젝트가 같은 회전 (${rotB.map((v) => v.toFixed(2))})`);
const midBefore = pb[0].map((v, i) => (v + pb[1][i]) / 2);
check(near(Math.hypot(...(await pos('Box')).map((v, i) => v - midBefore[i])), 1, 1e-3), '선택 중심을 기준으로 회전 (중심까지 거리 유지)');
await page.keyboard.press('Control+z');
await page.keyboard.press('w');
// 스냅
await page.getByRole('button', { name: /^스냅 꺼짐/ }).click();
check(await page.getByRole('button', { name: /^스냅 켜짐/ }).isVisible(), '스냅 켜기 버튼');
await page.getByTestId('snap-settings').click();
await page.getByLabel('이동 (m)').fill('0.25');
await page.getByLabel('이동 (m)').press('Enter');
await page.locator('canvas').hover();
await row('Box').click();
await page.locator('canvas').hover();
await page.keyboard.press('f');
await page.waitForTimeout(500);
await page.mouse.move(cx, cy);
await page.mouse.down();
await page.mouse.move(cx + 37, cy - 13, { steps: 5 });
await page.mouse.move(cx + 93, cy - 29, { steps: 5 });
await page.mouse.up();
const snapped = await ev(() => window.__FORM3D__.getSelected().position.toArray());
const onGrid = snapped.every((v) => Math.abs(v / 0.25 - Math.round(v / 0.25)) < 1e-6);
check(onGrid && !nearArr(snapped, [-1, 0.5, 0]), `스냅 켜고 드래그 → 0.25 단위 위치 (${snapped})`);
await page.keyboard.press('Control+z');
// Ctrl 누른 채 드래그 → 스냅 일시 해제
await page.mouse.move(cx, cy);
await page.keyboard.down('Control');
await page.mouse.down();
await page.mouse.move(cx + 37, cy - 13, { steps: 5 });
await page.mouse.move(cx + 93, cy - 29, { steps: 5 });
await page.mouse.up();
await page.keyboard.up('Control');
const free = await ev(() => window.__FORM3D__.getSelected().position.toArray());
check(!free.every((v) => Math.abs(v / 0.25 - Math.round(v / 0.25)) < 1e-6), `Ctrl+드래그 시 스냅 일시 해제 (${free.map((v) => v.toFixed(3))})`);
await page.keyboard.press('Control+z');
await page.getByRole('button', { name: /^스냅 켜짐/ }).click();
await shot('03-gizmo');

// =====================================================================
console.log('▶ 7. 정렬 / 분배 / 스냅');
await resetScene();
for (const l of ['큐브', '구', '원뿔']) await addPrim(l);
await setPos('Box', [-2, 0.5, 0]);
await setPos('Sphere', [0.3, 2, 1]);
await setPos('Cone', [3, 1, -1]);
await page.keyboard.press('Control+a');
h0 = await histLen();
await page.getByRole('button', { name: 'X 최소 정렬' }).click();
const xs = await ev(() => ['Box', 'Sphere', 'Cone'].map((n) => window.__FORM3D__.getWorldBounds(window.__FORM3D__.root.getObjectByName(n)).min.x));
check(xs.every((v) => near(v, -2.5)), `X 최소 정렬 → min.x = ${xs.map((v) => v.toFixed(2))}`);
check((await histLen()) === h0 + 1 && (await histNames()).at(-1) === 'AlignObjects', '정렬 = 명령 1개 (AlignObjects)');
await page.keyboard.press('Control+z');
check(near((await pos('Cone'))[0], 3), 'Undo로 정렬 취소');
await page.getByLabel('정렬 기준').selectOption('active');
await page.getByRole('button', { name: 'Y 중앙 정렬' }).click();
check(near((await pos('Box'))[1], 1) && near((await pos('Sphere'))[1], 1) && near((await pos('Cone'))[1], 1), '활성 오브젝트(Cone) 기준 Y 중앙 정렬');
await page.keyboard.press('Control+z');
await page.getByLabel('정렬 기준').selectOption('selection');
await page.getByRole('button', { name: 'X 균등 분배' }).click();
const dx = [await pos('Box'), await pos('Sphere'), await pos('Cone')].map((p) => p[0]);
check(near(dx[1] - dx[0], dx[2] - dx[1]), `X 균등 분배 → ${dx.map((v) => v.toFixed(2))}`);
await page.getByRole('button', { name: '바닥에 놓기' }).click();
const mins = await ev(() => ['Box', 'Sphere', 'Cone'].map((n) => window.__FORM3D__.getWorldBounds(window.__FORM3D__.root.getObjectByName(n)).min.y));
check(mins.every((v) => near(v, 0)), `바닥에 놓기 → min.y = ${mins.map((v) => v.toFixed(3))}`);
await page.getByRole('button', { name: /그리드 스냅/ }).click();
const gp = await pos('Sphere');
check(gp.every((v) => Math.abs(v / 0.25 - Math.round(v / 0.25)) < 1e-6), `그리드 스냅 (0.25) → ${gp}`);
await row('Box').click();
check(await page.getByRole('button', { name: 'X 최소 정렬' }).isDisabled(), '1개 선택 시 정렬 버튼 비활성');
await shot('04-align');

// =====================================================================
console.log('▶ 8. 카메라 시점 프리셋');
await page.locator('canvas').hover();
const VIEWS = { 1: [0, 0, 1], 2: [0, 0, -1], 3: [1, 0, 0], 4: [-1, 0, 0], 5: [0, 1, 0], 6: [0, -1, 0], 0: [0.577, 0.577, 0.577] };
const VNAME = { 1: '정면', 2: '뒷면', 3: '오른쪽', 4: '왼쪽', 5: '위', 6: '아래', 0: '등각' };
for (const [k, dir] of Object.entries(VIEWS)) {
  await page.keyboard.press(k);
  await page.waitForTimeout(450);
  const d = await camDir();
  check(nearArr(d, dir, 0.01), `키 ${k} → ${VNAME[k]} (${d.map((v) => v.toFixed(2))})`);
}
await page.keyboard.press('1');
await page.waitForTimeout(450);
await shot('05-view-front');
await page.getByTestId('view-menu').click();
await page.getByRole('menuitem', { name: /^위/ }).click();
await page.waitForTimeout(450);
check(nearArr(await camDir(), [0, 1, 0], 0.01), '시점 메뉴 → 위');
await shot('06-view-top');
await page.getByTestId('view-menu').click();
await page.getByRole('menuitem', { name: /^등각/ }).click();
await page.waitForTimeout(450);
check(nearArr(await camDir(), [0.577, 0.577, 0.577], 0.01), '시점 메뉴 → 등각');
const dist0 = await ev(() => window.__FORM3D_VIEW__.camera.position.distanceTo(window.__FORM3D_VIEW__.controls.target));
await page.keyboard.press('3');
await page.waitForTimeout(450);
const dist1 = await ev(() => window.__FORM3D_VIEW__.camera.position.distanceTo(window.__FORM3D_VIEW__.controls.target));
check(near(dist0, dist1, 1e-3), '시점 전환 시 거리 유지');
await page.keyboard.press('0');
await page.waitForTimeout(450);

// =====================================================================
console.log('▶ 9. 씬 계층 구조');
await resetScene();
for (const l of ['큐브', '구', '원뿔', '토러스']) await addPrim(l);
await setPos('Box', [3, 0.5, 0]);
const wSphere = await pos('Sphere');
// 가운데에 드롭 → 하위로
await row('Sphere').dragTo(row('Box'));
check(
  JSON.stringify(await ev(() => window.__FORM3D__.root.getObjectByName('Box').children.map((c) => c.name))) === '["Sphere"]',
  '드래그 앤 드롭: Sphere → Box의 하위',
);
check(nearArr(await pos('Sphere'), wSphere), '부모 변경 후 월드 위치 유지');
check(JSON.stringify(await rootNames()) === '["Box","Cone","Torus"]', '최상위에서 제거됨');
check((await histNames()).at(-1) === 'ReparentObject', 'ReparentObject 명령 기록');
// 위쪽 가장자리에 드롭 → 순서 변경
const tb = await row('Box').boundingBox();
await row('Torus').dragTo(row('Box'), { targetPosition: { x: tb.width / 2, y: 2 } });
check(JSON.stringify(await rootNames()) === '["Torus","Box","Cone"]', `위쪽 가장자리 드롭 → 순서 변경 ${await rootNames()}`);
await row('Torus').dragTo(row('Cone'), { targetPosition: { x: tb.width / 2, y: tb.height - 2 } });
check(JSON.stringify(await rootNames()) === '["Box","Cone","Torus"]', `아래쪽 가장자리 드롭 → 뒤로 이동 ${await rootNames()}`);
// 빈 영역 드롭 → 최상위로
const emptyArea = page.locator('[role=tree]').locator('..');
await row('Sphere').dragTo(emptyArea, { targetPosition: { x: 50, y: (await emptyArea.boundingBox()).height - 10 } });
check(JSON.stringify(await rootNames()) === '["Box","Cone","Torus","Sphere"]', '빈 영역 드롭 → 최상위 맨 뒤');
check(nearArr(await pos('Sphere'), wSphere), '최상위로 꺼낸 뒤에도 월드 위치 유지');
// 자기 하위로는 이동 불가
await row('Cone').dragTo(row('Box'));
await row('Box').dragTo(row('Cone'));
check(
  JSON.stringify(await ev(() => window.__FORM3D__.root.getObjectByName('Box').children.map((c) => c.name))) === '["Cone"]' &&
    (await ev(() => window.__FORM3D__.root.getObjectByName('Box').parent === window.__FORM3D__.root)),
  '자기 하위로 드롭은 무시',
);
for (let i = 0; i < 5; i++) await page.keyboard.press('Control+z');
check(JSON.stringify(await rootNames()) === '["Box","Sphere","Cone","Torus"]', `Undo로 계층 변경 모두 취소 → ${await rootNames()}`);
// 여러 개를 함께 드래그
await row('Cone').click();
await row('Torus').click({ modifiers: ['Control'] });
await row('Torus').dragTo(row('Box'));
check(
  JSON.stringify(await ev(() => window.__FORM3D__.root.getObjectByName('Box').children.map((c) => c.name))) === '["Cone","Torus"]',
  '선택한 여러 오브젝트를 함께 드래그',
);
await page.keyboard.press('Control+z');
// 검색
await page.getByLabel('씬 검색').fill('tor');
check((await page.locator('[role=treeitem]').count()) === 1 && (await row('Torus').isVisible()), '이름 검색 필터');
await page.getByLabel('씬 검색').fill('zzz');
check(await page.getByText('“zzz”와 일치하는 오브젝트가 없습니다.').isVisible(), '검색 결과 없음 안내');
await page.getByRole('button', { name: '검색 지우기' }).click();
check((await page.locator('[role=treeitem]').count()) === 4, '검색 지우기');
// 더블클릭 이름 변경
await row('Cone').dblclick();
await page.getByLabel('새 이름').fill('Spire');
await page.getByLabel('새 이름').press('Enter');
check((await rootNames()).includes('Spire'), '더블클릭으로 이름 변경');
await row('Spire').dblclick();
await page.getByLabel('새 이름').fill('Nope');
await page.getByLabel('새 이름').press('Escape');
check((await rootNames()).includes('Spire'), 'Esc로 이름 변경 취소');
// 키보드 탐색
await row('Box').click();
await page.keyboard.press('ArrowDown');
check((await ev(() => window.__FORM3D__.getSelected().name)) === 'Sphere', '↓ 키로 다음 항목 선택');
await page.keyboard.press('F2');
await page.getByLabel('새 이름').fill('Ball');
await page.getByLabel('새 이름').press('Enter');
check((await rootNames()).includes('Ball'), 'F2로 이름 변경');
// 우클릭 메뉴
await row('Ball').click({ button: 'right' });
check(await page.getByRole('menu', { name: '오브젝트 메뉴' }).isVisible(), '우클릭 메뉴 표시');
await page.getByRole('menu', { name: '오브젝트 메뉴' }).getByRole('menuitem', { name: /^복제/ }).click();
check((await rootNames()).includes('Ball.001'), '우클릭 메뉴 → 복제');
await row('Box').click();
await row('Ball').click({ modifiers: ['Control'] });
await row('Ball').click({ button: 'right' });
await page.getByRole('menuitem', { name: /^그룹으로 묶기/ }).click();
check((await rootNames())[0] === 'Group', '우클릭 메뉴 → 그룹으로 묶기');
await row('Ball').click({ button: 'right' });
await page.getByRole('menuitem', { name: /^최상위로 꺼내기/ }).click();
check((await rootNames()).includes('Ball'), '우클릭 메뉴 → 최상위로 꺼내기');
await row('Group').click({ button: 'right' });
await page.keyboard.press('Escape');
check(!(await page.getByRole('menu', { name: '오브젝트 메뉴' }).isVisible()), 'Esc로 메뉴 닫기');
// 모두 접기/펼치기
await page.getByRole('button', { name: '모두 접기' }).click();
check(!(await row('Box').isVisible()), '모두 접기');
await page.getByRole('button', { name: '모두 펼치기' }).click();
check(await row('Box').isVisible(), '모두 펼치기');
await shot('07-hierarchy');

// =====================================================================
console.log('▶ 10. 그룹 계층 GLB 내보내기 왕복');
const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /내보내기/ }).click()]);
const gl = path.join(SHOT_DIR, 'phase2-groups.glb');
await dl.saveAs(gl);
const before10 = await ev(() => window.__FORM3D__.root.children.map((o) => [o.name, o.children.map((c) => c.name)]));
await resetScene();
await page.getByTestId('file-input').first().setInputFiles(gl);
await page.waitForFunction(() => window.__FORM3D__.root.children.length === 1);
const after10 = await ev(() => window.__FORM3D__.root.children[0].children.map((o) => [o.name, o.children.map((c) => c.name)]));
check(JSON.stringify(after10) === JSON.stringify(before10), `그룹 구조 보존 ${JSON.stringify(after10)}`);

if (ANIM_SAMPLE) {
  console.log(`▶ 11. 애니메이션 모델: ${path.basename(ANIM_SAMPLE)}`);
  await resetScene();
  await page.getByTestId('file-input').first().setInputFiles(ANIM_SAMPLE);
  await page.waitForFunction(() => window.__FORM3D__.root.children.length === 1, null, { timeout: 30000 });
  const nm = (await rootNames())[0];
  await row(nm).click();
  await page.keyboard.press('Control+d');
  const dup = await ev(() => {
    const [a, b] = window.__FORM3D__.root.children;
    let skinA = null;
    let skinB = null;
    a.traverse((o) => o.isSkinnedMesh && (skinA = o));
    b.traverse((o) => o.isSkinnedMesh && (skinB = o));
    const boneInB = skinB ? skinB.skeleton.bones.every((bone) => { let p = bone; while (p && p !== b) p = p.parent; return p === b; }) : false;
    return { n: window.__FORM3D__.root.children.length, anims: b.animations.length, boneInB, differentSkeleton: skinA?.skeleton !== skinB?.skeleton };
  });
  check(dup.n === 2 && dup.anims > 0, `애니메이션 모델 복제 (클립 ${dup.anims}개 유지)`);
  check(dup.boneInB && dup.differentSkeleton, '복제본의 스킨이 자기 뼈대에 연결됨');
  // 애니메이션 모델의 일부(스킨 메시)만 복제/이동하면 연결이 끊어지므로 거부
  await ev(() => {
    let skin = null;
    window.__FORM3D__.root.children[0].traverse((o) => o.isSkinnedMesh && !skin && (skin = o));
    window.__FORM3D__.select(skin.uuid);
  });
  n0 = await logCount();
  await page.locator('canvas').hover();
  await page.keyboard.press('Control+d');
  check(
    (await logsSince(n0)).some((l) => /애니메이션 모델 .*의 일부/.test(l)) && (await rootNames()).length === 2,
    '애니메이션 모델의 일부만 복제는 거부 + 이유 안내',
  );
  await row(nm).click();
  n0 = await logCount();
  await page.keyboard.press('Control+Shift+g');
  check((await logsSince(n0)).some((l) => /애니메이션이 있어/.test(l)) && (await rootNames()).length === 2, '애니메이션 모델 그룹 해제는 거부 + 이유 안내');
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /내보내기/ }).click()]);
  const p2 = path.join(SHOT_DIR, 'anim-dup.glb');
  await dl2.saveAs(p2);
  check(fs.statSync(p2).size > 1000 && /GLB 내보내기 완료/.test(await lastLog()), '복제된 애니메이션 모델 GLB 내보내기');
  await page.keyboard.press('Control+a');
  await page.locator('canvas').hover();
  await page.keyboard.press('f');
  await page.waitForTimeout(500);
  await shot('08-anim-dup');
}

const relevantErrors = errors.filter((e) => !/WebGL|GPU stall|GL Driver/i.test(e));
check(relevantErrors.length === 0, `콘솔 오류 없음 ${relevantErrors.length ? JSON.stringify(relevantErrors) : ''}`);

await browser.close();
console.log(`\n스크린샷: ${SHOT_DIR}`);
console.log(failures === 0 ? `✅ Phase 2 E2E 검사 ${total}개 모두 통과` : `❌ ${total}개 중 실패 ${failures}건`);
process.exit(failures === 0 ? 0 : 1);
