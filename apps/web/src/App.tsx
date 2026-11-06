import { TopBar } from './components/layout/TopBar';
import { LeftPanel } from './components/layout/LeftPanel';
import { RightPanel } from './components/layout/RightPanel';
import { BottomPanel } from './components/layout/BottomPanel';
import { StatusBar } from './components/layout/StatusBar';
import { Viewport } from './components/viewport/Viewport';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import { useShortcuts } from './hooks/useShortcuts';
import { DialogHost } from './components/ui/DialogHost';
import { AISettingsDialog } from './components/settings/AISettingsDialog';
import { RecoveryDialog } from './components/ui/RecoveryDialog';
import { useEffect } from 'react';
import { startProjectServices } from './lib/project';
import { startBridge } from './lib/bridge';

export default function App() {
  useShortcuts();
  useEffect(() => {
    startProjectServices();
    startBridge();
  }, []);
  return (
    <div className="flex h-full flex-col">
      <ErrorBoundary name="상단 메뉴">
        <TopBar />
      </ErrorBoundary>
      <div className="flex min-h-0 flex-1">
        <ErrorBoundary name="왼쪽 패널">
          <LeftPanel />
        </ErrorBoundary>
        <div className="flex min-w-0 flex-1 flex-col">
          <ErrorBoundary name="3D 뷰포트">
            <Viewport />
          </ErrorBoundary>
          <ErrorBoundary name="하단 패널">
            <BottomPanel />
          </ErrorBoundary>
        </div>
        <ErrorBoundary name="속성 패널">
          <RightPanel />
        </ErrorBoundary>
      </div>
      <StatusBar />
      <RecoveryDialog />
      <AISettingsDialog />
      <DialogHost />
    </div>
  );
}
