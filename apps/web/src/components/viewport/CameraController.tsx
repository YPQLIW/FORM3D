import { getCameraState, viewport } from '../../lib/viewport';
import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { PerspectiveCamera, Quaternion, Sphere, Vector3 } from 'three';
import type { ViewPreset } from '@form3d/model-types';
import { engine } from '../../state/engine';
import { useAppStore } from '../../state/appStore';

interface ControlsLike {
  target: Vector3;
  update: () => void;
}

/** 시점 프리셋별 "대상 → 카메라" 방향 (Y-up, 정면 = +Z 방향에서 바라봄) */
export const VIEW_DIRECTIONS: Record<ViewPreset, [number, number, number]> = {
  front: [0, 0, 1],
  back: [0, 0, -1],
  right: [1, 0, 0],
  left: [-1, 0, 0],
  // 정확히 수직이면 궤도 회전 기준(up)과 겹쳐 회전이 불안정해지므로 아주 약간 기울임
  top: [0, 1, 1e-4],
  bottom: [0, -1, 1e-4],
  iso: [1, 1, 1],
};

export const VIEW_LABELS: Record<ViewPreset, string> = {
  front: '정면',
  back: '뒷면',
  right: '오른쪽',
  left: '왼쪽',
  top: '위',
  bottom: '아래',
  iso: '등각',
};

const ANIM_MS = 280;

interface Anim {
  fromPos: Vector3;
  toPos: Vector3;
  fromTarget: Vector3;
  toTarget: Vector3;
  start: number;
}

/**
 * 카메라 제어
 * - frameRequest(F): 선택 대상(없으면 씬 전체)에 맞추기
 * - viewRequest: 시점 프리셋(정면/측면/상단/등각 …). 현재 궤도 중심과 거리는 유지
 * 두 동작 모두 짧은 애니메이션으로 이동합니다.
 */
export function CameraController() {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as ControlsLike | null;
  const gl = useThree((s) => s.gl);
  const frameRequest = useAppStore((s) => s.frameRequest);
  const viewRequest = useAppStore((s) => s.viewRequest);
  const anim = useRef<Anim | null>(null);

  // 테스트/디버그용으로 카메라 노출 (엔진과 같은 방식)
  useEffect(() => {
    (window as unknown as { __FORM3D_VIEW__: unknown }).__FORM3D_VIEW__ = { camera, controls };
    viewport.camera = camera;
    viewport.controls = controls;
    viewport.gl = gl;
    if (!viewport.initial) viewport.initial = getCameraState();
  }, [camera, controls, gl]);

  const startAnim = (toPos: Vector3, toTarget: Vector3) => {
    if (!controls) return;
    anim.current = {
      fromPos: camera.position.clone(),
      toPos,
      fromTarget: controls.target.clone(),
      toTarget,
      start: performance.now(),
    };
  };

  const fitClipping = (distance: number) => {
    if (camera instanceof PerspectiveCamera) {
      camera.near = Math.max(distance / 1000, 0.001);
      camera.far = Math.max(distance * 100, 1000);
      camera.updateProjectionMatrix();
    }
  };

  useEffect(() => {
    if (frameRequest === 0 || !controls) return;
    const sel = engine.getTopLevelSelection();
    const box = sel.length ? engine.getUnionBounds(sel) : engine.getWorldBounds(engine.root);
    if (!box) return;
    const sphere = box.getBoundingSphere(new Sphere());
    const radius = Math.max(sphere.radius, 0.01);
    const fov = camera instanceof PerspectiveCamera ? camera.fov : 50;
    const distance = (radius / Math.sin((fov * Math.PI) / 360)) * 1.15;
    const dir = camera.position.clone().sub(controls.target).normalize();
    if (dir.lengthSq() === 0) dir.set(1, 0.6, 1).normalize();
    fitClipping(distance);
    startAnim(sphere.center.clone().addScaledVector(dir, distance), sphere.center.clone());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameRequest, camera, controls]);

  useEffect(() => {
    if (!viewRequest || !controls) return;
    const target = controls.target.clone();
    const distance = Math.max(camera.position.distanceTo(target), 0.05);
    const dir = new Vector3(...VIEW_DIRECTIONS[viewRequest.preset]).normalize();
    startAnim(target.clone().addScaledVector(dir, distance), target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewRequest, camera, controls]);

  useFrame(() => {
    const a = anim.current;
    if (!a || !controls) return;
    const t = Math.min(1, (performance.now() - a.start) / ANIM_MS);
    const k = 1 - Math.pow(1 - t, 3); // ease-out
    // 방향은 구면 보간으로 돌려 대상 주위를 자연스럽게 회전
    const fromOff = a.fromPos.clone().sub(a.fromTarget);
    const toOff = a.toPos.clone().sub(a.toTarget);
    const len = fromOff.length() + (toOff.length() - fromOff.length()) * k;
    const fromDir = fromOff.normalize();
    const full = new Quaternion().setFromUnitVectors(fromDir, toOff.normalize());
    const dir = fromDir.clone().applyQuaternion(new Quaternion().slerp(full, k));
    controls.target.lerpVectors(a.fromTarget, a.toTarget, k);
    camera.position.copy(controls.target).addScaledVector(dir, len);
    camera.lookAt(controls.target);
    controls.update();
    if (t >= 1) {
      camera.position.copy(a.toPos);
      controls.target.copy(a.toTarget);
      controls.update();
      anim.current = null;
    }
  });

  return null;
}
