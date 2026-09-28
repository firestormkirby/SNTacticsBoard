/**
 * A browser stand-in for the native floating palette
 * (android/app/src/main/java/com/snsoccer/palette).
 *
 * It installs itself as NativeModules.SoccerPalette, answers the same calls,
 * and sends the same "SoccerPalette" events, so the plugin's real controller
 * (src/palette/controller.ts) does the real page work against the simulated
 * note. The strip, the drag ghost and the move layer mirror the Kotlin views:
 * same controls, same order, same rules.
 *
 * The mouse plays both parts: dragging on the palette or in move mode is the
 * finger; dragging anywhere else on the page is the pen.
 */
import React, { useEffect, useReducer, useRef, useState } from 'react';
import { DeviceEventEmitter, NativeModules } from 'react-native';

import PieceGlyph from '../../../src/components/PieceGlyph';
import type { PieceKind } from '../../../src/page/pieceShapes';

type Side = 'left' | 'right';
interface MovePiece { id: string; kind: PieceKind; x: number; y: number }

const KINDS: PieceKind[] = ['attacker', 'defender', 'cone', 'ball'];
const ACTIONS: Array<[string, string]> = [
  ['move', 'Move'], ['copy', 'Copy'], ['pitch', 'Pitch'], ['hide', 'Hide'],
];
const TILE = 60;
const PAD = 6;
const GRIP = 30;
const ACTION_H = 48;
const WIDTH = TILE + 2 * PAD;
const HEIGHT = PAD + GRIP + KINDS.length * TILE + PAD + ACTIONS.length * ACTION_H + PAD;
const MARGIN = 8;

const state = {
  permission: false,
  showing: false,
  side: 'right' as Side,
  y: null as number | null,
  pieceSize: 63,
  move: null as null | { pieces: MovePiece[]; size: number },
};
const listeners = new Set<() => void>();
function set(patch: Partial<typeof state>) {
  Object.assign(state, patch);
  for (const fn of listeners) fn();
}

/** Start state for a scenario. */
export function setPaletteState(patch: Partial<typeof state>) {
  set(patch);
}

const screen = () => ({
  screenWidth: window.innerWidth, screenHeight: window.innerHeight, rotation: 0,
});
function emit(event: Record<string, unknown>) {
  DeviceEventEmitter.emit('SoccerPalette', event);
}

function paletteRect() {
  const x = state.side === 'left' ? MARGIN : window.innerWidth - WIDTH - MARGIN;
  const y = Math.max(0, Math.min(window.innerHeight - HEIGHT, state.y ?? (window.innerHeight - HEIGHT) / 2));
  return { x, y, w: WIDTH, h: HEIGHT };
}

NativeModules.SoccerPalette = {
  canDrawOverlays: async () => state.permission,
  requestOverlayPermission: () => {
    // The system settings screen, in one step.
    set({ permission: true });
    window.dispatchEvent(new CustomEvent('preview-toast', {
      detail: 'Preview: "Display over other apps" allowed for the plugin host.',
    }));
  },
  getScreenInfo: async () => ({
    width: window.innerWidth, height: window.innerHeight, density: 1, rotation: 0,
  }),
  show: async (o: { side?: Side; y?: number; pieceSize?: number }) => {
    if (!state.permission) return false;
    set({
      showing: true,
      side: o.side ?? state.side,
      y: o.y ?? state.y,
      pieceSize: o.pieceSize ?? state.pieceSize,
    });
    return true;
  },
  hide: () => set({ showing: false, move: null }),
  isShowing: async () => state.showing,
  setMoveMode: (enabled: boolean, pieces: MovePiece[], size: number) =>
    set({ move: enabled ? { pieces, size } : null }),
};

function useStore() {
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    listeners.add(redraw);
    return () => { listeners.delete(redraw); };
  }, []);
}

const abs = (x: number, y: number, w: number, h: number): React.CSSProperties => ({
  position: 'absolute', left: x, top: y, width: w, height: h,
});

function Glyph({ kind, size }: { kind: PieceKind; size: number }) {
  return (
    <div style={{ width: size, height: size, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <PieceGlyph kind={kind} size={size} />
    </div>
  );
}

function Strip() {
  const r = paletteRect();
  const [ghost, setGhost] = useState<{ kind: PieceKind; x: number; y: number } | null>(null);
  const [grip, setGrip] = useState<{ x: number; y: number } | null>(null);
  const [pressed, setPressed] = useState<string | null>(null);
  const x = grip?.x ?? r.x;
  const y = grip?.y ?? r.y;
  const inside = (cx: number, cy: number) => cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h;

  return (
    <>
      <div style={{ ...abs(x, y, WIDTH, HEIGHT), background: '#fff', border: '2px solid #000', boxSizing: 'border-box', zIndex: 50, userSelect: 'none', touchAction: 'none' }}>
        <div
          title="Drag to move the palette"
          style={{ ...abs(PAD, PAD, TILE, GRIP), cursor: 'grab', display: 'flex', alignItems: 'center', justifyContent: 'center', font: '20px system-ui', background: grip ? '#000' : '#fff', color: grip ? '#fff' : '#000' }}
          onPointerDown={e => {
            (e.target as Element).setPointerCapture(e.pointerId);
            setGrip({ x: r.x, y: r.y });
          }}
          onPointerMove={e => grip && setGrip({ x: e.clientX - WIDTH / 2, y: e.clientY - PAD - GRIP / 2 })}
          onPointerUp={e => {
            if (!grip) return;
            const side: Side = e.clientX < window.innerWidth / 2 ? 'left' : 'right';
            const top = Math.round(Math.max(0, Math.min(window.innerHeight - HEIGHT, grip.y)));
            setGrip(null);
            set({ side, y: top });
            emit({ type: 'position', side, y: top });
          }}
        >⠿</div>
        {KINDS.map((kind, i) => (
          <div
            key={kind}
            title="Drag onto the page"
            style={{ ...abs(PAD, PAD + GRIP + i * TILE, TILE, TILE), cursor: 'grab', display: 'flex', alignItems: 'center', justifyContent: 'center', background: pressed === kind ? '#000' : '#fff' }}
            onPointerDown={e => {
              (e.target as Element).setPointerCapture(e.pointerId);
              setPressed(kind);
              setGhost({ kind, x: e.clientX, y: e.clientY });
            }}
            onPointerMove={e => ghost && setGhost({ kind, x: e.clientX, y: e.clientY })}
            onPointerUp={e => {
              setPressed(null);
              setGhost(null);
              if (inside(e.clientX, e.clientY)) {
                emit({ type: 'tapPiece', kind });
              } else {
                emit({ type: 'drop', kind, toolType: 1, x: e.clientX, y: e.clientY, ...screen() });
              }
            }}
          >
            <Glyph kind={kind} size={Math.round(TILE * 0.62)} />
          </div>
        ))}
        {ACTIONS.map(([action, label], i) => (
          <button
            key={action}
            style={{ ...abs(PAD, 2 * PAD + GRIP + KINDS.length * TILE + i * ACTION_H, TILE, ACTION_H), border: 0, borderTop: '1px solid #000', background: '#fff', color: '#000', font: '700 15px system-ui', cursor: 'pointer', padding: 0 }}
            onClick={() => {
              if (action === 'hide') set({ showing: false, move: null });
              emit({ type: 'action', action });
            }}
          >{label}</button>
        ))}
      </div>
      {ghost && (
        <div style={{ ...abs(ghost.x - state.pieceSize / 2, ghost.y - state.pieceSize / 2, state.pieceSize, state.pieceSize), pointerEvents: 'none', zIndex: 60 }}>
          <Glyph kind={ghost.kind} size={state.pieceSize} />
        </div>
      )}
    </>
  );
}

function MoveLayer({ pieces, size }: { pieces: MovePiece[]; size: number }) {
  const [drag, setDrag] = useState<{ id: string; x: number; y: number; downX: number; downY: number } | null>(null);
  const [local, setLocal] = useState(pieces);
  const layer = useRef<HTMLDivElement>(null);
  useEffect(() => setLocal(pieces), [pieces]);

  const trash = paletteRect();
  const inTrash = (x: number, y: number) =>
    x >= trash.x && x <= trash.x + trash.w && y >= trash.y && y <= trash.y + trash.h;
  const hit = Math.max(size * 1.3, 56);
  const BANNER = 64;

  return (
    <div
      ref={layer}
      style={{ position: 'absolute', inset: 0, zIndex: 70, touchAction: 'none', userSelect: 'none' }}
      onPointerDown={e => {
        const target = [...local].reverse().find(p => Math.abs(p.x - e.clientX) <= hit / 2 && Math.abs(p.y - e.clientY) <= hit / 2);
        if (!target) return;
        layer.current!.setPointerCapture(e.pointerId);
        setDrag({ id: target.id, x: e.clientX, y: e.clientY, downX: e.clientX, downY: e.clientY });
      }}
      onPointerMove={e => drag && setDrag({ ...drag, x: e.clientX, y: e.clientY })}
      onPointerUp={e => {
        if (!drag) return;
        setDrag(null);
        if (inTrash(e.clientX, e.clientY)) {
          setLocal(local.filter(p => p.id !== drag.id));
          emit({ type: 'remove', id: drag.id });
        } else if (Math.hypot(e.clientX - drag.downX, e.clientY - drag.downY) > 8) {
          setLocal(local.map(p => (p.id === drag.id ? { ...p, x: e.clientX, y: e.clientY } : p)));
          emit({ type: 'move', id: drag.id, toolType: 1, x: e.clientX, y: e.clientY, ...screen() });
        }
      }}
    >
      <div style={{ ...abs(0, 0, window.innerWidth, BANNER), background: '#fff', borderBottom: '3px solid #000', display: 'flex', alignItems: 'center', gap: 16, padding: '0 12px 0 16px', boxSizing: 'border-box', font: '19px system-ui', color: '#000' }}>
        <span style={{ flex: 1 }}>Drag pieces with your finger. Drop one on the palette to remove it.</span>
        <button
          style={{ height: 44, width: 120, background: '#000', color: '#fff', border: 0, font: '700 19px system-ui', cursor: 'pointer' }}
          onPointerDown={e => e.stopPropagation()}
          onClick={() => { set({ move: null }); emit({ type: 'action', action: 'moveDone' }); }}
        >Done</button>
      </div>
      <div style={{ ...abs(trash.x, trash.y, trash.w, trash.h), boxSizing: 'border-box', border: '3px solid #000', background: drag && inTrash(drag.x, drag.y) ? '#000' : '#fff', color: drag && inTrash(drag.x, drag.y) ? '#fff' : '#000', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ transform: 'rotate(-90deg)', whiteSpace: 'nowrap', font: '19px system-ui' }}>Drop here to remove</span>
      </div>
      {local.map(p => (drag?.id === p.id ? (
        <div key={p.id} style={{ ...abs(p.x - size / 2 - 2, p.y - size / 2 - 2, size + 4, size + 4), background: '#fff' }} />
      ) : (
        <div key={p.id} style={{ ...abs(p.x - hit / 2, p.y - hit / 2, hit, hit), border: '2px dashed #000', boxSizing: 'border-box', pointerEvents: 'none' }} />
      )))}
      {drag && (
        <div style={{ ...abs(drag.x - size / 2, drag.y - size / 2, size, size), pointerEvents: 'none' }}>
          <Glyph kind={local.find(p => p.id === drag.id)?.kind ?? 'ball'} size={size} />
        </div>
      )}
    </div>
  );
}

/** Mounted by the harness above the panel and the note (config.Overlay). */
export default function PaletteOverlay() {
  useStore();
  return (
    <>
      {state.showing && <Strip />}
      {state.move && <MoveLayer pieces={state.move.pieces} size={state.move.size} />}
    </>
  );
}
