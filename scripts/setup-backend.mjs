// FORM3D 로컬 서버 설치: Python 가상환경(backend/.venv)을 만들고 필요한 패키지를 설치합니다.
// 사용법: npm run setup
import { spawnSync } from 'node:child_process';
import { BACKEND, IS_WIN, VENV, VENV_PY, hasVenv } from './backend-env.mjs';

function tryPython(cmd, args) {
  const r = spawnSync(cmd, [...args, '-c', 'import sys; print(sys.version_info[0], sys.version_info[1])'], { encoding: 'utf8' });
  if (r.status !== 0 || !r.stdout) return null;
  const [major, minor] = r.stdout.trim().split(' ').map(Number);
  return { cmd, args, major, minor };
}

const candidates = IS_WIN ? [['py', ['-3']], ['python', []], ['python3', []]] : [['python3', []], ['python', []]];
let py = null;
for (const [cmd, args] of candidates) {
  const found = tryPython(cmd, args);
  if (found && found.major === 3 && found.minor >= 10) { py = found; break; }
}
if (!py) {
  console.error('\n[FORM3D] Python 3.10 이상을 찾지 못했습니다.');
  console.error('  1) https://www.python.org/downloads/ 에서 Python을 설치하세요.');
  console.error('     (설치 첫 화면에서 "Add python.exe to PATH" 를 꼭 체크)');
  console.error('  2) 터미널을 새로 연 뒤 다시 npm run setup 을 실행하세요.');
  console.error('  ※ 서버가 없어도 편집기와 "내 컴퓨터에 저장/열기", 기본 명령 해석기는 동작합니다.\n');
  process.exit(1);
}
console.log(`[FORM3D] Python ${py.major}.${py.minor} 사용 (${py.cmd} ${py.args.join(' ')})`);

if (!hasVenv()) {
  console.log(`[FORM3D] 가상환경 만드는 중: ${VENV}`);
  const r = spawnSync(py.cmd, [...py.args, '-m', 'venv', VENV], { stdio: 'inherit' });
  if (r.status !== 0) { console.error('[FORM3D] 가상환경을 만들지 못했습니다.'); process.exit(1); }
}
console.log('[FORM3D] 필요한 패키지 설치 중... (처음 한 번, 1~3분)');
const pip = spawnSync(VENV_PY, ['-m', 'pip', 'install', '--disable-pip-version-check', '-r', 'requirements.txt'], {
  cwd: BACKEND, stdio: 'inherit',
});
if (pip.status !== 0) { console.error('[FORM3D] 패키지 설치에 실패했습니다. 위 오류 내용을 복사해 알려 주세요.'); process.exit(1); }
console.log('\n[FORM3D] 로컬 서버 설치 완료! 이제 npm run dev 로 실행하세요.');
console.log('[FORM3D] AI 기능을 쓰려면 npm run ai:key 로 Claude API 키를 등록하세요 (선택).\n');
