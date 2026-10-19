import { useRef, useState } from 'react';
import type { Artboard, SceneNode } from '../../core/types';
import { childrenOf, makeGroup } from '../../core/document';
import {
  getState,
  select,
  setActiveArtboard,
  setIsolation,
  setUi,
  useActiveDoc,
  useEditor,
  type OpenDoc,
} from '../../state/store';
import * as A from '../../state/actions';
import { Icon } from '../icons';
import { NodeIcon } from './Design';
import { Tip } from '../controls/Tooltip';
import { inDocOrder } from '../../state/actions';

type Drop = { id: string; where: 'before' | 'after' | 'inside' } | null;

let dragId: string | null = null;

function matches(n: SceneNode, q: string): boolean {
  if (!q) return true;
  if (n.name.toLowerCase().includes(q)) return true;
  return childrenOf(n).some((c) => matches(c, q));
}

function Row({
  n,
  depth,
  od,
  ab,
  parentId,
  index,
  siblings,
  expanded,
  toggle,
  filter,
  drop,
  setDrop,
}: {
  n: SceneNode;
  depth: number;
  od: OpenDoc;
  ab: Artboard;
  parentId: string | null;
  index: number;
  siblings: SceneNode[];
  expanded: Set<string>;
  toggle(id: string): void;
  filter: string;
  drop: Drop;
  setDrop(d: Drop): void;
}) {
  const [renaming, setRenaming] = useState(false);
  const kids = n.type === 'clipGroup' ? [n.clip, ...n.children] : childrenOf(n);
  const open = expanded.has(n.id) || !!filter;
  const selected = od.selection.includes(n.id);
  const container = n.type === 'group' || n.type === 'boolean' || n.type === 'clipGroup';
  const cls = [
    'layer-row',
    selected ? 'selected' : '',
    n.visible ? '' : 'hidden-node',
    drop?.id === n.id ? `drop-${drop.where}` : '',
  ].join(' ');
  return (
    <>
      <div
        className={cls}
        role="treeitem"
        aria-selected={selected}
        aria-expanded={kids.length ? open : undefined}
        aria-level={depth + 2}
        style={{ paddingLeft: 8 + (depth + 1) * 16 }}
        draggable={!renaming}
        onDragStart={(e) => {
          dragId = n.id;
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', n.name);
        }}
        onDragOver={(e) => {
          if (!dragId || dragId === n.id) return;
          e.preventDefault();
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          const y = (e.clientY - r.top) / r.height;
          // Rows list front-most first, so "before" in the list means "in front of" in the document.
          setDrop({
            id: n.id,
            where: container && y > 0.3 && y < 0.7 ? 'inside' : y < 0.5 ? 'before' : 'after',
          });
        }}
        onDragLeave={() => setDrop(null)}
        onDrop={(e) => {
          e.preventDefault();
          const d = drop;
          setDrop(null);
          if (!dragId || !d) return;
          if (d.where === 'inside')
            A.moveNodeTo(dragId, { parentId: n.id, artboardId: ab.id, index: childrenOf(n).length });
          else
            A.moveNodeTo(dragId, {
              parentId,
              artboardId: ab.id,
              index: d.where === 'before' ? index + 1 : index,
            });
          dragId = null;
        }}
        onClick={(e) => {
          setActiveArtboard(ab.id);
          if (e.shiftKey && od.selection.length) {
            const ids = siblings.map((s) => s.id);
            const last = ids.indexOf(od.selection[od.selection.length - 1]);
            const cur = ids.indexOf(n.id);
            if (last >= 0) {
              const [a, b] = last < cur ? [last, cur] : [cur, last];
              select([...new Set([...od.selection, ...ids.slice(a, b + 1)])]);
              return;
            }
          }
          if (e.metaKey || e.ctrlKey)
            select(selected ? od.selection.filter((x) => x !== n.id) : [...od.selection, n.id]);
          else {
            if (parentId && od.isolation !== parentId) setIsolation(null);
            select([n.id]);
          }
        }}
        onDoubleClick={() => setRenaming(true)}
      >
        {kids.length ? (
          <button
            className="twisty"
            aria-label={open ? 'Collapse' : 'Expand'}
            onClick={(e) => {
              e.stopPropagation();
              toggle(n.id);
            }}
          >
            <Icon name={open ? 'chevronDown' : 'chevronRight'} size={12} />
          </button>
        ) : (
          <span style={{ width: 14 }} />
        )}
        <NodeIcon n={n} />
        <span className="layer-name">
          {renaming ? (
            <input
              autoFocus
              defaultValue={n.name}
              aria-label="Layer name"
              onClick={(e) => e.stopPropagation()}
              onBlur={(e) => {
                A.renameNode(n.id, e.target.value);
                setRenaming(false);
              }}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                if (e.key === 'Escape') setRenaming(false);
              }}
            />
          ) : (
            n.name
          )}
        </span>
        <Tip label={n.locked ? 'Unlock' : 'Lock'}>
          <button
            className={`icon-btn sm toggle ${n.locked ? 'on' : ''}`}
            aria-label={n.locked ? 'Unlock' : 'Lock'}
            onClick={(e) => {
              e.stopPropagation();
              A.setLocked(n.id, !n.locked);
            }}
          >
            <Icon name={n.locked ? 'lock' : 'unlock'} size={13} />
          </button>
        </Tip>
        <Tip label={n.visible ? 'Hide (⌥-click to solo)' : 'Show'}>
          <button
            className={`icon-btn sm toggle ${!n.visible ? 'on' : ''}`}
            aria-label={n.visible ? 'Hide' : 'Show'}
            onClick={(e) => {
              e.stopPropagation();
              if (e.altKey) A.soloVisibility(n.id);
              else A.setVisibility(n.id, !n.visible);
            }}
          >
            <Icon name={n.visible ? 'eye' : 'eyeOff'} size={13} />
          </button>
        </Tip>
      </div>
      {open &&
        [...kids]
          .map((c, i) => ({ c, i }))
          .reverse()
          .filter(({ c }) => matches(c, filter))
          .map(({ c, i }) => (
            <Row
              key={c.id}
              n={c}
              depth={depth + 1}
              od={od}
              ab={ab}
              parentId={n.id}
              index={i}
              siblings={kids}
              expanded={expanded}
              toggle={toggle}
              filter={filter}
              drop={drop}
              setDrop={setDrop}
            />
          ))}
    </>
  );
}

export function LayersPanel() {
  const od = useActiveDoc();
  const height = useEditor((s) => s.ui.layersHeight);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [collapsedAb, setCollapsedAb] = useState<Set<string>>(() => new Set());
  const [filter, setFilter] = useState('');
  const [drop, setDrop] = useState<Drop>(null);
  const resize = useRef<{ y: number; h: number } | null>(null);
  if (!od) return null;
  const q = filter.trim().toLowerCase();
  const toggle = (id: string) => {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpanded(next);
  };
  return (
    <section className="layers" aria-label="Layers" style={{ height }}>
      <div
        className="layers-resize"
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize layers panel"
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          resize.current = { y: e.clientY, h: height };
        }}
        onPointerMove={(e) => {
          if (!resize.current) return;
          setUi({
            layersHeight: Math.max(
              120,
              Math.min(window.innerHeight - 260, resize.current.h - (e.clientY - resize.current.y)),
            ),
          });
        }}
        onPointerUp={() => (resize.current = null)}
      />
      <div className="layers-head">
        <h3>Layers</h3>
        <input
          className="layers-filter"
          placeholder="Filter"
          aria-label="Filter layers"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <Tip label="New layer">
          <button
            className="icon-btn sm"
            aria-label="New layer"
            onClick={() => {
              const s = getState();
              const d = s.docs.find((x) => x.key === s.activeKey)!;
              const sel = inDocOrder(d.doc, d.selection);
              if (sel.length) A.groupSelection();
              else {
                const ab = d.doc.artboards.find((a) => a.id === d.activeArtboard) ?? d.doc.artboards[0];
                const g = makeGroup([], `Layer ${ab.children.length + 1}`);
                g.transform = [1, 0, 0, 1, ab.x, ab.y];
                A.addNode(g, 'New layer');
              }
            }}
          >
            <Icon name="plus" />
          </button>
        </Tip>
      </div>
      <div className="layers-list" role="tree" aria-label="Layer tree">
        {od.doc.artboards.map((ab) => {
          const abOpen = !collapsedAb.has(ab.id);
          return (
            <div key={ab.id} role="group">
              <div
                className={`layer-row artboard ${drop?.id === ab.id ? 'drop-inside' : ''}`}
                role="treeitem"
                aria-expanded={abOpen}
                aria-level={1}
                aria-selected={false}
                style={{ paddingLeft: 8 }}
                onClick={() => {
                  setActiveArtboard(ab.id);
                  select([]);
                }}
                onDragOver={(e) => {
                  if (!dragId) return;
                  e.preventDefault();
                  setDrop({ id: ab.id, where: 'inside' });
                }}
                onDragLeave={() => setDrop(null)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDrop(null);
                  if (dragId)
                    A.moveNodeTo(dragId, { parentId: null, artboardId: ab.id, index: ab.children.length });
                  dragId = null;
                }}
              >
                <button
                  className="twisty"
                  aria-label={abOpen ? 'Collapse' : 'Expand'}
                  onClick={(e) => {
                    e.stopPropagation();
                    const n = new Set(collapsedAb);
                    if (abOpen) n.add(ab.id);
                    else n.delete(ab.id);
                    setCollapsedAb(n);
                  }}
                >
                  <Icon name={abOpen ? 'chevronDown' : 'chevronRight'} size={12} />
                </button>
                <Icon name="artboard" size={14} stroke={1.7} />
                <span
                  className="layer-name"
                  style={{ color: ab.id === od.activeArtboard ? 'var(--fg)' : 'var(--muted)' }}
                >
                  {ab.name}
                </span>
              </div>
              {abOpen &&
                [...ab.children]
                  .map((c, i) => ({ c, i }))
                  .reverse()
                  .filter(({ c }) => matches(c, q))
                  .map(({ c, i }) => (
                    <Row
                      key={c.id}
                      n={c}
                      depth={0}
                      od={od}
                      ab={ab}
                      parentId={null}
                      index={i}
                      siblings={ab.children}
                      expanded={expanded}
                      toggle={toggle}
                      filter={q}
                      drop={drop}
                      setDrop={setDrop}
                    />
                  ))}
            </div>
          );
        })}
      </div>
    </section>
  );
}
