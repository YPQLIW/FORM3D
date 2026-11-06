import { Bot, History, ScrollText } from 'lucide-react';
import { Tabs } from '../ui/Tabs';
import { useAppStore, type BottomTab } from '../../state/appStore';
import { AssistantPanel } from '../panels/AssistantPanel';
import { HistoryPanel } from '../panels/HistoryPanel';
import { LogPanel } from '../panels/LogPanel';

const TABS = [
  { id: 'ai' as BottomTab, label: 'AI Assistant', icon: <Bot size={12} /> },
  { id: 'history' as BottomTab, label: '명령 실행 내역', icon: <History size={12} /> },
  { id: 'log' as BottomTab, label: '작업 로그', icon: <ScrollText size={12} /> },
];

export function BottomPanel() {
  const tab = useAppStore((s) => s.bottomTab);
  const setTab = useAppStore((s) => s.setBottomTab);
  return (
    <section className="flex h-52 shrink-0 flex-col border-t border-line bg-panel">
      <Tabs tabs={TABS} value={tab} onChange={setTab} />
      <div className="min-h-0 flex-1 overflow-auto">
        {tab === 'ai' && <AssistantPanel />}
        {tab === 'history' && <HistoryPanel />}
        {tab === 'log' && <LogPanel />}
      </div>
    </section>
  );
}
