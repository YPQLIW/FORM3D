import { useEffect } from 'react';
import type { ViewPreset } from '@form3d/model-types';
import { deleteSelected, duplicateSelected, groupSelected, redo, undo, ungroupSelected } from '../lib/actions';
import { engine } from '../state/engine';
import { saveCurrent } from '../lib/project';
import { useAppStore } from '../state/appStore';

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

/** 숫자 키(상단 숫자 / 숫자패드) → 카메라 시점 */
export const VIEW_KEYS: Record<string, ViewPreset> = {
  '1': 'front',
  '2': 'back',
  '3': 'right',
  '4': 'left',
  '5': 'top',
  '6': 'bottom',
  '0': 'iso',
};

function digitOf(code: string): string | null {
  const m = /^(?:Digit|Numpad)(\d)$/.exec(code);
  return m ? m[1] : null;
}

/**
 * 전역 단축키
 * - Ctrl+S 저장, Ctrl+Shift+S 다른 이름으로 저장
 * - Ctrl+Z / Ctrl+Y (Ctrl+Shift+Z): 실행 취소 / 다시 실행
 * - Ctrl+D 복제, Ctrl+G 그룹, Ctrl+Shift+G 그룹 해제, Ctrl+A 전체 선택
 * - W/E/R 이동/회전/크기, F 맞추기, Delete 삭제, Esc 선택 해제
 * - 1~6, 0: 카메라 시점 (정면/뒷면/오른쪽/왼쪽/위/아래/등각)
 * - Ctrl 누른 채 기즈모 드래그: 스냅 일시 전환
 */
export function useShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useAppStore.getState();
      if (e.key === 'Control' || e.key === 'Meta') {
        if (!s.snapInvert) s.setSnapInvert(true);
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      // 저장은 입력 중에도 동작 (브라우저의 '페이지 저장' 대신)
      if (mod && key === 's') {
        e.preventDefault();
        if (!e.repeat) void saveCurrent({ saveAs: e.shiftKey });
        return;
      }
      if (isTyping(e.target)) return;

      if (mod && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && key === 'y') {
        e.preventDefault();
        redo();
        return;
      }
      if (mod && key === 'd') {
        e.preventDefault();
        duplicateSelected();
        return;
      }
      if (mod && key === 'g') {
        e.preventDefault();
        if (e.shiftKey) ungroupSelected();
        else groupSelected();
        return;
      }
      if (mod && key === 'a') {
        e.preventDefault();
        engine.selectAll();
        return;
      }
      if (mod || e.altKey) return;

      const digit = digitOf(e.code);
      if (digit && VIEW_KEYS[digit]) {
        e.preventDefault();
        s.requestView(VIEW_KEYS[digit]);
        return;
      }

      switch (key) {
        case 'w':
          s.setTransformMode('translate');
          break;
        case 'e':
          s.setTransformMode('rotate');
          break;
        case 'r':
          s.setTransformMode('scale');
          break;
        case 'f':
          s.requestFrame();
          break;
        case 'delete':
        case 'backspace':
          e.preventDefault();
          deleteSelected();
          break;
        case 'escape':
          engine.select(null);
          break;
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Control' || e.key === 'Meta') useAppStore.getState().setSnapInvert(false);
    };
    const onBlur = () => useAppStore.getState().setSnapInvert(false);
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);
}
