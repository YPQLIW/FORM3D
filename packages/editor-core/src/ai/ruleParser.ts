import type { CommandStep, CommandTarget, ViewPreset } from '@form3d/model-types';

/**
 * 기본 명령 해석기 (규칙 기반 · AI 아님)
 *
 * 정해진 한국어 표현 패턴을 구조화된 JSON 명령으로 바꿉니다. 외부 AI가 연결되지 않아도 동작하며,
 * 이해하지 못한 문장은 추측하지 않고 "이해하지 못함"으로 돌려줍니다.
 * 결과는 AI가 만든 명령과 똑같이 검증 → 미리보기 → 실행 과정을 거칩니다.
 */

export interface ParseContext {
  /** 씬에 있는 오브젝트 이름들 (이름으로 대상 지정 인식용) */
  names?: string[];
}

export interface ParseResult {
  steps: CommandStep[];
  /** 이해하지 못한 부분 (있으면 실행하지 않음) */
  errors: string[];
}

export const COLOR_WORDS: [RegExp, string, string][] = [
  [/빨간|빨강|붉은|레드|red/i, '#e53935', '빨간색'],
  [/주황|오렌지|orange/i, '#fb8c00', '주황색'],
  [/노란|노랑|옐로|yellow/i, '#fdd835', '노란색'],
  [/연두|라임/i, '#9ccc65', '연두색'],
  [/초록|녹색|그린|green/i, '#43a047', '초록색'],
  [/하늘|스카이/i, '#4fc3f7', '하늘색'],
  [/파란|파랑|청색|블루|blue/i, '#1e88e5', '파란색'],
  [/남색|네이비/i, '#283593', '남색'],
  [/보라|자주|퍼플|purple/i, '#8e24aa', '보라색'],
  [/분홍|핑크|pink/i, '#ec407a', '분홍색'],
  [/갈색|브라운|brown/i, '#795548', '갈색'],
  [/검은|검정|블랙|black/i, '#212121', '검은색'],
  [/흰|하얀|하양|화이트|white/i, '#fafafa', '흰색'],
  [/회색|그레이|gray|grey/i, '#9e9e9e', '회색'],
  [/금색|골드|gold/i, '#d4af37', '금색'],
  [/은색|실버|silver/i, '#c0c0c0', '은색'],
];

const SHAPES: [RegExp, string][] = [
  [/큐브|정육면체|상자|박스|cube|box/i, 'box'],
  [/구체|공|구슬|sphere|ball|(^|\s)구(\s|를|가|$)/i, 'sphere'],
  [/원기둥|실린더|기둥|cylinder/i, 'cylinder'],
  [/원뿔|콘|cone/i, 'cone'],
  [/토러스|도넛|torus|donut/i, 'torus'],
  [/평면|판|바닥판|plane/i, 'plane'],
];

const VIEWS: [RegExp, ViewPreset][] = [
  [/정면|앞(에서|쪽에서|모습)/, 'front'],
  [/뒷면|뒤(에서|쪽에서|모습)/, 'back'],
  [/오른쪽(에서|측면)|우측면/, 'right'],
  [/왼쪽(에서|측면)|좌측면/, 'left'],
  [/위(에서|쪽에서)|상단|탑\s?뷰|top/i, 'top'],
  [/아래(에서|쪽에서)|하단|바닥에서/, 'bottom'],
  [/등각|아이소|iso|대각선/i, 'iso'],
];

const KOR_NUM: Record<string, number> = { 한: 1, 하나: 1, 두: 2, 둘: 2, 세: 3, 셋: 3, 네: 4, 넷: 4, 다섯: 5, 여섯: 6, 일곱: 7, 여덟: 8, 아홉: 9, 열: 10 };

function parseCount(s: string): number | undefined {
  const m = /(\d+)\s*개/.exec(s);
  if (m) return Number(m[1]);
  const k = /(한|하나|두|둘|세|셋|네|넷|다섯|여섯|일곱|여덟|아홉|열)\s*개/.exec(s);
  return k ? KOR_NUM[k[1]] : undefined;
}

function firstNumber(s: string): number | undefined {
  const m = /(-?\d+(?:\.\d+)?)/.exec(s);
  return m ? Number(m[1]) : undefined;
}

function findColor(s: string): [string, string] | undefined {
  const hex = /#[0-9a-fA-F]{6}\b/.exec(s);
  if (hex) return [hex[0].toLowerCase(), hex[0]];
  for (const [re, c, label] of COLOR_WORDS) if (re.test(s)) return [c, label];
  return undefined;
}

/** 문장을 단계별 절로 나눔: "큐브 만들고 파란색으로 바꿔 줘" → ["큐브 만들", "파란색으로 바꿔 줘"] */
export function splitClauses(text: string): string[] {
  return text
    .replace(/\r?\n/g, ' . ')
    .split(/\s*(?:[;!?]|(?<!\d)\.|\.(?!\d)|,(?!\s*-?\d)|그리고|그 ?다음(?:에)?|그런 ?다음|그 ?후(?:에)?|다음에|한 ?뒤(?:에)?|한 ?후(?:에)?|(?<=[가-힣])\s(?:다음|후|뒤)(?:에|에는)?(?=\s)|(?<=[가-힣])고\s)\s*/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function targetFor(clause: string, ctx: ParseContext, createdBefore: boolean): CommandTarget {
  if (/모든|전체|전부|모두|다\s/.test(clause)) return 'all';
  const named = (ctx.names ?? [])
    .filter((n) => n.length >= 2)
    .sort((a, b) => b.length - a.length)
    .filter((n) => new RegExp(`(^|[\\s"'“‘])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[\\s"'”’을를이가의에])`, 'i').test(clause));
  if (named.length) return { names: [named[0]] };
  if (/선택(한|된|된 것|한 것)/.test(clause)) return 'selection';
  if (createdBefore || /방금|그것|그거|이것|만든/.test(clause)) return createdBefore ? 'created' : 'selection';
  return 'selection';
}

function parseClause(clause: string, ctx: ParseContext, createdBefore: boolean): CommandStep[] | null {
  const c = clause.replace(/\s+/g, ' ');
  const target = () => targetFor(c, ctx, createdBefore);

  // 선택 해제
  if (/선택\s?(을\s)?(해제|취소|풀)/.test(c)) return [{ command: 'clear_selection', params: {} }];

  // 그룹 해제 (그룹보다 먼저 검사)
  if (/그룹.*(해제|풀|나눠)|언그룹|ungroup/i.test(c)) return [{ command: 'ungroup', params: { target: target() } }];
  // 그룹
  if (/그룹|묶어|묶기|group/i.test(c)) {
    const name = /["'“‘]([^"'”’]+)["'”’]/.exec(c)?.[1];
    return [{ command: 'group', params: { target: target(), ...(name ? { name } : {}) } }];
  }

  // 시점
  if (/시점|뷰|카메라|보여|에서 봐|에서 보기|에서 보이게/.test(c)) {
    if (/맞춰|포커스|가득|전체.*보|확대해서/.test(c) && !VIEWS.some(([re]) => re.test(c))) {
      return [{ command: 'frame', params: {} }];
    }
    for (const [re, preset] of VIEWS) if (re.test(c)) return [{ command: 'set_view', params: { preset } }];
  }
  if (/화면.*맞춰|포커스/.test(c)) return [{ command: 'frame', params: {} }];

  // 생성
  if (/만들|생성|추가|넣어|놓아|create|add/i.test(c)) {
    const shape = SHAPES.find(([re]) => re.test(c))?.[1];
    if (shape) {
      const params: Record<string, unknown> = { shape };
      const count = parseCount(c);
      if (count && count > 1) params.count = Math.min(count, 20);
      const color = findColor(c);
      if (color) params.color = color[0];
      return [{ command: 'create_primitive', params }];
    }
  }

  // 복제
  if (/복제|복사|duplicate|copy/i.test(c)) {
    const count = parseCount(c) ?? (/(\d+)\s*(번|회)/.exec(c) ? Number(/(\d+)\s*(번|회)/.exec(c)![1]) : undefined);
    return [{ command: 'duplicate', params: { target: target(), ...(count && count > 1 ? { count: Math.min(count, 20) } : {}) } }];
  }

  // 삭제
  if (/삭제|지워|지우|제거|없애|delete|remove/i.test(c)) return [{ command: 'delete', params: { target: target() } }];

  // 이름 변경
  const rename = /이름(을|를)?\s*["'“‘]?([^"'”’]+?)["'”’]?\s*(으로|로)\s*(바꿔|변경|해)/.exec(c);
  if (rename) return [{ command: 'rename', params: { target: target(), name: rename[2].trim() } }];

  // 숨기기 / 보이기
  if (/숨겨|숨기|안 보이게|감춰/.test(c)) return [{ command: 'set_visibility', params: { target: target(), visible: false } }];
  if (/보이게|다시 보여|표시해/.test(c)) return [{ command: 'set_visibility', params: { target: target(), visible: true } }];

  // 바닥 / 정렬 / 분배
  if (/바닥(에|으로).*(놓|내려|붙)/.test(c)) return [{ command: 'drop_to_floor', params: { target: target() } }];
  if (/간격|분배|일렬|나란히/.test(c)) {
    const axis = /y\s?축|세로|위아래/i.test(c) ? 'y' : /z\s?축|앞뒤/i.test(c) ? 'z' : 'x';
    return [{ command: 'distribute', params: { target: target(), axis } }];
  }
  if (/정렬|맞춰/.test(c) && /왼쪽|오른쪽|위|아래|가운데|중앙|앞|뒤|x|y|z/i.test(c)) {
    let axis = /y\s?축|위|아래|높이/i.test(c) ? 'y' : /z\s?축|앞|뒤/i.test(c) ? 'z' : 'x';
    let mode: 'min' | 'center' | 'max' = 'center';
    if (/왼쪽|아래|뒤|최소/.test(c)) mode = 'min';
    if (/오른쪽|위|앞|최대/.test(c)) mode = 'max';
    if (/가운데|중앙/.test(c)) mode = 'center';
    if (/x\s?축/i.test(c)) axis = 'x';
    return [{ command: 'align', params: { target: target(), axis, mode } }];
  }

  // 이동
  if (/이동|옮겨|옮기|옮긴|움직|밀어|올려|올리|올린|내려|내리|내린/.test(c)) {
    const abs = /\(?\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)?/.exec(c);
    if (abs && /위치|좌표|로 이동|으로 이동/.test(c)) {
      return [{ command: 'transform', params: { target: target(), position: [Number(abs[1]), Number(abs[2]), Number(abs[3])] } }];
    }
    const n = firstNumber(c) ?? 1;
    const v: [number, number, number] = [0, 0, 0];
    if (/오른쪽|우측|x\s?축/i.test(c) && !/왼쪽/.test(c)) v[0] = n;
    if (/왼쪽|좌측/.test(c)) v[0] = -n;
    if (/위로|위쪽|올려|올리|올린|y\s?축/i.test(c)) v[1] = n;
    if (/아래로|아래쪽|내려|내리|내린/.test(c)) v[1] = -n;
    if (/앞으로|앞쪽|z\s?축/i.test(c)) v[2] = n;
    if (/뒤로|뒤쪽/.test(c)) v[2] = -n;
    if (v.every((x) => x === 0)) return null;
    return [{ command: 'transform', params: { target: target(), translate: v } }];
  }

  // 회전
  if (/회전|돌려|돌리/.test(c)) {
    const n = firstNumber(c) ?? 90;
    const axis = /x\s?축/i.test(c) ? 0 : /z\s?축/i.test(c) ? 2 : 1;
    const sign = /반대|시계 방향|오른쪽으로/.test(c) && !/반시계/.test(c) ? -1 : 1;
    const v: [number, number, number] = [0, 0, 0];
    v[axis] = sign * n;
    return [{ command: 'transform', params: { target: target(), rotate_deg: v } }];
  }

  // 크기
  if (/크게|키워|확대|작게|줄여|축소|크기|배/.test(c)) {
    const m = /(\d+(?:\.\d+)?)\s*배/.exec(c);
    let f = m ? Number(m[1]) : /절반|반으로/.test(c) ? 0.5 : 2;
    if (/작게|줄여|축소/.test(c) && f > 1) f = 1 / f;
    if (/크기(를|가)?\s*(\d+(?:\.\d+)?)\s*(으로|로)/.test(c)) {
      const s = Number(/크기(를|가)?\s*(\d+(?:\.\d+)?)/.exec(c)![2]);
      return [{ command: 'transform', params: { target: target(), scale: [s, s, s] } }];
    }
    return [{ command: 'transform', params: { target: target(), scale_by: Math.round(f * 1e6) / 1e6 } }];
  }

  // 재질
  const color = findColor(c);
  const mat: Record<string, unknown> = {};
  if (color && /색|칠|바꿔|변경|으로|로|만들어/.test(c)) mat.color = color[0];
  if (/금속|메탈|metal/i.test(c)) {
    mat.metalness = /금속.*(아니|빼|없애)|비금속/.test(c) ? 0 : 1;
    if (mat.metalness === 1) mat.roughness = 0.3;
  }
  if (/반짝|광택|매끈|매끄럽/.test(c)) mat.roughness = 0.1;
  if (/거칠|무광|매트/.test(c)) mat.roughness = 0.9;
  if (Object.keys(mat).length) return [{ command: 'set_material', params: { target: target(), ...mat } }];

  // 선택
  if (/선택|골라|select/i.test(c)) {
    const t = targetFor(c, ctx, false);
    if (t === 'selection') return null;
    return [{ command: 'select', params: { target: t } }];
  }

  return null;
}

/** 자연어 문장 → JSON 명령 단계 목록 */
export function parseRules(text: string, ctx: ParseContext = {}): ParseResult {
  const steps: CommandStep[] = [];
  const errors: string[] = [];
  const clauses = splitClauses(text.replace(/(해\s?줘|해\s?주세요|해\s?줄래|해라|하세요|주세요|줘|좀)/g, ' '));
  if (!clauses.length) return { steps, errors: ['명령을 입력해 주세요.'] };
  for (const clause of clauses) {
    const createdBefore = steps.some((s) => s.command === 'create_primitive' || s.command === 'duplicate');
    const r = parseClause(clause, ctx, createdBefore);
    if (r) steps.push(...r);
    else errors.push(`이해하지 못한 부분: “${clause}”`);
  }
  return { steps, errors };
}
