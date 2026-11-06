import { Loader2 } from 'lucide-react';
import { computeStats } from '@form3d/editor-core';
import { APP_VERSION, formatNumber } from '@form3d/shared';
import { engine, useEngineRevision } from '../../state/engine';
import { useAppStore } from '../../state/appStore';
import { useProjectStore } from '../../state/projectStore';
import { isProjectDirty } from '../../lib/project';

const hm = (t: number) => new Date(t).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });

function SaveStatus() {
  const { server, saving, lastSavedAt, lastAutoSnapshotAt, autoSave, projectId } = useProjectStore();
  const dirty = isProjectDirty();
  const serverDot = server === 'online' ? 'bg-emerald-400' : server === 'offline' ? 'bg-zinc-500' : 'bg-amber-400';
  return (
    <>
      <span className="flex items-center gap-1" data-testid="server-status" data-server={server}
        title={server === 'online' ? '로컬 서버 연결됨 (프로젝트 저장소·AI·외부 API 사용 가능)' : '로컬 서버 꺼짐 — npm run setup 후 npm run dev'}>
        <span className={`h-1.5 w-1.5 rounded-full ${serverDot}`} />
        서버 {server === 'online' ? '연결됨' : server === 'offline' ? '꺼짐' : '확인 중'}
      </span>
      <span data-testid="save-status">
        {saving
          ? '저장 중…'
          : dirty
            ? `저장 안 된 변경${lastAutoSnapshotAt ? ` · 복구용 기록 ${hm(lastAutoSnapshotAt)}` : ''}`
            : lastSavedAt
              ? `저장됨 ${hm(lastSavedAt)}`
              : '변경 없음'}
        {autoSave && projectId && server === 'online' ? ' · 자동 저장 켜짐' : ''}
      </span>
    </>
  );
}

export function StatusBar() {
  useEngineRevision();
  const busy = useAppStore((s) => s.busy);
  const lastLog = useAppStore((s) => s.logs[s.logs.length - 1]);
  const s = computeStats(engine.root);
  const sel = engine.getSelected();
  const selCount = engine.getSelectedIds().length;
  return (
    <footer className="flex h-6 shrink-0 items-center gap-4 border-t border-line bg-bg px-3 text-[10px] text-muted">
      <span className="flex items-center gap-1.5" data-testid="status">
        {busy ? (
          <>
            <Loader2 size={11} className="animate-spin text-accent" />
            <span className="text-text">{busy}</span>
          </>
        ) : (
          <>
            <span className={`h-1.5 w-1.5 rounded-full ${lastLog?.level === 'error' ? 'bg-red-400' : 'bg-emerald-400'}`} />
            준비됨
          </>
        )}
      </span>
      <span>오브젝트 {engine.root.children.length}</span>
      <span>메시 {formatNumber(s.meshes)}</span>
      <span>삼각형 {formatNumber(s.triangles)}</span>
      <span className="truncate">선택: {sel ? `${sel.name || sel.type}${selCount > 1 ? ` 외 ${selCount - 1}개` : ''}` : '없음'}</span>
      <span className="ml-auto flex items-center gap-4">
        <SaveStatus />
        <span>FORM3D v{APP_VERSION}</span>
      </span>
    </footer>
  );
}
