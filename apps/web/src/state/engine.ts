import { useSyncExternalStore } from 'react';
import { EditorEngine } from '@form3d/editor-core';

/** 앱 전체에서 공유하는 단일 에디터 엔진 */
export const engine = new EditorEngine();

// 개발/테스트 시 콘솔 및 E2E 테스트에서 상태를 확인할 수 있도록 노출
if (typeof window !== 'undefined') {
  (window as unknown as { __FORM3D__: EditorEngine }).__FORM3D__ = engine;
}

/** 엔진 상태가 바뀌면 리렌더링되도록 구독 */
export function useEngineRevision(): number {
  return useSyncExternalStore(engine.subscribe, engine.getRevision);
}
