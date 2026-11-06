import { useRef, useState } from 'react';
import { Check, ChevronDown, Download, FilePlus2, FileUp, FolderOpen, Save, SaveAll } from 'lucide-react';
import { FORM3D_EXTENSION } from '@form3d/editor-core';
import { Button } from '../ui/Button';
import { useAppStore } from '../../state/appStore';
import { useProjectStore } from '../../state/projectStore';
import { downloadProjectFile, newProject, openLocalProjectFile, saveCurrent } from '../../lib/project';

function Item({
  icon,
  label,
  shortcut,
  onClick,
  disabled,
  testId,
}: {
  icon?: React.ReactNode;
  label: string;
  shortcut?: string;
  onClick: () => void;
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <button
      role="menuitem"
      type="button"
      disabled={disabled}
      data-testid={testId}
      onClick={onClick}
      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] hover:bg-accent/20 disabled:opacity-40 disabled:hover:bg-transparent"
    >
      <span className="w-4 text-muted">{icon}</span>
      <span className="flex-1">{label}</span>
      {shortcut && <span className="text-[10px] text-muted">{shortcut}</span>}
    </button>
  );
}

/** 파일 메뉴: 새 프로젝트 / 열기 / 저장 / 다른 이름으로 저장 / 내 컴퓨터 파일 / 자동 저장 */
export function FileMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const busy = useAppStore((s) => s.busy);
  const setLeftTab = useAppStore((s) => s.setLeftTab);
  const server = useProjectStore((s) => s.server);
  const autoSave = useProjectStore((s) => s.autoSave);
  const setP = useProjectStore((s) => s.set);
  const run = (fn: () => unknown) => {
    setOpen(false);
    void fn();
  };
  return (
    <div
      ref={ref}
      className="relative"
      onBlur={(e) => {
        if (!ref.current?.contains(e.relatedTarget as Node)) setOpen(false);
      }}
    >
      <Button variant="ghost" onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="menu" data-testid="file-menu">
        파일 <ChevronDown size={12} />
      </Button>
      {open && (
        <div role="menu" className="absolute left-0 top-8 z-50 w-72 rounded-md border border-line bg-panel-2 py-1 shadow-xl">
          <Item icon={<FilePlus2 size={13} />} label="새 프로젝트" onClick={() => run(newProject)} disabled={!!busy} testId="menu-new" />
          <Item
            icon={<FolderOpen size={13} />}
            label="프로젝트 열기 (최근 목록)"
            onClick={() => run(() => setLeftTab('projects'))}
            disabled={server !== 'online'}
            testId="menu-open"
          />
          <div className="my-1 h-px bg-line" />
          <Item icon={<Save size={13} />} label="저장" shortcut="Ctrl+S" onClick={() => run(() => saveCurrent())} disabled={!!busy} testId="menu-save" />
          <Item
            icon={<SaveAll size={13} />}
            label="다른 이름으로 저장"
            shortcut="Ctrl+Shift+S"
            onClick={() => run(() => saveCurrent({ saveAs: true }))}
            disabled={!!busy}
            testId="menu-save-as"
          />
          <div className="my-1 h-px bg-line" />
          <Item
            icon={<Download size={13} />}
            label="내 컴퓨터에 .form3d 파일로 내려받기"
            onClick={() => run(() => downloadProjectFile())}
            disabled={!!busy}
            testId="menu-download"
          />
          <Item
            icon={<FileUp size={13} />}
            label="내 컴퓨터의 .form3d 파일 열기"
            onClick={() => run(() => fileRef.current?.click())}
            disabled={!!busy}
            testId="menu-open-file"
          />
          <div className="my-1 h-px bg-line" />
          <Item
            icon={autoSave ? <Check size={13} className="text-emerald-400" /> : undefined}
            label="자동 저장 (2분마다, 저장소 프로젝트)"
            onClick={() => run(() => setP({ autoSave: !autoSave }))}
            testId="menu-autosave"
          />
          {server !== 'online' && (
            <p className="px-3 pb-1 pt-1.5 text-[10px] leading-relaxed text-amber-300/90">
              로컬 서버가 꺼져 있어 “저장”은 .form3d 파일 내려받기로 동작합니다. 서버 실행: npm run setup → npm run dev
            </p>
          )}
        </div>
      )}
      <input
        ref={fileRef}
        type="file"
        accept={`${FORM3D_EXTENSION},application/zip`}
        className="hidden"
        data-testid="project-file-input"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void openLocalProjectFile(f);
        }}
      />
    </div>
  );
}
