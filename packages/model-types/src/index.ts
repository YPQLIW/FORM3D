import COMMAND_MANIFEST_JSON from './commands.json';

/**
 * FORM3D 공용 모델 타입.
 * 특정 캐릭터/모델 종류에 종속되지 않는 범용 3D 데이터 표현입니다.
 * Phase 3(백엔드), Phase 4(AI 명령)에서도 동일한 타입을 공유합니다.
 */

export type Vec3 = [number, number, number];

export interface TransformData {
  position: Vec3;
  /** 라디안 단위 Euler(XYZ) */
  rotation: Vec3;
  scale: Vec3;
}

export interface MaterialData {
  /** #rrggbb */
  color: string;
  metalness: number;
  roughness: number;
}

export const PRIMITIVE_KINDS = [
  'box',
  'sphere',
  'cylinder',
  'cone',
  'torus',
  'plane',
] as const;

export type PrimitiveKind = (typeof PRIMITIVE_KINDS)[number];

/** 씬 노드의 출처 */
export type NodeSource = 'primitive' | 'imported' | 'group' | 'unknown';

/** 씬 계층 UI에 표시하기 위한 직렬화 가능한 노드 정보 */
export interface SceneNodeInfo {
  id: string;
  name: string;
  /** Three.js 타입명 (Mesh, Group, Object3D, SkinnedMesh ...) */
  kind: string;
  source: NodeSource;
  visible: boolean;
  /** 그룹 해제가 가능한 노드인지 (Group/Object3D 이고 자식이 있음) */
  groupLike: boolean;
  children: SceneNodeInfo[];
}

export interface GeometryStats {
  meshes: number;
  vertices: number;
  triangles: number;
  materials: number;
  textures: number;
  /** 월드 기준 바운딩 박스 크기 (빈 객체면 null) */
  size: Vec3 | null;
}

/**
 * AI/편집 시스템이 공유하는 명령 이름.
 * Phase 1에서는 에디터 내부의 Undo/Redo 명령으로 일부가 구현되어 있으며,
 * Phase 4에서 AI가 생성한 JSON 명령이 검증 후 같은 경로로 실행됩니다.
 */
export const EDITOR_COMMAND_NAMES = [
  'ChangeMaterial',
  'SetTransform',
  'AddObject',
  'RemoveObject',
  'RenameObject',
  'ModifyGeometry',
  'ExportModel',
  // Phase 2
  'DuplicateObject',
  'GroupObjects',
  'UngroupObject',
  'ReparentObject',
  'AlignObjects',
] as const;

export type EditorCommandName = (typeof EDITOR_COMMAND_NAMES)[number];

/** 실행 내역에 표시되는 명령 이름 (AI 허용 명령 + 내부 전용 명령) */
export type HistoryCommandName = EditorCommandName | 'SetVisibility' | 'Batch' | 'CommandJob';

/** 카메라 시점 프리셋 */
export const VIEW_PRESETS = ['front', 'back', 'right', 'left', 'top', 'bottom', 'iso'] as const;
export type ViewPreset = (typeof VIEW_PRESETS)[number];

/** 정렬 기준 축 (0=X, 1=Y, 2=Z) */
export type AxisIndex = 0 | 1 | 2;
export type AlignMode = 'min' | 'center' | 'max';

/** 명령 실행 내역 항목 */
export interface HistoryEntryInfo {
  index: number;
  name: HistoryCommandName;
  label: string;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Phase 3: 편집 명령 표준 (사람 UI · 내장 AI · 외부 AI 공유)
// 명령 목록/파라미터 정의는 commands.json 한 곳에서 관리합니다.
// ---------------------------------------------------------------------------

export interface ParamSpec {
  type: 'enum' | 'integer' | 'number' | 'string' | 'boolean' | 'vec3' | 'color' | 'target' | 'scale';
  values?: string[];
  required?: boolean;
  min?: number;
  max?: number;
  maxLength?: number;
  description?: string;
}

export interface CommandSpec {
  description: string;
  scope: 'scene:write' | 'view';
  params: Record<string, ParamSpec>;
}

export interface CommandManifest {
  protocol: string;
  version: string;
  target: { description: string };
  commands: Record<string, CommandSpec>;
  limits: { maxStepsPerJob: number };
}

export const COMMAND_MANIFEST = COMMAND_MANIFEST_JSON as unknown as CommandManifest;

/** 명령 대상 지정 */
export type CommandTarget = 'selection' | 'all' | 'created' | { names: string[] } | { ids: string[] };

/** 구조화된 JSON 명령 한 단계 */
export interface CommandStep {
  command: string;
  params: Record<string, unknown>;
}

/** 실행 단위(작업). 여러 단계를 담고, 전부 성공하거나 전부 취소됩니다. */
export interface CommandJob {
  /** 고유 작업 ID (job_로 시작) */
  id: string;
  /** 명령을 만든 주체: user(직접 입력 해석), ai(LLM), external(외부 API, 예: 온이) */
  source: 'rules' | 'ai' | 'external';
  /** 원래 자연어 요청 (있으면) */
  request?: string;
  /** 사람이 읽을 수 있는 설명 */
  summary?: string;
  steps: CommandStep[];
}

export interface StepResult {
  index: number;
  command: string;
  ok: boolean;
  message: string;
  affected: { id: string; name: string }[];
}

export interface JobResult {
  jobId: string;
  status: 'success' | 'failed' | 'invalid' | 'rejected';
  message: string;
  steps: StepResult[];
  /** 실행 중 새로 만들어진 오브젝트 */
  created: { id: string; name: string }[];
}

/** 프로젝트 정보 조회용 씬 요약 (AI 프롬프트, 외부 API 공용) */
export interface SceneSummaryNode {
  id: string;
  name: string;
  type: string;
  visible: boolean;
  selected: boolean;
  position: Vec3;
  rotationDeg: Vec3;
  scale: Vec3;
  color?: string;
  children?: SceneSummaryNode[];
}

export interface SceneSummary {
  projectName: string;
  objectCount: number;
  selection: string[];
  nodes: SceneSummaryNode[];
  /** 가장 최근 작업에서 새로 만든 오브젝트 ("그거", "방금 만든 것" 이해용) */
  recentlyCreated?: { id: string; name: string }[];
}
