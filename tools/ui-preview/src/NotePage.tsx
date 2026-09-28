/**
 * A stand-in for the Note app: draws the current page of the in-memory note
 * (mocks/note.ts), under the plugin panel and any overlay windows.
 *
 * - The page's template: a captured image when the plugin made one, else
 *   blank.
 * - Geometry elements (lines, circles, polygons) as the note would draw them.
 * - Pen strokes. Drag the mouse on the page to write, as with the pen; they
 *   are stored as elements like any other, so copying a page copies them.
 *
 * Plain DOM rather than React Native: this is the harness, not the plugin.
 */
import React, { useEffect, useReducer, useRef, useState } from 'react';

import { CURRENT_PAGE } from './mocks/sn-plugin-lib';
import {
  MockElement, MockPoint, NOTE, addElements, goToPage, imageFor, onNoteChange,
} from './mocks/note';

const TOOLBAR_H = 56;

function Template({ path }: { path: string }) {
  const holder = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const img = imageFor(path);
    const el = holder.current;
    if (!el) return;
    if (!img) {
      el.replaceChildren();
      return;
    }
    const node = img.node.cloneNode(true) as HTMLElement;
    const scale = CURRENT_PAGE.pageSize.width / img.width;
    Object.assign(node.style, {
      position: 'absolute', left: '0', top: '0', margin: '0',
      width: `${img.width}px`, height: `${img.height}px`,
      transformOrigin: 'top left', transform: `scale(${scale})`,
    });
    el.replaceChildren(node);
  }, [path]);
  return <div ref={holder} style={{ position: 'absolute', inset: 0, overflow: 'hidden' }} />;
}

function Shape({ el }: { el: MockElement }) {
  const common = { stroke: '#000', strokeWidth: 2, fill: 'none', strokeLinecap: 'round' as const };
  if (el.previewStroke) {
    return (
      <polyline
        {...common}
        strokeWidth={3}
        strokeLinejoin="round"
        points={el.previewStroke.map(p => `${p.x},${p.y}`).join(' ')}
      />
    );
  }
  const g = el.geometry as (MockElement['geometry'] & { penWidth?: number }) | null | undefined;
  if (!g) return null;
  // Width in page pixels, assuming penWidth is in hundredths of a pixel (the
  // SDK only says it must be at least 100). Check against a device.
  const w = Math.max(1, (g.penWidth ?? 200) / 100);
  if (g.type === 'GEO_circle' && g.ellipseCenterPoint) {
    return (
      <circle
        {...common}
        strokeWidth={w}
        cx={g.ellipseCenterPoint.x}
        cy={g.ellipseCenterPoint.y}
        r={g.ellipseMajorAxisRadius ?? 0}
      />
    );
  }
  const pts = (g.points ?? []).map(p => `${p.x},${p.y}`).join(' ');
  if (g.type === 'straightLine') return <polyline {...common} strokeWidth={w} points={pts} />;
  if (g.type === 'GEO_polygon') return <polygon {...common} strokeWidth={w} strokeLinejoin="round" points={pts} />;
  return null;
}

export default function NotePage({ pluginName, onOpenPlugin }: {
  pluginName: string;
  /** Tapping the plugin's toolbar button. */
  onOpenPlugin: () => void;
}) {
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const [drawing, setDrawing] = useState<MockPoint[] | null>(null);
  const svg = useRef<SVGSVGElement>(null);

  useEffect(() => onNoteChange(redraw), []);

  const page = NOTE.pages[NOTE.current];
  if (!page) return null;
  const { width, height } = CURRENT_PAGE.pageSize;

  const at = (e: React.PointerEvent): MockPoint => {
    const r = svg.current!.getBoundingClientRect();
    return { x: Math.round(e.clientX - r.left), y: Math.round(e.clientY - r.top) };
  };

  return (
    <div style={{ position: 'absolute', inset: 0, background: '#fff', userSelect: 'none' }}>
      <Template path={page.template} />
      <svg
        ref={svg}
        width={width}
        height={height}
        style={{ position: 'absolute', left: 0, top: 0, cursor: 'crosshair', touchAction: 'none' }}
        onPointerDown={e => {
          (e.target as Element).setPointerCapture(e.pointerId);
          setDrawing([at(e)]);
        }}
        onPointerMove={e => drawing && setDrawing([...drawing, at(e)])}
        onPointerUp={() => {
          if (drawing && drawing.length > 1) {
            addElements(NOTE.current, [{ type: 0, layerNum: 0, previewStroke: drawing }]);
          }
          setDrawing(null);
        }}
      >
        {page.elements.map(el => <Shape key={el.numInPage} el={el} />)}
        {drawing && (
          <polyline
            stroke="#000" strokeWidth={3} fill="none" strokeLinecap="round" strokeLinejoin="round"
            points={drawing.map(p => `${p.x},${p.y}`).join(' ')}
          />
        )}
      </svg>

      <div
        style={{
          position: 'absolute', left: 0, right: 0, top: 0, height: TOOLBAR_H,
          display: 'flex', alignItems: 'center', gap: 12, padding: '0 16px',
          background: '#fff', borderBottom: '2px solid #000',
          font: '600 17px/1 system-ui, sans-serif', color: '#000',
        }}
      >
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {CURRENT_PAGE.filePath.split('/').pop()} · the pen is your mouse
        </span>
        <button style={btn} onClick={() => goToPage(NOTE.current - 1)} aria-label="Previous page">‹</button>
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>
          {NOTE.current + 1} / {NOTE.pages.length}
        </span>
        <button style={btn} onClick={() => goToPage(NOTE.current + 1)} aria-label="Next page">›</button>
        <button style={{ ...btn, background: '#000', color: '#fff' }} onClick={onOpenPlugin}>
          {pluginName}
        </button>
      </div>
    </div>
  );
}

const btn: React.CSSProperties = {
  font: 'inherit', border: '2px solid #000', background: '#fff', color: '#000',
  padding: '6px 12px', borderRadius: 6, cursor: 'pointer',
};
