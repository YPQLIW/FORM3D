// 설치형 프로그램에 넣을 파일을 desktop/stage/form3d 로 모읍니다 (Python 은 GitHub Actions 에서 따로 넣음).
// 사용: npm run build && node scripts/stage-desktop.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'desktop', 'stage', 'form3d');
const skip = (p) => /__pycache__|\.pyc$|\.pytest_cache/.test(p);
const copy = (from, to) => fs.cpSync(path.join(ROOT, from), path.join(OUT, to), { recursive: true, filter: (s) => !skip(s) });

if (!fs.existsSync(path.join(ROOT, 'apps/web/dist/index.html'))) {
  console.error('apps/web/dist 가 없습니다. 먼저 npm run build 를 실행하세요.');
  process.exit(1);
}
fs.rmSync(OUT, { recursive: true, force: true });
copy('apps/web/dist', 'web');
copy('backend/app', 'backend/app');
copy('backend/requirements.txt', 'backend/requirements.txt');
copy('packages/model-types/src/commands.json', 'packages/model-types/src/commands.json');

// 프로그램 버전 = 저장소 버전
const rootPkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const dPath = path.join(ROOT, 'desktop', 'package.json');
const dPkg = JSON.parse(fs.readFileSync(dPath, 'utf8'));
if (dPkg.version !== rootPkg.version) {
  dPkg.version = rootPkg.version;
  fs.writeFileSync(dPath, JSON.stringify(dPkg, null, 2) + '\n');
}
console.log(`[FORM3D] 설치 파일 재료 준비 완료 → ${OUT} (버전 ${rootPkg.version})`);
