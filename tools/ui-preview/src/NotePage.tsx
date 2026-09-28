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
 * No toolbar: the page fills the screen, as it does on a device, where the
 * Note app's own toolbar turns pages and opens plugins. Keys stand in for it:
 * PageUp / PageDown (or the arrow keys) turn the page, P opens the plugin.
 *
 * Plain DOM rather than React Native: this is the harness, not the plugin.
 */
import React, { useEffect, useReducer, useRef, useState } from 'react';

import { CURRENT_PAGE } from './mocks/sn-plugin-lib';
import {
  MockElement, MockPoint, NOTE, addElements, goToPage, imageFor, onNoteChange,
} from './mocks/note';

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

export default function NotePage({ onOpenPlugin }: {
  /** The Note app's toolbar button for the plugin (the P key here). */
  onOpenPlugin: () => void;
}) {
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const [drawing, setDrawing] = useState<MockPoint[] | null>(null);
  const svg = useRef<SVGSVGElement>(null);

  useEffect(() => onNoteChange(redraw), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.key === 'PageDown' || e.key === 'ArrowRight' || e.key === 'ArrowDown') goToPage(NOTE.current + 1);
      else if (e.key === 'PageUp' || e.key === 'ArrowLeft' || e.key === 'ArrowUp') goToPage(NOTE.current - 1);
      else if (e.key === 'p' || e.key === 'P') onOpenPlugin();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onOpenPlugin]);

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
    </div>
  );
}
