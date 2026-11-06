// Claude API 키를 backend/.env 에 저장합니다. 키는 이 컴퓨터의 서버만 읽고, 웹 화면에는 전달되지 않습니다.
// 사용법: npm run ai:key
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { BACKEND } from './backend-env.mjs';

const envPath = join(BACKEND, '.env');
const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
// 입력하는 키가 화면에 보이지 않게 가립니다
rl._writeToOutput = function (s) {
  if (this.muted && !s.includes('\n')) this.output.write('*');
  else this.output.write(s);
};
console.log('Claude API 키를 붙여넣고 Enter 를 누르세요. (지우려면 아무것도 입력하지 않고 Enter)');
rl.question('API 키: ', (answer) => {
  rl.close();
  process.stdout.write('\n');
  const key = answer.trim();
  if (key && !/^[A-Za-z0-9_\-]{20,300}$/.test(key)) {
    console.error('[FORM3D] 키 형식이 올바르지 않습니다. 다시 확인해 주세요.');
    process.exit(1);
  }
  const lines = existsSync(envPath) ? readFileSync(envPath, 'utf8').split(/\r?\n/) : [];
  const kept = lines.filter((l) => !/^\s*ANTHROPIC_API_KEY\s*=/.test(l));
  while (kept.length && kept[kept.length - 1] === '') kept.pop();
  kept.push(`ANTHROPIC_API_KEY=${key}`);
  writeFileSync(envPath, kept.join('\n') + '\n', { encoding: 'utf8', mode: 0o600 });
  console.log(key ? `[FORM3D] 저장했습니다: ${envPath}` : '[FORM3D] API 키를 지웠습니다.');
  console.log('[FORM3D] 실행 중인 npm run dev 가 있다면 Ctrl+C 로 끄고 다시 실행해야 적용됩니다.');
});
rl.muted = true;
