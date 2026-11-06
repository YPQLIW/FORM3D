import { useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent as ReactMouseEvent } from 'react';
import {
  Box,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Copy,
  Eye,
  EyeOff,
  Group as GroupIcon,
  Layers,
  Search,
  Trash2,
  Ungroup,
  X,
} from 'lucide-react';
import type { Object3D } from 'three';
import type { SceneNodeInfo } from '@form3d/model-types';
import { engine, useEngineRevision } from '../../state/engine';
import { useAppStore } from '../../state/appStore';
import {
  canUngroupSelection,
  deleteSelected,
  duplicateSelected,
  groupSelected,
  moveInHierarchy,
  renameObject,
  toggleVisibility,
  ungroupSelected,
} from '../../lib/actions';
import { EmptyState } from '../ui/Section';
import { IconButton } from '../ui/Button';

const DND_MIME = 'application/x-form3d-node';
type DropPos = 'before' | 'inside' | 'after';

interface Row {
  node: SceneNodeInfo;
  depth: number;
  open: boolean;
}

function matches(node: SceneNodeInfo, q: string): boolean {
  return node.name.toLowerCase().includes(q) || node.children.some((c) => matches(c, q));
}

/** id까지의 조상 id 목록 */
function ancestorsOf(nodes: SceneNodeInfo[], id: string, path: string[] = []): string[] | null {
  for (const n of nodes) {
    if (n.id === id) return path;
    const r = ancestorsOf(n.children, id, [...path, n.id]);
    if (r) return r;
  }
  return null;
}

/**
 * 씬 계층 구조 (Phase 2)
 * - 클릭 선택, Ctrl+클릭 추가/제외, Shift+클릭 범위 선택
 * - 드래그 앤 드롭: 위/아래 가장자리 = 순서 변경, 가운데 = 하위로 넣기, 빈 영역 = 최상위로
 * - 더블클릭/F2 이름 변경, 우클릭 메뉴, 이름 검색, 모두 펼치기/접기, ↑↓←→ 키 탐색
 */
export function SceneHierarchy() {
  useEngineRevision();
  const nodes = engine.getHierarchy();
  const selectedIds = engine.getSelectedIds();
  const activeId = engine.getSelectedId();
  const log = useAppStore((s) => s.log);

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [query, setQuery] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string | null; pos: DropPos } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const anchor = useRef<string | null>(null);
  const dragging = useRef<Object3D[]>([]);
  const treeRef = useRef<HTMLUListElement>(null);

  const q = query.trim().toLowerCase();
  const isOpen = (n: SceneNodeInfo, depth: number) => (q ? true : (expanded[n.id] ?? depth === 0));

  const rows = useMemo(() => {
    const out: Row[] = [];
    const walk = (list: SceneNodeInfo[], depth: number) => {
      for (const n of list) {
        if (q && !matches(n, q)) continue;
        const open = isOpen(n, depth);
        out.push({ node: n, depth, open });
        if (open && n.children.length) walk(n.children, depth + 1);
      }
    };
    walk(nodes, 0);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, expanded, q]);

  // 뷰포트에서 하위 메시를 선택하면 조상 노드를 자동으로 펼침
  const selKey = selectedIds.join(',');
  useEffect(() => {
    const add: Record<string, boolean> = {};
    for (const id of selectedIds) for (const a of ancestorsOf(nodes, id) ?? []) if (!expanded[a]) add[a] = true;
    if (Object.keys(add).length) setExpanded((e) => ({ ...e, ...add }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selKey]);

  // 선택된 행이 보이도록 스크롤
  useEffect(() => {
    if (!activeId) return;
    const el = treeRef.current?.querySelector(`[data-node-id="${activeId}"]`) as HTMLElement | null;
    // 일부 브라우저는 scrollIntoView가 Promise를 반환하므로 반환값을 쓰지 않음
    if (el) void el.scrollIntoView({ block: 'nearest' });
  }, [activeId]);

  // 우클릭 메뉴 닫기
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  const setOpen = (id: string, open: boolean) => setExpanded((e) => ({ ...e, [id]: open }));
  const setAll = (open: boolean) => {
    const all: Record<string, boolean> = {};
    const walk = (list: SceneNodeInfo[]) =>
      list.forEach((n) => {
        if (n.children.length) all[n.id] = open;
        walk(n.children);
      });
    walk(nodes);
    setExpanded(all);
  };

  const onRowClick = (e: ReactMouseEvent, id: string) => {
    if (e.shiftKey && anchor.current) {
      const ids = rows.map((r) => r.node.id);
      const a = ids.indexOf(anchor.current);
      const b = ids.indexOf(id);
      if (a >= 0 && b >= 0) {
        const range = a <= b ? ids.slice(a, b + 1) : ids.slice(b, a + 1).reverse();
        // 클릭한 항목이 활성 오브젝트가 되도록 마지막에 둠
        engine.setSelection([...range.filter((x) => x !== id), id]);
        return;
      }
    }
    if (e.ctrlKey || e.metaKey) engine.toggleSelection(id);
    else engine.select(id);
    anchor.current = id;
  };

  // ---------- 드래그 앤 드롭 ----------
  const canDropOn = (target: Object3D, objs: Object3D[] = dragging.current) =>
    objs.length > 0 &&
    objs.every((d) => {
      let p: Object3D | null = target;
      while (p) {
        if (p === d) return false;
        p = p.parent;
      }
      return true;
    });

  const dropPosFor = (e: DragEvent<HTMLElement>): DropPos => {
    const r = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - r.top;
    return y < r.height * 0.25 ? 'before' : y > r.height * 0.75 ? 'after' : 'inside';
  };

  const performDrop = (targetId: string | null, pos: DropPos) => {
    const objs = dragging.current;
    dragging.current = [];
    setDrop(null);
    if (objs.length === 0) return;
    if (targetId === null) {
      moveInHierarchy(objs, engine.root, null);
      return;
    }
    const target = engine.getObject(targetId);
    if (!target || !canDropOn(target, objs)) return;
    if (pos === 'inside') {
      moveInHierarchy(objs, target, null);
      setOpen(target.uuid, true);
      return;
    }
    const parent = target.parent ?? engine.root;
    let before: Object3D | null = target;
    if (pos === 'after') {
      const sibs = parent.children;
      before = null;
      for (let i = sibs.indexOf(target) + 1; i < sibs.length; i++) {
        if (!objs.includes(sibs[i])) {
          before = sibs[i];
          break;
        }
      }
    }
    moveInHierarchy(objs, parent, before);
  };

  // ---------- 키보드 탐색 ----------
  const onTreeKey = (e: React.KeyboardEvent) => {
    if (renaming) return;
    const idx = rows.findIndex((r) => r.node.id === activeId);
    const row = rows[idx];
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = rows[Math.max(0, Math.min(rows.length - 1, idx + (e.key === 'ArrowDown' ? 1 : -1)))];
      if (next) {
        engine.select(next.node.id);
        anchor.current = next.node.id;
      }
    } else if (e.key === 'ArrowRight' && row?.node.children.length) {
      e.preventDefault();
      setOpen(row.node.id, true);
    } else if (e.key === 'ArrowLeft' && row) {
      e.preventDefault();
      if (row.open && row.node.children.length) setOpen(row.node.id, false);
      else {
        const parentId = ancestorsOf(nodes, row.node.id)?.at(-1);
        if (parentId) engine.select(parentId);
      }
    } else if (e.key === 'F2' && activeId) {
      e.preventDefault();
      setRenaming(activeId);
    }
  };

  const contextObj = engine.getSelected();
  const contextParent = contextObj?.parent;

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-8 shrink-0 items-center justify-between pl-3 pr-1 text-[11px] text-muted">
        <span>Scene Hierarchy</span>
        <div className="flex">
          <IconButton label="복제 (Ctrl+D)" className="!h-6 !w-6" onClick={duplicateSelected} disabled={!activeId}>
            <Copy size={12} />
          </IconButton>
          <IconButton label="그룹으로 묶기 (Ctrl+G)" className="!h-6 !w-6" onClick={groupSelected} disabled={!activeId}>
            <GroupIcon size={12} />
          </IconButton>
          <IconButton
            label="그룹 해제 (Ctrl+Shift+G)"
            className="!h-6 !w-6"
            onClick={ungroupSelected}
            disabled={!canUngroupSelection()}
          >
            <Ungroup size={12} />
          </IconButton>
          <IconButton label="선택 항목 삭제 (Delete)" className="!h-6 !w-6" onClick={deleteSelected} disabled={!activeId}>
            <Trash2 size={12} />
          </IconButton>
        </div>
      </div>

      {nodes.length > 0 && (
        <div className="flex shrink-0 items-center gap-1 px-2 pb-1">
          <label className="flex h-6 min-w-0 flex-1 items-center gap-1 rounded border border-line bg-bg px-1.5 focus-within:border-accent">
            <Search size={11} className="shrink-0 text-muted" />
            <input
              aria-label="씬 검색"
              placeholder="이름으로 검색"
              className="h-full min-w-0 flex-1 bg-transparent text-[11px] outline-none placeholder:text-muted"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
            />
            {query && (
              <button type="button" aria-label="검색 지우기" className="text-muted hover:text-text" onClick={() => setQuery('')}>
                <X size={11} />
              </button>
            )}
          </label>
          <IconButton label="모두 펼치기" className="!h-6 !w-6" onClick={() => setAll(true)}>
            <ChevronsUpDown size={12} />
          </IconButton>
          <IconButton label="모두 접기" className="!h-6 !w-6" onClick={() => setAll(false)}>
            <ChevronsDownUp size={12} />
          </IconButton>
        </div>
      )}

      <div
        className="min-h-0 flex-1 overflow-auto px-1 pb-2"
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes(DND_MIME)) return;
          e.preventDefault();
          setDrop({ id: null, pos: 'inside' });
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrop(null);
        }}
        onDrop={(e) => {
          if (!e.dataTransfer.types.includes(DND_MIME)) return;
          e.preventDefault();
          performDrop(null, 'inside');
        }}
      >
        {nodes.length === 0 ? (
          <div className="px-2">
            <EmptyState>씬이 비어 있습니다. 상단의 “도형 추가” 또는 “모델 불러오기”로 시작하세요.</EmptyState>
          </div>
        ) : rows.length === 0 ? (
          <div className="px-2">
            <EmptyState>“{query}”와 일치하는 오브젝트가 없습니다.</EmptyState>
          </div>
        ) : (
          <ul
            ref={treeRef}
            role="tree"
            aria-label="Scene Hierarchy"
            aria-multiselectable
            tabIndex={0}
            onKeyDown={onTreeKey}
            className={`outline-none ${drop?.id === null ? 'rounded ring-1 ring-accent/60' : ''}`}
          >
            {rows.map(({ node, depth, open }) => {
              const selected = selectedIds.includes(node.id);
              const active = node.id === activeId;
              const hasChildren = node.children.length > 0;
              const dropHere = drop?.id === node.id ? drop.pos : null;
              return (
                <li key={node.id} role="none" className="relative">
                  {dropHere === 'before' && <div className="pointer-events-none absolute inset-x-1 top-0 h-0.5 bg-accent" />}
                  {dropHere === 'after' && <div className="pointer-events-none absolute inset-x-1 bottom-0 h-0.5 bg-accent" />}
                  <div
                    role="treeitem"
                    aria-selected={selected}
                    aria-expanded={hasChildren ? open : undefined}
                    aria-level={depth + 1}
                    data-node-name={node.name}
                    data-node-id={node.id}
                    draggable={renaming !== node.id}
                    onClick={(e) => onRowClick(e, node.id)}
                    onDoubleClick={() => setRenaming(node.id)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      if (!selected) engine.select(node.id);
                      setMenu({ x: e.clientX, y: e.clientY });
                    }}
                    onDragStart={(e) => {
                      const obj = engine.getObject(node.id);
                      if (!obj) return;
                      if (!selected) engine.select(node.id);
                      dragging.current = selected ? engine.getTopLevelSelection() : [obj];
                      e.dataTransfer.setData(DND_MIME, node.id);
                      e.dataTransfer.effectAllowed = 'move';
                    }}
                    onDragEnd={() => {
                      dragging.current = [];
                      setDrop(null);
                    }}
                    onDragOver={(e) => {
                      if (!e.dataTransfer.types.includes(DND_MIME)) return;
                      e.stopPropagation();
                      const target = engine.getObject(node.id);
                      if (!target || !canDropOn(target)) {
                        setDrop(null);
                        return;
                      }
                      e.preventDefault();
                      const pos = dropPosFor(e);
                      if (drop?.id !== node.id || drop.pos !== pos) setDrop({ id: node.id, pos });
                    }}
                    onDrop={(e) => {
                      if (!e.dataTransfer.types.includes(DND_MIME)) return;
                      e.preventDefault();
                      e.stopPropagation();
                      performDrop(node.id, dropPosFor(e));
                    }}
                    className={
                      'group flex h-6 cursor-pointer items-center gap-1 rounded pr-1 ' +
                      (active
                        ? 'bg-accent/30 text-white'
                        : selected
                          ? 'bg-accent/15 text-white'
                          : 'hover:bg-white/5') +
                      (dropHere === 'inside' ? ' ring-1 ring-inset ring-accent' : '') +
                      (node.visible ? '' : ' opacity-50')
                    }
                    style={{ paddingLeft: depth * 12 + 4 }}
                  >
                    <button
                      type="button"
                      aria-label={open ? '접기' : '펼치기'}
                      tabIndex={-1}
                      className={`flex h-4 w-4 items-center justify-center text-muted ${hasChildren ? '' : 'invisible'}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpen(node.id, !open);
                      }}
                    >
                      {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    </button>
                    {node.kind.includes('Mesh') ? (
                      <Box size={12} className="shrink-0 text-accent" />
                    ) : (
                      <Layers size={12} className="shrink-0 text-accent-2" />
                    )}
                    {renaming === node.id ? (
                      <RenameInput
                        initial={node.name}
                        onDone={(name) => {
                          setRenaming(null);
                          const obj = engine.getObject(node.id);
                          if (obj && name !== null) renameObject(obj, name);
                          treeRef.current?.focus();
                        }}
                      />
                    ) : (
                      <span className="min-w-0 flex-1 truncate">{node.name}</span>
                    )}
                    {hasChildren && !open && <span className="text-[9px] text-muted">{node.children.length}</span>}
                    <span className="hidden text-[9px] text-muted group-hover:inline">{node.kind}</span>
                    <button
                      type="button"
                      tabIndex={-1}
                      aria-label={node.visible ? '숨기기' : '표시하기'}
                      className="flex h-5 w-5 items-center justify-center text-muted hover:text-text"
                      onClick={(e) => {
                        e.stopPropagation();
                        const obj = engine.getObject(node.id);
                        if (obj) toggleVisibility(obj);
                      }}
                    >
                      {node.visible ? <Eye size={12} /> : <EyeOff size={12} />}
                    </button>
                  </div>
                  {/* 자식은 평탄화된 rows에서 들여쓰기로 표시 */}
                </li>
              );
            })}
          </ul>
        )}
        {nodes.length > 0 && (
          <p className="mt-2 px-2 text-[10px] leading-relaxed text-muted/70">
            Ctrl/Shift+클릭: 여러 개 선택 · 드래그: 순서/부모 변경 · 더블클릭: 이름 변경 · 우클릭: 메뉴
          </p>
        )}
      </div>

      {menu && contextObj && (
        <div
          role="menu"
          aria-label="오브젝트 메뉴"
          className="fixed z-50 w-48 rounded-md border border-line bg-panel-2 py-1 shadow-xl"
          style={{ left: menu.x, top: menu.y }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {[
            { label: '이름 바꾸기', key: 'F2', run: () => setRenaming(contextObj.uuid), on: selectedIds.length === 1 },
            { label: '복제', key: 'Ctrl+D', run: duplicateSelected, on: true },
            { label: '그룹으로 묶기', key: 'Ctrl+G', run: groupSelected, on: true },
            { label: '그룹 해제', key: 'Ctrl+Shift+G', run: ungroupSelected, on: canUngroupSelection() },
            {
              label: '최상위로 꺼내기',
              key: '',
              run: () => moveInHierarchy(engine.getTopLevelSelection(), engine.root, null),
              on: !!contextParent && contextParent !== engine.root,
            },
            { label: '카메라 맞추기', key: 'F', run: () => useAppStore.getState().requestFrame(), on: true },
            {
              label: contextObj.visible ? '숨기기' : '표시하기',
              key: '',
              run: () => toggleVisibility(contextObj),
              on: true,
            },
            { label: '삭제', key: 'Del', run: deleteSelected, on: true },
          ].map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={!item.on}
              className="flex w-full items-center justify-between px-3 py-1.5 text-left text-[12px] hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
              onClick={() => {
                setMenu(null);
                try {
                  item.run();
                } catch (err) {
                  log('error', (err as Error).message);
                }
              }}
            >
              {item.label}
              <span className="text-[10px] text-muted">{item.key}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function RenameInput({ initial, onDone }: { initial: string; onDone: (name: string | null) => void }) {
  const [v, setV] = useState(initial);
  const done = useRef(false);
  const finish = (name: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(name);
  };
  return (
    <input
      autoFocus
      aria-label="새 이름"
      className="h-5 min-w-0 flex-1 rounded border border-accent bg-bg px-1 text-[12px] outline-none"
      value={v}
      maxLength={120}
      onFocus={(e) => e.target.select()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onChange={(e) => setV(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') finish(v);
        if (e.key === 'Escape') finish(null);
      }}
      onBlur={() => finish(v)}
    />
  );
}
