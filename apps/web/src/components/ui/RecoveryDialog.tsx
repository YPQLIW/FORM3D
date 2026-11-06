import { LifeBuoy } from 'lucide-react';
import { useProjectStore } from '../../state/projectStore';
import { discardRecovery, restoreRecovery } from '../../lib/project';
import { Button } from './Button';

/** 시작할 때 저장하지 않은 작업이 남아 있으면 복구 여부를 묻습니다 */
export function RecoveryDialog() {
  const snap = useProjectStore((s) => s.recovery);
  if (!snap) return null;
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60">
      <div role="dialog" aria-modal="true" aria-label="작업 복구" className="w-[420px] rounded-lg border border-amber-500/40 bg-panel shadow-2xl">
        <div className="flex items-center gap-2 border-b border-line px-4 py-3 text-[13px] font-semibold text-white">
          <LifeBuoy size={16} className="text-amber-400" /> 저장하지 않은 작업이 있습니다
        </div>
        <div className="space-y-1.5 px-4 py-3 text-[12px] leading-relaxed">
          <p>지난번에 저장하지 않고 닫힌 작업을 자동 기록에서 찾았습니다.</p>
          <dl className="grid grid-cols-[90px_1fr] gap-y-1 rounded border border-line bg-bg px-3 py-2 text-[11px]">
            <dt className="text-muted">프로젝트</dt>
            <dd className="truncate text-white" data-testid="recovery-name">{snap.name}</dd>
            <dt className="text-muted">기록 시각</dt>
            <dd>{new Date(snap.savedAt).toLocaleString('ko-KR')}</dd>
            <dt className="text-muted">오브젝트</dt>
            <dd>{snap.objects}개</dd>
          </dl>
          <p className="text-[11px] text-muted">복구한 뒤 저장(Ctrl+S)해야 프로젝트에 반영됩니다. “버리기”를 누르면 이 기록은 삭제됩니다.</p>
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-4 py-2.5">
          <Button variant="ghost" className="text-red-300" onClick={() => void discardRecovery()}>
            버리기
          </Button>
          <Button variant="primary" autoFocus onClick={() => void restoreRecovery()}>
            복구하기
          </Button>
        </div>
      </div>
    </div>
  );
}
