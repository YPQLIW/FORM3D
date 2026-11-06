import { FolderOpen } from 'lucide-react';
import { formatBytes } from '@form3d/shared';
import { engine, useEngineRevision } from '../../state/engine';
import { useAppStore } from '../../state/appStore';
import { EmptyState } from '../ui/Section';
import { FileImportButton } from './FileImportButton';

/** 이번 세션에서 불러온 파일 목록 + 불러오기 */
export function FileBrowser() {
  useEngineRevision();
  const files = useAppStore((s) => s.importedFiles);
  return (
    <div className="space-y-2 p-2">
      <FileImportButton label="파일 열기 (.glb / .gltf / .obj)" icon={<FolderOpen size={14} />} className="w-full justify-center" />
      <p className="px-1 text-[10px] leading-relaxed text-muted">
        뷰포트에 파일을 끌어다 놓아도 됩니다. 외부 .bin·텍스처를 쓰는 .gltf, .mtl·텍스처를 쓰는 .obj는 관련 파일을 함께 선택하세요.
      </p>
      {files.length === 0 ? (
        <div className="px-1">
          <EmptyState>이번 세션에서 불러온 파일이 없습니다.</EmptyState>
        </div>
      ) : (
        <ul className="space-y-1">
          {[...files].reverse().map((f) => {
            const inScene = !!engine.getObject(f.objectId);
            return (
              <li key={f.id}>
                <button
                  type="button"
                  disabled={!inScene}
                  onClick={() => engine.select(f.objectId)}
                  className="w-full rounded-md border border-line bg-panel-2 px-2 py-1.5 text-left enabled:hover:border-accent/50 disabled:opacity-50"
                >
                  <div className="truncate text-[12px]">{f.fileName}</div>
                  <div className="text-[10px] text-muted">
                    {formatBytes(f.size)} · {new Date(f.time).toLocaleTimeString('en-GB', { hour12: false })}
                    {inScene ? '' : ' · 씬에서 삭제됨'}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
