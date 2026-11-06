import { useRef, useState } from 'react';
import { Canvas, type ThreeEvent } from '@react-three/fiber';
import { GizmoHelper, GizmoViewport, Grid, OrbitControls } from '@react-three/drei';
import { ACESFilmicToneMapping } from 'three';
import { engine } from '../../state/engine';
import { useAppStore } from '../../state/appStore';
import { importFiles, resolvePickTarget } from '../../lib/actions';
import { SceneEnvironment } from './SceneEnvironment';
import { SelectionTools } from './SelectionTools';
import { CameraController } from './CameraController';
import { ViewportToolbar } from './ViewportToolbar';

const CLICK_TOLERANCE_PX = 4;

export function Viewport() {
  const showGrid = useAppStore((s) => s.showGrid);
  const dragReadout = useAppStore((s) => s.dragReadout);
  const gizmoBusy = useRef(false);
  const downPos = useRef<{ x: number; y: number } | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const isClick = (x: number, y: number) => {
    const d = downPos.current;
    return !!d && Math.hypot(x - d.x, y - d.y) <= CLICK_TOLERANCE_PX;
  };

  const onObjectClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (gizmoBusy.current || !isClick(e.nativeEvent.clientX, e.nativeEvent.clientY)) return;
    const id = resolvePickTarget(e.object).uuid;
    // Ctrl / Shift + 클릭: 여러 개 선택 (이미 선택된 것은 해제)
    if (e.nativeEvent.ctrlKey || e.nativeEvent.metaKey || e.nativeEvent.shiftKey) engine.toggleSelection(id);
    else engine.select(id);
  };

  return (
    <div
      className="relative min-h-0 min-w-0 flex-1 bg-[#14171c]"
      data-testid="viewport"
      onPointerDownCapture={(e) => (downPos.current = { x: e.clientX, y: e.clientY })}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        void importFiles(Array.from(e.dataTransfer.files));
      }}
    >
      <ViewportToolbar />
      <Canvas
        shadows="percentage"
        dpr={[1, 2]}
        camera={{ position: [4, 3, 5], fov: 50, near: 0.01, far: 2000 }}
        gl={{ antialias: true, preserveDrawingBuffer: true, toneMapping: ACESFilmicToneMapping }}
        onPointerMissed={(e) => {
          if (gizmoBusy.current || !isClick(e.clientX, e.clientY)) return;
          if (e.ctrlKey || e.metaKey || e.shiftKey) return; // 다중 선택 중 빈 곳 클릭은 유지
          engine.select(null);
        }}
      >
        <color attach="background" args={['#14171c']} />
        <SceneEnvironment />
        {showGrid && (
          <Grid
            infiniteGrid
            cellSize={0.5}
            sectionSize={2.5}
            cellThickness={0.6}
            sectionThickness={1}
            cellColor="#2a2f3a"
            sectionColor="#3b4252"
            fadeDistance={80}
            fadeStrength={1.5}
          />
        )}
        <primitive object={engine.root} onClick={onObjectClick} />
        <SelectionTools gizmoBusy={gizmoBusy} />
        <CameraController />
        <OrbitControls makeDefault enableDamping dampingFactor={0.12} />
        <GizmoHelper alignment="bottom-right" margin={[64, 64]}>
          <GizmoViewport axisColors={['#f87171', '#4ade80', '#60a5fa']} labelColor="#0f1115" />
        </GizmoHelper>
      </Canvas>
      <div className="pointer-events-none absolute bottom-2 left-3 text-[10px] text-muted/80">
        좌클릭 드래그: 회전 · 우클릭 드래그: 이동 · 휠: 확대/축소 · 클릭: 선택 · Ctrl/Shift+클릭: 여러 개 선택 · W/E/R:
        이동/회전/크기 · F: 맞추기 · 1~6, 0: 시점 · Ctrl+D: 복제 · Ctrl+G: 그룹 · Del: 삭제
      </div>
      {dragReadout && (
        <div
          data-testid="drag-readout"
          className="pointer-events-none absolute left-1/2 top-14 -translate-x-1/2 rounded-md border border-line bg-panel/90 px-2.5 py-1 font-mono text-[11px] text-text shadow-lg backdrop-blur"
        >
          {dragReadout}
        </div>
      )}
      {dragOver && (
        <div className="pointer-events-none absolute inset-2 flex items-center justify-center rounded-lg border-2 border-dashed border-accent bg-accent/10 text-[13px] text-white">
          GLB / GLTF / OBJ 파일을 놓아 불러오기 (.mtl·텍스처는 함께 놓기)
        </div>
      )}
    </div>
  );
}
