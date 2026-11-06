import { useEffect, useState } from 'react';
import { FolderOpen, History, ImageOff, Pencil, RefreshCw, ServerOff } from 'lucide-react';
import { formatBytes } from '@form3d/shared';
import { useAppStore } from '../../state/appStore';
import { useProjectStore } from '../../state/projectStore';
import { useEngineRevision } from '../../state/engine';
import { api, type ProjectMeta, type VersionMeta } from '../../lib/api';
import {
  isProjectDirty,
  openServerProject,
  openVersion,
  refreshRecent,
  refreshServer,
  renameStoredProject,
} from '../../lib/project';
import { EmptyState } from '../ui/Section';

const time = (iso: string | number) =>
  new Date(iso).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

function Thumb({ p }: { p: ProjectMeta }) {
  const [broken, setBroken] = useState(false);
  if (!p.hasThumbnail || broken)
    return (
      <div className="flex h-12 w-20 shrink-0 items-center justify-center rounded bg-bg text-muted">
        <ImageOff size={14} />
      </div>
    );
  return <img src={api.thumbnailUrl(p)} alt="" onError={() => setBroken(true)} className="h-12 w-20 shrink-0 rounded bg-bg object-cover" />;
}

function Versions({ id }: { id: string }) {
  const [list, setList] = useState<VersionMeta[] | null>(null);
  useEffect(() => {
    api.versions(id).then(setList, () => setList([]));
  }, [id]);
  if (!list) return <p className="px-2 py-1 text-[10px] text-muted">불러오는 중…</p>;
  if (!list.length) return <p className="px-2 py-1 text-[10px] text-muted">아직 이전 버전이 없습니다 (두 번째 저장부터 쌓입니다).</p>;
  return (
    <ul className="mt-1 space-y-0.5" data-testid="version-list">
      {list.map((v) => (
        <li key={v.id} className="flex items-center gap-2 rounded px-2 py-0.5 text-[10px] hover:bg-white/5">
          <span className="flex-1">{time(v.savedAt)}</span>
          <span className="text-muted">{formatBytes(v.size)}</span>
          <button type="button" className="text-accent hover:underline" onClick={() => void openVersion(id, v.id, time(v.savedAt))}>
            열기
          </button>
        </li>
      ))}
    </ul>
  );
}

/** 프로젝트 탭: 현재 프로젝트 상태 + 최근 프로젝트 목록 (로컬 서버 저장소) */
export function ProjectList() {
  useEngineRevision();
  const projectName = useAppStore((s) => s.projectName);
  const { server, health, projectId, lastSavedAt, recent, recentLoading } = useProjectStore();
  const [showVersions, setShowVersions] = useState(false);
  const dirty = isProjectDirty();

  useEffect(() => {
    void refreshRecent();
  }, []);

  return (
    <div className="space-y-2 p-2">
      <div className="rounded-md border border-accent/50 bg-accent/10 px-2 py-1.5" data-testid="current-project">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[12px] text-white">{projectName}</span>
          {dirty && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />}
        </div>
        <div className="mt-0.5 text-[10px] text-muted">
          {projectId ? '프로젝트 저장소' : '아직 저장소에 저장하지 않음'}
          {' · '}
          {dirty ? '저장하지 않은 변경 있음' : lastSavedAt ? `저장됨 ${time(lastSavedAt)}` : '변경 없음'}
        </div>
        {projectId && server === 'online' && (
          <button
            type="button"
            className="mt-1 flex items-center gap-1 text-[10px] text-accent hover:underline"
            onClick={() => setShowVersions(!showVersions)}
          >
            <History size={11} /> 버전 기록 {showVersions ? '닫기' : '보기'}
          </button>
        )}
        {showVersions && projectId && <Versions id={projectId} />}
      </div>

      {server === 'offline' && (
        <div className="rounded-md border border-line bg-panel-2 px-2 py-2 text-[11px] leading-relaxed text-muted" data-testid="server-offline">
          <div className="mb-1 flex items-center gap-1.5 text-amber-300">
            <ServerOff size={13} /> 로컬 서버가 꺼져 있습니다
          </div>
          프로젝트 저장소·최근 목록은 로컬 서버가 필요합니다. 터미널에서 한 번 <code className="text-text">npm run setup</code> 후{' '}
          <code className="text-text">npm run dev</code>로 실행하세요. 서버 없이도 [파일] 메뉴의 “.form3d 파일로 내려받기 / 열기”는 사용할 수 있습니다.
          <button type="button" onClick={() => void refreshServer()} className="mt-1 flex items-center gap-1 text-accent hover:underline">
            <RefreshCw size={11} /> 다시 확인
          </button>
        </div>
      )}

      {server === 'online' && (
        <>
          <div className="flex items-center justify-between px-1">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">최근 프로젝트</span>
            <button type="button" title="새로 고침" onClick={() => void refreshRecent()} className="text-muted hover:text-text">
              <RefreshCw size={12} className={recentLoading ? 'animate-spin' : ''} />
            </button>
          </div>
          {recent.length === 0 ? (
            <EmptyState>저장된 프로젝트가 없습니다. 상단 “저장”(Ctrl+S)을 누르면 여기에 추가됩니다.</EmptyState>
          ) : (
            <ul className="space-y-1" data-testid="recent-projects">
              {recent.map((p) => (
                <li
                  key={p.id}
                  data-project-id={p.id}
                  className={`group flex gap-2 rounded-md border p-1.5 ${p.id === projectId ? 'border-accent/60 bg-accent/5' : 'border-line hover:border-accent/40'}`}
                >
                  <Thumb p={p} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12px] text-white" title={p.name}>
                      {p.name}
                    </div>
                    <div className="text-[10px] text-muted">
                      {time(p.updatedAt)} · 오브젝트 {p.objects} · {formatBytes(p.size)}
                    </div>
                    <div className="mt-0.5 flex gap-2 text-[10px]">
                      <button
                        type="button"
                        className="flex items-center gap-0.5 text-accent hover:underline disabled:opacity-40"
                        disabled={p.id === projectId && !dirty}
                        onClick={() => void openServerProject(p.id)}
                      >
                        <FolderOpen size={11} /> {p.id === projectId ? '다시 열기' : '열기'}
                      </button>
                      <button
                        type="button"
                        className="flex items-center gap-0.5 text-muted hover:text-text"
                        onClick={() => void renameStoredProject(p.id, p.name)}
                      >
                        <Pencil size={11} /> 이름 바꾸기
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {health && <p className="break-all px-1 text-[10px] text-muted">저장 위치: {health.dataDir}</p>}
        </>
      )}
    </div>
  );
}
