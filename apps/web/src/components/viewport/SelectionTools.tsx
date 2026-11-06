import { useMemo, useRef, type MutableRefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import { TransformControls } from '@react-three/drei';
import { BoxHelper, Color, Euler, Group, MathUtils, Matrix4, Object3D, Quaternion, Vector3 } from 'three';
import {
  CompositeCommand,
  SetTransformCommand,
  readTransform,
  transformsEqual,
} from '@form3d/editor-core';
import type { TransformData } from '@form3d/model-types';
import { engine, useEngineRevision } from '../../state/engine';
import { isSnapActive, useAppStore } from '../../state/appStore';

const MODE_LABEL = { translate: '이동', rotate: '회전', scale: '크기' } as const;
const ACTIVE_COLOR = new Color('#8b5cf6');
const OTHER_COLOR = new Color('#4f7cff');

const fmt = (v: number, d = 3) => {
  const s = v.toFixed(d).replace(/\.?0+$/, '');
  return s === '-0' ? '0' : s;
};

interface DragState {
  /** 드래그 시작 시점의 기즈모 대상(단일 오브젝트 또는 피벗) 상태 */
  startPos: Vector3;
  startQuat: Quaternion;
  startScale: Vector3;
  startPivotWorld: Matrix4;
  items: { object: Object3D; before: TransformData; startWorld: Matrix4 }[];
}

/**
 * 선택 표시(BoxHelper)와 Transform Controls(이동/회전/크기)
 * - 단일 선택: 오브젝트에 직접 기즈모 연결 (Phase 1과 동일)
 * - 다중 선택: 선택 중심의 피벗에 기즈모를 달고, 피벗 변화량을 모든 오브젝트에 적용 → Undo 1회
 * - 스냅: 이동/회전/크기 단위 스냅, Ctrl을 누른 채 드래그하면 스냅 일시 전환
 */
export function SelectionTools({ gizmoBusy }: { gizmoBusy: MutableRefObject<boolean> }) {
  useEngineRevision();
  const objects = engine.getTopLevelSelection();
  const mode = useAppStore((s) => s.transformMode);
  const space = useAppStore((s) => s.transformSpace);
  const snap = useAppStore((s) => s.snap);
  const snapOn = useAppStore(isSnapActive);
  const drag = useRef<DragState | null>(null);

  const helpers = useMemo(() => new Group(), []);
  const pivot = useMemo(() => {
    const p = new Object3D();
    p.name = '__form3d_pivot__';
    return p;
  }, []);

  const multi = objects.length > 1;
  const target: Object3D | null = multi ? pivot : (objects[0] ?? null);

  // 다중 선택 피벗을 선택 중심에 배치 (드래그 중에는 고정)
  if (multi && !drag.current) {
    const center = engine.getUnionBounds(objects)?.getCenter(new Vector3()) ?? new Vector3();
    pivot.position.copy(center);
    pivot.quaternion.identity();
    pivot.scale.set(1, 1, 1);
    pivot.updateMatrixWorld(true);
  }

  useFrame(() => {
    const sel = engine.getSelectedObjects();
    const activeObj = engine.getSelected();
    while (helpers.children.length < sel.length) {
      const h = new BoxHelper(new Object3D(), ACTIVE_COLOR.clone());
      h.raycast = () => {};
      h.renderOrder = 999;
      helpers.add(h);
    }
    helpers.children.forEach((child, i) => {
      const h = child as BoxHelper;
      const o = sel[i];
      h.visible = !!o && o.visible;
      if (!o) return;
      h.setFromObject(o);
      (h.material as { color: Color }).color.copy(o === activeObj ? ACTIVE_COLOR : OTHER_COLOR);
    });
  });

  const updateReadout = () => {
    const d = drag.current;
    if (!d || !target) return;
    const set = useAppStore.getState().setDragReadout;
    if (mode === 'translate') {
      const delta = target.position.clone().sub(d.startPos);
      set(`이동 Δ  X ${fmt(delta.x)}  Y ${fmt(delta.y)}  Z ${fmt(delta.z)}`);
    } else if (mode === 'rotate') {
      const q = d.startQuat.clone().invert().multiply(target.quaternion);
      const e = new Euler().setFromQuaternion(q);
      const angle = MathUtils.radToDeg(2 * Math.acos(Math.min(1, Math.abs(q.w))));
      set(
        `회전 ${fmt(angle, 1)}°  (X ${fmt(MathUtils.radToDeg(e.x), 1)}°  Y ${fmt(MathUtils.radToDeg(e.y), 1)}°  Z ${fmt(MathUtils.radToDeg(e.z), 1)}°)`,
      );
    } else {
      const r = target.scale.clone().divide(d.startScale);
      set(`크기 ×  X ${fmt(r.x)}  Y ${fmt(r.y)}  Z ${fmt(r.z)}`);
    }
  };

  const onChange = () => {
    const d = drag.current;
    if (d && multi) {
      // 피벗의 변화량(델타 행렬)을 각 오브젝트의 시작 월드 행렬에 적용
      pivot.updateMatrixWorld(true);
      const delta = new Matrix4().multiplyMatrices(pivot.matrixWorld, d.startPivotWorld.clone().invert());
      const local = new Matrix4();
      for (const it of d.items) {
        const world = new Matrix4().multiplyMatrices(delta, it.startWorld);
        const parent = it.object.parent;
        if (parent) {
          parent.updateWorldMatrix(true, false);
          local.copy(parent.matrixWorld).invert().multiply(world);
        } else local.copy(world);
        local.decompose(it.object.position, it.object.quaternion, it.object.scale);
        it.object.updateMatrixWorld(true);
      }
    }
    updateReadout();
    engine.notify();
  };

  return (
    <>
      <primitive object={helpers} />
      <primitive object={pivot} />
      {target && (
        <TransformControls
          object={target}
          mode={mode}
          space={multi ? 'world' : space}
          size={0.8}
          translationSnap={snapOn ? snap.translate : null}
          rotationSnap={snapOn ? MathUtils.degToRad(snap.rotateDeg) : null}
          scaleSnap={snapOn ? snap.scale : null}
          onMouseDown={() => {
            gizmoBusy.current = true;
            target.updateMatrixWorld(true);
            drag.current = {
              startPos: target.position.clone(),
              startQuat: target.quaternion.clone(),
              startScale: target.scale.clone(),
              startPivotWorld: target.matrixWorld.clone(),
              items: objects.map((object) => {
                object.updateWorldMatrix(true, false);
                return { object, before: readTransform(object), startWorld: object.matrixWorld.clone() };
              }),
            };
          }}
          onObjectChange={onChange}
          onMouseUp={() => {
            // click 이벤트가 끝난 뒤 해제하여 기즈모 클릭이 선택 해제로 처리되지 않게 함
            setTimeout(() => (gizmoBusy.current = false), 0);
            useAppStore.getState().setDragReadout(null);
            const d = drag.current;
            drag.current = null;
            if (!d) return;
            const changed = d.items
              .filter((it) => engine.isInScene(it.object))
              .map((it) => ({ object: it.object, before: it.before, after: readTransform(it.object) }))
              .filter((c) => !transformsEqual(c.before, c.after));
            if (changed.length === 0) return;
            try {
              const label = MODE_LABEL[mode];
              const cmds = changed.map((c) => new SetTransformCommand(c.object, c.before, c.after, `${label}: ${c.object.name}`));
              engine.record(
                cmds.length === 1
                  ? cmds[0]
                  : new CompositeCommand('SetTransform', `${label}: ${cmds.length}개 오브젝트`, cmds),
              );
            } catch (err) {
              useAppStore.getState().log('error', `Transform 실패: ${(err as Error).message}`);
            }
          }}
        />
      )}
    </>
  );
}
