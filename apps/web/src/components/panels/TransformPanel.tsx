import { useRef, useState } from 'react';
import { Link2, Link2Off, RotateCcw } from 'lucide-react';
import { MathUtils, type Object3D } from 'three';
import {
  CompositeCommand,
  SetTransformCommand,
  applyTransform,
  readTransform,
  transformsEqual,
} from '@form3d/editor-core';
import type { TransformData, Vec3 } from '@form3d/model-types';
import { run } from '../../lib/actions';
import { engine } from '../../state/engine';
import { useAppStore } from '../../state/appStore';
import { NumberField } from '../ui/NumberField';
import { IconButton } from '../ui/Button';
import { Section } from '../ui/Section';

const AXES = ['x', 'y', 'z'] as const;
type Key = keyof TransformData;
const MIN_SCALE = 1e-6;
const RESET: Record<Key, Vec3> = { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] };
const KEY_LABEL: Record<Key, string> = { position: '위치', rotation: '회전', scale: '크기' };

/** 여러 오브젝트의 같은 값이면 그 값, 다르면 null(혼합) */
function common(objects: Object3D[], key: Key, axis: number): number | null {
  const vals = objects.map((o) => readTransform(o)[key][axis]);
  return vals.every((v) => Math.abs(v - vals[0]) < 1e-9) ? vals[0] : null;
}

/** 한 축 값을 바꾼 새 Transform (크기 비율 고정 시 다른 축도 같은 비율로) */
function withValue(t: TransformData, key: Key, axis: number, value: number, uniform: boolean): TransformData {
  const next: TransformData = {
    position: [...t.position] as Vec3,
    rotation: [...t.rotation] as Vec3,
    scale: [...t.scale] as Vec3,
  };
  if (key === 'scale') {
    const v = Math.abs(value) < MIN_SCALE ? MIN_SCALE : value;
    if (uniform) {
      const old = t.scale[axis];
      const ratio = Math.abs(old) < MIN_SCALE ? null : v / old;
      next.scale = ratio === null ? [v, v, v] : (t.scale.map((s) => s * ratio) as Vec3);
    } else next.scale[axis] = v;
  } else {
    next[key][axis] = key === 'rotation' ? MathUtils.degToRad(value) : value;
  }
  return next;
}

/**
 * 정밀 Transform 편집
 * - 숫자/수식 입력, ↑↓ 증감, 축 라벨 드래그(스크럽)
 * - 여러 오브젝트 선택 시 입력한 값이 모두에 적용 (값이 다르면 "—" 표시)
 * - 항목별 초기화, 크기 비율 고정
 */
export function TransformPanel({ objects }: { objects: Object3D[] }) {
  const [uniform, setUniform] = useState(false);
  const scrubBefore = useRef<TransformData[] | null>(null);
  const multi = objects.length > 1;

  const commitAll = (label: string, make: (t: TransformData) => TransformData) => {
    const changes = objects
      .map((o) => {
        const before = readTransform(o);
        return { o, before, after: make(before) };
      })
      .filter((c) => !transformsEqual(c.before, c.after));
    if (changes.length === 0) return;
    const cmds = changes.map((c) => new SetTransformCommand(c.o, c.before, c.after, `${label}: ${c.o.name}`));
    run(cmds.length === 1 ? cmds[0] : new CompositeCommand('SetTransform', `${label}: ${cmds.length}개 오브젝트`, cmds));
  };

  const commit = (key: Key, axis: number, value: number) =>
    commitAll(`Transform ${KEY_LABEL[key]}`, (t) => withValue(t, key, axis, value, uniform && key === 'scale'));

  // 스크럽: 드래그 중에는 직접 반영하고, 끝날 때 명령 1개로 기록
  const scrubStart = () => {
    scrubBefore.current = objects.map(readTransform);
  };
  const scrub = (key: Key, axis: number, value: number) => {
    const before = scrubBefore.current;
    if (!before) return;
    objects.forEach((o, i) => applyTransform(o, withValue(before[i], key, axis, value, uniform && key === 'scale')));
    engine.notify();
  };
  const scrubEnd = (key: Key) => {
    const before = scrubBefore.current;
    scrubBefore.current = null;
    if (!before) return;
    const cmds = objects
      .map((o, i) => ({ o, b: before[i], a: readTransform(o) }))
      .filter((c) => !transformsEqual(c.b, c.a))
      .map((c) => {
        try {
          return new SetTransformCommand(c.o, c.b, c.a, `Transform ${KEY_LABEL[key]}: ${c.o.name}`);
        } catch (err) {
          applyTransform(c.o, c.b);
          useAppStore.getState().log('error', (err as Error).message);
          return null;
        }
      })
      .filter((c): c is SetTransformCommand => !!c);
    if (cmds.length) {
      engine.record(
        cmds.length === 1 ? cmds[0] : new CompositeCommand('SetTransform', `Transform ${KEY_LABEL[key]}: ${cmds.length}개`, cmds),
      );
    } else engine.notify();
  };

  const row = (label: string, key: Key, step: number, toUi = (v: number) => v) => (
    <div className="flex min-h-7 items-center gap-1">
      <span className="w-9 shrink-0 text-[11px] text-muted">{label}</span>
      {AXES.map((a, i) => {
        const v = common(objects, key, i);
        return (
          <NumberField
            key={a}
            axis={a}
            ariaLabel={`${KEY_LABEL[key]} ${a.toUpperCase()}`}
            step={step}
            precision={key === 'rotation' ? 2 : 3}
            value={v === null ? null : toUi(v)}
            onCommit={(val) => commit(key, i, val)}
            onScrubStart={scrubStart}
            onScrub={(val) => scrub(key, i, val)}
            onScrubEnd={() => scrubEnd(key)}
          />
        );
      })}
      <IconButton
        label={`${KEY_LABEL[key]} 초기화`}
        className="!h-6 !w-5 shrink-0"
        onClick={() => commitAll(`${KEY_LABEL[key]} 초기화`, (t) => ({ ...t, [key]: [...RESET[key]] as Vec3 }))}
      >
        <RotateCcw size={11} />
      </IconButton>
    </div>
  );

  return (
    <Section
      title="Transform"
      right={
        multi ? <span className="text-[10px] text-accent">{objects.length}개에 적용</span> : undefined
      }
    >
      <div className="space-y-1">
        {row('위치', 'position', 0.1)}
        {row('회전°', 'rotation', 5, (v) => MathUtils.radToDeg(v))}
        {row('크기', 'scale', 0.1)}
        <div className="flex items-center justify-between pt-0.5">
          <button
            type="button"
            aria-pressed={uniform}
            aria-label="크기 비율 고정"
            onClick={() => setUniform(!uniform)}
            className={
              'inline-flex h-6 items-center gap-1 whitespace-nowrap rounded px-1.5 text-[10px] ' +
              (uniform ? 'bg-accent/20 text-white' : 'text-muted hover:bg-white/5 hover:text-text')
            }
          >
            {uniform ? <Link2 size={11} /> : <Link2Off size={11} />}
            크기 비율 고정
          </button>
          <span
            className="whitespace-nowrap text-[10px] text-muted"
            title="숫자 칸에 1.5*2 같은 수식 입력 가능 · ↑↓ 키로 증감 (Shift ×10) · X/Y/Z 글자를 좌우로 드래그해 조절"
          >
            수식 · ↑↓ · 축 드래그
          </span>
        </div>
      </div>
    </Section>
  );
}
