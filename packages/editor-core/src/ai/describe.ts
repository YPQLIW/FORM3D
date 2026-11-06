import type { CommandStep } from '@form3d/model-types';

/** 명령 한 단계를 사람이 읽을 수 있는 한국어로 (미리보기용) */
const SHAPES: Record<string, string> = { box: '큐브', sphere: '구', cylinder: '원기둥', cone: '원뿔', torus: '토러스', plane: '평면' };
const VIEWS: Record<string, string> = { front: '정면', back: '후면', right: '오른쪽', left: '왼쪽', top: '상단', bottom: '하단', iso: '등각' };
const MODES: Record<string, string> = { min: '최소', center: '가운데', max: '최대' };

export function describeTarget(t: unknown): string {
  if (t === undefined || t === 'selection') return '선택한 오브젝트';
  if (t === 'all') return '모든 오브젝트';
  if (t === 'created') return '방금 만든 오브젝트';
  if (t && typeof t === 'object') {
    const o = t as { names?: string[]; ids?: string[] };
    if (o.names) return o.names.map((n) => `"${n}"`).join(', ');
    if (o.ids) return `ID ${o.ids.map((i) => i.slice(0, 8)).join(', ')}`;
  }
  return String(t);
}

const v3 = (v: unknown) => (Array.isArray(v) ? `(${v.join(', ')})` : String(v));

export function describeStep(step: CommandStep): string {
  const p = step.params ?? {};
  const target = describeTarget(p.target);
  switch (step.command) {
    case 'create_primitive': {
      const parts = [`${SHAPES[p.shape as string] ?? p.shape} ${p.count ?? 1}개 만들기`];
      if (p.name) parts.push(`이름 "${p.name}"`);
      if (p.position) parts.push(`위치 ${v3(p.position)}`);
      if (p.color) parts.push(`색 ${p.color}`);
      return parts.join(' · ');
    }
    case 'select':
      return `${target} 선택`;
    case 'clear_selection':
      return '선택 해제';
    case 'transform': {
      const parts: string[] = [];
      if (p.translate) parts.push(`이동 ${v3(p.translate)}`);
      if (p.position) parts.push(`위치를 ${v3(p.position)}로`);
      if (p.rotate_deg) parts.push(`회전 ${v3(p.rotate_deg)}°`);
      if (p.rotation_deg) parts.push(`회전을 ${v3(p.rotation_deg)}°로`);
      if (p.scale_by !== undefined) parts.push(`크기 ×${v3(p.scale_by)}`);
      if (p.scale) parts.push(`크기를 ${v3(p.scale)}로`);
      return `${target}: ${parts.join(', ')}`;
    }
    case 'set_material': {
      const parts: string[] = [];
      if (p.color) parts.push(`색 ${p.color}`);
      if (p.metalness !== undefined) parts.push(`금속성 ${p.metalness}`);
      if (p.roughness !== undefined) parts.push(`거칠기 ${p.roughness}`);
      return `${target} 재질: ${parts.join(', ')}`;
    }
    case 'duplicate':
      return `${target} 복제${p.count && p.count !== 1 ? ` ×${p.count}` : ''}`;
    case 'group':
      return `${target}을(를) 그룹으로 묶기${p.name ? ` ("${p.name}")` : ''}`;
    case 'ungroup':
      return `${target} 그룹 해제`;
    case 'delete':
      return `${target} 삭제`;
    case 'rename':
      return `${target} 이름을 "${p.name}"(으)로`;
    case 'set_visibility':
      return `${target} ${p.visible ? '보이기' : '숨기기'}`;
    case 'align':
      return `${target} ${String(p.axis).toUpperCase()}축 ${MODES[p.mode as string] ?? p.mode} 정렬`;
    case 'distribute':
      return `${target} ${String(p.axis).toUpperCase()}축 같은 간격 배치`;
    case 'drop_to_floor':
      return `${target} 바닥에 붙이기`;
    case 'set_view':
      return `카메라 ${VIEWS[p.preset as string] ?? p.preset} 시점`;
    case 'frame':
      return p.target ? `${target}에 카메라 맞추기` : '카메라를 전체에 맞추기';
    default:
      return step.command;
  }
}
