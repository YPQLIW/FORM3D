/** FORM3D 전역 상수 및 범용 유틸리티 */

export const APP_NAME = 'FORM3D';
export const APP_VERSION = '0.4.6';

/** 모델 파일 업로드 최대 크기 (바이트). 브라우저 메모리 보호용. */
export const MAX_MODEL_FILE_BYTES = 200 * 1024 * 1024;

/** 불러오기를 지원하는 메인 모델 확장자 (Phase 2: OBJ 추가) */
export const SUPPORTED_IMPORT_EXTENSIONS = ['.glb', '.gltf', '.obj'] as const;

/** .gltf와 함께 선택할 수 있는 부가 리소스 확장자 */
export const GLTF_RESOURCE_EXTENSIONS = [
  '.bin',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.ktx2',
] as const;

/** .obj와 함께 선택할 수 있는 부가 리소스 확장자 (재질 .mtl + 텍스처 이미지) */
export const OBJ_RESOURCE_EXTENSIONS = ['.mtl', '.png', '.jpg', '.jpeg', '.webp', '.bmp'] as const;

export function getExtension(fileName: string): string {
  const i = fileName.lastIndexOf('.');
  return i < 0 ? '' : fileName.slice(i).toLowerCase();
}

export function stripExtension(fileName: string): string {
  const i = fileName.lastIndexOf('.');
  return i <= 0 ? fileName : fileName.slice(0, i);
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '-';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = bytes;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v.toFixed(u === 0 ? 0 : 1)} ${units[u]}`;
}

export function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}

/** 파일 이름으로 쓸 수 있도록 위험 문자를 제거 */
export function sanitizeFileName(name: string, fallback = 'form3d-scene'): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '')
    .trim()
    .slice(0, 120);
  return cleaned.length > 0 ? cleaned : fallback;
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

export class Form3DError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'Form3DError';
  }
}

/**
 * 숫자 입력란용 안전한 수식 계산기 (eval 사용 안 함).
 * 지원: + - * / ( ) 소수, 단항 부호. 예) "1.5*2", "(3+1)/4", "-2"
 * 해석할 수 없으면 null을 반환합니다.
 */
export function evaluateExpression(input: string): number | null {
  const src = input.replace(/\s+/g, '').replace(/,/g, '.');
  if (src.length === 0 || src.length > 200) return null;
  let i = 0;
  const peek = () => src[i];
  const parseNumber = (): number | null => {
    const m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(src.slice(i));
    if (!m) return null;
    i += m[0].length;
    return Number(m[0]);
  };
  const parseFactor = (): number | null => {
    const c = peek();
    if (c === '+' || c === '-') {
      i++;
      const v = parseFactor();
      return v === null ? null : c === '-' ? -v : v;
    }
    if (c === '(') {
      i++;
      const v = parseExpr();
      if (v === null || peek() !== ')') return null;
      i++;
      return v;
    }
    return parseNumber();
  };
  const parseTerm = (): number | null => {
    let v = parseFactor();
    while (v !== null && (peek() === '*' || peek() === '/')) {
      const op = src[i++];
      const r = parseFactor();
      if (r === null) return null;
      v = op === '*' ? v * r : v / r;
    }
    return v;
  };
  const parseExpr = (): number | null => {
    let v = parseTerm();
    while (v !== null && (peek() === '+' || peek() === '-')) {
      const op = src[i++];
      const r = parseTerm();
      if (r === null) return null;
      v = op === '+' ? v + r : v - r;
    }
    return v;
  };
  const result = parseExpr();
  if (result === null || i !== src.length || !Number.isFinite(result)) return null;
  return result;
}
