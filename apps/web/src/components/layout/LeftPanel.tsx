import { Boxes, FileBox, FolderKanban, ListTree } from 'lucide-react';
import { Tabs } from '../ui/Tabs';
import { useAppStore, type LeftTab } from '../../state/appStore';
import { SceneHierarchy } from '../panels/SceneHierarchy';
import { ModelList } from '../panels/ModelList';
import { ProjectList } from '../panels/ProjectList';
import { FileBrowser } from '../panels/FileBrowser';

const TABS = [
  { id: 'scene' as LeftTab, label: '씬', icon: <ListTree size={12} /> },
  { id: 'models' as LeftTab, label: '모델', icon: <Boxes size={12} /> },
  { id: 'projects' as LeftTab, label: '프로젝트', icon: <FolderKanban size={12} /> },
  { id: 'files' as LeftTab, label: '파일', icon: <FileBox size={12} /> },
];

export function LeftPanel() {
  const tab = useAppStore((s) => s.leftTab);
  const setTab = useAppStore((s) => s.setLeftTab);
  return (
    <aside className="flex min-h-0 w-[272px] shrink-0 flex-col border-r border-line bg-panel">
      <Tabs tabs={TABS} value={tab} onChange={setTab} stretch />
      <div className="min-h-0 flex-1 overflow-auto">
        {tab === 'scene' && <SceneHierarchy />}
        {tab === 'models' && <ModelList />}
        {tab === 'projects' && <ProjectList />}
        {tab === 'files' && <FileBrowser />}
      </div>
    </aside>
  );
}
