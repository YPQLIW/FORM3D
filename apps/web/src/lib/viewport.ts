import type { Camera, PerspectiveCamera, Vector3, WebGLRenderer } from 'three';
import type { CameraState } from '@form3d/editor-core';

/** 뷰포트(카메라·컨트롤·캔버스) 참조. CameraController가 채웁니다. */
interface ControlsLike {
  target: Vector3;
  update: () => void;
}

export const viewport: {
  camera: Camera | null;
  controls: ControlsLike | null;
  gl: WebGLRenderer | null;
  /** 처음 시작할 때의 카메라 (새 프로젝트 시 복원) */
  initial: CameraState | null;
} = {
  initial: null,
  camera: null,
  controls: null,
  gl: null,
};

const r = (v: number) => Math.round(v * 10000) / 10000;

export function getCameraState(): CameraState | null {
  const { camera, controls } = viewport;
  if (!camera || !controls) return null;
  return {
    position: [r(camera.position.x), r(camera.position.y), r(camera.position.z)],
    target: [r(controls.target.x), r(controls.target.y), r(controls.target.z)],
    fov: (camera as PerspectiveCamera).fov ?? 50,
  };
}

export function applyCameraState(state: CameraState | null): void {
  const { camera, controls } = viewport;
  if (!state || !camera || !controls) return;
  camera.position.set(...state.position);
  controls.target.set(...state.target);
  const pc = camera as PerspectiveCamera;
  if (pc.isPerspectiveCamera && Number.isFinite(state.fov)) {
    pc.fov = state.fov;
    pc.updateProjectionMatrix();
  }
  camera.lookAt(controls.target);
  controls.update();
}

/** 현재 뷰포트를 작은 PNG(최대 320x180)로 캡처 — 프로젝트 목록 미리보기용 */
export async function captureThumbnail(): Promise<Uint8Array | null> {
  const canvas = viewport.gl?.domElement;
  if (!canvas || !canvas.width || !canvas.height) return null;
  try {
    const scale = Math.min(320 / canvas.width, 180 / canvas.height, 1);
    const out = document.createElement('canvas');
    out.width = Math.max(1, Math.round(canvas.width * scale));
    out.height = Math.max(1, Math.round(canvas.height * scale));
    const ctx = out.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(canvas, 0, 0, out.width, out.height);
    const blob = await new Promise<Blob | null>((res) => out.toBlob(res, 'image/png'));
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
  } catch {
    return null;
  }
}
