import { Box3, Vector3, type Material, type Mesh, type Object3D, type Texture } from 'three';
import type { GeometryStats, Vec3 } from '@form3d/model-types';

function forEachMaterial(mesh: Mesh, fn: (m: Material) => void): void {
  const m = mesh.material;
  (Array.isArray(m) ? m : [m]).forEach((x) => x && fn(x));
}

export function collectTextures(material: Material): { slot: string; texture: Texture }[] {
  const out: { slot: string; texture: Texture }[] = [];
  for (const [slot, value] of Object.entries(material)) {
    if (value && typeof value === 'object' && (value as Texture).isTexture) {
      out.push({ slot, texture: value as Texture });
    }
  }
  return out;
}

/**
 * @param precise true면 정점 단위로 정확한 바운딩 박스 계산 (대형 모델에서는 느림)
 */
export function computeStats(root: Object3D, precise = false): GeometryStats {
  let meshes = 0;
  let vertices = 0;
  let triangles = 0;
  const materials = new Set<string>();
  const textures = new Set<string>();

  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    meshes++;
    const pos = mesh.geometry.getAttribute('position');
    const count = pos ? pos.count : 0;
    vertices += count;
    const index = mesh.geometry.getIndex();
    triangles += Math.floor((index ? index.count : count) / 3);
    forEachMaterial(mesh, (m) => {
      materials.add(m.uuid);
      collectTextures(m).forEach(({ texture }) => textures.add(texture.uuid));
    });
  });

  root.updateWorldMatrix(true, true);
  const box = new Box3().setFromObject(root, precise);
  const size: Vec3 | null = box.isEmpty()
    ? null
    : (box.getSize(new Vector3()).toArray() as Vec3);

  return { meshes, vertices, triangles, materials: materials.size, textures: textures.size, size };
}

export interface TextureInfo {
  slot: string;
  name: string;
  width: number | null;
  height: number | null;
}

export function getTextureInfo(mesh: Mesh): TextureInfo[] {
  const list: TextureInfo[] = [];
  forEachMaterial(mesh, (m) => {
    for (const { slot, texture } of collectTextures(m)) {
      const img = texture.image as { width?: number; height?: number } | undefined;
      list.push({
        slot,
        name: texture.name || '(이름 없음)',
        width: img?.width ?? null,
        height: img?.height ?? null,
      });
    }
  });
  return list;
}
