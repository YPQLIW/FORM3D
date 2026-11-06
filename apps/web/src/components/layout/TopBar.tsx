import { useEffect, useRef, useState } from 'react';
import { Download, FolderOpen, Plus, Redo2, Save, Settings, Sparkles, Undo2 } from 'lucide-react';
import { openAiSettings } from '../../lib/aiSettings';
import { PRIMITIVES } from '@form3d/editor-core';
import { PRIMITIVE_KINDS } from '@form3d/model-types';
import { Button } from '../ui/Button';
import { addPrimitive, exportScene, redo, undo } from '../../lib/actions';
import { engine, useEngineRevision } from '../../state/engine';
import { useAppStore } from '../../state/appStore';
import { FileImportButton } from '../panels/FileImportButton';
import { FileMenu } from './FileMenu';
import { useProjectStore } from '../../state/projectStore';
import { isProjectDirty, renameProject, saveCurrent } from '../../lib/project';

function Logo() {
  return (
    <div className="flex items-center gap-2 pr-2">
      <svg width="20" height="20" viewBox="0 0 32 32" aria-hidden>
        <defs>
          <linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#4f7cff" />
            <stop offset="1" stopColor="#8b5cf6" />
          </linearGradient>
        </defs>
        <path d="M16 2 29 9.5v13L16 30 3 22.5v-13z" fill="url(#lg)" />
        <path d="M16 2v28M3 9.5l13 7.5 13-7.5" stroke="#0f1115" strokeWidth="1.6" fill="none" opacity=".6" />
      </svg>
      <span className="text-[13px] font-bold tracking-[0.12em] text-white">FORM3D</span>
    </div>
  );
}

function AddPrimitiveMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={ref}
      className="relative"
      onBlur={(e) => {
        if (!ref.current?.contains(e.relatedTarget as Node)) setOpen(false);
      }}
    >
      <Button variant="subtle" icon={<Plus size={14} />} onClick={() => setOpen(!open)} aria-expanded={open}>
        도형 추가
      </Button>
      {open && (
        <div role="menu" className="absolute left-0 top-8 z-50 w-36 rounded-md border border-line bg-panel-2 py-1 shadow-xl">
          {PRIMITIVE_KINDS.map((k) => (
            <button
              key={k}
              role="menuitem"
              type="button"
              className="flex w-full items-center justify-between px-3 py-1.5 text-left text-[12px] hover:bg-accent/20"
              onClick={() => {
                addPrimitive(k);
                setOpen(false);
              }}
            >
              {PRIMITIVES[k].label}
              <span className="text-[10px] text-muted">{PRIMITIVES[k].baseName}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** 프로젝트 이름: 입력을 마치면(Enter/포커스 이동) 저장소 이름도 바뀝니다 */
function ProjectNameField() {
  const projectName = useAppStore((s) => s.projectName);
  const [draft, setDraft] = useState(projectName);
  useEffect(() => setDraft(projectName), [projectName]);
  const commit = () => {
    if (draft.trim() && draft.trim() !== projectName) void renameProject(draft);
    else setDraft(projectName);
  };
  return (
    <input
      aria-label="프로젝트 이름"
      className="h-7 w-44 rounded border border-transparent bg-transparent px-2 text-[12px] text-text hover:border-line focus:border-accent focus:outline-none"
      value={draft}
      maxLength={120}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          setDraft(projectName);
          setTimeout(() => (e.target as HTMLInputElement).blur(), 0);
        }
      }}
    />
  );
}

export function TopBar() {
  useEngineRevision();
  const busy = useAppStore((s) => s.busy);
  const projectName = useAppStore((s) => s.projectName);
  const saving = useProjectStore((s) => s.saving);
  const server = useProjectStore((s) => s.server);
  const projectId = useProjectStore((s) => s.projectId);
  const hasContent = engine.root.children.length > 0;
  const dirty = isProjectDirty();

  useEffect(() => {
    document.title = `${dirty ? '● ' : ''}${projectName} - FORM3D`;
  }, [dirty, projectName]);

  return (
    <header className="flex h-11 shrink-0 items-center gap-1 border-b border-line bg-panel px-3">
      <Logo />
      <div className="mx-1 h-5 w-px bg-line" />
      <FileMenu />
      <ProjectNameField />
      <span
        data-testid="dirty-indicator"
        data-dirty={dirty ? 'true' : 'false'}
        title={dirty ? '저장하지 않은 변경이 있습니다' : '모든 변경이 저장되었습니다'}
        className={`mr-1 h-2 w-2 shrink-0 rounded-full ${dirty ? 'bg-amber-400' : 'bg-transparent'}`}
      />
      <div className="mx-1 h-5 w-px bg-line" />

      <Button
        icon={<Save size={14} />}
        onClick={() => void saveCurrent()}
        disabled={!!busy || saving}
        data-testid="save-button"
        title={
          server === 'online'
            ? projectId
              ? '프로젝트 저장 (Ctrl+S) — 이전 저장본은 버전 기록으로 보관됩니다'
              : '프로젝트 저장소에 새로 저장 (Ctrl+S)'
            : '로컬 서버가 꺼져 있어 .form3d 파일로 내려받습니다 (Ctrl+S)'
        }
      >
        저장
      </Button>
      <Button icon={<Undo2 size={14} />} onClick={undo} disabled={!engine.history.canUndo} title="실행 취소 (Ctrl+Z)">
        실행 취소
      </Button>
      <Button icon={<Redo2 size={14} />} onClick={redo} disabled={!engine.history.canRedo} title="다시 실행 (Ctrl+Y / Ctrl+Shift+Z)">
        다시 실행
      </Button>

      <div className="mx-2 h-5 w-px bg-line" />
      <AddPrimitiveMenu />
      <FileImportButton variant="subtle" icon={<FolderOpen size={14} />} label="모델 불러오기" />

      <div className="flex-1" />

      <Button icon={<Settings size={14} />} onClick={() => openAiSettings()} data-testid="ai-settings-button" title="AI 제공자·모델·API 키·Ollama·사용량·엔진 설정">
        AI 설정
      </Button>
      <Button
        icon={<Sparkles size={14} />}
        disabled
        badge="Phase 5"
        title="Text to 3D / Image to 3D 생성은 Phase 5에서 생성 엔진(로컬/Meshy/Tripo)과 연결됩니다. 현재는 생성 기능이 없습니다."
      >
        모델 생성
      </Button>
      <Button
        variant="primary"
        icon={<Download size={14} />}
        onClick={() => void exportScene()}
        disabled={!hasContent || !!busy}
        title="씬 전체를 GLB 파일로 내보내기 (결과물 공유용 — 프로젝트 저장과는 별개)"
      >
        내보내기 (GLB)
      </Button>
    </header>
  );
}
