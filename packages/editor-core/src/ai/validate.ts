import { COMMAND_MANIFEST, type CommandJob, type CommandStep, type ParamSpec } from '@form3d/model-types';

/**
 * JSON 명령 유효성 검사.
 * - 등록되지 않은 명령/파라미터, 타입·범위 오류를 모두 찾아 사람이 읽을 수 있는 이유로 돌려줍니다.
 * - 검사를 통과하지 못한 작업은 절대 실행하지 않습니다.
 * - 코드 실행 경로가 없도록 명령 이름은 commands.json의 목록으로만 제한합니다.
 */

const HEX = /^#[0-9a-fA-F]{6}$/;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isVec3 = (v: unknown): v is [number, number, number] => Array.isArray(v) && v.length === 3 && v.every(isNum);

/** 명령 이름 검사용 (prototype 키 등 차단) */
export function isKnownCommand(name: unknown): name is string {
  return typeof name === 'string' && Object.prototype.hasOwnProperty.call(COMMAND_MANIFEST.commands, name);
}

function checkTarget(v: unknown): string | null {
  if (v === 'selection' || v === 'all' || v === 'created') return null;
  if (isObj(v)) {
    const keys = Object.keys(v);
    if (keys.length === 1 && (keys[0] === 'names' || keys[0] === 'ids')) {
      const list = v[keys[0]];
      if (Array.isArray(list) && list.length > 0 && list.length <= 200 && list.every((x) => typeof x === 'string' && x.length <= 200)) {
        return null;
      }
      return `${keys[0]}는 1~200개의 문자열 목록이어야 합니다`;
    }
  }
  return 'target은 "selection" | "all" | "created" | {"names":[...]} | {"ids":[...]} 중 하나여야 합니다';
}

function checkParam(name: string, spec: ParamSpec, v: unknown): string | null {
  switch (spec.type) {
    case 'enum':
      return typeof v === 'string' && spec.values!.includes(v) ? null : `${name}은(는) ${spec.values!.join(' / ')} 중 하나여야 합니다`;
    case 'integer':
      if (!Number.isInteger(v)) return `${name}은(는) 정수여야 합니다`;
      break;
    case 'number':
      if (!isNum(v)) return `${name}은(는) 숫자여야 합니다`;
      break;
    case 'string':
      if (typeof v !== 'string' || v.trim() === '') return `${name}은(는) 비어 있지 않은 문자열이어야 합니다`;
      if (spec.maxLength && v.length > spec.maxLength) return `${name}은(는) ${spec.maxLength}자 이하여야 합니다`;
      return null;
    case 'boolean':
      return typeof v === 'boolean' ? null : `${name}은(는) true/false여야 합니다`;
    case 'vec3':
      if (!isVec3(v)) return `${name}은(는) [x, y, z] 숫자 3개여야 합니다`;
      return v.every((x) => Math.abs(x) <= 1e6) ? null : `${name} 값이 너무 큽니다`;
    case 'scale':
      if (isNum(v)) return v > 0 && v <= 1000 ? null : `${name}은(는) 0보다 크고 1000 이하여야 합니다`;
      if (isVec3(v)) return v.every((x) => x > 0 && x <= 1000) ? null : `${name}의 각 값은 0보다 크고 1000 이하여야 합니다`;
      return `${name}은(는) 양수 또는 [x, y, z]여야 합니다`;
    case 'color':
      return typeof v === 'string' && HEX.test(v) ? null : `${name}은(는) #rrggbb 형식 색상이어야 합니다`;
    case 'target':
      return checkTarget(v);
  }
  const n = v as number;
  if (spec.min !== undefined && n < spec.min) return `${name}은(는) ${spec.min} 이상이어야 합니다`;
  if (spec.max !== undefined && n > spec.max) return `${name}은(는) ${spec.max} 이하여야 합니다`;
  return null;
}

export function validateStep(step: unknown, index = 0): string[] {
  const where = `${index + 1}단계`;
  if (!isObj(step)) return [`${where}: 명령은 객체여야 합니다`];
  const extra = Object.keys(step).filter((k) => k !== 'command' && k !== 'params');
  if (extra.length) return [`${where}: 알 수 없는 필드 ${extra.join(', ')}`];
  if (!isKnownCommand(step.command)) return [`${where}: 지원하지 않는 명령 "${String(step.command)}"`];
  const spec = COMMAND_MANIFEST.commands[step.command];
  const params = step.params ?? {};
  if (!isObj(params)) return [`${where} ${step.command}: params는 객체여야 합니다`];
  const errors: string[] = [];
  for (const key of Object.keys(params)) {
    if (!Object.prototype.hasOwnProperty.call(spec.params, key)) {
      errors.push(`${where} ${step.command}: 알 수 없는 파라미터 "${key}"`);
      continue;
    }
    const e = checkParam(key, spec.params[key], params[key]);
    if (e) errors.push(`${where} ${step.command}: ${e}`);
  }
  for (const [key, p] of Object.entries(spec.params)) {
    if (p.required && params[key] === undefined) errors.push(`${where} ${step.command}: "${key}"가 필요합니다`);
  }
  if (step.command === 'transform' && !['translate', 'position', 'rotate_deg', 'rotation_deg', 'scale_by', 'scale'].some((k) => params[k] !== undefined)) {
    errors.push(`${where} transform: 바꿀 값(translate, position, rotate_deg 등)이 하나도 없습니다`);
  }
  if (step.command === 'set_material' && !['color', 'metalness', 'roughness'].some((k) => params[k] !== undefined)) {
    errors.push(`${where} set_material: 바꿀 값(color, metalness, roughness)이 없습니다`);
  }
  return errors;
}

/** 작업 전체 검사. 오류가 없으면 빈 배열 */
export function validateJob(job: unknown): string[] {
  if (!isObj(job)) return ['작업은 객체여야 합니다'];
  if (typeof job.id !== 'string' || !/^job_[A-Za-z0-9_-]{4,64}$/.test(job.id)) return ['작업 ID 형식이 올바르지 않습니다 (job_...)'];
  if (!Array.isArray(job.steps) || job.steps.length === 0) return ['실행할 단계가 없습니다'];
  if (job.steps.length > COMMAND_MANIFEST.limits.maxStepsPerJob) {
    return [`한 작업은 최대 ${COMMAND_MANIFEST.limits.maxStepsPerJob}단계까지 가능합니다`];
  }
  return (job.steps as unknown[]).flatMap((s, i) => validateStep(s, i));
}

let seq = 0;
/** 고유 작업 ID 생성 */
export function newJobId(): string {
  seq = (seq + 1) % 1e6;
  const rand = Math.random().toString(36).slice(2, 8);
  return `job_${Date.now().toString(36)}_${seq.toString(36)}${rand}`;
}

export function makeJob(steps: CommandStep[], source: CommandJob['source'], request?: string, summary?: string): CommandJob {
  return { id: newJobId(), source, request, summary, steps };
}
