/**
 * FORM3D Phase 4 E2E 테스트 — 통합 AI 설정 · Ollama 연결 · 대화 맥락 · 되묻기 · 오류 복구 · 온이 assist
 *
 * 실제 제공자 코드를 쓰는 테스트 서버(backend/tests/e2e_server.py real)와,
 * 이 스크립트가 띄우는 '가짜 Ollama 서버'(127.0.0.1:11555, Ollama와 같은 API)를 사용합니다.
 * (유료 API는 호출하지 않습니다. Claude·DashScope 요청 형식은 서버 테스트(pytest)에서 모의 검증)
 *
 * 사용법: npm run build && (cd apps/web && npx vite preview --port 4173)  →  npm run test:e2e:phase4
 */
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BACKEND, VENV_PY } from './backend-env.mjs';

const URL = process.env.FORM3D_URL ?? 'http://localhost:4173';
const SHOT_DIR = process.env.SHOT_DIR ?? path.join(os.tmpdir(), 'form3d-e2e-phase4');
const PY = process.env.FORM3D_PYTHON ?? VENV_PY;
const API = 'http://127.0.0.1:8765';
const OLLAMA_PORT = 11555;
fs.mkdirSync(SHOT_DIR, { recursive: true });
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'form3d-e2e4-data-'));
const { chromium } = createRequire(import.meta.url)('playwright');

let failures = 0;
let total = 0;
const check = (cond, msg, extra) => {
  total++;
  console.log(`${cond ? '  ✓' : '  ✗'} ${msg}${!cond && extra !== undefined ? ` → ${JSON.stringify(extra).slice(0, 400)}` : ''}`);
  if (!cond) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------- 가짜 Ollama 서버 ----------------
const installed = [];
const chatLog = [];
const reply = (kind, extra = {}) => JSON.stringify({ kind, message: '', summary: '', options: [], steps: [], ...extra });
const step = (command, params) => ({ command, params_json: JSON.stringify(params) });
const ollama = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const send = (code, obj) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(obj));
    };
    if (req.url === '/api/version') return send(200, { version: '0.12.0-fake' });
    if (req.url === '/api/tags') return send(200, { models: installed.map((n) => ({ name: n, size: 5_200_000_000 })) });
    if (req.url === '/api/pull') {
      const { model } = JSON.parse(body);
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
      let done = 0;
      const t = setInterval(() => {
        done += 25;
        res.write(JSON.stringify({ status: 'downloading', total: 100, completed: done }) + '\n');
        if (done >= 100) {
          clearInterval(t);
          installed.push(model);
          res.end(JSON.stringify({ status: 'success' }) + '\n');
        }
      }, 80);
      return;
    }
    if (req.url === '/api/chat') {
      const b = JSON.parse(body);
      chatLog.push(b);
      const last = b.messages.at(-1).content;
      const req2 = last.slice(last.lastIndexOf('요청:'));
      let content;
      if (/연결 테스트/.test(req2)) content = reply('answer', { message: '연결 성공' });
      else if (/어느/.test(req2)) content = reply('question', { message: '어떤 오브젝트를 옮길까요?', options: ['Sphere', '모두'] });
      else if (/뭐 있어/.test(req2)) content = reply('answer', { message: '씬에 Sphere 1개가 있습니다.' });
      else if (/빨갛게/.test(req2)) content = reply('plan', { summary: '선택한 것을 빨간색으로', steps: [step('set_material', { color: '#e53935' })] });
      else if (/실패하게/.test(req2)) content = reply('plan', { summary: '없는 오브젝트 삭제', steps: [step('delete', { target: { names: ['없는것'] } })] });
      else if (/실패했습니다/.test(req2)) content = reply('plan', { summary: '수정: 선택한 것 삭제 대신 숨기기', steps: [step('set_visibility', { visible: false })] });
      else if (/Sphere/.test(req2)) content = reply('plan', { summary: 'Sphere를 오른쪽으로 1', steps: [step('transform', { target: { names: ['Sphere'] }, translate: [1, 0, 0] })] });
      else content = reply('plan', { summary: '구 하나 만들기', steps: [step('create_primitive', { shape: 'sphere' })] });
      return send(200, { message: { role: 'assistant', content }, prompt_eval_count: 900, eval_count: 60 });
    }
    send(404, { error: 'not found' });
  });
});
await new Promise((r) => ollama.listen(OLLAMA_PORT, '127.0.0.1', r));

// ---------------- 테스트 서버 ----------------
const backend = spawn(PY, [path.join(BACKEND, 'tests', 'e2e_server.py'), DATA_DIR, '8765', 'real'], {
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
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const ev = (fn, arg) => page.evaluate(fn, arg);
const shot = (n) => page.screenshot({ path: path.join(SHOT_DIR, `${n}.png`) });
const dlg = () => page.getByRole('dialog', { name: 'AI 설정' });
const card = (id) => page.getByTestId(`provider-${id}`);
const rootNames = () => ev(() => window.__FORM3D__.root.children.map((o) => o.name));
const ask = async (text) => {
  const before = await page.locator('[data-entry]').count();
  await page.getByLabel('AI 명령 입력').fill(text);
  await page.getByLabel('AI 명령 입력').press('Enter');
  await page.waitForFunction((n) => document.querySelectorAll('[data-entry]').length >= n + 2 && !document.querySelector('[data-testid=assistant-thinking]'), before, { timeout: 15000 });
  return page.locator('[data-entry]').last();
};

try {
  check(up, '테스트 서버 시작 (실제 제공자 코드)');
  await page.goto(URL);
  await page.waitForSelector('canvas');
  await ev(() => window.__FORM3D_PROJECT__.refreshServer());
  await page.waitForTimeout(300);

  console.log('▶ 1. AI 설정 화면: 제공자 3종 · 유료/무료 구분 · 상태');
  await page.getByTestId('ai-settings-button').click();
  await dlg().waitFor();
  await card('ollama').waitFor();
  check((await card('claude').getAttribute('data-state')) === 'no_key', 'Claude: 키 없음 표시');
  check((await card('dashscope').getAttribute('data-state')) === 'no_key', 'Qwen API: 키 없음 표시');
  check((await card('ollama').getAttribute('data-state')) === 'offline', 'Ollama: 꺼짐 표시 + 해결 방법', await card('ollama').innerText());
  check(/ollama\.com/.test(await card('ollama').innerText()), 'Ollama 설치 안내 링크');
  check(/유료 API/.test(await card('claude').innerText()) && /유료 API/.test(await card('dashscope').innerText()) && /무료 · 내 PC/.test(await card('ollama').innerText()), '유료 API / 무료 로컬 구분 표시');

  console.log('▶ 2. API 키 저장 (화면·브라우저 저장소에 노출 안 됨)');
  const SECRET = 'sk-e2eDashScopeSecret0123456789';
  await card('dashscope').getByLabel(/API 키/).fill(SECRET);
  await card('dashscope').getByRole('button', { name: '저장' }).click();
  await page.waitForTimeout(500);
  check(/등록됨/.test(await card('dashscope').innerText()), '키 등록됨 표시 (가린 값)');
  const html = await page.content();
  const ls = await ev(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
  check(!html.includes(SECRET) && !ls.includes(SECRET), '키가 화면 HTML·브라우저 저장소에 없음');
  check(fs.readFileSync(path.join(DATA_DIR, 'secrets.json'), 'utf8').includes(SECRET), '키는 로컬 서버 파일에만 저장');
  await card('dashscope').getByLabel('DashScope 지역').selectOption('cn');
  await page.waitForTimeout(400);
  check(/중국판/.test(await card('dashscope').innerText()), '지역 변경 반영');

  console.log('▶ 3. Ollama 연결 · 모델 내려받기 · 선택 · 연결 테스트');
  await card('ollama').getByLabel('Ollama 주소').fill(`http://127.0.0.1:${OLLAMA_PORT}`);
  await card('ollama').getByLabel('Ollama 주소').press('Tab');
  await page.waitForFunction(() => document.querySelector('[data-testid=provider-ollama]')?.getAttribute('data-state') === 'ready', null, { timeout: 8000 });
  check(/모델 없음/.test(await card('ollama').innerText()), 'Ollama 탐지 · 설치된 모델 없음 안내');
  await card('ollama').getByRole('button', { name: '내려받기' }).click();
  await page.waitForFunction(() => /완료/.test(document.querySelector('[data-testid=provider-ollama]')?.innerText ?? ''), null, { timeout: 8000 });
  check(installed.includes('qwen3:8b'), '모델 내려받기 (진행률 → 완료)');
  await page.waitForTimeout(500);
  await card('ollama').getByRole('button', { name: '모델 목록 새로 고침' }).click().catch(() => {});
  await page.waitForTimeout(300);
  await card('ollama').getByLabel('ollama 모델').selectOption('qwen3:8b');
  await page.waitForTimeout(400);
  await page.getByTestId('test-ollama').click();
  await page.getByTestId('test-result').waitFor({ timeout: 8000 });
  check((await page.getByTestId('test-result').getAttribute('data-ok')) === 'true', '연결 테스트 성공 (응답 시간 표시)', await page.getByTestId('test-result').innerText());
  await page.getByTestId('test-claude').click();
  await page.locator('[data-testid=provider-claude] [data-testid=test-result]').waitFor({ timeout: 8000 });
  const ct = await page.locator('[data-testid=provider-claude] [data-testid=test-result]').innerText();
  check(/실패/.test(ct) && /해결 방법/.test(ct), 'Claude 테스트 실패 → 원인과 해결 방법 안내', ct);
  await shot('p4-01-settings');

  console.log('▶ 4. 기본 모델 · 엔진 상태');
  await dlg().getByRole('tab', { name: '기본·작업별 모델' }).click();
  await dlg().getByLabel('기본 제공자').selectOption('ollama');
  await page.waitForTimeout(600);
  const st = await (await fetch(`${API}/api/ai/status`)).json();
  check(st.settings.default.provider === 'ollama' && st.settings.default.model === 'qwen3:8b', '기본 모델 = Ollama qwen3:8b', st.settings.default);
  await dlg().getByRole('tab', { name: '크리에이티브 엔진' }).click();
  const engines = await dlg().locator('[data-testid^=engine-]').allInnerTexts();
  check(engines.length === 4 && engines.every((t) => /준비 안 됨/.test(t)), '엔진 4종: 모두 "준비 안 됨" (구현된 것처럼 표시 안 함)', engines);
  await page.keyboard.press('Escape');
  await ev(() => window.__FORM3D_PROJECT__.refreshServer());
  await page.waitForTimeout(400);

  console.log('▶ 5. AI Assistant: 계획 · 맥락 · 되묻기 · 답변 · 오류 복구');
  await page.getByRole('tab', { name: 'AI Assistant' }).click();
  check(/Ollama|ollama/.test(await page.getByTestId('ai-status').innerText()) && /무료/.test(await page.getByTestId('ai-status').innerText()), '현재 모델 표시 (Ollama · 무료)', await page.getByTestId('ai-status').innerText());
  let last = await ask('구 하나 만들어 줘');
  check(/무료/.test(await last.getByTestId('job-meta').innerText()), '계획 카드에 모델·토큰·무료 표시');
  await last.getByTestId('job-run').click();
  check((await rootNames()).includes('Sphere'), '실행 → 구 생성');
  await page.waitForTimeout(300);
  last = await ask('그거 빨갛게 해 줘');
  const ctx = JSON.stringify(chatLog.at(-1).messages);
  check(ctx.includes('구 하나 만들어 줘') && ctx.includes('[실행 결과]'), '이전 대화와 실행 결과가 AI에 함께 전달 (맥락 유지)');
  await last.getByTestId('job-run').click();
  check((await ev(() => window.__FORM3D__.root.getObjectByName('Sphere').material.color.getHexString())) === 'e53935', '맥락 이어서 실행 (빨간색)');
  last = await ask('어느 걸 옮길까');
  check((await last.getByTestId('question-options').locator('button').count()) === 2, '모호한 요청 → 실행 전에 선택지로 되묻기');
  await last.getByTestId('question-options').getByRole('button', { name: 'Sphere' }).click();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=job-card]').length >= 3 && !document.querySelector('[data-testid=assistant-thinking]'));
  const x0 = await ev(() => window.__FORM3D__.root.getObjectByName('Sphere').position.x);
  await page.getByTestId('job-card').last().getByTestId('job-run').click();
  check(Math.abs((await ev(() => window.__FORM3D__.root.getObjectByName('Sphere').position.x)) - x0 - 1) < 1e-6, '선택지를 고르면 그 답으로 계획 → 실행');
  last = await ask('씬에 뭐 있어?');
  check(/Sphere 1개/.test(await last.innerText()) && (await last.getByTestId('job-card').count()) === 0, '질문에는 실행 없이 답변');
  last = await ask('실패하게 해 줘');
  await last.getByTestId('job-run').click();
  check((await last.getByTestId('job-card').getAttribute('data-state')) === 'failed', '실패한 작업 → 전체 취소');
  await last.getByTestId('job-fix').click();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=job-card]').length >= 5 && !document.querySelector('[data-testid=assistant-thinking]'));
  check(/수정: /.test(await page.getByTestId('job-card').last().innerText()) && /실패했습니다/.test(JSON.stringify(chatLog.at(-1).messages)), '"AI에게 수정 요청" → 실패 원인을 반영한 수정 계획');
  await shot('p4-02-assistant');
  await page.getByTestId('new-conversation').click();
  check((await page.getByTestId('job-card').count()) === 0, '새 대화 → 대화창 초기화');
  await ask('구 하나 만들어 줘');
  check(!JSON.stringify(chatLog.at(-1).messages).includes('빨갛게'), '새 대화에서는 이전 맥락을 보내지 않음');

  console.log('▶ 6. 사용량 · 비용');
  await page.getByTestId('ai-settings-button').click();
  await dlg().getByRole('tab', { name: '사용량·비용' }).click();
  await page.getByTestId('usage-table').waitFor();
  await page.waitForTimeout(400);
  const usage = await page.getByTestId('usage-table').innerText();
  check(/ollama/.test(usage) && /무료/.test(usage), '사용량 표: Ollama 요청·토큰·무료', usage);
  await page.keyboard.press('Escape');

  console.log('▶ 7. 온이: 모델 확인 · 자연어 요청 · 진행 상태 · 결과');
  const models = await v1('GET', '/ai/models');
  check(models.status === 200 && models.body.providers.find((p) => p.id === 'ollama').state === 'ready' && !JSON.stringify(models.body).includes(SECRET), '사용 가능한 모델 조회 (키 없음)');
  const eng = await v1('GET', '/engines');
  check(eng.body.engines.length === 4 && eng.body.engines.every((e) => !e.available), '엔진 목록 조회 (사용 불가 표시)');
  const a = await v1('POST', '/assist', { text: '구 하나 만들어 줘', wait: false });
  check(a.status === 202 && /^job_/.test(a.body.jobId), '자연어 요청 → 작업 ID 즉시 반환 (비동기)');
  let state = '';
  for (let i = 0; i < 50 && state !== 'awaiting_confirmation'; i++) {
    state = (await v1('GET', `/jobs/${a.body.jobId}`)).body.state;
    if (state !== 'awaiting_confirmation') await sleep(100);
  }
  check(state === 'awaiting_confirmation', '진행 상태: 편집기에서 확인 대기');
  const n0 = (await rootNames()).length;
  await page.locator('[data-testid=job-card][data-state=pending]').last().getByTestId('job-run').click();
  for (let i = 0; i < 50 && state !== 'done'; i++) {
    state = (await v1('GET', `/jobs/${a.body.jobId}`)).body.state;
    if (state !== 'done') await sleep(100);
  }
  const fin = (await v1('GET', `/jobs/${a.body.jobId}`)).body;
  check(state === 'done' && fin.result.status === 'success' && fin.plan.provider === 'ollama' && (await rootNames()).length === n0 + 1, '작업 결과 반환 (사용한 모델 포함)', fin);
  const q = await v1('POST', '/assist', { text: '어느 걸 옮길까' });
  check(q.status === 200 && q.body.state === 'answered' && q.body.plan.options.length === 2, '온이의 모호한 요청 → 실행 없이 질문 반환');
  await shot('p4-03-oni');

  check(errors.length === 0, '콘솔 오류 없음', errors);
} catch (err) {
  failures++;
  console.error('✗ 예외:', err);
  await shot('p4-error').catch(() => {});
} finally {
  await browser.close();
  backend.kill('SIGKILL');
  ollama.close();
  console.log(`\n스크린샷: ${SHOT_DIR}`);
  console.log(failures ? `❌ ${failures}/${total} 실패` : `✅ Phase 4 E2E ${total}개 검사 모두 통과`);
  process.exit(failures ? 1 : 0);
}
