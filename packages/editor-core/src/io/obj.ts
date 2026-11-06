import {
  Color,
  LoadingManager,
  MeshStandardMaterial,
  type Material,
  type Mesh,
  type MeshPhongMaterial,
  type Object3D,
} from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import { Form3DError, clamp, getExtension, stripExtension } from '@form3d/shared';
import { setMeta } from '../metadata';
import { pickMainModelFile, type ImportResult } from './gltf';

/** MTL 없이 불러온 OBJ에 쓰는 기본 색 (기본 도형과 동일) */
const DEFAULT_OBJ_COLOR = 0x9aa4b5;

/** OBJ 텍스트 기본 검증: 텍스트 파일인지, 정점/면 데이터가 있는지 */
export function validateObjContent(fileName: string, text: string): void {
  if (text.length === 0) throw new Form3DError('빈 OBJ 파일입니다.', 'EMPTY_FILE');
  if (text.slice(0, 4096).includes('\u0000')) {
    throw new Form3DError(`${fileName}은(는) 텍스트 OBJ 파일이 아닙니다 (바이너리 데이터).`, 'INVALID_OBJ');
  }
  if (!/^\s*v\s+[-+.\deE]+/m.test(text)) {
    throw new Form3DError(`${fileName}에 정점(v) 데이터가 없습니다. 올바른 OBJ 파일인지 확인해 주세요.`, 'INVALID_OBJ');
  }
}

/** OBJ 안의 mtllib 참조 이름 목록 */
export function findMtlLibs(text: string): string[] {
  return [...text.matchAll(/^\s*mtllib\s+(.+?)\s*$/gm)].map((m) => m[1]);
}

/**
 * OBJ/MTL 로더가 만드는 Phong 재질을 PBR(MeshStandardMaterial)로 변환합니다.
 * → 기존 재질 편집(색상/Metallic/Roughness)과 GLB 내보내기가 그대로 동작합니다.
 */
export function phongToStandard(m: Material, useDefaultColor: boolean): Material {
  const p = m as MeshPhongMaterial;
  if (!p.isMeshPhongMaterial) return m;
  // MTL의 Ns(0~1000, 반사 지수)를 대략적인 거칠기로 변환
  const roughness = clamp(1 - Math.sqrt(clamp(p.shininess ?? 30, 0, 1000) / 1000), 0.05, 1);
  const s = new MeshStandardMaterial({
    name: p.name,
    color: useDefaultColor ? new Color(DEFAULT_OBJ_COLOR) : p.color.clone(),
    map: p.map,
    normalMap: p.normalMap,
    bumpMap: p.bumpMap,
    bumpScale: p.bumpScale,
    alphaMap: p.alphaMap,
    emissive: p.emissive.clone(),
    emissiveMap: p.emissiveMap,
    opacity: p.opacity,
    transparent: p.transparent,
    side: p.side,
    vertexColors: p.vertexColors,
    flatShading: p.flatShading,
    metalness: 0,
    roughness,
  });
  p.dispose();
  return s;
}

/**
 * OBJ 텍스트(+선택적 MTL 텍스트)를 Three.js 오브젝트로 변환합니다.
 * 브라우저/Node 모두에서 동작하며(텍스처 로딩 제외), 단위 테스트에서도 사용합니다.
 */
export function parseObj(
  objText: string,
  options: { mtlText?: string; manager?: LoadingManager; name?: string } = {},
): Object3D {
  const loader = new OBJLoader(options.manager);
  const hasMtl = !!options.mtlText?.trim();
  if (hasMtl) {
    const creator = new MTLLoader(options.manager).parse(options.mtlText!, '');
    creator.preload();
    loader.setMaterials(creator);
  }
  const root = loader.parse(objText);
  let meshes = 0;
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh && !(o as { isLine?: boolean }).isLine && !(o as { isPoints?: boolean }).isPoints) return;
    meshes++;
    if (mesh.isMesh) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const conv = (mat: Material) => phongToStandard(mat, !hasMtl);
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(conv) : conv(mesh.material);
    }
  });
  if (meshes === 0) {
    throw new Form3DError('OBJ 파일에서 메시를 찾지 못했습니다 (면 데이터 없음).', 'INVALID_OBJ');
  }
  root.name = options.name ?? 'OBJ Model';
  return root;
}

/**
 * OBJ 파일을 불러옵니다. 함께 선택한 .mtl 과 텍스처 이미지를 연결합니다.
 * 누락된 MTL/텍스처는 오류 대신 경고로 알려주고, 기본 재질로 표시합니다.
 */
export async function importObjFiles(files: File[]): Promise<ImportResult> {
  const main = pickMainModelFile(files);
  if (getExtension(main.name) !== '.obj') {
    throw new Form3DError('OBJ 파일이 아닙니다.', 'UNSUPPORTED_FORMAT');
  }
  const text = await main.text();
  validateObjContent(main.name, text);

  const warnings: string[] = [];
  const mtlFiles = files.filter((f) => getExtension(f.name) === '.mtl');
  const mtlText = (await Promise.all(mtlFiles.map((f) => f.text()))).join('\n');
  const libs = findMtlLibs(text);
  if (mtlFiles.length === 0 && libs.length > 0) {
    warnings.push(`재질 파일(${libs.join(', ')})이 함께 선택되지 않아 기본 재질로 표시합니다.`);
  }

  const blobUrls = new Map<string, string>();
  for (const f of files) {
    if (f !== main && getExtension(f.name) !== '.mtl') blobUrls.set(f.name.toLowerCase(), URL.createObjectURL(f));
  }
  const missing = new Set<string>();
  const manager = new LoadingManager();
  manager.setURLModifier((url) => {
    if (url.startsWith('data:') || url.startsWith('blob:')) return url;
    const base = decodeURIComponent(url.split(/[\\/]/).pop() ?? url).toLowerCase();
    const found = blobUrls.get(base);
    if (!found) missing.add(base);
    // 없는 텍스처는 빈 data URL로 바꿔 네트워크 요청/콘솔 오류를 막음
    return found ?? 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=';
  });

  try {
    const root = parseObj(text, { mtlText, manager, name: stripExtension(main.name) });
    root.traverse((o) => setMeta(o, { source: 'imported' }));
    setMeta(root, { source: 'imported', fileName: main.name, fileSize: main.size });
    if (missing.size) {
      warnings.push(`찾을 수 없는 텍스처 ${missing.size}개: ${[...missing].join(', ')} (함께 선택해 주세요)`);
    }
    return { root, fileName: main.name, fileSize: main.size, animations: [], warnings };
  } catch (err) {
    if (err instanceof Form3DError) throw err;
    throw new Form3DError(`OBJ를 불러오지 못했습니다: ${err instanceof Error ? err.message : String(err)}`, 'LOAD_FAILED');
  } finally {
    setTimeout(() => blobUrls.forEach((u) => URL.revokeObjectURL(u)), 10_000);
  }
}
