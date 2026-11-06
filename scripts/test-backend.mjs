// npm run test:backend : 로컬 서버 테스트 (먼저 npm run setup 필요, pytest 자동 설치)
import { spawnSync } from 'node:child_process';
import { BACKEND, VENV_PY, hasVenv } from './backend-env.mjs';

if (!hasVenv()) { console.error('[FORM3D] 먼저 npm run setup 을 실행하세요.'); process.exit(1); }
spawnSync(VENV_PY, ['-m', 'pip', 'install', '-q', '--disable-pip-version-check', '-r', 'requirements-dev.txt'], { cwd: BACKEND, stdio: 'inherit' });
const r = spawnSync(VENV_PY, ['-m', 'pytest', '-q'], { cwd: BACKEND, stdio: 'inherit' });
process.exit(r.status ?? 1);
