/**
 * A browser stand-in for the native floating button
 * (android/app/src/main/java/com/tacticsboard/palette/TacticsPaletteModule.kt).
 *
 * It installs itself as NativeModules.TacticsPalette, answers the same calls,
 * and sends the same "TacticsPalette" events, so the plugin's real controller
 * (src/palette/controller.ts) does the real page work against the simulated
 * note. Each native window is a div here, with the same sizes and rules:
 *
 *  BUTTON   Drag to move it. Click to open or close the palette. Hold 0.8 s
 *           to open the menu.
 *  PALETTE  Drag a piece out to place a new one.
 *  HANDLES  An invisible box over each piece. Drag it to move the piece; drop
 *           it on the button or the palette to remove it.
 *
 * Anywhere else, the mouse is the pen and draws on the page, as on a device.
 */
import React, { useState, useSyncExternalStore } from 'react';
import { DeviceEventEmitter, NativeModules } from 'react-native';

import PieceGlyph from '../../../src/components/PieceGlyph';
import type { PieceKind } from '../../../src/page/pieceShapes';

interface Handle { kind: PieceKind; x: number; y: number }
interface Rect { x: number; y: number; w: number; h: number }

const KINDS: PieceKind[] = ['attacker', 'defender', 'cone', 'ball'];
// dp and sp are CSS pixels here (the device presets are in dp).
const BUTTON = 40;
const TILE = 56;
const PAD = Math.floor(TILE / 10);
const TILES_W = TILE + 2 * PAD;
/** The name tag above the pieces, and the Save / Load / Reset rows below. */
const NAME_H = 26;
const ACTION_H = 34;
/** Save / Load / Reset the page; Trash takes pieces dragged onto it. */
const ACTIONS = ['Save', 'Load', 'Copy', 'Reset', 'Trash'] as const;
/** The trash gets a row of its own, as tall as a piece, below its own rule. */
const TRASH_H = TILE;
const PIECES_TOP = NAME_H + PAD;
const ACTIONS_TOP = PIECES_TOP + KINDS.length * TILE + PAD;
const TRASH_TOP = ACTIONS_TOP + (ACTIONS.length - 1) * ACTION_H + PAD;
const TILES_H = TRASH_TOP + TRASH_H + PAD;

/** Where each action's row starts in the palette, and how tall it is. */
const rowOf = (action: (typeof ACTIONS)[number]) =>
  action === 'Trash'
    ? { top: TRASH_TOP, h: TRASH_H }
    : { top: ACTIONS_TOP + ACTIONS.indexOf(action) * ACTION_H, h: ACTION_H };

/** The action at a height in the palette, if any. */
const actionAt = (y: number) =>
  ACTIONS.find(a => {
    const r = rowOf(a);
    return y >= r.top && y < r.top + r.h;
  });
/** The Load list, beside the palette. */
const LIST_W = 220;
const LIST_ROW = 44;
const ARMED_MS = 3000;
const LONG_PRESS_MS = 800;
const SLOP = 6;

const state = {
  permission: false,
  /** The button's top-left, or null when it isn't up. */
  button: null as null | { x: number; y: number },
  open: false,
  pieceSize: 63,
  handles: new Map<string, Handle>(),
  /** The handle being carried, and where its box is now. */
  carrying: null as null | { id: string; x: number; y: number },
  masks: [] as Rect[],
  ghost: null as null | { kind: PieceKind; x: number; y: number },
  tick: null as null | number,
  /** The name tag: the page's board, or Scratchpad. */
  pageName: 'Scratchpad',
  /** Saved boards, for the Load list. */
  boards: [] as Array<{ keyword: string; name: string }>,
  loadOpen: false,
  /** Reset or Trash, tapped once; a second tap within ARMED_MS acts. */
  armed: null as null | 'Reset' | 'Trash',
  /** A carried piece is over the trash: dropping it there removes it. */
  overTrash: false,
  /**
   * The plugin is working on the page, or was until WAITING_AFTER_MS ago:
   * hourglass, "Working…", pieces greyed and not to be grabbed.
   */
  waiting: false,
};
const WAITING_AFTER_MS = 1000;
let waitTimer: number | null = null;
const toast = (detail: string) =>
  window.dispatchEvent(new CustomEvent('preview-toast', { detail }));
const listeners = new Set<() => void>();
let version = 0;
function set(patch: Partial<typeof state>) {
  Object.assign(state, patch);
  version++;
  for (const fn of listeners) fn();
}

/** Start state for a scenario. */
export function setPaletteState(patch: Partial<typeof state>) {
  set(patch);
}

function emit(event: Record<string, unknown>) {
  DeviceEventEmitter.emit('TacticsPalette', event);
}
const point = (x: number, y: number, e: React.PointerEvent) => ({
  x, y,
  screenWidth: window.innerWidth,
  screenHeight: window.innerHeight,
  rotation: 0,
  toolType: e.pointerType === 'pen' ? 2 : 1,
});

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));
const inside = (r: Rect | null, x: number, y: number) =>
  !!r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

function buttonRect(): Rect | null {
  return state.button && { ...state.button, w: BUTTON, h: BUTTON };
}

/** Beside the button: below it, or above if there's no room. */
function tilesRect(): Rect | null {
  const b = state.button;
  if (!b || !state.open) return null;
  const gap = 6;
  const x = clamp(b.x + BUTTON / 2 - TILES_W / 2, 0, window.innerWidth - TILES_W);
  const below = b.y + BUTTON + gap;
  const y = below + TILES_H <= window.innerHeight ? below : Math.max(0, b.y - gap - TILES_H);
  return { x, y, w: TILES_W, h: TILES_H };
}

const overControls = (x: number, y: number) =>
  inside(buttonRect(), x, y) || inside(tilesRect(), x, y);

/** The trash row of the palette, where a dragged piece is dropped to remove it. */
function trashRect(): Rect | null {
  const t = tilesRect();
  if (!t) return null;
  const r = rowOf('Trash');
  return { x: t.x, y: t.y + r.top - 2, w: t.w, h: r.h };
}

const handleSize = () => Math.floor(state.pieceSize * 1.15);

function hideAll() {
  set({
    button: null, handles: new Map(), carrying: null, masks: [], ghost: null,
    loadOpen: false, armed: null,
  });
}

/** The Load list: left of the palette, or right if there's no room. */
function listRect(): Rect | null {
  const t = tilesRect();
  if (!t || !state.loadOpen) return null;
  const h = Math.max(1, state.boards.length) * LIST_ROW + NAME_H + 2 * PAD;
  const x = t.x - LIST_W - 6 >= 0 ? t.x - LIST_W - 6 : t.x + t.w + 6;
  const y = clamp(t.y + ACTIONS_TOP, 0, window.innerHeight - h);
  return { x, y, w: LIST_W, h };
}

function stopTick() {
  if (state.tick !== null) window.clearInterval(state.tick);
  state.tick = null;
}

NativeModules.TacticsPalette = {
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
  show: async (o: { x?: number; y?: number; open?: boolean; pieceSize?: number }) => {
    if (!state.permission) return false;
    const b = state.button ?? { x: window.innerWidth - BUTTON - 16, y: 120 };
    set({
      pieceSize: o.pieceSize ?? state.pieceSize,
      open: o.open ?? state.open,
      button: {
        x: clamp(o.x ?? b.x, 0, window.innerWidth - BUTTON),
        y: clamp(o.y ?? b.y, 0, window.innerHeight - BUTTON),
      },
    });
    return true;
  },
  hide: hideAll,
  isShowing: async () => state.button !== null,
  setPieces: (pieces: Array<Handle & { id: string }>, size: number) => {
    const handles = new Map<string, Handle>();
    if (state.button) {
      for (const p of pieces) handles.set(p.id, { kind: p.kind, x: p.x, y: p.y });
    }
    set({ pieceSize: Math.floor(size), handles, carrying: null, masks: [] });
  },
  startTicking: (ms: number) => {
    if (state.tick !== null) return;
    state.tick = window.setInterval(() => emit({ type: 'tick' }), Math.max(300, ms));
  },
  stopTicking: stopTick,
  // The native module draws this in its own window; the harness's toast will do.
  notify: (message: string) =>
    window.dispatchEvent(new CustomEvent('preview-toast', { detail: message })),
  setBusy: () => {},
  wait: (ms: number) => new Promise(done => window.setTimeout(() => done(null), ms)),
  setPageName: (name: string) => set({ pageName: name }),
  setWorking: (on: boolean) => {
    if (waitTimer !== null) window.clearTimeout(waitTimer);
    if (on) set({ waiting: true });
    else waitTimer = window.setTimeout(() => set({ waiting: false }), WAITING_AFTER_MS);
  },
  whenQuiet: () => Promise.resolve(null),
  setBoards: (boards: Array<{ keyword: string; name: string }>) => set({ boards }),
  // The browser has no folder to measure: the Manta's, after a clean-up.
  folderSize: () => Promise.resolve(27 * 1024 * 1024),
  addListener: () => {},
  removeListeners: () => {},
};

// useSyncExternalStore rather than a listener added in an effect: the panel
// hides the button from its own mount effect, which can run before an effect
// here would have subscribed, and that change would be missed.
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
};
function useStore() {
  useSyncExternalStore(subscribe, () => version);
}

const abs = (r: Rect): React.CSSProperties => ({
  position: 'absolute', left: r.x, top: r.y, width: r.w, height: r.h,
});

function Glyph({ kind, size }: { kind: PieceKind; size: number }) {
  return (
    <div style={{ width: size, height: size, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <PieceGlyph kind={kind} size={size} />
    </div>
  );
}

/** The plugin's icon, as Glyphs.drawPitchIcon draws it. */
function PitchIcon({ size, color }: { size: number; color: string }) {
  const w = size * 0.62;
  const h = size * 0.86;
  const bw = w * 0.5;
  const bh = h * 0.14;
  const sw = Math.max(2, size * 0.07);
  const l = (size - w) / 2;
  const t = (size - h) / 2;
  const c = size / 2;
  return (
    <svg width={size} height={size} style={{ display: 'block' }}>
      <g fill="none" stroke={color} strokeWidth={sw}>
        <rect x={l} y={t} width={w} height={h} />
        <line x1={l} y1={c} x2={l + w} y2={c} />
        <circle cx={c} cy={c} r={w * 0.2} />
        <rect x={c - bw / 2} y={t} width={bw} height={bh} />
        <rect x={c - bw / 2} y={t + h - bh} width={bw} height={bh} />
      </g>
    </svg>
  );
}

function Button() {
  const r = buttonRect()!;
  const [press, setPress] = useState<null | {
    downX: number; downY: number; startX: number; startY: number;
    dragging: boolean; longPressed: boolean; timer: number;
  }>(null);
  const stroke = Math.max(2, BUTTON * 0.05);
  const ink = state.open ? '#fff' : '#000';

  return (
    <div
      title="Click: pieces · drag: move · hold: menu"
      style={{
        ...abs(r), zIndex: 52, borderRadius: '50%', boxSizing: 'border-box',
        border: `${stroke}px solid #000`, background: state.open ? '#000' : '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer', touchAction: 'none', userSelect: 'none',
      }}
      onPointerDown={e => {
        (e.target as Element).setPointerCapture(e.pointerId);
        const timer = window.setTimeout(() => {
          setPress(p => p && { ...p, longPressed: true });
          emit({ type: 'longPress' });
        }, LONG_PRESS_MS);
        setPress({
          downX: e.clientX, downY: e.clientY, startX: r.x, startY: r.y,
          dragging: false, longPressed: false, timer,
        });
      }}
      onPointerMove={e => {
        if (!press || press.longPressed) return;
        const dx = e.clientX - press.downX;
        const dy = e.clientY - press.downY;
        const dragging = press.dragging || Math.abs(dx) > SLOP || Math.abs(dy) > SLOP;
        if (!dragging) return;
        if (!press.dragging) {
          window.clearTimeout(press.timer);
          setPress({ ...press, dragging: true });
        }
        set({
          button: {
            x: clamp(press.startX + dx, 0, window.innerWidth - BUTTON),
            y: clamp(press.startY + dy, 0, window.innerHeight - BUTTON),
          },
        });
      }}
      onPointerUp={() => {
        if (!press) return;
        window.clearTimeout(press.timer);
        setPress(null);
        if (press.longPressed || !state.button) return; // the hold opened the menu
        if (press.dragging) {
          emit({ type: 'position', x: Math.round(state.button.x), y: Math.round(state.button.y) });
        } else {
          set({ open: !state.open });
          emit({ type: 'open', open: state.open });
        }
      }}
    >
      {state.waiting ? (
        <span style={{ color: ink, font: `bold ${Math.round(BUTTON * 0.5)}px sans-serif` }}>⧗</span>
      ) : (
        <PitchIcon size={(BUTTON / 2 - stroke) * 1.25} color={ink} />
      )}
    </div>
  );
}

let armTimer: number | null = null;

/** Reset and Trash take two taps, as on the device: arm, then act. */
function twoTaps(action: 'Reset' | 'Trash', first: string, then: () => void) {
  if (armTimer !== null) window.clearTimeout(armTimer);
  if (state.armed !== action) {
    set({ armed: action, loadOpen: false });
    armTimer = window.setTimeout(() => set({ armed: null }), ARMED_MS);
    window.dispatchEvent(new CustomEvent('preview-toast', { detail: first }));
  } else {
    set({ armed: null });
    then();
  }
}

function onAction(action: (typeof ACTIONS)[number]) {
  if (action === 'Save') {
    set({ loadOpen: false, armed: null });
    emit({ type: 'save' });
  } else if (action === 'Load') {
    set({ loadOpen: !state.loadOpen, armed: null });
  } else if (action === 'Copy') {
    set({ loadOpen: false, armed: null });
    emit({ type: 'copy' });
  } else if (action === 'Trash') {
    twoTaps('Trash', 'Tap again to clear this page.', () => emit({ type: 'clear' }));
  } else {
    twoTaps('Reset', 'Tap again to reset this page.', () => emit({ type: 'reset' }));
  }
}

function Tiles() {
  const r = tilesRect()!;
  const [drag, setDrag] = useState<null | { kind: PieceKind; downX: number; downY: number }>(null);
  const [pressed, setPressed] = useState<string | null>(null);
  const line = Math.max(2, TILE * 0.04);

  return (
    <div
      style={{
        ...abs(r), zIndex: 52, background: '#fff', boxSizing: 'border-box',
        border: `${line}px solid #000`, touchAction: 'none', userSelect: 'none',
      }}
      onPointerDown={e => {
        const y = e.clientY - r.y;
        if (y >= ACTIONS_TOP) {
          const action = actionAt(y);
          if (action) setPressed(action);
          return;
        }
        const i = Math.floor((y - PIECES_TOP) / TILE);
        const kind = y >= PIECES_TOP ? KINDS[i] : undefined;
        if (!kind) return;
        if (state.waiting) {
          toast('One moment…');
          return;
        }
        (e.currentTarget as Element).setPointerCapture(e.pointerId);
        setDrag({ kind, downX: e.clientX, downY: e.clientY });
        set({ ghost: { kind, x: e.clientX, y: e.clientY } });
      }}
      onPointerMove={e => drag && set({ ghost: { kind: drag.kind, x: e.clientX, y: e.clientY } })}
      onPointerUp={e => {
        if (pressed) {
          const y = e.clientY - r.y;
          const action = y >= ACTIONS_TOP ? actionAt(y) : undefined;
          setPressed(null);
          if (action === pressed) onAction(action);
          return;
        }
        if (!drag) return;
        setDrag(null);
        set({ ghost: null });
        const moved = Math.abs(e.clientX - drag.downX) > 8 || Math.abs(e.clientY - drag.downY) > 8;
        if (moved && !overControls(e.clientX, e.clientY)) {
          emit({ type: 'drop', kind: drag.kind, ...point(e.clientX, e.clientY, e) });
        } else if (!moved) {
          emit({ type: 'tapPiece', kind: drag.kind });
        }
      }}
    >
      <div
        title={state.pageName}
        style={{
          position: 'absolute', left: 0, top: 0, width: TILES_W - 2 * line, height: NAME_H,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 3px',
          boxSizing: 'border-box', borderBottom: `${line}px solid #000`,
          font: 'bold 11px sans-serif', whiteSpace: 'nowrap', overflow: 'hidden',
          textOverflow: 'ellipsis', pointerEvents: 'none',
        }}
      >
        {state.waiting ? 'Working…' : state.pageName}
      </div>
      {KINDS.map((kind, i) => (
        <div
          key={kind}
          title="Drag onto the page"
          style={{
            position: 'absolute', left: PAD - 2, top: PIECES_TOP - 2 + i * TILE, width: TILE, height: TILE,
            display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'grab',
            background: drag?.kind === kind ? '#000' : 'transparent', pointerEvents: 'none',
            opacity: state.waiting ? 0.3 : 1,
          }}
        >
          <Glyph kind={kind} size={Math.round(TILE * 0.62)} />
        </div>
      ))}
      {/* A rule between the pieces and the page's Save / Load / Reset, and
          another above the trash. */}
      {[ACTIONS_TOP, TRASH_TOP].map(top => (
        <div
          key={top}
          style={{
            position: 'absolute', left: 0, top: top - 2 - line / 2 - (top === TRASH_TOP ? PAD / 2 : 0),
            width: TILES_W - 2 * line, height: line, background: '#000', pointerEvents: 'none',
          }}
        />
      ))}
      {ACTIONS.map(action => {
        const row = rowOf(action);
        const dark =
          pressed === action ||
          (action === 'Load' && state.loadOpen) ||
          action === state.armed ||
          (action === 'Trash' && state.overTrash);
        return (
          <div
            key={action}
            title={action === state.armed ? `Tap again to ${action === 'Reset' ? 'reset' : 'clear'}` : action}
            style={{
              position: 'absolute', left: 0, top: row.top - 2,
              width: TILES_W - 2 * line, height: row.h,
              display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
              background: dark ? '#000' : '#fff', pointerEvents: 'none',
            }}
          >
            <ActionIcon action={action} color={dark ? '#fff' : '#000'} />
          </div>
        );
      })}
    </div>
  );
}

/**
 * The page's Save (a disk), Load (a folder), Copy (two pages) and Reset (a
 * circling arrow), as line drawings on a 24-unit grid, for the Kotlin side
 * to draw as Paths.
 */
function ActionIcon({ action, color }: { action: (typeof ACTIONS)[number]; color: string }) {
  // The trash is a drop target: big, so a dragged piece finds it easily.
  const size = Math.round(action === 'Trash' ? TRASH_H * 0.72 : ACTION_H * 0.62);
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ display: 'block' }}>
      <g fill="none" stroke={color} strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round">
        {action === 'Save' && (
          <>
            <path d="M4 3h13l3 3v15H4z" />
            <path d="M8 3v5h8V3" />
            <rect x="7" y="13" width="10" height="8" />
          </>
        )}
        {action === 'Load' && (
          <>
            <path d="M3 6h7l2 2h9v12H3z" />
            <path d="M3 11h18" />
          </>
        )}
        {action === 'Copy' && (
          <>
            <path d="M9 7h11v14H9z" />
            <path d="M15 7V3H4v14h5" />
          </>
        )}
        {action === 'Reset' && (
          <>
            <path d="M19.5 13A7.5 7.5 0 1 1 17 6.4" />
            <path d="M18 2.5v4.5h-4.5" />
          </>
        )}
        {action === 'Trash' && (
          <>
            <path d="M4 7h16" />
            <path d="M9.5 7V4h5v3" />
            <path d="M6.5 7l1 13h9l1-13" />
            <path d="M10.5 11v5.5M13.5 11v5.5" />
          </>
        )}
      </g>
    </svg>
  );
}

/** The saved boards, from the palette's Load. Tap one to put it in place of this page. */
function LoadList() {
  const r = listRect()!;
  const line = Math.max(2, TILE * 0.04);
  return (
    <div
      style={{
        ...abs(r), zIndex: 53, background: '#fff', boxSizing: 'border-box',
        border: `${line}px solid #000`, userSelect: 'none', padding: PAD,
        display: 'flex', flexDirection: 'column',
      }}
    >
      <div style={{ height: NAME_H, font: 'bold 12px sans-serif', display: 'flex', alignItems: 'center' }}>
        Load a new page.
      </div>
      {state.boards.length === 0 ? (
        <div style={{ height: LIST_ROW, font: '13px sans-serif', color: '#555', display: 'flex', alignItems: 'center' }}>
          No saved boards yet.
        </div>
      ) : (
        state.boards.map(b => (
          <div
            key={b.keyword}
            style={{
              height: LIST_ROW, display: 'flex', alignItems: 'center', cursor: 'pointer',
              borderTop: '1px solid #000', font: '14px sans-serif', whiteSpace: 'nowrap',
              overflow: 'hidden', textOverflow: 'ellipsis',
            }}
            onPointerUp={() => {
              set({ loadOpen: false });
              emit({ type: 'load', keyword: b.keyword });
            }}
          >
            {b.name}
          </div>
        ))
      )}
    </div>
  );
}

function PieceHandle({ id, piece }: { id: string; piece: Handle }) {
  const hs = handleSize();
  const [press, setPress] = useState<null | { downX: number; downY: number; dragging: boolean }>(null);
  const start = { x: piece.x - hs / 2, y: piece.y - hs / 2 };
  const carried = state.carrying?.id === id ? state.carrying : null;
  const at = carried ?? start;

  return (
    <div
      title="Drag to move · drop on the button to remove"
      style={{
        ...abs({ ...at, w: hs, h: hs }), zIndex: carried ? 51 : 50, cursor: 'grab', touchAction: 'none',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        borderRadius: '50%',
        background: state.waiting && !carried ? 'rgba(0,0,0,0.25)' : 'transparent',
      }}
      onPointerDown={e => {
        if (state.waiting) {
          toast('One moment…');
          return;
        }
        (e.target as Element).setPointerCapture(e.pointerId);
        setPress({ downX: e.clientX, downY: e.clientY, dragging: false });
      }}
      onPointerMove={e => {
        if (!press) return;
        const dx = e.clientX - press.downX;
        const dy = e.clientY - press.downY;
        if (!press.dragging) {
          if (Math.abs(dx) <= SLOP && Math.abs(dy) <= SLOP) return;
          // Hide the piece the note still draws at its old spot, and carry a copy.
          setPress({ ...press, dragging: true });
          set({ masks: [...state.masks, { ...start, w: hs, h: hs }] });
        }
        const overTrash = inside(trashRect(), e.clientX, e.clientY);
        set({ carrying: { id, x: start.x + dx, y: start.y + dy }, overTrash });
      }}
      onPointerUp={e => {
        if (!press) return;
        setPress(null);
        if (!press.dragging || !state.carrying) return;
        if (inside(trashRect(), e.clientX, e.clientY)) {
          set({ overTrash: false });
          emit({ type: 'remove', id });
        } else if (overControls(e.clientX, e.clientY)) {
          // Dropped on the button or the palette but not the trash: it goes
          // back where it was, rather than being removed by a near miss.
          set({ carrying: null, masks: [], overTrash: false });
        } else {
          emit({ type: 'move', id, ...point(state.carrying.x + hs / 2, state.carrying.y + hs / 2, e) });
        }
        // Carry and mask stay until the controller calls setPieces.
      }}
    >
      {carried && <Glyph kind={piece.kind} size={Math.round(hs * 0.85)} />}
    </div>
  );
}

/** Mounted by the harness above the panel and the note (config.Overlay). */
export default function PaletteOverlay() {
  useStore();
  if (!state.button) return null;
  const size = state.pieceSize;
  return (
    <>
      {state.masks.map((m, i) => (
        <div key={i} style={{ ...abs(m), zIndex: 49, background: '#fff', pointerEvents: 'none' }} />
      ))}
      {[...state.handles].map(([id, piece]) => <PieceHandle key={id} id={id} piece={piece} />)}
      <Button />
      {state.open && <Tiles />}
      {state.open && state.loadOpen && <LoadList />}
      {state.ghost && (
        <div style={{ ...abs({ x: state.ghost.x - size / 2, y: state.ghost.y - size / 2, w: size, h: size }), pointerEvents: 'none', zIndex: 60 }}>
          <Glyph kind={state.ghost.kind} size={Math.round(size * 0.9)} />
        </div>
      )}
    </>
  );
}
