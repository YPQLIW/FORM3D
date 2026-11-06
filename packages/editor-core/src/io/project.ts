import type { AnimationClip, Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { Vec3 } from '@form3d/model-types';
import { APP_VERSION, Form3DError } from '@form3d/shared';
import type { EditorEngine } from '../engine';
import { computeStats } from '../stats';

/**
 * FORM3D 프로젝트 파일 (.form3d)
 *
 * ZIP 컨테이너:
 *   manifest.json   형식/버전/이름/날짜/통계 (항상 먼저 확인)
 *   scene.glb       씬 전체 (오브젝트·그룹 구조, Transform, 재질, 텍스처, 스킨, 애니메이션) — glTF 2.0
 *   project.json    카메라 상태, 프로젝트 설정, 편집기 전용 정보
 *   thumbnail.png   미리보기 이미지 (선택)
 *
 * 씬은 표준 glTF로 저장하므로 다른 3D 프로그램과 호환되고, 압축을 풀면 scene.glb를 바로 열 수 있습니다.
 * GLB 내보내기(결과물 공유)와는 별개의 기능입니다.
 */
export const FORM3D_FORMAT = 'form3d-project';
export const FORM3D_FORMAT_VERSION = 1;
export const FORM3D_EXTENSION = '.form3d';

/** glTF extras(userData)에 잠시 넣는 편집기 전용 정보 키 */
const EDITOR_KEY = 'form3dEditor';

export interface CameraState {
  position: Vec3;
  target: Vec3;
  fov: number;
}

export interface ProjectSettings {
  showGrid: boolean;
  transformMode: 'translate' | 'rotate' | 'scale';
  transformSpace: 'world' | 'local';
  selectionMode: 'object' | 'mesh';
  alignReference: 'selection' | 'active';
  snap: { enabled: boolean; translate: number; rotateDeg: number; scale: number };
}

export interface ProjectManifest {
  format: typeof FORM3D_FORMAT;
  formatVersion: number;
  appVersion: string;
  /** 프로젝트 고유 ID (서버 저장소 기준) */
  projectId: string | null;
  name: string;
  createdAt: string;
  modifiedAt: string;
  stats: { objects: number; meshes: number; triangles: number };
  files: { scene: string | null; project: string; thumbnail: string | null };
}

export interface ProjectData {
  camera: CameraState | null;
  settings: ProjectSettings | null;
}

export interface SaveProjectOptions extends ProjectData {
  name: string;
  projectId?: string | null;
  createdAt?: string;
  thumbnail?: Uint8Array | null;
}

export interface LoadedProject extends ProjectData {
  manifest: ProjectManifest;
  /** 씬 최상위 오브젝트들 (엔진 root에 넣어 사용) */
  objects: Object3D[];
  thumbnail: Uint8Array | null;
  warnings: string[];
}

interface EditorStash {
  name: string;
  visible: boolean;
  animations?: string[];
}

/** 현재 씬을 .form3d 바이트로 직렬화 */
export async function saveProject(engine: EditorEngine, opts: SaveProjectOptions): Promise<Uint8Array> {
  const root = engine.root;
  const now = new Date().toISOString();
  const stats = computeStats(root);
  let sceneBytes: Uint8Array | null = null;

  if (root.children.length > 0) {
    // 1) 편집기 정보(원래 이름, 표시 여부, 애니메이션 소속)를 userData에 잠시 기록 → glTF extras로 저장
    const touched: Object3D[] = [];
    const clips = new Set<AnimationClip>();
    for (const top of root.children) {
      top.traverse((o) => {
        const stash: EditorStash = { name: o.name, visible: o.visible };
        if (o.animations?.length) {
          stash.animations = o.animations.map((a) => a.name);
          o.animations.forEach((a) => clips.add(a));
        }
        o.userData[EDITOR_KEY] = stash;
        touched.push(o);
      });
    }
    try {
      // 씬 root 하나를 통째로 내보내 애니메이션 대상 노드를 모두 찾을 수 있게 함
      const result = await new GLTFExporter().parseAsync(root, {
        binary: true,
        onlyVisible: false,
        animations: [...clips],
      });
      if (!(result instanceof ArrayBuffer)) throw new Error('GLB 결과를 받지 못했습니다.');
      sceneBytes = new Uint8Array(result);
    } catch (err) {
      throw new Form3DError(`프로젝트 저장 실패 (씬 변환): ${err instanceof Error ? err.message : String(err)}`, 'SAVE_FAILED');
    } finally {
      touched.forEach((o) => delete o.userData[EDITOR_KEY]);
    }
  }

  const manifest: ProjectManifest = {
    format: FORM3D_FORMAT,
    formatVersion: FORM3D_FORMAT_VERSION,
    appVersion: APP_VERSION,
    projectId: opts.projectId ?? null,
    name: opts.name,
    createdAt: opts.createdAt ?? now,
    modifiedAt: now,
    stats: { objects: root.children.length, meshes: stats.meshes, triangles: stats.triangles },
    files: {
      scene: sceneBytes ? 'scene.glb' : null,
      project: 'project.json',
      thumbnail: opts.thumbnail?.length ? 'thumbnail.png' : null,
    },
  };
  const project: ProjectData = { camera: opts.camera, settings: opts.settings };
  const files: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {
    'manifest.json': strToU8(JSON.stringify(manifest, null, 2)),
    'project.json': strToU8(JSON.stringify(project, null, 2)),
  };
  // 이미 압축된 데이터는 다시 압축하지 않음 (속도)
  if (sceneBytes) files['scene.glb'] = [sceneBytes, { level: 0 }];
  if (opts.thumbnail?.length) files['thumbnail.png'] = [opts.thumbnail, { level: 0 }];
  return zipSync(files, { level: 6 });
}

/** .form3d 파일의 manifest만 빠르게 확인 (형식 검증) */
export function readProjectManifest(data: Uint8Array): ProjectManifest {
  const files = unzipProject(data);
  return parseManifest(files);
}

function unzipProject(data: Uint8Array): Record<string, Uint8Array> {
  if (data.byteLength < 4 || data[0] !== 0x50 || data[1] !== 0x4b) {
    throw new Form3DError('FORM3D 프로젝트 파일(.form3d)이 아닙니다.', 'INVALID_PROJECT');
  }
  try {
    return unzipSync(data);
  } catch {
    throw new Form3DError('프로젝트 파일이 손상되었습니다 (압축 해제 실패).', 'INVALID_PROJECT');
  }
}

function parseManifest(files: Record<string, Uint8Array>): ProjectManifest {
  const raw = files['manifest.json'];
  if (!raw) throw new Form3DError('프로젝트 파일에 manifest.json이 없습니다.', 'INVALID_PROJECT');
  let m: ProjectManifest;
  try {
    m = JSON.parse(strFromU8(raw));
  } catch {
    throw new Form3DError('manifest.json을 읽을 수 없습니다.', 'INVALID_PROJECT');
  }
  if (m.format !== FORM3D_FORMAT) throw new Form3DError('FORM3D 프로젝트 형식이 아닙니다.', 'INVALID_PROJECT');
  if (typeof m.formatVersion !== 'number' || m.formatVersion > FORM3D_FORMAT_VERSION) {
    throw new Form3DError(
      `더 새로운 FORM3D(형식 v${m.formatVersion})에서 만든 파일입니다. 프로그램을 업데이트해 주세요.`,
      'PROJECT_VERSION',
    );
  }
  return m;
}

/** .form3d 바이트 → 씬 오브젝트 + 카메라/설정 */
export async function loadProject(data: Uint8Array | ArrayBuffer): Promise<LoadedProject> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const files = unzipProject(bytes);
  const manifest = parseManifest(files);
  const warnings: string[] = [];

  let project: ProjectData = { camera: null, settings: null };
  const pj = files[manifest.files?.project ?? 'project.json'];
  if (pj) {
    try {
      project = { camera: null, settings: null, ...JSON.parse(strFromU8(pj)) };
    } catch {
      warnings.push('project.json을 읽지 못해 카메라·설정은 기본값을 사용합니다.');
    }
  } else warnings.push('project.json이 없어 카메라·설정은 기본값을 사용합니다.');

  let objects: Object3D[] = [];
  if (manifest.files?.scene) {
    const glb = files[manifest.files.scene];
    if (!glb) throw new Form3DError('프로젝트 파일에 씬 데이터(scene.glb)가 없습니다.', 'INVALID_PROJECT');
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    let gltf;
    try {
      const buf = glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength) as ArrayBuffer;
      gltf = await loader.parseAsync(buf, '');
    } catch (err) {
      throw new Form3DError(`씬 데이터를 읽지 못했습니다: ${err instanceof Error ? err.message : String(err)}`, 'INVALID_PROJECT');
    }
    // 애니메이션이 참조하는 노드 이름은 그대로 둬야 연결이 유지됨
    const animTargets = new Set<string>();
    for (const clip of gltf.animations) for (const t of clip.tracks) animTargets.add(t.name.split('.')[0]);
    const clipByName = new Map(gltf.animations.map((c) => [c.name, c]));

    // 저장 시 씬 root 하나를 내보냈으므로 그 자식이 원래 최상위 오브젝트
    const savedRoot = gltf.scene.children.length === 1 ? gltf.scene.children[0] : gltf.scene;
    objects = [...savedRoot.children];
    for (const top of objects) {
      top.traverse((o) => {
        const stash = o.userData?.[EDITOR_KEY] as EditorStash | undefined;
        if (stash) {
          if (typeof stash.name === 'string' && !animTargets.has(o.name)) o.name = stash.name;
          o.visible = stash.visible !== false;
          if (stash.animations?.length) {
            o.animations = stash.animations.map((n) => clipByName.get(n)).filter((c): c is AnimationClip => !!c);
            if (o.animations.length < stash.animations.length) warnings.push(`"${o.name}"의 애니메이션 일부를 찾지 못했습니다.`);
          }
          delete o.userData[EDITOR_KEY];
        }
        if (o.userData && 'name' in o.userData && typeof o.userData.name === 'string') delete o.userData.name;
        const mesh = o as { isMesh?: boolean; castShadow: boolean; receiveShadow: boolean };
        if (mesh.isMesh) {
          mesh.castShadow = true;
          mesh.receiveShadow = true;
        }
      });
    }
    for (const o of objects) o.removeFromParent();
  }

  const thumb = manifest.files?.thumbnail ? files[manifest.files.thumbnail] ?? null : null;
  return { manifest, camera: project.camera ?? null, settings: project.settings ?? null, objects, thumbnail: thumb, warnings };
}

/** 열린 프로젝트를 엔진에 적용 (기존 내용·기록은 비움) */
export function applyLoadedProject(engine: EditorEngine, loaded: LoadedProject): void {
  engine.reset();
  for (const o of loaded.objects) engine.root.add(o);
  engine.root.updateMatrixWorld(true);
  engine.notify();
}
