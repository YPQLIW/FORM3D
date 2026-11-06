// npm run dev : 로컬 서버(있으면) + 웹 편집기를 함께 실행합니다.
import { spawn } from 'node:child_process';
import { BACKEND, IS_WIN, ROOT, VENV_PY, hasVenv } from './backend-env.mjs';

const children = [];
function run(name, cmd, args, opts) {
  const child = spawn(cmd, args, { stdio: 'inherit', ...opts });
  children.push(child);
  child.on('exit', (code) => {
    if (name === 'web') { stopAll(); process.exit(code ?? 0); }
    else if (code) console.log(`\n[FORM3D] 로컬 서버가 종료되었습니다 (코드 ${code}). 편집기는 계속 쓸 수 있지만 서버 저장·AI·외부 API는 꺼집니다.\n`);
  });
  return child;
}
function stopAll() { for (const c of children) if (!c.killed) c.kill(); }
process.on('SIGINT', () => { stopAll(); process.exit(0); });
process.on('SIGTERM', () => { stopAll(); process.exit(0); });

if (process.env.FORM3D_NO_BACKEND === '1') {
  console.log('[FORM3D] FORM3D_NO_BACKEND=1 → 로컬 서버 없이 실행');
} else if (hasVenv()) {
  run('backend', VENV_PY, ['-m', 'app.main'], { cwd: BACKEND, env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' } });
} else {
  console.log('\n[FORM3D] 로컬 서버가 아직 설치되지 않았습니다 → 편집기만 실행합니다.');
  console.log('[FORM3D] 프로젝트 저장소·최근 목록·AI 연결을 쓰려면 한 번만: npm run setup\n');
}
run('web', IS_WIN ? 'npm.cmd' : 'npm', ['run', 'dev', '-w', '@form3d/web'], { cwd: ROOT, shell: IS_WIN });
