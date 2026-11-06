import { LoadingManager, type AnimationClip, type Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import {
  Form3DError,
  GLTF_RESOURCE_EXTENSIONS,
  MAX_MODEL_FILE_BYTES,
  OBJ_RESOURCE_EXTENSIONS,
  SUPPORTED_IMPORT_EXTENSIONS,
  formatBytes,
  getExtension,
  stripExtension,
} from '@form3d/shared';
import { setMeta } from '../metadata';

export interface ImportResult {
  root: Object3D;
  fileName: string;
  fileSize: number;
  animations: AnimationClip[];
  /** 불러오기는 성공했지만 사용자에게 알려야 할 내용 (예: 누락된 텍스처) */
  warnings?: string[];
}

const GLB_MAGIC = 0x46546c67; // 'glTF'

/** 파일 목록에서 메인 모델 파일을 찾고 기본 검증을 수행 */
export function pickMainModelFile(files: File[]): File {
  if (files.length === 0) throw new Form3DError('선택된 파일이 없습니다.', 'NO_FILE');
  const mains = files.filter((f) =>
    (SUPPORTED_IMPORT_EXTENSIONS as readonly string[]).includes(getExtension(f.name)),
  );
  if (mains.length === 0) {
    const exts = files.map((f) => getExtension(f.name) || '(없음)').join(', ');
    throw new Form3DError(
      `지원하지 않는 형식입니다 (${exts}). 현재 GLB / GLTF / OBJ 파일만 불러올 수 있습니다.`,
      'UNSUPPORTED_FORMAT',
    );
  }
  if (mains.length > 1) {
    throw new Form3DError('한 번에 하나의 모델 파일(.glb/.gltf/.obj)만 불러올 수 있습니다.', 'MULTIPLE_MAIN');
  }
  const others = files.filter((f) => f !== mains[0]);
  const allowed: readonly string[] =
    getExtension(mains[0].name) === '.obj' ? OBJ_RESOURCE_EXTENSIONS : GLTF_RESOURCE_EXTENSIONS;
  for (const f of others) {
    if (!allowed.includes(getExtension(f.name))) {
      throw new Form3DError(`함께 선택할 수 없는 파일입니다: ${f.name}`, 'UNSUPPORTED_RESOURCE');
    }
  }
  const total = files.reduce((s, f) => s + f.size, 0);
  if (total > MAX_MODEL_FILE_BYTES) {
    throw new Form3DError(
      `파일이 너무 큽니다 (${formatBytes(total)}). 최대 ${formatBytes(MAX_MODEL_FILE_BYTES)}까지 불러올 수 있습니다.`,
      'FILE_TOO_LARGE',
    );
  }
  if (mains[0].size === 0) throw new Form3DError('빈 파일입니다.', 'EMPTY_FILE');
  return mains[0];
}

/** 파일 내용 검증: GLB 헤더 / glTF JSON 버전 */
export function validateGltfContent(fileName: string, data: ArrayBuffer): void {
  const ext = getExtension(fileName);
  if (ext === '.glb') {
    if (data.byteLength < 20) throw new Form3DError('손상된 GLB 파일입니다 (헤더 부족).', 'INVALID_GLB');
    const view = new DataView(data);
    if (view.getUint32(0, true) !== GLB_MAGIC) {
      throw new Form3DError('GLB 파일 형식이 아닙니다 (glTF 시그니처 없음).', 'INVALID_GLB');
    }
    const version = view.getUint32(4, true);
    if (version !== 2) {
      throw new Form3DError(`glTF ${version}.0은 지원하지 않습니다. glTF 2.0만 지원합니다.`, 'GLTF_VERSION');
    }
    const declared = view.getUint32(8, true);
    if (declared > data.byteLength) {
      throw new Form3DError('GLB 파일이 잘려 있습니다 (선언된 길이보다 짧음).', 'INVALID_GLB');
    }
    return;
  }
  // .gltf (JSON)
  let json: { asset?: { version?: string } };
  try {
    json = JSON.parse(new TextDecoder().decode(data));
  } catch {
    throw new Form3DError('GLTF JSON을 해석할 수 없습니다.', 'INVALID_GLTF');
  }
  const v = json.asset?.version;
  if (!v || !v.startsWith('2')) {
    throw new Form3DError(`glTF 2.0 파일이 아닙니다 (asset.version=${v ?? '없음'}).`, 'GLTF_VERSION');
  }
}

function translateLoaderError(err: unknown): Form3DError {
  const msg = err instanceof Error ? err.message : String(err);
  if (/DRACO/i.test(msg)) {
    return new Form3DError(
      'Draco 압축 모델은 아직 지원하지 않습니다. 압축되지 않은 GLB로 다시 내보내 주세요.',
      'DRACO_UNSUPPORTED',
    );
  }
  if (/KTX2|BasisU/i.test(msg)) {
    return new Form3DError('KTX2 텍스처는 아직 지원하지 않습니다.', 'KTX2_UNSUPPORTED');
  }
  if (/Failed to load|404|fetch/i.test(msg)) {
    return new Form3DError(
      `외부 리소스를 찾을 수 없습니다. .gltf와 함께 .bin/텍스처 파일을 같이 선택해 주세요. (${msg})`,
      'MISSING_RESOURCE',
    );
  }
  return new Form3DError(`모델을 불러오지 못했습니다: ${msg}`, 'LOAD_FAILED');
}

/**
 * GLB/GLTF 파일을 불러옵니다. 메시·재질·텍스처·애니메이션 데이터를 그대로 보존합니다.
 * .gltf의 경우 함께 선택한 .bin / 이미지 파일을 메모리 URL로 연결합니다.
 */
export async function importGltfFiles(files: File[]): Promise<ImportResult> {
  const main = pickMainModelFile(files);
  const data = await main.arrayBuffer();
  validateGltfContent(main.name, data);

  const blobUrls = new Map<string, string>();
  for (const f of files) {
    if (f !== main) blobUrls.set(f.name, URL.createObjectURL(f));
  }

  const manager = new LoadingManager();
  manager.setURLModifier((url) => {
    if (url.startsWith('data:') || url.startsWith('blob:')) return url;
    const base = decodeURIComponent(url.split(/[\\/]/).pop() ?? url);
    return blobUrls.get(base) ?? url;
  });

  const loader = new GLTFLoader(manager);
  loader.setMeshoptDecoder(MeshoptDecoder);

  try {
    const gltf = await loader.parseAsync(data, '');
    const root = gltf.scene;
    root.name = stripExtension(main.name);
    root.animations = gltf.animations;
    // GLTFLoader는 애니메이션 연결을 위해 노드 이름의 "."등을 제거합니다 (Box.001 → Box001).
    // 애니메이션이 없는 모델은 원래 이름(userData.name)으로 되돌려 편집기 이름을 보존합니다.
    const restoreNames = gltf.animations.length === 0;
    root.traverse((o) => {
      if (restoreNames && typeof o.userData?.name === 'string' && o.userData.name) o.name = o.userData.name;
      setMeta(o, { source: 'imported' });
      const mesh = o as { isMesh?: boolean; castShadow: boolean; receiveShadow: boolean };
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
    setMeta(root, { source: 'imported', fileName: main.name, fileSize: main.size });
    return { root, fileName: main.name, fileSize: main.size, animations: gltf.animations };
  } catch (err) {
    throw err instanceof Form3DError ? err : translateLoaderError(err);
  } finally {
    // 텍스처 이미지는 이미 디코딩되어 있으므로 URL 해제
    setTimeout(() => blobUrls.forEach((u) => URL.revokeObjectURL(u)), 5000);
  }
}

/**
 * 오브젝트 목록을 GLB(바이너리 glTF 2.0)로 내보냅니다.
 * 각 오브젝트에 연결된 애니메이션 클립도 함께 포함합니다.
 */
export async function exportGlb(objects: Object3D[]): Promise<ArrayBuffer> {
  if (objects.length === 0) {
    throw new Form3DError('내보낼 오브젝트가 없습니다.', 'EMPTY_SCENE');
  }
  const clipSet = new Set<AnimationClip>();
  for (const obj of objects) {
    obj.traverse((o) => {
      o.animations?.forEach((clip) => clipSet.add(clip));
    });
  }
  // 복제된 모델은 같은 클립을 공유하므로 중복 제거
  const animations = [...clipSet];
  const exporter = new GLTFExporter();
  try {
    const result = await exporter.parseAsync(objects, {
      binary: true,
      onlyVisible: false,
      animations,
    });
    if (!(result instanceof ArrayBuffer)) {
      throw new Error('GLB 바이너리 결과를 받지 못했습니다.');
    }
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Form3DError(`GLB 내보내기 실패: ${msg}`, 'EXPORT_FAILED');
  }
}
