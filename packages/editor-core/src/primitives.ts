import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  SphereGeometry,
  TorusGeometry,
  type BufferGeometry,
} from 'three';
import type { PrimitiveKind } from '@form3d/model-types';
import { setMeta } from './metadata';

interface PrimitiveDef {
  label: string;
  /** 영문 기본 이름 (씬 노드/내보내기용) */
  baseName: string;
  create: () => BufferGeometry;
  /** 바닥(y=0) 위에 놓이도록 하는 높이 오프셋 */
  yOffset: number;
}

export const PRIMITIVES: Record<PrimitiveKind, PrimitiveDef> = {
  box: { label: '큐브', baseName: 'Box', create: () => new BoxGeometry(1, 1, 1), yOffset: 0.5 },
  sphere: {
    label: '구',
    baseName: 'Sphere',
    create: () => new SphereGeometry(0.5, 48, 24),
    yOffset: 0.5,
  },
  cylinder: {
    label: '원기둥',
    baseName: 'Cylinder',
    create: () => new CylinderGeometry(0.5, 0.5, 1, 48),
    yOffset: 0.5,
  },
  cone: { label: '원뿔', baseName: 'Cone', create: () => new ConeGeometry(0.5, 1, 48), yOffset: 0.5 },
  torus: {
    label: '토러스',
    baseName: 'Torus',
    create: () => new TorusGeometry(0.4, 0.15, 24, 64),
    yOffset: 0.55,
  },
  plane: {
    label: '평면',
    baseName: 'Plane',
    create: () => new PlaneGeometry(2, 2).rotateX(-Math.PI / 2),
    yOffset: 0,
  },
};

const DEFAULT_COLOR = 0x9aa4b5;

export function createPrimitive(kind: PrimitiveKind, name?: string): Mesh {
  const def = PRIMITIVES[kind];
  if (!def) throw new Error(`지원하지 않는 기본 도형: ${String(kind)}`);
  const mesh = new Mesh(
    def.create(),
    new MeshStandardMaterial({ color: DEFAULT_COLOR, metalness: 0, roughness: 0.5 }),
  );
  mesh.name = name ?? def.baseName;
  mesh.position.set(0, def.yOffset, 0);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  setMeta(mesh, { source: 'primitive', primitive: kind });
  return mesh;
}
