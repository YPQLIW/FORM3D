/**
 * FORM3D Phase 4.5 E2E — 대화형 AI Assistant (지시서의 8가지 시나리오)
 *
 * ⚠ 모의 테스트입니다. 실제 Qwen 모델이 아니라, 이 스크립트가 띄우는 '가짜 Qwen API 서버'
 *   (DashScope와 같은 OpenAI 호환 /chat/completions)가 정해진 규칙으로 답합니다.
 *   검증하는 것: FORM3D 쪽 전체 경로 — 대화 기록 전달, 장면 정보 전달, 방금 만든 오브젝트 id 기억,
 *   되묻기·답변·계획 표시, 미리보기 → 실행 → Undo, 온이 연결, 연결 끊김·키 오류 안내, 대기 시간·취소.
 *   실제 모델의 이해 능력(응답 품질)은 이 테스트로 알 수 없습니다.
 *
 * 사용법: npm run build && (cd apps/web && npx vite preview --port 4173)  →  npm run test:e2e:phase45
 */
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BACKEND, VENV_PY } from './backend-env.mjs';

const URL = process.env.FORM3D_URL ?? 'http://localhost:4173';
const SHOT_DIR = process.env.SHOT_DIR ?? path.join(os.tmpdir(), 'form3d-e2e-phase45');
const PY = process.env.FORM3D_PYTHON ?? VENV_PY;
const API = 'http://127.0.0.1:8765';
const QWEN_PORT = 11556;
fs.mkdirSync(SHOT_DIR, { recursive: true });
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'form3d-e2e45-data-'));
const { chromium } = createRequire(import.meta.url)('playwright');

let failures = 0;
let total = 0;
const check = (cond, msg, extra) => {
  total++;
  console.log(`${cond ? '  ✓' : '  ✗'} ${msg}${!cond && extra !== undefined ? ` → ${JSON.stringify(extra).slice(0, 500)}` : ''}`);
  if (!cond) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------- 가짜 Qwen API 서버 (규칙으로 답함 · 실제 AI 아님) ----------------
const requests = [];
const out = (kind, extra = {}) => ({ kind, message: '', summary: '', options: [], steps: [], ...extra });
const step = (command, params) => ({ command, params_json: JSON.stringify(params) });
function think(body) {
  const msgs = body.messages;
  const last = msgs.at(-1).content;
  const text = last.slice(last.lastIndexOf('요청:') + 3).trim();
  const sceneMatch = last.match(/현재 씬 정보\(JSON 데이터\):\n([\s\S]*?)\n\n요청:/);
  const scene = sceneMatch ? JSON.parse(sceneMatch[1]) : { nodes: [] };
  const history = msgs.slice(1).map((m) => m.content).join('\n');
  const recentId = scene.recentlyCreated?.[0]?.id ?? [...history.matchAll(/\(id ([\w-]+)\)/g)].at(-1)?.[1];
  const recentName = scene.recentlyCreated?.[0]?.name ?? '오브젝트';
  const names = scene.nodes.map((n) => n.name);
  if (/연결 테스트/.test(text)) return out('answer', { message: '연결 성공' });
  if (/안녕/.test(text)) return out('answer', { message: '안녕하세요! FORM3D 작업 도우미입니다. 도형을 만들고 옮기고 색을 바꾸는 일을 도와드릴 수 있어요.' });
  const nameSaid = text.match(/내 이름은 (\S+?)(이야|야)/);
  if (nameSaid) return out('answer', { message: `반갑습니다, ${nameSaid[1]}님. 기억해 둘게요.` });
  if (/내 이름이 뭐/.test(text)) {
    const m = history.match(/내 이름은 (\S+?)(이야|야)/);
    return out('answer', { message: m ? `${m[1]}님이라고 하셨어요.` : '아직 이름을 듣지 못했어요.' });
  }
  if (/원기둥/.test(text) && /만들/.test(text))
    return out('plan', { message: '원기둥을 하나 만들겠습니다.', summary: '원기둥 1개 만들기', steps: [step('create_primitive', { shape: 'cylinder' })] });
  if (/조금 더 크게/.test(text)) {
    if (!recentId) return out('question', { message: '어떤 오브젝트를 키울까요?', options: names.slice(0, 5) });
    return out('plan', { message: `방금 만든 ${recentName}의 크기를 1.25배로 키우겠습니다.`, summary: `${recentName} 1.25배 확대`, steps: [step('transform', { target: { ids: [recentId] }, scale_by: 1.25 })] });
  }
  if (/장면에 뭐|뭐가 있/.test(text)) return out('answer', { message: `지금 장면에는 ${names.length}개가 있습니다: ${names.join(', ')}.` });
  if (/좋아하는 색이 뭐/.test(text)) return out('answer', { message: /초록색이에요/.test(history) ? '초록색이라고 하셨어요.' : '모르겠어요.' });
  if (/그거 지워/.test(text)) return out('question', { message: '어느 것을 지울까요?', options: names.slice(0, 5) });
  if (/구 3개/.test(text))
    return out('plan', { message: '구 3개를 만들어 칠하고 묶겠습니다.', summary: '구 3개 · 색 · 그룹', steps: [step('create_primitive', { shape: 'sphere', count: 3 }), step('set_material', { target: 'created', color: '#e53935' }), step('group', { target: 'created', name: 'Spheres' })] });
  if (/몇 개/.test(text)) return out('answer', { message: `${names.length}개 있습니다.` });
  if (/하나 지워/.test(text)) return out('question', { message: '어느 것을 지울까요?', options: names.slice(0, 5) });
  if (names.includes(text) && /어느 것을 지울까요/.test(history))
    return out('plan', { message: `${text}을(를) 삭제하겠습니다.`, summary: `${text} 삭제`, steps: [step('delete', { target: { names: [text] } })] });
  if (/오른쪽으로 옮겨/.test(text) && recentId)
    return out('plan', { message: '방금 만든 것을 오른쪽으로 1m 옮기겠습니다.', summary: '오른쪽으로 1m', steps: [step('transform', { target: { ids: [recentId] }, translate: [1, 0, 0] })] });
  if (/구 하나/.test(text)) return out('plan', { message: '구를 하나 만들겠습니다.', summary: '구 1개 만들기', steps: [step('create_primitive', { shape: 'sphere' })] });
  return out('answer', { message: '무엇을 도와드릴까요?' });
}
const qwen = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', async () => {
    const send = (code, obj) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(obj));
    };
    if (req.url.endsWith('/models')) return send(200, { data: [{ id: 'qwen-plus' }, { id: 'qwen-max' }, { id: 'qwq-plus' }] });
    if (!req.url.endsWith('/chat/completions')) return send(404, {});
    const body = JSON.parse(raw);
    requests.push(body);
    const last = body.messages.at(-1).content;
    if (/키오류/.test(last)) return send(401, { error: { code: 'InvalidApiKey', message: 'Incorrect API key provided.' } });
    if (body.enable_thinking !== false) return send(400, { error: { code: 'InvalidParameter', message: 'parameter.enable_thinking must be set to false for non-streaming calls' } });
    if (/천천히/.test(last)) await sleep(4000);
    send(200, {
      choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(think(body)) } }],
      usage: { prompt_tokens: 1500, completion_tokens: 80 },
    });
  });
});
await new Promise((r) => qwen.listen(QWEN_PORT, '127.0.0.1', r));

// ---------------- 테스트 서버 (실제 제공자 코드, Qwen 주소만 가짜 서버로) ----------------
const backend = spawn(PY, [path.join(BACKEND, 'tests', 'e2e_server.py'), DATA_DIR, '8765', 'real', `http://127.0.0.1:${QWEN_PORT}/compatible-mode/v1`], {
  cwd: BACKEND, stdio: ['ignore', 'inherit', 'inherit'], env: { ...process.env, PYTHONUTF8: '1' },
});
let up = false;
for (let i = 0; i < 100 && !up; i++) {
  try {
    up = (await fetch(`${API}/api/health`)).ok;
  } catch {
    await sleep(100);
  }
}
const local = (method, p, body) =>
  fetch(`${API}/api${p}`, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined })
    .then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
const token = () => fs.readFileSync(path.join(DATA_DIR, 'oni-token.txt'), 'utf8').split(/\r?\n/).find((l) => l && !l.startsWith('#'));
const v1 = (method, p, body) =>
  fetch(`${API}/api/v1${p}`, {
    method,
    headers: { Authorization: `Bearer ${token()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
const ev = (fn, arg) => page.evaluate(fn, arg);
const shot = (n) => page.screenshot({ path: path.join(SHOT_DIR, `${n}.png`) });
const objs = () => ev(() => window.__FORM3D__.root.children.map((o) => ({ id: o.uuid, name: o.name, x: o.position.x, s: o.scale.x })));
const input = () => page.getByLabel('AI 명령 입력');
const ask = async (text) => {
  const before = await page.locator('[data-entry]').count();
  await input().fill(text);
  await input().press('Enter');
  await page.waitForFunction((n) => document.querySelectorAll('[data-entry]').length >= n + 2 && !document.querySelector('[data-testid=assistant-thinking]'), before, { timeout: 15000 });
  return page.locator('[data-entry]').last();
};
const runLast = async () => {
  await page.locator('[data-testid=job-card][data-state=pending]').last().getByTestId('job-run').click();
  await page.waitForTimeout(150);
};
const waitJob = async (jobId, want) => {
  let st = '';
  for (let i = 0; i < 60 && st !== want; i++) {
    st = (await v1('GET', `/jobs/${jobId}`)).body?.state;
    if (st !== want) await sleep(100);
  }
  return st;
};

try {
  check(up, '테스트 서버 시작 (실제 Qwen 제공자 코드 + 가짜 Qwen 서버)');
  await local('PUT', '/ai/keys/dashscope', { key: 'sk-e2e-fake-key-123456' });
  const set = await local('PUT', '/ai/settings', { default: { provider: 'dashscope', model: 'qwen-plus' } });
  check(set.status === 200 && set.body.settings.params.timeout === 180, 'Qwen API를 기본 모델로 설정 · 기본 대기 시간 180초', set.body?.settings?.params);
  const models = await local('GET', '/ai/providers/dashscope/models');
  check(JSON.stringify(models.body.models.map((m) => m.id)) === '["qwen-max","qwen-plus"]', '모델 목록에서 쓸 수 없는 모델(qwq 등) 제외', models.body);
  const test = await local('POST', '/ai/providers/dashscope/test', { model: null });
  check(test.status === 200 && test.body.reply === '연결 성공', 'Qwen 연결 테스트 성공 (enable_thinking=false 전송)', test.body);

  await page.goto(URL);
  await page.waitForSelector('canvas');
  await ev(() => window.__FORM3D_PROJECT__.refreshServer());
  await page.waitForTimeout(400);
  await page.getByRole('tab', { name: 'AI Assistant' }).click();
  check(/Qwen API.*qwen-plus.*유료/.test(await page.getByTestId('ai-status').innerText()), 'Assistant 상태: Qwen API · qwen-plus (유료) 연결됨', await page.getByTestId('ai-status').innerText());

  console.log('▶ 1. 일반 질문');
  let e = await ask('안녕, 넌 뭘 할 수 있어?');
  check(/FORM3D 작업 도우미/.test(await e.innerText()) && /Qwen API · qwen-plus/.test(await e.innerText()), 'AI 답변 표시 + 사용한 모델 표시', await e.innerText());

  console.log('▶ 2. 이전 대화 기억');
  await ask('내 이름은 하율이야');
  e = await ask('내 이름이 뭐였지?');
  check(/하율님이라고/.test(await e.innerText()), '이전 대화 내용으로 답함 (대화 기록이 함께 전달됨)', await e.innerText());
  const histMsgs = requests.at(-1).messages;
  check(histMsgs.some((m) => m.role === 'assistant') && JSON.stringify(histMsgs).includes('내 이름은 하율이야'), '요청에 이전 대화(user/assistant) 포함');

  console.log('▶ 3. 원기둥 생성');
  e = await ask('원기둥 하나 만들어 줘');
  check(/원기둥을 하나 만들겠습니다/.test(await e.innerText()) && (await e.getByTestId('job-say').count()) === 1, 'AI가 할 일을 말하고 미리보기 카드 표시 (실행 전)', await e.innerText());
  check((await objs()).length === 0, '승인 전에는 실행하지 않음');
  await runLast();
  const cyl = (await objs()).find((o) => /Cylinder/i.test(o.name));
  check(!!cyl, '실행 → 원기둥 생성', await objs());

  console.log('▶ 4. 방금 만든 원기둥 크기 변경');
  e = await ask('조금 더 크게 해줘');
  const last = requests.at(-1).messages.at(-1).content;
  check(last.includes('recentlyCreated') && last.includes(cyl.id), '장면 정보에 방금 만든 오브젝트 id 전달');
  check(JSON.stringify(requests.at(-1).messages).includes(`(id ${cyl.id})`), '대화 기록에 실행 결과(만든 것 id) 전달');
  check(/방금 만든 Cylinder/.test(await e.innerText()), 'AI: 방금 만든 원기둥을 키우겠다고 설명', await e.innerText());
  await runLast();
  const cyl2 = (await objs()).find((o) => o.id === cyl.id);
  check(Math.abs(cyl2.s - 1.25) < 1e-6, '원기둥 크기 1.25배', cyl2);
  check((await page.locator('[data-testid=job-card]').last().getByTestId('job-undo').count()) === 1, '실행 취소 버튼 제공');
  await shot('p45-01-cylinder');

  console.log('▶ 5. 현재 장면 질문');
  await page.getByRole("button", { name: "도형 추가" }).click();
  await page.getByRole("menuitem", { name: /큐브/ }).click();
  await page.waitForTimeout(200);
  const names = (await objs()).map((o) => o.name);
  e = await ask('지금 장면에 뭐 있어?');
  const t5 = await e.innerText();
  check(names.length >= 1 && names.every((n) => t5.includes(n)), `장면의 실제 오브젝트로 답함 (${names.join(', ')})`, t5);

  console.log('▶ 6. 모호한 요청 → 되묻기');
  e = await ask('하나 지워줘');
  const opts = e.getByTestId('question-options').locator('button');
  check((await opts.count()) === names.length && (await objs()).length === names.length, '선택지로 되묻고, 아무것도 지우지 않음', await e.innerText());
  const before6 = (await page.locator('[data-entry]').count());
  await opts.filter({ hasText: names.at(-1) }).click();
  await page.waitForFunction((n) => document.querySelectorAll('[data-entry]').length >= n + 2 && !document.querySelector('[data-testid=assistant-thinking]'), before6);
  check(/삭제하겠습니다/.test(await page.locator('[data-entry]').last().innerText()), '선택지를 고르면 그 대상으로 계획');
  await runLast();
  check((await objs()).length === names.length - 1, '확인 후 삭제 실행');

  console.log('▶ 7. 온이를 통한 실제 작업 요청 (대화 이어가기)');
  const a = await v1('POST', '/assist', { text: '구 하나 만들어 줘', conversation: 'oni-e2e', wait: false });
  check(a.status === 202, '온이 자연어 요청 → 작업 ID');
  check((await waitJob(a.body.jobId, 'awaiting_confirmation')) === 'awaiting_confirmation', '편집기에서 확인 대기 (기존 권한·정책 유지)');
  await runLast();
  check((await waitJob(a.body.jobId, 'done')) === 'done', '온이 작업 완료');
  const fin = (await v1('GET', `/jobs/${a.body.jobId}`)).body;
  const sph = fin.result.created[0];
  check(fin.conversation === 'oni-e2e' && fin.plan.message === '구를 하나 만들겠습니다.' && !!sph, '결과에 AI 설명 · 만든 오브젝트 · 대화 ID 포함', fin);
  const b = await v1('POST', '/assist', { text: '그거 오른쪽으로 옮겨줘', conversation: 'oni-e2e', wait: false });
  await waitJob(b.body.jobId, 'awaiting_confirmation');
  const x0 = (await objs()).find((o) => o.id === sph.id).x;
  await runLast();
  check((await waitJob(b.body.jobId, 'done')) === 'done' && Math.abs((await objs()).find((o) => o.id === sph.id).x - x0 - 1) < 1e-6, '온이 "그거 옮겨줘" → 방금 만든 구를 1m 이동 (대화 기억)');
  const scene = await v1('GET', '/scene');
  check(scene.status === 200 && JSON.stringify(scene.body).includes(sph.id), '온이 현재 장면 상태 조회');

  console.log('▶ 8. 대기 시간 표시 · 취소');
  await input().fill('천천히 답해줘');
  await input().press('Enter');
  await page.waitForFunction(() => /[2-9]초/.test(document.querySelector('[data-testid=thinking-elapsed]')?.textContent ?? ''), null, { timeout: 6000 });
  check(true, '기다리는 동안 경과 시간 표시');
  await page.getByTestId('thinking-cancel').click();
  await page.waitForFunction(() => !document.querySelector('[data-testid=assistant-thinking]'));
  check(/취소했습니다/.test(await page.locator('[data-entry]').last().innerText()), '취소 버튼으로 요청 중단');

  console.log('▶ 10. 1단계: 모델 전환 · 대화 기록 유지 · 실제 AI 점검 화면');
  check((await page.getByTestId('model-switch').inputValue()) === 'dashscope', 'Assistant에서 바로 모델 전환 선택 상자 (Qwen API 선택됨)');
  await page.reload();
  await page.waitForSelector('canvas');
  await ev(() => window.__FORM3D_PROJECT__.refreshServer());
  await page.getByRole('tab', { name: 'AI Assistant' }).click();
  await page.waitForFunction(() => /이전 대화/.test(document.body.innerText), null, { timeout: 8000 });
  const restoredText = await page.locator('[data-entry]').allInnerTexts();
  check(restoredText.some((t) => /원기둥 하나 만들어 줘/.test(t)) && restoredText.some((t) => /AI: .*원기둥/.test(t)), '다시 켜도 이전 대화가 화면에 복원됨', restoredText.slice(0, 6));
  await page.getByTestId('ai-settings-button').click();
  await page.getByRole('dialog', { name: 'AI 설정' }).getByRole('tab', { name: '실제 AI 점검' }).click();
  await page.getByTestId('selftest-start').click();
  await page.waitForFunction(() => ['done', 'cancelled'].includes(document.querySelector('[data-testid=selftest-result]')?.getAttribute('data-state') ?? ''), null, { timeout: 60000 });
  const r = {};
  for (let i = 1; i <= 8; i++) r[i] = await page.getByTestId(`selftest-item-${i}`).getAttribute('data-result');
  check(JSON.stringify(r) === JSON.stringify({ 1: 'pass', 2: 'pass', 3: 'pass', 4: 'pass', 5: 'pass', 6: 'skip', 7: 'skip', 8: 'pass' }), '점검 화면: 1~5·8 통과, 6·7 건너뜀(키·Ollama 없음) — 판정 기능 확인', r);
  check(/reports/.test(await page.getByTestId('selftest-result').innerText()), '보고서 파일 저장 위치 표시');
  const reports = fs.readdirSync(path.join(DATA_DIR, 'reports'));
  check(reports.length === 1 && /실제 AI 모델 테스트/.test(fs.readFileSync(path.join(DATA_DIR, 'reports', reports[0]), 'utf8')), '보고서 .md 파일 생성');
  const hist = await v1('GET', '/conversations/oni-e2e');
  check(hist.status === 200 && hist.body.messages.some((m) => m.role === 'result' && /만든 것/.test(m.text)), '온이 대화 기록 조회 (요청·AI 응답·실행 결과)', hist.body);
  await shot('p45-03-selftest');
  await page.keyboard.press('Escape');

  console.log('▶ 9. API 오류와 연결 끊김 구분 안내');
  e = await ask('키오류 테스트');
  const t9 = await e.innerText();
  check(/거부/.test(t9) && /지역/.test(t9), 'API 키 오류: "키 오류 또는 지역 불일치" + 해결 방법', t9);
  qwen.closeAllConnections?.();
  await new Promise((r) => qwen.close(r));
  e = await ask('구 하나 만들어 줘');
  const t10 = await e.innerText();
  check(/연결할 수 없습니다/.test(t10) && /인터넷/.test(t10) && !/거부/.test(t10), '연결 끊김: "연결할 수 없음" + 인터넷·지역 확인 안내', t10);
  check((await page.locator('body').innerText()).includes('서버 연결됨'), 'FORM3D 로컬 서버는 계속 연결됨으로 유지 (AI 오류와 구분)');
  await shot('p45-02-errors');

  check(errors.length === 0, '콘솔 오류 없음', errors);
} catch (err) {
  failures++;
  console.error('✗ 예외:', err);
  await shot('p45-error').catch(() => {});
} finally {
  await browser.close();
  backend.kill('SIGKILL');
  qwen.closeAllConnections?.();
  qwen.close();
  console.log(`\n스크린샷: ${SHOT_DIR}`);
  console.log(failures ? `❌ ${failures}/${total} 실패` : `✅ Phase 4.5 E2E ${total}개 검사 모두 통과 (모의 Qwen 서버)`);
  process.exit(failures ? 1 : 0);
}
