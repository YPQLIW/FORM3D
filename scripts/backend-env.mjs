// 로컬 서버(backend) 관련 공통 경로 도우미
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const BACKEND = join(ROOT, 'backend');
export const VENV = join(BACKEND, '.venv');
export const IS_WIN = process.platform === 'win32';
export const VENV_PY = IS_WIN ? join(VENV, 'Scripts', 'python.exe') : join(VENV, 'bin', 'python');
export const hasVenv = () => existsSync(VENV_PY);
